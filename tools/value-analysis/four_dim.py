"""
四维度个股分析 · 批量生成器（源自《雪球股票投资 24 章》四篇框架）

对股票池内全部个股生成：
  1) source/four-dim/data/<slug>.json  —— 个股页「研究」章节四维度摘要卡的数据源
  2) source/four-dim/<slug>/index.md   —— 独立完整报告页（个股页摘要卡链接进入）
  3) source/four-dim/index.md          —— 四维度总览索引页
  4) source/four-dim/data/summary.json —— 全池汇总（总览页 JS 用）

评分口径：
  宏观 25 = A1 估值周期位置 15（十年分位线性映射）+ A2 流动性与政策 6（宏观基准 + 行业利率敏感度）+ A3 风格与资金 4
  中观 25 = B1 驱动力 8 + B2 行业位置 9 + B3 竞争格局与定价权 8        ← 行业层，同行业同分
  微观 25 = C1 壁垒 9（qualitative.moat）+ C2 财务与现金流 8（akshare）+ C3 治理 8（qualitative.management）
  实操 25 = D1 画像匹配 10（风格 + 回撤惩罚）+ D2 风险收益比 8（十年分位推演）+ D3 规则与工具 7

用法:
  python tools/value-analysis/four_dim.py                 # 全部个股
  python tools/value-analysis/four_dim.py --slug guizhou-maotai
  python tools/value-analysis/four_dim.py --no-fin        # 跳过财务抓取（用缓存/中性分）
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SKILL_SCRIPTS = Path(os.environ.get(
    "FD_SCRIPTS", r"C:/Users/jiashiqi/.workbuddy/skills/stock-four-dim-analysis/scripts"))
CACHE = HERE / ".cache"
OUT_DIR = REPO / "source" / "four-dim" / "data"
PAGE_DIR = REPO / "source" / "four-dim"

VERDICT_ICON = {"强烈推荐": "⭐", "推荐": "🟢", "可关注": "🟡",
                "观望": "🟠", "不推荐": "🔴", "远离": "❌"}
DIM_LABEL = {
    "macro": "宏观 · 周期定位与流动性",
    "industry": "中观 · 行业供需与定价权",
    "company": "微观 · 商业模式与质地",
    "action": "实操 · 风格匹配与买卖规则",
}
SEC_TITLE = {
    "macro": "一、宏观：周期定位与流动性",
    "industry": "二、中观：行业周期与定价权",
    "company": "三、微观：公司质地",
    "action": "四、实操：风格匹配与买卖规则",
}

sys.path.insert(0, str(SKILL_SCRIPTS))
import collect_brief as cb  # noqa: E402


# --------------------------------------------------------------------------- #
# 输入
# --------------------------------------------------------------------------- #
def load_stocks() -> list[tuple[str, str, str]]:
    """唯一事实源：score_stock.py 的 STOCKS，返回 [(code, slug, name), ...]"""
    src = io.open(REPO / "tools/value-analysis/score_stock.py", encoding="utf-8").read()
    m = re.search(r"STOCKS\s*=\s*\[(.*?)\n\]", src, re.S)
    return re.findall(r'\("(\d{6})",\s*"([a-z0-9-]+)",\s*"([^"]+)"\)', m.group(1))


def load_industries() -> dict[str, str]:
    src = io.open(REPO / "tools/stockdb/run_daily.py", encoding="utf-8").read()
    m = re.search(r"STOCKS\s*=\s*\{(.*?)\n\}", src, re.S)
    return {slug: ind for _, _, slug, ind in
            re.findall(r'"(\d{6})":\s*\("([^"]+)",\s*"([a-z0-9-]+)",\s*"([^"]+)"\)', m.group(1))}


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# --------------------------------------------------------------------------- #
# 财务（C2）
# --------------------------------------------------------------------------- #
def fetch_financials(symbol: str, use_net: bool = True) -> dict | None:
    """取 ROE / 资产负债率 / 经营现金流与净利润比率。结果缓存到 .cache/。"""
    CACHE.mkdir(exist_ok=True)
    fp = CACHE / f"fin_{symbol}.json"
    if fp.exists():
        try:
            return json.loads(io.open(fp, encoding="utf-8").read())
        except Exception:
            pass
    if not use_net:
        return None
    try:
        import akshare as ak
        df = ak.stock_financial_analysis_indicator(symbol=symbol, start_year="2021")
    except Exception as exc:
        print(f"  [warn] 财务抓取失败 {symbol}: {exc}")
        return None
    if df is None or df.empty:
        return None

    def col(name):
        for c in df.columns:
            if c.startswith(name):
                return c
        return None

    c_roe, c_debt, c_cash = col("加权净资产收益率"), col("资产负债率"), col("经营现金净流量与净利润的比率")
    if not c_roe:
        return None

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    annual = df[df["日期"].astype(str).str.endswith("12-31")]
    src_df = annual if len(annual) >= 3 else df
    roe = [num(v) for v in src_df[c_roe].tolist()]
    roe = [v for v in roe if v is not None][-5:]
    debt = [num(v) for v in src_df[c_debt].tolist()] if c_debt else []
    debt = [v for v in debt if v is not None][-3:]
    cash = [num(v) for v in src_df[c_cash].tolist()] if c_cash else []
    cash = [v for v in cash if v is not None][-5:]

    out = {
        "roe_latest": roe[-1] if roe else None,
        "roe_5y_avg": round(sum(roe) / len(roe), 2) if roe else None,
        "roe_years": len(roe),
        "debt_ratio": debt[-1] if debt else None,
        "cash_to_profit_avg": round(sum(cash) / len(cash), 1) if cash else None,
    }
    io.open(fp, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
    return out


def score_c2(fin: dict | None, is_financial: bool) -> tuple[float, str]:
    """返回 (得分 /8, 依据文本)"""
    if is_financial:
        note = "金融业不适用资产负债率与经营现金流的常规口径，杠杆与现金流两项按行业中性给分"
        if not fin or fin.get("roe_5y_avg") is None:
            return 6.0, note + "；ROE 数据缺失"
        roe = fin["roe_5y_avg"]
        s_roe = 3.5 if roe >= 15 else 3.0 if roe >= 10 else 2.4 if roe >= 6 else 1.5 if roe >= 0 else 0.5
        return round(s_roe + 2.0 + 2.5, 1), f"近 {fin.get('roe_years', 0)} 年平均 ROE {roe}%（金融口径：杠杆与现金流按行业中性计）"

    if not fin or fin.get("roe_5y_avg") is None:
        return 4.5, "财务数据缺失，按中性给分"
    roe, debt, cash = fin.get("roe_5y_avg"), fin.get("debt_ratio"), fin.get("cash_to_profit_avg")
    s_roe = 3.5 if roe >= 20 else 3.0 if roe >= 15 else 2.5 if roe >= 10 else 1.8 if roe >= 5 else 1.0 if roe >= 0 else 0.3
    if debt is None:
        s_debt, t_debt = 1.2, "资产负债率缺失"
    else:
        s_debt = 2.0 if debt <= 30 else 1.6 if debt <= 50 else 1.2 if debt <= 70 else 0.8
        t_debt = f"资产负债率 {debt:.1f}%"
    if cash is None:
        s_cash, t_cash = 1.4, "经营现金流/净利润缺失"
    else:
        s_cash = 2.5 if cash >= 100 else 2.0 if cash >= 80 else 1.4 if cash >= 50 else 0.8
        t_cash = f"经营现金流/净利润均值 {cash:.0f}%"
    return round(s_roe + s_debt + s_cash, 1), f"近 {fin.get('roe_years', 0)} 年平均 ROE {roe}%；{t_debt}；{t_cash}"


# --------------------------------------------------------------------------- #
# 核心：单只打分
# --------------------------------------------------------------------------- #
def analyze(code: str, slug: str, name: str, industry: str, cfg: dict, qual: dict,
            use_net: bool = True) -> dict | None:
    got = cb.load_from_db(REPO, code)
    if got is None:
        got = cb.load_from_ak(code)
        if got is None:
            print(f"  [skip] {code} {name} 无数据")
            return None
    basic, rows, divs = got
    brief = cb.build_brief(basic, rows, divs, "local-db")

    macro = cfg["macro"]
    ind = cfg["industries"][industry]
    ov = cfg["stock_overrides"].get(slug, {})
    style = ov.get("style", ind["style"])
    metric = ov.get("valuation_metric") or ind.get("valuation_metric") or "PE"
    metric_key = {"PE": "pe_ttm", "PB": "pb", "PS": "ps_ttm"}[metric]
    st = brief["valuation"].get(metric_key)
    if st is None:                                   # 主口径缺失时依次回退
        for k, mk in (("pe_ttm", "PE"), ("pb", "PB"), ("ps_ttm", "PS")):
            if brief["valuation"].get(k):
                st, metric, metric_key = brief["valuation"][k], mk, k
                break
    if st is None:
        print(f"  [skip] {code} {name} 无估值数据")
        return None

    p = brief["price"]
    price = p["close"]
    q = qual.get(slug, {})
    indq = q.get("industry", {})

    # ---------- A 宏观 ----------
    pct = st["pct"]
    a1 = round(clamp(15.0 * (1 - pct / 100.0), 0.5, 15.0), 1)
    a1_ev = (f"{metric} {st['current']}（区间 {st['min']}–{st['max']}，中位 {st['median']}）"
             f" → 十年分位 {pct}%")
    a2 = round(clamp(macro["a2_base"] + ind.get("a2_adj", 0), 0, 6), 1)
    a2_ev = f"PMI {macro['pmi']['value']}%（{macro['pmi']['note']}）；M1 同比 {macro['m1_yoy']}%；10Y 国债 {macro['bond10y']}%"
    a3 = round(clamp(macro["a3_base"] + ind.get("a3_adj", 0), 0, 4), 1)
    a3_ev = (f"全 A PE 处近十年 {macro['market_pe_pct']}% 分位，机构建议红利防御 + 均衡；"
             f"该股属「{style}」风格")

    # ---------- B 中观 ----------
    b1, b2, b3 = float(ind["b1"]), float(ind["b2"]), float(ind["b3"])
    b1_ev = f"{ind['driver_type']}；{ind['driver_note']}"
    b2_ev = f"行业位置：{ind['position']}；{ind['position_note']}"
    b3_ev = (f"{ind['competition_note']}（定性行业四维：格局 {indq.get('格局','—')}/25、"
             f"定价权 {indq.get('定价权','—')}/25、需求稳定性 {indq.get('需求稳定性','—')}/25、"
             f"进入壁垒 {indq.get('进入壁垒','—')}/25）")

    # ---------- C 微观 ----------
    moat = q.get("moat", 20)
    mgmt = q.get("management", 12)
    c1 = round(9.0 * moat / 40.0, 1)
    c1_ev = f"护城河定性分 {moat}/40；{q.get('rationale','')[:80]}…"
    is_fin = industry in ("银行", "非银金融")
    fin = fetch_financials(code, use_net=use_net)
    c2, c2_ev = score_c2(fin, is_fin)
    c3 = round(8.0 * mgmt / 20.0, 1)
    c3_ev = f"管理层定性分 {mgmt}/20；连续派息 {brief['dividend']['consecutive_years']} 年"

    # ---------- D 实操 ----------
    prof = cfg["profile_default"]
    d1 = prof["d1_base_by_style"].get(style, 6.0)
    mdd = p.get("max_drawdown_window")
    if mdd is not None:
        for r in prof["drawdown_penalty"]:
            if abs(mdd) > r["over"]:
                d1 -= r["sub"]
                break
    d1 = round(clamp(d1, 0, 10), 1)
    d1_ev = (f"画像「{prof['desc']}」；该股属「{style}」风格"
             + (f"；十年窗口最大回撤 {mdd}%，超出画像承受度需靠仓位控制" if mdd else ""))

    cur, mn, md = st["current"], st["min"], st["median"]
    down = (mn / cur - 1) * 100 if cur else None
    up = (md / cur - 1) * 100 if cur else None
    ratio = abs(up / down) if (up and down) else None
    if ratio is None:
        d2 = 4.0
    elif ratio >= 3:
        d2 = 7.5
    elif ratio >= 2:
        d2 = 7.0
    elif ratio >= 1:
        d2 = 5.5
    elif ratio >= 0.5:
        d2 = 3.5
    else:
        d2 = 2.5
    dv = (brief["valuation"].get("dv_ttm") or {}).get("current")
    if dv and dv >= 3.0:
        d2 += 0.5
    d2 = round(clamp(d2, 0, 8), 1)
    d2_ev = (f"{metric} 口径：下行至十年最低 {mn} → {down:.1f}%；上行至十年中位 {md} → {up:+.1f}%；"
             f"比值 {ratio:.2f}" if ratio else f"{metric} 口径空间测算不足")
    if dv:
        d2_ev += f"；股息率 {dv}% 提供安全垫"

    d3 = 6.5 if brief["history_days"] >= 1200 else 5.5
    if metric == "PS":
        d3 -= 0.5
    d3 = round(clamp(d3, 0, 7), 1)
    d3_ev = f"可得 {brief['history_days']} 个交易日历史（{'≥5 年，估值锚有效' if brief['history_days'] >= 1200 else '不足 5 年'}）"

    # ---------- 汇总 ----------
    dims = {
        "macro": {"score": round(a1 + a2 + a3, 1), "max": 25, "items": [
            {"k": "A1 估值周期位置", "s": a1, "m": 15, "ev": a1_ev},
            {"k": "A2 流动性与政策", "s": a2, "m": 6, "ev": a2_ev},
            {"k": "A3 风格与资金", "s": a3, "m": 4, "ev": a3_ev}]},
        "industry": {"score": round(b1 + b2 + b3, 1), "max": 25, "items": [
            {"k": "B1 驱动力归类", "s": b1, "m": 8, "ev": b1_ev},
            {"k": "B2 行业周期位置", "s": b2, "m": 9, "ev": b2_ev},
            {"k": "B3 竞争格局与定价权", "s": b3, "m": 8, "ev": b3_ev}]},
        "company": {"score": round(c1 + c2 + c3, 1), "max": 25, "items": [
            {"k": "C1 商业模式与壁垒", "s": c1, "m": 9, "ev": c1_ev},
            {"k": "C2 财务与现金流", "s": c2, "m": 8, "ev": c2_ev},
            {"k": "C3 管理层与治理", "s": c3, "m": 8, "ev": c3_ev}]},
        "action": {"score": round(d1 + d2 + d3, 1), "max": 25, "items": [
            {"k": "D1 风格匹配", "s": d1, "m": 10, "ev": d1_ev},
            {"k": "D2 风险收益比", "s": d2, "m": 8, "ev": d2_ev},
            {"k": "D3 规则与工具", "s": d3, "m": 7, "ev": d3_ev}]},
    }
    total = round(sum(v["score"] for v in dims.values()), 1)
    verdict = ("推荐" if total >= 75 else "可关注" if total >= 65
               else "观望" if total >= 50 else "不推荐")
    weak = [k for k, v in dims.items() if v["score"] < v["max"] * 0.4]
    if weak and verdict in ("推荐", "可关注"):
        verdict = "观望"          # 单一维度 <40% 得分，结论不得高于观望

    # ---------- 文本 ----------
    p_now = price
    p_min = round(p_now * mn / cur, 2) if cur else None
    p_mid = round(p_now * md / cur, 2) if cur else None
    p_up2 = round(p_mid * 1.25, 2) if p_mid else None
    pos_pct = round((p_now / p["ma250"] - 1) * 100, 1) if p.get("ma250") else None

    conclusion = (
        f"综合 {total}/100 → {verdict}。"
        f"估值层面：{metric} 十年分位 {pct}%（{'十年最低区' if pct <= 20 else '偏低' if pct <= 40 else '中性' if pct <= 60 else '偏贵'}）；"
        f"行业层面：{industry}属{ind['driver_type']}、位置{ind['position']}；"
        f"公司层面：护城河 {moat}/40、治理 {mgmt}/20"
        + (f"、近 {fin.get('roe_years',0)} 年平均 ROE {fin['roe_5y_avg']}%" if fin and fin.get('roe_5y_avg') else "")
        + f"；匹配层面：{style}风格对应画像「{prof['desc']}」。"
        + (f"主要不确定性：{ind['risks'][0]}。" if ind.get("risks") else "")
    )
    sec_macro = [
        f"周期定位：{macro['stage']}。{metric} 十年分位 {pct}%（当前 {st['current']}，区间 {st['min']}–{st['max']}，中位 {st['median']}）。",
        f"流动性：{macro['liquidity_note']}。",
        f"政策与基本面：{macro['policy_note']}。",
        f"风格环境：{macro['style_note']}。该股属「{style}」风格，"
        f"{'红利/价值在当前环境下相对顺风' if style in ('高股息','价值') else '成长风格在缩量修复期波动放大'}。",
        ("价格位置：现价较 250 日均线 " + (f"{pos_pct:+.1f}%" if pos_pct is not None else "—")
         + f"，较 52 周高点 {p['from_52w_high_pct']}%、较 52 周低点 {p['from_52w_low_pct']}%。"),
    ]
    sec_ind = [
        f"{industry}：{ind['driver_type']}，行业位置判断为「{ind['position']}」。",
        ind["driver_note"],
        ind["position_note"],
        f"竞争格局：{ind['competition_note']}",
    ]
    if ov.get("note"):
        sec_ind.append(f"个股特性：{ov['note']}")
    sec_comp = [
        f"公司归类：{industry}／{style}。定性依据——{q.get('rationale','')}" if q.get("rationale")
        else f"公司归类：{industry}／{style}。",
        f"财务与现金流：{c2_ev}。",
        f"分红：近 12 个月每股派息 {brief['dividend']['per_share_last_12m']} 元，"
        f"连续派息 {brief['dividend']['consecutive_years']} 年"
        + (f"，股息率 TTM {dv}%（十年分位 {(brief['valuation'].get('dv_ttm') or {}).get('pct')}%"
           f"，股息率分位越高代表越便宜）" if dv else "，暂无股息率数据"),
        f"价格轨迹：近 1 年 {p['ret_1y']}%、近 3 年 {p['ret_3y']}%、近 5 年 {p['ret_5y']}%"
        + ("（不复权口径，不含分红）" if p.get("basis") == "raw" else "")
        + f"；十年窗口最大回撤 {mdd}%。",
    ]
    sec_act = [
        f"投资者画像（默认）：{prof['desc']}。风格归属：{style}。",
        f"风险收益比：{d2_ev}。",
        "仓位纪律："
        + (f"十年窗口最大回撤 {mdd}%，"
           + ("单只仓位建议不超过总资产 10%" if mdd and abs(mdd) > 60
              else "单只仓位建议不超过 12%" if mdd and abs(mdd) > 45
              else "单只仓位建议不超过 15%" if mdd and abs(mdd) > 30
              else "单只仓位可放宽至 20%")
           + "——回撤来临时在底部卖出，是这套框架最常见的失效方式。") if mdd else "按常规仓位纪律执行。",
    ]
    action_rows = [
        {"action": "第一批", "trigger": f"现价附近（≤ {round(p_now * 1.03, 2)} 元）", "ratio": "计划仓位 1/3"},
        {"action": "第二批", "trigger": f"下跌 10%（≈ {round(p_now * 0.9, 2)} 元）", "ratio": "1/3"},
        {"action": "第三批", "trigger": (f"{metric} 回到十年最低 {mn}（≈ {p_min} 元）" if p_min else "估值回到十年最低"), "ratio": "1/3"},
        {"action": "止损（逻辑）", "trigger": f"{ind['track'][0]}明显恶化，或派息中断", "ratio": "全部离场"},
        {"action": "止损（价格）", "trigger": f"跌破 {round(p_now * 0.8, 2)} 元（-20%，最后防线）", "ratio": "全部离场"},
        {"action": "止盈一档", "trigger": (f"{metric} 回到十年中位 {md}（≈ {p_mid} 元）" if p_mid else "估值回到十年中位"), "ratio": "减 1/3"},
        {"action": "止盈二档", "trigger": (f"中位再上浮 25%（≈ {p_up2} 元）" if p_up2 else "估值中位上浮 25%"), "ratio": "再减 1/3，剩余跟随"},
    ]
    risks = list(ind["risks"]) + [
        f"估值层面：{metric} 十年分位 {pct}%，" + ("已处历史高位区，回撤空间大" if pct > 70 else "处历史低位，但低位可以更低"),
        f"回撤层面：十年窗口最大回撤 {mdd}%" if mdd else "历史数据不足，回撤风险未知",
    ]
    track = list(ind["track"]) + [f"{metric} 十年分位是否维持在当前水平", "分红方案与派息连续性"]

    return {
        "slug": slug, "symbol": code, "name": name, "industry": industry,
        "as_of": brief["as_of"], "metric": metric, "style": style,
        "price": price, "price_basis": p.get("basis"),
        "valuation": {"current": st["current"], "min": st["min"], "median": st["median"],
                      "max": st["max"], "pct": pct, "dv_ttm": dv},
        "total": total, "verdict": verdict, "dims": dims,
        "conclusion": conclusion,
        "sections": {"macro": sec_macro, "industry": sec_ind, "company": sec_comp, "action": sec_act},
        "action_rows": action_rows, "risks": risks, "track": track,
        "profile": prof["desc"],
        "macro_as_of": macro["as_of"],
    }


# --------------------------------------------------------------------------- #
# 报告页输出
# --------------------------------------------------------------------------- #
def render_page(r: dict) -> str:
    """把单只分析结果渲染成独立报告页 Markdown（source/four-dim/<slug>/index.md）"""
    now = time.strftime("%Y-%m-%d %H:%M")
    icon = VERDICT_ICON.get(r["verdict"], "")
    v = r["valuation"]
    basis_note = "（不复权口径，不含分红）" if r.get("price_basis") == "raw" else "（前复权口径）"

    dim_rows = "\n".join(
        f"| {DIM_LABEL.get(k, k)} | {d['score']} | {d['max']} |"
        for k, d in r["dims"].items())

    sub_blocks = []
    for k in ("macro", "industry", "company", "action"):
        d = r["dims"][k]
        items = "\n".join(
            f"| {it['k']} | {it['s']} | {it['m']} | {it['ev']} |" for it in d["items"])
        sub_blocks.append(
            f"**{DIM_LABEL.get(k, k)}：{d['score']} / {d['max']}**\n\n"
            f"| 子项 | 得分 | 满分 | 依据 |\n| ---- | ---- | ---- | ---- |\n{items}\n")

    secs = []
    for k in ("macro", "industry", "company", "action"):
        body = "\n".join(f"- {s}" for s in r["sections"][k])
        secs.append(f"## {SEC_TITLE[k]}\n\n{body}\n")

    act_rows = "\n".join(
        f"| {a['action']} | {a['trigger']} | {a['ratio']} |" for a in r["action_rows"])
    risks = "\n".join(f"- {x}" for x in r["risks"])
    track = "\n".join(f"- {x}" for x in r["track"])

    return f"""---
