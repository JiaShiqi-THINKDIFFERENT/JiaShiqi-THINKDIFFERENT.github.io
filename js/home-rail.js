/**
 * 首页右侧数据栏（P0-2）
 * ------------------------------------------------------------------
 * 仅在首页（.main-inner.index）注入右栏，含两个模块：
 *   1. 股票池速览：读 /stocks/data/overview.json（由 export_overview.py 每日生成）
 *      ——最新价、当日涨跌（红涨绿跌）、PE 十年分位、三好综合分，按 PE 分位升序
 *      （越靠前越接近十年低位），整行点击进个股页。
 *   2. 三好评分榜：读 /three-good/data/scores.json 的 history，取各股最新一期
 *      综合分 TOP5 + 评级徽章。
 * 数据取不到时不渲染（右栏消失，正文回到单栏，不影响阅读）。
 * 布局由 styles.styl 的 .clivia-rail 规则控制（≥1200px 并排，窄屏隐藏）。
 */

(function () {
  var inner = document.querySelector('.main-inner.index');
  if (!inner) return; // 仅首页

  var OVERVIEW = '/stocks/data/overview.json';
  var SCORES = '/three-good/data/scores.json';

  // ---------- 小工具 ----------
  function fmt(v, digits) {
    return (v === null || v === undefined) ? '—'
      : Number(v).toFixed(digits === undefined ? 2 : digits);
  }

  function pctText(v) {
    return (v === null || v === undefined) ? '—' : (v + '%');
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 评级徽章配色（与涨跌的红/绿区分：这里只表达「推荐程度」） */
  function verdictClass(v) {
    if (v === '强烈推荐') return 'v-strong';
    if (v === '推荐') return 'v-buy';
    if (v === '可关注') return 'v-watch';
    if (v === '观望') return 'v-hold';
    if (v === '不推荐') return 'v-avoid';
    return 'v-na';
  }

  /** 估值分位 → 文字标签，≤20% 低估(绿)、≥80% 高估(红)，其余中性 */
  function valuationTag(p) {
    if (p === null || p === undefined) return '';
    if (p <= 20) return '<em class="tag-low">低估</em>';
    if (p >= 80) return '<em class="tag-high">高估</em>';
    return '<em class="tag-mid">合理</em>';
  }

  // ---------- 骨架 ----------
  // 结构：aside.clivia-rail（绝对定位于右侧列，不参与行高）
  //        └─ div.clivia-rail-sticky（sticky 吸顶 + 限高内滚）
  //           └─ 两个卡片 section
  // rail 不能直接 sticky：它绝对定位后 sticky 失效，需内层包裹。
  var rail = document.createElement('aside');
  rail.className = 'clivia-rail';
  rail.setAttribute('aria-label', '股票数据速览');
  rail.innerHTML =
    '<div class="clivia-rail-sticky">' +
      '<section class="clivia-rail-card" data-card="pool">' +
        '<h3 class="clivia-rail-title">股票池速览<span class="clivia-rail-meta">加载中…</span></h3>' +
        '<div class="clivia-rail-body"><p class="clivia-rail-empty">加载中…</p></div>' +
      '</section>' +
      '<section class="clivia-rail-card" data-card="rank">' +
        '<h3 class="clivia-rail-title">三好评分榜<span class="clivia-rail-meta">加载中…</span></h3>' +
        '<div class="clivia-rail-body"><p class="clivia-rail-empty">加载中…</p></div>' +
      '</section>' +
    '</div>';
  inner.appendChild(rail);

  var poolBody = rail.querySelector('[data-card="pool"] .clivia-rail-body');
  var poolMeta = rail.querySelector('[data-card="pool"] .clivia-rail-meta');
  var rankBody = rail.querySelector('[data-card="rank"] .clivia-rail-body');
  var rankMeta = rail.querySelector('[data-card="rank"] .clivia-rail-meta');

  function fail(el, msg) {
    if (el) el.innerHTML = '<p class="clivia-rail-empty">' + msg + '</p>';
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); });
  }

  // ---------- 模块 1：股票池速览 ----------
  function renderPool(data) {
    var stocks = (data && data.stocks) || [];
    if (!stocks.length) { fail(poolBody, '暂无数据'); return; }

    poolMeta.textContent = '更新 ' + (data.updated || '—');

    var rows = stocks.slice().sort(function (a, b) {
      var pa = (a.pe_pct === null || a.pe_pct === undefined) ? 999 : a.pe_pct;
      var pb = (b.pe_pct === null || b.pe_pct === undefined) ? 999 : b.pe_pct;
      return pa - pb;
    });

    var html = '<table class="clivia-pool"><tbody>';
    rows.forEach(function (s) {
      var chg = s.change_pct;
      var cls = (chg === null || chg === undefined) ? '' : (chg > 0 ? 'up' : (chg < 0 ? 'down' : ''));
      var sign = (chg !== null && chg !== undefined && chg > 0) ? '+' : '';
      html += '<tr class="clivia-pool-row">' +
        '<td class="pool-main">' +
          '<a class="pool-name" href="/stocks/' + esc(s.slug) + '/">' + esc(s.name) + '</a>' +
          '<span class="pool-sub">PE 分位 ' + pctText(s.pe_pct) + ' ' + valuationTag(s.pe_pct) +
            (s.score ? ' · 评分 ' + fmt(s.score, 1) : '') + '</span>' +
        '</td>' +
        '<td class="pool-num">' +
          '<span class="pool-close">' + fmt(s.close) + '</span>' +
          '<span class="pool-chg ' + cls + '">' + sign + fmt(chg) + '%</span>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    html += '<p class="clivia-rail-foot">' +
      '<a href="/stocks/">股票池总览 →</a>' +
      '<span class="rail-tip">按 PE 十年分位升序</span></p>';
    poolBody.innerHTML = html;
  }

  // ---------- 模块 2：三好评分榜 ----------
  function renderRank(scores) {
    var history = (scores && scores.history) || {};
    var list = Object.keys(history).map(function (slug) {
      var arr = history[slug] || [];
      var last = arr[arr.length - 1] || {};
      return {
        slug: slug,
        name: last.name || slug,
        total: (last.scores && last.scores.total) || null,
        verdict: last.verdict || '',
        date: last.date || ''
      };
    }).filter(function (x) { return x.total !== null; })
      .sort(function (a, b) { return b.total - a.total; })
      .slice(0, 5);

    if (!list.length) { fail(rankBody, '暂无评分'); return; }

    rankMeta.textContent = list[0].date ? ('更新 ' + list[0].date) : '';
    var html = '<ol class="clivia-rank">';
    list.forEach(function (x, i) {
      html += '<li class="clivia-rank-item">' +
        '<span class="rank-no' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</span>' +
        '<span class="rank-name"><a href="/three-good/' + esc(x.slug) + '/">' + esc(x.name) + '</a></span>' +
        '<span class="rank-score">' + fmt(x.total, 1) + '</span>' +
        '<span class="rank-verdict ' + verdictClass(x.verdict) + '">' + esc(x.verdict) + '</span>' +
      '</li>';
    });
    html += '</ol>';
    html += '<p class="clivia-rail-foot"><a href="/three-good/">完整评分榜 →</a>' +
      '<span class="rail-tip">综合分满分 100</span></p>';
    rankBody.innerHTML = html;
  }

  // ---------- 取数 ----------
  fetchJSON(OVERVIEW)
    .then(renderPool)
    .catch(function () { fail(poolBody, '行情数据暂不可用'); });

  fetchJSON(SCORES)
    .then(renderRank)
    .catch(function () { fail(rankBody, '评分数据暂不可用'); });
})();
