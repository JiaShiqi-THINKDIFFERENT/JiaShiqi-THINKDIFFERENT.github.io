---
title: 欢迎来到我的博客
date: 2026-09-07 10:00:00
categories:
  - 随笔
tags:
  - Hexo
  - NexT
---

你好，欢迎来到我的博客！这里由 **Hexo** 驱动，使用了 **NexT** 主题，并托管在 GitHub Pages 上。

本站用来记录学习笔记、技术踩坑与生活思考。内容会持续更新，欢迎常来看看。

## 如何发布新文章

在项目根目录执行：

```bash
hexo new "我的新文章"
```

然后编辑 `source/_posts/我的新文章.md` 即可。写完本地预览：

```bash
hexo server   # 浏览器打开 http://localhost:4000
```

确认无误后生成并部署：

```bash
hexo clean && hexo generate
```

部署由 GitHub Actions 自动完成：只要把源码推送到 `main` 分支，站点就会自动重新构建发布。

## 文章 Front-matter 说明

每篇文章开头用 `---` 包裹的部分是元信息：

```yaml
---
title: 文章标题
date: 2026-09-07 10:00:00
categories: [随笔]        # 分类，可多个
tags: [Hexo, NexT]        # 标签，可多个
---
```

正文支持标准 Markdown 语法：**加粗**、*斜体*、`行内代码`、代码块、表格、图片等。

> 提示：正文中插入 `<!-- more -->` 可控制首页列表只显示摘要。

祝写作愉快！