title: 四维度分析 · {r['name']}
date: {now}
---

# 四维度分析 · {r['name']}（{r['symbol']}）

> 依据《雪球股票投资 24 章》四篇框架——宏观（周期定位）／中观（行业供需）／微观（公司质地）／实操（风格与规则），
> 每维度 25 分，满分 100。定性层人工评估（每季度复核），量化层由脚本按行情与财报重算。

[← 返回个股页](/stocks/{r['slug']}/) ｜ [三好分析报告](/three-good/{r['slug']}/) ｜ [四维度总览](/four-dim/)

## 综合评分 **{r['total']} / 100** — {icon} {r['verdict']}

> {r['conclusion']}

| 项目 | 值 |
| ---- | ---- |
| 现价 | {r['price']} 元 {basis_note} |
| 估值指标 | {r['metric']} {v['current']}（十年区间 {v['min']}–{v['max']}，中位 {v['median']}） |
| 十年分位 | {v['pct']}% |
| 股息率 TTM | {v['dv_ttm'] if v['dv_ttm'] else '—'}% |
| 行业 / 风格 | {r['industry']} ／ {r['style']} |
| 数据截至 | 行情 {r['as_of']}；宏观 {r['macro_as_of']} |

## 评分卡

| 维度 | 得分 | 满分 |
| ---- | ---- | ---- |
{dim_rows}

