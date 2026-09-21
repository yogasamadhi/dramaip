#!/usr/bin/env bash
# 初始化 docker-data 下的数据目录。
# 业务数据目录（postgres/redis/rabbitmq）：空目录即可，镜像 entrypoint 会自行 chown 初始化。
# 可观测性目录（Prometheus/Alloy/Loki/Tempo/Grafana）：镜像以非 root 用户运行，需放开写权限。
#
# 用法：首次 docker compose up 前执行一次
#   ./scripts/init-data-dirs.sh

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${DRAMAIP_COMPOSE_DATA_ROOT:-}" && "${DRAMAIP_COMPOSE_DATA_ROOT}" == /* ]]; then
  DATA_DIR="${DRAMAIP_COMPOSE_DATA_ROOT}"
elif [[ -n "${DRAMAIP_COMPOSE_DATA_ROOT:-}" ]]; then
  DATA_DIR="${COMPOSE_DIR}/${DRAMAIP_COMPOSE_DATA_ROOT}"
else
  DATA_DIR="${COMPOSE_DIR}/docker-data"
fi

# 业务数据：交给镜像初始化权限（不 chmod，postgres 对过宽权限会报错）
mkdir -p "${DATA_DIR}"/{postgres,redis,rabbitmq}

# 可观测性：非 root 容器，放开写权限（含 Alloy positions/state）。
# 旧 jaeger/filebeat/elasticsearch 目录不会读取或删除，手动清理见 OBSERVABILITY.md。
mkdir -p "${DATA_DIR}"/{prometheus,alloy,loki,tempo,grafana}
chmod 777 "${DATA_DIR}"/{prometheus,alloy,loki,tempo,grafana}

echo "[init] data dirs ready under ${DATA_DIR}"
