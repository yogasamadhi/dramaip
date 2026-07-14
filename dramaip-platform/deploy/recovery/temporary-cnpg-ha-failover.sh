#!/usr/bin/env bash
set -euo pipefail

# Performs a deliberately scoped failover rehearsal against only the disposable
# three-node CNPG cluster created by temporary-cnpg-ha-staging.sh. This script
# never accepts a namespace or cluster override so it cannot target an
# application database by accident.

[[ "${DRAMAIP_CNPG_FAILOVER_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_FAILOVER_AUTHORIZED=1 before running the temporary failover rehearsal" >&2
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
timeout_seconds="${DRAMAIP_CNPG_FAILOVER_TIMEOUT_SECONDS:-300}"

[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "DRAMAIP_CNPG_FAILOVER_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
}

temporary_label="$(kube -n "$namespace" get cluster "$cluster" \
  -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')"
[[ "$temporary_label" == "true" ]] || {
  echo "refusing to act: $namespace/$cluster is not labelled dramaip.io/temporary=true" >&2
  exit 1
}

primary_before="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
[[ "$primary_before" =~ ^dramaip-recovery-ha-[1-3]$ ]] || {
  echo "refusing to act: unexpected current primary: ${primary_before:-<empty>}" >&2
  exit 1
}

primary_node="$(kube -n "$namespace" get pod "$primary_before" -o jsonpath='{.spec.nodeName}')"
worker_label="$(kube get node "$primary_node" \
  -o go-template='{{ index .metadata.labels "node-role.kubernetes.io/worker" }}')"
[[ "$worker_label" == "worker" ]] || {
  echo "refusing to act: primary $primary_before is not scheduled on a labeled worker" >&2
  exit 1
}

psql_query() {
  local pod="$1"
  local query="$2"
  kube -n "$namespace" exec "$pod" -- \
    psql -v ON_ERROR_STOP=1 -U postgres -d app -Atqc "$query"
}

drill_id="ha-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
psql_query "$primary_before" "
  CREATE SCHEMA IF NOT EXISTS recovery_ha_drill;
  CREATE TABLE IF NOT EXISTS recovery_ha_drill.ledger (
    drill_id text PRIMARY KEY,
    writer_pod text NOT NULL,
    written_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  INSERT INTO recovery_ha_drill.ledger (drill_id, writer_pod)
  VALUES ('$drill_id', '$primary_before')
  ON CONFLICT (drill_id) DO NOTHING;
"

writer_before="$(psql_query "$primary_before" \
  "SELECT writer_pod FROM recovery_ha_drill.ledger WHERE drill_id = '$drill_id';")"
[[ "$writer_before" == "$primary_before" ]] || {
  echo "failed to persist the temporary drill marker on $primary_before" >&2
  exit 1
}

replication_deadline=$((SECONDS + timeout_seconds))
while :; do
  streaming_replicas="$(psql_query "$primary_before" \
    "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming';")"
  if [[ "$streaming_replicas" =~ ^[0-9]+$ ]] && (( streaming_replicas >= 2 )); then
    break
  fi
  if (( SECONDS >= replication_deadline )); then
    echo "timed out waiting for two streaming replicas; last count: $streaming_replicas" >&2
    exit 1
  fi
  sleep 2
done

started_at="$SECONDS"
echo "deleting temporary primary $primary_before on worker $primary_node after $streaming_replicas replicas streamed marker $drill_id"
kube -n "$namespace" delete pod "$primary_before" --wait=false

failover_deadline=$((SECONDS + timeout_seconds))
primary_after=""
while (( SECONDS < failover_deadline )); do
  candidate="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.currentPrimary}')"
  if [[ "$candidate" =~ ^dramaip-recovery-ha-[1-3]$ ]] && [[ "$candidate" != "$primary_before" ]]; then
    writer_after="$(psql_query "$candidate" \
      "SELECT writer_pod FROM recovery_ha_drill.ledger WHERE drill_id = '$drill_id';" 2>/dev/null || true)"
    if [[ "$writer_after" == "$primary_before" ]]; then
      primary_after="$candidate"
      break
    fi
  fi
  sleep 2
done

[[ -n "$primary_after" ]] || {
  echo "timed out waiting for a different primary to read the replicated drill marker" >&2
  exit 1
}

elapsed=$((SECONDS - started_at))
kube -n "$namespace" wait "cluster/$cluster" --for=condition=Ready --timeout="${timeout_seconds}s"
ready_instances="$(kube -n "$namespace" get cluster "$cluster" -o jsonpath='{.status.readyInstances}')"
[[ "$ready_instances" == "3" ]] || {
  echo "new primary preserved the marker, but the cluster did not return to three ready instances" >&2
  exit 1
}
kube -n "$namespace" get cluster "$cluster"
kube -n "$namespace" get pods -l "cnpg.io/cluster=$cluster" -o wide
echo "temporary CNPG failover passed: $primary_before -> $primary_after; replicated marker preserved; elapsed=${elapsed}s"
