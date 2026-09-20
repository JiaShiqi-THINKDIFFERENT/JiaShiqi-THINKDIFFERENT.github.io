/**
 * 自动摘要（Auto Excerpt）
 * ------------------------------------------------------------------
 * 目标：首页 / 归档页 / 分类页等列表页的文章卡片，只显示标题 + 正文前 200 个
 * 可见字符（"可见字符" = 去掉 Markdown 标记、HTML 标签、行内代码围栏后的正文
 * 字数）；点进文章页仍是完整正文。
 *
 * 原理：在 before_post_render 阶段，给没有手写 `<!-- more -->` 的文章自动补
 * 一个分隔标记。Hexo 后续的 after_post_render/excerpt.js 会据此切出
 * post.excerpt 与 post.more，NexT 模板据此渲染摘要 + "阅读全文"按钮。
 *
 * 优先级 9：早于 Hexo 默认的 10（如 backtick_code_block），保证处理到的仍是
 * 原始 Markdown 文本。
 */

const MORE_TAG = '<!-- more -->';
const MORE_RE = /<!--\s*more\s*-->/i;
// 摘要可见字符数（卡片信息密度 P0-3：由 200 收紧到 110，配合 CSS 行数限制，
// 列表页呈现"标题 + 两行摘要"的紧凑卡片；如需恢复长摘要改回 200 即可）
const LIMIT = 110;
const TOLERANCE = 40; // 允许超出/不足的字数；超出较多时才在段落内部截断

/**
 * 扫描 Markdown 片段，返回第 `target` 个可见字符对应的原串下标。
 * 会跳过：标题符 #、引用符 >、列表符 -、水平分割线、代码块、行内代码、
 *        HTML 标签、图片、链接的 URL 部分、转义符与所有空白。
 * target 传 Infinity 时返回可见字符总数。
 */
