#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""后端 API 自测：用 Flask test_client 跑一遍注册→审核→登录→进度→改密码→管理员的完整流程。
运行： python scripts/test_backend.py
"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

# 用临时数据库，避免污染真实数据
import db
_tmpdir = tempfile.mkdtemp()
db.DB_PATH = os.path.join(_tmpdir, "ham.db")
db.init_db()

# 让 app.py 的 _init() 用 admin/admin 作为管理员（避免手动 create_admin 造成重复）
os.environ["HAM_ADMIN_USER"] = "admin"
os.environ["HAM_ADMIN_PASS"] = "admin"

import app as backend
backend.db = db  # 让 app 使用我们的临时 db 模块
app = backend.app
app.config["TESTING"] = True

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

print("\n== 注册（免密，激活码非必选）")
# 1. 有激活码 → 直接 approved
r = c.post("/api/register", json={"username": "alice", "klass": "c", "code": "业余无线电"})
ok("正确激活码注册成功且直接 approved", r.status_code == 200 and r.get_json()["ok"] and r.get_json()["status"] == "approved", r.get_json())

r = c.post("/api/register", json={"username": "alice", "klass": "b", "code": "业余无线电"})
ok("重复注册被拒", r.status_code == 409, r.get_json())

r = c.post("/api/register", json={"username": "x", "klass": "b", "code": "业余无线电"})
ok("用户名过短被拒", r.status_code == 400)

r = c.post("/api/register", json={"username": "bob", "klass": "b", "code": "wrong"})
ok("错误激活码被拒", r.status_code == 400 and "激活码" in r.get_json()["error"], r.get_json())

r = c.post("/api/register", json={"username": "carol", "klass": "z", "code": "业余无线电"})
ok("非法类别被拒", r.status_code == 400)

# 2. 无激活码 → pending（待审核）
r = c.post("/api/register", json={"username": "nancy", "klass": "b", "code": ""})
ok("无激活码注册返回 pending", r.status_code == 200 and r.get_json()["ok"] and r.get_json()["status"] == "pending", r.get_json())

r = c.post("/api/register", json={"username": "nancy2", "klass": "b"})
ok("缺 code 字段注册返回 pending", r.status_code == 200 and r.get_json()["status"] == "pending", r.get_json())

print("\n== 激活码注册后免密登录（无需审核）")
r = c.post("/api/login", json={"username": "alice", "password": ""})
ok("激活码注册的 alice 免密直接登录成功", r.status_code == 200 and r.get_json()["user"]["status"] == "approved", r.get_json())
ok("登录返回 alice 类别 c", r.get_json()["user"]["klass"] == "c", r.get_json()["user"])
c.post("/api/logout")

print("\n== 无激活码注册的用户登录被拒（未审核）")
r = c.post("/api/login", json={"username": "nancy", "password": ""})
ok("无激活码注册的 nancy 未审核登录被拒", r.status_code == 403, r.get_json())

print("\n== 管理员登录")
r = c.post("/api/login", json={"username": "admin", "password": "admin"})
ok("管理员登录成功", r.status_code == 200 and r.get_json()["user"]["is_admin"], r.get_json())

# 管理员密码错误应被拒
c.post("/api/logout")
r = c.post("/api/login", json={"username": "admin", "password": "wrong"})
ok("管理员密码错误被拒", r.status_code == 401, r.get_json())
c.post("/api/login", json={"username": "admin", "password": "admin"})

r = c.get("/api/admin/users")
users = r.get_json()["users"]
ok("管理员可查看用户列表", r.status_code == 200 and len(users) == 4, users)
ok("用户列表含类别字段", "klass" in users[0], users[0])

ok("alice 注册类别为 c", [u for u in users if u["username"] == "alice"][0]["klass"] == "c")
ok("alice 已是 approved（无需再审核）", [u for u in users if u["username"] == "alice"][0]["status"] == "approved")
ok("nancy 是 pending", [u for u in users if u["username"] == "nancy"][0]["status"] == "pending")

# 审核 nancy
nancy_id = [u for u in users if u["username"] == "nancy"][0]["id"]
r = c.post(f"/api/admin/users/{nancy_id}/approve")
ok("审核通过 nancy", r.get_json()["ok"])

