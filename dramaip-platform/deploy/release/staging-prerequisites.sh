#!/usr/bin/env bash
set -euo pipefail

# Read-only readiness gate for an operator-managed staging cluster. This
# intentionally does not bootstrap infrastructure, generate credentials, or
# create Kubernetes resources: those operations must remain separately
# approved and auditable.
environment="${1:-staging}"
[[ "$environment" == "staging" ]] || {
  echo "staging-prerequisites.sh only supports staging" >&2
  exit 2
}

namespace="${DRAMAIP_NAMESPACE:-dramaip-staging}"
ingress_class="${DRAMAIP_INGRESS_CLASS:-kong}"
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. registry.example/dramaip}"

runtime_secret="${DRAMAIP_RUNTIME_SECRET:-dramaip-staging-runtime}"
auth_jwt_secret="${DRAMAIP_AUTH_JWT_SECRET:-dramaip-staging-auth-jwt}"
admin_jwt_secret="${DRAMAIP_ADMIN_JWT_SECRET:-dramaip-staging-admin-jwt}"
mtls_secret="${DRAMAIP_INTERNAL_MTLS_SECRET:-dramaip-staging-internal-mtls}"
image_pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:-dramaip-staging-registry}"
ingress_tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:-dramaip-staging-ingress-tls}"

kubectl_cmd=(kubectl)
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
fi

command -v kubectl >/dev/null || {
  echo "kubectl is required" >&2
  exit 127
}
command -v curl >/dev/null || {
  echo "curl is required for the registry reachability check" >&2
  exit 127
}

require_permission() {
  local verb="$1"
  local resource="$2"
  local answer
  answer="$("${kubectl_cmd[@]}" auth can-i "$verb" "$resource" --namespace "$namespace")"
  [[ "$answer" == "yes" ]] || {
    echo "missing Kubernetes permission: $verb $resource in namespace $namespace" >&2
    exit 1
  }
}

require_release_resource() {
  local resource="$1"
  local verb
  # Helm reads the live object to calculate the release diff and --atomic must
  # be able to roll back its own partially created objects. `rollout status`
  # additionally watches Deployments and Jobs through their Pods.
  for verb in get list watch create update patch delete; do
    require_permission "$verb" "$resource"
  done
}

"${kubectl_cmd[@]}" get namespace "$namespace" >/dev/null || {
  echo "required staging namespace does not exist: $namespace" >&2
  exit 1
}

for resource in \
  secrets \
  configmaps \
  serviceaccounts \
  services \
  deployments.apps \
  jobs.batch \
  horizontalpodautoscalers.autoscaling \
  poddisruptionbudgets.policy \
  ingresses.networking.k8s.io \
  kongplugins.configuration.konghq.com; do
  require_release_resource "$resource"
done
for verb in get list watch; do
  require_permission "$verb" pods
done

"${kubectl_cmd[@]}" get ingressclass "$ingress_class" >/dev/null || {
  echo "required IngressClass does not exist: $ingress_class" >&2
  exit 1
}
"${kubectl_cmd[@]}" get crd kongplugins.configuration.konghq.com >/dev/null || {
  echo "KongPlugin CRD is not installed; install a Kong Ingress Controller compatible with the chart first" >&2
  exit 1
}

for secret in "$runtime_secret" "$auth_jwt_secret" "$admin_jwt_secret" "$mtls_secret"; do
  "${kubectl_cmd[@]}" --namespace "$namespace" get secret "$secret" >/dev/null || {
    echo "required operator-managed Secret does not exist: $secret" >&2
    exit 1
  }
done

pull_type="$("${kubectl_cmd[@]}" --namespace "$namespace" get secret "$image_pull_secret" -o jsonpath='{.type}')"
[[ "$pull_type" == "kubernetes.io/dockerconfigjson" ]] || {
  echo "image pull Secret $image_pull_secret must have type kubernetes.io/dockerconfigjson" >&2
  exit 1
}

tls_type="$("${kubectl_cmd[@]}" --namespace "$namespace" get secret "$ingress_tls_secret" -o jsonpath='{.type}')"
[[ "$tls_type" == "kubernetes.io/tls" ]] || {
  echo "Ingress TLS Secret $ingress_tls_secret must have type kubernetes.io/tls" >&2
  exit 1
}

# IMAGE_REGISTRY is a repository prefix. The first path element is the registry
# authority accepted by OCI clients, e.g. registry.example:5000 in
# registry.example:5000/dramaip. A 401 response means the registry is reachable
# and correctly requires operator credentials; no credential is supplied here.
registry_authority="${registry%%/*}"
registry_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout "${DRAMAIP_REGISTRY_CONNECT_TIMEOUT_SECONDS:-5}" \
  --max-time "${DRAMAIP_REGISTRY_TIMEOUT_SECONDS:-10}" \
  "https://$registry_authority/v2/" || true)"
case "$registry_status" in
  200|401) ;;
  *)
    echo "OCI registry is not reachable over HTTPS at $registry_authority/v2/ (HTTP ${registry_status:-000})" >&2
    exit 1
    ;;
esac

echo "staging prerequisites passed: namespace, release permissions, Kong ingress, operator-managed Secrets, and OCI registry reachability"
