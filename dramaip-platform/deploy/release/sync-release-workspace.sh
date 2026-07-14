#!/usr/bin/env bash
set -euo pipefail

# Copies a source-only release workspace to an approved operator host. The
# target directory is dedicated to this script: --delete-excluded deliberately
# removes runtime data, build output, and credential-shaped files from it.
[[ "${DRAMAIP_WORKSPACE_SYNC_AUTHORIZED:-0}" == "1" ]] || {
  echo "set DRAMAIP_WORKSPACE_SYNC_AUTHORIZED=1 before synchronizing a release workspace" >&2
  exit 2
}

host="${DRAMAIP_RELEASE_HOST:?DRAMAIP_RELEASE_HOST is required, e.g. operator@release-host}"
workspace="${DRAMAIP_RELEASE_WORKSPACE:-dramaip-release}"
[[ "$host" =~ ^[A-Za-z0-9._@:-]+$ ]] || {
  echo "DRAMAIP_RELEASE_HOST contains unsupported characters" >&2
  exit 2
}
[[ "$workspace" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$workspace" != *".."* && "$workspace" != /* ]] || {
  echo "DRAMAIP_RELEASE_WORKSPACE must be a relative, traversal-free path" >&2
  exit 2
}

command -v ssh >/dev/null || { echo "ssh is required" >&2; exit 127; }
command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 127; }

platform="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
repo="$(CDPATH= cd -- "$platform/.." && pwd)"
commit="$(git -C "$repo" rev-parse HEAD)"

# The workspace is a script-owned release staging area, not a place for an
# operator's kubeconfig, .env, Docker data, or built artefacts. Keep secrets in
# the approved secret manager and release configuration in the environment.
ssh "$host" "umask 077 && mkdir -p -- '$workspace' && chmod 700 -- '$workspace'"
rsync -a --safe-links --delete --delete-excluded \
  --exclude='.git/***' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*.p12' \
  --exclude='*.pfx' \
  --exclude='node_modules/***' \
  --exclude='.next/***' \
  --exclude='dist/***' \
  --exclude='.turbo/***' \
  --exclude='coverage/***' \
  --exclude='.cache/***' \
  --exclude='deploy/docker-drama/docker-data/***' \
  "$platform/" "$host:$workspace/dramaip-platform/"
ssh "$host" "set -eu; printf '%s\\n' '$commit' > '$workspace/DRAMAIP_SOURCE_COMMIT'; matches=\$(find '$workspace/dramaip-platform' -type f \\( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \\) -print -quit); test -z \"\$matches\" || { echo 'sensitive file found in release workspace' >&2; exit 1; }"

echo "release workspace synchronized to $host:$workspace at source commit $commit"
