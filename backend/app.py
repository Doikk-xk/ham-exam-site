#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""业余无线电 A/B/C 类练题站 · Flask 后端。

提供：
- 静态站点服务（../web）
- 用户注册 / 登录 / 登出（开放注册 + 管理员审核）
- 按用户 + 类别读写学习进度
- 管理员接口（审核用户、删除、清空、重置进度）

运行： python app.py  （默认 0.0.0.0:8080）
"""
import os
import secrets
import functools

from flask import Flask, request, session, jsonify, send_from_directory, abort
from werkzeug.security import generate_password_hash, check_password_hash

import db

# 允许通过环境变量覆盖路径（部署用）
if os.environ.get("HAM_DB_PATH"):
    db.DB_PATH = os.environ["HAM_DB_PATH"]

BASE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.environ.get("HAM_WEB_DIR") or os.path.join(BASE, "..", "web")
WEB_DIR = os.path.abspath(WEB_DIR)

# 管理员初始账号：环境变量可覆盖；默认 admin / admin（首次登录后请尽快修改）
ADMIN_USERNAME = os.environ.get("HAM_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("HAM_ADMIN_PASS", "admin")

ALLOWED_CLASSES = {"a", "b", "c"}

# 注册激活码：默认种子值（首次启动写入数据库，之后可在管理员面板增删改）
DEFAULT_REGISTER_CODE = os.environ.get("HAM_REGISTER_CODE", "业余无线电")

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get(
    "HAM_SECRET_KEY",
    secrets.token_hex(32),  # 每次重启会变；生产环境建议设固定值
)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 进度 JSON 上限 2MB


# ------------------------------------------------------------------ 鉴权
def current_user():
    uid = session.get("uid")
    if uid is None:
        return None
    return db.get_user_by_id(uid)


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        u = current_user()
        if u is None:
            return jsonify({"ok": False, "error": "未登录"}), 401
        return fn(u, *args, **kwargs)
    return wrapper


def admin_required(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        u = current_user()
        if u is None:
            return jsonify({"ok": False, "error": "未登录"}), 401
        if not u["is_admin"]:
            return jsonify({"ok": False, "error": "无权限"}), 403
        return fn(u, *args, **kwargs)
    return wrapper


def user_pub(u):
    return {
        "id": u["id"],
        "username": u["username"],
        "is_admin": bool(u["is_admin"]),
        "status": u["status"],
        "klass": u["klass"],
    }


# ------------------------------------------------------------------ 认证接口
@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    klass = data.get("klass") or "b"
    code = (data.get("code") or "").strip()

    if not (3 <= len(username) <= 32):
        return jsonify({"ok": False, "error": "用户名长度需在 3～32 个字符之间"}), 400
    if klass not in ALLOWED_CLASSES:
        return jsonify({"ok": False, "error": "请选择有效的考试类别"}), 400
    if db.get_user_by_username(username):
        return jsonify({"ok": False, "error": "用户名已存在"}), 409

    # 激活码非必选：填写则校验并消费（成功即 approved）；留空则走管理员审核（pending）。
    if code:
        ok_code, reason, _cid = db.check_register_code(code)
        if not ok_code:
            err_map = {
                "not_found": "激活码错误",
                "disabled": "激活码已停用",
                "expired": "激活码已过期",
                "exhausted": "激活码使用次数已用完",
            }
            return jsonify({"ok": False, "error": err_map.get(reason, "激活码无效")}), 400
        uid = db.create_user(username, "", klass)
        db.set_user_status(uid, "approved")
        return jsonify({"ok": True, "status": "approved", "msg": "注册成功，可直接登录"})
    else:
        # 无激活码：待管理员审核
        uid = db.create_user(username, "", klass)
        return jsonify({"ok": True, "status": "pending", "msg": "注册成功，等待管理员审核"})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    u = db.get_user_by_username(username)
    if u is None:
        return jsonify({"ok": False, "error": "用户不存在"}), 401

    # 管理员必须有密码；普通用户（免密）只校验用户名
    if u["is_admin"]:
        if not u["password_hash"] or not check_password_hash(u["password_hash"], password):
            return jsonify({"ok": False, "error": "密码错误"}), 401
    elif u["password_hash"]:
        # 兼容：若普通用户曾设过密码则需校验
        if not check_password_hash(u["password_hash"], password):
            return jsonify({"ok": False, "error": "密码错误"}), 401

    if u["status"] != "approved":
        return jsonify({"ok": False, "error": "账号尚未通过审核"}), 403

    session.clear()
    session["uid"] = u["id"]
    return jsonify({"ok": True, "user": user_pub(u)})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    u = current_user()
    if u is None:
        return jsonify({"ok": True, "user": None})
    return jsonify({"ok": True, "user": user_pub(u)})


# ------------------------------------------------------------------ 进度接口
@app.get("/api/progress/<klass>")
@login_required
def get_progress(u, klass):
    if klass not in ALLOWED_CLASSES:
        return jsonify({"ok": False, "error": "无效类别"}), 400
    data = db.get_progress(u["id"], klass)
    return jsonify({"ok": True, "data": data})


@app.post("/api/progress/<klass>")
@login_required
def put_progress(u, klass):
    if klass not in ALLOWED_CLASSES:
        return jsonify({"ok": False, "error": "无效类别"}), 400
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "进度数据格式错误"}), 400
    import json as _json
    db.save_progress(u["id"], klass, _json.dumps(data, ensure_ascii=False))
    return jsonify({"ok": True})


# ------------------------------------------------------------------ 用户类别
@app.post("/api/user/klass")
@login_required
def set_klass(u):
    data = request.get_json(silent=True) or {}
    klass = data.get("klass")
    if klass not in ALLOWED_CLASSES:
        return jsonify({"ok": False, "error": "无效类别"}), 400
    db.set_user_klass(u["id"], klass)
    return jsonify({"ok": True, "klass": klass})


@app.post("/api/user/password")
@login_required
def set_password(u):
    data = request.get_json(silent=True) or {}
    new_password = data.get("password") or ""

    # 管理员必须改密码；普通用户可留空（保持免密）
    if u["is_admin"] and len(new_password) < 6:
        return jsonify({"ok": False, "error": "密码至少 6 位"}), 400

    db.set_password(u["id"], generate_password_hash(new_password) if new_password else "")
    return jsonify({"ok": True})


# ------------------------------------------------------------------ 管理员接口
@app.get("/api/admin/users")
@admin_required
def admin_users(u):
    return jsonify({"ok": True, "users": db.list_users()})


@app.post("/api/admin/users/<int:uid>/approve")
@admin_required
def admin_approve(u, uid):
    target = db.get_user_by_id(uid)
    if target is None:
        return jsonify({"ok": False, "error": "用户不存在"}), 404
    db.set_user_status(uid, "approved")
    return jsonify({"ok": True})


@app.post("/api/admin/users/<int:uid>/delete")
@admin_required
def admin_delete(u, uid):
    target = db.get_user_by_id(uid)
    if target is None:
        return jsonify({"ok": False, "error": "用户不存在"}), 404
    if target["is_admin"]:
        return jsonify({"ok": False, "error": "不能删除管理员"}), 400
    db.delete_user(uid)
    return jsonify({"ok": True})


@app.post("/api/admin/clear-users")
@admin_required
def admin_clear_users(u):
    n = db.clear_non_admin_users()
    return jsonify({"ok": True, "deleted": n})


@app.post("/api/admin/reset-progress")
@admin_required
def admin_reset_progress(u):
    n = db.reset_all_progress()
    return jsonify({"ok": True, "reset": n})


# ------------------------------------------------------------------ 激活码管理
@app.get("/api/admin/codes")
@admin_required
def admin_codes(u):
    return jsonify({"ok": True, "codes": db.list_register_codes()})


@app.post("/api/admin/codes")
@admin_required
def admin_add_code(u):
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not (1 <= len(code) <= 32):
        return jsonify({"ok": False, "error": "激活码长度需在 1～32 个字符之间"}), 400
    # max_uses：0=永久（不限次），>0=限定次数
    try:
        max_uses = int(data.get("max_uses") or 0)
    except (TypeError, ValueError):
        max_uses = 0
    if max_uses < 0:
        return jsonify({"ok": False, "error": "使用次数不能为负数"}), 400
    # expire_days：可选，有效天数（从创建时起算）；0/空 = 永久有效
    expire_days = data.get("expire_days") or None
    try:
        expire_days = int(expire_days) if expire_days else None
    except (TypeError, ValueError):
        expire_days = None
    if expire_days is not None and expire_days <= 0:
        expire_days = None

    added_id = db.add_register_code(code, max_uses=max_uses, expire_days=expire_days)
    if added_id is None:
        return jsonify({"ok": False, "error": "该激活码已存在"}), 409
    return jsonify({"ok": True, "id": added_id})


@app.post("/api/admin/codes/<int:cid>/toggle")
@admin_required
def admin_toggle_code(u, cid):
    codes = db.list_register_codes()
    target = next((c for c in codes if c["id"] == cid), None)
    if target is None:
        return jsonify({"ok": False, "error": "激活码不存在"}), 404
    db.set_register_code_enabled(cid, not target["enabled"])
    return jsonify({"ok": True, "enabled": not target["enabled"]})


@app.post("/api/admin/codes/<int:cid>/delete")
@admin_required
def admin_delete_code(u, cid):
    codes = db.list_register_codes()
    target = next((c for c in codes if c["id"] == cid), None)
    if target is None:
        return jsonify({"ok": False, "error": "激活码不存在"}), 404
    db.delete_register_code(cid)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ 静态文件
@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    # 防止路径穿越
    if ".." in path or path.startswith("/"):
        return abort(404)
    full = os.path.join(WEB_DIR, path)
    if not os.path.exists(full) or not os.path.isfile(full):
        return abort(404)
    return send_from_directory(WEB_DIR, path)


# ------------------------------------------------------------------ 初始化
# 无论 gunicorn（app:app）还是直接运行，都在模块加载时初始化数据库与管理员。
# 幂等：已存在则跳过。
_db_initialized = False


def _init():
    global _db_initialized
    if _db_initialized:
        return
    db.init_db()
    db.ensure_klass_column()
    db.ensure_register_code_columns()
    db.create_admin(ADMIN_USERNAME, generate_password_hash(ADMIN_PASSWORD))
    db.seed_register_code(DEFAULT_REGISTER_CODE)
    _db_initialized = True


_init()


if __name__ == "__main__":
    port = int(os.environ.get("HAM_PORT", "8080"))
    print(f"[ham] listening on 0.0.0.0:{port}  web={WEB_DIR}  db={db.DB_PATH}")
    app.run(host="0.0.0.0", port=port, debug=False)
