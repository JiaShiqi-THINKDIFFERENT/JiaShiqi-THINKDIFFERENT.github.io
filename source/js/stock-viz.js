/**
 * CLIVIA 股票估值展示组件（通用）
 * 用法：在任意股票页正文放置
 *   <div id="stock-viz" data-json="valuation-data.json"></div>
 *   <script src="/js/stock-viz.js" defer></script>
 * 渲染：快照表（当前/十年最低/中位/最高/分位条）+ ECharts 四指标联动图
 * JSON 由 tools/stockdb/export_json.py 从 PostgreSQL 导出。
 */
(function () {
  'use strict';

  var CSS = [
    '#stock-viz{margin:1.2em 0 1.6em}',
    '.sviz-head{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:baseline;font-size:.95em;margin-bottom:10px}',
    '.sviz-head b{font-weight:700}',
    '.sviz-muted{opacity:.72;font-size:.85em}',
    '.sviz-table{width:100%;border-collapse:collapse;font-size:.95em;margin-bottom:14px}',
    '.sviz-table th,.sviz-table td{padding:7px 8px;border-bottom:1px solid var(--table-row-odd-bg-color,#e7eef0);text-align:right}',
    '.sviz-table th:first-child,.sviz-table td:first-child{text-align:left}',
    '.sviz-table thead th{font-weight:600}',
    '.sviz-pctcell{display:flex;align-items:center;gap:8px;justify-content:flex-end;min-width:150px}',
    '.sviz-bar{position:relative;width:96px;height:8px;border-radius:4px;overflow:hidden;background:linear-gradient(90deg,#69b98b 0%,#69b98b 20%,#c9d6cd 20%,#c9d6cd 80%,#d98c7c 80%,#d98c7c 100%);opacity:.9}',
    '.sviz-bar i{position:absolute;top:-3px;width:2px;height:14px;background:#1b4d3e;border-radius:1px}',
    '@media (prefers-color-scheme: dark){.sviz-bar i{background:#7fbf9e}.sviz-table td,.sviz-table th{border-color:#2a4437}}',
    '.sviz-tag{display:inline-block;min-width:66px;text-align:center;padding:0 6px;border-radius:9px;font-size:.8em;line-height:20px;color:#fff}',
    '.sviz-tag.low{background:#3e9e6b}.sviz-tag.mid{background:#9aa8a0}.sviz-tag.high{background:#c96a4f}',
    '#stock-chart{width:100%;height:560px}',
    '.sviz-note{margin-top:10px;font-size:.8em;opacity:.62;line-height:1.6}',
    '.sviz-empty{padding:18px;border:1px dashed #9aa8a0;border-radius:6px;color:#77857d;font-size:.95em}'
  ].join('');

  function injectCss() {
    if (document.getElementById('sviz-style')) return;
    var s = document.createElement('style');
    s.id = 'sviz-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function fmt(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(digits === undefined ? 2 : digits);
  }

  function loadEcharts(cb) {
    if (window.echarts) return cb();
    var s = document.createElement('script');
    s.src = '/js/echarts.min.js';
    s.onload = cb;
    s.onerror = function () { console.warn('echarts 加载失败'); };
    document.head.appendChild(s);
  }

  function themeVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function renderTable(data, root) {
    var defs = [
      { key: 'close', label: '收盘价', unit: '元', digits: 2, dir: 0 },
      { key: 'pe_ttm', label: '市盈率 TTM', unit: '倍', digits: 2, dir: -1 },
      { key: 'pb', label: '市净率', unit: '倍', digits: 2, dir: -1 },
      { key: 'dv_ttm', label: '股息率 TTM', unit: '%', digits: 3, dir: 1 }
    ];
    var h = '<table class="sviz-table"><thead><tr><th>指标</th><th>当前值</th>' +
      '<th>十年最低</th><th>十年中位</th><th>十年最高</th><th style="text-align:right">当前分位</th></tr></thead><tbody>';
    defs.forEach(function (d) {
      var st = data.stats[d.key];
      if (!st) return;
      var tag, tagCls;
      if (st.pct <= 20) { tag = '低估值'; tagCls = 'low'; }
      else if (st.pct >= 80) { tag = '高估值'; tagCls = 'high'; }
      else { tag = '中位区'; tagCls = 'mid'; }
      h += '<tr><td>' + d.label + '</td>' +
        '<td><b>' + fmt(st.current, d.digits) + '</b> <span class="sviz-muted">' + d.unit + '</span></td>' +
        '<td>' + fmt(st.min, d.digits) + '</td>' +
        '<td>' + fmt(st.median, d.digits) + '</td>' +
        '<td>' + fmt(st.max, d.digits) + '</td>' +
        '<td><div class="sviz-pctcell">' +
        '<span class="sviz-tag ' + tagCls + '">' + tag + '</span>' +
        '<span class="sviz-bar"><i style="left:' + st.pct + '%"></i></span>' +
        '<b>' + fmt(st.pct, 1) + '%</b></div></td></tr>';
    });
    h += '</tbody></table>';
    var wrap = document.createElement('div');
    wrap.innerHTML = h;
    root.appendChild(wrap.firstChild);
  }

  function renderChart(data, root) {
    var holder = document.createElement('div');
    holder.id = 'stock-chart';
    root.appendChild(holder);
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var link = themeVar('--link-color', dark ? '#7fbf9e' : '#1b4d3e');
    var text = themeVar('--text-color', dark ? '#c9d6ce' : '#37474f');
    var axis = themeVar('--table-row-odd-bg-color', 'rgba(128,128,128,.35)');
    var s = data.series;
    var defs = [
      { key: 'close', name: '收盘价(元)', color: dark ? '#7fbf9e' : '#1b4d3e' },
      { key: 'pe_ttm', name: '市盈率TTM', color: '#4f7fb0' },
      { key: 'pb', name: '市净率', color: '#b08a3e' },
      { key: 'dv_ttm', name: '股息率TTM(%)', color: '#4c9e6b' }
    ];
    var top = [10, 30, 50, 70];
    var grids = [], xAxes = [], yAxes = [], series = [];
    defs.forEach(function (d, i) {
      grids.push({
        left: 74, right: 30, top: top[i] + '%', height: '17%',
        containLabel: false
      });
      xAxes.push({
        type: 'category', gridIndex: i, boundaryGap: false,
        data: s.dates, show: i === 3,
        axisLabel: { color: text, fontSize: 10 },
        axisLine: { lineStyle: { color: axis } },
        axisTick: { show: false },
        splitLine: { show: false }
      });
      yAxes.push({
        type: 'value', gridIndex: i, scale: true, name: d.name,
        nameTextStyle: { color: text, fontSize: 10, align: 'right' },
        axisLabel: { color: text, fontSize: 10 },
        splitLine: { lineStyle: { color: axis, type: 'dashed' } }
      });
      series.push({
        name: d.name, type: 'line', xAxisIndex: i, yAxisIndex: i,
        data: s[d.key], showSymbol: false, smooth: false,
        connectNulls: false, lineStyle: { width: 1.4, color: d.color },
        itemStyle: { color: d.color },
        emphasis: { disabled: true }
      });
    });
    var opt = {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: text },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, textStyle: { fontSize: 12 } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      series: series,
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1, 2, 3], bottom: 0, height: 16,
          borderColor: 'transparent', backgroundColor: 'transparent',
          fillerColor: link.replace(')', ',.12)').replace('rgb', 'rgba') }
      ],
      color: defs.map(function (d) { return d.color; })
    };
    var chart = echarts.init(holder);
    chart.setOption(opt);
    window.addEventListener('resize', function () { chart.resize(); });
  }

  function renderNote(note, root) {
    var p = document.createElement('div');
    p.className = 'sviz-note';
    p.textContent = '数据说明：' + note;
    root.appendChild(p);
  }

  function init() {
    var el = document.getElementById('stock-viz');
    if (!el) return;
    injectCss();
    var jsonName = el.getAttribute('data-json') || 'valuation-data.json';
    var url = new URL(jsonName, window.location.href).href;
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        // 标题行
        var head = document.createElement('div');
        head.className = 'sviz-head';
        head.innerHTML = '<b>' + (data.name || '') + '</b>' +
          '<span class="sviz-muted">' + data.symbol + '</span>' +
          '<span class="sviz-muted">样本窗口 ' + data.window.start + ' ~ ' + data.window.end +
          '（' + data.window.days + ' 个交易日）</span>' +
          '<span class="sviz-muted">更新至 ' + data.updated + '</span>';
        el.appendChild(head);
        renderTable(data, el);
        loadEcharts(function () { renderChart(data, el); });
        renderNote(data.note, el);
      })
      .catch(function () {
        var d = document.createElement('div');
        d.className = 'sviz-empty';
        d.textContent = '估值数据尚未生成：请运行 tools/stockdb 更新管线后重新构建站点。';
        el.appendChild(d);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
