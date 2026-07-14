#!/usr/bin/env bash
set -euo pipefail

# Installs only a disposable worker-only HA rehearsal. It intentionally omits
# production object storage, encryption, and retention; those require a real
# independently managed target and must not be simulated by worker-local PVs.

[[ "${DRAMAIP_CNPG_STAGING_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_STAGING_AUTHORIZED=1 before creating temporary CNPG resources" >&2
  exit 2
}

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 127; }

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

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
infra_manifest="$script_dir/temporary-cnpg-ha-infra.yaml"
cluster_manifest="$script_dir/temporary-cnpg-ha-cluster.yaml"
operator_manifest_url="https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.30/releases/cnpg-1.30.0.yaml"
operator_manifest_path="${DRAMAIP_CNPG_OPERATOR_MANIFEST_PATH:-}"
namespace="dramaip-recovery-staging"
cluster="dramaip-recovery-ha"
operator_namespace="cnpg-system"
operator_deployment="cnpg-controller-manager"
timeout="${DRAMAIP_CNPG_STAGING_TIMEOUT:-10m}"

[[ -f "$infra_manifest" ]] || { echo "missing $infra_manifest" >&2; exit 2; }
[[ -f "$cluster_manifest" ]] || { echo "missing $cluster_manifest" >&2; exit 2; }

worker_count="$(kube get nodes -l node-role.kubernetes.io/worker=worker --no-headers | awk 'END { print NR }')"
[[ "$worker_count" -ge 3 ]] || {
  echo "at least three labeled worker nodes are required; found $worker_count" >&2
  exit 1
}

tmp_operator_manifest="$(mktemp)"
cleanup() {
  rm -f "$tmp_operator_manifest" "$tmp_operator_manifest.offline"
}
trap cleanup EXIT

if [[ -n "$operator_manifest_path" ]]; then
  [[ -f "$operator_manifest_path" ]] || {
    echo "DRAMAIP_CNPG_OPERATOR_MANIFEST_PATH does not exist: $operator_manifest_path" >&2
    exit 2
  }
  echo "using prevalidated local CloudNativePG 1.30.0 operator manifest"
else
  echo "downloading pinned CloudNativePG 1.30.0 operator manifest"
  curl --fail --location --silent --show-error "$operator_manifest_url" --output "$tmp_operator_manifest"
fi

# The official manifest uses Always for the controller. This isolated rehearsal
# imports the reviewed amd64 image into every worker first, so avoid an
# unnecessary and unreliable registry pull. Only the temporary copy changes.
sed 's/^        imagePullPolicy: Always$/        imagePullPolicy: IfNotPresent/' \
  "${operator_manifest_path:-$tmp_operator_manifest}" > "$tmp_operator_manifest.offline"
operator_manifest="$tmp_operator_manifest.offline"
grep -q '^        imagePullPolicy: IfNotPresent$' "$operator_manifest" || {
  echo "failed to set CNPG controller imagePullPolicy to IfNotPresent" >&2
  exit 1
}

echo "applying temporary worker-local PV infrastructure"
kube apply --server-side -f "$infra_manifest"

echo "installing CloudNativePG operator; masters are NoSchedule-tainted and cluster Pods select workers"
kube apply --server-side -f "$operator_manifest"
kube -n "$operator_namespace" rollout status "deployment/$operator_deployment" --timeout="$timeout"

echo "creating three-instance temporary HA cluster"
kube apply -f "$cluster_manifest"
kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="$timeout"
kube -n "$namespace" get cluster "$cluster"
kube -n "$namespace" get pods -l "cnpg.io/cluster=$cluster" -o wide
