# ham-b 部署工具包

业余无线电 B 类练题站的**一键安装 / 一键卸载**工具。纯静态站点，装完只占用几 MB。

> 已在本地沙箱里把「装 → 更新 → 演练卸载 → 真卸载」两条链路（nginx 模式 / systemd 模式）
> 完整跑过 **63 项检查，全部通过**。沙箱用桩程序模拟了 `systemctl`/`nginx`/`ufw`/`ss`/`curl`，
> 不动真实系统。其中专门验证过：端口被别的服务占用时拒绝安装、重装时端口被本站占用不误报、
> `--dry-run` 零副作用、卸载不误伤同级目录。

---

## 一、三十秒流程

```bash
# 1. 上传（在你 Windows 上执行）
scp ham-b-deploy.tar.gz youruser@your-server.example.com:/tmp/

# 2. 解包 + 体检（在服务器上执行，只读不改）
cd /tmp && tar xzf ham-b-deploy.tar.gz
bash /tmp/ham-b-deploy/preflight.sh --domain exam.example.com

# 3. 安装
sudo bash /tmp/ham-b-deploy/install.sh -y --domain exam.example.com
```

装完访问 `http://<内网IP>:8080/` 或 `http://exam.example.com/`。

---

## 二、卸载（一条命令清干净）

```bash
sudo bash /tmp/ham-b-deploy/uninstall.sh
```

会问你一次 `y/N`。想先看看会删什么：

```bash
sudo bash /tmp/ham-b-deploy/uninstall.sh --dry-run
```

想连证书、连本次新装的软件包一起清：

```bash
sudo bash /tmp/ham-b-deploy/uninstall.sh -y --purge-cert --purge-packages
```

**卸载清单**（全部按安装时写的 `manifest.env` 精确回收）：

| 对象 | 位置 |
|---|---|
| 网站文件 | `/var/www/ham-b` |
| nginx 配置 | `/etc/nginx/sites-available/ham-b` + `sites-enabled/ham-b` 软链 |
| 服务 | `ham-b.service`（停用 + 删除 + daemon-reload） |
| 日志 | `/var/log/nginx/ham-b.{access,error}.log` |
| 防火墙 | 安装时新增的 ufw 放行规则 |
| 清单 | `/var/lib/ham-b` |
| 临时文件 | `/tmp/ham-b-*` |

**绝不触碰**：原有的 nginx 站点、`conf.d`、默认站点、反向代理条目、DNS 记录、其它任何服务。

> 卸完脚本会自动复查一遍有没有残留并打印结果。
> 两件事服务器上做不到、需要手动处理：**反向代理里的条目** 和 **域名商处的 DNS 记录**。

---

## 三、安装选项

| 选项 | 说明 | 默认 |
|---|---|---|
| `--domain NAME` | 站点域名，给了才监听 80 端口 | 空（只监听 8080） |
| `--alias a,b` | 额外域名，空格分隔后写入 `server_name` | 无 |
| `--port N` | 直连端口 | `8080` |
| `--http-port N` | 额外监听端口，`off` 关闭 | `80` |
| `--mode nginx\|systemd\|auto` | 服务方式 | `auto`（有 nginx 就用 nginx） |
| `--root DIR` | 网站目录 | `/var/www/ham-b` |
| `--state DIR` | 清单目录 | `/var/lib/ham-b` |
| `--src DIR` | 站点源码目录（含 index.html） | 自动查找 |
| `--install-deps` | 缺 nginx 时自动 apt 安装 | 不装，降级 systemd |
| `--no-firewall` | 不动 ufw | 会放行端口 |
| `-y, --yes` | 免交互 | 交互确认 |

**重复执行 `install.sh` 等于「更新网站」**：会清空网站目录重放一遍新文件，配置和清单原地更新。官方发新版题库后，重新生成 `web/` 再跑一次即可。

---

## 四、两种模式怎么选

**nginx 模式（默认，推荐）**
适合服务器上已经有 nginx 的情况。新开一个独立的 `server` 块，靠 `server_name` 区分，与现有站点互不干扰。带 gzip、静态缓存、独立日志。

> 若机器上 nginx 已在服务其它站点，**80 端口可能已被占用**。所以：
> - 不带 `--domain` 时，本站只监听 `8080`，完全不碰 80，最安全；
> - 带 `--domain` 时，会在 80 上再加一个按域名区分的 server 块（nginx 支持同一端口多个站点，不冲突）；
> - 想彻底不碰 80，就只装 8080，再让反向代理过去（见第五节 B）。

**systemd 模式（零依赖）**
`python3 -m http.server` 跑在专用端口，由 systemd 托管。服务器没有 nginx、或你不想动 nginx 时用它。个人使用完全够。

```bash
sudo bash install.sh -y --mode systemd --port 8090
```

---

## 五、对外访问的两条路

**A. DNS 直接解析到本机**
域名加 A 记录指向本机公网 IP，路由器 / 防火墙放行 80（和 443）。然后：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d exam.example.com
```

证书续期由 `certbot.timer` 自动处理。**注意**：certbot 会改写我们写的 server 块（加 443 段）——这是正常的，卸载脚本认的是文件名，照样能干净删掉。

**B. 复用现有反向代理（推荐）**
在反向代理（Lucky / Nginx Proxy Manager / Caddy 等）里新建 Web 服务 / 反向代理：前端域名 `exam.example.com`，后端填 `http://<本机内网IP>:8080`。HTTPS 证书交给反向代理的 ACME 自动申请。这样本机的 80 端口都不用开。

> 若已有站点都走反向代理，这样做最省事：不用碰 DNS，也不用动路由器。

---

## 六、排查

| 现象 | 原因 / 处理 |
|---|---|
| `nginx -t` 失败 | 脚本已自动回滚，你原有配置没动。看报错里的行号 |
| 打开是 nginx 默认页 | 域名对不上 `server_name`；或走了 IP 访问（IP 访问请带 `:8080`） |
| 页面空白 | F12 看 Console，一般是 `data/exam.js` 404，检查文件权限（脚本已设 644/755） |
| 图片不显示 | `/images/q0988.jpg` 之类 404，确认 `images/` 一起传了 |
| 做题记录没了 | localStorage 按域名存。换域名/端口进度不会跟过去，用设置页「导出/导入」迁移 |
| 服务起不来 | `systemctl status ham-b` 或 `journalctl -u ham-b -n 50` |
| 端口被占 | `ss -lntp \| grep 8080`，换 `--port` |

---

## 七、包内容

```
ham-b-deploy/
├─ install.sh       一键安装（幂等、可回滚）
├─ uninstall.sh     一键卸载（精确回收，支持 --dry-run）
├─ preflight.sh     只读体检：系统 / nginx / 端口 / 防火墙现状
├─ README.md        本文件
└─ web/             站点文件（28 个，约 1 MB）
   ├─ index.html
   ├─ assets/{app.js,style.css}
   ├─ data/exam.js            1143 题内嵌题库
   └─ images/                 24 张配图题
```

站点无后端、无 fetch，所有资源相对路径，**双击 `web/index.html` 也能直接用**。
