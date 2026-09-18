#!/usr/bin/env bash
# ==============================================================================
#  业余无线电 A/B/C 类练题站 · 一键安装 (Ubuntu / Debian)
#
#  用法：
#     sudo bash install.sh -y --mode systemd           # 推荐：gunicorn 后端 + 8080
#     sudo bash install.sh -y --mode systemd --port 8080
#     sudo bash install.sh -y --domain exam.example.com   # nginx 反代（需 nginx）
#
#  卸载： sudo bash uninstall.sh        （连数据库一起清干净）
#
#  设计要点：
#    · 幂等 —— 重复执行等于「更新」，不会重复写配置
#    · 后端 = Flask + SQLite（用户/进度/审核），gunicorn 承载
#    · 记录清单 —— 写入 /var/lib/ham-b/manifest.env，uninstall 精确回收
#    · 数据库 —— /var/lib/ham-b/ham.db（www-data 可写）
# ==============================================================================

set -euo pipefail

APP="ham-b"
WEB_ROOT_DEFAULT="/var/www/ham-b"
STATE_DIR_DEFAULT="/var/lib/ham-b"
VENV_DIR_DEFAULT="/var/lib/ham-b/venv"
UNIT_PATH="${HAM_B_UNIT_PATH:-/etc/systemd/system/ham-b.service}"
NGINX_AVAIL="${HAM_B_NGINX_AVAIL:-/etc/nginx/sites-available/ham-b}"
NGINX_ENABLED="${HAM_B_NGINX_ENABLED:-/etc/nginx/sites-enabled/ham-b}"
ACCESS_LOG="${HAM_B_ACCESS_LOG:-/var/log/nginx/ham-b.access.log}"
ERROR_LOG="${HAM_B_ERROR_LOG:-/var/log/nginx/ham-b.error.log}"
MARKER="由 ham-b install.sh 生成"
NGINX_RELOAD_FAILED=0

C_RST='\033[0m'; C_OK='\033[32m'; C_WARN='\033[33m'; C_ERR='\033[31m'; C_INFO='\033[36m'; C_B='\033[1m'
say()  { printf "%b\n" "${C_INFO}▸${C_RST} $*"; }
ok()   { printf "%b\n" "${C_OK}✓${C_RST} $*"; }
warn() { printf "%b\n" "${C_WARN}!${C_RST} $*"; }
err()  { printf "%b\n" "${C_ERR}✗${C_RST} $*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { printf "%b\n" "${C_B}────────────────────────────────────────────────────────────${C_RST}"; }

has_re() { grep -qE "$1" <<< "${2:-}"; }

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---------------------------------------------------------------- 参数
DOMAIN=""
DOMAIN_ALIASES=""
PORT="8080"
HTTP_PORT="80"
MODE="systemd"
WEB_ROOT="$WEB_ROOT_DEFAULT"
STATE_DIR="$STATE_DIR_DEFAULT"
VENV_DIR="$VENV_DIR_DEFAULT"
SRC_DIR=""
ASSUME_YES=0
FIREWALL=1
INSTALL_DEPS=0
ADMIN_USER="admin"
ADMIN_PASS="admin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)       DOMAIN="${2:-}"; shift 2 ;;
    --alias)        DOMAIN_ALIASES="${2:-}"; shift 2 ;;
    --port)         PORT="${2:-}"; shift 2 ;;
    --http-port)    HTTP_PORT="${2:-}"; shift 2 ;;
    --mode)         MODE="${2:-}"; shift 2 ;;
    --root)         WEB_ROOT="${2:-}"; shift 2 ;;
    --state)        STATE_DIR="${2:-}"; shift 2 ;;
    --src)          SRC_DIR="${2:-}"; shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --no-firewall)  FIREWALL=0; shift ;;
    -y|--yes)       ASSUME_YES=1; shift ;;
    -h|--help)      usage ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "需要 root 权限，请用：sudo bash $0 $*"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port 必须是数字"
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || die "--domain 格式不对"

