#!/usr/bin/env bash
# ==============================================================================
#  业余无线电 B 类练题站 · 一键卸载
#
#  把 install.sh 装进去的东西全部清掉，精确按清单回收，不动你其它服务。
#
#  用法：
#     sudo bash uninstall.sh                 # 交互确认后全部卸载
#     sudo bash uninstall.sh --dry-run       # 只看会删什么，不真删
#     sudo bash uninstall.sh -y               # 免确认
#     sudo bash uninstall.sh --keep-files     # 只摘掉 nginx/服务配置，保留网站文件
#     sudo bash uninstall.sh -y --purge-cert  # 连 certbot 证书一起删
#     sudo bash uninstall.sh -y --purge-packages  # 连本次新装的软件包一起卸（有保护）
#
#  会被清掉的对象：
#     · systemd 单元 ham-b.service（停用 + 删除 + daemon-reload）
#     · nginx 站点配置 /etc/nginx/sites-available/ham-b 及其 sites-enabled 软链
#     · 网站目录 /var/www/ham-b
#     · 状态目录 /var/lib/ham-b（含后端代码、Python venv、SQLite 数据库 = 用户与进度）
#     · nginx 日志 /var/log/nginx/ham-b.*.log
#     · 本脚本加的 ufw 放行规则
#     · 上传到 /tmp 的部署包与临时文件
#  不会动：
#     · 原有的任何 nginx 站点、默认站点、反向代理条目、DNS 记录
#  注意：
#     · 卸载会连同数据库一起删除，所有用户账号与学习进度将不可恢复。
# ==============================================================================

set -uo pipefail

# ---- 默认值（清单缺失时回退到这里；环境变量可覆盖，用于自定义布局/测试） ----
DEFAULT_WEB_ROOT="${HAM_B_WEB_ROOT:-/var/www/ham-b}"
DEFAULT_STATE_DIR="${HAM_B_STATE_DIR:-/var/lib/ham-b}"
DEFAULT_NGINX_AVAIL="${HAM_B_NGINX_AVAIL:-/etc/nginx/sites-available/ham-b}"
DEFAULT_NGINX_ENABLED="${HAM_B_NGINX_ENABLED:-/etc/nginx/sites-enabled/ham-b}"
DEFAULT_UNIT_PATH="${HAM_B_UNIT_PATH:-/etc/systemd/system/ham-b.service}"
DEFAULT_ACCESS_LOG="${HAM_B_ACCESS_LOG:-/var/log/nginx/ham-b.access.log}"
DEFAULT_ERROR_LOG="${HAM_B_ERROR_LOG:-/var/log/nginx/ham-b.error.log}"

MANIFEST="${HAM_B_MANIFEST:-${DEFAULT_STATE_DIR}/manifest.env}"

DRY_RUN=0
ASSUME_YES=0
KEEP_FILES=0
PURGE_CERT=0
PURGE_PKGS=0
FIREWALL=1

C_RST='\033[0m'; C_OK='\033[32m'; C_WARN='\033[33m'; C_ERR='\033[31m'; C_INFO='\033[36m'; C_B='\033[1m'
say()  { printf "%b\n" "${C_INFO}▸${C_RST} $*"; }
ok()   { printf "%b\n" "${C_OK}✓${C_RST} $*"; }
warn() { printf "%b\n" "${C_WARN}!${C_RST} $*"; }
err()  { printf "%b\n" "${C_ERR}✗${C_RST} $*" >&2; }
skip() { printf "%b\n" "  ${C_WARN}·${C_RST} $*"; }
hr()   { printf "%b\n" "${C_B}────────────────────────────────────────────────────────────${C_RST}"; }

