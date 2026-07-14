#!/usr/bin/env bash
set -euo pipefail

# Explicitly authorized lifecycle helper for the disposable, isolated staging
# environment. It has no production path and refuses a namespace outside the
# dramaip-staging family. It does not use a registry: the application images
# are loaded by exact tag into the Docker cache of worker nodes only.
action="${1:?usage: temporary-staging.sh <bootstrap|install-kong|archive-images|preload-images|remove-images|teardown>}"
[[ "${DRAMAIP_TEMPORARY_STAGING_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_TEMPORARY_STAGING_AUTHORIZED=1 after approving temporary staging" >&2
  exit 2
}

namespace="${DRAMAIP_NAMESPACE:-dramaip-staging}"
release="${DRAMAIP_RELEASE:-dramaip-platform}"
kong_namespace="${DRAMAIP_KONG_NAMESPACE:-${namespace}-kong}"
kong_release="${DRAMAIP_KONG_RELEASE:-dramaip-staging-kong}"
image_registry="${IMAGE_REGISTRY:-dramaip-staging.local}"
image_tag="${IMAGE_TAG:-}"
loader_image="${DRAMAIP_IMAGE_LOADER_IMAGE:-docker:29-cli}"
kubectl_cmd=(kubectl)
helm_cmd=("${DRAMAIP_HELM_BIN:-helm}")
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
fi

[[ "$namespace" =~ ^dramaip-staging(-[a-z0-9]+)?$ ]] || {
  echo "temporary staging namespace must start with dramaip-staging" >&2
  exit 2
}
[[ "$kong_namespace" == "${namespace}-kong" ]] || {
  echo "temporary Kong namespace must be ${namespace}-kong" >&2
  exit 2
}
[[ "$release" == "dramaip-platform" ]] || {
  echo "temporary staging only supports DRAMAIP_RELEASE=dramaip-platform" >&2
  exit 2
}
[[ "$kong_release" == "dramaip-staging-kong" ]] || {
  echo "temporary staging only supports DRAMAIP_KONG_RELEASE=dramaip-staging-kong" >&2
  exit 2
}

images=(
  web-bff desktop-bff mobile-bff admin-bff auth user billing quota ai-gateway
  notification inspiration reporting notification-job reporting-job billing-job
  quota-job migrate
)
cert_components=(
  web-bff desktop-bff mobile-bff admin-bff auth user billing quota ai-gateway
  notification-service inspiration-service reporting-service notification-job
  reporting-job billing-job quota-job
)

require_command() {
  command -v "$1" >/dev/null || { echo "$1 is required" >&2; exit 127; }
}

require_image_identity() {
  [[ "$image_registry" == "dramaip-staging.local" ]] || {
    echo "temporary staging requires IMAGE_REGISTRY=dramaip-staging.local" >&2
    exit 2
  }
  [[ "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    echo "IMAGE_TAG must be a non-empty immutable tag containing only letters, digits, dot, underscore, or hyphen" >&2
    exit 2
  }
}

require_loader_image() {
  case "$loader_image" in
    docker:29-cli|docker.m.daocloud.io/library/docker:29-cli) ;;
    *)
      echo "DRAMAIP_IMAGE_LOADER_IMAGE must be the reviewed Docker CLI image or its approved mirror" >&2
      exit 2
      ;;
  esac
}

create_or_update_secret() {
  local name="$1"
  shift
  "${kubectl_cmd[@]}" -n "$namespace" create secret generic "$name" "$@" --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null
}

