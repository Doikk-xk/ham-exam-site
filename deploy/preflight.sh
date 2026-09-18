#!/usr/bin/env bash
# ==============================================================================
#  ham-b 部署前置体检（只读，不做任何修改）
#
#  用法： bash preflight.sh [--domain exam.example.com]
#
#  输出一份服务器现状快照：系统、nginx、端口占用、防火墙、已部署痕迹等。
#  跑完不会改动任何文件、不会重启任何服务。
# ==============================================================================

set -uo pipefail

DOMAIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数 $1" >&2; exit 1 ;;
  esac
done

C_RST='\033[0m'; C_OK='\033[32m'; C_WARN='\033[33m'; C_INFO='\033[36m'; C_B='\033[1m'
sec()  { printf "\n%b\n" "${C_B}=== $* ===${C_RST}"; }
kv()   { printf "  %-22s %b\n" "$1" "$2"; }

has() { command -v "$1" >/dev/null 2>&1; }

printf "%b\n" "${C_INFO}ham-b 部署前置体检  $(date '+%F %T')${C_RST}"

sec 系统
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  kv "发行版" "${PRETTY_NAME:-?}"
  kv "ID / 版本" "${ID:-?} ${VERSION_ID:-?}"
fi
kv "内核" "$(uname -r)"
kv "架构" "$(uname -m)"
kv "主机名" "$(hostname)"
kv "运行身份" "$(id -un) (uid=$(id -u))$([[ $EUID -eq 0 ]] && echo '  → root ✓' || echo '  → 非 root（安装需要 sudo）')"
kv "内网 IP" "$(hostname -I 2>/dev/null | awk '{print $1}')"
kv "运行时长" "$(uptime -p 2>/dev/null || uptime)"

sec 资源
kv "内存" "$(free -h 2>/dev/null | awk '/^Mem:/{print $3" used / "$2" total"}')"
kv "根分区" "$(df -h / 2>/dev/null | awk 'NR==2{print $3" used / "$2" ("$5")"}')"
kv "/var 分区" "$(df -h /var 2>/dev/null | awk 'NR==2{print $3" used / "$2" ("$5")"}')"
kv "负载" "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"

sec 依赖
for b in nginx python3 curl wget tar rsync ss ufw certbot systemctl; do
  if has "$b"; then kv "$b" "$(command -v "$b")  $("$b" --version 2>/dev/null | head -1)"; else kv "$b" "未安装"; fi
done
kv "www-data" "$(id -u www-data >/dev/null 2>&1 && echo '存在' || echo '不存在（将用 nobody）')"

sec nginx 现状
if [[ -d /etc/nginx ]]; then
  kv "配置目录" "/etc/nginx ✓"
  kv "sites-enabled" "$(find /etc/nginx/sites-enabled -mindepth 1 2>/dev/null | wc -l | tr -d ' ') 个"
  find /etc/nginx/sites-enabled -mindepth 1 2>/dev/null | sed 's/^/      /'
  kv "conf.d" "$(find /etc/nginx/conf.d -mindepth 1 -name '*.conf' 2>/dev/null | wc -l | tr -d ' ') 个"
  find /etc/nginx/conf.d -mindepth 1 -name '*.conf' 2>/dev/null | sed 's/^/      /'
  kv "default_server" "$(grep -rl 'default_server' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | tr '\n' ' ')"
  if has nginx; then
    if nginx -t >/tmp/pf-nginx.log 2>&1; then kv "nginx -t" "通过 ✓"; else kv "nginx -t" "失败 ✗（先修好再装）"; sed 's/^/      /' /tmp/pf-nginx.log; fi
    kv "service" "$(systemctl is-enabled nginx 2>/dev/null)/$(systemctl is-active nginx 2>/dev/null)"
  fi
else
  kv "/etc/nginx" "不存在 → 只能用 systemd 模式，或加 --install-deps 装 nginx"
fi

sec 端口占用
if has ss; then
  for p in 80 443 8080 8090; do
    line="$(ss -lntpH "sport = :$p" 2>/dev/null | head -1 || true)"
    if [[ -n "$line" ]]; then kv ":$p" "占用 → $(echo "$line" | awk '{print $1" "$4" "$6}')"; else kv ":$p" "空闲 ✓"; fi
  done
  echo "  —— 全部监听 ——"
  ss -lntH 2>/dev/null | awk '{print "      "$1" "$4}' | sort -u | head -30
else
  kv "ss" "不可用"
fi

sec 防火墙
if has ufw; then
  UFW_S="$(ufw status 2>/dev/null || true)"
  kv "ufw" "$(head -1 <<<"$UFW_S")"
  printf '%s\n' "$UFW_S" | sed -n '3,25p' | sed 's/^/      /'
else
  kv "ufw" "未安装"
fi
if has iptables; then
  kv "iptables 规则数" "$(iptables -S 2>/dev/null | wc -l | tr -d ' ')"
fi

sec 已有痕迹（上次是否装过）
for p in /var/www/ham-b /var/lib/ham-b /etc/nginx/sites-available/ham-b \
         /etc/nginx/sites-enabled/ham-b /etc/systemd/system/ham-b.service; do
  if [[ -e "$p" || -L "$p" ]]; then
    kv "残留" "$p  ← 存在，安装脚本会按「更新」处理"
  fi
done
if [[ -f /var/lib/ham-b/manifest.env ]]; then
  echo "  —— 清单内容 ——"
  sed 's/^/      /' /var/lib/ham-b/manifest.env
fi
echo "  （以上若无输出表示是干净环境）"

sec 证书
if [[ -d /etc/letsencrypt/live ]]; then
  ls -1 /etc/letsencrypt/live 2>/dev/null | sed 's/^/      /'
  kv "certbot.timer" "$(systemctl is-enabled certbot.timer 2>/dev/null || echo '未启用')"
else
  kv "letsencrypt" "无证书目录"
fi

if [[ -n "$DOMAIN" ]]; then
  sec "域名 $DOMAIN"
  if has getent; then
    R="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
    kv "解析结果" "${R:-未解析}"
  fi
  if has curl; then
    kv "公网出口 IP" "$(curl -s --max-time 6 https://api.ipify.org 2>/dev/null || echo '取不到')"
  fi
fi

printf "\n%b\n" "${C_INFO}体检结束（未做任何修改）${C_RST}"
