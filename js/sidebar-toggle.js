/**
 * CLIVIA 左侧栏折叠（参考 CSDN 布局）
 * - 桌面端在品牌区右上角注入折叠按钮；折叠后在视口左缘显示浮出把手重新展开。
 * - 折叠状态写入 localStorage，刷新后保持；并在 <head> 提前应用，避免闪烁。
 * - 移动端（<=991px）由 CSS 隐藏按钮并忽略折叠态，沿用 NexT 自带的抽屉式侧栏。
 */
(function () {
  var STORAGE_KEY = 'clivia-sidebar-collapsed';
  var root = document.documentElement;

  // ---------- 状态读写 ----------
  function isCollapsed() {
    return root.classList.contains('sidebar-collapsed');
  }

  function setCollapsed(collapsed, persist) {
    root.classList.toggle('sidebar-collapsed', collapsed);
    var btn = document.querySelector('.clivia-sidebar-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('title', collapsed ? '展开侧边栏' : '折叠侧边栏');
      btn.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
      } catch (e) {
        /* 隐私模式下 localStorage 不可用，忽略 */
      }
    }
  }

  // ---------- 图标（内联 SVG，避免依赖图标字体） ----------
  var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><polyline points="15 5 8 12 15 19"></polyline></svg>';

  function makeButton(className, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.innerHTML = CHEVRON;
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
    b.setAttribute('aria-controls', 'clivia-sidebar');
    return b;
  }

  function init() {
    var column = document.querySelector('.main > .column');
    var brand = document.querySelector('.site-brand-container');
    if (!column) return;
    column.id = 'clivia-sidebar';

    // 已存在（例如脚本重复执行）则不重复注入
    if (!document.querySelector('.clivia-sidebar-toggle')) {
      var toggle = makeButton('clivia-sidebar-toggle', '折叠侧边栏');
      toggle.addEventListener('click', function () {
        setCollapsed(!isCollapsed(), true);
      });
      (brand || column).appendChild(toggle);
    }

    if (!document.querySelector('.clivia-sidebar-reopen')) {
      var reopen = makeButton('clivia-sidebar-reopen', '展开侧边栏');
      reopen.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
        'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true"><polyline points="9 5 16 12 9 19"></polyline></svg>';
      reopen.addEventListener('click', function () {
        setCollapsed(false, true);
      });
      document.body.appendChild(reopen);
    }

    // 键盘快捷键：[ 折叠/展开（输入框内不触发）
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setCollapsed(!isCollapsed(), true);
      }
    });

    setCollapsed(isCollapsed(), false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
