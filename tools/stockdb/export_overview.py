"""
生成首页右栏 / 导航条共用的股票池速览数据：source/stocks/data/overview.json

与 export_json.py（个股页大图，含十年序列与估值带，单只几百 KB）不同，
本脚本只输出「一枚卡片能放下」的摘要字段，11 只合计仅几 KB，适合首页直接拉取。

字段说明：
  close      前复权收盘价（与个股页默认口径一致）
  change_pct 相对上一交易日的涨跌幅(%)，基于前复权价
  pe/pb/dv   最新值；pe_pct/pb_pct 近十年分位(0~100，越小越便宜)，
             ★dv_pct 方向相反：股息率越高越便宜，故 dv_pct 越大越便宜（勿当作 pe_pct 用）
  score/verdict/score_date 来自三好评分 scores.json 的最新一期（无则 null）

用法:
  python tools/stockdb/export_overview.py
输出: source/stocks/data/overview.json
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

import db  # noqa: E402

# 股票池：symbol -> (名称, slug, 行业)。与 run_daily.py 保持一致，新增股票需同步两处。
STOCKS = {
    "600519": ("贵州茅台", "guizhou-maotai", "食品饮料"),
    "600887": ("伊利股份", "yili-gufen", "食品饮料"),
    "000333": ("美的集团", "meidi-jituan", "家用电器"),
    "300750": ("宁德时代", "ningde-shidai", "电力设备"),
    "002594": ("比亚迪", "biyadi", "汽车"),
    "600036": ("招商银行", "zhaoshang-yinhang", "银行"),
    "601398": ("工商银行", "gongshang-yinhang", "银行"),
    "601288": ("农业银行", "nongye-yinhang", "银行"),
    "600276": ("恒瑞医药", "hengru-yiyao", "医药生物"),
    "688981": ("中芯国际", "zhongxin-guoji", "电子"),
    "603259": ("药明康德", "wuxi-apptec", "医药生物"),
    "300308": ("中际旭创", "zhongji-xuchuang", "通信"),
    "002371": ("北方华创", "beifang-huachuang", "电子"),
    "601899": ("紫金矿业", "zijin-kuangye", "有色金属"),
    "600900": ("长江电力", "changjiang-dianli", "公用事业"),
    "601988": ("中国银行", "zhongguo-yinhang", "银行"),
    "601939": ("建设银行", "jianshe-yinhang", "银行"),
    "600941": ("中国移动", "zhongguo-yidong", "通信"),
    "600436": ("片仔癀", "pianzaihuang", "医药生物"),
    "601166": ("兴业银行", "xingye-yinhang", "银行"),
    "601336": ("新华保险", "xinhua-baoxian", "非银金融"),
    "601318": ("中国平安", "zhongguo-pingan", "非银金融"),
    "000001": ("平安银行", "pingan-yinhang", "银行"),
    "601628": ("中国人寿", "zhongguo-renshou", "非银金融"),
    "000651": ("格力电器", "geli-dianqi", "家用电器"),
    "600415": ("小商品城", "xiaoshangpin-cheng", "商贸零售"),
    "000617": ("中油资本", "zhongyou-ziben", "非银金融"),
    "000725": ("京东方A", "jingdongfang", "电子"),
    "002475": ("立讯精密", "lixun-jingmi", "电子"),
    "002230": ("科大讯飞", "keda-xunfei", "计算机"),
    "600019": ("宝钢股份", "baogang-gufen", "钢铁"),
    "600030": ("中信证券", "zhongxin-zhengquan", "非银金融"),
    "000792": ("盐湖股份", "yanhu-gufen", "基础化工"),
    "000988": ("华工科技", "huagong-keji", "机械设备"),
    "002027": ("分众传媒", "fenzhong-chuanmei", "传媒"),
    "002602": ("世纪华通", "shiji-huatong", "传媒"),
    "002625": ("光启技术", "guangqi-jishu", "国防军工"),
    "002714": ("牧原股份", "muyuan-gufen", "农林牧渔"),
    "300015": ("爱尔眼科", "aier-yanke", "医药生物"),
    "300124": ("汇川技术", "huichuan-jishu", "机械设备"),
    "300274": ("阳光电源", "yangguang-dianyuan", "电力设备"),
    "300476": ("胜宏科技", "shenghong-keji", "电子"),
    "300760": ("迈瑞医疗", "mairui-yiliao", "医药生物"),
    "600031": ("三一重工", "sanyi-zhonggong", "机械设备"),
    "600048": ("保利发展", "baoli-fazhan", "房地产"),
    "600111": ("北方稀土", "beifang-xitu", "有色金属"),
    "600150": ("中国船舶", "zhongguo-chuanbo", "国防军工"),
    "600309": ("万华化学", "wanhua-huaxue", "基础化工"),
    "600406": ("国电南瑞", "guodian-nanrui", "电力设备"),
    "600585": ("海螺水泥", "hailuo-shuini", "建筑材料"),
    "600660": ("福耀玻璃", "fuyao-boli", "汽车"),
    "600893": ("航发动力", "hangfa-dongli", "国防军工"),
    "601088": ("中国神华", "zhongguo-shenhua", "煤炭"),
    "601668": ("中国建筑", "zhongguo-jianzhu", "建筑装饰"),
    "601816": ("京沪高铁", "jinghu-gaotie", "交通运输"),
    "601857": ("中国石油", "zhongguo-shiyou", "石油石化"),
    "601888": ("中国中免", "zhongguo-zhongmian", "社会服务"),
    "603993": ("洛阳钼业", "luoyang-muye", "有色金属"),
    "605499": ("东鹏饮料", "dongpeng-yinliao", "食品饮料"),
}

YEAR_DAYS = 365.25
WINDOW_YEARS = 10
SCORES_PATH = REPO / "source" / "three-good" / "data" / "scores.json"
OUT_PATH = REPO / "source" / "stocks" / "data" / "overview.json"


def _pctile(vals: list[float | None]) -> float | None:
    """近十年分位：当前值在序列中的百分位（0~100，越小越便宜）。全 0 序列返回 None。"""
    window = [v for v in vals if v is not None]
    if not window or all(v == 0 for v in window):
        return None
    cur = window[-1]
    below = sum(1 for v in window if v < cur)
    equal = sum(1 for v in window if v == cur)
    return round((below + 0.5 * equal) / len(window) * 100.0, 1)


def _latest_score(slug: str, scores: dict | None):
    """取该股票最新一期三好评分 (total, verdict, date)。无数据返回 (None, None, None)。"""
    if not scores:
        return None, None, None
    hist = (scores.get("history") or {}).get(slug) or []
    if not hist:
        return None, None, None
    row = hist[-1]
    return (row.get("scores") or {}).get("total"), row.get("verdict"), row.get("date")


def main() -> None:
    scores = None
    if SCORES_PATH.exists():
        try:
            scores = json.loads(SCORES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"[warn] scores.json 解析失败，评分字段留空: {SCORES_PATH}")

    conn = db.connect()
    out_rows: list[dict] = []
    latest_overall: dt.date | None = None
    try:
        for symbol, (name, slug, industry) in STOCKS.items():
            rows = db.query_daily(conn, symbol)
            if not rows:
                print(f"[warn] {symbol} {name} 无数据，跳过（请先跑 update.py）")
                continue
            latest = rows[-1]["trade_date"]
            latest_overall = max(latest_overall, latest) if latest_overall else latest
            start = latest - dt.timedelta(days=int(YEAR_DAYS * WINDOW_YEARS))
            wrows = [r for r in rows if r["trade_date"] >= start] or rows[-800:]

            def col(field):
                return [None if r[field] is None else float(r[field]) for r in wrows]

            # 收盘价口径：优先前复权（与个股页默认一致）；最新交易日缺失时回退不复权
            # （数据源回退到东财时只有不复权价，此时 qfq 为 NULL）
            qfq, raw = col("close_qfq"), col("close")
            i = len(wrows) - 1  # 最新交易日索引：价格必须与该日对齐

            def _prev(arr):
                """最新交易日之前、同口径的最近一个有效值。"""
                for v in reversed(arr[:i]):
                    if v not in (None, 0):
                        return v
                return None

            # 最新日有前复权价则用之，否则回退该日的不复权价
            cur_close = qfq[i] if qfq[i] not in (None, 0) else raw[i]
            adj = qfq[i] not in (None, 0)
            prev_close = _prev(qfq if adj else raw)
            if prev_close is None:  # 同口径无前值，退到另一口径
                prev_close = _prev(raw if adj else qfq)
            change = (round((cur_close / prev_close - 1) * 100, 2)
                      if prev_close and cur_close else None)

            pe_vals, pb_vals, dv_vals = col("pe_ttm"), col("pb"), col("dv_ttm")
            score, verdict, score_date = _latest_score(slug, scores)
            out_rows.append({
                "symbol": symbol,
                "name": name,
                "slug": slug,
                "industry": industry,
                "close": None if cur_close is None else round(cur_close, 2),
                "adj": adj,  # True=前复权价；False=当日无前复权数据，回退为不复权价
                "change_pct": change,
                "pe": next((v for v in reversed(pe_vals) if v), None),
                "pe_pct": _pctile(pe_vals),
                "pb": next((v for v in reversed(pb_vals) if v), None),
                "pb_pct": _pctile(pb_vals),
                "dv": next((v for v in reversed(dv_vals) if v not in (None, 0)), None),
                "dv_pct": _pctile(dv_vals),
                "score": score,
                "verdict": verdict,
                "score_date": score_date,
            })
    finally:
        conn.close()

    out = {
        "updated": latest_overall.isoformat() if latest_overall else None,
        "count": len(out_rows),
        "note": "close=前复权收盘价; *_pct=近十年分位(越小越便宜); "
                "score/verdict=三好评分最新一期(每周四更新)",
        "stocks": out_rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    kb = OUT_PATH.stat().st_size / 1024
    print(f"[OK] 已导出 {OUT_PATH}（{len(out_rows)} 只，{kb:.1f} KB，"
          f"行情更新至 {out['updated']}）")


if __name__ == "__main__":
    main()
