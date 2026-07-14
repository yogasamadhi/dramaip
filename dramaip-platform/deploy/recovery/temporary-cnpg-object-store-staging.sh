#!/usr/bin/env bash
set -euo pipefail

# Creates only the disposable MinIO endpoint used to exercise CNPG's Barman
# object-store path. Generated credentials stay in a temporary Kubernetes
# Secret and are never printed, written to disk, or committed.

[[ "${DRAMAIP_CNPG_OBJECT_STORE_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_OBJECT_STORE_AUTHORIZED=1 before creating temporary object-store resources" >&2
  exit 2
}

for command in kubectl openssl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 127; }
done

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
secret="cnpg-recovery-minio-credentials"
deployment="cnpg-recovery-minio"
bucket_job="cnpg-recovery-minio-bucket"
timeout="${DRAMAIP_CNPG_OBJECT_STORE_TIMEOUT:-5m}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
manifest="$script_dir/temporary-cnpg-object-store.yaml"

[[ -f "$manifest" ]] || { echo "missing $manifest" >&2; exit 2; }
temporary_label="$(kube -n "$namespace" get cluster "$cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || {
  echo "refusing to create object storage without the temporary CNPG rehearsal cluster" >&2
  exit 1
}

if kube -n "$namespace" get secret "$secret" >/dev/null 2>&1; then
  secret_label="$(kube -n "$namespace" get secret "$secret" \
    -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
  [[ "$secret_label" == "true" ]] || {
    echo "refusing to reuse a non-temporary Secret named $secret" >&2
    exit 1
  }
else
  access_key="dramaip$(openssl rand -hex 8)"
  secret_key="$(openssl rand -hex 32)"
  kube -n "$namespace" apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: $secret
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
type: Opaque
stringData:
  ACCESS_KEY_ID: $access_key
  SECRET_ACCESS_KEY: $secret_key
  AWS_REGION: us-east-1
EOF
fi

kube -n "$namespace" apply -f "$manifest"
kube -n "$namespace" rollout status "deployment/$deployment" --timeout="$timeout"
kube -n "$namespace" wait "job/$bucket_job" --for=condition=complete --timeout="$timeout"
kube -n "$namespace" get deployment "$deployment"
kube -n "$namespace" get service "$deployment"
kube -n "$namespace" get job "$bucket_job"
