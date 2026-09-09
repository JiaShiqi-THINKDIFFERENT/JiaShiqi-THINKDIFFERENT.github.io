# CLIVIA 股票估值数据管线（爬取 → PostgreSQL → 页面）

每日收盘后把 A 股个股估值数据爬入本地 **PostgreSQL**，再导出为 Hexo 页面 JSON，
自动重建并推送 GitHub Pages。数据源全部**免注册**：

| 数据 | 来源 | 口径 |
| ---- | ---- | ---- |
| 收盘价（不复权） | 东方财富 `push2his` | 日线，可直接用于股息率计算 |
| 市盈率 TTM / 市净率 | 百度股市通（akshare） | 周采样，日频前向填充 |
| 股息率 TTM % | 自算：东财分红记录（近12月每股现金分红 ÷ 收盘价） | 近似口径 |

## 目录结构
```
tools/stockdb/
├─ schema.sql         # 表结构（stock_basic/stock_daily/stock_dividend/update_log）
├─ init_db.py         # 一次性：建角色/库 + 写 .env + 建表（口令用 PG_SUPER_PASSWORD 注入）
├─ db.py              # PostgreSQL 访问层（连接串读 .env 的 DATABASE_URL）
├─ sources.py         # 数据源层：东财收盘 / 百度PE-PB / 东财分红（代理→直连双通道重试）
├─ metrics.py         # 股息率TTM 派生计算
├─ update.py          # 抓取→合并→计算→入库（幂等 upsert）
├─ export_json.py     # 从 DB 算近十年 min/max/median/分位并导出页面 JSON
├─ run_daily.py       # 每日编排：update→export→hexo g→push source→hexo d
└─ .env               # 数据库连接串（gitignore，勿提交）
```

## 首次初始化
```bash
# 1) 建库建表（口令放环境变量，别写进命令历史）
set PG_SUPER_PASSWORD=你的postgres口令      # PowerShell
python tools/stockdb/init_db.py

# 2) 全量入库茅台近十年数据
python tools/stockdb/update.py --symbol 600519 --name 贵州茅台 --slug guizhou-maotai --industry 食品饮料

# 3) 导出页面数据
python tools/stockdb/export_json.py --symbol 600519 --slug guizhou-maotai --name 贵州茅台
```

## 页面接入
股票页 `index.md` 中放以下两行即可（通用，数据文件与页面同目录）：
```html
<div id="stock-viz" data-json="valuation-data.json"></div>
<script src="/js/stock-viz.js" defer></script>
```
渲染内容：快照表（当前值/十年最低/中位/最高/分位刻度条）+ ECharts 四指标联动缩放图。

## 每日自动更新
1. 新建 Windows 计划任务，工作日 16:10 运行（需电脑开机，关机会断、可手动补跑）：
```powershell
schtasks /Create /TN "CLIVIA-StockDaily" /TR "cmd /c cd /d C:\Users\jiashiqi\Desktop\web\hexo-blog && C:\Users\jiashiqi\.workbuddy\binaries\python\envs\default\Scripts\python.exe tools\stockdb\run_daily.py" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 16:10 /F
```
2. 手动补跑：`python tools/stockdb/run_daily.py`

## 新增一只股票
1. `update.py` 入库 + `export_json.py` 导出（或用 `run_daily.py --only <代码>`）
2. 在 `run_daily.py` 的 `STOCKS` 字典登记（含 slug/行业），日后自动纳入日更
3. 在博客 `categories/index.md` 对应行业下加链接