# ⚠ 不要写 `producer | grep -q PAT`：pipefail 下 grep 命中即退出会让上游吃 SIGPIPE，
#   管道返回非零，把「匹配成功」误判成「匹配失败」。统一用 herestring。
has_re() { grep -qE "$1" <<< "${2:-}"; }

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)         DRY_RUN=1; shift ;;
    -y|--yes)          ASSUME_YES=1; shift ;;
    --keep-files)      KEEP_FILES=1; shift ;;
    --purge-cert)      PURGE_CERT=1; shift ;;
    --purge-packages)  PURGE_PKGS=1; shift ;;
    --no-firewall)     FIREWALL=0; shift ;;
    -h|--help)         usage ;;
    *) err "未知参数：$1"; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { err "需要 root 权限，请用：sudo bash $0 $*"; exit 1; }

hr
printf "%b\n" "${C_B}  ham-b 卸载${C_RST}$([[ $DRY_RUN -eq 1 ]] && printf '   %b\n' "${C_WARN}[演练模式 · 不会真的删除]${C_RST}")"
hr

# ---------------------------------------------------------------- 读取清单
MODE=""; SERVICE_NAME=""; DOMAIN=""; DOMAIN_ALIASES=""; PORT=""; HTTP_PORT=""
RUN_USER=""; WEB_ROOT=""; STATE_DIR=""; NGINX_AVAIL=""; NGINX_ENABLED=""
UNIT_PATH=""; ACCESS_LOG=""; ERROR_LOG=""; PKGS_INSTALLED=""; UFW_RULES_ADDED=""
CREATED_PATHS=""; CREATED_SYMLINKS=""; NGINX_WAS_PRESENT=""

if [[ -f "$MANIFEST" ]]; then
  # shellcheck disable=SC1090
  . "$MANIFEST"
  ok "读取安装清单：$MANIFEST"
  [[ -n "${INSTALLED_AT:-}" ]] && say "  安装时间：${INSTALLED_AT}"
  [[ -n "${MODE:-}" ]] && say "  模式：${MODE}   端口：${PORT:-?}"
else
  warn "没有找到安装清单 $MANIFEST —— 将按默认路径尽力清理"
  WEB_ROOT="$DEFAULT_WEB_ROOT"
  STATE_DIR="$DEFAULT_STATE_DIR"
  NGINX_AVAIL="$DEFAULT_NGINX_AVAIL"
  NGINX_ENABLED="$DEFAULT_NGINX_ENABLED"
  UNIT_PATH="$DEFAULT_UNIT_PATH"
  ACCESS_LOG="$DEFAULT_ACCESS_LOG"
  ERROR_LOG="$DEFAULT_ERROR_LOG"
  CREATED_PATHS="$WEB_ROOT $NGINX_AVAIL $UNIT_PATH"
  CREATED_SYMLINKS="$NGINX_ENABLED"
  DOMAIN=""
  PORT=""
fi
# 兜底：清单可能被手动改过
: "${WEB_ROOT:=$DEFAULT_WEB_ROOT}"
: "${STATE_DIR:=$DEFAULT_STATE_DIR}"
: "${NGINX_AVAIL:=$DEFAULT_NGINX_AVAIL}"
: "${NGINX_ENABLED:=$DEFAULT_NGINX_ENABLED}"
: "${UNIT_PATH:=$DEFAULT_UNIT_PATH}"
: "${ACCESS_LOG:=$DEFAULT_ACCESS_LOG}"
: "${ERROR_LOG:=$DEFAULT_ERROR_LOG}"

# ---------------------------------------------------------------- 执行器
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf "%b\n" "  ${C_WARN}[演练]${C_RST} $*"
    return 0
  fi
  "$@" >/dev/null 2>&1
}

# 动作完成提示：演练模式下措辞要如实，不能谎报「已删除」
did() {
  if [[ $DRY_RUN -eq 1 ]]; then printf "%b\n" "  ${C_INFO}→${C_RST} 将$*"; else ok "$*"; fi
}