bootstrap() {
  require_command openssl
  require_command kubectl
  "${kubectl_cmd[@]}" create namespace "$namespace" --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null

  local runtime_secret="${DRAMAIP_RUNTIME_SECRET:-dramaip-staging-runtime}"
  local mtls_secret="${DRAMAIP_INTERNAL_MTLS_SECRET:-dramaip-staging-internal-mtls}"
  local pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:-dramaip-staging-registry}"
  local tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:-dramaip-staging-ingress-tls}"
  local ingress_host="${DRAMAIP_PUBLIC_INGRESS_HOST:-api.staging.internal}"
  [[ "$ingress_host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "DRAMAIP_PUBLIC_INGRESS_HOST is invalid" >&2; exit 2; }

  local -a runtime_keys=(
    POSTGRES_USER POSTGRES_PASSWORD POSTGRES_AUTH_PASSWORD POSTGRES_USER_PROFILE_PASSWORD
    POSTGRES_BILLING_PASSWORD POSTGRES_QUOTA_PASSWORD POSTGRES_AI_GATEWAY_PASSWORD
    POSTGRES_NOTIFICATION_PASSWORD POSTGRES_INSPIRATION_PASSWORD POSTGRES_ADMIN_PASSWORD
    POSTGRES_REPORTING_PASSWORD REDIS_PASSWORD RABBITMQ_USER RABBITMQ_PASSWORD
    AI_PROVIDER_API_KEY RECONCILIATION_OPERATOR_TOKEN AUTH_EMAIL_DELIVERY_TOKEN
  )
  local -a runtime_args=()
  local key value
  for key in "${runtime_keys[@]}"; do
    case "$key" in
      POSTGRES_USER|RABBITMQ_USER) value="dramaip" ;;
      AI_PROVIDER_API_KEY) value="temporary-staging-no-external-provider" ;;
      RECONCILIATION_OPERATOR_TOKEN|AUTH_EMAIL_DELIVERY_TOKEN) value="temporary-staging-disabled" ;;
      *) value="$(openssl rand -hex 32)" ;;
    esac
    runtime_args+=(--from-literal="$key=$value")
  done
  create_or_update_secret "$runtime_secret" "${runtime_args[@]}"

  # A syntactically valid pull Secret remains required by the Pod spec, but
  # IfNotPresent resolves all application images from worker-local Docker.
  "${kubectl_cmd[@]}" -n "$namespace" create secret generic "$pull_secret" \
    --type=kubernetes.io/dockerconfigjson \
    --from-literal='.dockerconfigjson={"auths":{}}' \
    --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null

  local tmp
  tmp="$(mktemp -d)"
  chmod 700 "$tmp"
  cleanup_bootstrap() { rm -rf "$tmp"; }
  trap cleanup_bootstrap RETURN

  openssl genrsa -out "$tmp/ca.key" 4096 >/dev/null 2>&1
  openssl req -x509 -new -sha256 -key "$tmp/ca.key" -out "$tmp/ca.crt" -days 2 \
    -subj '/CN=dramaip-temporary-staging-ca' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
  local component service_name san
  local -a mtls_args=(--from-file="$tmp/ca.crt")
  for component in "${cert_components[@]}"; do
    service_name="${release}-${component}"
    san="DNS:${service_name},DNS:${service_name}.${namespace},DNS:${service_name}.${namespace}.svc"
    openssl genrsa -out "$tmp/${component}.key" 2048 >/dev/null 2>&1
    openssl req -new -sha256 -key "$tmp/${component}.key" -out "$tmp/${component}.csr" \
      -subj "/CN=${service_name}" >/dev/null 2>&1
    openssl x509 -req -sha256 -in "$tmp/${component}.csr" -CA "$tmp/ca.crt" -CAkey "$tmp/ca.key" \
      -CAcreateserial -out "$tmp/${component}.crt" -days 2 \
      -extfile <(printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=%s\n' "$san") >/dev/null 2>&1
    mtls_args+=(--from-file="$tmp/${component}.crt" --from-file="$tmp/${component}.key")
  done
  create_or_update_secret "$mtls_secret" "${mtls_args[@]}"

  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
    -keyout "$tmp/ingress.key" -out "$tmp/ingress.crt" \
    -subj "/CN=${ingress_host}" -addext "subjectAltName=DNS:${ingress_host}" >/dev/null 2>&1
  "${kubectl_cmd[@]}" -n "$namespace" create secret tls "$tls_secret" \
    --cert="$tmp/ingress.crt" --key="$tmp/ingress.key" --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null

  echo "temporary staging bootstrap completed: namespace and short-lived runtime, mTLS, pull, and ingress TLS Secrets were created"
}

