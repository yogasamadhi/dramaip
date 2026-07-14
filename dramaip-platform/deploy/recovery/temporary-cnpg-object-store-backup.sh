#!/usr/bin/env bash
set -euo pipefail

# Takes a Barman object-store backup of the disposable CNPG cluster, then
# writes a named PostgreSQL recovery point and a later excluded transaction.
# The companion PITR script restores precisely to that named point.

[[ "${DRAMAIP_CNPG_OBJECT_STORE_BACKUP_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_OBJECT_STORE_BACKUP_AUTHORIZED=1 before running the temporary object-store backup" >&2
  exit 2
}

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }

kubectl_server="${DRAMAIP_KUBECTL_SERVER:-}"
[[ -z "$kubectl_server" || "$kubectl_server" =~ ^https://[A-Za-z0-9.:-]+$ ]] || {
  echo "DRAMAIP_KUBECTL_SERVER must be an https://host:port endpoint" >&2
  exit 2
}
kube() {
  if [[ -n "$kubectl_server" ]]; then
    command kubectl --server="$kubectl_server" "$@"
  else
    command kubectl "$@"
  fi
}

namespace="dramaip-recovery-staging"
cluster="dramaip-recovery-ha"
backup_method="${DRAMAIP_CNPG_BACKUP_METHOD:-barmanObjectStore}"
plugin_name="barman-cloud.cloudnative-pg.io"
plugin_object_store="dramaip-recovery-minio-store"
evidence_configmap="cnpg-recovery-pitr-evidence"
timeout_seconds="${DRAMAIP_CNPG_OBJECT_STORE_BACKUP_TIMEOUT_SECONDS:-600}"
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "DRAMAIP_CNPG_OBJECT_STORE_BACKUP_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
}
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_cluster_manifest="$script_dir/temporary-cnpg-object-store-backup-cluster.yaml"
scheduled_backup_manifest="$script_dir/temporary-cnpg-object-store-scheduled-backup.yaml"

case "$backup_method" in
  barmanObjectStore)
    backup_label="native"
    scheduled_backup_name="dramaip-recovery-ha-hourly"
    [[ -f "$backup_cluster_manifest" ]] || { echo "missing $backup_cluster_manifest" >&2; exit 2; }
    [[ -f "$scheduled_backup_manifest" ]] || { echo "missing $scheduled_backup_manifest" >&2; exit 2; }
    ;;
  plugin)
    backup_label="plugin"
    evidence_configmap="cnpg-plugin-pitr-evidence"
    scheduled_backup_name="dramaip-recovery-ha-plugin-hourly"
    scheduled_backup_manifest="$script_dir/temporary-cnpg-barman-plugin-scheduled-backup.yaml"
    [[ -f "$scheduled_backup_manifest" ]] || { echo "missing $scheduled_backup_manifest" >&2; exit 2; }
    ;;
  *)
    echo "DRAMAIP_CNPG_BACKUP_METHOD must be barmanObjectStore or plugin" >&2
    exit 2
    ;;
esac
temporary_label="$(kube -n "$namespace" get cluster "$cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || {
  echo "refusing to back up a non-temporary cluster" >&2
  exit 1
}
kube -n "$namespace" get secret cnpg-recovery-minio-credentials >/dev/null
kube -n "$namespace" get service cnpg-recovery-minio >/dev/null

if [[ "$backup_method" == "barmanObjectStore" ]]; then
  kube -n "$namespace" apply -f "$backup_cluster_manifest"
else
  plugin_configured="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[0].name}')"
  object_configured="$(kube -n "$namespace" get cluster "$cluster" \
    -o jsonpath='{.spec.plugins[0].parameters.barmanObjectName}')"
  native_backup="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.backup}')"
  [[ "$plugin_configured" == "$plugin_name" && "$object_configured" == "$plugin_object_store" && -z "$native_backup" ]] || {
    echo "temporary cluster is not in the expected plugin-only backup configuration" >&2
    exit 1
  }
  kube -n "$namespace" get objectstore "$plugin_object_store" >/dev/null
fi
kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="${timeout_seconds}s"

primary="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
[[ "$primary" =~ ^dramaip-recovery-ha-[1-3]$ ]] || {
  echo "unexpected current primary: ${primary:-<empty>}" >&2
  exit 1
}
psql_query() {
  local query="$1"
  kube -n "$namespace" exec "$primary" -- \
    psql -v ON_ERROR_STOP=1 -U postgres -d app -Atqc "$query"
}

stamp="$(date -u +%Y%m%dt%H%M%sz)-$RANDOM"
backup_name="dramaip-recovery-ha-$backup_label-backup-$stamp"
backup_plugin_configuration=""
if [[ "$backup_method" == "plugin" ]]; then
  backup_plugin_configuration="  pluginConfiguration:
    name: $plugin_name"
