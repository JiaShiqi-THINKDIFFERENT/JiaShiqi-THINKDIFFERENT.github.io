#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
score_stock.py — 三好投资法则周度评分（stock-value-analyzer skill 的自动化落地）

流程（对每只股票）:
  1. 调用 skill 取数脚本 fetch_stock_data.py（akshare A 股引擎）→ time_series + models
  2. 读取本站 stockdb 导出的 valuation-data.json（估值分位/现价/股息率）
  3. 依据 qualitative.json 定性层配置 + 量化硬模型合成三好评分:
       综合 = 行业×30% + 公司×35% + 价格×25% + 定价权调整
  4. 输出:
       - source/three-good/data/scores.json     评分历史（前端展示近三个月打分）
       - source/three-good/<slug>/index.md      本期完整报告页

评分口径（全自动、可复现，报告页同步披露）:
  行业分(0-100)   = 定性四维（格局/定价权/需求稳定性/进入壁垒，人工配置季度复核）
  公司分(0-100)   = 护城河(定性0-40) + 财务质量评分卡(量化0-30) + 管理层(定性0-20)
                    + 时序校准(±5，ROE 一致性/营收CAGR)
      财务质量: F-Score(按可得项归一,0-12) + 价值创造(5-10年ROE均值替代ROIC,0-8)
                + 盈余质量(经营现金流/净利,0-10)
  价格分(0-100)   = PE十年分位(0-40) + PB十年分位(0-30) + 股息率分位(0-15) + 绝对PE锚(0-15)
  一票否决        = M-Score/Z-Score 仅在 applicable=True 时启用（A股摘要级数据多为不适用）

用法:
  python score_stock.py --all            # 全部 10 只
  python score_stock.py --slug guizhou-maotai
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent            # hexo-blog 根目录
SRC = REPO / "source"

# skill 脚本目录（可用环境变量 SVA_SCRIPTS 覆盖）
import os  # noqa: E402
SKILL_SCRIPTS = Path(os.environ.get(
    "SVA_SCRIPTS",
    r"C:\Users\jiashiqi\.workbuddy\skills\stock-value-analyzer\scripts"))
sys.path.insert(0, str(SKILL_SCRIPTS))
sys.path.insert(0, str(HERE))

import fetch_stock_data as fsd          # noqa: E402
import value_models as vm               # noqa: E402

# 股票池（与 run_daily.py 一致）
STOCKS = [
    ("600519", "guizhou-maotai", "贵州茅台"),
    ("600887", "yili-gufen", "伊利股份"),
    ("000333", "meidi-jituan", "美的集团"),
    ("300750", "ningde-shidai", "宁德时代"),
    ("002594", "biyadi", "比亚迪"),
    ("600036", "zhaoshang-yinhang", "招商银行"),
    ("601398", "gongshang-yinhang", "工商银行"),
    ("601288", "nongye-yinhang", "农业银行"),
    ("600276", "hengru-yiyao", "恒瑞医药"),
    ("688981", "zhongxin-guoji", "中芯国际"),
    ("603259", "wuxi-apptec", "药明康德"),
    ("300308", "zhongji-xuchuang", "中际旭创"),
    ("002371", "beifang-huachuang", "北方华创"),
    ("601899", "zijin-kuangye", "紫金矿业"),
    ("600900", "changjiang-dianli", "长江电力"),
    ("601988", "zhongguo-yinhang", "中国银行"),
    ("601939", "jianshe-yinhang", "建设银行"),
    ("600941", "zhongguo-yidong", "中国移动"),
    ("600436", "pianzaihuang", "片仔癀"),
    ("601166", "xingye-yinhang", "兴业银行"),
    ("601336", "xinhua-baoxian", "新华保险"),
]

SCORES_PATH = SRC / "three-good" / "data" / "scores.json"
THREE_GOOD_DIR = SRC / "three-good"