# ---------------------------------------------------------------- 环境快照
# 一次性把外部命令输出抓进变量，后面都用 herestring 匹配（避免 SIGPIPE 陷阱）
UNITFILES="$(systemctl list-unit-files 2>/dev/null || true)"
UFW_ST="$(ufw status 2>/dev/null || true)"
CERT_ST="$(command -v certbot >/dev/null 2>&1 && certbot certificates 2>/dev/null || true)"
HAS_UNIT=0
[[ -f "$UNIT_PATH" ]] && HAS_UNIT=1
has_re '^ham-b\.service' "$UNITFILES" && HAS_UNIT=1
HAS_CERT=0
[[ -n "$DOMAIN" ]] && has_re "$DOMAIN" "$CERT_ST" && HAS_CERT=1

# ---------------------------------------------------------------- 计划
echo
printf "%b\n" "${C_B}将要清理：${C_RST}"

# 1. systemd
if [[ $HAS_UNIT -eq 1 ]]; then
  say "systemd 服务 ham-b.service"
else
  skip "systemd 服务 ham-b.service（不存在）"
fi

# 2. nginx 配置
[[ -e "$NGINX_ENABLED" || -L "$NGINX_ENABLED" ]] && say "nginx 软链 $NGINX_ENABLED" || skip "nginx 软链（不存在）"
[[ -e "$NGINX_AVAIL" ]] && say "nginx 配置 $NGINX_AVAIL" || skip "nginx 配置（不存在）"

# 3. 文件
if [[ $KEEP_FILES -eq 1 ]]; then
  skip "网站目录 $WEB_ROOT（--keep-files，保留）"
elif [[ -d "$WEB_ROOT" ]]; then
  N=$(find "$WEB_ROOT" -type f 2>/dev/null | wc -l | tr -d ' ')
  say "网站目录 $WEB_ROOT（$N 个文件）"
else
  skip "网站目录（不存在）"
fi

# 4. 日志
for L in "$ACCESS_LOG" "$ERROR_LOG"; do
  [[ -f "$L" ]] && say "日志 $L" || skip "日志 $L（不存在）"
done

# 5. ufw
if [[ $FIREWALL -eq 1 && -n "${UFW_RULES_ADDED:-}" ]]; then
  for r in $UFW_RULES_ADDED; do say "ufw 规则 $r"; done
else
  skip "ufw 规则（无）"
fi

# 6. 清单目录
[[ -d "$STATE_DIR" ]] && say "安装清单目录 $STATE_DIR" || skip "清单目录（不存在）"

# 7. 临时文件
say "临时文件 /tmp/ham-b-*"

# 8. 证书
if [[ $PURGE_CERT -eq 1 ]]; then
  if [[ $HAS_CERT -eq 1 ]]; then
    warn "certbot 证书：$DOMAIN （会被 certbot delete）"
  else
    skip "certbot 证书（未找到）"
  fi
else
  [[ $HAS_CERT -eq 1 ]] && skip "certbot 证书 $DOMAIN（保留；要删加 --purge-cert）"
fi

# 9. 软件包
if [[ $PURGE_PKGS -eq 1 && -n "${PKGS_INSTALLED:-}" ]]; then
  warn "本次安装引入的软件包：$PKGS_INSTALLED （有安全保护，见执行结果）"
elif [[ -n "${PKGS_INSTALLED:-}" ]]; then
  skip "软件包 $PKGS_INSTALLED（保留；要删加 --purge-packages）"
fi

echo
printf "%b\n" "${C_OK}不会被触碰：${C_RST}"
echo "  · 原有的 nginx 站点、conf.d、默认站点"
echo "  · 反向代理里的条目、DNS 解析记录"
echo "  · 其它任何服务与文件"
echo

if [[ $DRY_RUN -eq 0 && $ASSUME_YES -eq 0 ]]; then
  read -r -p "确认卸载？[y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { warn "已取消，什么都没改"; exit 0; }
fi

hr

# ================================================================ 执行
# 1) systemd
say "停止并移除 systemd 单元 ..."
if [[ $HAS_UNIT -eq 1 ]]; then
  run systemctl disable --now ham-b.service
  [[ $DRY_RUN -eq 0 ]] && systemctl stop ham-b.service >/dev/null 2>&1
  run rm -f "$UNIT_PATH"
  run systemctl daemon-reload
  run systemctl reset-failed ham-b.service
  did "移除 systemd 单元"
