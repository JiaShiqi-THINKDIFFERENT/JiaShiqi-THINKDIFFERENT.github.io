/**
 * CLIVIA 四维度分析摘要卡（《雪球股票投资 24 章》框架：宏观 / 中观 / 微观 / 实操）
 * 数据：/four-dim/data/<slug>.json（由 tools/value-analysis/four_dim.py 生成）
 * 用法：在股票页「研究」章节的 .research-pair 容器内，与三好卡上下依次排列
 *   <div class="research-pair">
 *     <div id="three-good" data-slug="guizhou-maotai"></div>
 *     <div id="four-dim" data-slug="guizhou-maotai"></div>
 *   </div>
 *   <script src="/js/three-good.js" defer></script>
 *   <script src="/js/four-dim.js" defer></script>
 * 展示（个股页摘要卡规范）：标题 + 综合分徽章 + 更新日期 + 报告链接 + 维度得分表 + 一行方法论注脚。
 *   ★不展示结论长文（估值层面/行业层面/… 那段），结论只在完整报告页 /four-dim/<slug>/ 出现；
 *   ★新增方法时同样挂进 .research-pair 容器（单列堆叠），由 tools/value-analysis/attach_research.py 统一挂载。
 */
(function () {
  'use strict';

  var VERDICT_COLOR = {
    '强烈推荐': '#1b4d3e',
    '推荐': '#1b4d3e',
    '可关注': '#2f7d63',
    '观望': '#8a8f8c',
    '不推荐': '#b3594f',
    '远离': '#b3594f'
  };

  var CSS = [
    '.fdim{margin:0;border:1px solid var(--table-row-odd-bg-color,#e7eef0);border-radius:8px;padding:14px 16px;background:var(--sidebar-background,#fafbfa)}',
    '.fdim-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:10px}',
    '.fdim-title{font-weight:700}',
    '.fdim-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.9em;color:#fff;background:#1b4d3e;white-space:nowrap}',
    '.fdim-badge .fv{font-weight:700}',
    '.fdim-date{opacity:.65;font-size:.85em}',
    '.fdim-link{font-size:.92em}',
    '.fdim-table{width:100%;border-collapse:collapse;font-size:.9em}',
    '.fdim-table th,.fdim-table td{padding:6px 8px;border-bottom:1px solid var(--table-row-odd-bg-color,#e7eef0);text-align:right}',
    '.fdim-table th:first-child,.fdim-table td:first-child{text-align:left}',
    '.fdim-table thead th{font-weight:600;opacity:.75;font-size:.92em}',
    '.fdim-total{font-weight:700;color:#1b4d3e}',
    '.fdim-note{margin-top:8px;font-size:.8em;opacity:.62;line-height:1.5}',
    '@media (prefers-color-scheme:dark){.fdim-badge{background:#7fbf9e;color:#12201a}.fdim-total{color:#7fbf9e}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('fdim-style')) return;
    var s = document.createElement('style');
    s.id = 'fdim-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmt(v, nd) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(nd === undefined ? 1 : nd);
  }

  var DIM_ORDER = [
    ['macro', '宏观', '周期定位'],
    ['industry', '中观', '行业供需'],
    ['company', '微观', '公司质地'],
    ['action', '实操', '匹配与执行']
  ];

  function init() {
    var el = document.getElementById('four-dim');
    if (!el) return;
    injectCss();
    var slug = el.getAttribute('data-slug');
    if (!slug) return;

    fetch('/four-dim/data/' + encodeURIComponent(slug) + '.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var color = VERDICT_COLOR[d.verdict] || '#1b4d3e';
        var h = '<div class="fdim"><div class="fdim-head">' +
          '<span class="fdim-title">四维度分析</span>' +
          '<span class="fdim-badge" style="background:' + color + '">综合 <span class="fv">' +
          fmt(d.total) + '</span> / 100 · ' + esc(d.verdict) + '</span>' +
          '<span class="fdim-date">更新于 ' + esc(d.as_of) + '</span>' +
          '<a class="fdim-link" href="/four-dim/' + encodeURIComponent(slug) + '/">阅读完整报告 →</a>' +
          '</div>';

        h += '<table class="fdim-table"><thead><tr>' +
          '<th>维度</th><th>得分</th><th>满分</th><th>要点</th></tr></thead><tbody>';
        DIM_ORDER.forEach(function (row) {
          var dim = (d.dims || {})[row[0]];
          if (!dim) return;
          // 要点列 = 该维度得分率最低的子项（短板提示）
          var weak = null;
          (dim.items || []).forEach(function (it) {
            var rate = it.m ? it.s / it.m : 1;
            if (!weak || rate < weak.rate) weak = { k: it.k, s: it.s, m: it.m, rate: rate };
          });
          h += '<tr><td>' + esc(row[1]) + ' · ' + esc(row[2]) + '</td>' +
            '<td class="fdim-total">' + fmt(dim.score) + '</td>' +
            '<td>' + dim.max + '</td>' +
            '<td>' + (weak ? '短板 ' + esc(weak.k) + ' ' + fmt(weak.s) + '/' + weak.m : '—') +
            '</td></tr>';
        });
        h += '<tr><td><strong>综合</strong></td><td class="fdim-total">' + fmt(d.total) +
          '</td><td>100</td><td style="text-align:right">' + esc(d.metric) + ' 分位 ' +
          fmt(d.valuation && d.valuation.pct, 0) + '%</td></tr>';
        h += '</tbody></table>';

        // ★约定：个股页摘要卡不放结论长文（估值层面/行业层面/… 那段），结论只在 /four-dim/<slug>/ 报告页
        h += '<div class="fdim-note">四维度 = 宏观（周期定位）× 中观（行业供需）× 微观（公司质地）× ' +
          '实操（风格与规则），各 25 分（源自《雪球股票投资 24 章》）。' +
          '画像默认「' + esc(d.profile) + '」。' +
          '评分由脚本按行情与财报自动生成，为方法论演示，不构成投资建议。</div>';
        el.innerHTML = h + '</div>';
      })
      .catch(function () {
        el.innerHTML = '<div class="fdim-note">四维度分析数据加载失败。</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
