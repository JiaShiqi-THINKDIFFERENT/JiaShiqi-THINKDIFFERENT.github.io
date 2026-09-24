"""
评分总览页数据源构建器（三好 / 四维度）
=====================================================================
产出：
  1) source/three-good/data/index.json   三好评分总览表数据
  2) source/four-dim/data/index.json     四维度评分总览表数据
  3) source/four-dim/data/history.json   四维度评分历史归档（后台留存，不随报告页覆盖）

每行字段：
  slug / name / symbol / industry（申万一级）/
  latest {date,total,verdict,metric,pct} /
  series [{date,total,verdict}]  —— 近 5 期综合评分（旧→新）
  history —— 全部历史（归档用，倒序）

排序：最新一期日期降序 → 综合分降序。页面只展示最新 5 篇，其余进「历史归档」折叠区。

用法:
  python tools/value-analysis/build_score_index.py            # 两套都构建
  python tools/value-analysis/build_score_index.py --only three-good
"""
from __future__ import annotations

import argparse
import io
import json
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SRC = REPO / "source"
TG_DIR = SRC / "three-good" / "data"
FD_DIR = SRC / "four-dim" / "data"

RECENT_N = 5      # 页面「近五次综合评分」列展示期数
ARCHIVE_N = 60    # 后台归档保留期数（滚动窗口）

VERDICT_ICON = {"强烈推荐": "⭐", "推荐": "🟢", "可关注": "🟡",
                "观望": "🟠", "不推荐": "🔴", "远离": "❌"}


# --------------------------------------------------------------------------- #
# 股票池 / 行业
# --------------------------------------------------------------------------- #
def load_pool() -> list[tuple[str, str, str]]:
    """唯一事实源：score_stock.py 的 STOCKS → [(code, slug, name)]"""
    src = io.open(REPO / "tools/value-analysis/score_stock.py", encoding="utf-8").read()
    m = re.search(r"STOCKS\s*=\s*\[(.*?)\n\]", src, re.S)
    return re.findall(r'\("(\d{6})",\s*"([a-z0-9-]+)",\s*"([^"]+)"\)', m.group(1))


def load_industries() -> dict[str, str]:
    """申万一级行业：run_daily.py 的 STOCKS → {slug: industry}"""
    src = io.open(REPO / "tools/stockdb/run_daily.py", encoding="utf-8").read()
    m = re.search(r"STOCKS\s*=\s*\{(.*?)\n\}", src, re.S)
    return {slug: ind for _, _, slug, ind in
            re.findall(r'"(\d{6})":\s*\("([^"]+)",\s*"([a-z0-9-]+)",\s*"([^"]+)"\)', m.group(1))}


def read_json(p: Path, default):
    if not p.exists():
        return default
    try:
        return json.loads(io.open(p, encoding="utf-8").read())
    except Exception:
        return default


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    io.open(p, "w", encoding="utf-8").write(json.dumps(obj, ensure_ascii=False, indent=2))


# --------------------------------------------------------------------------- #
# 三好
# --------------------------------------------------------------------------- #
def build_three_good() -> int:
    doc = read_json(TG_DIR / "scores.json", {})
    history = doc.get("history", {})
    if not history:
        print("[warn] 三好 scores.json 无历史数据，跳过")
        return 0

    inds = load_industries()
    pool = {slug: (code, name) for code, slug, name in load_pool()}

    rows = []
    for slug, arr in history.items():
        if not arr:
            continue
        arr = sorted(arr, key=lambda h: h.get("date", ""))
        code, name = pool.get(slug, ("", (arr[-1].get("symbol") or "")))
        if not code:
            code = arr[-1].get("symbol", "")
        if name == code or not name:
            name = arr[-1].get("name", slug)
        last = arr[-1]
        total = (last.get("scores") or {}).get("total")
        rows.append({
            "slug": slug,
            "name": name,
            "symbol": code,
            "industry": inds.get(slug, "—"),
            "latest": {
                "date": last.get("date", ""),
                "total": round(float(total), 1) if isinstance(total, (int, float)) else None,
                "verdict": last.get("verdict", ""),
                "icon": VERDICT_ICON.get(last.get("verdict", ""), ""),
                "metric": "PE",
                "pct": last.get("pe_pct"),
            },
            "series": [{"date": h.get("date", ""),
                        "total": round(float((h.get("scores") or {}).get("total", 0) or 0), 1),
                        "verdict": h.get("verdict", "")} for h in arr[-RECENT_N:]],
            "history": [{"date": h.get("date", ""),
                         "total": round(float((h.get("scores") or {}).get("total", 0) or 0), 1),
                         "verdict": h.get("verdict", "")} for h in arr[::-1][:ARCHIVE_N]],
        })

    rows.sort(key=lambda r: (r["latest"]["date"], r["latest"]["total"] or 0), reverse=True)
    out = {"updated": doc.get("updated", ""), "built": time.strftime("%Y-%m-%d %H:%M"),
           "count": len(rows), "recent_n": RECENT_N, "rows": rows}
    write_json(TG_DIR / "index.json", out)
    print(f"三好 index.json → {TG_DIR / 'index.json'}（{len(rows)} 行）")
    return len(rows)