# ---------------------------------------------------------------- 定位源码
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "$SRC_DIR" ]]; then
  for c in "$SCRIPT_DIR/.." "$SCRIPT_DIR" "$PWD" "/tmp/ham-b-deploy"; do
    if [[ -f "$c/web/index.html" && -f "$c/backend/app.py" ]]; then
      SRC_DIR="$(cd "$c" && pwd)"; break
    fi
  done
fi
[[ -n "$SRC_DIR" && -f "$SRC_DIR/web/index.html" ]] || die "找不到站点源码（应含 web/index.html）。用 --src 指定。"
[[ -f "$SRC_DIR/backend/app.py" ]] || die "源码不完整，缺少 backend/app.py"
for f in web/assets/app.js web/assets/style.css web/data/exam.js; do
  [[ -f "$SRC_DIR/$f" ]] || die "源码不完整，缺少 $f"
done

hr
say "安装 ${C_B}${APP}${C_RST}（Flask + SQLite 后端）  ·  源码：$SRC_DIR"
hr

# ---------------------------------------------------------------- 系统检查
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  say "系统：${PRETTY_NAME:-unknown}"
  case "${ID:-}" in
    ubuntu|debian|linuxmint|pop|raspbian) ;;
    *) warn "非 Ubuntu/Debian 系，脚本会尽量适配。" ;;
  esac
fi

RUN_USER="www-data"
RUN_GROUP="www-data"
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  RUN_USER="nobody"
  if getent group nogroup >/dev/null 2>&1; then RUN_GROUP="nogroup"; else RUN_GROUP="nobody"; fi
  warn "系统没有 www-data，改用 ${RUN_USER}:${RUN_GROUP}"
fi

command -v python3 >/dev/null 2>&1 || die "需要 python3：sudo apt install -y python3"
PY="$(command -v python3)"
say "Python：$($PY --version 2>&1)"

NGINX_PRESENT=0
command -v nginx >/dev/null 2>&1 && NGINX_PRESENT=1
[[ "$MODE" == "nginx" || "$MODE" == "systemd" ]] || die "--mode 只能是 nginx 或 systemd"

# 防误删护栏
case "$WEB_ROOT" in
  /|/var|/var/www|/usr|/usr/share|/etc|/opt|/home|/root|/srv|/tmp|"")
    die "--root 指向 $WEB_ROOT 太危险，脚本拒绝执行。" ;;
esac

# 端口占用预检
IS_UPDATE=0
[[ -f "$STATE_DIR/manifest.env" || -e "$NGINX_AVAIL" || -e "$UNIT_PATH" ]] && IS_UPDATE=1
if command -v ss >/dev/null 2>&1; then
  SS_LINE="$(ss -lntpH "sport = :$PORT" 2>/dev/null | head -3 || true)"
  if [[ -n "$SS_LINE" && $IS_UPDATE -eq 0 ]]; then
    warn "端口 $PORT 已被占用："
    printf '%s\n' "$SS_LINE" | sed 's/^/      /'
    [[ "$MODE" == "nginx" ]] && die "nginx 模式需要独占端口 $PORT。"
  fi
fi

# ---------------------------------------------------------------- 确认
if [[ $ASSUME_YES -eq 0 ]]; then
  echo
  echo "将要执行："
  echo "  1) 部署网站文件 -> $WEB_ROOT（web + backend）"
  echo "  2) 创建 Python venv 并安装 Flask + gunicorn"
  echo "  3) 写入 systemd 服务（gunicorn 承载 Flask，监听 $PORT）"
  [[ "$MODE" == "nginx" ]] && echo "  3b) 写入 nginx 反代配置 -> $NGINX_AVAIL"
  echo "  4) 初始化 SQLite 数据库（含管理员账号 ${ADMIN_USER}）"
  echo "  5) 写安装清单 -> $STATE_DIR/manifest.env"
  echo
  read -r -p "继续？[y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { warn "已取消"; exit 0; }
fi

# ---------------------------------------------------------------- 1. 部署文件
say "部署网站文件 ..."
mkdir -p "$WEB_ROOT"
if [[ -n "$(ls -A "$WEB_ROOT" 2>/dev/null)" ]]; then
  say "  目标目录已有内容，按「更新」处理（清空后重放）"
