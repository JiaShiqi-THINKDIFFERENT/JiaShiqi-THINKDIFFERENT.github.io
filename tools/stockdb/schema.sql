-- ============================================================================
-- CLIVIA 股票估值数据仓库 schema
-- 说明：以"不复权收盘价 + 估值指标"为日频主表；分红事件单独成表，
--       股息率(TTM) 由分红事件 + 收盘价派生（近似口径，源切换后可用官方值覆盖）。
-- 执行：psql -U stock_app -d stockdb -f schema.sql
-- ============================================================================

-- 1) 股票主档：代码 -> Hexo 页面 slug 映射
CREATE TABLE IF NOT EXISTS stock_basic (
  symbol      varchar(12)  PRIMARY KEY,
  name        varchar(32)  NOT NULL,
  slug        varchar(64)  NOT NULL,
  sw_industry varchar(64),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE stock_basic IS '股票主档（symbol 与 Hexo 页面 slug 的映射）';

-- 2) 每日行情 + 估值主表（唯一键 symbol+trade_date，可幂等 upsert）
CREATE TABLE IF NOT EXISTS stock_daily (
  symbol     varchar(12)  NOT NULL,
  trade_date date         NOT NULL,
  close      numeric(14,3),   -- 不复权收盘价（元）
  pe_ttm     numeric(14,3),   -- 市盈率 TTM（百度股市通）
  pb         numeric(14,3),   -- 市净率（百度股市通）
  dv_ttm     numeric(10,4),   -- 股息率 TTM %（自算：近12月每股分红/收盘价）
  PRIMARY KEY (symbol, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_sym_date ON stock_daily (symbol, trade_date);

-- 3) 分红事件（东财分红配送，仅保留"实施"且已除权的现金分红）
CREATE TABLE IF NOT EXISTS stock_dividend (
  symbol        varchar(12) NOT NULL,
  ex_date       date        NOT NULL,   -- 除权除息日
  per_share     numeric(12,4) NOT NULL, -- 每股现金分红（元）
  announce_date date,
  record_date   date,
  raw           text,                   -- 原始行快照，便于追溯
  PRIMARY KEY (symbol, ex_date, per_share)
);

-- 4) 每日更新日志
CREATE TABLE IF NOT EXISTS update_log (
  id              bigserial PRIMARY KEY,
  symbol          varchar(12)  NOT NULL,
  run_at          timestamptz  NOT NULL DEFAULT now(),
  last_trade_date date,
  fetched_rows    int,
  status          varchar(16)  NOT NULL,   -- OK / PARTIAL / FAIL
  message         text
);
