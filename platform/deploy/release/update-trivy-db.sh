#!/usr/bin/env bash
set -euo pipefail

platform="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
repo="$(CDPATH= cd -- "$platform/.." && pwd)"
trivy_image="${TRIVY_IMAGE:-harbor.home.arpa/ci-tools/trivy:0.72.0}"
cache_dir="${TRIVY_CACHE_DIR:-${XDG_CACHE_HOME:-$repo/.cache}/dramaip/trivy}"
timestamp_file="$cache_dir/last-successful-update"
docker_bin="${DRAMAIP_DOCKER_BIN:-docker}"

command -v "$docker_bin" >/dev/null || { echo "$docker_bin is required" >&2; exit 127; }
mkdir -p "$cache_dir"

"$docker_bin" run --rm \
  --volume "$cache_dir:/root/.cache/trivy" \
  "$trivy_image" image \
    --cache-dir /root/.cache/trivy \
    --download-db-only
"$docker_bin" run --rm \
  --volume "$cache_dir:/root/.cache/trivy" \
  "$trivy_image" image \
    --cache-dir /root/.cache/trivy \
    --download-java-db-only

[[ -s "$cache_dir/db/trivy.db" && -s "$cache_dir/db/metadata.json" ]] || {
  echo "Trivy vulnerability database download did not produce the required files" >&2
  exit 1
}
[[ -s "$cache_dir/java-db/trivy-java.db" && -s "$cache_dir/java-db/metadata.json" ]] || {
  echo "Trivy Java database download did not produce the required files" >&2
  exit 1
}

timestamp_tmp="$(mktemp "$cache_dir/.last-successful-update.XXXXXX")"
trap 'rm -f "$timestamp_tmp"' EXIT
date +%s > "$timestamp_tmp"
mv "$timestamp_tmp" "$timestamp_file"
trap - EXIT
echo "updated Trivy vulnerability and Java databases in $cache_dir"
