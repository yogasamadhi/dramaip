#!/usr/bin/env bash
set -euo pipefail

# Restores the plugin-managed temporary backup to its named recovery point in a
# separate worker02 Cluster. It never replaces the source or the earlier
# native-PITR restore Cluster, and it asserts payment/subscription/token
# atomicity after PostgreSQL promotion.

[[ "${DRAMAIP_CNPG_PLUGIN_PITR_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_PITR_AUTHORIZED=1 before creating the temporary plugin PITR restore Cluster" >&2
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
source_cluster="dramaip-recovery-ha"
restore_cluster="dramaip-recovery-plugin-restore"
plugin_name="barman-cloud.cloudnative-pg.io"
object_store="dramaip-recovery-minio-store"
evidence_configmap="cnpg-plugin-pitr-evidence"
timeout="${DRAMAIP_CNPG_PLUGIN_PITR_TIMEOUT:-10m}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
restore_pv_manifest="$script_dir/temporary-cnpg-plugin-pitr-restore-pv.yaml"

[[ -f "$restore_pv_manifest" ]] || { echo "missing $restore_pv_manifest" >&2; exit 2; }
temporary_label="$(kube -n "$namespace" get cluster "$source_cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || { echo "refusing to restore without the temporary source cluster" >&2; exit 1; }
plugin_configured="$(kube -n "$namespace" get cluster "$source_cluster" -o jsonpath='{.spec.plugins[0].name}')"
[[ "$plugin_configured" == "$plugin_name" ]] || { echo "source cluster is not using the Barman plugin" >&2; exit 1; }
if kube -n "$namespace" get cluster "$restore_cluster" >/dev/null 2>&1; then
  echo "refusing to overwrite existing restore cluster $restore_cluster" >&2
  exit 1
fi

target_name="$(kube -n "$namespace" get configmap "$evidence_configmap" -o jsonpath='{.data.targetName}')"
backup_id="$(kube -n "$namespace" get configmap "$evidence_configmap" -o jsonpath='{.data.backupId}')"
kept_id="$(kube -n "$namespace" get configmap "$evidence_configmap" -o jsonpath='{.data.keptId}')"
excluded_id="$(kube -n "$namespace" get configmap "$evidence_configmap" -o jsonpath='{.data.excludedId}')"
[[ "$target_name" =~ ^cnpg-plugin-pitr-[0-9tz-]+$ ]] || { echo "invalid recorded plugin target name" >&2; exit 1; }
[[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}$ ]] || { echo "invalid recorded plugin backup ID" >&2; exit 1; }
[[ "$kept_id" =~ ^cnpg-plugin-kept-[0-9tz-]+$ ]] || { echo "invalid recorded retained ID" >&2; exit 1; }
[[ "$excluded_id" =~ ^cnpg-plugin-excluded-[0-9tz-]+$ ]] || { echo "invalid recorded excluded ID" >&2; exit 1; }

kube apply -f "$restore_pv_manifest"
kube -n "$namespace" apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: $restore_cluster
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:18.4
  imagePullPolicy: IfNotPresent
  enableSuperuserAccess: true
  bootstrap:
    recovery:
      source: $source_cluster
      recoveryTarget:
        backupID: $backup_id
        targetName: $target_name
  externalClusters:
    - name: $source_cluster
      plugin:
        name: $plugin_name
        parameters:
          barmanObjectName: $object_store
          serverName: $source_cluster
  storage:
    storageClass: dramaip-recovery-local
    size: 5Gi
    resizeInUseVolumes: false
  affinity:
    nodeSelector:
      node-role.kubernetes.io/worker: worker
      kubernetes.io/hostname: k8s-worker02
    enablePodAntiAffinity: false
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "1"
      memory: 1Gi
EOF

kube -n "$namespace" wait "cluster/$restore_cluster" --for=condition=Ready --timeout="$timeout"
restore_primary="$(kube -n "$namespace" get cluster "$restore_cluster" -o jsonpath='{.status.currentPrimary}')"
[[ "$restore_primary" == "$restore_cluster-1" ]] || { echo "unexpected restore primary" >&2; exit 1; }
restored="$(kube -n "$namespace" exec "$restore_primary" -- \
  psql -v ON_ERROR_STOP=1 -U postgres -d app -Atqc "
    SELECT
      (SELECT count(*) FROM recovery_pitr_drill.payment_ledger WHERE record_id = '$kept_id') || ':' ||
      (SELECT count(*) FROM recovery_pitr_drill.subscription_periods WHERE record_id = '$kept_id') || ':' ||
      (SELECT count(*) FROM recovery_pitr_drill.token_ledger WHERE record_id = '$kept_id') || ':' ||
      (SELECT count(*) FROM recovery_pitr_drill.payment_ledger WHERE record_id = '$excluded_id')
  ")"
[[ "$restored" == "1:1:1:0" ]] || {
  echo "plugin PITR ledger assertion failed: expected 1:1:1:0, got ${restored:-<empty>}" >&2
  exit 1
}
kube -n "$namespace" get cluster "$restore_cluster"
kube -n "$namespace" get pods -l "cnpg.io/cluster=$restore_cluster" -o wide
echo "temporary plugin PITR passed: backup_id=$backup_id target=$target_name retained=$kept_id excluded=$excluded_id assertion=$restored"