install_kong() {
  "${helm_cmd[@]}" version --short >/dev/null || { echo "a working Helm binary is required" >&2; exit 127; }
  require_command sha256sum
  "${kubectl_cmd[@]}" get namespace "$namespace" >/dev/null || {
    echo "run bootstrap before install-kong" >&2
    exit 1
  }
  local chart="${DRAMAIP_KONG_CHART:?DRAMAIP_KONG_CHART must point to the verified Kong ingress-0.24.0.tgz}"
  local expected_sha="${DRAMAIP_KONG_CHART_SHA256:-670053e7ae58f0b09951f9edc3ab4dea6cab59c970efb6080b3082f63b4fc1f2}"
  [[ -f "$chart" ]] || { echo "Kong chart archive does not exist" >&2; exit 2; }
  [[ "$expected_sha" == "670053e7ae58f0b09951f9edc3ab4dea6cab59c970efb6080b3082f63b4fc1f2" ]] || {
    echo "only the reviewed Kong ingress 0.24.0 archive is permitted" >&2
    exit 2
  }
  local actual_sha
  actual_sha="$(sha256sum "$chart" | awk '{print $1}')"
  [[ "$actual_sha" == "$expected_sha" ]] || { echo "Kong chart SHA-256 does not match the reviewed archive" >&2; exit 1; }
  local http_port="${DRAMAIP_KONG_HTTP_NODEPORT:-32080}"
  local https_port="${DRAMAIP_KONG_HTTPS_NODEPORT:-32443}"
  local gateway_repository="${DRAMAIP_KONG_GATEWAY_REPOSITORY:-kong}"
  local controller_repository="${DRAMAIP_KONG_CONTROLLER_REPOSITORY:-kong/kubernetes-ingress-controller}"
  case "$gateway_repository" in kong|docker.m.daocloud.io/library/kong) ;; *) echo "unreviewed Kong gateway repository" >&2; exit 2 ;; esac
  case "$controller_repository" in kong/kubernetes-ingress-controller|docker.m.daocloud.io/kong/kubernetes-ingress-controller) ;; *) echo "unreviewed Kong controller repository" >&2; exit 2 ;; esac
  [[ "$http_port" =~ ^3[0-2][0-9]{3}$ && "$https_port" =~ ^3[0-2][0-9]{3}$ && "$http_port" != "$https_port" ]] || {
    echo "Kong NodePorts must be distinct Kubernetes NodePort-range values" >&2
    exit 2
  }
  local used_ports
  used_ports="$("${kubectl_cmd[@]}" get services -A -o jsonpath='{range .items[*].spec.ports[*]}{.nodePort}{"\n"}{end}')"
  local own_proxy_ports
  own_proxy_ports="$("${kubectl_cmd[@]}" -n "$kong_namespace" get service "${kong_release}-gateway-proxy" \
    -o jsonpath='{range .spec.ports[*]}{.nodePort}{"\n"}{end}' 2>/dev/null || true)"
  if { grep -qxF "$http_port" <<<"$used_ports" && ! grep -qxF "$http_port" <<<"$own_proxy_ports"; } || \
     { grep -qxF "$https_port" <<<"$used_ports" && ! grep -qxF "$https_port" <<<"$own_proxy_ports"; }; then
    echo "chosen Kong NodePort is already allocated" >&2
    exit 1
  fi
  "${kubectl_cmd[@]}" create namespace "$kong_namespace" --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null
  "${helm_cmd[@]}" upgrade --install "$kong_release" "$chart" --namespace "$kong_namespace" --create-namespace \
    --set gateway.proxy.type=NodePort \
    --set "gateway.proxy.http.nodePort=$http_port" \
    --set "gateway.proxy.tls.nodePort=$https_port" \
    --set-string "gateway.image.repository=$gateway_repository" \
    --set-string "gateway.image.tag=3.9" \
    --set-string "controller.ingressController.image.repository=$controller_repository" \
    --set-string "controller.ingressController.image.tag=3.5" \
    --set 'gateway.nodeSelector.node-role\.kubernetes\.io/worker=worker' \
    --set 'controller.nodeSelector.node-role\.kubernetes\.io/worker=worker' \
    --set "controller.ingressController.watchNamespaces[0]=$namespace" \
    --set controller.ingressController.ingressClass=kong \
    --set controller.ingressController.createIngressClass=true \
    --history-max 3