# ---------------------------------------------------------------------------
# akshare 全市场快照缓存（10 只股票逐个取数时避免重复拉全表）
# ---------------------------------------------------------------------------
def _patch_akshare_spot_cache() -> None:
    try:
        import akshare as ak
    except Exception:
        return
    if getattr(ak, "_sva_cache_patched", False):
        return
    _orig = ak.stock_zh_a_spot_em
    _cache: dict = {}

    def cached(*a, **kw):
        key = "spot"
        now = dt.datetime.now().timestamp()
        if key in _cache and now - _cache[key][0] < 600:
            return _cache[key][1]
        df = _orig(*a, **kw)
        _cache[key] = (now, df)
        return df

    cached.__doc__ = "cached wrapper (tools/value-analysis/score_stock.py)"
    ak.stock_zh_a_spot_em = cached
    ak._sva_cache_patched = True


# ---------------------------------------------------------------------------
# 数据读取
# ---------------------------------------------------------------------------
def load_qualitative() -> dict:
    with open(HERE / "qualitative.json", encoding="utf-8") as f:
        return json.load(f)


def load_stockdb_stats(slug: str) -> dict | None:
    p = SRC / "stocks" / slug / "valuation-data.json"
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 量化评分组件
# ---------------------------------------------------------------------------
def _arr(ts: dict, stmt: str, key: str) -> list:
    try:
        return ts.get(stmt, {}).get(key, []) or []
    except Exception:
        return []


def _v(ts: dict, stmt: str, key: str, i: int = 0):
    arr = _arr(ts, stmt, key)
    return arr[i] if len(arr) > i else None


def fscore_available_count(ts: dict) -> int:
    """按 skill 的 F-Score 九项，统计在当前数据源下真正可计算的项数。"""
    inc, bal, cf = "income_statement", "balance_sheet", "cashflow"
    ni, cfo = _v(ts, inc, "net_income"), _v(ts, cf, "operating_cashflow")
    a0, a1 = _v(ts, bal, "total_assets", 0), _v(ts, bal, "total_assets", 1)
    n = 0
    checks = [
        [ni, a0],                      # roa_positive
        [cfo],                         # cfo_positive
        [ni, a0, a1],                  # roa_rising (ni1 也需要, 近似)
        [cfo, ni],                     # accrual_quality
        [_v(ts, bal, "long_term_debt", 0), _v(ts, bal, "long_term_debt", 1)],  # leverage_down
        [_v(ts, bal, "current_assets", 0), _v(ts, bal, "current_liabilities", 0)],  # current_ratio_up
        [_v(ts, bal, "shares", 0), _v(ts, bal, "shares", 1)],   # no_dilution
        [_v(ts, inc, "gross_profit", 0), _v(ts, inc, "total_revenue", 0)],      # gross_margin_up
        [_v(ts, inc, "total_revenue", 0), a0],  # asset_turnover_up
    ]
    for need in checks:
        if all(x is not None for x in need):
            n += 1
    return n


def fin_quality_card(models: dict, ts: dict) -> dict:
    """财务质量评分卡（0-30）。A股摘要级数据缺 EBIT/明细科目：
    - F-Score 按可得项归一到 0-12
    - ROIC 用 5-10 年 ROE 均值替代判断价值创造（0-8）
    - 盈余质量 = 经营现金流/净利（0-10）"""
    f = models.get("piotroski_f") or {}
    fs, br = f.get("f_score"), f.get("breakdown") or {}
    avail = fscore_available_count(ts)
    if fs is not None and avail >= 4:
        f_part = round(min(fs / avail, 1.0) * 12, 1)
        f_note = f"F-Score {fs}/{avail}(可得项归一)"
    else:
        f_part, f_note = 6.0, "F-Score 数据不足，取中性 6"

    g = models.get("growth_consistency") or {}
    roe_mean = g.get("roe_mean")
    if roe_mean is not None:
        r = roe_mean * 100
        if r >= 15:
            roe_part, roe_note = 8, f"ROE均值 {r:.1f}%，显著创造价值"
        elif r >= 12:
            roe_part, roe_note = 6, f"ROE均值 {r:.1f}%，创造价值"
        elif r >= 8:
            roe_part, roe_note = 4, f"ROE均值 {r:.1f}%，一般"
        elif r > 0:
            roe_part, roe_note = 2, f"ROE均值 {r:.1f}%，偏低"
        else:
            roe_part, roe_note = 0, f"ROE均值 {r:.1f}%，为负"
    else:
        roe_part, roe_note = 2, "ROE 数据不足，取保守 2"

    eq = models.get("earnings_quality") or {}
    cc = eq.get("cash_conversion")
    if cc is not None:
        if cc >= 1.0:
            q_part, q_note = 10, f"现金含量 {cc:.2f}，优"
        elif cc >= 0.8:
            q_part, q_note = 8, f"现金含量 {cc:.2f}，良"
        elif cc >= 0.5:
            q_part, q_note = 5, f"现金含量 {cc:.2f}，一般"
        else:
            q_part, q_note = 2, f"现金含量 {cc:.2f}，差"
    else:
        q_part, q_note = 4, "现金流数据不足，取中性 4"

    return {"f_score": fs, "f_available": avail, "f_part": f_part, "f_note": f_note,
            "roe_mean": (round(roe_mean * 100, 1) if roe_mean is not None else None),
            "roe_part": roe_part, "roe_note": roe_note,
            "cash_conv": (round(cc, 2) if cc is not None else None),
            "q_part": q_part, "q_note": q_note,
            "total": round(f_part + roe_part + q_part, 1)}


