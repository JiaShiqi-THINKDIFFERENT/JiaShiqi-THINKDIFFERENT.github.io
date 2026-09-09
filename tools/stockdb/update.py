"""
每日更新入口：爬取 -> 合并 -> 派生股息率TTM -> upsert PostgreSQL。

用法:
  python tools/stockdb/update.py --symbol 600519 --name 贵州茅台 --slug guizhou-maotai
"""
from __future__ import annotations

import argparse
import sys
import traceback
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import db            # noqa: E402
import sources       # noqa: E402
import metrics       # noqa: E402


def build_daily_rows(symbol: str):
    """抓取并组装日线（close/pe_ttm/pb 对齐 + 前向填充百度周采样缺口），再派生 dv_ttm。"""
    today = date.today()
    start = (today - timedelta(days=365 * 11)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    closes = sources.fetch_em_close(symbol, start, end)          # [(date_iso, close)]
    if not closes:
        raise RuntimeError("东财收盘价为空，中止")

    pe_map, pb_map = {}, {}
    try:
        bd = sources.fetch_baidu_valuation(symbol)
        pe_map, pb_map = bd["pe_ttm"], bd["pb"]
    except Exception as e:                                        # noqa: BLE001
        print("[warn] 百度估值抓取失败，PE/PB 置空:", e)

    events = []
    try:
        events = sources.fetch_dividends(symbol)
    except Exception as e:                                        # noqa: BLE001
        print("[warn] 分红记录抓取失败，dv_ttm 置空:", e)

    dates = [date.fromisoformat(d) for d, _ in closes]
    raw_close = [c for _, c in closes]
    ex_dates = [e["ex_date"] for e in events]
    per_shares = [e["per_share"] for e in events]
    dv = metrics.compute_dv_ttm(dates, ex_dates, per_shares, raw_close)

    # 百度为周采样：逐日前向填充，保证日频表无估值空洞
    last_pe = last_pb = None
    rows = []
    for i, (iso, close) in enumerate(closes):
        pe = pe_map.get(iso)
        pb = pb_map.get(iso)
        if pe is None:
            pe = last_pe
        if pb is None:
            pb = last_pb
        if pe_map.get(iso) is not None:
            last_pe = pe_map[iso]
        if pb_map.get(iso) is not None:
            last_pb = pb_map[iso]
        rows.append((symbol, dates[i], close, pe, pb, dv[i]))
    return rows, events


def run(symbol: str, name: str, slug: str, industry: str | None = None) -> None:
    conn = db.connect()
    status = "OK"
    msg = ""
    try:
        rows, events = build_daily_rows(symbol)
        db.upsert_basic(conn, symbol, name, slug, industry)
        n = db.upsert_daily(conn, rows)
        m = db.replace_dividends(conn, symbol, [
            (e["ex_date"], e["per_share"], e["announce_date"], e["record_date"], e["raw"])
            for e in events
        ])
        last_date = rows[-1][1] if rows else None
        db.log_update(conn, symbol, last_date, n, status, f"daily={n} dividend={m}")
        conn.commit()
        print(f"[OK] {symbol} {name} 入库 {n} 行, 分红 {m} 条, 最新交易日 {last_date}")
    except Exception as e:                                        # noqa: BLE001
        status = "FAIL"
        msg = str(e)
        try:
            db.log_update(conn, symbol, None, 0, status, msg[:400])
            conn.commit()
        except Exception:                                         # noqa: BLE001
            conn.rollback()
        raise
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", required=True, help="股票代码，如 600519")
    ap.add_argument("--name", required=True, help="股票名称，如 贵州茅台")
    ap.add_argument("--slug", required=True, help="Hexo 页面 slug，如 guizhou-maotai")
    ap.add_argument("--industry", default=None, help="申万一级行业（可选）")
    args = ap.parse_args()
    try:
        run(args.symbol, args.name, args.slug, args.industry)
    except Exception:                                             # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
