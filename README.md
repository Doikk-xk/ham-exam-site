# 业余无线电 A/B/C 类练题站

自托管的**业余无线电台操作技术能力验证**在线练题系统。基于《业余无线电台操作技术能力验证题库（2025 年版）》A / B / C 三类完整题库，支持逐题解析、模拟考试、错题本与多用户独立进度。

整个站点打包为**单个 Docker 容器**（Flask + SQLite），静态页面与 API 由同一进程提供，**不依赖 nginx 或外部数据库**，适合部署在家用服务器或 NAS 上自用、与朋友分享。

---

## 功能

| 模块 | 说明 |
|---|---|
| 题库 | A 类 683 题 / B 类 1143 题 / C 类 1282 题，按章节二级分类 |
| 练习 | 顺序练习、随机练习、章节专项 |
| 模拟考试 | 按各类别真实规则组卷计时（见下表），交卷后逐题回顾 |
| 逐题解析 | 判分后展示解析，含【口诀】助记；覆盖 A 类 683、B 类 1143、C 类 1087 题 |
| 错题本 / 收藏 | 自动记录做错题目，支持收藏重点题 |
| 多用户 | 用户名注册、独立学习进度、云同步到服务端 |
| 管理面板 | 用户审核、激活码管理（次激活 / 永久 / 有效期）、清空数据、重置进度 |

考试规则（来自题库附录，A / C 类数值以官方最新公告为准）：

| 类别 | 题数 | 单选 | 多选 | 时长 | 合格 |
|---|---|---|---|---|---|
| A 类 | 30 | 25 | 5 | 30 分钟 | 25 题 |
| B 类 | 60 | 45 | 15 | 60 分钟 | 45 题 |
| C 类 | 80 | 60 | 20 | 90 分钟 | 60 题 |

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/Doikk-xk/ham-exam-site.git
cd ham-exam-site

cp .env.example .env        # 改掉里面的默认管理员密码
docker compose up -d --build
```

浏览器打开 `http://<主机IP>:8080/`，用 `.env` 里的管理员账号登录。

> **国内网络拉不到 Docker Hub 基础镜像时**：在 `.env` 中设置
> `BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim`
> 后重新 `docker compose up -d --build` 即可。

### 方式二：docker run

```bash
docker build -t ham-exam-site .

docker run -d --name ham-exam \
  -p 8080:8080 \
  -v "$PWD/appdata:/data" \
  -e HAM_ADMIN_USER=admin \
  -e HAM_ADMIN_PASS=改成你的密码 \
  -e HAM_REGISTER_CODE=业余无线电 \
  --restart unless-stopped \
  ham-exam-site
```

国内网络可在构建时指定加速源：

```bash
docker build \
  --build-arg BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim \
  -t ham-exam-site .
```

### 方式三：NAS 图形界面（绿联 UGOS Pro / 群晖 DSM 等）

1. **镜像**：在能联网的机器上 `docker build` 后
   `docker save -o ham-exam.tar ham-exam-site:latest` 导出，
   在 NAS 的 Docker 应用里「导入镜像」；或让 NAS 通过加速源拉取已发布的镜像。
2. **容器**：新建容器 → 端口映射 `8080 → 8080`。
3. **存储**：把 NAS 上的一个目录（如 `/volume1/docker/ham-exam`）映射到容器内 `/data`。
4. **环境变量**：按需添加 `HAM_ADMIN_USER`、`HAM_ADMIN_PASS`、`HAM_REGISTER_CODE`。
5. 启动后访问 `http://<NAS的IP>:8080/`。

> 容器默认以 root 运行在容器内部，因此 NAS 上任意属主的目录都能直接写入，无需处理权限。
> 若希望改用非 root 运行，见 `Dockerfile` 末尾注释。
>
> 若 NAS 无法直连 Docker Hub 拉取镜像，用上面第 1 步的 `docker save` / 导入方式最省事。

### 方式四：不用 Docker（裸机 systemd）

仓库内 `deploy/install.sh` 提供 Ubuntu / Debian 一键安装（gunicorn + systemd）：

```bash
sudo bash deploy/install.sh -y --mode systemd --port 8080
```

