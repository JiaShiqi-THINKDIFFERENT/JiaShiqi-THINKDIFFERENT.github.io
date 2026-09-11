"""临时 GitHub CONNECT 代理（多节点自动故障转移，用完即关）

背景：本机 DNS 把 github.com 解析到被阻断的 IP，且各 GitHub 节点可用性会动态变化。
思路：本地监听 HTTP CONNECT 代理，对 github.com:443 依次尝试候选 IP，取第一个连通者。
      TLS 握手仍由 git/curl 发起（SNI 保持 github.com），证书验证完整保留。
"""
from __future__ import annotations

import datetime
import select
import socket
import threading

LISTEN = ("127.0.0.1", 8899)

# GitHub 候选节点（按探测结果排序，连接时逐个尝试）
FALLBACK_IPS = [
    "140.82.113.3",
    "140.82.114.3",
    "140.82.121.3",
    "20.27.177.113",
    "20.27.177.114",
    "20.205.243.168",
    "20.200.245.247",
    "4.237.22.38",
    "140.82.112.3",
]
UPSTREAM_HOSTS = {
    "github.com": FALLBACK_IPS,
    "api.github.com": FALLBACK_IPS,
    "codeload.github.com": FALLBACK_IPS,
    "uploads.github.com": FALLBACK_IPS,
}
# 上次成功的节点优先使用
_preferred: dict[str, str] = {}


def log(msg: str) -> None:
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


def connect_best(host: str, port: int) -> tuple[socket.socket, str]:
    """按候选列表依次尝试，返回第一个连通的套接字与所用地址。"""
    candidates = UPSTREAM_HOSTS.get(host.lower())
    if not candidates:
        return socket.create_connection((host, port), timeout=15), host

    ordered = []
    if _preferred.get(host) in candidates:
        ordered.append(_preferred[host])
    ordered += [ip for ip in candidates if ip != _preferred.get(host)]

    last_err: Exception | None = None
    for ip in ordered:
        try:
            sock = socket.create_connection((ip, port), timeout=8)
            _preferred[host] = ip
            return sock, ip
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    raise last_err or OSError("no reachable upstream")


def pipe(a: socket.socket, b: socket.socket) -> None:
    """双向转发直到任一端关闭。"""
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 120)
            if not r:
                break
            for s in r:
                data = s.recv(65536)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass


def handle(client: socket.socket) -> None:
    try:
        client.settimeout(25)
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = client.recv(4096)
            if not chunk:
                return
            req += chunk
        first = req.split(b"\r\n")[0].decode("latin1")
        parts = first.split()
        if len(parts) < 2 or parts[0].upper() != "CONNECT":
            client.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            client.close()
            return
        host, _, port = parts[1].partition(":")
        port = int(port or 443)
        upstream, used = connect_best(host, port)
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        log(f"{host}:{port} -> {used}:{port}")
        client.settimeout(None)
        pipe(client, upstream)
    except Exception as exc:  # noqa: BLE001
        log(f"error: {exc}")
        try:
            client.close()
        except Exception:
            pass


def main() -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(50)
    log(f"proxy listening on {LISTEN[0]}:{LISTEN[1]} (multi-node failover)")
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()
