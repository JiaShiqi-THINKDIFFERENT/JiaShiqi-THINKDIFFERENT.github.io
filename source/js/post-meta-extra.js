/**
 * 文章卡片信息密度增强（P0-3）
 * ------------------------------------------------------------------
 * 数据来源：/posts-meta.json（由 scripts/posts-meta.js 构建时生成）
 *
 * 在首页 / 归档 / 分类 / 标签等列表页为每张卡片补充：
 *   1. 元信息行追加「约 N 分钟读完」「N 字」
 *   2. 摘要下方补标签 chip（文章页仍用主题自带的底部标签，不重复）
 *   3. front-matter 写了 cover 的文章，卡片右侧显示缩略图（无封面不占位）
 *
 * 降级：JSON 取不到或页面不是列表页时静默跳过，卡片保持原样。
 */
(function () {
  var LIST_PAGES = ['index', 'archive', 'category', 'tag'];
  var mainInner = document.querySelector('.main-inner');
  if (!mainInner) return;

  var isList = LIST_PAGES.some(function (c) {
    return mainInner.classList.contains(c);
  });
  if (!isList) return;

  var blocks = document.querySelectorAll('.post-block');
  if (!blocks.length) return;

  /** 卡片链接 → 与 posts-meta.json 的 url 字段比对 */
  function cardPath(block) {
    var a = block.querySelector('a.post-title-link');
    if (!a) return null;
    var href = a.getAttribute('href') || '';
    // 归一化：去掉协议域名、末尾 index.html
    href = href.replace(/^https?:\/\/[^/]+/, '');
    href = href.replace(/index\.html$/, '');
    return href.replace(/\/+/g, '/');
  }

  function normalized(u) {
    return String(u || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\/+/g, '/');
  }

  fetch('/posts-meta.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var map = {};
      (data.posts || []).forEach(function (p) {
        var u = normalized(p.url || p.path);
        map[u] = p;
        map[u.replace(/\/$/, '')] = p;
      });

      Array.prototype.forEach.call(blocks, function (block) {
        var key = cardPath(block);
        var meta = key && (map[key] || map[key.replace(/\/$/, '')]);
        if (!meta) return;

        // ---------- 1. 元信息行：阅读时长 + 字数 ----------
        var metaRow = block.querySelector('.post-meta');
        if (metaRow && meta.minutes) {
          var span = document.createElement('span');
          span.className = 'post-meta-item clivia-meta-extra';
          span.innerHTML =
            '<span class="post-meta-item-icon"><i class="far fa-clock"></i></span>' +
            '<span class="post-meta-item-text">约 ' + meta.minutes + ' 分钟</span>';
          metaRow.appendChild(span);

          if (meta.words) {
            var w = document.createElement('span');
            w.className = 'post-meta-item clivia-meta-extra';
            w.innerHTML =
              '<span class="post-meta-item-icon"><i class="far fa-file-word"></i></span>' +
              '<span class="post-meta-item-text">' + meta.words + ' 字</span>';
            metaRow.appendChild(w);
          }
        }

        // ---------- 2. 标签 chip ----------
        var body = block.querySelector('.post-body');
        if (body && meta.tags && meta.tags.length) {
          var tags = document.createElement('div');
          tags.className = 'clivia-card-tags';
          meta.tags.forEach(function (t) {
            var chip = document.createElement('a');
            chip.className = 'clivia-tag-chip';
            chip.href = '/tags/' + encodeURIComponent(t) + '/';
            chip.textContent = t;
            tags.appendChild(chip);
          });
          var btn = body.querySelector('.post-button');
          if (btn) {
            body.insertBefore(tags, btn);
          } else {
            body.appendChild(tags);
          }
        }

        // ---------- 3. 封面缩略图 ----------
        // 已停用：列表页不再展示封面图（用户要求只留纯文字条目）。
        // 若日后想恢复，取消下面注释并把 styles.styl 里 .clivia-card-thumb /
        // .post-block.has-cover 的布局规则一起加回来。
        // if (meta.cover && body) {
        //   var img = document.createElement('img');
        //   img.className = 'clivia-card-thumb';
        //   img.src = meta.cover;
        //   img.alt = meta.title || '';
        //   img.loading = 'lazy';
        //   body.insertBefore(img, body.firstChild);
        //   block.classList.add('has-cover');
        // }
      });
    })
    .catch(function () { /* 静默降级 */ });
})();
