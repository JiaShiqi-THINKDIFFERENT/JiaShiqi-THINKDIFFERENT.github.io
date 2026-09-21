/**
 * CLIVIA 股票估值展示组件（通用）
 * 用法：在任意股票页正文放置
 *   <div id="stock-viz" data-json="valuation-data.json"></div>
 *   <script src="/js/stock-viz.js" defer></script>
 * 渲染：快照表（当前/十年最低/中位/最高/分位条）+ 同花顺式估值带图表
 *   标签栏位于图表上方（市盈率 / 市净率 / 市销率 / 股息率，按数据有无动态生成）；
 *   每张图不直接画指标曲线，而是展示收盘价（默认前复权，标签栏右侧可切换不复权），
 *   并按财报区间叠加该指标的估值分档横线（档位随口径同步切换，历史完全对齐）：
 *   横线为近十年最高/最低估值对应上下沿，中间四等分共 5 条阶梯线
 *   （价格 = 财报区间每股基本面 × 档位估值）；
 *   股息率例外（JSON 中 mode="points"）：不画档位线，改用双轴——
 *   左轴收盘价曲线 + 右轴股息率(TTM)曲线，分红除权除息日以圆点标在股息率曲线上，
 *   悬浮显示每股派息与本次股息率；
 *   默认显示市盈率，默认视窗近一年，可拖动底部时间轴回溯十年；
 *   支持键盘左右方向键 / Home / End 切换。
 * JSON 由 tools/stockdb/export_json.py 从 PostgreSQL 导出（bands 字段）。
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
    // 复权方式切换（前复权 / 不复权）：贴在标签栏右侧的连体胶囊按钮组
    '.sviz-adj{display:flex;margin-left:auto}',
    '.sviz-adj .sviz-tab{font-size:.82em;padding:6px 13px;border-radius:0}',
    '.sviz-adj .sviz-tab:first-child{border-radius:16px 0 0 16px}',
    '.sviz-adj .sviz-tab+.sviz-tab{border-left:none}',
    '.sviz-adj .sviz-tab:last-child{border-radius:0 16px 16px 0}',
    '.sviz-cap{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin:10px 0 2px;font-size:.92em}',
    '.sviz-cap .sviz-cur{font-weight:700;font-size:1.05em}',
    '#stock-chart{width:100%;height:460px;position:relative}',
    // 绘图区四周完整边框：与 ECharts grid 的像素偏移严格一致（left/right/top/bottom）。
    // 右边距用 CSS 变量——股息率图多一条右轴，需要更宽的右侧留白，由 JS 按模式设置。
    '#stock-chart::after{content:\'\';position:absolute;left:88px;right:var(--sviz-right,52px);top:34px;bottom:82px;border:1px solid #7f938a;border-radius:3px;pointer-events:none}',
    '@media (max-width:767px){#stock-chart{height:380px}}',
    '.sviz-note{margin-top:10px;font-size:.8em;opacity:.62;line-height:1.6}',
    '.sviz-empty{padding:18px;border:1px dashed #9aa8a0;border-radius:6px;color:#77857d;font-size:.95em}',
    '@media (prefers-color-scheme:dark){.sviz-tab{border-color:#3f5c4d}.sviz-tab:hover{background:#1c2f26;border-color:#7fbf9e}.sviz-tab[aria-selected="true"]{background:#7fbf9e;border-color:#7fbf9e;color:#12201a}.sviz-tab:focus-visible{outline-color:#7fbf9e}#stock-chart::after{border-color:#87a295}}'
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

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 时间轴取值统一格式化为 YYYY-MM 或 YYYY-MM-DD（本地时区，避免跨日偏移）
  function fmtDate(v, mode) {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var s = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    if (mode === 'ymd') s += '-' + pad2(d.getDate());
    return s;
  }

  // 从 tooltip 回调参数中还原原始日期串
  function itemDate(p) {
    var d = p && p.data;
    if (d && typeof d === 'object' && d.length) d = d[0];
    else d = p ? p.axisValue : null;
    if (typeof d === 'string') return d;
    if (typeof d === 'number') return fmtDate(d, 'ymd');
    return '';
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
      { key: 'ps_ttm', label: '市销率 TTM', unit: '倍', digits: 2, dir: -1 },
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

  // 估值带指标定义（顺序即标签顺序；与 export_json.py 的 BAND_METRICS 对应）
  var BAND_METRICS = [
    { key: 'pe_ttm', label: '市盈率', unit: '倍', digits: 1, light: '#4f7fb0', dark: '#7fb0d8' },
    { key: 'pb',     label: '市净率', unit: '倍', digits: 2, light: '#b08a3e', dark: '#d9b56a' },
    { key: 'ps_ttm', label: '市销率', unit: '倍', digits: 2, light: '#8a6fb0', dark: '#b39ddb' },
    { key: 'dv_ttm', label: '股息率', unit: '%',  digits: 2, light: '#4c9e6b', dark: '#7fd0a0' }
  ];

  // 股息率图（双轴）配色：收盘价沿用指标色（绿），股息率曲线用橙，分红点用红
  var DV_LINE = { light: '#e87d1e', dark: '#f0a04b' };
  var DV_DOT = '#d93636';
  // 双轴模式下右侧要留给股息率轴（比单轴多 22px）
  var GRID_RIGHT_DUAL = 74;

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

  // 把估值带阶梯段 [[起日, 止日, 价格], ...] 展开为与 dates 对齐的取值数组（段外为 null）
  function expandBand(dates, idxMap, segs) {
    var arr = new Array(dates.length);
    for (var i = 0; i < arr.length; i++) arr[i] = null;
    (segs || []).forEach(function (s) {
      var i0 = idxMap[s[0]];
      var i1 = idxMap[s[1]];
      if (i0 === undefined || i1 === undefined) return;
      for (var i = i0; i <= i1 && i < arr.length; i++) arr[i] = s[2];
    });
    return arr;
  }

  // 坐标系：时间轴（横轴）+ 价格轴（纵轴），横竖网格线均为实色可见；
  // 绘图区四周的完整边框由 CSS（#stock-chart::after）按相同偏移绘制。
  var GRID = { left: 88, right: 52, top: 34, bottom: 82 };

  // 同花顺式估值带图：收盘价（adj='qfq'前复权 / 'raw'不复权）+ 该指标近十年四等分
  // 估值档位横线（五档），档位段按同口径计算（segments / segments_raw），历史完全对齐。
  // 股息率为 points 模式：不画档位线，改画双轴——左轴收盘价 + 右轴股息率(TTM)曲线，
  // 分红除权除息日以圆点标在股息率曲线上（y = 当日股息率，而不是价格）。
  function bandOption(data, key, m, dark, text, gridLine, border, adj) {
    var color = dark ? m.dark : m.light;
    // 档位线颜色（从下到上）：绿 / 蓝 / 黄 / 橙 / 红
    var bandColors = dark
      ? ['#3ddc68', '#4d8dff', '#ffd21e', '#ff9436', '#ff5c5c']
      : ['#1f9e44', '#1667d9', '#d9a400', '#e87d1e', '#d93636'];
    var st = data.stats[key] || {};
    var dates = data.series.dates;
    var qfq = adj === 'raw' ? (data.series.close || []) : (data.series.close_qfq || []);
    var metricVals = data.series[key] || [];
    var idxMap = data.__dateIdx;
    var priceLabel = adj === 'raw' ? '收盘价(不复权)' : '收盘价(前复权)';

    var pts = [];
    for (var i = 0; i < dates.length; i++) {
      var v = qfq[i];
      pts.push([dates[i], (v === null || v === undefined || isNaN(v)) ? null : v]);
    }

    var series = [{
      name: priceLabel, type: 'line', data: pts,
      showSymbol: false, smooth: false, connectNulls: true,
      lineStyle: { width: 1.8, color: color },
      itemStyle: { color: color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: hexToRgba(color, dark ? 0.3 : 0.16) },
          { offset: 1, color: hexToRgba(color, 0) }
        ])
      },
      emphasis: { disabled: true },
      z: 10
    }];

    var bm = data.bands.metrics[key];
    var pointsMode = (bm.mode === 'points');   // 股息率：分红日打点，不画档位线
    var divMap = {};                           // 分红日 -> [每股派息(元), 本次股息率(%)]
    var n = 0;                                 // 档位数（points 模式无档位）

    if (pointsMode) {
      var dvColor = dark ? DV_LINE.dark : DV_LINE.light;

      // 股息率(TTM)曲线：右轴，单位 %
      var dvLine = [];
      for (var t = 0; t < dates.length; t++) {
        var dv = metricVals[t];
        dvLine.push([dates[t], (dv === null || dv === undefined || isNaN(dv)) ? null : dv]);
      }
      series.push({
        name: '股息率TTM', type: 'line', data: dvLine, yAxisIndex: 1,
        showSymbol: false, smooth: false, connectNulls: true,
        lineStyle: { width: 1.8, color: dvColor },
        itemStyle: { color: dvColor },
        emphasis: { disabled: true },
        z: 11
      });

      // 分红除权日打点：y 取当日股息率，圆点正好落在股息率曲线上
      var divPts = [];
      (bm.points || []).forEach(function (p) {
        var i0 = idxMap[p[0]];
        if (i0 === undefined) return;
        var pv = metricVals[i0];
        if (pv === null || pv === undefined || isNaN(pv)) return;
        divPts.push([p[0], pv]);
        divMap[p[0]] = [p[1], p[2]];
      });
      if (divPts.length) {
        series.push({
          name: '分红除权日', type: 'scatter', data: divPts, yAxisIndex: 1,
          symbol: 'circle', symbolSize: 9, z: 12,
          itemStyle: { color: DV_DOT, borderColor: dark ? '#12201a' : '#ffffff', borderWidth: 1.5 },
          emphasis: { disabled: true }
        });
      }
    } else {
      // 档位段按所选口径取：segments=前复权口径，segments_raw=不复权口径（导出端同源计算）
      var bandSegs = (adj === 'raw' && bm.segments_raw) ? bm.segments_raw : bm.segments;
      n = (bm.levels || []).length;
      for (var j = 0; j < n; j++) {
        var vals = expandBand(dates, idxMap, bandSegs[j]);
        var lineData = [];
        for (var k = 0; k < dates.length; k++) {
          if (vals[k] !== null) lineData.push([dates[k], vals[k]]);
        }
        var bandColor = bandColors[j % bandColors.length];
        series.push({
          name: '估值档位' + j, type: 'line', data: lineData,
          showSymbol: false, smooth: false, connectNulls: false,
          // 阶梯绘制：财报季度内保持水平，切换财报区间处垂直跳变，
          // 避免相邻季度档位价格不同被连成斜线（同花顺式画法）
          step: 'end',
          lineStyle: {
            width: 2,
            type: 'solid',
            color: bandColor,
            opacity: 0.95
          },
          itemStyle: { color: bandColor },
          emphasis: { disabled: true },
          silent: true, z: 5
        });
      }
    }

    function levelOf(val) {
      // 返回当前估值落在的档位序号（0=最低档）与描述
      if (val === null || val === undefined || isNaN(val)) return null;
      var L = bm.levels;
      if (bm.inverse) {
        if (val <= L[0]) return 0;
        if (val >= L[n - 1]) return n - 1;
        for (var j2 = 0; j2 < n - 1; j2++) {
          if (val >= L[j2] && val <= L[j2 + 1]) return (val - L[j2] < L[j2 + 1] - val) ? j2 : j2 + 1;
        }
        return null;
      }
      if (val <= L[0]) return 0;
      if (val >= L[n - 1]) return n - 1;
      for (var j3 = 0; j3 < n - 1; j3++) {
        if (val >= L[j3] && val <= L[j3 + 1]) return (val - L[j3] < L[j3 + 1] - val) ? j3 : j3 + 1;
      }
      return null;
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: text, fontSize: 12 },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: color, width: 1 },
          label: { formatter: function (p) { return fmtDate(p.value, 'ymd'); } }
        },
        textStyle: { fontSize: 13 },
        formatter: function (ps) {
          if (!ps || !ps.length) return '';
          var p = ps[0];
          ps.forEach(function (q) {          // 取价格线参数（points 模式下还有分红散点）
            if (q.seriesName === priceLabel) p = q;
          });
          var price = p.value;
          if (price && typeof price === 'object' && price.length) price = price[1];
          var iso = itemDate(p);
          var i = data.__dateIdx[iso];
          var mv = (i !== undefined) ? metricVals[i] : null;
          var lines = [iso,
            priceLabel + '：<b>' + fmt(price, 2) + '</b> 元'];
          if (mv !== null && mv !== undefined && !isNaN(mv)) {
            var lvDesc = '';
            if (!pointsMode) {
              var lv = levelOf(mv);
              lvDesc = (lv === null) ? '' : '（近十年第 ' + (lv + 1) + ' 低档 / 共 ' + n + ' 档）';
            }
            lines.push(m.label + '：<b>' + fmt(mv, m.digits) + '</b> ' + m.unit + lvDesc);
          }
          var dvInfo = divMap[iso];
          if (dvInfo) {
            lines.push('分红除权日：每股派息 <b>' + fmt(dvInfo[0], 1) + '</b> 元' +
              (dvInfo[1] === null || dvInfo[1] === undefined
                ? '' : ' · 本次股息率 <b>' + fmt(dvInfo[1], 2) + '</b>%'));
          }
          return lines.join('<br/>');
        }
      },
      // 左右留足空间：左侧容纳数值+单位，右侧避免最后一个日期被裁切；
      // 双轴（股息率）时右侧还要额外容纳股息率轴标签
      grid: {
        left: GRID.left,
        right: pointsMode ? GRID_RIGHT_DUAL : GRID.right,
        top: GRID.top,
        bottom: GRID.bottom
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          color: text, fontSize: 12, hideOverlap: true, margin: 12,
          formatter: function (v) { return fmtDate(v, 'ym'); }
        },
        axisLine: { show: true, lineStyle: { color: border, width: 1 } },
        axisTick: { show: true, length: 5, lineStyle: { color: border, width: 1 } },
        // 竖线：随缩放自动选取合适的年月间隔
        splitLine: { show: true, lineStyle: { color: gridLine, type: 'dashed', width: 1 } }
      },
      yAxis: (function () {
        var left = {
          type: 'value', scale: true,
          name: adj === 'raw' ? '元(不复权)' : '元(前复权)',
          nameTextStyle: { color: text, fontSize: 12, align: 'right', padding: [0, 4, 0, 0] },
          axisLabel: { color: text, fontSize: 12, margin: 12 },
          axisLine: { show: true, lineStyle: { color: border, width: 1 } },
          axisTick: { show: true, length: 5, lineStyle: { color: border, width: 1 } },
          splitLine: { show: true, lineStyle: { color: gridLine, type: 'dashed', width: 1 } }
        };
        if (!pointsMode) return left;
        // 股息率图：右轴单独承载股息率曲线与分红点（网格线仍只由左轴提供，避免双份虚线）
        var dvColor = dark ? DV_LINE.dark : DV_LINE.light;
        var right = {
          type: 'value', scale: true, min: 0, position: 'right',
          name: '股息率(%)',
          nameTextStyle: { color: dvColor, fontSize: 12, align: 'left', padding: [0, 0, 0, 4] },
          axisLabel: { color: dvColor, fontSize: 12, margin: 12, formatter: '{value}' },
          axisLine: { show: true, lineStyle: { color: dvColor, width: 1 } },
          axisTick: { show: true, length: 5, lineStyle: { color: dvColor, width: 1 } },
          splitLine: { show: false }
        };
        return [left, right];
      })(),
      series: series,
      // 默认只展示近一年，可拖动下方时间轴回溯十年
      dataZoom: [
        { type: 'inside', start: oneYearStartPct(dates), end: 100 },
        {
          type: 'slider', bottom: 12, height: 22, left: GRID.left,
          right: pointsMode ? GRID_RIGHT_DUAL : GRID.right,
          start: oneYearStartPct(dates), end: 100,
          borderColor: 'transparent', backgroundColor: 'transparent',
          fillerColor: hexToRgba(dark ? '#7fbf9e' : '#1b4d3e', 0.14),
          handleStyle: { color: color, borderColor: color },
          dataBackground: {
            lineStyle: { color: gridLine, width: 1 },
            areaStyle: { color: hexToRgba(dark ? '#7fbf9e' : '#1b4d3e', 0.1) }
          },
          labelFormatter: function (v) { return fmtDate(v, 'ym'); },
          textStyle: { color: text, fontSize: 12 }
        }
      ]
    };
  }

  // 图表上方标签栏 + 下方估值带图；默认展示市盈率
  function renderChart(data, root) {
    if (!data.bands || !data.bands.metrics) {
      var empty = document.createElement('div');
      empty.className = 'sviz-empty';
      empty.textContent = '估值带数据尚未生成，请重新执行数据导出。';
      root.appendChild(empty);
      return;
    }
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var text = themeVar('--text-color', dark ? '#c9d6ce' : '#37474f');
    var gridLine = dark ? '#3f5a4c' : '#c0cdc5';
    var border = dark ? '#87a295' : '#7f938a';

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
    var cur = 0;          // 当前选中的指标序号
    var adj = 'qfq';      // 价格口径：'qfq'=前复权（默认）/ 'raw'=不复权

    // 只展示 JSON 中有估值带数据的标签（如从未分红的个股不显示「股息率」）
    var metrics = BAND_METRICS.filter(function (m) {
      return !!(data.bands.metrics[m.key]);
    });
    if (!metrics.length) {
      tabs.style.display = 'none';
      cap.style.display = 'none';
      holder.innerHTML = '<div class="sviz-empty">暂无估值带数据</div>';
      return;
    }

    function select(i) {
      btns.forEach(function (b, j) {
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
        b.tabIndex = j === i ? 0 : -1;
      });
      var m = metrics[i];
      var st = data.stats[m.key] || {};
      var bm = data.bands.metrics[m.key];
      var inv = bm.inverse;
      if (bm.mode === 'points') {
        // 股息率：双轴——左轴收盘价曲线 + 右轴股息率曲线，分红点落在股息率曲线上
        var priceColor = dark ? m.dark : m.light;
        var dvColor = dark ? DV_LINE.dark : DV_LINE.light;
        cap.innerHTML = '<span class="sviz-cur">' + m.label + ' ' + fmt(st.current, m.digits) + ' ' + m.unit + '</span>' +
          '<span class="sviz-muted">近十年最低 ' + fmt(st.min, m.digits) + ' · 最高 ' + fmt(st.max, m.digits) + ' ' + m.unit + '</span>' +
          '<span class="sviz-muted">当前分位 ' + fmt(st.pct, 1) + '%</span>' +
          // 内联图例：两条曲线 + 分红点，避免再加 legend 挤压绘图区
          '<span class="sviz-muted">' + chip(priceColor) + '收盘价(左轴)</span>' +
          '<span class="sviz-muted">' + chip(dvColor) + '股息率TTM(右轴)</span>' +
          '<span class="sviz-muted">' + dotChip(DV_DOT) + '分红除权日 ' +
          (bm.points || []).length + ' 次</span>';
      } else {
        var lo = inv ? bm.levels[bm.levels.length - 1] : bm.levels[0];
        var hi = inv ? bm.levels[0] : bm.levels[bm.levels.length - 1];
        cap.innerHTML = '<span class="sviz-cur">' + m.label + ' ' + fmt(st.current, m.digits) + ' ' + m.unit + '</span>' +
          '<span class="sviz-muted">近十年最低 ' + fmt(st.bmin, m.digits) + ' · 最高 ' + fmt(st.bmax, m.digits) + ' ' + m.unit + '</span>' +
          '<span class="sviz-muted">当前分位 ' + fmt(st.pct, 1) + '%</span>' +
          '<span class="sviz-muted">横线 = 近十年' + m.label + (inv ? '最高→最低' : '最低→最高') +
          '（' + fmt(lo, m.digits) + ' ~ ' + fmt(hi, m.digits) + ' ' + m.unit + '）四等分五档，按财报区间阶梯更新</span>';
      }
      // 边框（CSS ::after）右边距跟随 grid：股息率图多一条右轴，需更宽留白
      holder.style.setProperty('--sviz-right',
        (bm.mode === 'points' ? GRID_RIGHT_DUAL : GRID.right) + 'px');
      chart.setOption(bandOption(data, m.key, m, dark, text, gridLine, border, adj), true);
    }

    // 摘要行内联图例：线条色块 / 圆点色块
    function chip(color) {
      return '<i style="display:inline-block;width:12px;height:3px;background:' + color +
        ';vertical-align:middle;margin-right:5px"></i>';
    }

    function dotChip(color) {
      return '<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
        color + ';vertical-align:middle;margin-right:5px"></i>';
    }

    // 复权方式切换按钮组（前复权 / 不复权），贴在标签栏右侧
    var adjWrap = document.createElement('div');
    adjWrap.className = 'sviz-adj';
    adjWrap.setAttribute('role', 'group');
    adjWrap.setAttribute('aria-label', '复权方式切换');
    [['qfq', '前复权'], ['raw', '不复权']].forEach(function (pair) {
      var val = pair[0];
      var ab = document.createElement('button');
      ab.type = 'button';
      ab.className = 'sviz-tab';
      ab.textContent = pair[1];
      ab.setAttribute('aria-pressed', val === adj ? 'true' : 'false');
      ab.addEventListener('click', function () {
        if (adj === val) return;
        adj = val;
        adjWrap.querySelectorAll('.sviz-tab').forEach(function (x) {
          x.setAttribute('aria-pressed', x === ab ? 'true' : 'false');
        });
        select(cur);
      });
      adjWrap.appendChild(ab);
    });
    tabs.appendChild(adjWrap);

    metrics.forEach(function (m, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sviz-tab';
      b.textContent = m.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener('click', function () { cur = i; select(i); });
      // 键盘可访问：左右方向键 / Home / End 切换
      b.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % metrics.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + metrics.length) % metrics.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = metrics.length - 1;
        if (n !== null) { e.preventDefault(); cur = n; select(n); btns[n].focus(); }
      });
      tabs.appendChild(b);
      btns.push(b);
    });

    select(0); // 默认显示市盈率
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
        // 预建日期索引（tooltip 档位说明 / 带线展开共用）
        var idxMap = {};
        data.series.dates.forEach(function (d, i) { idxMap[d] = i; });
        data.__dateIdx = idxMap;
        // 近十年最低/最高（估值带口径），供摘要行使用；points 模式（股息率）取序列统计值
        if (data.bands && data.bands.metrics) {
          Object.keys(data.bands.metrics).forEach(function (k) {
            var bm = data.bands.metrics[k];
            var st = data.stats[k];
            if (!st) return;
            if (bm.levels && bm.levels.length) {
              st.bmin = bm.inverse ? bm.levels[bm.levels.length - 1] : bm.levels[0];
              st.bmax = bm.inverse ? bm.levels[0] : bm.levels[bm.levels.length - 1];
            } else {
              st.bmin = st.min;
              st.bmax = st.max;
            }
          });
        }
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
