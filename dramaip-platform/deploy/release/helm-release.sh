#!/usr/bin/env bash
set -euo pipefail

# A deliberately operator-invoked release/rollback command. It is not a CI
# pipeline and requires explicit authorization for every stateful cluster
# operation.
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
manifest="${DRAMAIP_IMAGE_MANIFEST:-$root/deploy/release/images.tsv}"
if [[ -n "${DRAMAIP_GITOPS_DIR:-}" ]]; then
  chart="$DRAMAIP_GITOPS_DIR/helm/dramaip-platform"
else
  chart="$root/deploy/helm/dramaip-platform"
fi
[[ -f "$manifest" ]] || { echo "image manifest does not exist: $manifest" >&2; exit 2; }
[[ -f "$chart/Chart.yaml" ]] || { echo "Helm Chart not found: $chart" >&2; exit 2; }
environment="${1:?usage: helm-release.sh <staging|production> <apply|rollback> [revision]}"
action="${2:?usage: helm-release.sh <staging|production> <apply|rollback> [revision]}"
namespace="${DRAMAIP_NAMESPACE:-dramaip-$environment}"
release="${DRAMAIP_RELEASE:-dramaip-platform}"
temporary_staging="${DRAMAIP_TEMPORARY_STAGING_INFRA:-0}"
diagnostic_retain="${DRAMAIP_TEMPORARY_STAGING_DIAGNOSTIC_RETAIN:-0}"
helm_cmd=("${DRAMAIP_HELM_BIN:-helm}")
kubectl_cmd=(kubectl)
if [[ -n "${DRAMAIP_KUBE_CONTEXT:-}" ]]; then
  helm_cmd+=(--kube-context "$DRAMAIP_KUBE_CONTEXT")
  kubectl_cmd+=(--context "$DRAMAIP_KUBE_CONTEXT")
fi
echo "warning: helm-release.sh is an emergency operator fallback; normal Staging delivery is run-platform-cicd.py release -> Argo CD" >&2

case "$environment" in
  staging) values="$chart/values-staging.yaml" ;;
  production) values="$chart/values.yaml" ;;
  *) echo "environment must be staging or production" >&2; exit 2 ;;
