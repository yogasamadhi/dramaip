#!/usr/bin/env bash
set -euo pipefail

platform="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
repo="$(CDPATH= cd -- "$platform/.." && pwd)"
chart="$platform/deploy/helm/dramaip-platform"

# A real release preflight must run from the synchronized, clean main branch.
# The bypass exists solely for maintainers to exercise this script while
# developing it on an isolated loop branch; it must never be used for release.
if [[ "${DRAMAIP_PREFLIGHT_ALLOW_DIRTY:-0}" != "1" ]]; then
  [[ "$(git -C "$repo" branch --show-current)" == "main" ]] || { echo "release preflight must run from main" >&2; exit 2; }
  [[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo "release preflight requires a clean worktree" >&2; exit 2; }
fi

# A release candidate must not carry real runtime-secret files. Values examples
# and secret *names* are allowed; their values remain operator-managed.
tracked_secret_files="$(git -C "$repo" ls-files | rg '(^|/)(\.env|[^/]+\.(pem|key|p12|pfx))$' || true)"
if [[ -n "$tracked_secret_files" ]]; then
  echo "tracked runtime-secret file(s) found:" >&2
  echo "$tracked_secret_files" >&2
  exit 1
fi

git -C "$repo" diff --check
bash -n "$platform/deploy/release/build-images.sh" "$platform/deploy/release/scan-images.sh" "$platform/deploy/release/helm-release.sh" "$platform/deploy/release/staging-prerequisites.sh" "$platform/deploy/release/staging-smoke.sh" "$platform/deploy/release/preflight.sh"
docker compose -f "$platform/deploy/docker-drama/docker-compose.yaml" config --quiet
helm lint "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight
helm lint "$chart" -f "$chart/values-staging.yaml"
helm template dramaip-platform "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight >/dev/null
helm template dramaip-platform "$chart" -f "$chart/values-staging.yaml" >/dev/null
helm template dramaip-platform "$chart" >/dev/null
(
  cd "$platform/services"
  buf format --diff --exit-code
  buf lint
  GOCACHE="${GOCACHE:-/tmp/dramaip-go-release}" go test ./...
)
(
  cd "$platform/clients"
  pnpm lint
  pnpm typecheck
  pnpm build:admin
)
