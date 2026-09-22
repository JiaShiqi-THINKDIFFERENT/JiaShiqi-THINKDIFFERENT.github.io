#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把分析方法摘要卡统一挂到个股页「研究」章节（幂等，可重复运行）。

约定（个股页展示规范，新增方法必须遵守）
----------------------------------------
1. 所有方法卡片放在同一个 <div class="research-pair"> 容器内，从上到下依次排列，不做左右并列；
   间距由 styles.styl 的 .research-pair（grid + gap 16px）统一控制。
2. 卡片只展示：标题 + 综合分徽章 + 更新日期 + 报告链接 + 得分表 + 一行方法论注脚。
   ★不展示结论长文（"估值层面…行业层面…"那段），结论只在各自的完整报告页出现。
3. 每个方法的渲染脚本用一行 <script src="/js/<name>.js" defer></script> 引入。
4. 新方法登记到 METHODS 后，本脚本可自动完成 32 页挂载。

用法
----
    python tools/value-analysis/attach_research.py                 # 挂载 METHODS 中缺失的方法
    python tools/value-analysis/attach_research.py --block <id> --script /js/<id>.js
    python tools/value-analysis/attach_research.py --list          # 查看各方法已挂载页数
"""
from __future__ import annotations

import argparse
import glob
import io
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAGES = os.path.join(REPO, "source", "stocks", "*", "index.md")

# 已登记的方法：(容器 id, 脚本路径)。新增方法在此追加一行即可。
METHODS = [
    ("three-good", "/js/three-good.js"),
    ("four-dim", "/js/four-dim.js"),
]

HEADING_RE = re.compile(r"(^##\s*研究[^\n]*\n)", re.M)
PAIR_RE = re.compile(
    r'<div class="research-pair">(.*?)</div>\s*\n', re.S)
BLOCK_RE = re.compile(r'^<div id="([a-z0-9-]+)"[^>]*></div>$', re.M)
SCRIPT_RE = re.compile(r'^<script src="(/js/[a-z0-9-]+\.js)"[^>]*></script>$', re.M)


def slug_of(path: str) -> str:
    return os.path.basename(os.path.dirname(path))


def ensure_pair(text: str, slug: str) -> str:
    """确保存在 .research-pair 容器与「研究」章节；返回新文本。"""
    if 'class="research-pair"' in text:
        return text
    # 未出现容器：把已存在的各方法块收拢进容器
    found = BLOCK_RE.findall(text)
    inner = "\n".join(
        '<div id="%s" data-slug="%s"></div>' % (bid, slug) for bid in found) or \
        '<div id="three-good" data-slug="%s"></div>' % slug
    container = '<div class="research-pair">\n%s\n</div>\n' % inner
    # 去掉散落的方法块
    text = BLOCK_RE.sub("", text)
    scripts = "\n".join(
        '<script src="%s" defer></script>' % s for s in SCRIPT_RE.findall(text))
    text = SCRIPT_RE.sub("", text)
    if HEADING_RE.search(text):
        text = HEADING_RE.sub(lambda m: m.group(1) + "\n" + container + "\n" + scripts + "\n", text, count=1)
    else:
        text = text.rstrip() + "\n\n## 研究\n\n" + container + "\n" + scripts + "\n"
    return re.sub(r"\n{3,}", "\n\n", text)


def attach(text: str, slug: str, block_id: str, script: str) -> tuple[str, bool]:
    """把 block_id 插到 research-pair 末尾，并保证脚本引入存在。返回 (新文本, 是否变更)。"""
    changed = False
    text = ensure_pair(text, slug)
    m = PAIR_RE.search(text)
    if not m:
        return text, False
    inner = m.group(1)
    if 'id="%s"' % block_id not in inner:
        inner = inner.rstrip() + '\n<div id="%s" data-slug="%s"></div>' % (block_id, slug)
        text = text[:m.start(1)] + inner + text[m.end(1):]
        changed = True
    if script and ('src="%s"' % script) not in text:
        # 脚本行统一放在容器之后
        anchor = PAIR_RE.search(text)
        pos = anchor.end()
        text = text[:pos] + '\n<script src="%s" defer></script>' % script + text[pos:]
        changed = True
    return re.sub(r"\n{3,}", "\n\n", text), changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--block", help="方法容器 id，如 four-dim")
    ap.add_argument("--script", help="渲染脚本路径，如 /js/four-dim.js")
    ap.add_argument("--list", action="store_true", help="只统计各方法已挂载页数")
    args = ap.parse_args()

    pages = sorted(glob.glob(PAGES))
    if not pages:
        print("未找到个股页", file=sys.stderr)
        return

    if args.list:
        for bid, _ in METHODS:
            n = sum(1 for p in pages if 'id="%s"' % bid in io.open(p, encoding="utf-8").read())
            print("%-12s %d / %d 页" % (bid, n, len(pages)))
        return

    todo = [(args.block, args.script)] if args.block else METHODS
    for block_id, script in todo:
        n = 0
        for p in pages:
            t = io.open(p, encoding="utf-8").read()
            t2, ch = attach(t, slug_of(p), block_id, script)
            if ch:
                io.open(p, "w", encoding="utf-8").write(t2)
                n += 1
        print("[%s] 更新 %d 页" % (block_id, n))


if __name__ == "__main__":
    main()
