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
helm_cmd=(helm)
kubectl_cmd=(kubectl)
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
fi
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
"${helm_cmd[@]}" lint "$chart" -f "$values"
if [[ "$action" == "apply" ]]; then
  case "$environment" in
    staging)
      runtime_secret="${DRAMAIP_RUNTIME_SECRET:-dramaip-staging-runtime}"
      auth_jwt_secret="${DRAMAIP_AUTH_JWT_SECRET:-dramaip-staging-auth-jwt}"
      admin_jwt_secret="${DRAMAIP_ADMIN_JWT_SECRET:-dramaip-staging-admin-jwt}"
      mtls_secret="${DRAMAIP_INTERNAL_MTLS_SECRET:-dramaip-staging-internal-mtls}"
      image_pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:-dramaip-staging-registry}"
      ingress_tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:-dramaip-staging-ingress-tls}"
      ;;
    production)
      runtime_secret="${DRAMAIP_RUNTIME_SECRET:?DRAMAIP_RUNTIME_SECRET is required for production apply}"
      auth_jwt_secret="${DRAMAIP_AUTH_JWT_SECRET:?DRAMAIP_AUTH_JWT_SECRET is required for production apply}"
      admin_jwt_secret="${DRAMAIP_ADMIN_JWT_SECRET:?DRAMAIP_ADMIN_JWT_SECRET is required for production apply}"
      mtls_secret="${DRAMAIP_INTERNAL_MTLS_SECRET:?DRAMAIP_INTERNAL_MTLS_SECRET is required for production apply}"
      image_pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:?DRAMAIP_IMAGE_PULL_SECRET is required for production apply}"
      ingress_tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:?DRAMAIP_INGRESS_TLS_SECRET is required for production apply}"
      ;;
  esac
  image_registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required for apply, e.g. registry.example/dramaip}"
  image_tag="${IMAGE_TAG:?IMAGE_TAG is required for apply and must be an immutable release tag}"
  postgres_host="${DRAMAIP_POSTGRES_HOST:?DRAMAIP_POSTGRES_HOST is required for apply}"
  redis_addr="${DRAMAIP_REDIS_ADDR:?DRAMAIP_REDIS_ADDR is required for apply}"
  rabbitmq_host="${DRAMAIP_RABBITMQ_HOST:?DRAMAIP_RABBITMQ_HOST is required for apply}"
  rabbitmq_port="${DRAMAIP_RABBITMQ_PORT:?DRAMAIP_RABBITMQ_PORT is required for apply}"
  otel_endpoint="${DRAMAIP_OTEL_ENDPOINT:?DRAMAIP_OTEL_ENDPOINT is required for apply}"
  ingress_host="${DRAMAIP_PUBLIC_INGRESS_HOST:?DRAMAIP_PUBLIC_INGRESS_HOST is required for apply}"
  web_origin="${DRAMAIP_WEB_ORIGIN:?DRAMAIP_WEB_ORIGIN is required for apply}"
  admin_origin="${DRAMAIP_ADMIN_ORIGIN:?DRAMAIP_ADMIN_ORIGIN is required for apply}"

  for secret in "$runtime_secret" "$auth_jwt_secret" "$admin_jwt_secret" "$mtls_secret" "$image_pull_secret" "$ingress_tls_secret"; do
    "${kubectl_cmd[@]}" -n "$namespace" get secret "$secret" >/dev/null
  done

  image_overrides=(
    --set-string "secret.existingSecret=$runtime_secret"
    --set-string "authJWT.keysetSecret=$auth_jwt_secret"
    --set-string "adminJWT.keysetSecret=$admin_jwt_secret"
    --set-string "internalMTLS.existingSecret=$mtls_secret"
    --set-string "imagePullSecrets[0].name=$image_pull_secret"
    --set "ingress.enabled=true"
    --set-string "ingress.hosts[0].host=$ingress_host"
    --set-string "ingress.tls[0].secretName=$ingress_tls_secret"
    --set-string "ingress.tls[0].hosts[0]=$ingress_host"
    --set-string "kong.plugins.cors.origins[0]=$web_origin"
    --set "adminIngress.cors.enabled=true"
    --set-string "adminIngress.cors.origins[0]=$admin_origin"
    --set-string "config.env=$environment"
    --set-string "config.postgres.host=$postgres_host"
    --set-string "config.redis.addr=$redis_addr"
    --set-string "config.rabbitmq.host=$rabbitmq_host"
    --set-string "config.rabbitmq.port=$rabbitmq_port"
    --set-string "config.otel.endpoint=$otel_endpoint"
  )
  for image in "${images[@]}"; do
    key="${image%%:*}"
    name="${image#*:}"
    image_overrides+=(--set-string "images.$key.repository=$image_registry/$name")
    image_overrides+=(--set-string "images.$key.tag=$image_tag")
  done
  "${helm_cmd[@]}" upgrade --install "$release" "$chart" --namespace "$namespace" --create-namespace -f "$values" "${image_overrides[@]}" --atomic --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}" --history-max 10
  "${kubectl_cmd[@]}" -n "$namespace" rollout status deployment --timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}" -l app.kubernetes.io/instance="$release"
elif [[ "$action" == "rollback" ]]; then
  revision="${3:?rollback requires an audited Helm revision}"
  "${helm_cmd[@]}" rollback "$release" "$revision" --namespace "$namespace" --wait --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}"
else
  echo "action must be apply or rollback" >&2; exit 2
fi
