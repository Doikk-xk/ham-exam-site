#!/bin/sh
# ==============================================================================
#  容器启动脚本
#   1. 确保数据库所在目录存在
#   2. 未显式提供 HAM_SECRET_KEY 时，在数据卷内生成并复用（重启不掉登录）
#   3. 交接给 CMD（gunicorn）
# ==============================================================================
set -e

DB_PATH="${HAM_DB_PATH:-/data/ham.db}"
DATA_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DATA_DIR"

SECRET_FILE="$DATA_DIR/.secret_key"
if [ -z "${HAM_SECRET_KEY:-}" ]; then
  if [ ! -f "$SECRET_FILE" ]; then
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[entrypoint] 已生成持久化 secret key -> $SECRET_FILE"
  fi
  HAM_SECRET_KEY="$(cat "$SECRET_FILE")"
  export HAM_SECRET_KEY
fi

echo "[entrypoint] db=$DB_PATH  web=${HAM_WEB_DIR:-/app/web}  addr=0.0.0.0:${HAM_PORT:-8080}"
exec "$@"
