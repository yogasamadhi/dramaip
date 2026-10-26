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
render_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$render_dir"
}
trap cleanup EXIT

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
"$platform/deploy/release/check-manifest.sh"
bash -n "$platform"/deploy/release/*.sh
docker compose -f "$platform/deploy/docker-drama/docker-compose.yaml" --profile java config --quiet
node "$platform/scripts/observability-config-smoke.mjs"
(cd "$platform" && make observability-config-validate)
helm lint "$chart" -f "$chart/values-staging.yaml"
staging_render="$render_dir/staging.yaml"
production_render="$render_dir/production.yaml"
helm template dramaip-platform "$chart" -f "$chart/values-staging.yaml" >"$staging_render"
helm template dramaip-platform "$chart" >/dev/null
helm template dramaip-platform "$chart" \
  --set observability.enabled=true \
  --set-string observability.otlp.endpoint=http://alloy.observability.svc.cluster.local:4318 \
  >"$production_render"
embedded_renders=()
if [[ -f "$chart/values-dev.yaml" ]]; then
  dev_render="$render_dir/dev.yaml"
  helm lint "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight
  helm template dramaip-platform "$chart" -f "$chart/values-dev.yaml" --set-string devInfra.persistence.hostPathBase=/tmp/dramaip-helm-preflight >"$dev_render"
  embedded_renders+=("$dev_render")
  rg -q 'hostPath:' "$dev_render"
fi
if [[ -f "$chart/values-staging-temporary.yaml" ]]; then
  temporary_render="$render_dir/staging-temporary.yaml"
  helm lint "$chart" -f "$chart/values-staging.yaml" -f "$chart/values-staging-temporary.yaml"
  helm template dramaip-platform "$chart" -f "$chart/values-staging.yaml" -f "$chart/values-staging-temporary.yaml" >"$temporary_render"
  embedded_renders+=("$temporary_render")
  rg -q 'emptyDir:' "$temporary_render"
fi
for external_render in "$staging_render" "$production_render"; do
  rg -q 'name: OTEL_EXPORTER_OTLP_ENDPOINT' "$external_render"
  rg -q 'prometheus.io/scrape: "true"' "$external_render"
  for component in prometheus alloy loki tempo grafana; do
    if rg -q "app.kubernetes.io/component: observability-$component" "$external_render"; then
      echo "external observability render unexpectedly contains $component" >&2
      exit 1
    fi
  done
done
for embedded_render in "${embedded_renders[@]}"; do
  rg -q '^kind: Role$' "$embedded_render"
  rg -q '^kind: RoleBinding$' "$embedded_render"
  for component in prometheus alloy loki tempo grafana; do
    rg -q "app.kubernetes.io/component: observability-$component" "$embedded_render"
  done
done
if helm template invalid-observability "$chart" --set observability.enabled=true --set observability.embedded.enabled=true >/dev/null 2>&1; then
  echo "embedded observability must fail without devInfra.enabled=true" >&2
  exit 1
fi
if helm template invalid-observability "$chart" --set devInfra.enabled=true --set observability.embedded.enabled=true >/dev/null 2>&1; then
  echo "embedded observability must fail without observability.enabled=true" >&2
  exit 1
fi
(
  cd "$platform/clients"
  [[ "$(pnpm --version)" == "11.28.5" ]] || { echo "Platform clients require pnpm 11.28.5 exactly" >&2; exit 2; }
  pnpm run lint
  pnpm run typecheck
  pnpm run contracts:check
  pnpm run test
  pnpm run build:web
  pnpm run build:admin
)
(
  cd "$platform/server"
  mvn -B -ntp verify
)