print("\n== 激活码管理（次激活/永久/有效期）")
r = c.get("/api/admin/codes")
codes = r.get_json()["codes"]
ok("列出激活码（含默认种子）", r.status_code == 200 and any(c["code"] == "业余无线电" for c in codes), codes)
ok("默认种子为永久激活(max_uses=0)", any(c["code"] == "业余无线电" and c["max_uses"] == 0 for c in codes))

# 次激活：限定 2 次
r = c.post("/api/admin/codes", json={"code": "限次码", "max_uses": 2})
ok("新增次激活码(max_uses=2)", r.status_code == 200 and r.get_json()["ok"], r.get_json())

r = c.post("/api/admin/codes", json={"code": "业余无线电"})
ok("重复添加已存在激活码被拒", r.status_code == 409, r.get_json())

# 有效期（天数）的激活码
r = c.post("/api/admin/codes", json={"code": "限天码", "expire_days": 30})
ok("新增有效期30天激活码", r.status_code == 200 and r.get_json()["ok"], r.get_json())

# expire_days 非正数应归一为永久
r = c.post("/api/admin/codes", json={"code": "永久码2", "expire_days": 0})
ok("expire_days=0 归一为永久", r.status_code == 200 and r.get_json()["ok"], r.get_json())

r = c.get("/api/admin/codes")
codes = r.get_json()["codes"]
limit_codes = [c for c in codes if c["code"] == "限次码"]
ok("限次码已存在", len(limit_codes) == 1, codes)
limit_id = limit_codes[0]["id"]

# 验证列表返回 expire_days 字段
days_codes = [c for c in codes if c["code"] == "限天码"]
ok("限天码 expire_days=30", len(days_codes) == 1 and days_codes[0]["expire_days"] == 30, days_codes)
perm2 = [c for c in codes if c["code"] == "永久码2"]
ok("永久码2 expire_days 为 None", len(perm2) == 1 and not perm2[0]["expire_days"], perm2)

# 停用/启用
r = c.post(f"/api/admin/codes/{limit_id}/toggle")
ok("停用激活码", r.get_json()["ok"] and r.get_json()["enabled"] == False, r.get_json())
c.post("/api/logout")
r = c.post("/api/register", json={"username": "usr1", "klass": "b", "code": "限次码"})
ok("停用的激活码无法注册", r.status_code == 400 and "激活码" in r.get_json()["error"], r.get_json())
c.post("/api/login", json={"username": "admin", "password": "admin"})
r = c.post(f"/api/admin/codes/{limit_id}/toggle")
ok("重新启用激活码", r.get_json()["ok"] and r.get_json()["enabled"] == True, r.get_json())

# 次激活：用 2 次后第 3 次应被拒
c.post("/api/logout")
r = c.post("/api/register", json={"username": "usr1", "klass": "b", "code": "限次码"})
ok("限次码第1次注册成功", r.status_code == 200 and r.get_json()["status"] == "approved", r.get_json())
r = c.post("/api/register", json={"username": "usr2", "klass": "b", "code": "限次码"})
ok("限次码第2次注册成功", r.status_code == 200 and r.get_json()["status"] == "approved", r.get_json())
r = c.post("/api/register", json={"username": "usr3", "klass": "b", "code": "限次码"})
ok("限次码用完第3次被拒", r.status_code == 400 and "用完" in r.get_json()["error"], r.get_json())

# 有效期内（30 天）的激活码
r = c.post("/api/register", json={"username": "usr5", "klass": "b", "code": "限天码"})
ok("有效期30天码注册成功", r.status_code == 200 and r.get_json()["status"] == "approved", r.get_json())

# 清理限次码与限天码/永久码2，以及测试用户
c.post("/api/login", json={"username": "admin", "password": "admin"})
r = c.get("/api/admin/codes")
codes = r.get_json()["codes"]
for cname in ["限次码", "限天码", "永久码2"]:
    cid = [c["id"] for c in codes if c["code"] == cname]
    if cid:
        r = c.post(f"/api/admin/codes/{cid[0]}/delete")
        ok("删除激活码 " + cname, r.get_json()["ok"])

# 清理测试用户 usr1~usr5（保持后续清空测试预期）
r = c.get("/api/admin/users")
users = r.get_json()["users"]
for uname in ["usr1", "usr2", "usr3", "usr5", "nancy2"]:
    uu = [u for u in users if u["username"] == uname]
    if uu:
        c.post(f"/api/admin/users/{uu[0]['id']}/delete")

