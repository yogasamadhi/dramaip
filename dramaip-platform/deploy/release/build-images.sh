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
build_base_args=()
if [[ -n "${DRAMAIP_DOCKER_MIRROR:-}" ]]; then
  # This is intentionally an image-prefix value, not arbitrary Docker flags.
  # It is useful for a controlled operator network whose Docker Hub route is
  # unavailable; normal builds retain the official image defaults above.
  [[ "$DRAMAIP_DOCKER_MIRROR" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || {
    echo "DRAMAIP_DOCKER_MIRROR must be a registry authority" >&2
    exit 2
  }
  build_base_args=(
    --build-arg "GO_IMAGE=$DRAMAIP_DOCKER_MIRROR/library/golang:1.24-alpine"
    --build-arg "RUNTIME_IMAGE=$DRAMAIP_DOCKER_MIRROR/library/alpine:3.20"
  )
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
  "${docker_cmd[@]}" build --pull --file "$services/Dockerfile.service" "${build_base_args[@]}" --build-arg "TARGET=$target" --build-arg "OUTPUT=dramaip-$name" --tag "$image" "$services"
  if [[ "${PUSH_IMAGES:-0}" == "1" ]]; then "${docker_cmd[@]}" push "$image"; fi
done