fi
find "$WEB_ROOT" -mindepth 1 -delete 2>/dev/null || true
cp -a "$SRC_DIR/web/." "$WEB_ROOT/"
mkdir -p "$WEB_ROOT/../ham-b-backend" 2>/dev/null || true
BACKEND_DIR="$STATE_DIR/backend"
mkdir -p "$STATE_DIR"
# backend 放到 STATE_DIR，与数据库同区，权限统一
find "$STATE_DIR/backend" -mindepth 1 -delete 2>/dev/null || true
mkdir -p "$STATE_DIR/backend"
cp -a "$SRC_DIR/backend/." "$STATE_DIR/backend/"
# 修正 backend 里 WEB_DIR 指向（用绝对路径动态定位，无需改代码）
chown -R "$RUN_USER:$RUN_GROUP" "$WEB_ROOT" "$STATE_DIR"
find "$WEB_ROOT" -type d -exec chmod 755 {} +
find "$WEB_ROOT" -type f -exec chmod 644 {} +
FILE_N=$(find "$WEB_ROOT" -type f | wc -l | tr -d ' ')
ok "网站文件 $FILE_N 个 -> $WEB_ROOT"
ok "后端代码 -> $STATE_DIR/backend"

# ---------------------------------------------------------------- 2. venv + 依赖
say "准备 Python 虚拟环境 ..."
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  if ! "$PY" -m venv "$VENV_DIR" 2>/dev/null; then
    # ensurepip 不可用时（Ubuntu 精简系统常见），自动补装 python3-venv
    say "ensurepip 不可用，安装 python3-venv ..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq python3-venv python3-pip >/dev/null || \
      die "安装 python3-venv 失败，请手动：sudo apt install -y python3-venv python3-pip"
    "$PY" -m venv "$VENV_DIR" || die "创建 venv 仍失败"
  fi
fi
VENV_PY="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"
if [[ ! -x "$VENV_PIP" ]]; then
  "$VENV_PY" -m ensurepip --upgrade 2>/dev/null || true
fi
say "安装依赖（flask gunicorn）..."
"$VENV_PIP" install --quiet --disable-pip-version-check flask gunicorn 2>&1 | tail -3 || die "pip 安装失败"
chown -R "$RUN_USER:$RUN_GROUP" "$VENV_DIR"
ok "venv 就绪 -> $VENV_DIR"

# secret key 持久化：首次生成，之后复用，避免重启导致 session 失效
SECRET_FILE="$STATE_DIR/secret.key"
if [[ ! -f "$SECRET_FILE" ]]; then
  head -c 48 /dev/urandom | base64 | tr -d '\n' > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
SECRET_KEY="$(cat "$SECRET_FILE")"
chown "$RUN_USER:$RUN_GROUP" "$SECRET_FILE" 2>/dev/null || true
ok "secret key 持久化 -> $SECRET_FILE"

# ---------------------------------------------------------------- 3. systemd 服务
CREATED_PATHS=("$WEB_ROOT" "$STATE_DIR")
CREATED_SYMLINKS=()
SERVICE_NAME="$(basename "$UNIT_PATH")"

if [[ "$MODE" == "nginx" ]]; then
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  # 后端跑在 127.0.0.1:PORT，nginx 反代
  cat > "$UNIT_PATH" <<EOF
