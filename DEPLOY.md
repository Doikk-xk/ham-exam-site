# 部署到 Ubuntu 小主机 + 域名访问

网站是**纯静态**的：没有后端、没有数据库、不需要 Node 运行时。
题库数据已内嵌在 `web/data/exam.js`，不发任何跨域请求，扔进静态目录就能跑。

**推荐路径：`ham-b-deploy.tar.gz` 里的两条命令 —— 一条装，一条卸。**
手动步骤见文末附录，只在你想自己掌控每一步时才用。

---

## 一、一键部署（推荐）

### 1. 上传

```bash
# 在 Windows 上（Git Bash / PowerShell 均可）
scp ham-b-deploy.tar.gz youruser@your-server.example.com:/tmp/
```

### 2. 体检（只读，不改任何东西）

```bash
cd /tmp && tar xzf ham-b-deploy.tar.gz
bash /tmp/ham-b-deploy/preflight.sh --domain exam.example.com
```

会打印：系统版本、nginx 是否在跑、80/443/8080/8090 端口占用情况、ufw 现状、
已有的 nginx 站点列表、是否装过本站。**先看清楚再决定怎么装。**

重点看两件事：**80 端口是否已被 nginx 占用**、以及 8080 是否空着。

### 3. 安装

```bash
sudo bash /tmp/ham-b-deploy/install.sh -y
```

不带 `--domain` 时，本站**只监听 8080**，完全不碰 80，最安全。
之后用反向代理指向 `http://<内网IP>:8080` 就行。

想让它自己在 80 上也占一个按域名区分的 server 块：

```bash
sudo bash /tmp/ham-b-deploy/install.sh -y --domain exam.example.com
```

装完会打印访问地址和一次本地自检结果（HTTP 200 + 题库文件可读才算过）。

### 4. 卸载（一条命令清干净）

```bash
sudo bash /tmp/ham-b-deploy/uninstall.sh          # 会问一次 y/N
sudo bash /tmp/ham-b-deploy/uninstall.sh --dry-run # 先看会删什么
```

连证书、连本次新装的软件包一起清：

```bash
sudo bash /tmp/ham-b-deploy/uninstall.sh -y --purge-cert --purge-packages
```

详细选项见包内 `README.md`。

---

## 二、对外访问的两条路

**方案 A：DNS 直接指向本机**

1. 域名商处加 A 记录：`exam.example.com → 本机公网 IP`；
2. 路由器 / 防火墙放行 80（要 HTTPS 再放 443）；
3. 上证书：
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d exam.example.com
   ```

**方案 B：复用现有反向代理（推荐）**

1. 反向代理（Lucky / Nginx Proxy Manager 等）→ Web 服务 → 新建反向代理；
2. 前端域名 `exam.example.com`，后端 `http://<本机内网IP>:8080`；
3. HTTPS 交给反向代理的 ACME 自动申请。

好处：**这台机器的 80 端口都不用碰，也不用改 DNS、不用动路由器。**

---

## 三、排查

| 现象 | 检查 |
|---|---|
| 打开是 nginx 默认页 | `server_name` 拼错；或走了 IP 访问（IP 访问请带 `:8080`） |
| 页面空白 | F12 Console：多为 `data/exam.js` 或 `images/` 404，查文件权限（脚本已设 644/755） |
| 样式没加载 | `/assets/style.css` 404 —— Linux 路径**区分大小写** |
| 题目图片不显示 | `/images/q0988.jpg` 之类 404，确认 `images/` 一起传了 |
| 学习记录丢失 | localStorage 按**域名**存。换域名/端口进度不跟随 → 设置页「导出 / 导入」迁移 |
| 服务起不来 | `systemctl status ham-b` 或 `journalctl -u ham-b -n 50` |
| 端口被占 | `ss -lntp \| grep 8080`，换 `--port` |
| nginx 重载失败 | 脚本会明确告诉你「旧配置仍在生效」，排查 `journalctl -u nginx -n 30` |

---

## 四、只在本机用（不起服务器）

`index.html` 里全是相对路径的普通 `<script src>`，没有 fetch，
所以**直接双击 `web/index.html`** 就能用（Chrome / Edge / Cent Browser 都行）。
只是 `file://` 下的学习记录同样只留在本地浏览器里。

---

## 五、题库更新后重新生成

官方发新版题库时：

```bash
# 1. 重新拉数据（覆盖 data/extract 下的 CSV 与配图）
python scripts/fetch_assets.py

# 2. 重新生成 data/exam.js 与 web/images/
python scripts/build_site.py

# 3. 传上去；或直接重跑 install.sh（幂等，等于更新）
```

章节名称表在 `build_site.py` 顶部的 `CHAPTERS` / `GROUPS`，官方调整编号时改这两个字典。

---

## 附录：手动部署（不想用脚本时）

<details>
<summary>展开看手动步骤</summary>

### 1. 传文件

```bash
sudo mkdir -p /var/www/ham-b
rsync -av --delete web/ youruser@your-server.example.com:/var/www/ham-b/
sudo chown -R www-data:www-data /var/www/ham-b
sudo find /var/www/ham-b -type d -exec chmod 755 {} \;
sudo find /var/www/ham-b -type f -exec chmod 644 {} \;
```

### 2. nginx 配置

新建 `/etc/nginx/sites-available/ham-b`：

```nginx
server {
    listen       8080;
    listen  [::]:8080;
    server_name  exam.example.com;      # 只用 8080 + 反向代理时可填 _

    root  /var/www/ham-b;
    index index.html;
    charset utf-8;

    access_log /var/log/nginx/ham-b.access.log;
    error_log  /var/log/nginx/ham-b.error.log;

    # 纯静态站点，hash 路由不需要 SPA 回落；缺文件就老实 404，方便排查
    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(?:jpg|jpeg|png|gif|svg|webp|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # 题库与脚本每次校验，避免更新后拿到旧缓存
    location ~* \.(?:js|css|json)$ {
        expires -1;
    }

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
```

启用并校验：

```bash
sudo ln -s /etc/nginx/sites-available/ham-b /etc/nginx/sites-enabled/ham-b
sudo nginx -t && sudo systemctl reload nginx
```

> 注意：这里用 `=404` 而不是 `try_files $uri $uri/ /index.html`。
> 本站是 hash 路由（`#/practice`），不需要 SPA 回落；写成回落反而会把
> 拼错的路径也返回首页，出问题时更难排查。

### 3. systemd 单元（替代 nginx）

```ini
# /etc/systemd/system/ham-b.service
[Unit]
Description=HAM B practice site (static HTTP)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/ham-b
ExecStart=/usr/bin/python3 -m http.server 8090 --bind 0.0.0.0 --directory /var/www/ham-b
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ham-b
```

### 4. 手动卸载

```bash
sudo systemctl disable --now ham-b.service 2>/dev/null
sudo rm -f /etc/systemd/system/ham-b.service
sudo rm -f /etc/nginx/sites-enabled/ham-b /etc/nginx/sites-available/ham-b
sudo rm -rf /var/www/ham-b
sudo rm -f /var/log/nginx/ham-b.access.log /var/log/nginx/ham-b.error.log
sudo systemctl daemon-reload && sudo systemctl reload nginx
sudo ufw status | grep ham-b     # 有就 ufw delete allow 8080/tcp
```

</details>
