/**
 * CLIVIA 三好投资法则分析展示组件
 * 数据：/three-good/data/scores.json（由 tools/value-analysis/score_stock.py 每周四收盘后更新）
 * 用法：在股票页「研究」章节的 .research-pair 容器内，与四维度卡等新方法上下依次排列
 *   <div class="research-pair">
 *     <div id="three-good" data-slug="guizhou-maotai"></div>
 *     <div id="four-dim" data-slug="guizhou-maotai"></div>
 *   </div>
 *   <script src="/js/three-good.js" defer></script>
 *   <script src="/js/four-dim.js" defer></script>
 * 展示：最新综合评分徽章 + 报告链接 + 近三个月每周打分表
 *   ★个股页摘要卡不放结论长文，结论只在 /three-good/<slug>/ 报告页；
 *   ★新增方法挂进 .research-pair（单列堆叠），由 tools/value-analysis/attach_research.py 统一挂载。
 */
(function () {
  'use strict';

  var CSS = [
    '.tgood{margin:1em 0 1.4em;border:1px solid var(--table-row-odd-bg-color,#e7eef0);border-radius:8px;padding:14px 16px;background:var(--sidebar-background,#fafbfa)}',
    '.tgood-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:10px}',
    '.tgood-title{font-weight:700}',
    '.tgood-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.9em;color:#fff;background:#1b4d3e;white-space:nowrap}',
    '.tgood-badge .tv{font-weight:700}',
    '.tgood-date{opacity:.65;font-size:.85em}',
    '.tgood-link{font-size:.92em}',
    '.tgood-table{width:100%;border-collapse:collapse;font-size:.9em}',
    '.tgood-table th,.tgood-table td{padding:6px 8px;border-bottom:1px solid var(--table-row-odd-bg-color,#e7eef0);text-align:right}',
    '.tgood-table th:first-child,.tgood-table td:first-child{text-align:left}',
    '.tgood-table thead th{font-weight:600;opacity:.75;font-size:.92em}',
    '.tgood-total{font-weight:700;color:#1b4d3e}',
    '.tgood-note{margin-top:8px;font-size:.8em;opacity:.62;line-height:1.5}',
    '@media (prefers-color-scheme:dark){.tgood-badge{background:#7fbf9e;color:#12201a}.tgood-total{color:#7fbf9e}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('tgood-style')) return;
    var s = document.createElement('style');
    s.id = 'tgood-style';
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

  function init() {
    var el = document.getElementById('three-good');
    if (!el) return;
    injectCss();
    var slug = el.getAttribute('data-slug');
    if (!slug) return;

    fetch('/three-good/data/scores.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (doc) {
        var hist = (doc.history || {})[slug] || [];
        if (!hist.length) {
          el.innerHTML = '<div class="tgood-note">三好分析报告尚未生成。</div>';
          return;
        }
        var latest = hist[hist.length - 1];
        // 近三个月快照
        var cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 3);
        var cutoffIso = cutoff.toISOString().slice(0, 10);
        var recent = hist.filter(function (h) { return h.date >= cutoffIso; });
        if (recent.indexOf(latest) === -1) recent.push(latest);

        var cls = { '强烈推荐': '⭐', '推荐': '🟢', '可关注': '🟡', '观望': '🟠',
          '不推荐': '🔴', '远离': '❌' };
        var vt = (cls[latest.verdict] || '') + ' ' + latest.verdict;

        var h = '<div class="tgood"><div class="tgood-head">' +
          '<span class="tgood-title">三好投资法则分析</span>' +
          '<span class="tgood-badge">综合 <span class="tv">' + fmt(latest.scores.total) + '</span> / 100 · ' + esc(vt) + '</span>' +
          '<span class="tgood-date">更新于 ' + esc(latest.date) + '</span>' +
          '<a class="tgood-link" href="/three-good/' + encodeURIComponent(slug) + '/">阅读最新报告 →</a>' +
          '</div>';

        if (recent.length > 0) {
          h += '<table class="tgood-table"><thead><tr>' +
            '<th>日期</th><th>综合</th><th>行业</th><th>公司</th><th>价格</th><th>结论</th></tr></thead><tbody>';
          recent.forEach(function (r) {
            var c = cls[r.verdict] || '';
            var isLatest = r === latest;
            h += '<tr>' +
              '<td>' + esc(r.date) + (isLatest ? '（最新）' : '') + '</td>' +
              '<td class="tgood-total">' + fmt(r.scores.total) + '</td>' +
              '<td>' + fmt(r.scores.industry, 0) + '</td>' +
              '<td>' + fmt(r.scores.company) + '</td>' +
              '<td>' + fmt(r.scores.price) + '</td>' +
              '<td>' + esc(c) + ' ' + esc(r.verdict) + '</td></tr>';
          });
          h += '</tbody></table>';
        }
        h += '<div class="tgood-note">三好 = 好行业×好公司×好价格（邱国鹭《投资中最简单的事》），' +
          '综合分 = 行业×30% + 公司×35% + 价格×25% + 定价权调整，每周四收盘后自动评分。</div>';
        el.innerHTML = h + '</div>';
      })
      .catch(function () {
        el.innerHTML = '<div class="tgood-note">三好分析数据加载失败。</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
