"""
一次性初始化：创建数据库角色/库，写 .env，并执行 schema.sql。

用法（口令通过环境变量注入，避免明文留在命令历史/脚本中）:
  set PG_SUPER_PASSWORD=你的口令   (PowerShell)
  python tools/stockdb/init_db.py

也可交互执行：直接运行本脚本，提示输入口令时手动键入。
"""
from __future__ import annotations

import getpass
import os
import secrets
import sys
from pathlib import Path

import psycopg
from psycopg import sql

HERE = Path(__file__).resolve().parent
SUPER_USER = "postgres"
APP_USER = "stock_app"
APP_DB = "stockdb"
HOST = "127.0.0.1"
PORT = 5432


def get_super_password() -> str:
    p = os.environ.get("PG_SUPER_PASSWORD")
    if p:
        return p
    return getpass.getpass(f"请输入 PostgreSQL 超级用户 {SUPER_USER} 的口令: ")


def main() -> None:
    super_pw = get_super_password()
    app_pw = os.environ.get("STOCK_APP_PASSWORD") or secrets.token_urlsafe(12)

    admin = psycopg.connect(
        host=HOST, port=PORT, dbname=SUPER_USER, user=SUPER_USER, password=super_pw,
        autocommit=True,
    )
    try:
        # 1) 应用角色
        exists = admin.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_USER,)).fetchone()
        if not exists:
            admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                sql.Identifier(APP_USER), sql.Literal(app_pw)))
            print(f"[init] 已创建角色 {APP_USER}")
        else:
            admin.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                sql.Identifier(APP_USER), sql.Literal(app_pw)))
            print(f"[init] 角色 {APP_USER} 已存在，口令已重置")

        # 2) 数据库（CREATE DATABASE 不能进事务，autocommit 已开启）
        db_exists = admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (APP_DB,)).fetchone()
        if not db_exists:
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(APP_DB), sql.Identifier(APP_USER)))
            print(f"[init] 已创建数据库 {APP_DB}")
        else:
            print(f"[init] 数据库 {APP_DB} 已存在")
    finally:
        admin.close()

    # 3) 写 .env（gitignore 已排除）
    env_path = HERE / ".env"
    env_path.write_text(
        f"DATABASE_URL=postgresql://{APP_USER}:{app_pw}@{HOST}:{PORT}/{APP_DB}\n",
        encoding="utf-8",
    )
    print(f"[init] 已写入 {env_path}")

    # 4) 建表
    conn = psycopg.connect(host=HOST, port=PORT, dbname=APP_DB, user=APP_USER, password=app_pw)
    try:
        conn.execute((HERE / "schema.sql").read_text(encoding="utf-8"))
        conn.commit()
        print("[init] schema.sql 执行完成：表已创建")
    finally:
        conn.close()

    print("[OK] 初始化完成。可运行: python tools/stockdb/update.py --symbol 600519 --name 贵州茅台 --slug guizhou-maotai")


if __name__ == "__main__":
    main()
