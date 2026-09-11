"""
CLIVIA 股票估值仓库 —— 数据源层（免注册爬取）
- 东财：不复权日线收盘价   (requests 直连 EM push2his，稳定可控)
- 百度股市通：市盈率(TTM) / 市净率 近十年 (akshare 封装)
- 东财分红配送：现金分红事件 (akshare 封装)
所有请求内置"默认代理 -> 直连"双通道重试，适配本机网络波动。
"""
from __future__ import annotations

import os
import time
from datetime import date, datetime

import requests
import pandas as pd

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

def _to_date(x):
    """把 datetime / date / str / NaT 统一转为 datetime.date；None 保持 None。"""
    if x is None or pd.isna(x):
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    return pd.Timestamp(x).date()

def _bypass_proxies_env() -> dict:
    """临时摘掉沙箱/系统注入的 http(s)_proxy，改走直连。"""
    keep = {}
    for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
        if k in os.environ:
            keep[k] = os.environ.pop(k)
    return keep

def _restore_proxies_env(keep: dict) -> None:
    os.environ.update(keep)

def _get_retry(url: str, params: dict | None = None, headers: dict | None = None,
               tries: int = 5, timeout: int = 25) -> requests.Response:
    """先按环境默认（可能走代理），失败后直连重试。"""
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=headers or UA, timeout=timeout)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            last = e
        if i == 0:  # 首次失败即切直连
            saved = _bypass_proxies_env()
        time.sleep(1.5 * (i + 1))
    # 全部尝试结束：恢复代理环境变量（若被摘除）
    if "saved" in dir():
        _restore_proxies_env(saved)
    raise RuntimeError(f"请求失败: {url} -> {last}") from last

# --------------------------------------------------------------------------- #
# 1) 东财 不复权 日线收盘价
# --------------------------------------------------------------------------- #
def _secid(symbol: str) -> str:
    if symbol.startswith(("6", "9")):
        return f"1.{symbol}"      # 沪市
    return f"0.{symbol}"          # 深市/北交所特殊处理留待扩展

def fetch_em_close(symbol: str, start: str, end: str, tries: int = 5) -> list[tuple[str, float]]:
    """
    返回 [(date_iso, close_raw), ...] 升序，不复权。
    start/end 形如 YYYYMMDD（含）。EM klines 字段：f51日期 f52开 f53收 f54高 f55低 f56量 f57额。
    tries 可调低以便在主源不可用时快速失败、切换到备用源。
    """
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "secid": _secid(symbol),
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
        "klt": "101", "fqt": "0",           # 日线、不复权
        "beg": start, "end": end,
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
    }
    headers = dict(UA)
    headers["Referer"] = "https://quote.eastmoney.com/"
    r = _get_retry(url, params=params, headers=headers, tries=tries)
    data = r.json()
    klines = (data.get("data") or {}).get("klines") or []
    out = []
    for line in klines:
        p = line.split(",")
        try:
            out.append((p[0], float(p[2])))
        except (IndexError, ValueError):
            continue
    return out

# --------------------------------------------------------------------------- #
# 1b) 备用收盘价源（东财 push2his 被网络策略阻断时的降级通道）
#     腾讯 / 新浪 均为「不复权」日线，与东财口径一致。
# --------------------------------------------------------------------------- #
def _ak_symbol(symbol: str) -> str:
    """转为新浪/腾讯接口所需的带交易所前缀代码：600519 -> sh600519。"""
    if symbol.startswith(("6", "9")):
        return "sh" + symbol
    if symbol.startswith(("4", "8")):
        return "bj" + symbol
    return "sz" + symbol

def _df_to_close_series(df) -> list[tuple[str, float]]:
    out = []
    for _, r in df.iterrows():
        d = _to_date(r["date"])
        c = r["close"]
        if d is not None and c is not None and pd.notna(c):
            out.append((d.isoformat(), float(c)))
    out.sort(key=lambda x: x[0])
    return out

def fetch_tx_close(symbol: str, start: str, end: str) -> list[tuple[str, float]]:
    """腾讯财经 不复权日线收盘价。start/end 形如 YYYYMMDD。"""
    import akshare as ak
    df = _ak_retry(ak.stock_zh_a_hist_tx, symbol=_ak_symbol(symbol),
                   start_date=start, end_date=end, adjust="")
    return _df_to_close_series(df)

def fetch_sina_close(symbol: str, start: str, end: str) -> list[tuple[str, float]]:
    """新浪财经 不复权日线收盘价（末位备用源）。"""
    import akshare as ak
    df = _ak_retry(ak.stock_zh_a_daily, symbol=_ak_symbol(symbol),
                   start_date=start, end_date=end, adjust="")
    return _df_to_close_series(df)