function scanTo(raw, target) {
  const n = raw.length;
  let acc = 0;
  let i = 0;
  while (i < n) {
    if (acc >= target) break;
    const prev = i === 0 ? '\n' : raw[i - 1];
    const rest = raw.slice(i);
    let m;

    // 行首结构符号（标题 / 引用 / 列表 / 分割线）
    if (prev === '\n') {
      if ((m = /^ {0,3}#{1,6}[ \t]+/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^ {0,3}>[ \t]?/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+/.exec(rest))) { i += m[0].length; continue; }
      if ((m = /^ {0,3}([-*_][ \t]*){3,}(\r?\n|$)/.exec(rest))) { i += m[0].length; continue; }
    }
    const ch = raw[i];
    // 空白不计字数
    if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue; }
    // 转义字符
    if (ch === '\\' && i + 1 < n) { acc += 1; i += 2; continue; }
    // 行内代码
    if (ch === '`') {
      if ((m = /^(`+)([\s\S]*?)\1/.exec(rest))) { acc += countVisible(m[2]); i += m[0].length; continue; }
    }
    // HTML 标签
    if (ch === '<') {
      if ((m = /^<[^>]*>/.exec(rest))) { i += m[0].length; continue; }
    }
    // 图片 ![alt](url)
    if (ch === '!' && raw[i + 1] === '[') {
      if ((m = /^!\[[^\]]*\]\([^)]*\)\s*/.exec(rest))) { i += m[0].length; continue; }
    }
    // 链接 [text](url)
    if (ch === '[') {
      if ((m = /^\[([^\]]*)\]\([^)]*\)/.exec(rest))) { acc += countVisible(m[1]); i += m[0].length; continue; }
    }
    // 强调符号
    if (ch === '*' || ch === '_' || ch === '~') {
      if ((m = /^[*_~]+/.exec(rest))) { i += m[0].length; continue; }
    }
    acc += 1;
    i += 1;
  }
  return acc >= target ? i : -1;
}

function countVisible(raw) {
  return countAll(raw);
}

function countAll(raw) {
  const stripped = raw
    .replace(/\r\n/g, '\n')
    .replace(/^ {0,3}([-*_][ \t]*){3,}[ \t]*$/gm, '')                          // 水平分割线
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '') // 表格分隔行
    .replace(/\\(.)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\|/g, '') // 表格单元格分隔线
    .replace(/[*_~]/g, '')
    .replace(/^ {0,3}(#{1,6}\s+|>\s?|([-*+]|\d{1,9}[.)])\s+)/gm, '')
    .replace(/\s+/g, '')
    .trim();
  return stripped.length;
}

/**
 * 行内截断：在片段内定位第 `target` 个可见字符，并优先延伸到最近的
 * 句末标点之后，避免把句子切成半截。返回原串下标。
 */
function cutIndex(raw, target) {
  let idx = scanTo(raw, target);
  if (idx < 0) idx = raw.length;
  if (target <= 0) return Math.max(idx, 0);

  const window = raw.slice(idx, idx + 80);
  const punct = /[。！？!?]/;
  let best = -1;
  for (let k = 0; k < window.length; k++) {
    const c = window[k];
    // 遇到换行（新段落/新列表项）或 Markdown 结构符就不再往后找
    if (c === '\n' || c === '`' || c === '<' || c === '[') break;
    if (punct.test(c)) { best = k + 1; break; }
  }
  return best > -1 ? idx + best : idx;
}

/**
 * 把正文切成"块"：围栏代码块整体一块，其余按空行分段；尾部空行保留在块内，
 * 保证 join('\n') 可无损还原原文。
 */
function splitBlocks(raw) {
  const lines = raw.split('\n');
  const blocks = [];
  let cur = [];
  let fence = null;
  const flush = code => {
    if (cur.length) { blocks.push({ text: cur.join('\n'), code }); cur = []; }
  };
  for (const line of lines) {
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const mark = fm[1][0];
      if (fence === null) { flush(false); fence = mark; cur.push(line); continue; }
      if (mark === fence) { cur.push(line); flush(true); fence = null; continue; }
    }
    if (fence === null && line.trim() === '') { cur.push(line); flush(false); continue; }
    cur.push(line);
  }
  flush(fence !== null);
  return blocks;
}

/** 标题块（# / setext 形式）不参与计数，也不适合作为摘要的结尾。 */
function isHeading(text) {
  return /^ {0,3}#{1,6}[ \t]+/.test(text.trim()) || /^.+\n[ \t]*(=+|-{3,})[ \t]*$/.test(text.trim());
}

/** 给正文插入摘要分隔标记；无需插入时返回 null。 */
function insertMoreTag(raw) {
  const blocks = splitBlocks(raw);

  // 第一步：决定切割位置——取"最接近 LIMIT 字数"的那个块边界
  let acc = 0;
  let cut = -1;        // 摘要截止到此块（含）
  let lastTextIdx = -1; // 上一个计入字数的块
  let inline = false;  // 是否需要在块内部截断

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // 代码块不进摘要：若前面已有正文，就在代码块之前收尾
    if (block.code) {
      if (lastTextIdx > -1 && acc >= LIMIT * 0.4) { cut = lastTextIdx; break; }
      continue;
    }
    const len = countVisible(block.text);
    if (len === 0) continue;
    // 标题会显示在摘要里，字数照计，但不作为切点（避免摘要以标题收尾）
    if (isHeading(block.text)) { acc += len; continue; }

    if (acc + len >= LIMIT) {
      // 三种候选落点：A 上一块之后（acc 字）、B 本块之后（acc+len 字）、
      // C 本块内部截断（正好 LIMIT 字）。A/B 与 LIMIT 差距不大时优先用它们，
      // 避免把段落切成半截；差距过大才启用 C。
      const diffA = lastTextIdx > -1 ? Math.abs(acc - LIMIT) : Infinity;
      const diffB = Math.abs(acc + len - LIMIT);
      const isTable = /^\s*\|/.test(block.text.trim());

      if (lastTextIdx > -1 && diffA <= TOLERANCE && diffA <= diffB) {
        cut = lastTextIdx;
      } else if (diffB <= TOLERANCE) {
        cut = i;
      } else if (isTable) {
        cut = diffA <= diffB ? Math.max(lastTextIdx, 0) : i;
      } else {
        cut = i;
        inline = true;
      }
      break;
    }
    acc += len;
    lastTextIdx = i;
  }

  if (process.env.AE_DEBUG) {
    // 调试：node 运行 hexo generate 前设 AE_DEBUG=1，可观察每个块的字数与切点
    blocks.forEach((b, i) => {
      console.log(`[auto-excerpt] #${i} code=${b.code} head=${isHeading(b.text)} len=${countVisible(b.text)} :: ${b.text.slice(0, 30).replace(/\n/g, '\\n')}`);
    });
    console.log(`[auto-excerpt] cut=${cut} inline=${inline} acc=${acc}`);
  }

  if (cut < 0) return null; // 全文不足 LIMIT 字，无需截断

  // 摘要不应以标题收尾
  while (cut > 0 && isHeading(blocks[cut].text)) cut -= 1;

  // 第二步：重建正文
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i === cut && inline) {
      const idx = cutIndex(blocks[i].text, LIMIT - acc);
      const head = blocks[i].text.slice(0, idx).replace(/\s+$/, '');
      const tail = blocks[i].text.slice(idx).replace(/^\s+/, '');
      out.push(`${head}\n\n${MORE_TAG}\n\n${tail}`);
      continue;
    }
    out.push(blocks[i].text);
    if (i === cut) out.push(`\n${MORE_TAG}\n`);
  }
  return out.join('\n');
}

hexo.extend.filter.register('before_post_render', data => {
  // 仅处理文章（layout 为空时按来源目录判断）
  const source = String(data.source || '');
  const isPost = data.layout === 'post' || (data.layout !== 'page' && source.startsWith('_posts'));
  if (!isPost) return data;

  // 已手写 <!-- more -->（代码块里的示例文本不算），或已指定 excerpt / description
  const hasManualMore = splitBlocks(data.content)
    .some(b => !b.code && MORE_RE.test(b.text.replace(/`[^`\n]*`/g, ''))); // 忽略行内代码里的示例文本
  if (hasManualMore) return data;
  if (data.excerpt || data.description) return data;

  const next = insertMoreTag(data.content);
  if (next) data.content = next;
  return data;
}, 9);
