/**
 * 三好评分总览页（/three-good/）
 * ------------------------------------------------------------------
 * 读取 /three-good/data/scores.json，渲染"最新一期评分榜"（按综合分降序）。
 * 取数失败时保持空白，页面下方的静态报告表格仍可正常导航。
 */

(function () {
  var el = document.getElementById('three-good-index');
  if (!el) return;

  fetch('/three-good/data/scores.json', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error(res.status)); })
    .then(function (data) {
      var history = data.history || {};
      var stocks = data.stocks || {};
      var rows = Object.keys(history).map(function (slug) {
        var arr = history[slug];
        if (!arr || !arr.length) return null;
        var last = arr[arr.length - 1];
        var s = last.scores || {};
        return {
          slug: slug,
          name: (stocks[slug] && stocks[slug].name) || last.name || slug,
          symbol: (stocks[slug] && stocks[slug].symbol) || last.symbol || '',
          date: last.date || '',
          total: typeof s.total === 'number' ? s.total : null,
          industry: s.industry,
          company: s.company,
          price: s.price,
          verdict: last.verdict || ''
        };
      }).filter(function (r) { return r && r.total !== null; });

      if (!rows.length) return;
      rows.sort(function (a, b) { return b.total - a.total; });

      var num = function (v) { return typeof v === 'number' ? v.toFixed(1) : '—'; };
      var html = '<h2>最新一期评分榜（' + rows[0].date + '）</h2>';
      html += '<table><thead><tr><th>个股</th><th>综合</th><th>行业</th><th>公司</th><th>价格</th><th>结论</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr>' +
          '<td><a href="/three-good/' + r.slug + '/">' + r.name + '</a>' +
          (r.symbol ? ' <span style="opacity:.6">(' + r.symbol + ')</span>' : '') + '</td>' +
          '<td><strong>' + r.total.toFixed(1) + '</strong></td>' +
          '<td>' + num(r.industry) + '</td>' +
          '<td>' + num(r.company) + '</td>' +
          '<td>' + num(r.price) + '</td>' +
          '<td>' + r.verdict + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    })
    .catch(function () {
      // 取数失败：不渲染评分榜，静态报告表格已足够导航
    });
})();