# --------------------------------------------------------------------------- #
# 四维度
# --------------------------------------------------------------------------- #
def merge_fd_history(summary: dict) -> dict:
    """把当期 summary 并入后台历史归档（同日覆盖，滚动保留 ARCHIVE_N 期）"""
    hp = FD_DIR / "history.json"
    doc = read_json(hp, {})
    stocks = doc.setdefault("stocks", {})
    date = (summary.get("updated", "") or "")[:10] or time.strftime("%Y-%m-%d")

    for s in summary.get("stocks", []):
        slug = s.get("slug")
        if not slug:
            continue
        arr = [h for h in stocks.get(slug, []) if h.get("date") != date]
        arr.append({"date": date, "total": s.get("total"), "verdict": s.get("verdict", ""),
                    "metric": s.get("metric", ""), "pct": s.get("pct")})
        arr.sort(key=lambda h: h.get("date", ""))
        stocks[slug] = arr[-ARCHIVE_N:]

    doc["updated"] = date
    doc["built"] = time.strftime("%Y-%m-%d %H:%M")
    write_json(hp, doc)
    return doc


def build_four_dim() -> int:
    summary = read_json(FD_DIR / "summary.json", {})
    if not summary.get("stocks"):
        print("[warn] 四维度 summary.json 为空，跳过")
        return 0

    hist_doc = merge_fd_history(summary)
    history = hist_doc.get("stocks", {})

    inds = load_industries()
    pool = {slug: (code, name) for code, slug, name in load_pool()}
    cur = {s["slug"]: s for s in summary.get("stocks", [])}

    rows = []
    for slug, arr in history.items():
        if not arr:
            continue
        arr = sorted(arr, key=lambda h: h.get("date", ""))
        code, name = pool.get(slug, ("", ""))
        c = cur.get(slug, {})
        if not code:
            code = c.get("symbol", "")
        if not name:
            name = c.get("name", slug)
        last = arr[-1]
        rows.append({
            "slug": slug,
            "name": name,
            "symbol": code,
            "industry": inds.get(slug, c.get("industry", "—")),
            "latest": {
                "date": last.get("date", ""),
                "total": last.get("total"),
                "verdict": last.get("verdict", ""),
                "icon": VERDICT_ICON.get(last.get("verdict", ""), ""),
                "metric": last.get("metric", ""),
                "pct": last.get("pct"),
            },
            "series": [{"date": h.get("date", ""), "total": h.get("total"),
                        "verdict": h.get("verdict", "")} for h in arr[-RECENT_N:]],
            "history": [{"date": h.get("date", ""), "total": h.get("total"),
                         "verdict": h.get("verdict", "")} for h in arr[::-1][:ARCHIVE_N]],
        })

    rows.sort(key=lambda r: (r["latest"]["date"], r["latest"]["total"] or 0), reverse=True)
    out = {"updated": summary.get("updated", ""), "built": time.strftime("%Y-%m-%d %H:%M"),
           "count": len(rows), "recent_n": RECENT_N,
           "macro_as_of": summary.get("macro_as_of", ""), "rows": rows}
    write_json(FD_DIR / "index.json", out)
    print(f"四维度 index.json → {FD_DIR / 'index.json'}（{len(rows)} 行）")
    return len(rows)


# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["three-good", "four-dim"], help="只构建其中一套")
    args = ap.parse_args()

    if args.only in (None, "three-good"):
        build_three_good()
    if args.only in (None, "four-dim"):
        build_four_dim()


if __name__ == "__main__":
    main()
