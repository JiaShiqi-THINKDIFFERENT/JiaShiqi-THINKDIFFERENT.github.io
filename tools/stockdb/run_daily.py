"""
每日收盘后自动更新编排入口（Windows 计划任务 / 手动均可调用）。

流程：爬取入库(update) -> 导出页面JSON(export) -> hexo 重新生成 -> 推送 source 分支 -> hexo d 推 main 站点

用法:
  python tools/stockdb/run_daily.py            # 处理 STOCKS 中的全部股票
  python tools/stockdb/run_daily.py --only 600519

注意:
  1) 首次使用先执行 init_db（建库脚本）生成 .env；
  2) hexo 与 git 命令需在 PATH 中，或设置 NODE_BIN 指向 node 目录；
  3) 网络为 GitHub 波动场景时，可设 env BYPASS_PROXY=1 使用直连重试推送。
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PY = sys.executable

# 股票池：symbol -> (名称, slug, 申万一级行业)。后续新股票在此追加即可。
STOCKS = {
    "600519": ("贵州茅台", "guizhou-maotai", "食品饮料"),
    "000858": ("五粮液", "wuliangye", "食品饮料"),
    "300750": ("宁德时代", "ningde-shidai", "电力设备"),
    "600036": ("招商银行", "zhaoshang-yinhang", "银行"),
    "600276": ("恒瑞医药", "hengru-yiyao", "医药生物"),
    "002594": ("比亚迪", "biyadi", "汽车"),
}

# 本机访问 GitHub 的 HTTPS 443 会被网络策略间歇性阻断（DNS 指向被屏蔽 IP）。
# 推送统一走本地 CONNECT 转发代理（多节点自动故障转移，TLS 证书验证完整保留）。
PROXY_URL = "http://127.0.0.1:8899"
PROXY_PORT = 8899
PROXY_SCRIPT = HERE.parent / "github-proxy" / "github_proxy.py"


def _port_listening(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def ensure_git_proxy() -> None:
    """credential.httpsProxy 已全局指向 8899；若代理未监听则自动拉起（幂等）。"""
    if _port_listening(PROXY_PORT):
        print(f"[proxy] 本地转发代理已在运行 127.0.0.1:{PROXY_PORT}")
        return
    if not PROXY_SCRIPT.exists():
        print(f"[warn] 代理脚本不存在，跳过自启: {PROXY_SCRIPT}")
        return
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(
        [PY, str(PROXY_SCRIPT)],
        creationflags=flags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(12):
        if _port_listening(PROXY_PORT):
            print(f"[proxy] 已自动拉起本地转发代理 127.0.0.1:{PROXY_PORT}")
            return
        time.sleep(0.5)
    print("[warn] 代理拉起超时，git 推送可能失败")


def setup_push_env() -> None:
    """让 git 传输与 GCM 凭据助手都走本地代理（GCM 不读 HTTPS_PROXY 环境变量，
    需依赖全局 credential.httpsProxy；此处只补传输层代理）。"""
    ensure_git_proxy()
    for k in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        os.environ[k] = PROXY_URL
    os.environ["GIT_TERMINAL_PROMPT"] = "0"


def sh(cmd: list[str], cwd: Path = REPO, retry: int = 1, timeout: int = 300) -> None:
    """执行命令；retry>1 时失败自动重试（用于 GitHub 推送网络波动）。"""
    env = dict(os.environ)
    for i in range(retry):
        print(">>", " ".join(str(c) for c in cmd), f"(cwd={cwd})")
        try:
            r = subprocess.run(cmd, cwd=cwd, env=env, timeout=timeout)
            if r.returncode == 0:
                return
            print(f"[retry {i+1}] 退出码 {r.returncode}")
        except subprocess.TimeoutExpired:
            print(f"[retry {i+1}] 超时")
        time.sleep(4)
    raise SystemExit(f"命令失败: {cmd}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="仅处理指定代码")
    ap.add_argument("--no-push", action="store_true", help="只更新+构建，不推送")
    args = ap.parse_args()

    stocks = {k: v for k, v in STOCKS.items() if not args.only or k == args.only}
    if not stocks:
        raise SystemExit("股票池为空（--only 代码不在 STOCKS 中）")

    for symbol, (name, slug, industry) in stocks.items():
        print(f"\n===== {symbol} {name} =====")
        sh([PY, str(HERE / "update.py"), "--symbol", symbol, "--name", name, "--slug", slug, "--industry", industry], retry=1, timeout=420)
        sh([PY, str(HERE / "export_json.py"), "--symbol", symbol, "--slug", slug, "--name", name], retry=1, timeout=120)

    print("\n===== hexo 构建 =====")
    node_bin = os.environ.get("NODE_BIN", "")
    if node_bin:
        os.environ["PATH"] = node_bin + os.pathsep + os.environ["PATH"]
    sh([os.environ.get("HEXO", str(REPO / "node_modules/.bin/hexo" if os.name != "nt" else REPO / "node_modules/.bin/hexo.cmd")), "generate"], timeout=300)

    if args.no_push:
        print("已跳过推送（--no-push）")
        return

    print("\n===== 提交并推送 =====")
    setup_push_env()
    sh(["git", "add", "-A"], cwd=REPO)
    sh(["git", "commit", "-m", f"data: stock valuation daily update {date.today().isoformat()}", "--allow-empty"], cwd=REPO)
    sh(["git", "push", "origin", "source"], cwd=REPO, retry=6, timeout=120)
    hexo = str(REPO / "node_modules/.bin/hexo.cmd") if os.name == "nt" else str(REPO / "node_modules/.bin/hexo")
    sh([hexo, "deploy"], cwd=REPO, retry=6, timeout=300)
    print("\n===== 全部完成 =====")


if __name__ == "__main__":
    main()
