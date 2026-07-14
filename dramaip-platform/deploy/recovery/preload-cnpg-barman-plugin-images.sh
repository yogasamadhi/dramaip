#!/usr/bin/env bash
set -euo pipefail

# Runs on an API-accessible release host, not on a Kubernetes control plane as
# an image build. It serves an already-created amd64 tar briefly and uses a
# worker-only Docker-socket DaemonSet to load it into every worker cache. The
# DaemonSet is deleted on success or failure; only the verified worker caches
# remain for imagePullPolicy: Never workloads.

[[ "${DRAMAIP_CNPG_PLUGIN_PRELOAD_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_PRELOAD_AUTHORIZED=1 before loading plugin images on workers" >&2
  exit 2
}

for command in kubectl python3 curl shasum; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 127; }
done

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
daemonset="dramaip-cnpg-plugin-image-loader"
archive="${DRAMAIP_CNPG_PLUGIN_IMAGE_TAR:-/tmp/dramaip-cnpg-barman-plugin-v0.13.0-amd64.tar}"
archive_sha256="${DRAMAIP_CNPG_PLUGIN_IMAGE_TAR_SHA256:-55f59fb209213a6d3b2fa9a77510e9c424c53c06b3a47df626f1ad892fc722b8}"
server_address="${DRAMAIP_CNPG_PLUGIN_PRELOAD_SERVER_ADDRESS:-192.168.2.203}"
server_port="${DRAMAIP_CNPG_PLUGIN_PRELOAD_SERVER_PORT:-18280}"
loader_image="${DRAMAIP_CNPG_PLUGIN_LOADER_IMAGE:-docker:29-cli}"
timeout_seconds="${DRAMAIP_CNPG_PLUGIN_PRELOAD_TIMEOUT_SECONDS:-600}"

[[ -f "$archive" ]] || { echo "missing image archive: $archive" >&2; exit 2; }
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "image archive SHA-256 must be lowercase hexadecimal" >&2; exit 2; }
[[ "$server_address" =~ ^[A-Za-z0-9.:-]+$ ]] || { echo "invalid preload server address" >&2; exit 2; }
[[ "$server_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( server_port <= 65535 )) || { echo "invalid preload server port" >&2; exit 2; }
[[ "$loader_image" == "docker:29-cli" || "$loader_image" == "docker.m.daocloud.io/library/docker:29-cli" ]] || {
  echo "loader image must be docker:29-cli or the approved mirror" >&2
  exit 2
}
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || { echo "timeout must be a positive integer" >&2; exit 2; }
actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
[[ "$actual_sha256" == "$archive_sha256" ]] || { echo "unexpected plugin image archive checksum" >&2; exit 1; }
kube get namespace "$namespace" >/dev/null
if kube -n "$namespace" get daemonset "$daemonset" >/dev/null 2>&1; then
  echo "a plugin image loader already exists" >&2
  exit 1
fi

server_pid=""
cleanup() {
  local status=$?
  kube -n "$namespace" delete daemonset "$daemonset" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

python3 -m http.server "$server_port" --bind "$server_address" --directory "$(dirname "$archive")" >/dev/null 2>&1 &
server_pid=$!
archive_url="http://${server_address}:${server_port}/$(basename "$archive")"
for _ in 1 2 3 4 5; do
  curl --fail --silent --max-time 2 "$archive_url" --output /dev/null && break
  sleep 1
done
curl --fail --silent --max-time 3 "$archive_url" --output /dev/null || {
  echo "temporary image archive server is unreachable" >&2
  exit 1
}

worker_count="$(kube get nodes -l node-role.kubernetes.io/worker=worker --no-headers | wc -l | tr -d ' ')"
[[ "$worker_count" =~ ^[1-9][0-9]*$ ]] || { echo "no worker nodes found" >&2; exit 1; }

kube -n "$namespace" apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: $daemonset
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: $daemonset
  template:
    metadata:
      labels:
        app.kubernetes.io/name: $daemonset
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      nodeSelector:
        node-role.kubernetes.io/worker: worker
      containers:
        - name: loader
          image: $loader_image
          imagePullPolicy: IfNotPresent
          securityContext:
            runAsUser: 0
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false
            capabilities:
              drop: ["ALL"]
          command: ["/bin/sh", "-ec"]
          args:
            - |
              archive=/tmp/dramaip-cnpg-plugin-images.tar
              rm -f "\$archive"
              wget -q --timeout=30 --tries=5 -O "\$archive" '$archive_url'
              printf '%s  %s\\n' '$archive_sha256' "\$archive" | sha256sum -c -
              docker load -i "\$archive"
              rm -f "\$archive"
              docker image inspect ghcr.io/cloudnative-pg/plugin-barman-cloud:v0.13.0 >/dev/null
              docker image inspect ghcr.io/cloudnative-pg/plugin-barman-cloud-sidecar:v0.13.0 >/dev/null
              touch /tmp/dramaip-cnpg-plugin-images-ready
              while true; do sleep 3600; done
          readinessProbe:
            exec:
              command: ["/bin/sh", "-ec", "test -f /tmp/dramaip-cnpg-plugin-images-ready"]
            initialDelaySeconds: 1
            periodSeconds: 2
            timeoutSeconds: 1
            failureThreshold: 300
          volumeMounts:
            - name: docker-socket
              mountPath: /var/run/docker.sock
      volumes:
        - name: docker-socket
          hostPath:
            path: /var/run/docker.sock
            type: Socket
EOF

deadline=$((SECONDS + timeout_seconds))
while :; do
  loader_status="$(kube -n "$namespace" get daemonset "$daemonset" \
    -o jsonpath='{.status.desiredNumberScheduled} {.status.updatedNumberScheduled} {.status.numberAvailable}')"
  # A newly created DaemonSet has no status fields for a short interval. A
  # here-string provides the terminating newline `read` requires, so that
  # this expected empty initial state is polled instead of aborting under
  # `set -e`.
  read -r desired updated available <<< "$loader_status" || true
  desired="${desired:-0}"
  updated="${updated:-0}"
  available="${available:-0}"
  if [[ "$desired" == "$worker_count" && "$updated" == "$worker_count" && "$available" == "$worker_count" ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    kube -n "$namespace" get pods -l "app.kubernetes.io/name=$daemonset" -o wide >&2 || true
    echo "plugin image loader did not become ready on every worker" >&2
    exit 1
  fi
  sleep 2
done

for pod in $(kube -n "$namespace" get pods -l "app.kubernetes.io/name=$daemonset" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'); do
  kube -n "$namespace" logs "$pod" --tail=20
done
echo "temporary plugin amd64 images verified on $worker_count workers"
