/**
 * 首页右侧数据栏（P0-2）
 * ------------------------------------------------------------------
 * 仅在首页（.main-inner.index）注入右栏，含两个模块：
 *   1. 股票池速览：读 /stocks/data/overview.json（由 export_overview.py 每日生成）
 *      ——只取「低估」（PE 十年分位 ≤20%，不足 5 只时逐级放宽到 30%/40%，仍不足则
 *      全池兜底）里三好综合分最高的 5 只；行内显示最新价、当日涨跌（红涨绿跌）、
 *      评分与 PE 分位，整行点击进个股页。
 *   2. 三好评分榜：读 /three-good/data/scores.json 的 history，取各股最新一期
 *      综合分 TOP5 + 评级徽章。
 * 数据取不到时不渲染（右栏消失，正文回到单栏，不影响阅读）。
 * 布局由 styles.styl 的 .clivia-rail 规则控制（≥1200px 并排，窄屏隐藏）。
 */

(function () {
  var inner = document.querySelector('.main-inner.index');
  if (!inner) return; // 仅首页

  // 挂载点必须是 .main（.main-inner 的父级），右栏作为正文卡片的兄弟节点参与 flex 三栏。
  // 早前挂在 .main-inner 内部并用绝对定位，结果：①白卡背景铺到右栏底下，两者视觉连成一片；
  // ②留位用的 padding-right:320px 被后面的 `padding: 4px 20px 10px` 覆盖，右栏直接压住正文。
  var host = inner.parentNode;
  if (!host) return;

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
  // 结构：aside.clivia-rail（.main 的第三个 flex 子项，与正文卡片之间留 12px 间隙）
  //        └─ div.clivia-rail-sticky（sticky 吸顶 + 限高内滚）
  //           └─ 两个卡片 section
  var rail = document.createElement('aside');
  rail.className = 'clivia-rail';
  rail.setAttribute('aria-label', '股票数据速览');
  rail.innerHTML =
    '<div class="clivia-rail-sticky">' +
      '<section class="clivia-rail-card" data-card="pool">' +
        '<h3 class="clivia-rail-title">低估优选 TOP5<span class="clivia-rail-meta">加载中…</span></h3>' +
        '<div class="clivia-rail-body"><p class="clivia-rail-empty">加载中…</p></div>' +
      '</section>' +
      '<section class="clivia-rail-card" data-card="rank">' +
        '<h3 class="clivia-rail-title">三好评分榜<span class="clivia-rail-meta">加载中…</span></h3>' +
        '<div class="clivia-rail-body"><p class="clivia-rail-empty">加载中…</p></div>' +
      '</section>' +
    '</div>';
  host.appendChild(rail);

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

  // ---------- 模块 1：股票池速览（低估 + 高分 TOP5） ----------
  var TOP_N = 5;
  var LOW_STEPS = [20, 30, 40]; // 低估阈值：PE 十年分位，逐级放宽兜底

  function hasNum(v) { return v !== null && v !== undefined; }

  /**
   * 先按 PE 十年分位筛出低估股，再按三好综合分降序取前 5。
   * 低估不足 5 只时阈值逐级放宽（20→30→40），仍不足则用全池评分前 5 兜底。
   * 返回 { list, threshold }，threshold 为 null 表示走了兜底。
   */
  function pickLowHighScore(stocks) {
    var scored = stocks.filter(function (s) { return hasNum(s.score); });
    var byScore = function (a, b) { return b.score - a.score; };

    for (var i = 0; i < LOW_STEPS.length; i++) {
      var th = LOW_STEPS[i];
      var cand = scored.filter(function (s) { return hasNum(s.pe_pct) && s.pe_pct <= th; });
      cand.sort(byScore);
      if (cand.length >= TOP_N) return { list: cand.slice(0, TOP_N), threshold: th };
      if (i === LOW_STEPS.length - 1 && cand.length > 0) {
        return { list: cand.slice(0, TOP_N), threshold: th };
      }
    }
    return { list: scored.slice().sort(byScore).slice(0, TOP_N), threshold: null };
  }

  function renderPool(data) {
    var stocks = (data && data.stocks) || [];
    if (!stocks.length) { fail(poolBody, '暂无数据'); return; }

    poolMeta.textContent = '更新 ' + (data.updated || '—');

    var picked = pickLowHighScore(stocks);
    var rows = picked.list;
    if (!rows.length) { fail(poolBody, '暂无数据'); return; }

    var tip = picked.threshold === null
      ? '评分最高 5 只'
      : '低估（PE 分位 ≤' + picked.threshold + '%）中评分最高 ' + rows.length + ' 只';

    var html = '<table class="clivia-pool"><tbody>';
    rows.forEach(function (s, i) {
      var chg = s.change_pct;
      var cls = (chg === null || chg === undefined) ? '' : (chg > 0 ? 'up' : (chg < 0 ? 'down' : ''));
      var sign = (chg !== null && chg !== undefined && chg > 0) ? '+' : '';
      html += '<tr class="clivia-pool-row">' +
        '<td class="pool-no">' + (i + 1) + '</td>' +
        '<td class="pool-main">' +
          '<a class="pool-name" href="/stocks/' + esc(s.slug) + '/">' + esc(s.name) + '</a>' +
          '<span class="pool-sub">评分 ' + fmt(s.score, 1) + ' · PE 分位 ' +
            pctText(s.pe_pct) + ' ' + valuationTag(s.pe_pct) + '</span>' +
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
      '<span class="rail-tip">' + esc(tip) + '</span></p>';
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
