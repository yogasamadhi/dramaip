#!/usr/bin/env bash
set -euo pipefail

# Builds every service from the same pinned source tree. This script performs
# no push unless PUSH_IMAGES=1 is supplied explicitly by an operator.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
services="$root/services"
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. registry.example/dramaip}"
tag="${IMAGE_TAG:?IMAGE_TAG is required, e.g. git SHA or immutable release tag}"
docker_cmd=(docker)
# The isolated staging operator host deliberately grants Docker access through
# sudo rather than permanently adding the operator account to the docker group.
# Keep that elevation opt-in and use a fixed command, never a shell fragment.
if [[ "${DRAMAIP_DOCKER_SUDO:-0}" == "1" ]]; then
  docker_cmd=(sudo docker)
fi
# Fresh manifest resolution is the safe default.  A controlled, disconnected
# staging build host may explicitly reuse previously verified local bases.
case "${DRAMAIP_DOCKER_PULL:-1}" in
  1) docker_pull=1 ;;
  0) docker_pull=0 ;;
  *)
    echo "DRAMAIP_DOCKER_PULL must be 0 or 1" >&2
    exit 2
    ;;
esac
if [[ -n "${DRAMAIP_DOCKER_MIRROR:-}" ]]; then
  # This is intentionally an image-prefix value, not arbitrary Docker flags.
  # It is useful for a controlled operator network whose Docker Hub route is
  # unavailable; normal builds retain the official image defaults above.
  [[ "$DRAMAIP_DOCKER_MIRROR" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || {
    echo "DRAMAIP_DOCKER_MIRROR must be a registry authority" >&2
    exit 2
  }
  docker_mirror="$DRAMAIP_DOCKER_MIRROR"
else
  docker_mirror=""
fi
if [[ -n "${DRAMAIP_GO_PROXY:-}" ]]; then
  # The module proxy is build-only.  Restrict it to a HTTPS authority and the
  # optional standard ",direct" fallback; it is never copied into runtime
  # containers or written to host-wide Go configuration.
  [[ "$DRAMAIP_GO_PROXY" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^,[:space:]]*)?(,direct)?$ ]] || {
    echo "DRAMAIP_GO_PROXY must be an HTTPS Go module proxy, optionally followed by ,direct" >&2
    exit 2
  }
  go_proxy="$DRAMAIP_GO_PROXY"
else
  go_proxy=""
fi
if [[ -n "${DRAMAIP_GO_MAX_PROCS:-}" ]]; then
  [[ "$DRAMAIP_GO_MAX_PROCS" =~ ^[1-9][0-9]*$ ]] || {
    echo "DRAMAIP_GO_MAX_PROCS must be a positive integer" >&2
    exit 2
  }
  # Leave the Go default intact unless an operator explicitly constrains a
  # small, shared build host.  This setting exists only in the build stage.
  go_max_procs="$DRAMAIP_GO_MAX_PROCS"
else
  go_max_procs=""
fi
if [[ -n "${DRAMAIP_DOCKER_PLATFORM:-}" ]]; then
  # Keep cross-platform release artifacts constrained to the Linux platforms
  # supported by this project; do not accept arbitrary Docker build flags.
  [[ "$DRAMAIP_DOCKER_PLATFORM" =~ ^linux/(amd64|arm64)$ ]] || {
    echo "DRAMAIP_DOCKER_PLATFORM must be linux/amd64 or linux/arm64" >&2
    exit 2
  }
  docker_platform="$DRAMAIP_DOCKER_PLATFORM"
else
  docker_platform=""
fi

targets=(
  "web-bff:./app/bff/web/interface/cmd/server"
  "desktop-bff:./app/bff/desktop/interface/cmd/server"
  "mobile-bff:./app/bff/mobile/interface/cmd/server"
  "admin-bff:./app/admin/interface/cmd/server"
  "auth:./app/auth/service/cmd/server"
  "user:./app/user/service/cmd/server"
  "billing:./app/billing/service/cmd/server"
  "quota:./app/quota/service/cmd/server"
  "ai-gateway:./app/ai_gateway/service/cmd/server"
  "notification:./app/notification/service/cmd/server"
  "inspiration:./app/inspiration/service/cmd/server"
  "reporting:./app/reporting/service/cmd/server"
  "notification-job:./app/notification/job/cmd/server"
  "reporting-job:./app/reporting/job/cmd/server"
  "billing-job:./app/billing/job/cmd/server"
  "quota-job:./app/quota/job/cmd/server"
  "migrate:./app/migration/job/cmd/server"
)

for item in "${targets[@]}"; do
  name="${item%%:*}"
  target="${item#*:}"
  image="$registry/$name:$tag"
  # Build the command incrementally rather than expanding optional empty
  # arrays. Bash 3 in some operator workstations treats an empty array as
  # unset under `set -u`, which previously broke offline base-image reuse.
  build_cmd=("${docker_cmd[@]}" build)
  [[ "$docker_pull" == "1" ]] && build_cmd+=(--pull)
  [[ -n "$docker_platform" ]] && build_cmd+=(--platform "$docker_platform")
  if [[ -n "$docker_mirror" ]]; then
    build_cmd+=(
      --build-arg "GO_IMAGE=$docker_mirror/library/golang:1.26-alpine"
      --build-arg "RUNTIME_IMAGE=$docker_mirror/library/alpine:3.20"
    )
  fi
  [[ -n "$go_proxy" ]] && build_cmd+=(--build-arg "GOPROXY=$go_proxy")
  [[ -n "$go_max_procs" ]] && build_cmd+=(--build-arg "GOMAXPROCS=$go_max_procs")
  build_cmd+=(--file "$services/Dockerfile.service" --build-arg "TARGET=$target" --build-arg "OUTPUT=dramaip-$name" --tag "$image" "$services")
  "${build_cmd[@]}"
  if [[ "${PUSH_IMAGES:-0}" == "1" ]]; then "${docker_cmd[@]}" push "$image"; fi
done
