/**
 * CLIVIA 股票估值展示组件（通用）
 * 用法：在任意股票页正文放置
 *   <div id="stock-viz" data-json="valuation-data.json"></div>
 *   <script src="/js/stock-viz.js" defer></script>
 * 渲染：快照表（当前/十年最低/中位/最高/分位条）+ 指标标签页图表
 *   标签栏位于图表上方（收盘价 / 市盈率 / 市净率 / 股息率），
 *   切换标签后下方展示对应指标的十年走势图，默认显示收盘价；
 *   支持键盘左右方向键 / Home / End 切换。
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
    '.sviz-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}',
    '.sviz-tab{-webkit-appearance:none;appearance:none;cursor:pointer;font-size:.9em;line-height:1;padding:7px 16px;border-radius:16px;border:1px solid var(--link-decoration-color,#9dbcae);background:transparent;color:var(--text-color);transition:background .18s ease,color .18s ease,border-color .18s ease}',
    '.sviz-tab:hover{background:var(--menu-item-bg-color,#edf3ef);border-color:#1b4d3e}',
    '.sviz-tab[aria-selected="true"]{background:#1b4d3e;border-color:#1b4d3e;color:#fff;font-weight:600}',
    '.sviz-tab:focus-visible{outline:2px solid #1b4d3e;outline-offset:2px}',
    '.sviz-cap{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin:10px 0 2px;font-size:.92em}',
    '.sviz-cap .sviz-cur{font-weight:700;font-size:1.05em}',
    '#stock-chart{width:100%;height:440px}',
    '@media (max-width:767px){#stock-chart{height:360px}}',
    '.sviz-note{margin-top:10px;font-size:.8em;opacity:.62;line-height:1.6}',
    '.sviz-empty{padding:18px;border:1px dashed #9aa8a0;border-radius:6px;color:#77857d;font-size:.95em}',
    '@media (prefers-color-scheme:dark){.sviz-tab{border-color:#3f5c4d}.sviz-tab:hover{background:#1c2f26;border-color:#7fbf9e}.sviz-tab[aria-selected="true"]{background:#7fbf9e;border-color:#7fbf9e;color:#12201a}.sviz-tab:focus-visible{outline-color:#7fbf9e}}'
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

  // 四个指标的展示定义（与快照表口径一致）
  var METRICS = [
    { key: 'close',  label: '收盘价', unit: '元', digits: 2, light: '#1b4d3e', dark: '#7fbf9e' },
    { key: 'pe_ttm', label: '市盈率', unit: '倍', digits: 2, light: '#4f7fb0', dark: '#7fb0d8' },
    { key: 'pb',     label: '市净率', unit: '倍', digits: 2, light: '#b08a3e', dark: '#d9b56a' },
    { key: 'dv_ttm', label: '股息率', unit: '%',  digits: 3, light: '#4c9e6b', dark: '#7fd0a0' }
  ];

  function hexToRgba(hex, alpha) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  // 计算「近一年」窗口在整段序列中的起始百分比（ISO 日期可直接字典序比较）
  function oneYearStartPct(dates) {
    var n = dates.length;
    if (n < 2) return 0;
    var last = String(dates[n - 1]);
    var y = Number(last.slice(0, 4));
    if (isNaN(y)) return 0;
    var cutoff = String(y - 1) + last.slice(4);
    var i = 0;
    while (i < n && String(dates[i]) < cutoff) i++;
    return (i / (n - 1)) * 100;
  }

  // 单个指标的完整图表配置（一屏一图，含中位参考线）
  function metricOption(data, m, dark, text, axis) {
    var color = dark ? m.dark : m.light;
    var st = data.stats[m.key] || {};
    var startPct = oneYearStartPct(data.series.dates);
    var markData = [];
    if (st.median !== undefined && st.median !== null) {
      markData.push({
        yAxis: st.median,
        lineStyle: { color: axis, type: 'dashed', width: 1 },
        label: {
          formatter: '十年中位 ' + fmt(st.median, m.digits),
          position: 'insideEndTop', color: text, fontSize: 12
        }
      });
    }
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: text, fontSize: 12 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: color, width: 1 } },
        textStyle: { fontSize: 13 },
        formatter: function (ps) {
          if (!ps || !ps.length) return '';
          var v = ps[0].value;
          var shown = (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(m.digits);
          return ps[0].axisValue + '<br/>' + m.label + '：<b>' + shown + '</b> ' + m.unit;
        }
      },
      // 左右留足空间：左侧容纳数值+单位，右侧避免最后一个日期被裁切
      grid: { left: 88, right: 52, top: 34, bottom: 82 },
      xAxis: {
        type: 'category', data: data.series.dates, boundaryGap: false,
        axisLabel: {
          color: text, fontSize: 12, hideOverlap: true, margin: 10,
          // 轴标签只显示到月份（YYYY-MM），避免日期过长互相挤压/超出绘图区
          formatter: function (v) { return String(v).slice(0, 7); }
        },
        axisLine: { lineStyle: { color: axis } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value', scale: true,
        name: m.unit,
        nameTextStyle: { color: text, fontSize: 12, align: 'right', padding: [0, 4, 0, 0] },
        axisLabel: { color: text, fontSize: 12, margin: 10 },
        splitLine: { lineStyle: { color: axis, type: 'dashed' } }
      },
      series: [{
        name: m.label, type: 'line', data: data.series[m.key],
        showSymbol: false, smooth: false, connectNulls: true,
        lineStyle: { width: 1.6, color: color },
        itemStyle: { color: color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(color, dark ? 0.3 : 0.18) },
            { offset: 1, color: hexToRgba(color, 0) }
          ])
        },
        emphasis: { disabled: true },
        markLine: { silent: true, symbol: 'none', animation: false, data: markData }
      }],
      // 默认只展示近一年，可拖动下方时间轴回溯十年
      dataZoom: [
        { type: 'inside', start: startPct, end: 100 },
        {
          type: 'slider', bottom: 12, height: 22, left: 88, right: 52,
          start: startPct, end: 100,
          borderColor: 'transparent', backgroundColor: 'transparent',
          fillerColor: hexToRgba(dark ? '#7fbf9e' : '#1b4d3e', 0.14),
          handleStyle: { color: color, borderColor: color },
          labelFormatter: function (v) { return String(v).slice(0, 7); },
          textStyle: { color: text, fontSize: 12 }
        }
      ]
    };
  }

  // 图表上方标签栏 + 下方单指标图；默认展示收盘价
  function renderChart(data, root) {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var text = themeVar('--text-color', dark ? '#c9d6ce' : '#37474f');
    var axis = themeVar('--table-row-odd-bg-color', 'rgba(128,128,128,.35)');

    var tabs = document.createElement('div');
    tabs.className = 'sviz-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '估值指标切换');

    var cap = document.createElement('div');
    cap.className = 'sviz-cap';

    var holder = document.createElement('div');
    holder.id = 'stock-chart';
    holder.setAttribute('role', 'tabpanel');

    root.appendChild(tabs);
    root.appendChild(cap);
    root.appendChild(holder);

    var chart = echarts.init(holder);
    var btns = [];

    function select(i) {
      btns.forEach(function (b, j) {
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
        b.tabIndex = j === i ? 0 : -1;
      });
      var m = METRICS[i];
      var st = data.stats[m.key] || {};
      cap.innerHTML = '<span class="sviz-cur">' + m.label + ' ' + fmt(st.current, m.digits) + ' ' + m.unit + '</span>' +
        '<span class="sviz-muted">十年最低 ' + fmt(st.min, m.digits) + ' · 中位 ' +
        fmt(st.median, m.digits) + ' · 最高 ' + fmt(st.max, m.digits) + ' ' + m.unit + '</span>' +
        '<span class="sviz-muted">当前分位 ' + fmt(st.pct, 1) + '%</span>' +
        '<span class="sviz-muted">默认显示近一年，拖动下方时间轴可回溯十年</span>';
      chart.setOption(metricOption(data, m, dark, text, axis), true);
    }

    METRICS.forEach(function (m, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sviz-tab';
      b.textContent = m.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener('click', function () { select(i); });
      // 键盘可访问：左右方向键 / Home / End 切换
      b.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % METRICS.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + METRICS.length) % METRICS.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = METRICS.length - 1;
        if (n !== null) { e.preventDefault(); select(n); btns[n].focus(); }
      });
      tabs.appendChild(b);
      btns.push(b);
    });

    select(0); // 默认显示收盘价
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