c.post("/api/logout")

print("\n== 用户改类别")
c.post("/api/login", json={"username": "alice", "password": ""})
r = c.post("/api/user/klass", json={"klass": "a"})
ok("用户可自行切换类别到 a", r.get_json()["ok"] and r.get_json()["klass"] == "a", r.get_json())

r = c.get("/api/me")
ok("me 返回更新后的类别 a", r.get_json()["user"]["klass"] == "a", r.get_json()["user"])

r = c.post("/api/user/klass", json={"klass": "z"})
ok("切换非法类别被拒", r.status_code == 400)

print("\n== 改密码")
r = c.post("/api/user/password", json={"password": ""})
ok("普通用户留空保持免密", r.get_json()["ok"], r.get_json())

# 普通用户设密码后，登录需要密码
r = c.post("/api/user/password", json={"password": "abc123"})
ok("普通用户设密码", r.get_json()["ok"])
c.post("/api/logout")
r = c.post("/api/login", json={"username": "alice", "password": ""})
ok("设密码后空密码登录被拒", r.status_code == 401, r.get_json())
r = c.post("/api/login", json={"username": "alice", "password": "abc123"})
ok("设密码后正确密码登录", r.status_code == 200, r.get_json())

# 管理员改密码需至少 6 位
c.post("/api/logout")
c.post("/api/login", json={"username": "admin", "password": "admin"})
r = c.post("/api/user/password", json={"password": "123"})
ok("管理员密码过短被拒", r.status_code == 400, r.get_json())
r = c.post("/api/user/password", json={"password": "newpass1"})
ok("管理员改密码成功", r.get_json()["ok"])
c.post("/api/logout")
r = c.post("/api/login", json={"username": "admin", "password": "newpass1"})
ok("管理员用新密码登录", r.status_code == 200, r.get_json())

print("\n== 进度读写")
c.post("/api/logout")
c.post("/api/login", json={"username": "alice", "password": "abc123"})
r = c.get("/api/progress/b")
ok("初始进度为空", r.get_json()["ok"] and r.get_json()["data"] is None)

prog = {"progress": {"1": {"r": 3, "w": 1}}, "wrong": [5, 7], "seq": 10}
r = c.post("/api/progress/b", json=prog)
ok("保存 B 类进度", r.get_json()["ok"])

r = c.get("/api/progress/b")
ok("读回 B 类进度一致", r.get_json()["data"] is not None and json.loads(r.get_json()["data"])["seq"] == 10)

r = c.get("/api/progress/a")
ok("A 类进度为空（隔离）", r.get_json()["data"] is None)

r = c.get("/api/progress/x")
ok("非法类别被拒", r.status_code == 400)

print("\n== 未登录访问保护")
c.post("/api/logout")
r = c.get("/api/progress/b")
ok("未登录读进度返回 401", r.status_code == 401)

r = c.get("/api/admin/users")
ok("未登录访问管理接口返回 401", r.status_code == 401)

print("\n== 普通用户无管理权限")
c.post("/api/login", json={"username": "alice", "password": "abc123"})
r = c.get("/api/admin/users")
ok("普通用户访问管理接口返回 403", r.status_code == 403)

print("\n== 管理员清空/重置")
c.post("/api/logout")
c.post("/api/login", json={"username": "admin", "password": "newpass1"})
r = c.post("/api/admin/reset-progress")
ok("重置进度成功", r.get_json()["ok"])

r = c.post("/api/admin/clear-users")
ok("清空非管理员用户", r.get_json()["ok"] and r.get_json()["deleted"] >= 1, r.get_json())

r = c.get("/api/admin/users")
users2 = r.get_json()["users"]
ok("清空后只剩管理员", len(users2) == 1 and users2[0]["username"] == "admin", users2)

print("\n== 管理员不可删除自己")
admin_id = users2[0]["id"]
r = c.post(f"/api/admin/users/{admin_id}/delete")
ok("删除管理员被拒", r.status_code == 400, r.get_json())

print("\n================ 结果: %d 通过 / %d 失败 ================" % (pass_n, fail_n))
sys.exit(1 if fail_n else 0)
