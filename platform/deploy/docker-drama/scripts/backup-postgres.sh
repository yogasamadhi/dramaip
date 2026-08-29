#!/usr/bin/env bash
# PostgreSQL 备份：自定义格式全量 pg_dump，按时间戳归档到 docker-data/backups。
# 对应 docs/后端技术架构.md §13：PostgreSQL 是权威源，必须有定期全量备份与可演练的恢复。
#
# 用法：
#   ./scripts/backup-postgres.sh
#
# 定时执行建议：
#   - macOS：launchd 或 crontab，例如每天 03:17：`17 3 * * *  /path/to/backup-postgres.sh`
#   - 生产：用外部备份方案（pgBackRest / 云托管快照），本脚本仅覆盖本地 dev 与演练。
#
# 恢复：
#   docker compose exec -T postgres pg_restore -U dramaip -d dramaip -c < <备份文件>

set -euo pipefail

# docker-drama 目录（脚本在 scripts/ 下，向上一级）
COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yaml"

# 与 docker-compose.yaml 保持一致的默认值，可用环境变量覆盖
SERVICE="${POSTGRES_SERVICE:-postgres}"
DB="${POSTGRES_DB:-dramaip}"
USER="${POSTGRES_USER:-dramaip}"
PASSWORD="${POSTGRES_PASSWORD:-dramaip}"
KEEP="${BACKUP_KEEP:-14}"   # 仅保留最近 N 份

BACKUP_DIR="${COMPOSE_DIR}/docker-data/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/${DB}-${STAMP}.dump"

echo "[backup] ${DB} -> ${FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T \
  -e PGPASSWORD="${PASSWORD}" \
  "${SERVICE}" \
  pg_dump -U "${USER}" -d "${DB}" -Fc > "${FILE}"

# 轮转：保留最近 KEEP 份
if [ "${KEEP}" -gt 0 ]; then
  # shellcheck disable=SC2012
  ls -1t "${BACKUP_DIR}"/${DB}-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    echo "[backup] prune ${old}"
    rm -f "${old}"
  done
fi

echo "[backup] done: $(du -h "${FILE}" | cut -f1)"