# Kong ingress chart 0.24.0 omits read/list/watch access that KIC 3.5 needs
# in its own namespace to discover the Gateway Admin Service. Keep this
# Kubernetes 1.36 compatibility grant namespaced and read-only; the dedicated
# temporary namespace is deleted on teardown.
  "${kubectl_cmd[@]}" -n "$kong_namespace" apply -f - <<EOF >/dev/null
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${kong_release}-controller-endpointslices
rules:
  - apiGroups: [""]
    resources: ["services", "endpoints", "pods", "secrets", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["discovery.k8s.io"]
    resources: ["endpointslices"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${kong_release}-controller-endpointslices
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${kong_release}-controller-endpointslices
subjects:
  - kind: ServiceAccount
    name: ${kong_release}-controller
    namespace: ${kong_namespace}
EOF
  # A previous failed attempt may be in CrashLoopBackOff when the compatibility
  # RoleBinding appears. Restart only this temporary controller so it retries
  # immediately with the newly verified read-only permission.
  "${kubectl_cmd[@]}" -n "$kong_namespace" rollout restart "deployment/${kong_release}-controller" >/dev/null
  "${kubectl_cmd[@]}" -n "$kong_namespace" rollout status "deployment/${kong_release}-controller" --timeout="${DRAMAIP_KONG_TIMEOUT:-10m}"
  "${kubectl_cmd[@]}" -n "$kong_namespace" rollout status "deployment/${kong_release}-gateway" --timeout="${DRAMAIP_KONG_TIMEOUT:-10m}"
  "${kubectl_cmd[@]}" get ingressclass kong >/dev/null
  "${kubectl_cmd[@]}" get crd kongplugins.configuration.konghq.com >/dev/null
  echo "temporary Kong installed: NodePort ${http_port}/${https_port}; controller watches only ${namespace}"
}

archive_images() {
  [[ "${DRAMAIP_TEMPORARY_STAGING_PRELOAD_AUTHORIZED:-}" == "1" ]] || {
    echo "set DRAMAIP_TEMPORARY_STAGING_PRELOAD_AUTHORIZED=1 before creating a transient private-LAN image archive" >&2
    exit 2
  }
  require_image_identity
  require_loader_image
  local archive="${DRAMAIP_IMAGE_ARCHIVE:?DRAMAIP_IMAGE_ARCHIVE must be the destination Docker archive path}"
  [[ "$archive" == /* ]] || { echo "DRAMAIP_IMAGE_ARCHIVE must be an absolute path" >&2; exit 2; }
  mkdir -p "$(dirname "$archive")"
  local -a docker_cmd=(docker)
  if [[ "${DRAMAIP_DOCKER_SUDO:-0}" == "1" ]]; then docker_cmd=(sudo docker); fi
  local -a image_refs=()
  local image
  for image in "${images[@]}"; do
    image_refs+=("${image_registry}/${image}:${image_tag}")
    "${docker_cmd[@]}" image inspect "${image_registry}/${image}:${image_tag}" >/dev/null
  done
  "${docker_cmd[@]}" save -o "$archive" "${image_refs[@]}"
  chmod 600 "$archive"
  sha256sum "$archive"
  echo "temporary application archive created; delete it after teardown"
}

preload_images() {
  [[ "${DRAMAIP_TEMPORARY_STAGING_PRELOAD_AUTHORIZED:-}" == "1" ]] || {
    echo "set DRAMAIP_TEMPORARY_STAGING_PRELOAD_AUTHORIZED=1 to permit the temporary worker Docker-socket loader" >&2
    exit 2
  }
  require_image_identity
  require_command python3
  require_command curl
  require_command sha256sum
  "${kubectl_cmd[@]}" get namespace "$namespace" >/dev/null || { echo "run bootstrap before preload-images" >&2; exit 1; }
  local archive
  archive="${DRAMAIP_IMAGE_ARCHIVE:-}"
  [[ -n "$archive" ]] || { echo "DRAMAIP_IMAGE_ARCHIVE must point to the Docker archive on this operator host" >&2; exit 2; }
  [[ -f "$archive" ]] || { echo "DRAMAIP_IMAGE_ARCHIVE does not exist" >&2; exit 2; }
  local server_address
  server_address="${DRAMAIP_IMAGE_SERVER_ADDRESS:-}"
  [[ -n "$server_address" ]] || { echo "DRAMAIP_IMAGE_SERVER_ADDRESS must be this operator host private IPv4 address" >&2; exit 2; }
  [[ "$server_address" =~ ^192\.168\.2\.[0-9]{1,3}$ ]] || { echo "image server address must be in the approved 192.168.2.0/24 LAN" >&2; exit 2; }
  # Assign in a separate statement so nounset mode cannot observe an
  # uninitialised local while constructing the private archive URL below.
  local server_port
  server_port="${DRAMAIP_IMAGE_SERVER_PORT:-18080}"
  [[ "$server_port" =~ ^[0-9]{4,5}$ && "$server_port" -ge 1024 && "$server_port" -le 65535 ]] || { echo "DRAMAIP_IMAGE_SERVER_PORT is invalid" >&2; exit 2; }
  local archive_name archive_sha archive_url source_commit
  archive_name="$(basename "$archive")"
  [[ "$archive_name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "archive filename contains unsupported characters" >&2; exit 2; }
  archive_sha="$(sha256sum "$archive" | awk '{print $1}')"
  archive_url="http://${server_address}:${server_port}/${archive_name}"
  source_commit="${DRAMAIP_SOURCE_COMMIT:-unknown}"

  local server_pid="" loader_created=0
  cleanup_preload() {
    local status=$?
    if [[ "$loader_created" == "1" ]]; then "${kubectl_cmd[@]}" -n "$namespace" delete daemonset dramaip-staging-image-loader --ignore-not-found --wait=false >/dev/null 2>&1 || true; fi
    if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi
    trap - EXIT
    exit "$status"
  }
  trap cleanup_preload EXIT
  python3 -m http.server "$server_port" --bind "$server_address" --directory "$(dirname "$archive")" >/dev/null 2>&1 &
  server_pid=$!
  for _ in 1 2 3 4 5; do
    if curl --fail --silent --max-time 2 "$archive_url" --output /dev/null; then break; fi
    sleep 1
  done
  curl --fail --silent --max-time 3 "$archive_url" --output /dev/null || { echo "temporary image archive server is unreachable" >&2; exit 1; }

  "${kubectl_cmd[@]}" -n "$namespace" apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: dramaip-staging-image-loader
  labels:
    app.kubernetes.io/part-of: dramaip-temporary-staging
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: dramaip-staging-image-loader
  template:
    metadata:
      labels:
        app.kubernetes.io/name: dramaip-staging-image-loader
    spec:
      nodeSelector:
        node-role.kubernetes.io/worker: worker
      containers:
        - name: loader
          image: ${loader_image}
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
              archive=/tmp/dramaip-images.tar
              wget -q -O "\$archive" '${archive_url}'
              echo '${archive_sha}  '"\$archive" | sha256sum -c -
              docker load -i "\$archive" >/dev/null
              rm -f "\$archive"
              while true; do sleep 3600; done
          volumeMounts:
            - name: docker-socket
              mountPath: /var/run/docker.sock
      volumes:
        - name: docker-socket
          hostPath:
            path: /var/run/docker.sock
            type: Socket
EOF
  loader_created=1
  "${kubectl_cmd[@]}" -n "$namespace" rollout status daemonset/dramaip-staging-image-loader --timeout="${DRAMAIP_IMAGE_PRELOAD_TIMEOUT:-20m}"
  local worker_count
  worker_count="$("${kubectl_cmd[@]}" get nodes -l node-role.kubernetes.io/worker=worker --no-headers | wc -l | tr -d ' ')"
  local -a loader_pods=()
  mapfile -t loader_pods < <("${kubectl_cmd[@]}" -n "$namespace" get pods -l app.kubernetes.io/name=dramaip-staging-image-loader -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
  [[ "${#loader_pods[@]}" == "$worker_count" ]] || { echo "image loader did not run on every worker" >&2; exit 1; }
  local pod image
  for pod in "${loader_pods[@]}"; do
    for image in "${images[@]}"; do
      "${kubectl_cmd[@]}" -n "$namespace" exec "$pod" -- docker image inspect "${image_registry}/${image}:${image_tag}" >/dev/null
    done
  done
  "${kubectl_cmd[@]}" -n "$namespace" create configmap dramaip-staging-image-preload \
    --from-literal="image-tag=$image_tag" --from-literal="source-commit=$source_commit" \
    --dry-run=client -o yaml | "${kubectl_cmd[@]}" apply -f - >/dev/null
  "${kubectl_cmd[@]}" -n "$namespace" delete daemonset dramaip-staging-image-loader --wait=true >/dev/null
  loader_created=0
  echo "temporary staging images preloaded and verified on ${worker_count} worker nodes"
}

remove_images() {
  [[ "${DRAMAIP_TEMPORARY_STAGING_CLEANUP_AUTHORIZED:-}" == "1" ]] || {
    echo "set DRAMAIP_TEMPORARY_STAGING_CLEANUP_AUTHORIZED=1 before removing temporary images" >&2
    exit 2
  }
  require_image_identity
  require_loader_image
  "${kubectl_cmd[@]}" get namespace "$kong_namespace" >/dev/null || { echo "temporary Kong namespace is required for safe image cleanup" >&2; exit 1; }
  "${kubectl_cmd[@]}" -n "$kong_namespace" apply -f - <<EOF >/dev/null
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: dramaip-staging-image-remover
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: dramaip-staging-image-remover
  template:
    metadata:
      labels:
        app.kubernetes.io/name: dramaip-staging-image-remover
    spec:
      nodeSelector:
        node-role.kubernetes.io/worker: worker
      containers:
        - name: remover
          image: ${loader_image}
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
              $(for image in "${images[@]}"; do printf 'docker image rm -f %q >/dev/null 2>&1 || true\n' "${image_registry}/${image}:${image_tag}"; done)
              while true; do sleep 3600; done
          volumeMounts:
            - name: docker-socket
              mountPath: /var/run/docker.sock
      volumes:
        - name: docker-socket
          hostPath:
            path: /var/run/docker.sock
            type: Socket
EOF
  "${kubectl_cmd[@]}" -n "$kong_namespace" rollout status daemonset/dramaip-staging-image-remover --timeout="${DRAMAIP_IMAGE_PRELOAD_TIMEOUT:-20m}"
  "${kubectl_cmd[@]}" -n "$kong_namespace" delete daemonset dramaip-staging-image-remover --wait=true >/dev/null
  echo "temporary application image tags removed from worker Docker caches; no global image prune was used"
}

teardown() {
  [[ "${DRAMAIP_TEMPORARY_STAGING_CLEANUP_AUTHORIZED:-}" == "1" ]] || {
    echo "set DRAMAIP_TEMPORARY_STAGING_CLEANUP_AUTHORIZED=1 before tearing down temporary staging" >&2
    exit 2
  }
  if "${helm_cmd[@]}" status "$release" -n "$namespace" >/dev/null 2>&1; then
    "${helm_cmd[@]}" uninstall "$release" -n "$namespace" --wait
  fi
  "${kubectl_cmd[@]}" delete namespace "$namespace" --ignore-not-found --wait=true
  if "${helm_cmd[@]}" status "$kong_release" -n "$kong_namespace" >/dev/null 2>&1; then
    "${helm_cmd[@]}" uninstall "$kong_release" -n "$kong_namespace" --wait
  fi
  "${kubectl_cmd[@]}" delete namespace "$kong_namespace" --ignore-not-found --wait=true
  echo "temporary staging namespaces and their Helm releases were removed; reviewed Kong CRDs are intentionally retained until the operator verifies no other Kong consumer exists"
}

case "$action" in
  bootstrap) bootstrap ;;
  install-kong) install_kong ;;
  archive-images) archive_images ;;
  preload-images) preload_images ;;
  remove-images) remove_images ;;
  teardown) teardown ;;
  *) echo "action must be bootstrap, install-kong, archive-images, preload-images, remove-images, or teardown" >&2; exit 2 ;;
esac
