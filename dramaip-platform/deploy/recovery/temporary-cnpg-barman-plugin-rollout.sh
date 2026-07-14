#!/usr/bin/env bash
set -euo pipefail

# CNPG 1.30 keeps an existing instance Pod until it is restarted. After the
# Cluster has atomically switched to the plugin, this controlled worker-only
# rollout replaces both standbys one by one and finally the primary. The last
# replacement deliberately exercises HA failover. Every replacement must have
# the restartable plugin-barman-cloud initContainer before the script passes.

[[ "${DRAMAIP_CNPG_PLUGIN_ROLLOUT_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_ROLLOUT_AUTHORIZED=1 before restarting temporary CNPG instances" >&2
  exit 2
}

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 127; }

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
plugin_name="barman-cloud.cloudnative-pg.io"
timeout_seconds="${DRAMAIP_CNPG_PLUGIN_ROLLOUT_TIMEOUT_SECONDS:-600}"
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || { echo "timeout must be a positive integer" >&2; exit 2; }

temporary_label="$(kube -n "$namespace" get cluster "$cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || { echo "refusing to restart a non-temporary cluster" >&2; exit 1; }
plugin_configured="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.spec.plugins[0].name}')"
[[ "$plugin_configured" == "$plugin_name" ]] || { echo "plugin is not configured on the temporary cluster" >&2; exit 1; }

wait_replacement() {
  local pod="$1" old_uid="$2" deadline new_uid components
  deadline=$((SECONDS + timeout_seconds))
  while :; do
    new_uid="$(kube -n "$namespace" get pod "$pod" -o jsonpath='{.metadata.uid}' 2>/dev/null || true)"
    if [[ -n "$new_uid" && "$new_uid" != "$old_uid" ]]; then
      kube -n "$namespace" wait "pod/$pod" --for=condition=Ready --timeout="${timeout_seconds}s"
      components="$(kube -n "$namespace" get pod "$pod" \
        -o jsonpath='{.spec.initContainers[*].name} {.spec.containers[*].name}')"
      [[ " $components " == *" plugin-barman-cloud "* ]] || {
        echo "replacement $pod has no plugin-barman-cloud native sidecar" >&2
        return 1
      }
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "timed out waiting for replacement of $pod" >&2
      return 1
    fi
    sleep 2
  done
}

primary="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
[[ "$primary" =~ ^${cluster}-[1-3]$ ]] || { echo "unexpected current primary" >&2; exit 1; }
mapfile -t pods < <(kube -n "$namespace" get pods -l "cnpg.io/cluster=$cluster" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
[[ "${#pods[@]}" == "3" ]] || { echo "expected exactly three temporary instances" >&2; exit 1; }

for pod in "${pods[@]}"; do
  [[ "$pod" == "$primary" ]] && continue
  old_uid="$(kube -n "$namespace" get pod "$pod" -o jsonpath='{.metadata.uid}')"
  kube -n "$namespace" delete pod "$pod" --wait=false
  wait_replacement "$pod" "$old_uid"
  kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="${timeout_seconds}s"
done

old_primary_uid="$(kube -n "$namespace" get pod "$primary" -o jsonpath='{.metadata.uid}')"
kube -n "$namespace" delete pod "$primary" --wait=false
deadline=$((SECONDS + timeout_seconds))
while :; do
  new_primary="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
  if [[ -n "$new_primary" && "$new_primary" != "$primary" ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for temporary primary failover" >&2
    exit 1
  fi
  sleep 2
done
wait_replacement "$primary" "$old_primary_uid"
kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="${timeout_seconds}s"

for pod in $(kube -n "$namespace" get pods -l "cnpg.io/cluster=$cluster" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'); do
  components="$(kube -n "$namespace" get pod "$pod" \
    -o jsonpath='{.spec.initContainers[*].name} {.spec.containers[*].name}')"
  [[ " $components " == *" plugin-barman-cloud "* ]] || {
    echo "plugin sidecar is absent from $pod after rollout" >&2
    exit 1
  }
done

new_primary="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
kube -n "$namespace" get cluster "$cluster"
kube -n "$namespace" get pods -l "cnpg.io/cluster=$cluster" -o wide
echo "temporary plugin rollout passed: old_primary=$primary new_primary=$new_primary instances=3/3"
