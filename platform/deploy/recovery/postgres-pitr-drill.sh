#!/usr/bin/env bash
set -euo pipefail

# Runs an isolated, disposable physical PostgreSQL backup/WAL/PITR rehearsal.
# It never connects to an application database, requires explicit approval,
# and removes the temporary Docker containers, network, and volumes on exit.
#
# The rehearsal proves that a base backup plus archived WAL can restore a
# transactionally consistent billing/subscription/quota point in time. It is
# deliberately a worker/local validation tool, not a production backup agent.

[[ "${DRAMAIP_PITR_DRILL_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_PITR_DRILL_AUTHORIZED=1 before running an isolated PITR drill" >&2
  exit 2
}

image="${DRAMAIP_PITR_IMAGE:-postgres:18-alpine}"
case "$image" in
  postgres:18-alpine|docker.m.daocloud.io/library/postgres:18-alpine) ;;
  *)
    echo "DRAMAIP_PITR_IMAGE must be the reviewed postgres:18-alpine image or its approved mirror" >&2
    exit 2
    ;;
esac

timeout_seconds="${DRAMAIP_PITR_TIMEOUT_SECONDS:-90}"
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "DRAMAIP_PITR_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
}
rto_seconds="${DRAMAIP_PITR_RTO_SECONDS:-3600}"
[[ "$rto_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "DRAMAIP_PITR_RTO_SECONDS must be a positive integer" >&2
  exit 2
}

docker_cmd=(docker)
if [[ "${DRAMAIP_PITR_DOCKER_SUDO:-0}" == "1" ]]; then
  docker_cmd=(sudo docker)
fi

for command in date openssl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 127; }
done
"${docker_cmd[@]}" version >/dev/null || { echo "a working Docker daemon is required" >&2; exit 127; }

prefix="dramaip-pitr-${RANDOM}-$$"
SECONDS=0
network="${prefix}-net"
source_container="${prefix}-source"
restore_container="${prefix}-restore"
source_volume="${prefix}-source"
base_volume="${prefix}-base"
archive_volume="${prefix}-archive"
restore_volume="${prefix}-restore"
db_user="pitr_operator"
db_name="pitr_rehearsal"
db_password="$(openssl rand -hex 24)"
restore_point_name="pitr-kept-${RANDOM}-$$"
# PostgreSQL 18's official image owns its versioned PGDATA directory under
# this parent path.  Mounting the old /var/lib/postgresql/data location causes
# the image to reject even an empty volume.
postgres_volume_root="/var/lib/postgresql"
postgres_data_relative="18/docker"

cleanup() {
  "${docker_cmd[@]}" rm -f "$restore_container" "$source_container" >/dev/null 2>&1 || true
  "${docker_cmd[@]}" network rm "$network" >/dev/null 2>&1 || true
  "${docker_cmd[@]}" volume rm "$restore_volume" "$archive_volume" "$base_volume" "$source_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_sql() {
  local container="$1"
  local attempt
  for ((attempt = 1; attempt <= timeout_seconds; attempt++)); do
    if "${docker_cmd[@]}" exec -e "PGPASSWORD=$db_password" "$container" \
      psql -U "$db_user" -d "$db_name" -Atqc 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL container $container did not become ready within ${timeout_seconds}s" >&2
  "${docker_cmd[@]}" logs --tail 120 "$container" >&2 || true
  return 1
}

wait_for_archive() {
  local wal_file="$1"
  local attempt
  for ((attempt = 1; attempt <= timeout_seconds; attempt++)); do
    if "${docker_cmd[@]}" exec "$source_container" test -f "/var/lib/postgresql/wal_archive/$wal_file"; then
      return 0
    fi
    sleep 1
  done
  echo "WAL archive did not receive $wal_file within ${timeout_seconds}s" >&2
  return 1
}

switch_and_wait() {
  local wal_file
  wal_file="$("${docker_cmd[@]}" exec -e "PGPASSWORD=$db_password" "$source_container" \
    psql -U "$db_user" -d "$db_name" -Atqc 'SELECT pg_walfile_name(pg_current_wal_lsn())')"
  [[ "$wal_file" =~ ^[0-9A-F]{24}$ ]] || { echo "invalid WAL file name returned by PostgreSQL" >&2; exit 1; }
  "${docker_cmd[@]}" exec -e "PGPASSWORD=$db_password" "$source_container" \
    psql -U "$db_user" -d "$db_name" -Atqc 'SELECT pg_switch_wal()' >/dev/null
  wait_for_archive "$wal_file"
}

