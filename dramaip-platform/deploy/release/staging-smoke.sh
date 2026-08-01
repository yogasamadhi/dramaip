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
timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$script_dir/images.tsv}"
[[ -f "$manifest" ]] || { echo "image manifest does not exist: $manifest" >&2; exit 2; }
kubectl_cmd=(kubectl)
helm_cmd=("${DRAMAIP_HELM_BIN:-helm}")
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
fi

"${helm_cmd[@]}" status "$release" --namespace "$namespace" >/dev/null

component_count=0
while IFS='|' read -r key component kind target; do
  [[ -z "${key// }" || "$key" == \#* || "$key" == "migration" ]] && continue
  deployment_count="$("${kubectl_cmd[@]}" -n "$namespace" get deployment -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=$component" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$component" == "web" && "$deployment_count" == "0" ]]; then
    continue
  fi
  [[ "$deployment_count" == "1" ]] || { echo "expected one deployment for $component; found $deployment_count" >&2; exit 1; }
  "${kubectl_cmd[@]}" -n "$namespace" rollout status deployment \
    -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=$component" \
    --timeout="$timeout"
  if [[ "$component" == "web" ]]; then
    component_count=$((component_count + 1))
    continue
  fi
  component_count=$((component_count + 1))
done < "$manifest"
[[ "$component_count" -ge "7" && "$component_count" -le "8" ]] || { echo "expected Gateway, six Java services, and optional Web; found $component_count workloads" >&2; exit 1; }

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
gateway_status="$("${curl_common[@]}" --output /dev/null --write-out '%{http_code}' -H 'X-DramaIP-Contract-Version: 2' "$base_url/api/v1/plans")"
[[ "$gateway_status" == "401" ]] || { echo "Java Gateway did not enforce JWT on /api/v1/plans: HTTP $gateway_status" >&2; exit 1; }

[[ "${SMOKE_RATE_LIMIT_TEST:-0}" == "1" ]] || {
  echo "set SMOKE_RATE_LIMIT_TEST=1 for the approved Kong rate-limit probe" >&2
  exit 2
}
attempts="${SMOKE_RATE_LIMIT_ATTEMPTS:?SMOKE_RATE_LIMIT_ATTEMPTS must exceed the configured minute limit}"
[[ "$attempts" =~ ^[0-9]+$ && "$attempts" -gt 1 ]] || {
  echo "SMOKE_RATE_LIMIT_ATTEMPTS must be an integer greater than one" >&2
  exit 2
}
rate_url="${SMOKE_RATE_LIMIT_URL:-$base_url/api/v1/plans}"
seen_limited=0
for ((attempt = 1; attempt <= attempts; attempt++)); do
  status="$("${curl_common[@]}" --output /dev/null --write-out '%{http_code}' -H 'X-DramaIP-Contract-Version: 2' "$rate_url")"
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
# The probe intentionally exhausts the per-client Kong budget. A second
# request from this same client can correctly be 429, so the health assertion
# above must remain the reachability check rather than treating that expected
# rate-limit response as an application failure.

echo "$environment smoke passed: Java rollout, Gateway JWT boundary, and ingress rate limiting"
