#!/usr/bin/env bash
set -euo pipefail

# Creates only the dedicated plugin-PITR directory on worker02. The short Job
# runs from the already-loaded Docker CLI image on that worker, then exits; it
# never runs on a control-plane node and does not change the source database.

[[ "${DRAMAIP_CNPG_PLUGIN_RESTORE_STORAGE_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_RESTORE_STORAGE_AUTHORIZED=1 before preparing the temporary restore volume" >&2
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
job="dramaip-cnpg-plugin-restore-storage-prepare"
timeout="${DRAMAIP_CNPG_PLUGIN_RESTORE_STORAGE_TIMEOUT:-5m}"

[[ "$(kube -n "$namespace" get cluster dramaip-recovery-ha -o go-template='{{ index .metadata.labels "dramaip.io/temporary" }}')" == "true" ]] || {
  echo "refusing to prepare storage without the temporary source cluster" >&2
  exit 1
}
if kube -n "$namespace" get job "$job" >/dev/null 2>&1; then
  echo "temporary restore storage Job already exists" >&2
  exit 1
fi

kube -n "$namespace" apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $job
  labels:
    app.kubernetes.io/part-of: dramaip-recovery-rehearsal
    dramaip.io/temporary: "true"
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: $job
    spec:
      restartPolicy: Never
      nodeSelector:
        node-role.kubernetes.io/worker: worker
        kubernetes.io/hostname: k8s-worker02
      containers:
        - name: prepare
          image: docker:29-cli
          imagePullPolicy: Never
          command: ["/bin/sh", "-ec"]
          args:
            - install -d -o 26 -g 26 -m 0700 /host/cnpg-plugin-restore-worker02
          securityContext:
            runAsUser: 0
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
              add: ["CHOWN", "FOWNER", "DAC_OVERRIDE"]
            seccompProfile:
              type: RuntimeDefault
          volumeMounts:
            - name: staging-root
              mountPath: /host
      volumes:
        - name: staging-root
          hostPath:
            path: /var/lib/dramaip-recovery-staging
            type: Directory
EOF
kube -n "$namespace" wait "job/$job" --for=condition=complete --timeout="$timeout"
pod="$(kube -n "$namespace" get pod -l "job-name=$job" -o jsonpath='{.items[0].metadata.name}')"
node="$(kube -n "$namespace" get pod "$pod" -o jsonpath='{.spec.nodeName}')"
[[ "$node" == "k8s-worker02" ]] || { echo "storage preparation did not run on worker02" >&2; exit 1; }
kube -n "$namespace" logs "$pod"
echo "temporary plugin PITR storage prepared on $node"
