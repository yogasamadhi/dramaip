#!/usr/bin/env bash
set -euo pipefail

platform="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
manifest="${1:-${DRAMAIP_IMAGE_MANIFEST:-$platform/deploy/release/images.tsv}}"

[[ -f "$manifest" ]] || { echo "image manifest does not exist: $manifest" >&2; exit 2; }

declare -A chart_keys=()
declare -A image_names=()
declare -A java_targets=()
expected_java_targets=(
  migration
  gateway
  services/identity
  services/notification
  services/reporting
  services/creation
  services/quota
  services/ai
  services/billing
)

total_count=0
java_count=0
web_count=0
line_number=0
while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line_number=$((line_number + 1))
  raw_line="${raw_line%$'\r'}"
  [[ -z "${raw_line//[[:space:]]/}" || "$raw_line" =~ ^[[:space:]]*# ]] && continue
  [[ "$(tr -cd '|' <<<"$raw_line" | wc -c | tr -d ' ')" == "3" ]] || {
    echo "manifest line $line_number must contain exactly four pipe-delimited fields" >&2
    exit 2
  }
  IFS='|' read -r chart_key image_name kind target <<<"$raw_line"
  [[ "$chart_key" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "invalid chart key '$chart_key' on line $line_number" >&2; exit 2; }
  [[ "$image_name" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "invalid image name '$image_name' on line $line_number" >&2; exit 2; }
  [[ -z "${chart_keys[$chart_key]+present}" ]] || { echo "duplicate chart key '$chart_key'" >&2; exit 2; }
  [[ -z "${image_names[$image_name]+present}" ]] || { echo "duplicate image name '$image_name'" >&2; exit 2; }
  chart_keys[$chart_key]=1
  image_names[$image_name]=1

  case "$kind" in
    java)
      case "$target" in
        migration|gateway|services/identity|services/notification|services/reporting|services/creation|services/quota|services/ai|services/billing) ;;
        *) echo "invalid Java Maven module '$target' for $image_name" >&2; exit 2 ;;
      esac
      [[ -z "${java_targets[$target]+present}" ]] || { echo "duplicate Java Maven module '$target'" >&2; exit 2; }
      java_targets[$target]=1
      java_count=$((java_count + 1))
      ;;
    web)
      [[ -z "$target" ]] || { echo "Web image '$image_name' must not define a build target" >&2; exit 2; }
      web_count=$((web_count + 1))
      ;;
    *)
      echo "unsupported image kind '$kind' for $image_name" >&2
      exit 2
      ;;
  esac
  total_count=$((total_count + 1))
done < "$manifest"

[[ "$total_count" == "10" && "$java_count" == "9" && "$web_count" == "1" ]] || {
  echo "manifest must contain 10 images (9 Java, 1 Web); got $total_count total, $java_count Java, $web_count Web" >&2
  exit 2
}
for target in "${expected_java_targets[@]}"; do
  [[ -n "${java_targets[$target]+present}" ]] || { echo "missing Java Maven module '$target'" >&2; exit 2; }
done

echo "validated release manifest: 10 images (9 Java, 1 Web)"
