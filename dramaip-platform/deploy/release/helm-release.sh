#!/usr/bin/env bash
set -euo pipefail

# A deliberately operator-invoked release/rollback command. It is not a CI
# pipeline and requires explicit authorization for every stateful cluster
# operation.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
chart="$root/deploy/helm/dramaip-platform"
environment="${1:?usage: helm-release.sh <staging|production> <apply|rollback> [revision]}"
action="${2:?usage: helm-release.sh <staging|production> <apply|rollback> [revision]}"
namespace="${DRAMAIP_NAMESPACE:-dramaip-$environment}"
release="${DRAMAIP_RELEASE:-dramaip-platform}"
images=(
  "webBff:web-bff" "desktopBff:desktop-bff" "mobileBff:mobile-bff" "adminBff:admin-bff"
  "auth:auth" "user:user" "billing:billing" "quota:quota" "aiGateway:ai-gateway"
  "notification:notification" "inspiration:inspiration" "reporting:reporting"
  "notificationJob:notification-job" "reportingJob:reporting-job" "billingJob:billing-job"
  "quotaJob:quota-job" "migration:migrate"
)

case "$environment" in
  staging) values="$chart/values-staging.yaml" ;;
  production) values="$chart/values.yaml" ;;
  *) echo "environment must be staging or production" >&2; exit 2 ;;
esac
[[ "${DRAMAIP_RELEASE_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_RELEASE_AUTHORIZED=1 after change approval" >&2; exit 2; }
helm lint "$chart" -f "$values"
if [[ "$action" == "apply" ]]; then
  image_registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required for apply, e.g. registry.example/dramaip}"
  image_tag="${IMAGE_TAG:?IMAGE_TAG is required for apply and must be an immutable release tag}"
  image_overrides=()
  for image in "${images[@]}"; do
    key="${image%%:*}"
    name="${image#*:}"
    image_overrides+=(--set-string "images.$key.repository=$image_registry/$name")
    image_overrides+=(--set-string "images.$key.tag=$image_tag")
  done
  helm upgrade --install "$release" "$chart" --namespace "$namespace" --create-namespace -f "$values" "${image_overrides[@]}" --atomic --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}" --history-max 10
  kubectl -n "$namespace" rollout status deployment --timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}" -l app.kubernetes.io/instance="$release"
elif [[ "$action" == "rollback" ]]; then
  revision="${3:?rollback requires an audited Helm revision}"
  helm rollback "$release" "$revision" --namespace "$namespace" --wait --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}"
else
  echo "action must be apply or rollback" >&2; exit 2
fi
