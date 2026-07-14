#!/usr/bin/env bash
set -euo pipefail

# This is an explicit, operator-invoked staging/production acceptance check.
# It does not create, update, or delete resources. Rate-limit probing is off
# until the operator explicitly enables it because it generates real traffic.
environment="${1:?usage: staging-smoke.sh <staging|production>}"
[[ "${DRAMAIP_SMOKE_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_SMOKE_AUTHORIZED=1 after approval" >&2; exit 2; }

case "$environment" in
  staging) default_namespace="dramaip-staging"; default_mtls_secret="dramaip-staging-internal-mtls" ;;
  production) default_namespace="dramaip-production"; default_mtls_secret="dramaip-internal-mtls" ;;
  *) echo "environment must be staging or production" >&2; exit 2 ;;
esac

namespace="${DRAMAIP_NAMESPACE:-$default_namespace}"
release="${DRAMAIP_RELEASE:-dramaip-platform}"
mtls_secret="${DRAMAIP_INTERNAL_MTLS_SECRET:-$default_mtls_secret}"
timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}"
kubectl_cmd=(kubectl)
helm_cmd=(helm)
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
fi

"${helm_cmd[@]}" status "$release" --namespace "$namespace" >/dev/null

components=(
  web-bff desktop-bff mobile-bff admin-bff auth user billing quota ai-gateway
  notification inspiration reporting notification-job reporting-job billing-job quota-job
)
for component in "${components[@]}"; do
  "${kubectl_cmd[@]}" -n "$namespace" rollout status deployment \
    -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=$component" \
    --timeout="$timeout"
  actual_secret="$("${kubectl_cmd[@]}" -n "$namespace" get deployment \
    -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=$component" \
    -o jsonpath='{.items[0].spec.template.spec.volumes[?(@.name=="internal-mtls")].secret.secretName}')"
  [[ "$actual_secret" == "$mtls_secret" ]] || {
    echo "$component does not mount expected internal mTLS Secret $mtls_secret" >&2
    exit 1
  }
done

base_url="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required, e.g. https://api.staging.example.com}"
base_url="${base_url%/}"
curl_common=(curl --show-error --silent --max-time "${SMOKE_HTTP_TIMEOUT_SECONDS:-10}")
if [[ -n "${SMOKE_CA_FILE:-}" ]]; then
  [[ -f "$SMOKE_CA_FILE" ]] || { echo "SMOKE_CA_FILE must identify a readable CA certificate file" >&2; exit 2; }
  curl_common+=(--cacert "$SMOKE_CA_FILE")
fi
if [[ -n "${SMOKE_CURL_RESOLVE:-}" ]]; then
  [[ "$SMOKE_CURL_RESOLVE" =~ ^[A-Za-z0-9.-]+:[0-9]{1,5}:[0-9A-Fa-f:.]+$ ]] || {
    echo "SMOKE_CURL_RESOLVE must be host:port:address" >&2
    exit 2
  }
  curl_common+=(--resolve "$SMOKE_CURL_RESOLVE")
fi
"${curl_common[@]}" --fail "$base_url/v1/healthz" >/dev/null

[[ "${SMOKE_RATE_LIMIT_TEST:-0}" == "1" ]] || {
  echo "set SMOKE_RATE_LIMIT_TEST=1 for the approved Kong rate-limit probe" >&2
  exit 2
}
attempts="${SMOKE_RATE_LIMIT_ATTEMPTS:?SMOKE_RATE_LIMIT_ATTEMPTS must exceed the configured minute limit}"
[[ "$attempts" =~ ^[0-9]+$ && "$attempts" -gt 1 ]] || {
  echo "SMOKE_RATE_LIMIT_ATTEMPTS must be an integer greater than one" >&2
  exit 2
}
rate_url="${SMOKE_RATE_LIMIT_URL:-$base_url/v1/plans}"
seen_limited=0
for ((attempt = 1; attempt <= attempts; attempt++)); do
  status="$("${curl_common[@]}" --output /dev/null --write-out '%{http_code}' "$rate_url")"
  if [[ "$status" == "429" ]]; then
    seen_limited=1
    break
  fi
  if [[ "$status" -ge 500 ]]; then
    echo "rate-limit probe received server error $status" >&2
    exit 1
  fi
done
[[ "$seen_limited" == "1" ]] || { echo "Kong rate limit was not observed" >&2; exit 1; }
"${curl_common[@]}" --fail "$base_url/v1/healthz" >/dev/null

echo "$environment smoke passed: rollout, mTLS Secret mounts, health, and Kong rate limiting"