def time_series_adjust(models: dict) -> tuple[float, str]:
    """时序校准 ±5：ROE 一致性 + 营收 CAGR。"""
    g = models.get("growth_consistency") or {}
    cons = g.get("roe_consistency") or ""
    roe_mean = g.get("roe_mean")
    cagr = g.get("revenue_cagr")
    adj, note = 0.0, "时序趋势中性"
    if cagr is not None and cagr < 0:
        adj -= 2
        note = "营收 CAGR 为负"
    if roe_mean is not None and roe_mean >= 0.15:
        if "高" in cons:
            adj += 5
            note = (f"ROE 均值 {roe_mean*100:.1f}% 且一致性高，长期盈利质量强"
                    + ("；营收 CAGR 为负" if (cagr is not None and cagr < 0) else ""))
        elif "中" in cons:
            adj += 3
            note = f"ROE 均值 {roe_mean*100:.1f}%，一致性中等"
        else:
            adj += 1
            note = f"ROE 均值 {roe_mean*100:.1f}% 但波动大（周期性）"
    return adj, note


def price_score(stats: dict) -> dict:
    """价格分（0-100），全部由本站十年估值分位数据驱动。"""
    pe = stats.get("pe_ttm")
    pb = stats.get("pb")
    dv = stats.get("dv_ttm")

    def pct_part(pct, full):
        if pct is None:
            return None
        for lim, sc in ((10, full), (25, full * 0.83), (50, full * 0.63),
                        (75, full * 0.38), (100, full * 0.15)):
            if pct <= lim:
                return round(sc, 1)
        return round(full * 0.15, 1)

    pe_part = pct_part(pe.get("pct") if pe else None, 40)
    pb_part = pct_part(pb.get("pct") if pb else None, 30)
    if dv and dv.get("pct") is not None:
        p = dv["pct"]
        dv_part = 15 if p >= 80 else 12 if p >= 60 else 8 if p >= 40 else 4 if p >= 20 else 1
        dv_note = f"股息率分位 {p:.0f}%"
    else:
        dv_part, dv_note = 0, "无股息数据"
    cur_pe = pe.get("current") if pe else None
    if cur_pe is not None:
        pe_abs = (15 if cur_pe < 15 else 12 if cur_pe < 20 else
                  8 if cur_pe < 30 else 4 if cur_pe < 50 else 2)
        pe_abs_note = f"PE-TTM {cur_pe:.1f} 倍"
    else:
        pe_abs, pe_abs_note = 0, "无 PE 数据"

    total = round(sum(x for x in (pe_part, pb_part, dv_part, pe_abs) if x is not None), 1)
    return {"pe_pct": pe.get("pct") if pe else None,
            "pb_pct": pb.get("pct") if pb else None,
            "dv_pct": dv.get("pct") if dv else None,
            "pe_part": pe_part, "pb_part": pb_part, "dv_part": dv_part, "pe_abs": pe_abs,
            "notes": [dv_note, pe_abs_note],
            "total": total}