{sub_blocks[0]}
{sub_blocks[1]}
{sub_blocks[2]}
{sub_blocks[3]}
{secs[0]}
{secs[1]}
{secs[2]}
{secs[3]}
## 操作计划

| 动作 | 触发条件 | 仓位 |
| ---- | -------- | ---- |
{act_rows}

> 投资者画像（默认）：{r['profile']}

## 主要风险

{risks}

## 跟踪清单

{track}

---

本文由脚本 `tools/value-analysis/four_dim.py` 依据公开行情与财报数据自动生成，为方法论演示与学习记录，不构成任何投资建议。
"""


def save_page(r: dict) -> Path:
    d = PAGE_DIR / r["slug"]
    d.mkdir(parents=True, exist_ok=True)
    p = d / "index.md"
    io.open(p, "w", encoding="utf-8").write(render_page(r))
    return p


def save_index(rows: list[dict], macro_as_of: str) -> Path:
    """四维度总览索引页

    表格由 /js/score-table.js 读取 /four-dim/data/index.json 渲染：
    股票名（代码，点击进入报告）｜申万一级行业｜近五次综合评分｜结论。
    只展示最新 5 篇，其余进页面下方「历史归档」折叠区。
    """
    now = time.strftime("%Y-%m-%d %H:%M")

    md = f"""---
