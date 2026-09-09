"""
CLIVIA 股票估值仓库 —— PostgreSQL 访问层
- 连接串从 tools/stockdb/.env 读取 DATABASE_URL（.env 不入库 git）
- 提供建表、幂等 upsert、查询等基础能力
"""
from __future__ import annotations

import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent

def _load_env() -> None:
    # 优先 tools/stockdb/.env，其次仓库根 .env
    for p in (HERE / ".env", HERE.parent.parent / ".env"):
        if p.exists():
            load_dotenv(p, override=False)

_load_env()

def get_dsn() -> str:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        raise RuntimeError("缺少 DATABASE_URL：请先复制 tools/stockdb/.env.example 为 .env 并填写")
    return dsn

def connect():
    """返回 psycopg3 连接（dict 行工厂）。调用方负责关闭/事务。"""
    return psycopg.connect(get_dsn(), row_factory=dict_row)

# --------------------------------------------------------------------------- #
# 写入
# --------------------------------------------------------------------------- #
def upsert_basic(conn, symbol: str, name: str, slug: str, industry: str | None = None) -> None:
    conn.execute(
        """
        INSERT INTO stock_basic (symbol, name, slug, sw_industry, updated_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (symbol) DO UPDATE
          SET name = EXCLUDED.name, slug = EXCLUDED.slug,
              sw_industry = COALESCE(EXCLUDED.sw_industry, stock_basic.sw_industry),
              updated_at = now()
        """,
        (symbol, name, slug, industry),
    )

def upsert_daily(conn, rows: list[tuple]) -> int:
    """rows: [(symbol, trade_date, close, pe_ttm, pb, dv_ttm), ...] 幂等覆盖。"""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO stock_daily (symbol, trade_date, close, pe_ttm, pb, dv_ttm)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, trade_date) DO UPDATE
              SET close = EXCLUDED.close, pe_ttm = EXCLUDED.pe_ttm,
                  pb = EXCLUDED.pb, dv_ttm = EXCLUDED.dv_ttm
            """,
            rows,
        )
    return len(rows)

def replace_dividends(conn, symbol: str, events: list[tuple]) -> int:
    """events: [(ex_date, per_share, announce_date, record_date, raw)] 先删后插保证一致。"""
    conn.execute("DELETE FROM stock_dividend WHERE symbol = %s", (symbol,))
    if not events:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO stock_dividend (symbol, ex_date, per_share, announce_date, record_date, raw)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [(symbol, *e) for e in events],
        )
    return len(events)

def log_update(conn, symbol: str, last_date, fetched_rows: int, status: str, message: str = "") -> None:
    conn.execute(
        """
        INSERT INTO update_log (symbol, last_trade_date, fetched_rows, status, message)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (symbol, last_date, fetched_rows, status, message),
    )

# --------------------------------------------------------------------------- #
# 查询
# --------------------------------------------------------------------------- #
def query_daily(conn, symbol: str) -> list[dict]:
    """全量升序日线。"""
    return conn.execute(
        "SELECT symbol, trade_date, close, pe_ttm, pb, dv_ttm FROM stock_daily "
        "WHERE symbol = %s ORDER BY trade_date ASC",
        (symbol,),
    ).fetchall()

def query_dividends(conn, symbol: str) -> list[dict]:
    return conn.execute(
        "SELECT * FROM stock_dividend WHERE symbol = %s ORDER BY ex_date ASC",
        (symbol,),
    ).fetchall()
