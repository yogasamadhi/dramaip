#!/usr/bin/env bash
set -euo pipefail

# Build the immutable DramaIP release bundle locally.  This script never pushes
# images: run scan-images.sh first, then push-images.sh only after every image
# has passed the vulnerability gate.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
repo="$(CDPATH= cd -- "$root/.." && pwd)"
services="$root/services"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$root/deploy/release/images.tsv}"
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. harbor.home.arpa/dramaip}"
tag="${IMAGE_TAG:?IMAGE_TAG is required, e.g. sha-<full-git-sha>}"
revision="${IMAGE_REVISION:-$(git -C "$repo" rev-parse HEAD)}"
source_url="${IMAGE_SOURCE:-$(git -C "$repo" config --get remote.origin.url || true)}"

[[ -f "$manifest" ]] || { echo "image manifest does not exist: $manifest" >&2; exit 2; }
[[ "${PUSH_IMAGES:-0}" != "1" ]] || {
  echo "build-images.sh never pushes; run scan-images.sh then push-images.sh" >&2
  exit 2
}

docker_cmd=(docker)
if [[ "${DRAMAIP_DOCKER_SUDO:-0}" == "1" ]]; then
  docker_cmd=(sudo docker)
fi

case "${DRAMAIP_DOCKER_PULL:-1}" in
  1) docker_pull=1 ;;
  0) docker_pull=0 ;;
  *) echo "DRAMAIP_DOCKER_PULL must be 0 or 1" >&2; exit 2 ;;
esac
if [[ -n "${DRAMAIP_DOCKER_MIRROR:-}" ]]; then
  [[ "$DRAMAIP_DOCKER_MIRROR" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || {
    echo "DRAMAIP_DOCKER_MIRROR must be a registry authority" >&2; exit 2;
  }
  docker_mirror="$DRAMAIP_DOCKER_MIRROR"
else
  docker_mirror=""
fi
if [[ -n "${DRAMAIP_GO_PROXY:-}" ]]; then
  [[ "$DRAMAIP_GO_PROXY" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^,[:space:]]*)?(,direct)?$ ]] || {
    echo "DRAMAIP_GO_PROXY must be an HTTPS Go module proxy, optionally followed by ,direct" >&2; exit 2;
  }
  go_proxy="$DRAMAIP_GO_PROXY"
else
  go_proxy=""
fi
if [[ -n "${DRAMAIP_GO_MAX_PROCS:-}" ]]; then
  [[ "$DRAMAIP_GO_MAX_PROCS" =~ ^[1-9][0-9]*$ ]] || {
    echo "DRAMAIP_GO_MAX_PROCS must be a positive integer" >&2; exit 2;
  }
  go_max_procs="$DRAMAIP_GO_MAX_PROCS"
else
  go_max_procs=""
fi
if [[ -n "${DRAMAIP_DOCKER_PLATFORM:-}" ]]; then
  [[ "$DRAMAIP_DOCKER_PLATFORM" =~ ^linux/(amd64|arm64)$ ]] || {
    echo "DRAMAIP_DOCKER_PLATFORM must be linux/amd64 or linux/arm64" >&2; exit 2;
  }
  docker_platform="$DRAMAIP_DOCKER_PLATFORM"
else
  docker_platform=""
fi

web_api_base_url="${DRAMAIP_WEB_API_BASE_URL:-}"
[[ -z "$web_api_base_url" || "$web_api_base_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$ ]] || {
  echo "DRAMAIP_WEB_API_BASE_URL must be empty or an HTTP(S) URL" >&2; exit 2;
}
web_payment_mode="${DRAMAIP_WEB_PAYMENT_MODE:-simulated}"
[[ "$web_payment_mode" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "DRAMAIP_WEB_PAYMENT_MODE contains unsupported characters" >&2; exit 2;
}

build_common=(--label "org.opencontainers.image.revision=$revision")
if [[ -n "$source_url" ]]; then
  build_common+=(--label "org.opencontainers.image.source=$source_url")
fi

go_count=0
web_count=0
while IFS='|' read -r chart_key image_name kind target; do
  [[ -z "${chart_key// }" || "$chart_key" == \#* ]] && continue
  [[ -n "$image_name" && -n "$kind" ]] || { echo "invalid manifest row for $chart_key" >&2; exit 2; }
  image="$registry/$image_name:$tag"

  build_cmd=("${docker_cmd[@]}" build)
  [[ "$docker_pull" == "1" ]] && build_cmd+=(--pull)
  [[ -n "$docker_platform" ]] && build_cmd+=(--platform "$docker_platform")
  build_cmd+=("${build_common[@]}")

  case "$kind" in
    go)
      [[ -n "$target" ]] || { echo "Go image $image_name has no build target" >&2; exit 2; }
      if [[ -n "$docker_mirror" ]]; then
        build_cmd+=(
          --build-arg "GO_IMAGE=$docker_mirror/library/golang:1.26-alpine"
          --build-arg "RUNTIME_IMAGE=$docker_mirror/library/alpine:3.20"
        )
      fi
      [[ -n "$go_proxy" ]] && build_cmd+=(--build-arg "GOPROXY=$go_proxy")
      [[ -n "$go_max_procs" ]] && build_cmd+=(--build-arg "GOMAXPROCS=$go_max_procs")
      build_cmd+=(
        --file "$services/Dockerfile.service"
        --build-arg "TARGET=$target"
        --build-arg "OUTPUT=dramaip-$image_name"
        --tag "$image"
        "$services"
      )
      "${build_cmd[@]}"
      go_count=$((go_count + 1))
      ;;
    web)
      [[ -z "$target" ]] || { echo "Web image must not define a Go build target" >&2; exit 2; }
      if [[ -n "$docker_mirror" ]]; then
        build_cmd+=(--build-arg "NODE_IMAGE=$docker_mirror/library/node:24-alpine")
      fi
      build_cmd+=(
        --file "$root/clients/Dockerfile.web"
        --build-arg "NEXT_PUBLIC_API_BASE_URL=$web_api_base_url"
        --build-arg "NEXT_PUBLIC_PAYMENT_MODE=$web_payment_mode"
        --tag "$image"
        "$root/clients"
      )
      "${build_cmd[@]}"
      web_count=$((web_count + 1))
      ;;
    *)
      echo "unsupported image kind '$kind' for $image_name" >&2
      exit 2
      ;;
  esac
done < "$manifest"

[[ "$go_count" == "18" && "$web_count" == "1" ]] || {
  echo "manifest must build 18 Go images and one Web image; got $go_count Go and $web_count Web" >&2
  exit 2
}
echo "built immutable release bundle: 20 images under $registry with tag $tag (not pushed)"
