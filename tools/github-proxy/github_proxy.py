"""临时 GitHub CONNECT 代理（多节点自动故障转移，用完即关）

背景：本机 DNS 把 github.com 解析到被阻断的 IP，且各 GitHub 节点可用性会动态变化。
      部分节点处于"半死"状态：TCP/TLS 能通，但对 HTTP 请求无响应（2026-09-17 实测）。
思路：本地监听 HTTP CONNECT 代理，对 github.com:443 依次尝试候选 IP。
      启动时对每个候选做**应用层活性探测**（真实 TLS+GET，验证能收到 HTTP 响应），
      只有探测通过的节点才会被优先选用；TLS 握手仍由 git/curl 发起（SNI 保持 github.com），
      证书验证完整保留。
"""
from __future__ import annotations

import datetime
import select
import socket
import ssl
import threading
import time

LISTEN = ("127.0.0.1", 8899)

# GitHub 候选节点（启动时会做应用层探测，探测通过者排前）
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

# 应用层探测结果缓存：ip -> (alive: bool, ts: float)
_probe_cache: dict[str, tuple[bool, float]] = {}
_probe_lock = threading.Lock()
PROBE_TTL = 300  # 探测结果有效期（秒）
_probe_event = threading.Event()  # 启动探测完成信号


def log(msg: str) -> None:
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


def probe_node(ip: str, timeout: float = 5.0) -> bool:
    """应用层活性探测：真实 TLS 握手 + GET，必须收到 HTTP 响应才算活。"""
    try:
        raw = socket.create_connection((ip, 443), timeout=timeout)
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        tls = ctx.wrap_socket(raw, server_hostname="github.com")
        tls.settimeout(timeout)
        tls.sendall(b"GET / HTTP/1.1\r\nHost: github.com\r\nUser-Agent: probe\r\nConnection: close\r\n\r\n")
        data = tls.recv(256)
        tls.close()
        ok = data.startswith(b"HTTP/")
        return ok
    except Exception:
        return False


def _probe_worker(ip: str) -> None:
    alive = probe_node(ip)
    with _probe_lock:
        _probe_cache[ip] = (alive, time.time())
    log(f"probe {ip}: {'ALIVE' if alive else 'DEAD'}")


def probe_all() -> None:
    threads = [threading.Thread(target=_probe_worker, args=(ip,), daemon=True) for ip in FALLBACK_IPS]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)


def probe_alive(ip: str) -> bool:
    """查询缓存的探测结果；过期则同步重探（带简单去重）。"""
    with _probe_lock:
        cached = _probe_cache.get(ip)
        fresh = cached and (time.time() - cached[1]) < PROBE_TTL
    if fresh:
        return cached[0]
    alive = probe_node(ip)
    with _probe_lock:
        _probe_cache[ip] = (alive, time.time())
    if not alive:
        log(f"re-probe {ip}: DEAD (demoted)")
    return alive


def connect_best(host: str, port: int) -> tuple[socket.socket, str]:
    """按候选列表依次尝试，返回第一个连通的套接字与所用地址。"""
    candidates = UPSTREAM_HOSTS.get(host.lower())
    if not candidates:
        return socket.create_connection((host, port), timeout=15), host

    if not _probe_event.is_set():
        log("startup probing (application layer) ...")
        probe_all()
        _probe_event.set()

    # 排序：探测存活 > 未探测 > 探测死亡；同层内保持原顺序
    def rank(ip: str) -> int:
        with _probe_lock:
            cached = _probe_cache.get(ip)
        if cached is None:
            return 1
        return 0 if cached[0] else 2

    ordered = sorted(candidates, key=rank)
    ordered = [ip for ip in ordered if probe_alive(ip)] + [ip for ip in ordered if not probe_alive(ip)]
    if not ordered:
        raise OSError("no alive upstream after probing")

    last_err: Exception | None = None
    for ip in ordered:
        try:
            sock = socket.create_connection((ip, port), timeout=8)
            return sock, ip
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            with _probe_lock:
                _probe_cache[ip] = (False, time.time())
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
    log(f"proxy listening on {LISTEN[0]}:{LISTEN[1]} (probing at startup)")

    def rescan_loop() -> None:
        """后台周期性重探测：网络阻断是动态的，节点恢复后自动更新缓存。"""
        probe_all()
        _probe_event.set()
        while True:
            time.sleep(60)
            probe_all()

    threading.Thread(target=rescan_loop, daemon=True).start()
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()