# ${MARKER}
[Unit]
Description=HAM A/B/C practice site (Flask backend)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${STATE_DIR}/backend
Environment=HAM_SECRET_KEY=${SECRET_KEY}
Environment=HAM_ADMIN_USER=${ADMIN_USER}
Environment=HAM_ADMIN_PASS=${ADMIN_PASS}
Environment=HAM_DB_PATH=${STATE_DIR}/ham.db
Environment=HAM_WEB_DIR=${WEB_ROOT}
ExecStart=${VENV_DIR}/bin/gunicorn -w 2 -b 127.0.0.1:${PORT} app:app
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  CREATED_PATHS+=("$UNIT_PATH")

  SERVER_NAME="${DOMAIN:-_}"
  [[ -n "$DOMAIN_ALIASES" ]] && SERVER_NAME="${SERVER_NAME} ${DOMAIN_ALIASES//,/ }"
  {
    echo "# ${MARKER}  ·  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "# 卸载：sudo bash uninstall.sh"
    echo "server {"
    echo "    listen 80;"
    echo "    listen [::]:80;"
    echo "    server_name ${SERVER_NAME};"
    echo "    charset utf-8;"
    echo "    access_log ${ACCESS_LOG};"
    echo "    error_log  ${ERROR_LOG};"
    echo "    client_max_body_size 4m;"
    echo "    location / {"
    echo "        proxy_pass http://127.0.0.1:${PORT};"
    echo "        proxy_set_header Host \$host;"
    echo "        proxy_set_header X-Real-IP \$remote_addr;"
    echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
    echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
    echo "    }"
    echo "}"
  } > "$NGINX_AVAIL"
  CREATED_PATHS+=("$NGINX_AVAIL")
  if [[ ! -L "$NGINX_ENABLED" && ! -e "$NGINX_ENABLED" ]]; then
    ln -s "$NGINX_AVAIL" "$NGINX_ENABLED"
    CREATED_SYMLINKS+=("$NGINX_ENABLED")
  fi
  if nginx -t 2>/tmp/ham-b-nginx-test.log; then
    ok "nginx -t 通过"
  else
    err "nginx -t 失败，回滚配置 ..."
    cat /tmp/ham-b-nginx-test.log >&2 || true
    for s in "${CREATED_SYMLINKS[@]:-}"; do [[ -n "$s" ]] && rm -f "$s"; done
    rm -f "$NGINX_AVAIL"
    die "已回滚。"
  fi
else
  # ---------------- systemd 模式：gunicorn 直接监听 0.0.0.0:PORT ----------------
  cat > "$UNIT_PATH" <<EOF
# ${MARKER}
[Unit]
Description=HAM A/B/C practice site (Flask backend)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${STATE_DIR}/backend
Environment=HAM_SECRET_KEY=${SECRET_KEY}
Environment=HAM_ADMIN_USER=${ADMIN_USER}
Environment=HAM_ADMIN_PASS=${ADMIN_PASS}
Environment=HAM_DB_PATH=${STATE_DIR}/ham.db
Environment=HAM_WEB_DIR=${WEB_ROOT}
ExecStart=${VENV_DIR}/bin/gunicorn -w 2 -b 0.0.0.0:${PORT} app:app
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  CREATED_PATHS+=("$UNIT_PATH")
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "$SERVICE_NAME 已启动（监听 $PORT）"
else
  err "服务启动失败，最近日志："
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager >&2 || true
  die "已停止。请检查上面日志。"
fi

# ---------------------------------------------------------------- 4. 防火墙
UFW_RULES_ADDED=""
if [[ $FIREWALL -eq 1 ]] && command -v ufw >/dev/null 2>&1; then
  UFW_OUT="$(ufw status 2>/dev/null || true)"
  if has_re "^Status: active" "$UFW_OUT"; then
    for p in "$PORT" $([[ -n "$DOMAIN" && "$HTTP_PORT" != "off" ]] && echo "$HTTP_PORT"); do
      if has_re "(^|[^0-9])${p}/tcp" "$UFW_OUT"; then
        say "ufw 已有 ${p}/tcp 规则，跳过"
      elif ufw allow "${p}/tcp" comment 'ham-b' >/dev/null 2>&1; then
        UFW_RULES_ADDED="${UFW_RULES_ADDED}${p}/tcp "
        ok "ufw 放行 ${p}/tcp"
      else
        warn "ufw 放行 ${p}/tcp 失败"
      fi
    done
  else
    say "ufw 未启用，跳过"
  fi
fi

