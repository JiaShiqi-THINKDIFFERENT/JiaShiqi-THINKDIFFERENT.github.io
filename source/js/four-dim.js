/**
 * CLIVIA 四维度分析展示组件（《雪球股票投资 24 章》框架：宏观 / 中观 / 微观 / 实操）
 * 数据：/four-dim/data/<slug>.json（由 tools/value-analysis/four_dim.py 生成）
 * 用法：在股票页内放置
 *   <div id="four-dim" data-slug="guizhou-maotai"></div>
 *   <script src="/js/four-dim.js" defer></script>
 * 展示：综合评分徽章 + 十二子项评分卡 + 四段分析 + 动作清单 + 风险与跟踪清单
 */
(function () {
  'use strict';

  var VERDICT_COLOR = {
    '推荐': '#1b4d3e',
    '可关注': '#2f7d63',
    '观望': '#8a8f8c',
    '不推荐': '#b3594f'
  };

  var CSS = [
    '.fdim{margin:1.2em 0 1.6em;border:1px solid var(--table-row-odd-bg-color,#e7eef0);border-radius:8px;padding:16px 18px;background:var(--sidebar-background,#fafbfa)}',
    '.fdim-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:10px}',
    '.fdim-title{font-weight:700;font-size:1.02em}',
    '.fdim-badge{display:inline-block;padding:2px 12px;border-radius:12px;font-size:.9em;color:#fff;white-space:nowrap}',
    '.fdim-badge .fv{font-weight:700}',
    '.fdim-meta{opacity:.62;font-size:.82em}',
    '.fdim-lead{margin:.4em 0 1em;line-height:1.75;font-size:.94em}',
    '.fdim-table{width:100%;border-collapse:collapse;font-size:.88em;margin-bottom:.6em}',
    '.fdim-table th,.fdim-table td{padding:6px 8px;border-bottom:1px solid var(--table-row-odd-bg-color,#e7eef0);text-align:left;vertical-align:top;line-height:1.6}',
    '.fdim-table thead th{font-weight:600;opacity:.72;font-size:.94em}',
    '.fdim-table td.fd-s{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.fdim-dim{font-weight:600;white-space:nowrap}',
    '.fdim-dim .fd-dimscore{display:block;font-weight:400;opacity:.62;font-size:.92em}',
    '.fdim-ev{opacity:.82}',
    '.fdim h4{margin:1.1em 0 .4em;font-size:.96em;font-weight:700}',
    '.fdim p{margin:.3em 0;line-height:1.8;font-size:.92em;opacity:.92}',
    '.fdim-act{width:100%;border-collapse:collapse;font-size:.88em;margin-top:.4em}',
    '.fdim-act th,.fdim-act td{padding:5px 8px;border-bottom:1px solid var(--table-row-odd-bg-color,#e7eef0);text-align:left}',
    '.fdim-act thead th{font-weight:600;opacity:.72;font-size:.94em}',
    '.fdim-act td:last-child{text-align:right;white-space:nowrap}',
    '.fdim-cols{display:flex;flex-wrap:wrap;gap:0 28px;margin-top:.4em}',
    '.fdim-cols>div{flex:1 1 260px;min-width:240px}',
    '.fdim ul{margin:.2em 0;padding-left:1.3em;font-size:.9em;line-height:1.75;opacity:.9}',
    '.fdim li{margin:.15em 0}',
    '.fdim-note{margin-top:12px;font-size:.78em;opacity:.6;line-height:1.6}',
    '.fdim-loading,.fdim-empty{font-size:.9em;opacity:.6;padding:6px 0}',
    '@media (prefers-color-scheme:dark){.fdim-badge{color:#12201a}}'
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

  var DIM_LABEL = {
    macro: ['宏观', '周期定位'],
    industry: ['中观', '行业供需'],
    company: ['微观', '公司质地'],
    action: ['实操', '匹配与执行']
  };
  var SEC_TITLE = {
    macro: '一、宏观：处在周期的哪一段',
    industry: '二、中观：行业周期的本质是供需错配',
    company: '三、微观：没有一家公司是完美的',
    action: '四、实操：认清自己，再选武器'
  };

  function renderCard(dims) {
    var order = ['macro', 'industry', 'company', 'action'];
    var html = '<table class="fdim-table"><thead><tr>' +
      '<th>维度</th><th>子项</th><th style="text-align:right">得分</th><th>依据</th>' +
      '</tr></thead><tbody>';
    order.forEach(function (k) {
      var d = dims[k];
      if (!d) return;
      var lab = DIM_LABEL[k] || [k, ''];
      d.items.forEach(function (it, i) {
        html += '<tr>';
        if (i === 0) {
          html += '<td class="fdim-dim" rowspan="' + d.items.length + '">' + esc(lab[0]) +
            '<span class="fd-dimscore">' + esc(lab[1]) + ' ' + fmt(d.score) + '/' + d.max + '</span></td>';
        }
        html += '<td>' + esc(it.k) + '</td>' +
          '<td class="fd-s">' + fmt(it.s) + '<span style="opacity:.5">/' + it.m + '</span></td>' +
          '<td class="fdim-ev">' + esc(it.ev) + '</td></tr>';
      });
    });
    return html + '</tbody></table>';
  }

  function renderActions(rows) {
    if (!rows || !rows.length) return '';
    var html = '<h4>五、动作清单（具体数字）</h4><table class="fdim-act"><thead><tr>' +
      '<th>动作</th><th>触发条件</th><th style="text-align:right">比例</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + esc(r.action) + '</td><td>' + esc(r.trigger) +
        '</td><td>' + esc(r.ratio) + '</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function renderLists(d) {
    var risks = (d.risks || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var track = (d.track || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    return '<div class="fdim-cols">' +
      '<div><h4>风险清单</h4><ul>' + risks + '</ul></div>' +
      '<div><h4>跟踪清单</h4><ul>' + track + '</ul></div></div>';
  }

  function render(d) {
    var color = VERDICT_COLOR[d.verdict] || '#1b4d3e';
    var html = '<div class="fdim-head">' +
      '<span class="fdim-title">四维度分析</span>' +
      '<span class="fdim-badge" style="background:' + color + '">' +
      '<span class="fv">' + fmt(d.total) + '</span> / 100 · ' + esc(d.verdict) + '</span>' +
      '<span class="fdim-meta">数据截至 ' + esc(d.as_of) + ' · ' + esc(d.metric) +
      ' 口径 · ' + esc(d.style) + '风格 · 宏观环境截至 ' + esc(d.macro_as_of) + '</span></div>';

    html += '<p class="fdim-lead">' + esc(d.conclusion) + '</p>';
    html += renderCard(d.dims);

    ['macro', 'industry', 'company', 'action'].forEach(function (k) {
      var sec = (d.sections || {})[k];
      if (!sec || !sec.length) return;
      html += '<h4>' + esc(SEC_TITLE[k]) + '</h4>';
      sec.forEach(function (p) { html += '<p>' + esc(p) + '</p>'; });
    });

    html += renderActions(d.action_rows);
    html += renderLists(d);
    html += '<p class="fdim-note">框架源自《雪球股票投资 24 章》四篇结构；' +
      '评分由本地数据仓库与公开财报数据自动生成，画像默认「' + esc(d.profile) + '」' +
      (d.price_basis === 'raw' ? '；区间收益为不复权口径，不含分红' : '') +
      '。本文为方法论演示与信息整理，不构成任何投资建议。</p>';
    return html;
  }

  function init() {
    var el = document.getElementById('four-dim');
    if (!el) return;
    injectCss();
    var slug = el.getAttribute('data-slug');
    if (!slug) return;
    el.innerHTML = '<div class="fdim-loading">四维度分析加载中…</div>';

    fetch('/four-dim/data/' + encodeURIComponent(slug) + '.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { el.innerHTML = render(d); })
      .catch(function (e) {
        el.innerHTML = '<div class="fdim-empty">四维度分析报告尚未生成（' + esc(e.message) + '）。</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
