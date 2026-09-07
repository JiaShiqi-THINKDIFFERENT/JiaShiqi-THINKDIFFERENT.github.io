---
title: 用 Markdown 写一篇带代码的文章示例
date: 2026-09-07 11:30:00
categories:
  - 技术
tags:
  - Markdown
  - 示例
---

这是一篇用于展示 NexT 主题排版效果的示例文章，涵盖了标题层级、列表、引用、表格与代码块。

## 二级标题

### 三级标题

- 列表项一
- 列表项二
  - 嵌套项

1. 有序列表一
2. 有序列表二

> 这是一段引用文字，用于展示引用块样式。

## 表格示例

| 功能 | 说明 |
| ---- | ---- |
| 分类 | 用 categories 对文章归类 |
| 标签 | 用 tags 添加多组关键词 |
| 目录 | 侧边栏自动生成 TOC |

## 代码块示例

```javascript
// 一个简单的函数
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet('NexT'));
```

```bash
hexo new post "示例文章"
hexo server
```

## 图片示例

图片可放在 `source/images/` 目录，然后这样引用：

```markdown
![示例图片](/images/example.png)
```

正文结束后，NexT 会显示标签、上一篇/下一篇、相关文章等模块。左侧侧边栏（若展开）会显示目录导航。