# ---------------------------------------------------------------- 5. 清单
PREV_MANIFEST=""
[[ -f "$STATE_DIR/manifest.env" ]] && PREV_MANIFEST="$(cat "$STATE_DIR/manifest.env" 2>/dev/null || true)"
prev_get() {
  [[ -n "$PREV_MANIFEST" ]] || return 0
  sed -n "s/^$1='\(.*\)'$/\1/p" <<< "$PREV_MANIFEST" | head -1
}
union_words() {
  printf '%s %s' "${1:-}" "${2:-}" | tr ' ' '\n' | sed '/^$/d' | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/ *$//'
}
UFW_RULES_ADDED="$(union_words "$UFW_RULES_ADDED" "$(prev_get UFW_RULES_ADDED)")"

{
  echo "# ham-b 安装清单 —— install.sh 生成，uninstall.sh 读取"
  echo "INSTALLED_AT='$(date -Iseconds)'"
  echo "MODE='${MODE}'"
  echo "SERVICE_NAME='${SERVICE_NAME}'"
  echo "DOMAIN='${DOMAIN}'"
  echo "DOMAIN_ALIASES='${DOMAIN_ALIASES}'"
  echo "PORT='${PORT}'"
  echo "HTTP_PORT='${HTTP_PORT}'"
  echo "RUN_USER='${RUN_USER}'"
  echo "RUN_GROUP='${RUN_GROUP}'"
  echo "WEB_ROOT='${WEB_ROOT}'"
  echo "STATE_DIR='${STATE_DIR}'"
  echo "VENV_DIR='${VENV_DIR}'"
  echo "NGINX_AVAIL='${NGINX_AVAIL}'"
  echo "NGINX_ENABLED='${NGINX_ENABLED}'"
  echo "UNIT_PATH='${UNIT_PATH}'"
  echo "ACCESS_LOG='${ACCESS_LOG}'"
  echo "ERROR_LOG='${ERROR_LOG}'"
  echo "SRC_DIR='${SRC_DIR}'"
  echo "FILE_COUNT='${FILE_N}'"
  echo "NGINX_WAS_PRESENT='${NGINX_PRESENT}'"
  echo "UFW_RULES_ADDED='${UFW_RULES_ADDED}'"
  echo "CREATED_PATHS='${CREATED_PATHS[*]}'"
  echo "CREATED_SYMLINKS='${CREATED_SYMLINKS[*]:-}'"
} > "$STATE_DIR/manifest.env"
chmod 600 "$STATE_DIR/manifest.env"
ok "安装清单 -> $STATE_DIR/manifest.env"

# ---------------------------------------------------------------- 6. 自检
echo
say "本地自检 ..."
SELFTEST="跳过（没有 curl）"
if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -s -o /tmp/ham-b-selftest.html -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT}/" || echo 000)"
  API_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT}/api/me" || echo 000)"
  if [[ "$CODE" == "200" && "$API_CODE" == "200" ]]; then
    SELFTEST="首页 HTTP 200 · /api/me HTTP 200"
    ok "$SELFTEST"
  else
    SELFTEST="首页 HTTP ${CODE} · /api/me HTTP ${API_CODE}（异常）"
    err "$SELFTEST"
    journalctl -u ham-b.service -n 20 --no-pager >&2 || true
  fi
fi

# ---------------------------------------------------------------- 汇总
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[[ -n "$LAN_IP" ]] || LAN_IP="<服务器IP>"
hr
printf "%b\n" "${C_OK}${C_B}安装完成${C_RST}"
hr
echo "  网站目录   : $WEB_ROOT"
echo "  后端目录   : $STATE_DIR/backend"
echo "  数据库     : $STATE_DIR/ham.db"
echo "  服务       : $SERVICE_NAME"
echo "  监听端口   : $PORT"
echo "  访问地址   : http://${LAN_IP}:${PORT}/"
[[ -n "$DOMAIN" ]] && echo "               http://${DOMAIN}/  (若已解析)"
echo "  自检结果   : $SELFTEST"
echo
printf "%b\n" "${C_WARN}管理员账号${C_RST}：用户名 ${ADMIN_USER}，初始密码 ${ADMIN_PASS}（首次登录后请尽快在设置里改）"
echo
echo "  卸载：sudo bash $(dirname "$0")/uninstall.sh   （连用户数据库一起清）"
hr
