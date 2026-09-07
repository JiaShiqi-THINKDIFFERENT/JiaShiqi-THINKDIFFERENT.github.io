# hexo-blog

基于 [Hexo](https://hexo.io/) 的个人博客源码工程，使用 [NexT](https://theme-next.js.org/) 主题。

线上站点：<https://jiashiqi-thinkdifferent.github.io>

## 分支结构

| 分支 | 内容 |
| ---- | ---- |
| `main` | Hexo 构建产物（即 GitHub Pages 发布的站点） |
| `source` | 本目录（Hexo 源码工程：文章、主题、配置） |

## 常用命令

```bash
# 本地预览（http://localhost:4000）
npm run server

# 新建文章
npx hexo new "文章标题"

# 本地构建
npm run build        # 等价于 npx hexo generate

# 一键生成并部署到 main（发布站点）
npx hexo clean && npx hexo g && npx hexo d
```

> 部署插件为 hexo-deployer-git，推送目标与仓库在 `_config.yml` 的 `deploy` 段配置。

## 目录速览

```
_config.yml         # 站点主配置（标题、URL、语言、部署目标…）
_config.next.yml    # NexT 主题个性化配置（菜单 / 侧边栏 / 社交链接…）
scaffolds/          # 新建文章模板
source/_posts/      # 文章目录（Markdown）
source/about|tags|categories/   # 对应页面
themes/next/        # NexT 主题（v8.29.0，勿直接改，用 _config.next.yml 覆盖）
public/             # 构建产物（已被 gitignore，不上传）
```

## 日常发布流程

1. `npx hexo new "我的新文章"` 创建文章，编辑 `source/_posts/` 下对应 md；
2. `npm run server` 本地预览效果；
3. `npx hexo clean && npx hexo g && npx hexo d` 生成并推送 `main` 分支；
4. 约 1 分钟内 GitHub Pages 自动更新。

## 常见自定义

- 站点标题/作者：`_config.yml` → `title` / `author`
- 主题方案（Muse/Mist/Pisces/Gemini）与菜单：`_config.next.yml`
- 侧边栏头像：把图片放到 `source/uploads/`，并在 `_config.next.yml` 取消 `avatar` 注释
