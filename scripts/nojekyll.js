'use strict';
// 每次 hexo generate 后，在 public 根目录写入 .nojekyll，
// 避免 GitHub Pages 的 Jekyll 处理干扰纯静态站点。
const fs = require('fs');
const path = require('path');

hexo.extend.filter.register('after_generate', () => {
  const target = path.join(hexo.public_dir, '.nojekyll');
  fs.writeFileSync(target, '');
});
