#!/usr/bin/env bash
set -euo pipefail

# Builds no code and never runs on a Kubernetes node. It pins and exports the
# amd64-only images required by the temporary CNPG object-store rehearsal so
# workers can load them before any Pod uses imagePullPolicy: Never.

[[ "${DRAMAIP_CNPG_IMAGE_PREP_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_IMAGE_PREP_AUTHORIZED=1 before preparing temporary amd64 images" >&2
  exit 2
}

command -v docker >/dev/null || { echo "docker is required" >&2; exit 127; }
command -v shasum >/dev/null || { echo "shasum is required" >&2; exit 127; }

cnpg_postgres_ref="ghcr.io/cloudnative-pg/postgresql@sha256:17760b4508e1703f7bf3d5ee6c9335ff6d1bf62b034a3d5b32a43414a516789f"
minio_ref="minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
mc_ref="minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727"
output="${DRAMAIP_CNPG_OBJECT_STORE_IMAGE_TAR:-/tmp/dramaip-cnpg-object-store-amd64.tar}"

for image in "$cnpg_postgres_ref" "$minio_ref" "$mc_ref"; do
  docker pull --platform linux/amd64 "$image"
done

docker tag "$cnpg_postgres_ref" ghcr.io/cloudnative-pg/postgresql:18.4
docker tag "$minio_ref" dramaip-recovery-minio:amd64
docker tag "$mc_ref" dramaip-recovery-mc:amd64
docker save --platform linux/amd64 --output "$output" \
  ghcr.io/cloudnative-pg/postgresql:18.4 \
  dramaip-recovery-minio:amd64 \
  dramaip-recovery-mc:amd64
shasum -a 256 "$output"
