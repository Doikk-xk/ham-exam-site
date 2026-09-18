# ==============================================================================
#  业余无线电台操作技术能力验证 A/B/C 类练题站
#  Flask + SQLite · 单容器 · 静态站点与 API 由同一进程提供
#
#  构建： docker build -t ham-exam-site .
#  运行： docker run -d -p 8080:8080 -v ./appdata:/data ham-exam-site
#
#  国内网络无法直连 Docker Hub 时，可指定镜像加速源：
#     docker build --build-arg BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim \
#                  -t ham-exam-site .
# ==============================================================================
ARG BASE_IMAGE=python:3.12-slim
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="ham-exam-site" \
      org.opencontainers.image.description="业余无线电台操作技术能力验证 A/B/C 类练题站（Flask + SQLite）" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HAM_DB_PATH=/data/ham.db \
    HAM_WEB_DIR=/app/web \
    HAM_PORT=8080

# 运行时依赖仅 flask（werkzeug 随附）与 gunicorn
RUN pip install --no-cache-dir --disable-pip-version-check flask gunicorn \
 && useradd --create-home --uid 1000 --shell /usr/sbin/nologin ham

WORKDIR /app/backend

COPY backend/ /app/backend/
COPY web/ /app/web/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /data \
 && chown -R ham:ham /app /data

# 数据卷：SQLite 数据库与持久化 secret key 都落在这里
VOLUME ["/data"]

EXPOSE 8080

# 健康检查：/api/me 未登录也应返回 200。用 python 探测，避免额外安装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/me',timeout=4).status==200 else 1)"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8080", "app:app"]

# 默认以 root 运行在容器内，以兼容 NAS 上任意属主的挂载目录（避免写库失败）。
# 如需非 root 运行：取消下一行注释，并确保挂载目录属主为 1000:1000
#   sudo chown -R 1000:1000 ./appdata
# USER ham