else
  skip "无 systemd 单元"
fi

# 2) nginx
say "移除 nginx 站点配置 ..."
NGINX_TOUCHED=0
for s in $CREATED_SYMLINKS "$NGINX_ENABLED"; do
  if [[ -n "$s" && ( -L "$s" || -e "$s" ) ]]; then
    run rm -f "$s"
    NGINX_TOUCHED=1
    did "删除软链 $s"
  fi
done
if [[ -e "$NGINX_AVAIL" ]]; then
  if grep -q "由 ham-b install.sh 生成" "$NGINX_AVAIL" 2>/dev/null; then
    run rm -f "$NGINX_AVAIL"
    NGINX_TOUCHED=1
    did "删除配置 $NGINX_AVAIL"
  else
    warn "$NGINX_AVAIL 不是本脚本生成的，保留不动（请自行检查）"
  fi
fi
[[ $NGINX_TOUCHED -eq 0 ]] && skip "无 nginx 配置需要删除"

if command -v nginx >/dev/null 2>&1 && [[ $NGINX_TOUCHED -eq 1 ]]; then
  if nginx -t >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx; then
      run systemctl reload nginx
      did "重载 nginx（其余站点不受影响）"
    fi
  else
    warn "nginx -t 未通过，未重载。请手动检查：sudo nginx -t"
  fi
fi

# 3) 文件
if [[ $KEEP_FILES -eq 0 ]]; then
  say "删除网站文件 ..."
  if [[ -d "$WEB_ROOT" ]]; then
    if [[ -f "$WEB_ROOT/index.html" ]] || [[ -d "$WEB_ROOT/assets" ]] || [[ -f "$WEB_ROOT/data/exam.js" ]]; then
      run rm -rf "$WEB_ROOT"
      did "删除 $WEB_ROOT"
    else
      warn "$WEB_ROOT 内容不像本站文件，为安全起见保留，请手动删除"
    fi
  else
    skip "目录不存在"
  fi
else
  skip "保留网站文件（--keep-files）"
fi

# 4) 日志
say "清理日志 ..."
if [[ -f "$ACCESS_LOG" || -f "$ERROR_LOG" ]]; then
  run rm -f "$ACCESS_LOG" "$ERROR_LOG"
  did "清理日志"
else
  skip "无日志"
fi
# 兜底：默认命名（清单可能被改过）
for L in /var/log/nginx/ham-b.access.log /var/log/nginx/ham-b.error.log; do
  [[ -f "$L" ]] && run rm -f "$L"
done

# 5) ufw
if [[ $FIREWALL -eq 1 && -n "${UFW_RULES_ADDED:-}" ]]; then
  say "回收 ufw 规则 ..."
  for r in $UFW_RULES_ADDED; do
    if has_re "(^|[^0-9])${r%/*}/${r#*/}" "$UFW_ST"; then
      run ufw --force delete allow "$r"
      did "删除 ufw $r"
      UFW_ST="$(ufw status 2>/dev/null || true)"
    else
      skip "ufw $r 已不存在"
    fi
  done
else
  skip "ufw 无变更"
fi

# 6) 证书（可选）
if [[ $PURGE_CERT -eq 1 && $HAS_CERT -eq 1 ]]; then
  say "删除 certbot 证书 ..."
  run certbot delete --cert-name "$DOMAIN" --non-interactive
  did "删除证书 $DOMAIN"
elif [[ $PURGE_CERT -eq 1 ]]; then
  skip "未找到证书 ${DOMAIN:-（清单未记录域名）}"
fi

