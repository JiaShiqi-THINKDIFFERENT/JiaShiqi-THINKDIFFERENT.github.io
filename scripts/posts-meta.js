/**
 * 生成 posts-meta.json（P0-3 卡片信息密度的数据源）
 * ------------------------------------------------------------------
 * 用途：首页 / 归档 / 分类 / 标签页的文章卡片需要展示「阅读时长、字数、
 * 标签、封面图」。这些信息无法通过纯前端从已渲染的 HTML 稳定获取
 * （封面、准确字数都在 front-matter / 原文里），因此在此统一导出一份
 * 精简 JSON，由 source/js/post-meta-extra.js 按链接匹配后注入卡片。
 *
 * 输出：/posts-meta.json
 * 字段：path(站内绝对路径) / title / date / categories / tags
 *      / cover / words / minutes
 *
 * 新增文章无需任何手工登记，构建时自动收录。
 */

const READ_SPEED = 300; // 中文阅读速度：字/分钟

/** 统计正文可见字数：中文按字符计，西文按单词计。 */
function countWords(html) {
  if (!html) return 0;
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ')
    .match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
  return cjk + words;
}

/** 取 front-matter 字段：Hexo 把未知字段挂在 post 对象上。 */
function pick(post, keys) {
  for (const k of keys) {
    if (post[k] != null && post[k] !== '') return post[k];
  }
  return null;
}

/**
 * 取 Category / Tag 名称列表。
 * Hexo 里 post.categories / post.tags 是 Warehouse 的 Query 对象：
 * 优先用 forEach（元素是带 name 的模型），退化路径再试 toArray / Array.from。
 */
function toList(v) {
  if (!v) return [];
  const out = [];
  const push = x => {
    if (x == null) return;
    const name = typeof x === 'string' ? x : x.name;
    if (name) out.push(String(name));
  };

  if (Array.isArray(v)) {
    v.forEach(push);
    return out;
  }
  try {
    if (typeof v.forEach === 'function') {
      v.forEach(push);
      if (out.length) return out;
    }
  } catch (e) { /* 继续尝试其他方式 */ }
  try {
    const arr = typeof v.toArray === 'function' ? v.toArray() : Array.from(v);
    arr.forEach(push);
  } catch (e) { /* 忽略 */ }
  return out;
}

/** 文章 permalink → 站内绝对路径；拿不到时由 path 兜底。 */
function postUrl(post) {
  const direct = post.permalink || post.url;
  if (direct) {
    return String(direct).replace(/^https?:\/\/[^/]+/, '');
  }
  try {
    return String(hexo.url_for(post.path)).replace(/^https?:\/\/[^/]+/, '');
  } catch (e) {
    return '/' + String(post.path || '').replace(/^\/+/, '').replace(/index\.html$/, '');
  }
}

hexo.extend.generator.register('posts-meta', function (locals) {
  const posts = (locals.posts && locals.posts.data) ? locals.posts.data : [];
  const items = posts.map(post => {
    const words = countWords(post.content || post._content || '');
    return {
      path: '/' + String(post.path || '').replace(/^\/+/, ''),
      url: postUrl(post),
      title: post.title || '',
      date: post.date ? new Date(post.date).toISOString().slice(0, 10) : null,
      categories: toList(post.categories),
      tags: toList(post.tags),
      cover: pick(post, ['cover', 'thumbnail', 'photo']),
      words: words,
      minutes: Math.max(1, Math.round(words / READ_SPEED))
    };
  });

  return {
    path: 'posts-meta.json',
    data: JSON.stringify({ updated: new Date().toISOString().slice(0, 10), count: items.length, posts: items })
  };
});
