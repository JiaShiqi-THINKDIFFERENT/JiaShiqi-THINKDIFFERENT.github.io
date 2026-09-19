/**
 * 顶部导航条交互（P0-1）
 * ------------------------------------------------------------------
 * 1. 当前页高亮：按 pathname 前缀匹配，给对应导航项加 .is-active。
 * 2. 个股下拉：拉取 /three-good/data/scores.json 的 stocks 字段覆盖
 *    header.njk 里的静态兜底列表，新增股票自动出现在导航里。
 * 说明：导航条为 fixed 置顶常驻，无需滚动收窄逻辑。
 */

(function () {
  var navbar = document.querySelector('.clivia-navbar');
  if (!navbar) return;

  // ---------- 1. 当前页高亮 ----------
  var path = location.pathname.replace(/index\.html$/, '');
  var links = navbar.querySelectorAll('.clivia-navbar-menu > li > a');
  Array.prototype.forEach.call(links, function (a) {
    var href = a.getAttribute('href');
    if (!href || href === '/') {
      if (path === '/' || path === '') a.parentNode.classList.add('is-active');
      return;
    }
    if (path === href || path.indexOf(href) === 0) a.parentNode.classList.add('is-active');
  });

  // ---------- 2. 个股下拉动态填充 ----------
  var menu = navbar.querySelector('.clivia-dropdown-menu');
  if (!menu) return;

  fetch('/three-good/data/scores.json', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error(res.status)); })
    .then(function (data) {
      var stocks = data && data.stocks;
      if (!stocks) return;
      var items = Object.keys(stocks).map(function (slug) {
        var s = stocks[slug] || {};
        return '<li><a href="/stocks/' + slug + '/">' + (s.name || slug) + '</a></li>';
      });
      if (!items.length) return;
      menu.innerHTML = items.join('');
    })
    .catch(function () {
      // 取数失败时保留 header.njk 里的静态兜底列表
    });
})();