def vetoes(models: dict, qual: dict) -> list[str]:
    """一票否决检查（M/Z 仅 applicable=True 时启用）。"""
    vs = []
    ind_total = sum(qual["industry"].values())
    if ind_total < 30:
        vs.append("行业评分 < 30（夕阳行业）")
    if qual["moat"] < 10:
        vs.append("护城河评分 < 10（毫无竞争优势）")
    for key, label in (("beneish_m", "Beneish M-Score 盈余操纵警示"),
                       ("altman_z", "Altman Z-Score 破产高危")):
        m = models.get(key) or {}
        if m.get("applicable"):
            if key == "beneish_m" and (m.get("m_score") or -99) > -1.78:
                vs.append(label)
            if key == "altman_z" and m.get("zone") == "财务困境":
                vs.append(label)
    return vs


def verdict_of(total: float) -> str:
    if total >= 80:
        return "强烈推荐"
    if total >= 70:
        return "推荐"
    if total >= 60:
        return "可关注"
    if total >= 50:
        return "观望"
    if total >= 40:
        return "不推荐"
    return "远离"


# ---------------------------------------------------------------------------
# 单只股票评分
# ---------------------------------------------------------------------------
def score_one(symbol: str, slug: str, name: str, qual_cfg: dict) -> dict:
    stats_doc = load_stockdb_stats(slug)
    stats = (stats_doc or {}).get("stats") or {}
    close = (stats_doc or {}).get("latest", {}).get("close_qfq")

    # 取数（失败容忍：量化财务部分降级，评分主体仍可用估值分位）
    degraded = False
    models: dict = {}
    ts: dict = {}
    try:
        data = fsd.fetch_all(symbol, "A")
        if data.get("price", {}).get("current") is None or data.get("errors"):
            degraded = bool(data.get("errors"))
        models = data.get("models") or {}
        ts = data.get("time_series") or {}
        if models.get("_error"):
            degraded = True
            models = {}
        if ts.get("_error"):
            ts = {}
    except Exception as e:
        degraded = True
        models, ts = {}, {}
        print(f"  [warn] {slug} 取数失败: {e}")

    q = qual_cfg
    ind_score = sum(q["industry"].values())
    fin = fin_quality_card(models, ts) if ts else {
        "f_part": 6.0, "f_note": "取数失败，取中性 6", "roe_part": 2, "roe_note": "数据不足",
        "q_part": 4, "q_note": "数据不足", "total": 12.0,
        "f_score": None, "roe_mean": None, "cash_conv": None, "f_available": 0}
    ts_adj, ts_note = time_series_adjust(models) if ts else (0.0, "取数失败，无时序校准")
    comp_score = round(min(q["moat"] + fin["total"] + q["management"] + ts_adj, 100), 1)
    prc = price_score(stats)
    total = round(ind_score * 0.30 + comp_score * 0.35 + prc["total"] * 0.25
                  + q["pricing_power_adj"], 1)
    vs = vetoes(models, q)
    verdict = "不推荐" if vs else verdict_of(total)

    return {
        "date": dt.date.today().isoformat(),
        "symbol": symbol, "slug": slug, "name": name,
        "close": close,
        "pe_pct": prc["pe_pct"], "pb_pct": prc["pb_pct"], "dv_pct": prc["dv_pct"],
        "scores": {"industry": ind_score, "company": comp_score, "price": prc["total"],
                   "total": total},
        "verdict": verdict, "vetoes": vs,
        "degraded": degraded,
        "detail": {"fin": fin, "ts_adj": ts_adj, "ts_note": ts_note,
                   "price_notes": prc["notes"],
                   "moat": q["moat"], "management": q["management"],
                   "pricing_power_adj": q["pricing_power_adj"],
                   "roe_mean": fin.get("roe_mean"),
                   "revenue_cagr": (round((models.get("growth_consistency") or {}).get("revenue_cagr") * 100, 1)
                                    if (models.get("growth_consistency") or {}).get("revenue_cagr") is not None else None)},
        "qual_rationale": q["rationale"],
        "industry_detail": q["industry"],
    }


