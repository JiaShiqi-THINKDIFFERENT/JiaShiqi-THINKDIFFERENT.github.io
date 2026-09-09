"""
股息率(TTM) 派生计算：近 12 个月每股现金分红 / 收盘价。
- 输入：交易日列表、现金分红事件列表（含除权除息日与每股派息）
- 口径：d 日的 TTM 分红 = 除权除息日在 (d-365, d] 区间内的每股现金分红之和
- 输出：与交易日一一对应的 [dv_ttm% | None]
"""
from __future__ import annotations

import bisect
from datetime import timedelta


def trailing_12m_dividend(dates: list, ex_dates: list[object], per_shares: list[float]) -> list[float]:
    """
    dates: 升序交易日（date/datetime）
    ex_dates: 升序除权除息日
    per_shares: 与 ex_dates 对应的每股分红
    返回每天 TTM 每股分红金额。
    """
    days = [d.date() if hasattr(d, "date") else d for d in dates]
    prefix = [0.0]
    for v in per_shares:
        prefix.append(prefix[-1] + v)

    def _ts(dt):
        return dt.date() if hasattr(dt, "date") else dt

    out = []
    for day in days:
        lo = bisect.bisect_right(ex_dates, day - timedelta(days=365))
        hi = bisect.bisect_right(ex_dates, day)
        out.append(prefix[hi] - prefix[lo])
    return out


def compute_dv_ttm(dates: list, ex_dates: list, per_shares: list, closes: list[float]) -> list[float | None]:
    """返回与 closes 对齐的股息率(TTM)%，收盘价缺失/非正时为 None。"""
    ttm = trailing_12m_dividend(dates, ex_dates, per_shares)
    out = []
    for d, c in zip(ttm, closes):
        if c is None or c <= 0:
            out.append(None)
        else:
            out.append(round(d / c * 100.0, 4))
    return out