def fetch_close_series(symbol: str, start: str, end: str) -> list[tuple[str, float]]:
    """
    多源回退获取不复权收盘价，返回 [(date_iso, close)] 升序。
    顺序：东财(快失败) -> 腾讯 -> 新浪；全部失败才抛错。
    """
    attempts = (
        ("东财", lambda: fetch_em_close(symbol, start, end, tries=2)),
        ("腾讯", lambda: fetch_tx_close(symbol, start, end)),
        ("新浪", lambda: fetch_sina_close(symbol, start, end)),
    )
    errors: list[str] = []
    for name, fn in attempts:
        try:
            out = fn()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}:{type(e).__name__}:{str(e)[:70]}")
            continue
        if out:
            print(f"[close] 来源={name}, {len(out)} 条, {out[0][0]} ~ {out[-1][0]}")
            return out
        errors.append(f"{name}:空数据")
    raise RuntimeError("收盘价全部数据源失败 -> " + " | ".join(errors))

# --------------------------------------------------------------------------- #
# 2) 百度股市通 估值（市盈率TTM / 市净率）
# --------------------------------------------------------------------------- #
_BAIDU_INDICATORS = {
    "pe_ttm": "市盈率(TTM)",
    "pb": "市净率",
}

def _ak_retry(fn, *args, tries: int = 3, **kwargs):
    """akshare 调用封装：失败切直连重试。"""
    last = None
    for i in range(tries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            last = e
        if i == 0:
            saved = _bypass_proxies_env()
        time.sleep(2 * (i + 1))
    if "saved" in dir():
        _restore_proxies_env(saved)
    raise RuntimeError(f"akshare 调用失败: {fn.__name__} -> {last}") from last

def fetch_baidu_valuation(symbol: str) -> dict[str, dict[str, float]]:
    """
    返回 {"pe_ttm": {date_iso: value}, "pb": {...}}。
    百度返回约 700+ 采样点（周采样），覆盖近十年。
    """
    import akshare as ak
    out = {}
    for col, indicator in _BAIDU_INDICATORS.items():
        df = _ak_retry(ak.stock_zh_valuation_baidu, symbol=symbol,
                       indicator=indicator, period="近十年")
        m = {}
        for _, r in df.iterrows():
            d = str(r["date"])[:10]
            v = r["value"]
            if v is not None and pd.notna(v):
                m[d] = float(v)
        out[col] = m
        time.sleep(1)
    return out

# --------------------------------------------------------------------------- #
# 3) 东财 分红配送（现金分红事件）
# --------------------------------------------------------------------------- #
def fetch_dividends(symbol: str) -> list[dict]:
    """
    返回已实施现金分红事件: [{ex_date, per_share, announce_date, record_date, raw}]。
    派息单位为"每 10 股 X 元"，故 per_share = 派息 / 10。
    """
    import akshare as ak
    df = _ak_retry(ak.stock_history_dividend_detail, symbol=symbol,
                   indicator="分红", date="")
    events = []
    for _, r in df.iterrows():
        progress = str(r.get("进度") or "")
        ex = r.get("除权除息日")
        pai = r.get("派息")
        if progress != "实施" or ex is None or pd.isna(ex) or pai is None or pd.isna(pai) or float(pai) <= 0:
            continue
        try:
            events.append({
                "ex_date": _to_date(ex),
                "per_share": round(float(pai) / 10.0, 4),
                "announce_date": _to_date(r.get("公告日期")),
                "record_date": _to_date(r.get("股权登记日")),
                "raw": str(dict(r))[:500],
            })
        except Exception:  # noqa: BLE001
            continue
    events.sort(key=lambda e: e["ex_date"])
    return events

if __name__ == "__main__":
    # 冒烟测试：python tools/stockdb/sources.py 600519
    import sys
    sym = sys.argv[1] if len(sys.argv) > 1 else "600519"
    today = date.today().strftime("%Y%m%d")
    start = date(date.today().year - 11, 1, 1).strftime("%Y%m%d")
    c = fetch_em_close(sym, start, today)
    print("EM close:", len(c), c[:1], c[-1:] if c else "")
    bd = fetch_baidu_valuation(sym)
    for k, m in bd.items():
        ks = sorted(m)
        print("Baidu", k, ":", len(ks), ks[0] if ks else "", ks[-1] if ks else "")
    dv = fetch_dividends(sym)
    print("Dividends:", len(dv), "last3:", [(d["ex_date"].isoformat(), d["per_share"]) for d in dv[-3:]])
