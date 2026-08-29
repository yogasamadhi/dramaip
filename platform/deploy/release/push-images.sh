#!/usr/bin/env bash
set -euo pipefail

# Push only a bundle that has already passed scan-images.sh.  Authentication is
# deliberately delegated to the caller's existing Docker credential store.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$root/deploy/release/images.tsv}"
manifest_checker="$root/deploy/release/check-manifest.sh"
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. harbor.home.arpa/dramaip}"
tag="${IMAGE_TAG:?IMAGE_TAG is required, e.g. sha-<full-git-sha>}"
report_dir="${TRIVY_REPORT_DIR:-$PWD/trivy-reports}"
pass_marker="$report_dir/.passed"

"$manifest_checker" "$manifest"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 127; }
[[ -s "$pass_marker" && "$(cat "$pass_marker")" == "$registry:$tag" ]] || {
  echo "complete Trivy pass marker is missing for $registry:$tag; run scan-images.sh first" >&2
  exit 1
}

push_count=0
while IFS='|' read -r chart_key image_name kind target; do
  [[ -z "${chart_key// }" || "$chart_key" == \#* ]] && continue
  image="$registry/$image_name:$tag"
  docker image inspect "$image" >/dev/null || {
    echo "local image is missing: $image; build and scan the entire bundle first" >&2; exit 1;
  }
  docker push "$image"
  push_count=$((push_count + 1))
done < "$manifest"
[[ "$push_count" == "10" ]] || { echo "manifest must push exactly 10 images; pushed $push_count" >&2; exit 2; }
echo "pushed immutable Java release bundle: $registry:*:$tag"
