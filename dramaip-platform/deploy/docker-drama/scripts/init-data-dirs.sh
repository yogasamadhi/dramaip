#!/usr/bin/env bash
# 初始化 docker-data 下的数据目录。
# 业务数据目录（postgres/redis/rabbitmq）：空目录即可，镜像 entrypoint 会自行 chown 初始化。
# 可观测性目录（prometheus/jaeger/grafana）：镜像以非 root 用户运行，需放开写权限，否则启动时写不进去。
#
# 用法：首次 docker compose up 前执行一次
#   ./scripts/init-data-dirs.sh

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${COMPOSE_DIR}/docker-data"

# 业务数据：交给镜像初始化权限（不 chmod，postgres 对过宽权限会报错）
mkdir -p "${DATA_DIR}"/{postgres,redis,rabbitmq}

# 可观测性：非 root 容器，放开写权限（含 Filebeat registry 状态目录）
mkdir -p "${DATA_DIR}"/{prometheus,jaeger,grafana,elasticsearch,filebeat}
chmod 777 "${DATA_DIR}"/{prometheus,jaeger,grafana,elasticsearch,filebeat}

echo "[init] data dirs ready under ${DATA_DIR}"
