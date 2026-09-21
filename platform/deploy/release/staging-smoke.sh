#!/usr/bin/env bash
set -euo pipefail

# This is an explicit, operator-invoked staging/production acceptance check.
# It does not create, update, or delete resources. Rate-limit probing is off
# until the operator explicitly enables it because it generates real traffic.
environment="${1:?usage: staging-smoke.sh <staging|production>}"
[[ "${DRAMAIP_SMOKE_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_SMOKE_AUTHORIZED=1 after approval" >&2; exit 2; }

case "$environment" in
  staging) default_namespace="dramaip-staging" ;;
  production) default_namespace="dramaip-production" ;;
  *) echo "environment must be staging or production" >&2; exit 2 ;;
esac

namespace="${DRAMAIP_NAMESPACE:-$default_namespace}"
release="${DRAMAIP_RELEASE:-dramaip-platform}"
timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}"
temporary_staging="${DRAMAIP_TEMPORARY_STAGING_INFRA:-0}"
[[ "$temporary_staging" == "0" || "$temporary_staging" == "1" ]] || {
  echo "DRAMAIP_TEMPORARY_STAGING_INFRA must be 0 or 1" >&2
  exit 2
}
[[ "$temporary_staging" != "1" || "$environment" == "staging" ]] || {
  echo "temporary embedded observability is only available for staging" >&2
  exit 2
}
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$script_dir/images.tsv}"
alertmanager_route_check_chart="$script_dir/alertmanager-route-check"
[[ -f "$manifest" ]] || { echo "image manifest does not exist: $manifest" >&2; exit 2; }
kubectl_cmd=(kubectl)
helm_cmd=("${DRAMAIP_HELM_BIN:-helm}")
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
fi

"${helm_cmd[@]}" status "$release" --namespace "$namespace" >/dev/null

if [[ "$temporary_staging" != "1" ]]; then
  command -v jq >/dev/null || { echo "jq is required for external alerting smoke checks" >&2; exit 2; }
  [[ -f "$alertmanager_route_check_chart/Chart.yaml" ]] || {
    echo "Alertmanager route validation chart is missing" >&2
    exit 2
  }
  notification_route="${DRAMAIP_ALERT_NOTIFICATION_ROUTE:?DRAMAIP_ALERT_NOTIFICATION_ROUTE is required for external alerting smoke checks}"
  [[ "$notification_route" =~ ^[A-Za-z0-9_.:-]+$ ]] || {
    echo "DRAMAIP_ALERT_NOTIFICATION_ROUTE must contain only letters, digits, dot, underscore, colon, or hyphen" >&2
    exit 2
  }
  expected_alerts=(
    DramaipTargetDown
    DramaipHighRequestErrorRate
    DramaipPaymentConfirmationFailed
    DramaipQuotaRejectionsHigh
    DramaipOutboxBacklog
    DramaipRabbitMQQueueBacklog
    DramaipDatabasePoolSaturated
    DramaipProviderFailureRate
    DramaipProviderLatencyHigh
    DramaipProviderCostAlert
    DramaipErrorAggregationHigh
    DramaipAlloyTraceExportFailures
    DramaipAlloyTraceQueueSaturated
    DramaipAlloyLogWriteDrops
    DramaipAlloyLogWriteRetriesHigh
    DramaipSensitiveLogRejected
    DramaipLokiDiscardingLogs
    DramaipLokiWalCorruption
    DramaipLokiWalDiskPressure
    DramaipLokiWalWriteFailures
    DramaipTempoDiscardingSpans
  )
  expected_alerts_json="$(printf '%s\n' "${expected_alerts[@]}" | jq -R . | jq -s 'sort')"

  # Inspect only the published custom resource. This does not evaluate a rule or
  # send a synthetic alert. Keep the JSON in memory so a failed assertion cannot
  # dump annotations or future sensitive configuration to the console.
  prometheus_rule_json="$("${kubectl_cmd[@]}" -n "$namespace" get prometheusrules.monitoring.coreos.com \
    -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=observability-alert-rules" -o json)"
  jq -e --arg route "$notification_route" --arg release "$release" --argjson expected "$expected_alerts_json" '
    (.items | length) == 1
    and ([.items[0].spec.groups[]?.name] | sort)
      == ["dramaip-observability-pipeline", "dramaip-platform-reliability"]
    and ([.items[0].spec.groups[]?.rules[]?.alert] | sort) == $expected
    and all(.items[0].spec.groups[]?.rules[]?;
      .labels.team == "dramaip-platform"
      and .labels.notification_route == $route
      and .labels.dramaip_release == $release)
  ' <<<"$prometheus_rule_json" >/dev/null || {
    echo "PrometheusRule is missing, incomplete, or does not carry the approved notification route" >&2
    exit 1
  }
  unset prometheus_rule_json
