#!/usr/bin/env bash
set -euo pipefail

# Runs only on a build workstation. It pulls the two Barman Cloud Plugin
# images as linux/amd64 and exports a single tar for worker-side import. The
# tags in the tar intentionally match the official v0.13.0 manifest because
# the plugin injects the sidecar by that exact reference.

[[ "${DRAMAIP_CNPG_PLUGIN_IMAGE_PREP_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_IMAGE_PREP_AUTHORIZED=1 before preparing plugin amd64 images" >&2
  exit 2
}

command -v docker >/dev/null || { echo "docker is required" >&2; exit 127; }
command -v shasum >/dev/null || { echo "shasum is required" >&2; exit 127; }

plugin_ref="ghcr.io/cloudnative-pg/plugin-barman-cloud@sha256:71589dbac582333442812b07b31f7ea4d00324a8358aac7ca507dabf9f4b6c96"
sidecar_ref="ghcr.io/cloudnative-pg/plugin-barman-cloud-sidecar@sha256:990361af3319f9e23aafa0f6d7981f99bf1f69b4e6a85cf1bc7d71d6f09bb288"
plugin_tag="ghcr.io/cloudnative-pg/plugin-barman-cloud:v0.13.0"
sidecar_tag="ghcr.io/cloudnative-pg/plugin-barman-cloud-sidecar:v0.13.0"
output="${DRAMAIP_CNPG_PLUGIN_IMAGE_TAR:-/tmp/dramaip-cnpg-barman-plugin-v0.13.0-amd64.tar}"

for image in "$plugin_ref" "$sidecar_ref"; do
  docker pull --platform linux/amd64 "$image"
done
docker tag "$plugin_ref" "$plugin_tag"
docker tag "$sidecar_ref" "$sidecar_tag"
docker save --platform linux/amd64 --output "$output" "$plugin_tag" "$sidecar_tag"
shasum -a 256 "$output"