# ---------------------------------------------------------------------------
# 报告页与历史合并
# ---------------------------------------------------------------------------
VERDICT_CLASS = {"强烈推荐": "⭐", "推荐": "🟢", "可关注": "🟡", "观望": "🟠",
                 "不推荐": "🔴", "远离": "❌"}


def render_report(s: dict, history: list[dict]) -> str:
    d = s["detail"]
    fin = s["detail"]["fin"]
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    ind = s["industry_detail"]
    vtag = VERDICT_CLASS.get(s["verdict"], "") + " " + s["verdict"]

    def fmt(x, nd=1):
        return "—" if x is None else (f"{x:.{nd}f}" if isinstance(x, (int, float)) else str(x))

    hist_rows = "\n".join(
        f"| {h['date']} | {fmt(h['scores']['total'])} | {fmt(h['scores']['industry'], 0)} | "
        f"{fmt(h['scores']['company'])} | {fmt(h['scores']['price'])} | "
        f"{VERDICT_CLASS.get(h['verdict'], '')} {h['verdict']} |"
        for h in history)

    pp = _pct_part_note(s)   # (pe_part, pb_part, dv_part, dv_note, pe_abs, pe_abs_note)

    return f"""---
title: 三好分析 · {s['name']}
date: {now}
---

# 三好投资法则分析 · {s['name']}（{s['symbol']}）

> 依据邱国鹭《投资中最简单的事》"三好原则"（好行业 × 好公司 × 好价格）+ 量化硬模型，
> 每周四收盘后自动更新。定性层为人工一次性评估（每季度复核），量化层每周由脚本重算。

## 分析概要（{s['date']}）

| 项目 | 值 |
| ---- | ---- |
| 现价（前复权） | {fmt(s['close'], 2)} 元 |
| PE-TTM 十年分位 | {fmt(s['pe_pct'])}% |
| PB 十年分位 | {fmt(s['pb_pct'])}% |
| 股息率分位 | {fmt(s['dv_pct'])}% |
| **综合评分** | **{fmt(s['scores']['total'])} / 100 — {vtag}** |
| 行业分（30%） | {fmt(s['scores']['industry'], 0)} |
| 公司分（35%） | {fmt(s['scores']['company'])} |
| 价格分（25%） | {fmt(s['scores']['price'])} |

{('**⚠️ 数据降级**：本次取数部分失败，财务量化部分按中性处理。\n\n' if s['degraded'] else '')}
## 好行业（{fmt(s['scores']['industry'], 0)} / 100）

| 维度 | 得分 | 满分 |
| ---- | ---- | ---- |
| 行业格局 | {ind['格局']} | 25 |
| 定价权 | {ind['定价权']} | 25 |
| 需求稳定性 | {ind['需求稳定性']} | 25 |
| 进入壁垒 | {ind['进入壁垒']} | 25 |

{chr(10).join('> ' + line for line in s['qual_rationale'].split('；'))}

## 好公司（{fmt(s['scores']['company'])} / 100）

**护城河（定性，{d['moat']} / 40）+ 管理层/资本配置（定性，{d['management']} / 20）+ 时序校准（{d['ts_adj']:+.1f}）**

财务质量评分卡（量化硬模型，{fmt(fin['total'])} / 30）：

| 模型 | 结果 | 得分 |
| ---- | ---- | ---- |
| Piotroski F-Score | {fin['f_note']} | {fmt(fin['f_part'])} / 12 |
| 价值创造（5-10年 ROE 均值替代 ROIC） | {fin['roe_note']} | {fmt(fin['roe_part'])} / 8 |
| 盈余质量（经营现金流/净利） | {fin['q_note']} | {fmt(fin['q_part'])} / 10 |

时序趋势：{d['ts_note']}

## 好价格（{fmt(s['scores']['price'])} / 100）

| 项 | 得分 | 说明 |
| ---- | ---- | ---- |
| PE-TTM 十年分位（0-40） | {fmt(pp[0])} | 分位 {fmt(s['pe_pct'])}% |
| PB 十年分位（0-30） | {fmt(pp[1])} | 分位 {fmt(s['pb_pct'])}% |
| 股息率分位（0-15） | {fmt(pp[2])} | {pp[3]} |
| 绝对 PE 锚（0-15） | {fmt(pp[4])} | {pp[5]} |

{('## 一票否决检查' + chr(10) + chr(10).join('- 🚫 ' + v for v in s['vetoes']) if s['vetoes'] else '## 一票否决检查\n\n- ✅ 未触发（M-Score / Z-Score 在 A 股摘要级数据下多为不适用，按 skill 护栏仅 applicable=True 时启用）')}

## 近三个月评分趋势

| 日期 | 综合 | 行业 | 公司 | 价格 | 结论 |
| ---- | ---- | ---- | ---- | ---- | ---- |
{hist_rows}

## 口径与局限

- 量化层由 `tools/value-analysis/score_stock.py` 调用 stock-value-analyzer skill 的
  `fetch_stock_data.py`（akshare A 股引擎）+ `value_models.py` 自动计算，可复现。
- A 股摘要级财务数据缺三大报表明细：M-Score / Z-Score / 反向 DCF 多数不适用（skill 护栏下不作否决）；
  ROIC 用 5-10 年 ROE 均值替代；F-Score 按可得项归一。
- 行业分/护城河/管理层为定性评分，配置存于 `tools/value-analysis/qualitative.json`，每季度人工复核。
- 定价权专项调整：{d['pricing_power_adj']:+d} 分。
- 本报告由自动化流水线生成，仅供研究参考，不构成投资建议。
"""


