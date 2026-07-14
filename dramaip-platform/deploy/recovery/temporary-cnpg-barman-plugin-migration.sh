#!/usr/bin/env bash
set -euo pipefail

# Atomically replaces the temporary Cluster's deprecated native Barman setup
# with the Barman Cloud Plugin. It is deliberately limited to the disposable
# LM3-33 cluster and restores the original native configuration if the rolling
# update or post-update assertions fail.

[[ "${DRAMAIP_CNPG_PLUGIN_MIGRATION_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_MIGRATION_AUTHORIZED=1 before migrating the temporary cluster" >&2
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
scheduled_backup="dramaip-recovery-ha-hourly"
object_store="dramaip-recovery-minio-store"
plugin_name="barman-cloud.cloudnative-pg.io"
timeout="${DRAMAIP_CNPG_PLUGIN_MIGRATION_TIMEOUT:-10m}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
object_store_manifest="$script_dir/temporary-cnpg-barman-plugin-object-store.yaml"
migrated=0

rollback_native() {
  [[ "$migrated" == "1" ]] || return 0
  echo "plugin migration did not verify; restoring the temporary native Barman configuration" >&2
  kube -n "$namespace" patch cluster "$cluster" --type=merge -p '
{"spec":{"plugins":null,"backup":{"barmanObjectStore":{"destinationPath":"s3://dramaip-cnpg-recovery/backups","endpointURL":"http://cnpg-recovery-minio:9000","serverName":"dramaip-recovery-ha","s3Credentials":{"accessKeyId":{"name":"cnpg-recovery-minio-credentials","key":"ACCESS_KEY_ID"},"secretAccessKey":{"name":"cnpg-recovery-minio-credentials","key":"SECRET_ACCESS_KEY"},"region":{"name":"cnpg-recovery-minio-credentials","key":"AWS_REGION"}},"data":{"compression":"gzip","jobs":1},"wal":{"compression":"gzip","maxParallel":1}},"retentionPolicy":"7d"}}}'
  kube -n "$namespace" patch scheduledbackup "$scheduled_backup" --type=merge -p \
    '{"spec":{"method":"barmanObjectStore","pluginConfiguration":null}}'
  kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="$timeout" || true
}
cleanup() {
  local status=$?
  if (( status != 0 )); then
    rollback_native
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

[[ -f "$object_store_manifest" ]] || { echo "missing $object_store_manifest" >&2; exit 2; }
temporary_label="$(kube -n "$namespace" get cluster "$cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || { echo "refusing to migrate a non-temporary cluster" >&2; exit 1; }
native_destination="$(kube -n "$namespace" get cluster "$cluster" \
  -o jsonpath='{.spec.backup.barmanObjectStore.destinationPath}')"
native_retention="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.backup.retentionPolicy}')"
existing_plugins="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[*].name}')"
[[ "$native_destination" == "s3://dramaip-cnpg-recovery/backups" && "$native_retention" == "7d" ]] || {
  echo "temporary native Barman configuration is not the expected source" >&2
  exit 1
}
[[ -z "$existing_plugins" ]] || { echo "refusing to replace an existing plugin configuration" >&2; exit 1; }
kube -n cnpg-system get deployment barman-cloud >/dev/null
kube -n cnpg-system rollout status deployment/barman-cloud --timeout="$timeout"
plugin_node="$(kube -n cnpg-system get pod -l app=barman-cloud -o jsonpath='{.items[0].spec.nodeName}')"
[[ "$plugin_node" == "k8s-worker01" ]] || { echo "plugin is not worker01-bound" >&2; exit 1; }
kube -n "$namespace" get secret cnpg-recovery-minio-credentials >/dev/null
kube -n "$namespace" apply -f "$object_store_manifest"
configured_destination="$(kube -n "$namespace" get objectstore "$object_store" \
  -o jsonpath='{.spec.configuration.destinationPath}')"
[[ "$configured_destination" == "s3://dramaip-cnpg-recovery/backups" ]] || {
  echo "unexpected plugin ObjectStore destination" >&2
  exit 1
}

# This one merge patch removes spec.backup and adds the full plugin entry in a
# single API update, as required for a native-to-plugin handover.
migrated=1
kube -n "$namespace" patch cluster "$cluster" --type=merge -p '
{"spec":{"backup":null,"plugins":[{"name":"barman-cloud.cloudnative-pg.io","isWALArchiver":true,"parameters":{"barmanObjectName":"dramaip-recovery-minio-store"}}]}}'
kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="$timeout"

plugin_configured="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[0].name}')"
wal_archiver="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[0].isWALArchiver}')"
object_name="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[0].parameters.barmanObjectName}')"
native_backup="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.backup}')"
[[ "$plugin_configured" == "$plugin_name" && "$wal_archiver" == "true" && "$object_name" == "$object_store" && -z "$native_backup" ]] || {
  echo "Cluster did not retain the expected plugin-only configuration" >&2
  exit 1
}

kube -n "$namespace" patch scheduledbackup "$scheduled_backup" --type=merge -p \
  '{"spec":{"method":"plugin","pluginConfiguration":{"name":"barman-cloud.cloudnative-pg.io"}}}'
scheduled_method="$(kube -n "$namespace" get scheduledbackup "$scheduled_backup" -o jsonpath='{.spec.method}')"
scheduled_plugin="$(kube -n "$namespace" get scheduledbackup "$scheduled_backup" -o jsonpath='{.spec.pluginConfiguration.name}')"
[[ "$scheduled_method" == "plugin" && "$scheduled_plugin" == "$plugin_name" ]] || {
  echo "ScheduledBackup did not switch to the plugin" >&2
  exit 1
}

kube -n "$namespace" apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: cnpg-plugin-migration-evidence
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
data:
  pluginName: $plugin_name
  objectStore: $object_store
  pluginNode: $plugin_node
  scheduledBackup: $scheduled_backup
EOF
migrated=0
echo "temporary CNPG native-to-plugin migration passed: plugin=$plugin_name object_store=$object_store node=$plugin_node"