psql_source() {
  "${docker_cmd[@]}" exec -i -e "PGPASSWORD=$db_password" "$source_container" \
    psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" "$@"
}

echo "starting isolated PostgreSQL PITR drill ($prefix)"
"${docker_cmd[@]}" network create "$network" >/dev/null
"${docker_cmd[@]}" volume create "$source_volume" >/dev/null
"${docker_cmd[@]}" volume create "$base_volume" >/dev/null
"${docker_cmd[@]}" volume create "$archive_volume" >/dev/null
"${docker_cmd[@]}" volume create "$restore_volume" >/dev/null
"${docker_cmd[@]}" run --rm --user 0 \
  -v "$archive_volume:/archive" \
  "$image" sh -eu -c 'mkdir -p /archive && chown -R postgres:postgres /archive'

"${docker_cmd[@]}" run -d --name "$source_container" --network "$network" \
  -e "POSTGRES_USER=$db_user" \
  -e "POSTGRES_PASSWORD=$db_password" \
  -e "POSTGRES_DB=$db_name" \
  -v "$source_volume:$postgres_volume_root" \
  -v "$archive_volume:$postgres_volume_root/wal_archive" \
  "$image" \
  -c wal_level=replica \
  -c max_wal_senders=10 \
  -c archive_mode=on \
  -c 'archive_command=cp %p /var/lib/postgresql/wal_archive/%f' \
  -c archive_timeout=60 >/dev/null
wait_for_sql "$source_container"

psql_source <<'SQL'
ALTER ROLE pitr_operator WITH REPLICATION;
CREATE SCHEMA billing;
CREATE SCHEMA quota;
CREATE TABLE billing.payment_ledger (
  payment_id text PRIMARY KEY,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  state text NOT NULL
);
CREATE TABLE billing.subscription_periods (
  payment_id text PRIMARY KEY REFERENCES billing.payment_ledger(payment_id),
  status text NOT NULL
);
CREATE TABLE quota.token_ledger (
  payment_id text PRIMARY KEY REFERENCES billing.payment_ledger(payment_id),
  granted_tokens bigint NOT NULL CHECK (granted_tokens > 0)
);
INSERT INTO billing.payment_ledger VALUES ('baseline', 100, 'paid');
INSERT INTO billing.subscription_periods VALUES ('baseline', 'active');
INSERT INTO quota.token_ledger VALUES ('baseline', 10);
SQL
# pg_basebackup opens a replication-protocol connection from a second container.
# Permit it only within this randomly named, disposable Docker network.
"${docker_cmd[@]}" exec "$source_container" sh -eu -c \
  "printf '%s\\n' 'host replication $db_user all trust' >> \"\$PGDATA/pg_hba.conf\""
psql_source -Atqc 'SELECT pg_reload_conf()' >/dev/null
source_baseline="$(psql_source -Atqc "
  SELECT
    (SELECT count(*) FROM billing.payment_ledger WHERE payment_id = 'baseline') || ':' ||
    (SELECT count(*) FROM billing.subscription_periods WHERE payment_id = 'baseline') || ':' ||
    (SELECT count(*) FROM quota.token_ledger WHERE payment_id = 'baseline')
")"
[[ "$source_baseline" == "1:1:1" ]] || {
  echo "source ledger baseline assertion failed: expected 1:1:1, got $source_baseline" >&2
  exit 1
}
switch_and_wait

# A physical base backup intentionally excludes streamed WAL: recovery must use
# the independently archived WAL volume, exactly as the production design will.
"${docker_cmd[@]}" run --rm --network "$network" \
  -e "PGPASSWORD=$db_password" \
  -v "$base_volume:/base" \
  "$image" \
  pg_basebackup -h "$source_container" -U "$db_user" -D /base -Fp -X none -P >/dev/null
switch_and_wait