def _pct_part_note(s: dict):
    """报告页"好价格"明细表需要的价格分拆解（与 price_score 同口径重算）。"""
    stats_doc = load_stockdb_stats(s["slug"])
    stats = (stats_doc or {}).get("stats") or {}
    p = price_score(stats)
    dv_note = p["notes"][0] if p["notes"] else ""
    pe_abs_note = p["notes"][1] if len(p["notes"]) > 1 else ""
    return p["pe_part"], p["pb_part"], p["dv_part"], dv_note, p["pe_abs"], pe_abs_note


def merge_history(slug: str, snap: dict) -> list[dict]:
    SCORES_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = {}
    if SCORES_PATH.exists():
        try:
            with open(SCORES_PATH, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception:
            doc = {}
    hist = doc.setdefault("history", {}).setdefault(slug, [])
    hist = [h for h in hist if h.get("date") != snap["date"]]
    hist.append(snap)
    hist.sort(key=lambda x: x["date"])
    doc["history"][slug] = hist
    doc["updated"] = max(doc.get("updated", ""), snap["date"])
    doc["stocks"] = {sl: {"name": nm, "symbol": sy} for sy, sl, nm in STOCKS}
    with open(SCORES_PATH, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return hist


def save_report(slug: str, name: str, content: str) -> Path:
    d = THREE_GOOD_DIR / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / "index.md"
    p.write_text(content, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--slug")
    args = ap.parse_args()

    _patch_akshare_spot_cache()
    qual = load_qualitative()
    targets = STOCKS if args.all else [t for t in STOCKS if t[1] == args.slug]
    if not targets:
        print("[err] 未找到指定 slug")
        sys.exit(1)

    for symbol, slug, name in targets:
        print(f"=== {name}（{symbol}）===")
        qcfg = qual["stocks"].get(slug)
        if not qcfg:
            print(f"  [skip] qualitative.json 缺少 {slug}")
            continue
        snap = score_one(symbol, slug, name, qcfg)
        hist = merge_history(slug, snap)
        # 报告页展示近三个月全部快照
        cutoff = (dt.date.today() - dt.timedelta(days=92)).isoformat()
        recent = [h for h in hist if h["date"] >= cutoff]
        content = render_report(snap, recent)
        p = save_report(slug, name, content)
        s = snap["scores"]
        print(f"  综合 {s['total']}（行业 {s['industry']} / 公司 {s['company']} / 价格 {s['price']}）"
              f" → {snap['verdict']}" + ("  [数据降级]" if snap["degraded"] else ""))
        print(f"  报告: {p}")

    print(f"[OK] 完成 {len(targets)} 只，评分历史: {SCORES_PATH}")


if __name__ == "__main__":
    main()
