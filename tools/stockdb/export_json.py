"""
从 PostgreSQL 导出页面展示数据（近十年分位 + 序列 + 同花顺式估值带）。

用法:
  python tools/stockdb/export_json.py --symbol 600519 --slug guizhou-maotai
输出: source/stocks/<slug>/valuation-data.json（供页面 echarts 读取）

估值带（bands）说明——同花顺风格：
  图中展示前复权收盘价，并按财报区间叠加估值分档横线：
  - 档位 = 近五年该指标最高/最低值之间五等分（共 6 档：min, +1/5, ..., max）
  - 每条横线价格 = 区间内每股基本面 × 档位估值；基本面按财报披露区间阶梯更新
    （区间边界取 A 股披露截止：05-01 一季报后、09-01 半年报后、11-01 三季报后）
  - 每股基本面由日频数据反推（前复权价口径，与展示价格同一复权空间）：
      PE: qfq_close / pe_ttm ≈ 每股收益(TTM)
      PB: qfq_close / pb     ≈ 每股净资产
      PS: qfq_close / ps_ttm ≈ 每股营收(TTM)
      DY: dv_ttm/100 × qfq_close ≈ 每股股息(TTM)，横线 = dps / 股息率档位
  - 线为阶梯横线：区间内保持不变，财报更新后跳变
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

import db            # noqa: E402

FIELDS = ("close", "close_qfq", "pe_ttm", "pb", "ps_ttm", "dv_ttm")
YEAR_DAYS = 365.25
WINDOW_YEARS = 10     # 序列窗口（分位统计）
BAND_YEARS = 5        # 估值带档位统计窗口（近五年）
BAND_DIVISIONS = 5    # 最高/最低之间五等分 -> 6 条线

# 估值带指标：key -> (label, digits, 是否倒数型[股息率：价格 = dps / 档位])
BAND_METRICS = {
    "pe_ttm": ("市盈率TTM", 1, False),
    "pb": ("市净率", 2, False),
    "ps_ttm": ("市销率TTM", 2, False),
    "dv_ttm": ("股息率TTM", 2, True),
}
# 财报披露区间起点（月, 日）：一季报后 / 半年报后 / 三季报·年报后
REPORT_BOUNDARIES = ((5, 1), (9, 1), (11, 1))


def _stats(vals: list[float | None]) -> dict | None:
    """vals 为升序日线某指标序列（允许 None）。返回 最新值 + 十年窗口 min/max/median/pct。
    全为 0 的序列视为「无该指标数据」（如从未分红的个股股息率），返回 None 让前端隐藏该指标。"""
    window = [v for v in vals if v is not None]
    if not window:
        return None
    if all(v == 0 for v in window):
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


def _report_intervals(start_iso: str, end_iso: str) -> list[tuple[str, str]]:
    """按财报披露边界切分 [start, end]，返回 [(seg_start, seg_end), ...]（闭区间）。"""
    y0, y1 = int(start_iso[:4]) - 1, int(end_iso[:4]) + 1
    bounds = [dt.date(y, m, d).isoformat() for y in range(y0, y1 + 1)
              for (m, d) in REPORT_BOUNDARIES]
    bounds = [b for b in bounds if start_iso <= b <= end_iso]
    segs: list[tuple[str, str]] = []
    prev = start_iso
    for b in bounds:
        if b > prev:
            segs.append((prev, (dt.date.fromisoformat(b) - dt.timedelta(days=1)).isoformat()))
            prev = b
    if prev <= end_iso:
        segs.append((prev, end_iso))
    return segs


def _build_bands(dates: list[str],
                 series: dict[str, list[float | None]]) -> dict | None:
    """生成同花顺式估值带。dates/series 为近十年窗口。返回 None 表示无法生成。"""
    if not dates:
        return None
    latest = dates[-1]
    band_start = (dt.date.fromisoformat(latest) - dt.timedelta(days=int(YEAR_DAYS * BAND_YEARS))
                  ).isoformat()
    band_start = max(band_start, dates[0])
    # 财报区间（仅在估值带窗口内）
    segs = _report_intervals(band_start, latest)
    date_idx = {d: i for i, d in enumerate(dates)}

    out: dict = {}
    for key, (label, digits, inverse) in BAND_METRICS.items():
        vals = series.get(key)
        if vals is None:
            continue
        lo_i = next((i for i, d in enumerate(dates) if d >= band_start), None)
        if lo_i is None:
            continue
        window = [v for v in vals[lo_i:] if v is not None and v > 0]
        if not window:
            continue
        vmin, vmax = min(window), max(window)
        if vmax <= 0 or vmax <= vmin:
            continue
        step = (vmax - vmin) / BAND_DIVISIONS
        levels = [round(vmin + k * step, digits) for k in range(BAND_DIVISIONS + 1)]

        # 每条线：按财报区间生成阶梯段 [起始日, 结束日, 价格]
        lines: list[list] = [[] for _ in levels]
        for seg_start, seg_end in segs:
            # 段内第一个「指标与价格都有效」的交易日
            si = next((i for i, d in enumerate(dates)
                       if seg_start <= d <= seg_end
                       and vals[i] is not None and vals[i] > 0
                       and series["close_qfq"][i] not in (None, 0)), None)
            if si is None:
                continue
            if key == "pe_ttm":
                f = series["close_qfq"][si] / vals[si]        # 每股收益(TTM)
            elif key == "pb":
                f = series["close_qfq"][si] / vals[si]        # 每股净资产
            elif key == "ps_ttm":
                f = series["close_qfq"][si] / vals[si]        # 每股营收(TTM)
            else:  # dv_ttm
                f = vals[si] / 100.0 * series["close_qfq"][si]  # 每股股息(TTM)
            for j, lv in enumerate(levels):
                # dv_ttm 以百分数存储：价格 = 每股股息 / (档位/100)；其余 = 基本面 × 档位
                price = (f * 100.0 / lv) if inverse else (f * lv)
                lines[j].append([seg_start, seg_end, round(price, 2)])
        if not any(lines):
            continue
        out[key] = {
            "label": label,
            "digits": digits,
            "inverse": inverse,
            "levels": levels,
            "segments": lines,
        }
    if not out:
        return None
    return {"start": band_start, "end": latest, "divisions": BAND_DIVISIONS,
            "metrics": out}


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
    window_start_d = latest - dt.timedelta(days=int(YEAR_DAYS * WINDOW_YEARS))
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

    bands = _build_bands(dates, series)

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
        "note": "close:不复权收盘价(东财/腾讯/新浪多源回退); close_qfq:前复权收盘价(腾讯/新浪); "
                "pe_ttm/pb:百度股市通(周采样,日频前向填充); ps_ttm:东财数据中心估值分析; "
                "dv_ttm:近12月每股现金分红/收盘价 自算近似(东财分红配送); "
                "bands:近五年估值五等分横线,按财报区间阶梯更新(同花顺估值带风格)",
        "latest": {
            "date": latest.isoformat(),
            "close": _num(latest_row["close"]),
            "close_qfq": _num(latest_row["close_qfq"]),
            "pe_ttm": _num(latest_row["pe_ttm"]),
            "pb": _num(latest_row["pb"]),
            "ps_ttm": _num(latest_row["ps_ttm"]),
            "dv_ttm": _num(latest_row["dv_ttm"]),
        },
        "stats": stats,
        "series": {
            "dates": dates,
            **{f: [None if x is None else round(x, 3) for x in series[f]] for f in FIELDS},
        },
        "bands": bands,
    }

    out_path = REPO / "source" / "stocks" / args.slug / "valuation-data.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    kb = out_path.stat().st_size / 1024
    print(f"[OK] 已导出 {out_path} ({kb:.0f} KB, {len(wrows)} 个交易日, "
          f"估值带指标 {len(bands['metrics']) if bands else 0} 个)")


if __name__ == "__main__":
    main()
