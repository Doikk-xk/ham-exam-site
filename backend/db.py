#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLite 数据库层：用户、进度、审核状态。"""
import os
import sqlite3
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ham.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',   -- pending / approved
            klass TEXT NOT NULL DEFAULT 'b',          -- a / b / c（用户所选类别）
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS progress (
            user_id INTEGER NOT NULL,
            klass TEXT NOT NULL,                       -- a / b / c
            data TEXT NOT NULL,                        -- JSON 字符串
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, klass),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS register_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,        -- 1 启用 / 0 停用
            max_uses INTEGER NOT NULL DEFAULT 0,       -- 0 = 永久（不限次），>0 = 次激活（限定次数）
            used_count INTEGER NOT NULL DEFAULT 0,     -- 已使用次数
            expire_days INTEGER,                       -- 有效天数（从创建起 N 天后过期）；NULL/0 = 永久有效
            created_at INTEGER NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()


def ensure_register_code_columns():
    """兼容旧库：为 register_codes 表补齐 max_uses/used_count/expire_days 列。"""
    conn = get_conn()
    cols = [r[1] for r in conn.execute("PRAGMA table_info(register_codes)").fetchall()]
    if "max_uses" not in cols:
        conn.execute("ALTER TABLE register_codes ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 0")
    if "used_count" not in cols:
        conn.execute("ALTER TABLE register_codes ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0")
    if "expire_days" not in cols:
        conn.execute("ALTER TABLE register_codes ADD COLUMN expire_days INTEGER")
    conn.commit()
    conn.close()


def ensure_klass_column():
    """兼容旧库：若 users 表缺 klass 列则补上。"""
    conn = get_conn()
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "klass" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN klass TEXT NOT NULL DEFAULT 'b'")
        conn.commit()
    conn.close()


def create_admin(username, password_hash):
    """首次启动时创建管理员账号（若不存在）。"""
    conn = get_conn()
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin, status, klass, created_at) VALUES (?, ?, 1, 'approved', 'b', ?)",
            (username, password_hash, int(time.time())),
        )
        conn.commit()
    conn.close()


def get_user_by_username(username):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row


def get_user_by_id(user_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row


def create_user(username, password_hash, klass="b"):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, is_admin, status, klass, created_at) VALUES (?, ?, 0, 'pending', ?, ?)",
        (username, password_hash, klass, int(time.time())),
    )
    conn.commit()
    uid = cur.lastrowid
    conn.close()
    return uid


def set_user_klass(user_id, klass):
    conn = get_conn()
    conn.execute("UPDATE users SET klass = ? WHERE id = ?", (klass, user_id))
    conn.commit()
    conn.close()


def list_users():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, username, is_admin, status, klass, created_at FROM users ORDER BY created_at ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def set_user_status(user_id, status):
    conn = get_conn()
    conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
    conn.commit()
    conn.close()


def set_password(user_id, password_hash):
    conn = get_conn()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    conn.commit()
    conn.close()


def delete_user(user_id):
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()


def clear_non_admin_users():
    """删除所有非管理员用户（连带进度）。"""
    conn = get_conn()
    cur = conn.execute("DELETE FROM users WHERE is_admin = 0")
    conn.commit()
    n = cur.rowcount
    conn.close()
    return n


def reset_all_progress():
    conn = get_conn()
    cur = conn.execute("DELETE FROM progress")
    conn.commit()
    n = cur.rowcount
    conn.close()
    return n


def get_progress(user_id, klass):
    conn = get_conn()
    row = conn.execute(
        "SELECT data FROM progress WHERE user_id = ? AND klass = ?", (user_id, klass)
    ).fetchone()
    conn.close()
    return row["data"] if row else None


def save_progress(user_id, klass, data):
    conn = get_conn()
    conn.execute(
        "INSERT INTO progress (user_id, klass, data, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(user_id, klass) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (user_id, klass, data, int(time.time())),
    )
    conn.commit()
    conn.close()


# ------------------------------------------------------------------ 注册激活码
def seed_register_code(code):
    """若激活码表为空，用默认激活码初始化（永久激活，不限次）。"""
    conn = get_conn()
    n = conn.execute("SELECT COUNT(*) FROM register_codes").fetchone()[0]
    if n == 0:
        conn.execute(
            "INSERT INTO register_codes (code, enabled, max_uses, used_count, expire_days, created_at) "
            "VALUES (?, 1, 0, 0, NULL, ?)",
            (code, int(time.time())),
        )
        conn.commit()
    conn.close()


def list_register_codes():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, code, enabled, max_uses, used_count, expire_days, created_at "
        "FROM register_codes ORDER BY created_at ASC, id ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_register_code(code, max_uses=0, expire_days=None):
    """新增激活码。max_uses=0 表示永久（不限次），>0 表示次激活；expire_days=None/0 表示永久有效。
    若 code 已存在则返回 None（不覆盖）。返回新增行 id（或 None 表示已存在）。"""
    conn = get_conn()
    row = conn.execute("SELECT id FROM register_codes WHERE code = ?", (code,)).fetchone()
    if row is not None:
        conn.close()
        return None
    cur = conn.execute(
        "INSERT INTO register_codes (code, enabled, max_uses, used_count, expire_days, created_at) "
        "VALUES (?, 1, ?, 0, ?, ?)",
        (code, max_uses, expire_days, int(time.time())),
    )
    conn.commit()
    uid = cur.lastrowid
    conn.close()
    return uid


def set_register_code_enabled(code_id, enabled):
    conn = get_conn()
    conn.execute("UPDATE register_codes SET enabled = ? WHERE id = ?", (1 if enabled else 0, code_id))
    conn.commit()
    conn.close()


def delete_register_code(code_id):
    conn = get_conn()
    conn.execute("DELETE FROM register_codes WHERE id = ?", (code_id,))
    conn.commit()
    conn.close()


def check_register_code(code):
    """校验并消费一个激活码。返回 (ok, reason, code_id)。
    ok=True 表示有效且已成功消费（used_count+1）；否则返回失败原因。
    失败原因：not_found / disabled / expired / exhausted。"""
    conn = get_conn()
    row = conn.execute(
        "SELECT id, enabled, max_uses, used_count, expire_days, created_at FROM register_codes WHERE code = ?",
        (code,),
    ).fetchone()
    if row is None:
        conn.close()
        return False, "not_found", None
    if not row["enabled"]:
        conn.close()
        return False, "disabled", row["id"]
    # 有效期校验：expire_days 天（从创建时起算）
    if row["expire_days"]:
        expire_at = row["created_at"] + row["expire_days"] * 86400
        if expire_at <= int(time.time()):
            conn.close()
            return False, "expired", row["id"]
    # 次数校验（max_uses=0 表示不限次）
    if row["max_uses"] > 0 and row["used_count"] >= row["max_uses"]:
        conn.close()
        return False, "exhausted", row["id"]
    # 消费：used_count +1
    conn.execute(
        "UPDATE register_codes SET used_count = used_count + 1 WHERE id = ?", (row["id"],)
    )
    conn.commit()
    conn.close()
    return True, "ok", row["id"]