加 `--domain exam.example.com` 可同时写入 nginx 反向代理配置。详见 `DEPLOY.md`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HAM_DB_PATH` | `/data/ham.db` | SQLite 数据库路径 |
| `HAM_WEB_DIR` | `/app/web` | 静态站点目录 |
| `HAM_PORT` | `8080` | 容器内监听端口 |
| `HAM_ADMIN_USER` | `admin` | 管理员用户名（仅首次启动创建） |
| `HAM_ADMIN_PASS` | `admin` | 管理员初始密码，**务必修改** |
| `HAM_REGISTER_CODE` | `业余无线电` | 注册激活码种子（激活码表为空时写入） |
| `HAM_SECRET_KEY` | 自动生成 | 会话加密密钥。留空则在数据卷内自动生成并复用，重启不掉登录 |

---

## 使用说明

### 注册与准入

注册有两条路径，可在注册页留空激活码：

- **填写激活码** → 立即生效，可直接登录
- **留空激活码** → 状态为待审核，需管理员在「管理面板」点通过

激活码可在管理面板中创建，支持三种形态：

| 类型 | 行为 |
|---|---|
| 永久激活 | 不限使用次数 |
| 次激活 | 限定使用次数，用完自动失效 |
| 有效期 | 可选「N 天」，自创建之日起 N 天后过期 |

三者可组合，例如「5 次 + 有效期 7 天」。

### 管理员

首次启动自动创建 `HAM_ADMIN_USER` / `HAM_ADMIN_PASS` 指定的账号。
登录后在「设置」页修改密码（管理员密码至少 6 位）。

> 默认密码 `admin` 仅供首次登录，公开部署前请务必修改。

---

## 数据与备份

所有持久化状态都在挂载到 `/data` 的目录里：

| 文件 | 内容 |
|---|---|
| `ham.db` | 用户、学习进度、激活码 |
| `.secret_key` | 会话密钥（未显式配置 `HAM_SECRET_KEY` 时自动生成） |

备份就是复制这个目录；迁移就是把目录搬到新机器再挂载，用户与进度原样保留。

```bash
# 备份
tar czf ham-exam-backup-$(date +%F).tar.gz appdata/
```

---

## 从源码重建题库（可选）

`web/data/exam.js` 与 `web/images/` 已随仓库提供，**开箱即用，无需构建**。
如需修改章节名称、考试规则或题图映射，可重新生成：

```bash
python scripts/build_site.py          # 读 data/*.csv → 写 web/data/exam.js
python scripts/gen_explanations.py    # 生成逐题解析 → data/explanations_b.json
```

> 依赖仅为 Python 3 标准库。
> `data/` 目录可用环境变量 `HAM_DATA_DIR` 指向其他位置。

---

## 测试

```bash
pip install flask                     # 后端测试需要
python scripts/test_backend.py        # API 测试
node   scripts/test_site.js           # 前端测试（需要 jsdom）
python scripts/test_static.py         # 静态服务与路径穿越防护
```

---

## 目录结构

```
.
├── Dockerfile              容器构建
├── docker-compose.yml      推荐部署方式
├── entrypoint.sh           启动脚本（建目录 / 生成持久化 secret key）
├── .env.example            环境变量样例
├── backend/
│   ├── app.py              Flask 路由与鉴权（API + 静态服务）
│   ├── db.py               SQLite 数据层
│   └── requirements.txt
├── web/                    前端（含构建好的题库数据与题图）
│   ├── index.html
│   ├── assets/             app.js · style.css
│   ├── data/exam.js        window.__EXAM_DATA__ = {a,b,c}
│   └── images/             题目附图
├── data/                   题库源数据（CSV）与解析 JSON，用于重建
├── scripts/                构建与测试脚本
└── deploy/                 裸机安装脚本（systemd / nginx）
```

---

## 数据来源与致谢

- 题库：《业余无线电台操作技术能力验证题库（2025 年版）》，中国无线电协会业余无线电分会（CRAC）发布。
- CSV 转换：[crac-amateur-radio-exam-questions-2025-csv](https://github.com/bi7cwq/crac-amateur-radio-exam-questions-2025-csv)
  （作者 Xie Youtian，bi7cwq@qsl.net），采用 **WTFPL** 许可，允许自由复制、修改与再分发。本项目对题库数据的使用遵循该许可，特此致谢。
- 题目解析由本项目编写，可能存在偏差，**仅供练习参考**；考试请以官方题库与最新法规为准。

---

## 许可

本项目代码采用 [MIT License](LICENSE)。
题库数据的著作权与许可见上方「数据来源与致谢」，不受本项目 MIT 许可覆盖。

---

## 发布到 Docker Hub（维护者）

镜像仅含 Python 与站点文件，无原生扩展，构建多架构镜像无额外成本：

```bash
docker login
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <dockerhub-id>/ham-exam-site:latest \
  -t <dockerhub-id>/ham-exam-site:1.0.0 \
  --push .
```

发布后，使用者可省去构建步骤，直接：

```bash
docker run -d --name ham-exam -p 8080:8080 \
  -v "$PWD/appdata:/data" \
  -e HAM_ADMIN_PASS=改成你的密码 \
  --restart unless-stopped \
  <dockerhub-id>/ham-exam-site:latest
```

---

## 安全提示

- 首次部署后立即修改管理员密码。
- 面向公网时建议置于反向代理（nginx / Lucky / Caddy 等）之后并启用 HTTPS；
  容器仅监听 HTTP，不自行处理证书。
- 激活码与管理员密码请勿提交到版本库；`.gitignore` 已排除 `.env` 与 `appdata/`。
