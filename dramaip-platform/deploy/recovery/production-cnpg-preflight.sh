#!/usr/bin/env bash
set -euo pipefail

# Read-only production-equivalent gate for the CNPG recovery path. It refuses
# the disposable rehearsal namespace and never prints Secret data. The gate is
# intentionally environment-driven: production resource names and KMS
# references must come from the approved operator configuration, not Git.

[[ "${DRAMAIP_CNPG_PRODUCTION_PREFLIGHT_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PRODUCTION_PREFLIGHT_AUTHORIZED=1 before running the production CNPG preflight" >&2
  exit 2
}

command -v kubectl >/dev/null || {
  echo "kubectl is required" >&2
  exit 127
}

kubectl_server="${DRAMAIP_KUBECTL_SERVER:-}"
[[ -z "$kubectl_server" || "$kubectl_server" =~ ^https://[A-Za-z0-9.-]+:[0-9]+$ ]] || {
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

namespace="${DRAMAIP_CNPG_PRODUCTION_NAMESPACE:?DRAMAIP_CNPG_PRODUCTION_NAMESPACE is required}"
cluster_name="${DRAMAIP_CNPG_PRODUCTION_CLUSTER:?DRAMAIP_CNPG_PRODUCTION_CLUSTER is required}"
storage_class="${DRAMAIP_CNPG_PRODUCTION_STORAGE_CLASS:?DRAMAIP_CNPG_PRODUCTION_STORAGE_CLASS is required}"
object_store_name="${DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE:?DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE is required}"
object_store_secret="${DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE_SECRET:?DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE_SECRET is required}"
kms_key_ref="${DRAMAIP_CNPG_PRODUCTION_KMS_KEY_REF:?DRAMAIP_CNPG_PRODUCTION_KMS_KEY_REF is required}"
retention_days="${DRAMAIP_CNPG_PRODUCTION_RETENTION_DAYS:?DRAMAIP_CNPG_PRODUCTION_RETENTION_DAYS is required}"
rpo_minutes="${DRAMAIP_CNPG_PRODUCTION_RPO_MINUTES:-15}"
rto_minutes="${DRAMAIP_CNPG_PRODUCTION_RTO_MINUTES:-60}"
immutable_retention="${DRAMAIP_CNPG_PRODUCTION_IMMUTABLE_RETENTION:-false}"
backup_schedule="${DRAMAIP_CNPG_PRODUCTION_BACKUP_SCHEDULE:?DRAMAIP_CNPG_PRODUCTION_BACKUP_SCHEDULE is required}"

[[ "$namespace" != dramaip-recovery-staging && "$namespace" != dramaip-staging* ]] || {
  echo "production preflight refuses disposable staging namespace: $namespace" >&2
  exit 1
}
[[ "$retention_days" =~ ^[0-9]+$ && "$retention_days" -ge 30 ]] || {
  echo "production retention must be an integer of at least 30 days" >&2
  exit 1
}
[[ "$rpo_minutes" =~ ^[0-9]+$ && "$rpo_minutes" -le 15 ]] || {
  echo "RPO must be an integer no greater than 15 minutes" >&2
  exit 1
}
[[ "$rto_minutes" =~ ^[0-9]+$ && "$rto_minutes" -le 60 ]] || {
  echo "RTO must be an integer no greater than 60 minutes" >&2
  exit 1
}
[[ "$immutable_retention" == true ]] || {
  echo "immutable/versioned retention must be explicitly true" >&2
  exit 1
}
[[ "$kms_key_ref" != *" "* && "$kms_key_ref" != /* && "$kms_key_ref" != "" ]] || {
  echo "KMS key reference must be a non-empty external reference" >&2
  exit 1
}

kube get namespace "$namespace" >/dev/null
cluster_instances="$(kube -n "$namespace" get cluster.postgresql.cnpg.io "$cluster_name" -o jsonpath='{.spec.instances}')"
[[ "$cluster_instances" =~ ^[3-9][0-9]*$ ]] || {
  echo "CNPG cluster must have at least 3 instances: ${cluster_instances:-<empty>}" >&2
  exit 1
}
cluster_storage_class="$(kube -n "$namespace" get cluster.postgresql.cnpg.io "$cluster_name" -o jsonpath='{.spec.storage.storageClass}')"
[[ "$cluster_storage_class" == "$storage_class" ]] || {
  echo "CNPG storageClass mismatch: expected $storage_class" >&2
  exit 1
}
plugin_name="$(kube -n "$namespace" get cluster.postgresql.cnpg.io "$cluster_name" -o jsonpath='{.spec.plugins[0].name}')"
[[ "$plugin_name" == *barman-cloud* ]] || {
  echo "CNPG cluster is not configured with the Barman Cloud Plugin" >&2
  exit 1
}

pvc_names="$(kube -n "$namespace" get pvc -l "cnpg.io/cluster=$cluster_name" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
[[ -n "$pvc_names" ]] || {
  echo "no CNPG PVCs found for $cluster_name" >&2
  exit 1
}
pvc_count=0
while IFS= read -r pvc_name; do
  [[ -z "$pvc_name" ]] && continue
  pvc_count=$((pvc_count + 1))
  phase="$(kube -n "$namespace" get pvc "$pvc_name" -o jsonpath='{.status.phase}')"
  [[ "$phase" == Bound ]] || { echo "PVC is not Bound: $pvc_name" >&2; exit 1; }
  pvc_storage_class="$(kube -n "$namespace" get pvc "$pvc_name" -o jsonpath='{.spec.storageClassName}')"
  [[ "$pvc_storage_class" == "$storage_class" ]] || { echo "PVC storageClass mismatch: $pvc_name" >&2; exit 1; }
  pv_name="$(kube -n "$namespace" get pvc "$pvc_name" -o jsonpath='{.spec.volumeName}')"
  [[ -n "$pv_name" ]] || { echo "PVC has no bound PV: $pvc_name" >&2; exit 1; }
  host_path="$(kube get pv "$pv_name" -o jsonpath='{.spec.hostPath.path}')"
  empty_dir="$(kube get pv "$pv_name" -o jsonpath='{.spec.local}')"
  [[ -z "$host_path" && -z "$empty_dir" ]] || {
    echo "PV uses worker-local hostPath/local storage: $pv_name" >&2
    exit 1
  }
done <<< "$pvc_names"
[[ "$pvc_count" -ge 3 ]] || { echo "expected at least 3 CNPG PVCs, found $pvc_count" >&2; exit 1; }

destination="$(kube -n "$namespace" get objectstore.barmancloud.cnpg.io "$object_store_name" -o jsonpath='{.spec.configuration.destinationPath}')"
[[ "$destination" =~ ^(s3|https?):// ]] || {
  echo "ObjectStore destination must be an external s3/http(s) URL" >&2
  exit 1
}
kube -n "$namespace" get secret "$object_store_secret" >/dev/null
secret_data="$(kube -n "$namespace" get secret "$object_store_secret" -o jsonpath='{.data}')"
[[ "$secret_data" != "{}" && -n "$secret_data" ]] || {
  echo "ObjectStore Secret has no data: $object_store_secret" >&2
  exit 1
}

printf 'production CNPG preflight passed: namespace=%s cluster=%s instances=%s pvc_count=%s storageClass=%s objectStore=%s retention_days=%s rpo_minutes=%s rto_minutes=%s schedule=%s\n' \
  "$namespace" "$cluster_name" "$cluster_instances" "$pvc_count" "$storage_class" "$object_store_name" "$retention_days" "$rpo_minutes" "$rto_minutes" "$backup_schedule"
