#!/usr/bin/env bash
set -euo pipefail

platform="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
repo="$(CDPATH= cd -- "$platform/.." && pwd)"
if [[ -n "${DRAMAIP_GITOPS_DIR:-}" ]]; then
  chart="$DRAMAIP_GITOPS_DIR/helm/dramaip-platform"
else
  # Kept only for the one-time GitOps bootstrap migration. New releases should
  # point DRAMAIP_GITOPS_DIR at the independent deployment repository.
  chart="$platform/deploy/helm/dramaip-platform"
fi
[[ -f "$chart/Chart.yaml" ]] || { echo "Helm Chart not found: $chart" >&2; exit 2; }

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
bash -n "$platform/deploy/release/build-images.sh" "$platform/deploy/release/scan-images.sh" "$platform/deploy/release/push-images.sh" "$platform/deploy/release/helm-release.sh" "$platform/deploy/release/staging-prerequisites.sh" "$platform/deploy/release/staging-smoke.sh" "$platform/deploy/release/sync-release-workspace.sh" "$platform/deploy/release/preflight.sh"
docker compose -f "$platform/deploy/docker-drama/docker-compose.yaml" --profile java config --quiet
helm lint "$chart" -f "$chart/values-staging.yaml"
helm template dramaip-platform "$chart" -f "$chart/values-staging.yaml" >/dev/null
helm template dramaip-platform "$chart" >/dev/null
if [[ -f "$chart/values-dev.yaml" ]]; then
  helm lint "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight
  helm template dramaip-platform "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight >/dev/null
fi
(
  cd "$platform/clients"
  pnpm lint
  pnpm typecheck
  pnpm build:admin
)
(
  cd "$platform/server"
  mvn -B -ntp verify
)
