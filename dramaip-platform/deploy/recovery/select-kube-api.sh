#!/usr/bin/env bash
set -euo pipefail

# Select the first healthy control-plane API without touching workloads. The
# result is printed so callers can export DRAMAIP_KUBECTL_SERVER for the
# existing staging/recovery scripts. The default order intentionally follows
# the small-control-plane fallback policy: master03 -> master02 -> master01.

command -v curl >/dev/null || {
  echo "curl is required" >&2
  exit 127
}

timeout_seconds="${DRAMAIP_KUBECTL_API_TIMEOUT_SECONDS:-3}"
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "DRAMAIP_KUBECTL_API_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
}

candidates_raw="${DRAMAIP_KUBECTL_API_CANDIDATES:-https://192.168.2.203:6443,https://192.168.2.202:6443,https://192.168.2.201:6443}"
IFS=',' read -r -a candidates <<< "$candidates_raw"
[[ "${#candidates[@]}" -gt 0 ]] || {
  echo "DRAMAIP_KUBECTL_API_CANDIDATES must contain at least one endpoint" >&2
  exit 2
}

for endpoint in "${candidates[@]}"; do
  [[ "$endpoint" =~ ^https://[A-Za-z0-9.-]+:[0-9]+$ ]] || {
    echo "invalid control-plane endpoint: $endpoint" >&2
    exit 2
  }

  readyz="$(curl --fail --silent --show-error --insecure \
    --connect-timeout "$timeout_seconds" --max-time "$timeout_seconds" \
    --output - "$endpoint/readyz" 2>/dev/null || true)"
  if [[ "$readyz" == "ok" ]]; then
    printf '%s\n' "$endpoint"
    exit 0
  fi
  echo "control-plane API unavailable or not ready: $endpoint" >&2
done

echo "no healthy control-plane API endpoint found" >&2
exit 1
