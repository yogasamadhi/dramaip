#!/usr/bin/env bash
set -euo pipefail

# Scan the complete local release bundle.  The Trivy database must be refreshed
# explicitly by update-trivy-db.sh; a release never downloads
# a mutable database during its security gate.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$root/deploy/release/images.tsv}"
manifest_checker="$root/deploy/release/check-manifest.sh"
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. harbor.home.arpa/dramaip}"
tag="${IMAGE_TAG:?IMAGE_TAG is required, e.g. sha-<full-git-sha>}"
trivy_image="${TRIVY_IMAGE:-harbor.home.arpa/ci-tools/trivy:0.72.0}"
repo="$(CDPATH= cd -- "$root/.." && pwd)"
cache_dir="${TRIVY_CACHE_DIR:-${XDG_CACHE_HOME:-$repo/.cache}/dramaip/trivy}"
report_dir="${TRIVY_REPORT_DIR:-$PWD/trivy-reports}"
max_db_age="${TRIVY_MAX_DB_AGE_SECONDS:-172800}"
timestamp_file="$cache_dir/last-successful-update"
pass_marker="$report_dir/.passed"

"$manifest_checker" "$manifest"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 127; }
[[ -s "$cache_dir/db/trivy.db" && -s "$cache_dir/db/metadata.json" && -s "$cache_dir/java-db/trivy-java.db" && -s "$cache_dir/java-db/metadata.json" && -s "$timestamp_file" ]] || {
  echo "Trivy database is missing; run $root/deploy/release/update-trivy-db.sh" >&2; exit 1;
}
last_update="$(cat "$timestamp_file")"
[[ "$last_update" =~ ^[0-9]+$ ]] || { echo "invalid Trivy database timestamp" >&2; exit 1; }
db_age="$(( $(date +%s) - last_update ))"
[[ "$db_age" -le "$max_db_age" ]] || {
  echo "Trivy database is ${db_age}s old; max age is ${max_db_age}s" >&2; exit 1;
}

mkdir -p "$report_dir"
umask 077
report_names=()
scan_count=0
while IFS='|' read -r chart_key image_name kind target; do
  [[ -z "${chart_key// }" || "$chart_key" == \#* ]] && continue
  image="$registry/$image_name:$tag"
  report="$report_dir/$image_name.json"
  echo "Trivy report: $image"
  docker run --rm \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$cache_dir:/root/.cache/trivy" \
    "$trivy_image" image \
      --cache-dir /root/.cache/trivy \
      --skip-db-update \
      --skip-java-db-update \
      --scanners vuln \
      --format json \
      --output /dev/stdout \
      --severity HIGH,CRITICAL \
      --ignore-unfixed \
      "$image" > "$report"
  docker run --rm \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$cache_dir:/root/.cache/trivy" \
    "$trivy_image" image \
      --cache-dir /root/.cache/trivy \
      --skip-db-update \
      --skip-java-db-update \
      --scanners vuln \
      --exit-code 1 \
      --severity HIGH,CRITICAL \
      --ignore-unfixed \
      "$image"
  report_names+=("$image_name")
  scan_count=$((scan_count + 1))
done < "$manifest"

[[ "$scan_count" == "10" ]] || { echo "manifest must scan exactly 10 images; scanned $scan_count" >&2; exit 2; }
{
  printf '{\n  "registry": "%s",\n  "tag": "%s",\n  "images": [' "$registry" "$tag"
  for index in "${!report_names[@]}"; do
    [[ "$index" == "0" ]] || printf ','
    printf '\n    {"name": "%s", "report": "%s.json"}' "${report_names[$index]}" "${report_names[$index]}"
  done
  printf '\n  ]\n}\n'
} > "$report_dir/index.json"
printf '%s\n' "$registry:$tag" > "$pass_marker"
echo "Trivy passed for 10 Java/Web images; reports: $report_dir"