esac
[[ "${DRAMAIP_RELEASE_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_RELEASE_AUTHORIZED=1 after change approval" >&2; exit 2; }
if [[ "$temporary_staging" == "1" ]]; then
  [[ "$environment" == "staging" ]] || { echo "temporary staging infrastructure is only available for staging" >&2; exit 2; }
  [[ "${DRAMAIP_TEMPORARY_STAGING_AUTHORIZED:-}" == "1" ]] || { echo "set DRAMAIP_TEMPORARY_STAGING_AUTHORIZED=1 for isolated temporary staging" >&2; exit 2; }
  [[ "$namespace" =~ ^dramaip-staging(-[a-z0-9]+)?$ ]] || { echo "temporary staging namespace must start with dramaip-staging" >&2; exit 2; }
  values_files=(-f "$values" -f "$chart/values-staging-temporary.yaml")
else
  [[ "$diagnostic_retain" == "0" ]] || {
    echo "DRAMAIP_TEMPORARY_STAGING_DIAGNOSTIC_RETAIN is only permitted for isolated temporary staging" >&2
    exit 2
  }
  values_files=(-f "$values")
fi
[[ "$diagnostic_retain" == "0" || "$diagnostic_retain" == "1" ]] || {
  echo "DRAMAIP_TEMPORARY_STAGING_DIAGNOSTIC_RETAIN must be 0 or 1" >&2
  exit 2
}
"${helm_cmd[@]}" lint "$chart" "${values_files[@]}"
if [[ "$action" == "apply" ]]; then
  case "$environment" in
    staging)
      runtime_secret="${DRAMAIP_RUNTIME_SECRET:-dramaip-staging-runtime}"
      image_pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:-dramaip-staging-registry}"
      ingress_tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:-dramaip-staging-ingress-tls}"
      ;;
    production)
      runtime_secret="${DRAMAIP_RUNTIME_SECRET:?DRAMAIP_RUNTIME_SECRET is required for production apply}"
      image_pull_secret="${DRAMAIP_IMAGE_PULL_SECRET:?DRAMAIP_IMAGE_PULL_SECRET is required for production apply}"
      ingress_tls_secret="${DRAMAIP_INGRESS_TLS_SECRET:?DRAMAIP_INGRESS_TLS_SECRET is required for production apply}"
      ;;
  esac
  image_registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required for apply, e.g. registry.example/dramaip}"
  image_tag="${IMAGE_TAG:?IMAGE_TAG is required for apply and must be an immutable release tag}"
  if [[ "$temporary_staging" == "1" ]]; then
    [[ "$image_registry" == "dramaip-staging.local" ]] || { echo "temporary staging requires IMAGE_REGISTRY=dramaip-staging.local (node-local images only)" >&2; exit 2; }
    postgres_host="${DRAMAIP_POSTGRES_HOST:-postgres}"
    ingress_host="${DRAMAIP_PUBLIC_INGRESS_HOST:-api.staging.internal}"
    web_origin="${DRAMAIP_WEB_ORIGIN:-https://app.staging.internal}"
  else
    postgres_host="${DRAMAIP_POSTGRES_HOST:?DRAMAIP_POSTGRES_HOST is required for apply}"
    ingress_host="${DRAMAIP_PUBLIC_INGRESS_HOST:?DRAMAIP_PUBLIC_INGRESS_HOST is required for apply}"
    web_origin="${DRAMAIP_WEB_ORIGIN:?DRAMAIP_WEB_ORIGIN is required for apply}"
  fi

  required_secrets=("$runtime_secret" "$image_pull_secret" "$ingress_tls_secret")
  for secret in "${required_secrets[@]}"; do
    "${kubectl_cmd[@]}" -n "$namespace" get secret "$secret" >/dev/null
  done

  image_overrides=(
    --set-string "secret.existingSecret=$runtime_secret"
    --set-string "imagePullSecrets[0].name=$image_pull_secret"
    --set "ingress.enabled=true"
    --set-string "ingress.hosts[0].host=$ingress_host"
    # Helm's indexed --set for the host creates an overlay list item. Set the
    # API path explicitly as well so that overlay cannot discard the /api/v1 path
    # from values-staging.yaml and accidentally claim the browser UI's root.
    --set-string "ingress.hosts[0].paths[0].path=/api/v1"
    --set-string "ingress.hosts[0].paths[0].pathType=Prefix"
    --set-string "ingress.tls[0].secretName=$ingress_tls_secret"
    --set-string "ingress.tls[0].hosts[0]=$ingress_host"
    --set-string "kong.plugins.cors.origins[0]=$web_origin"
    --set "java.enabled=true"
    --set-string "java.postgresDsn=jdbc:postgresql://$postgres_host:5432/dramaip?sslmode=require"
  )
  image_count=0
  while IFS='|' read -r key name kind target; do
    [[ -z "${key// }" || "$key" == \#* ]] && continue
    if [[ "$kind" == "web" ]]; then
      image_overrides+=(--set-string "web.image.repository=$image_registry/$name")
      image_overrides+=(--set-string "web.image.tag=$image_tag")
    elif [[ "$kind" == "java" ]]; then
      image_overrides+=(--set-string "java.images.$key.repository=$image_registry/$name")
      image_overrides+=(--set-string "java.images.$key.tag=$image_tag")
    else
      echo "unsupported image kind in manifest: $kind" >&2
      exit 2
    fi
    image_count=$((image_count + 1))
  done < "$manifest"
  [[ "$image_count" == "10" ]] || { echo "image manifest must contain 10 Java/Web images; found $image_count" >&2; exit 2; }
  if [[ "$diagnostic_retain" == "1" ]]; then
    # This diagnostic escape hatch is deliberately limited to the explicitly
    # authorized disposable staging namespace.  It lets an operator inspect
    # worker logs after a failed startup without weakening production's atomic
    # release semantics.  The caller must explicitly uninstall the release.
    "${helm_cmd[@]}" upgrade --install "$release" "$chart" --namespace "$namespace" --create-namespace "${values_files[@]}" "${image_overrides[@]}" --history-max 10
    echo "temporary staging diagnostic release submitted; inspect worker logs, then explicitly uninstall it"
  else
    "${helm_cmd[@]}" upgrade --install "$release" "$chart" --namespace "$namespace" --create-namespace "${values_files[@]}" "${image_overrides[@]}" --atomic --wait-for-jobs --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}" --history-max 10
    "${kubectl_cmd[@]}" -n "$namespace" rollout status deployment --timeout="${DRAMAIP_ROLLOUT_TIMEOUT:-10m}" -l app.kubernetes.io/instance="$release"
  fi
elif [[ "$action" == "rollback" ]]; then
  revision="${3:?rollback requires an audited Helm revision}"
  "${helm_cmd[@]}" rollback "$release" "$revision" --namespace "$namespace" --wait --timeout "${DRAMAIP_HELM_TIMEOUT:-10m}"
else
  echo "action must be apply or rollback" >&2; exit 2
fi
