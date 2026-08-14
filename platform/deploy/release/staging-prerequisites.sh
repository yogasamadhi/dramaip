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
temporary_staging="${DRAMAIP_TEMPORARY_STAGING_INFRA:-0}"
image_distribution="${DRAMAIP_STAGING_IMAGE_DISTRIBUTION:-registry}"

runtime_secret="${DRAMAIP_RUNTIME_SECRET:-dramaip-staging-runtime}"
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
if [[ "$image_distribution" == "registry" ]]; then
  command -v curl >/dev/null || {
    echo "curl is required for the registry reachability check" >&2
    exit 127
  }
fi
if [[ "$temporary_staging" == "1" ]]; then
  [[ "${DRAMAIP_TEMPORARY_STAGING_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_TEMPORARY_STAGING_AUTHORIZED=1 for isolated temporary staging" >&2; exit 2; }
  [[ "$namespace" =~ ^dramaip-staging(-[a-z0-9]+)?$ ]] || { echo "temporary staging namespace must start with dramaip-staging" >&2; exit 2; }
  [[ "$registry" == "dramaip-staging.local" ]] || { echo "temporary staging requires IMAGE_REGISTRY=dramaip-staging.local" >&2; exit 2; }
  [[ "$image_distribution" == "preloaded" ]] || { echo "temporary staging requires DRAMAIP_STAGING_IMAGE_DISTRIBUTION=preloaded" >&2; exit 2; }
fi

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

required_secrets=("$runtime_secret")
for secret in "${required_secrets[@]}"; do
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
if [[ "$image_distribution" == "preloaded" ]]; then
  image_tag="${IMAGE_TAG:?IMAGE_TAG is required to verify preloaded staging images}"
  marker_tag="$("${kubectl_cmd[@]}" -n "$namespace" get configmap dramaip-staging-image-preload -o jsonpath='{.data.image-tag}' 2>/dev/null || true)"
  [[ "$marker_tag" == "$image_tag" ]] || {
    echo "node-local image preload marker is absent or does not match IMAGE_TAG" >&2
    exit 1
  }
else
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
fi

echo "staging prerequisites passed: namespace, release permissions, Kong ingress, operator-managed Secrets, and image distribution"