# 7) 软件包（可选，带保护）
if [[ $PURGE_PKGS -eq 1 && -n "${PKGS_INSTALLED:-}" ]]; then
  say "处理本次引入的软件包 ..."
  for p in $PKGS_INSTALLED; do
    if [[ "$p" == "nginx" ]]; then
      OTHERS=$(find /etc/nginx/sites-enabled /etc/nginx/conf.d -mindepth 1 2>/dev/null | wc -l | tr -d ' ')
      OTHER_SVC=0
      has_re '^(apache2|httpd)\.' "$UNITFILES" && OTHER_SVC=1
      if [[ "$OTHERS" -gt 0 || $OTHER_SVC -eq 1 ]]; then
        warn "检测到 nginx 仍承载其它站点/服务（$OTHERS 项配置），为安全考虑【跳过】卸载 nginx"
        echo "      若确认不需要，手动执行： sudo apt-get purge -y nginx nginx-common"
      else
        warn "即将卸载 nginx（会一并删除 /etc/nginx 目录）"
        run apt-get purge -y nginx nginx-common nginx-core
        run apt-get autoremove -y
        did "卸载 nginx"
      fi
    else
      run apt-get purge -y "$p"
      did "卸载 $p"
    fi
  done
else
  [[ -n "${PKGS_INSTALLED:-}" ]] && skip "保留软件包 $PKGS_INSTALLED"
fi

# 8) 清单目录 + 临时文件
say "清理清单与临时文件 ..."
if [[ -d "$STATE_DIR" ]]; then
  run rm -rf "$STATE_DIR"
  did "删除 $STATE_DIR"
else
  skip "无清单目录"
fi
run rm -f /tmp/ham-b-deploy.tar.gz /tmp/ham-b-site.zip /tmp/ham-b-selftest.html \
           /tmp/ham-b-nginx-test.log /tmp/ham-b.zip /tmp/pf-nginx.log
did "清理临时文件"

# ================================================================ 复查
hr
printf "%b\n" "${C_B}复查残留${C_RST}"
LEFT=0
check_left() {
  local label="$1"; shift
  local hit
  hit="$("$@" 2>/dev/null)"
  if [[ -n "$hit" ]]; then
    warn "$label 仍有残留："
    printf '%s\n' "$hit" | sed 's/^/      /'
    LEFT=1
  else
    ok "$label 已清空"
  fi
}
check_left "systemd"  bash -c 'systemctl list-unit-files 2>/dev/null | grep "^ham-b\." || true'
check_left "nginx 配置" bash -c "ls -1 '$NGINX_AVAIL' '$NGINX_ENABLED' 2>/dev/null || true"
check_left "网站目录" bash -c "ls -1d '$WEB_ROOT' 2>/dev/null || true"
check_left "状态目录" bash -c "ls -1d '$STATE_DIR' 2>/dev/null || true"
check_left "systemd 单元" bash -c "ls -1 '$UNIT_PATH' 2>/dev/null || true"

# 端口是否还在监听
if [[ -n "$PORT" ]] && command -v ss >/dev/null 2>&1; then
  SS_NOW="$(ss -lntpH "sport = :$PORT" 2>/dev/null || true)"
  if [[ -n "$SS_NOW" ]]; then
    warn "端口 $PORT 仍在监听："
    printf '%s\n' "$SS_NOW" | sed 's/^/      /'
    LEFT=1
  else
    ok "端口 $PORT 已释放"
  fi
fi

echo
if [[ $LEFT -eq 0 ]]; then
  printf "%b\n" "${C_OK}${C_B}卸载完成，无残留。${C_RST}"
else
  printf "%b\n" "${C_WARN}${C_B}卸载完成，但上面标出的项仍需你留意（多为其它服务复用了同名端口/文件）。${C_RST}"
fi

cat <<'EOF'

仍需你手动处理的两处（服务器上无法自动完成）：
  1) 反向代理里的条目：如果之前给本站建过 Web 服务 / 反向代理规则，去反向代理面板删掉。
  2) DNS 解析记录：域名商处删掉指向本站的那条 A / CNAME 记录（不清也不影响，只是个死记录）。
EOF
hr
