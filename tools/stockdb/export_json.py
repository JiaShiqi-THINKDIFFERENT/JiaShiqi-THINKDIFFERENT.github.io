"""
从 PostgreSQL 导出页面展示数据（近十年分位 + 序列）。

用法:
  python tools/stockdb/export_json.py --symbol 600519 --slug guizhou-maotai
输出: source/stocks/<slug>/valuation-data.json（供页面 echarts 读取）
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

import db            # noqa: E402

FIELDS = ("close", "pe_ttm", "pb", "dv_ttm")
YEAR_DAYS = 365.25
WINDOW_YEARS = 10


def _stats(vals: list[float | None]) -> dict | None:
    """vals 为升序日线某指标序列（允许 None）。返回 最新值 + 十年窗口 min/max/median/pct。"""
    window = [v for v in vals if v is not None]
    if not window:
        return None
    current = window[-1]                      # 最新非空值
    below = sum(1 for v in window if v < current)
    equal = sum(1 for v in window if v == current)
    n = len(window)
    pct = (below + 0.5 * equal) / n * 100.0
    return {
        "current": round(current, 3),
        "min": round(min(window), 3),
        "max": round(max(window), 3),
        "median": round(statistics.median(window), 3),
        "pct": round(pct, 1),
        "n": n,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--name", default="")
    args = ap.parse_args()

    conn = db.connect()
    try:
        rows = db.query_daily(conn, args.symbol)
    finally:
        conn.close()
    if not rows:
        print(f"[err] {args.symbol} 无数据，请先执行 update.py")
        sys.exit(1)

    # 近十年窗口（按最新交易日往前 10 年）
    latest = rows[-1]["trade_date"]
    window_start_d = latest - timedelta(days=int(YEAR_DAYS * WINDOW_YEARS))
    wrows = [r for r in rows if r["trade_date"] >= window_start_d]
    if not wrows:
        wrows = rows[-800:]

    dates = [r["trade_date"].isoformat() for r in wrows]
    series = {f: [None if r[f] is None else float(r[f]) for r in wrows] for f in FIELDS}
    stats = {}
    for f in FIELDS:
        s = _stats(series[f])
        if s:
            stats[f] = s

    latest_row = wrows[-1]
    def _num(x):
        return None if x is None else float(x)
    out = {
        "symbol": args.symbol,
        "name": args.name or "",
        "slug": args.slug,
        "updated": latest.isoformat(),
        "window": {
            "start": wrows[0]["trade_date"].isoformat(),
            "end": latest.isoformat(),
            "days": len(wrows),
        },
        "note": "close:不复权收盘价(东财/腾讯/新浪多源回退); pe_ttm/pb:百度股市通(周采样,日频前向填充); "
                "dv_ttm:近12月每股现金分红/收盘价 自算近似(东财分红配送)",
        "latest": {
            "date": latest.isoformat(),
            "close": _num(latest_row["close"]),
            "pe_ttm": _num(latest_row["pe_ttm"]),
            "pb": _num(latest_row["pb"]),
            "dv_ttm": _num(latest_row["dv_ttm"]),
        },
        "stats": stats,
        "series": {
            "dates": dates,
            **{f: [None if x is None else round(x, 3) for x in series[f]] for f in FIELDS},
        },
    }

    out_path = REPO / "source" / "stocks" / args.slug / "valuation-data.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    kb = out_path.stat().st_size / 1024
    print(f"[OK] 已导出 {out_path} ({kb:.0f} KB, {len(wrows)} 个交易日)")


if __name__ == "__main__":
    main()