# The three ledger mutations are one transaction and must either all survive
# the target recovery or all be absent. The later row is deliberately outside
# the target time and proves that recovery did not simply restore the latest
# WAL state.
psql_source <<'SQL'
BEGIN;
INSERT INTO billing.payment_ledger VALUES ('pitr-kept', 500, 'paid');
INSERT INTO billing.subscription_periods VALUES ('pitr-kept', 'active');
INSERT INTO quota.token_ledger VALUES ('pitr-kept', 50);
COMMIT;
SQL
kept_time="$(psql_source -Atqc "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.USOF')")"
# A named restore point writes an exact WAL record after all three kept ledger
# rows. It avoids interpreting a segment boundary as a logical recovery point.
target_lsn="$(psql_source -Atqc "SELECT pg_create_restore_point('$restore_point_name')")"
[[ "$target_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || { echo "invalid recovery target LSN" >&2; exit 1; }
target_time="$(psql_source -Atqc "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.USOF')")"
sleep 2
psql_source <<'SQL'
BEGIN;
INSERT INTO billing.payment_ledger VALUES ('pitr-excluded', 700, 'paid');
INSERT INTO billing.subscription_periods VALUES ('pitr-excluded', 'active');
INSERT INTO quota.token_ledger VALUES ('pitr-excluded', 70);
COMMIT;
SQL
excluded_time="$(psql_source -Atqc "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.USOF')")"
echo "PITR timing: kept=$kept_time target=$target_time restore_point=$restore_point_name target_lsn=$target_lsn excluded=$excluded_time"
switch_and_wait

"${docker_cmd[@]}" stop "$source_container" >/dev/null
"${docker_cmd[@]}" run --rm --user 0 \
  -v "$base_volume:/base:ro" \
  -v "$archive_volume:/archive:ro" \
  -v "$restore_volume:/restore" \
  "$image" sh -eu -c '
    restore_data_dir="/restore/$2"
    mkdir -p "$restore_data_dir"
    cp -a /base/. "$restore_data_dir/"
    printf "restore_command = '\''cp /archive/%%f %%p'\''\n" >> "$restore_data_dir/postgresql.auto.conf"
    printf "recovery_target_name = '\''%s'\''\n" "$1" >> "$restore_data_dir/postgresql.auto.conf"
    printf "recovery_target_action = '\''promote'\''\n" >> "$restore_data_dir/postgresql.auto.conf"
    touch "$restore_data_dir/recovery.signal"
    chown -R postgres:postgres /restore
  ' sh "$restore_point_name" "$postgres_data_relative"

"${docker_cmd[@]}" run -d --name "$restore_container" --network "$network" \
  -v "$restore_volume:$postgres_volume_root" \
  -v "$archive_volume:/archive:ro" \
  "$image" >/dev/null
wait_for_sql "$restore_container"

recovered_tables="$("${docker_cmd[@]}" exec -e "PGPASSWORD=$db_password" "$restore_container" \
  psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" -Atqc "
    SELECT coalesce(string_agg(schemaname || '.' || tablename, ',' ORDER BY schemaname, tablename), '<none>')
    FROM pg_tables
    WHERE schemaname IN ('billing', 'quota')
  ")"
echo "PITR restored tables: $recovered_tables"

if ! restored="$("${docker_cmd[@]}" exec -e "PGPASSWORD=$db_password" "$restore_container" \
  psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" -Atqc "
    SELECT
      (SELECT count(*) FROM billing.payment_ledger WHERE payment_id = 'pitr-kept') || ':' ||
      (SELECT count(*) FROM billing.subscription_periods WHERE payment_id = 'pitr-kept') || ':' ||
      (SELECT count(*) FROM quota.token_ledger WHERE payment_id = 'pitr-kept') || ':' ||
      (SELECT count(*) FROM billing.payment_ledger WHERE payment_id = 'pitr-excluded')
  ")"; then
  "${docker_cmd[@]}" logs --tail 160 "$restore_container" >&2 || true
  exit 1
fi
[[ "$restored" == "1:1:1:0" ]] || {
  echo "PITR ledger consistency assertion failed: expected 1:1:1:0, got $restored" >&2
  exit 1
}
elapsed_seconds="$SECONDS"
[[ "$elapsed_seconds" -le "$rto_seconds" ]] || {
  echo "PITR drill exceeded RTO: elapsed=${elapsed_seconds}s rto=${rto_seconds}s" >&2
  exit 1
}

echo "PITR drill passed: elapsed=${elapsed_seconds}s rto=${rto_seconds}s restored restore_point=$restore_point_name target_lsn=$target_lsn target_time=$target_time with payment/subscription/quota transaction intact and later payment excluded"
