#!/usr/bin/env bash
set -euo pipefail

# Installs the official Barman Cloud Plugin v0.13.0 CRD/RBAC/Service after its
# checksum is verified, but replaces its cert-manager-based Deployment with a
# worker01-only temporary Deployment and self-contained short-lived mTLS.
# It never schedules the plugin on a control-plane node and never prints TLS
# private keys. This is an isolated rehearsal component, not a production CA.

[[ "${DRAMAIP_CNPG_PLUGIN_AUTHORIZED:-}" == "1" ]] || {
  echo "set DRAMAIP_CNPG_PLUGIN_AUTHORIZED=1 before installing the temporary Barman plugin" >&2
  exit 2
}

for command in kubectl curl shasum awk openssl mktemp; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 127; }
done

kubectl_server="${DRAMAIP_KUBECTL_SERVER:-}"
[[ -z "$kubectl_server" || "$kubectl_server" =~ ^https://[A-Za-z0-9.:-]+$ ]] || {
  echo "DRAMAIP_KUBECTL_SERVER must be an https://host:port endpoint" >&2
  exit 2
}
kube() {
  if [[ -n "$kubectl_server" ]]; then
    command kubectl --server="$kubectl_server" "$@"
  else
    command kubectl "$@"
  fi
}

operator_namespace="cnpg-system"
plugin_namespace="cnpg-system"
plugin_version="v0.13.0"
manifest_sha256="d2e71e7b06822448f1a421f05781846cfdb9cc621e7ef32eef5e20c5133213b0"
manifest_url="https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/${plugin_version}/manifest.yaml"
timeout="${DRAMAIP_CNPG_PLUGIN_TIMEOUT:-5m}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
deployment_manifest="$script_dir/temporary-cnpg-barman-plugin-deployment.yaml"
source_manifest="${DRAMAIP_BARMAN_PLUGIN_MANIFEST_PATH:-}"

[[ -f "$deployment_manifest" ]] || { echo "missing $deployment_manifest" >&2; exit 2; }
kube -n "$operator_namespace" get deployment cnpg-controller-manager >/dev/null

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dramaip-cnpg-plugin.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
manifest="$work_dir/manifest.yaml"
components_manifest="$work_dir/components.yaml"

if [[ -n "$source_manifest" ]]; then
  [[ -f "$source_manifest" ]] || { echo "DRAMAIP_BARMAN_PLUGIN_MANIFEST_PATH does not exist" >&2; exit 2; }
  cp "$source_manifest" "$manifest"
else
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "$manifest" "$manifest_url"
fi
actual_sha256="$(shasum -a 256 "$manifest" | awk '{print $1}')"
[[ "$actual_sha256" == "$manifest_sha256" ]] || {
  echo "unexpected Barman plugin manifest checksum" >&2
  exit 1
}

# Preserve all verified upstream resources except the Deployment and the three
# cert-manager resources. The local Deployment below is the only scheduling
# override and uses temporary self-managed TLS Secrets with identical names.
awk '
  function flush() {
    if (document ~ /^apiVersion:/ && document !~ /kind: Deployment/ && document !~ /apiVersion: cert-manager.io/) {
      print document "---"
    }
  }
  /^---$/ { flush(); document=""; next }
  { document=document $0 ORS }
  END { flush() }
' "$manifest" > "$components_manifest"
[[ -s "$components_manifest" ]] || { echo "filtered plugin manifest is empty" >&2; exit 1; }
if grep -Eq 'kind: Deployment|apiVersion: cert-manager.io' "$components_manifest"; then
  echo "filtered plugin manifest retained a forbidden resource" >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 7 \
  -subj '/CN=barman-cloud' \
  -addext 'subjectAltName=DNS:barman-cloud,DNS:barman-cloud.cnpg-system,DNS:barman-cloud.cnpg-system.svc,DNS:barman-cloud.cnpg-system.svc.cluster.local' \
  -addext 'keyUsage=digitalSignature,keyEncipherment' \
  -addext 'extendedKeyUsage=serverAuth' \
  -keyout "$work_dir/server.key" -out "$work_dir/server.crt" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 7 \
  -subj '/CN=cnpg-controller-manager' \
  -addext 'keyUsage=digitalSignature,keyEncipherment' \
  -addext 'extendedKeyUsage=clientAuth' \
  -keyout "$work_dir/client.key" -out "$work_dir/client.crt" >/dev/null 2>&1

kube apply --server-side -f "$components_manifest"
kube -n "$plugin_namespace" create secret tls barman-cloud-server-tls \
  --cert="$work_dir/server.crt" --key="$work_dir/server.key" --dry-run=client -o yaml | kube apply -f -
kube -n "$plugin_namespace" create secret tls barman-cloud-client-tls \
  --cert="$work_dir/client.crt" --key="$work_dir/client.key" --dry-run=client -o yaml | kube apply -f -
kube -n "$plugin_namespace" label secret barman-cloud-server-tls barman-cloud-client-tls \
  app.kubernetes.io/part-of=dramaip-recovery-rehearsal dramaip.io/temporary=true --overwrite
kube -n "$plugin_namespace" apply -f "$deployment_manifest"
kube -n "$plugin_namespace" rollout status deployment/barman-cloud --timeout="$timeout"

plugin_node="$(kube -n "$plugin_namespace" get pod -l app=barman-cloud -o jsonpath='{.items[0].spec.nodeName}')"
[[ "$plugin_node" == "k8s-worker01" ]] || {
  echo "plugin is not on worker01: ${plugin_node:-<empty>}" >&2
  exit 1
}
pull_policy="$(kube -n "$plugin_namespace" get deployment barman-cloud -o jsonpath='{.spec.template.spec.containers[0].imagePullPolicy}')"
[[ "$pull_policy" == "Never" ]] || { echo "plugin imagePullPolicy is not Never" >&2; exit 1; }

echo "temporary Barman Cloud Plugin ready: version=$plugin_version node=$plugin_node imagePullPolicy=$pull_policy"