fi

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
[[ "$component_count" -ge "8" && "$component_count" -le "9" ]] || { echo "expected Gateway, seven Java services, and optional Web; found $component_count workloads" >&2; exit 1; }

base_url="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required, e.g. https://api.staging.example.com}"
base_url="${base_url%/}"
# --disable prevents an operator's curlrc from silently enabling verbose output
# or other options that could expose an injected authorization header.
curl_common=(curl --disable --show-error --silent --max-time "${SMOKE_HTTP_TIMEOUT_SECONDS:-10}")
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

if [[ "$temporary_staging" != "1" ]]; then
  prometheus_url="${SMOKE_PROMETHEUS_URL:?SMOKE_PROMETHEUS_URL is required for external alerting smoke checks}"
  alertmanager_url="${SMOKE_ALERTMANAGER_URL:?SMOKE_ALERTMANAGER_URL is required for external alerting smoke checks}"
  prometheus_url="${prometheus_url%/}"
  alertmanager_url="${alertmanager_url%/}"
  for observability_url in "$prometheus_url" "$alertmanager_url"; do
    [[ "$observability_url" =~ ^https?://[^[:space:]]+$ ]] || {
      echo "external observability URLs must be absolute HTTP(S) URLs without whitespace" >&2
      exit 2
    }
    [[ ! "$observability_url" =~ ^https?://[^/@]+@ ]] || {
      echo "external observability URLs must not contain credentials; use an authorization header file" >&2
      exit 2
    }
  done

  prometheus_curl=("${curl_common[@]}")
  alertmanager_curl=("${curl_common[@]}")
  if [[ -n "${SMOKE_PROMETHEUS_AUTH_HEADER_FILE:-}" ]]; then
    [[ -f "$SMOKE_PROMETHEUS_AUTH_HEADER_FILE" && -r "$SMOKE_PROMETHEUS_AUTH_HEADER_FILE" && -s "$SMOKE_PROMETHEUS_AUTH_HEADER_FILE" ]] || {
      echo "SMOKE_PROMETHEUS_AUTH_HEADER_FILE must identify a readable, non-empty file" >&2
      exit 2
    }
    prometheus_curl+=(--header "@$SMOKE_PROMETHEUS_AUTH_HEADER_FILE")
  fi
  if [[ -n "${SMOKE_ALERTMANAGER_AUTH_HEADER_FILE:-}" ]]; then
    [[ -f "$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE" && -r "$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE" && -s "$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE" ]] || {
      echo "SMOKE_ALERTMANAGER_AUTH_HEADER_FILE must identify a readable, non-empty file" >&2
      exit 2
    }
    alertmanager_curl+=(--header "@$SMOKE_ALERTMANAGER_AUTH_HEADER_FILE")
  fi

  prometheus_rules="$("${prometheus_curl[@]}" --fail "$prometheus_url/api/v1/rules?type=alert")" || {
    echo "external Prometheus rules API is not reachable" >&2
    exit 1
  }
  jq -e --arg route "$notification_route" --arg release "$release" --argjson expected "$expected_alerts_json" '
    .status == "success"
    and ([.data.groups[]?
      | select(.name == "dramaip-platform-reliability" or .name == "dramaip-observability-pipeline")
      | .name] | sort) == ["dramaip-observability-pipeline", "dramaip-platform-reliability"]
    and ([.data.groups[]?
      | select(.name == "dramaip-platform-reliability" or .name == "dramaip-observability-pipeline")
      | .rules[]?.name] | sort) == $expected
    and all(.data.groups[]?
      | select(.name == "dramaip-platform-reliability" or .name == "dramaip-observability-pipeline")
      | .rules[]?;
      .type == "alerting"
      and .health == "ok"
      and (.lastError // "") == ""
      and .labels.team == "dramaip-platform"
      and .labels.notification_route == $route
      and .labels.dramaip_release == $release)
  ' <<<"$prometheus_rules" >/dev/null || {
    echo "external Prometheus has not loaded all healthy DramaIP alert rules with the approved labels" >&2
    exit 1
  }
  unset prometheus_rules

  prometheus_alertmanagers="$("${prometheus_curl[@]}" --fail "$prometheus_url/api/v1/alertmanagers")" || {
    echo "external Prometheus Alertmanager discovery API is not reachable" >&2
    exit 1
  }
  jq -e '
    .status == "success"
    and ([.data.activeAlertmanagers[]? | .url? | select(type == "string" and length > 0)] | length) > 0
  ' <<<"$prometheus_alertmanagers" >/dev/null || {
    echo "external Prometheus has no active Alertmanager" >&2
    exit 1
  }
  unset prometheus_alertmanagers expected_alerts_json expected_alerts

  "${alertmanager_curl[@]}" --fail --output /dev/null "$alertmanager_url/-/ready" || {
    echo "external Alertmanager is not ready" >&2
    exit 1
  }
  alertmanager_status="$("${alertmanager_curl[@]}" --fail "$alertmanager_url/api/v2/status")" || {
    echo "external Alertmanager status API is not reachable" >&2
    exit 1
  }
  # Parse the original configuration as YAML and walk the route tree. The
  # configuration travels only over stdin and neither Helm output nor parser
  # diagnostics are emitted, so receiver credentials cannot reach the console.
  if ! jq -er '.config.original | select(type == "string" and length > 0)' <<<"$alertmanager_status" \
    | "${helm_cmd[@]}" template dramaip-alertmanager-route-check "$alertmanager_route_check_chart" \
      --set-file alertmanagerConfig=/dev/stdin \
      --set-string "notificationRoute=$notification_route" >/dev/null 2>&1; then
    echo "external Alertmanager has no route node binding the approved notification_route matcher to a receiver" >&2
    exit 1
  fi
  unset alertmanager_status
else
  echo "temporary embedded staging: skipping external Prometheus and Alertmanager notification checks"
fi

gateway_status="$("${curl_common[@]}" --output /dev/null --write-out '%{http_code}' -H 'X-DramaIP-Contract-Version: 2' "$base_url/api/v1/plans")"
[[ "$gateway_status" == "401" ]] || { echo "Java Gateway did not enforce JWT on /api/v1/plans: HTTP $gateway_status" >&2; exit 1; }

[[ "${SMOKE_RATE_LIMIT_TEST:-0}" == "1" ]] || {
  echo "set SMOKE_RATE_LIMIT_TEST=1 for the approved ingress rate-limit probe" >&2
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
[[ "$seen_limited" == "1" ]] || { echo "ingress rate limit was not observed" >&2; exit 1; }
# The probe intentionally exhausts the per-client ingress budget. A second
# request from this same client can correctly be 429, so the health assertion
# above must remain the reachability check rather than treating that expected
# rate-limit response as an application failure.

if [[ "$temporary_staging" == "1" ]]; then
  echo "$environment smoke passed: Java rollout, Gateway JWT boundary, ingress rate limiting, and embedded alerting exception"
else
  echo "$environment smoke passed: Java rollout, Gateway JWT boundary, ingress rate limiting, Prometheus rules, and Alertmanager routing"
fi
