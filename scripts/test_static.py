#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""集成测试：验证 Flask app 同时服务静态文件 + API，用 test_client（无需起真实端口）。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import db
_tmpdir = tempfile.mkdtemp()
db.DB_PATH = os.path.join(_tmpdir, "ham.db")
db.init_db()
from werkzeug.security import generate_password_hash
db.create_admin("admin", generate_password_hash("admin"))

import app as backend
backend.db = db
app = backend.app
app.config["TESTING"] = True
app.secret_key = "test"

pass_n = 0
fail_n = 0
def ok(name, cond, extra=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print("  ok   " + name)
    else:
        fail_n += 1
        print("  FAIL " + name + ("  <- " + str(extra) if extra else ""))

c = app.test_client()

print("\n== 静态文件服务")
r = c.get("/")
ok("首页返回 200", r.status_code == 200, r.status_code)
ok("首页是 HTML", b"<!DOCTYPE html>" in r.data or b"<title" in r.data)

r = c.get("/data/exam.js")
ok("exam.js 返回 200", r.status_code == 200, r.status_code)
ok("exam.js 含三类数据", b'"a":' in r.data and b'"b":' in r.data and b'"c":' in r.data)

r = c.get("/assets/app.js")
ok("app.js 返回 200", r.status_code == 200, r.status_code)

r = c.get("/assets/style.css")
ok("style.css 返回 200", r.status_code == 200, r.status_code)

# 图片
import os as _os
imgs = [f for f in _os.listdir(os.path.join(backend.WEB_DIR, "images")) if f.endswith(".jpg")]
if imgs:
    r = c.get("/images/" + imgs[0])
    ok("图片可访问", r.status_code == 200, r.status_code)

print("\n== 路径穿越防护")
r = c.get("/../etc/passwd")
ok("路径穿越返回 404", r.status_code == 404, r.status_code)
r = c.get("/data/../backend/db.py")
ok("穿越访问后端源码被拒", r.status_code == 404, r.status_code)

print("\n== 不存在的文件")
r = c.get("/nonexistent.html")
ok("404", r.status_code == 404, r.status_code)

print("\n== API 与静态共存")
r = c.get("/api/me")
ok("/api/me 返回 200", r.status_code == 200 and r.get_json()["ok"])

r = c.post("/api/login", json={"username": "admin", "password": "admin"})
ok("管理员登录", r.get_json()["ok"])

print("\n================ 结果: %d 通过 / %d 失败 ================" % (pass_n, fail_n))
sys.exit(1 if fail_n else 0)