title: 四维度分析
date: {now}
---

**四维度** = 宏观（周期定位与流动性）× 中观（行业供需与定价权）× 微观（公司质地）× 实操（风格匹配与买卖规则），
源自《雪球股票投资 24 章》四篇框架。每维度 25 分，满分 100：≥75 推荐｜65–74 可关注｜50–64 观望｜<50 不推荐。

宏观基准：{macro_as_of}。共 {len(rows)} 只。

下表按报告更新日期排序，**仅展示最新 5 篇**；更早的报告统一收纳在页面下方「历史归档」中，
仍可点击股票名进入查看完整评分报告。

<div class="score-table" data-src="/four-dim/data/index.json" data-base="/four-dim/"></div>

> 行业分类口径为申万一级；「近五次综合评分」按旧 → 新排列，▲ 红为环比上升、▼ 绿为环比下降。
> 三好（邱国鹭《投资中最简单的事》）与四维度（《雪球股票投资 24 章》）是两套独立方法论，
> 结论不一致时以差异说明为准，不混算。

---

本文由脚本自动生成，为方法论演示与学习记录，不构成任何投资建议。

<script src="/js/score-table.js" defer></script>
"""
    p = PAGE_DIR / "index.md"
    io.open(p, "w", encoding="utf-8").write(md)
    return p


# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", help="只跑指定 slug")
    ap.add_argument("--no-fin", action="store_true", help="跳过联网财务抓取（财务按中性分）")
    ap.add_argument("--no-pages", action="store_true", help="只写 JSON，不生成报告页")
    args = ap.parse_args()

    cfg = json.loads(io.open(HERE / "four_dim_config.json", encoding="utf-8").read())
    qual = json.loads(io.open(HERE / "qualitative.json", encoding="utf-8").read())["stocks"]
    stocks = load_stocks()
    inds = load_industries()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.slug:
        stocks = [s for s in stocks if s[1] == args.slug]

    out = []
    for i, (code, slug, name) in enumerate(stocks, 1):
        industry = inds.get(slug, "?")
        print(f"[{i}/{len(stocks)}] {code} {name}（{industry}）", flush=True)
        try:
            r = analyze(code, slug, name, industry, cfg, qual, use_net=not args.no_fin)
        except Exception as exc:
            print(f"  [error] {slug}: {exc}")
            continue
        if not r:
            continue
        io.open(OUT_DIR / f"{slug}.json", "w", encoding="utf-8").write(
            json.dumps(r, ensure_ascii=False, indent=2))
        if not args.no_pages:
            save_page(r)
        out.append(r)
        print(f"  → {r['total']} {r['verdict']}（{r['metric']} 分位 {r['valuation']['pct']}%）", flush=True)
        time.sleep(0.2)

    out.sort(key=lambda x: -x["total"])
    summary = {"updated": time.strftime("%Y-%m-%d %H:%M"), "count": len(out),
               "macro_as_of": cfg["macro"]["as_of"],
               "stocks": [{"slug": r["slug"], "name": r["name"], "symbol": r["symbol"],
                           "industry": r["industry"], "total": r["total"], "verdict": r["verdict"],
                           "metric": r["metric"], "pct": r["valuation"]["pct"]} for r in out]}
    io.open(OUT_DIR / "summary.json", "w", encoding="utf-8").write(
        json.dumps(summary, ensure_ascii=False, indent=2))
    if not args.no_pages and not args.slug:
        p = save_index(out, cfg["macro"]["as_of"])
        print(f"索引页 → {p}")
    print(f"\n完成 {len(out)} 只 → {OUT_DIR}")
    for r in out:
        print(f"  {r['total']:>5}  {r['verdict']:<4} {r['name']:<8} {r['industry']:<6} "
              f"{r['metric']}分位{r['valuation']['pct']}%")


if __name__ == "__main__":
    main()
