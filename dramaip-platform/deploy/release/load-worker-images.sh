#!/usr/bin/env bash
set -euo pipefail

# Loads the immutable temporary-staging application archive directly into one
# amd64 worker's Docker cache. This is deliberately constrained to the
# short-lived /tmp transfer archive and the reviewed local image registry.
archive="${1:?usage: load-worker-images.sh <archive> <sha256> <tag>}"
expected_sha="${2:?usage: load-worker-images.sh <archive> <sha256> <tag>}"
image_tag="${3:?usage: load-worker-images.sh <archive> <sha256> <tag>}"
image_registry="dramaip-staging.local"

[[ "$archive" == /tmp/dramaip-app-*-linux-amd64.tar ]] || {
  echo "archive must be a temporary /tmp dramaip amd64 archive" >&2
  exit 2
}
[[ -f "$archive" ]] || { echo "archive does not exist: $archive" >&2; exit 2; }
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ ]] || { echo "invalid archive SHA-256" >&2; exit 2; }
[[ "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "invalid immutable image tag" >&2; exit 2; }

actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$actual_sha" == "$expected_sha" ]] || {
  echo "archive SHA-256 mismatch" >&2
  exit 1
}

images=(
  web web-bff desktop-bff mobile-bff admin-bff auth user billing quota ai-gateway
  notification inspiration reporting notification-job reporting-job billing-job
  quota-job migrate
)

docker load -i "$archive"
for image in "${images[@]}"; do
  platform="$(docker image inspect "$image_registry/$image:$image_tag" --format '{{.Os}}/{{.Architecture}}')"
  [[ "$platform" == "linux/amd64" ]] || {
    echo "unexpected platform for $image: $platform" >&2
    exit 1
  }
done

rm -f -- "$archive"
printf '%s: loaded %d linux/amd64 application images\n' "$(hostname)" "${#images[@]}"