fi
backup_resource="$(kube -n "$namespace" create -f - -o name <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: $backup_name
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
spec:
  cluster:
    name: $cluster
  method: $backup_method
$backup_plugin_configuration
  target: primary
EOF
)"
[[ "$backup_resource" == "backup.postgresql.cnpg.io/$backup_name" ]] || {
  echo "unexpected Backup resource created: $backup_resource" >&2
  exit 1
}

deadline=$((SECONDS + timeout_seconds))
while :; do
  phase="$(kube -n "$namespace" get backup "$backup_name" -o jsonpath='{.status.phase}')"
  case "${phase,,}" in
    completed|success)
      break
      ;;
    failed|error)
      backup_error="$(kube -n "$namespace" get backup "$backup_name" -o jsonpath='{.status.error}')"
      echo "object-store Backup failed: ${backup_error:-no controller error returned}" >&2
      exit 1
      ;;
  esac
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for object-store Backup; last phase: ${phase:-<empty>}" >&2
    exit 1
  fi
  sleep 3
done
backup_id="$(kube -n "$namespace" get backup "$backup_name" -o jsonpath='{.status.backupId}')"
[[ -n "$backup_id" ]] || { echo "completed Backup has no backupId" >&2; exit 1; }

target_name="cnpg-$backup_label-pitr-$stamp"
kept_id="cnpg-$backup_label-kept-$stamp"
excluded_id="cnpg-$backup_label-excluded-$stamp"
psql_query "
  CREATE SCHEMA IF NOT EXISTS recovery_pitr_drill;
  CREATE TABLE IF NOT EXISTS recovery_pitr_drill.payment_ledger (
    record_id text PRIMARY KEY,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    state text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recovery_pitr_drill.subscription_periods (
    record_id text PRIMARY KEY REFERENCES recovery_pitr_drill.payment_ledger(record_id),
    status text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recovery_pitr_drill.token_ledger (
    record_id text PRIMARY KEY REFERENCES recovery_pitr_drill.payment_ledger(record_id),
    granted_tokens bigint NOT NULL CHECK (granted_tokens > 0)
  );
  BEGIN;
  INSERT INTO recovery_pitr_drill.payment_ledger VALUES ('$kept_id', 500, 'paid');
  INSERT INTO recovery_pitr_drill.subscription_periods VALUES ('$kept_id', 'active');
  INSERT INTO recovery_pitr_drill.token_ledger VALUES ('$kept_id', 50);
  COMMIT;
"
target_lsn="$(psql_query "SELECT pg_create_restore_point('$target_name')")"
[[ "$target_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || {
  echo "invalid named recovery point LSN" >&2
  exit 1
}
archived_before="$(psql_query 'SELECT archived_count FROM pg_stat_archiver')"
[[ "$archived_before" =~ ^[0-9]+$ ]] || { echo "invalid archived_count" >&2; exit 1; }
psql_query "
  BEGIN;
  INSERT INTO recovery_pitr_drill.payment_ledger VALUES ('$excluded_id', 700, 'paid');
  INSERT INTO recovery_pitr_drill.subscription_periods VALUES ('$excluded_id', 'active');
  INSERT INTO recovery_pitr_drill.token_ledger VALUES ('$excluded_id', 70);
  COMMIT;
  SELECT pg_switch_wal();
" >/dev/null

deadline=$((SECONDS + timeout_seconds))
while :; do
  archived_after="$(psql_query 'SELECT archived_count FROM pg_stat_archiver')"
  if [[ "$archived_after" =~ ^[0-9]+$ ]] && (( archived_after > archived_before )); then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for WAL archive after restore point; archived_count=$archived_after" >&2
    exit 1
  fi
  sleep 3
done

kube -n "$namespace" apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: $evidence_configmap
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
data:
  backupName: $backup_name
  backupId: $backup_id
  targetName: $target_name
  targetLSN: $target_lsn
  keptId: $kept_id
  excludedId: $excluded_id
EOF

kube -n "$namespace" apply -f "$scheduled_backup_manifest"
deadline=$((SECONDS + timeout_seconds))
while :; do
  scheduled_at="$(kube -n "$namespace" get scheduledbackup "$scheduled_backup_name" \
    -o jsonpath='{.status.lastScheduleTime}')"
  [[ -n "$scheduled_at" ]] && break
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for the automatic ScheduledBackup dispatch" >&2
    exit 1
  fi
  sleep 3
done

kube -n "$namespace" get backup "$backup_name"
kube -n "$namespace" get scheduledbackup "$scheduled_backup_name"
echo "temporary $backup_label backup passed: backup=$backup_name backup_id=$backup_id target=$target_name target_lsn=$target_lsn archived_count=$archived_after scheduled_at=$scheduled_at"
