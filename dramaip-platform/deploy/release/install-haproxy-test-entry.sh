#!/usr/bin/env bash
set -euo pipefail

# Installs the reviewed temporary-staging port-81 frontend on one control-plane
# node. It validates a complete candidate before replacing HAProxy's active
# configuration and retains a timestamped local backup for rollback.
snippet="${1:?usage: install-haproxy-test-entry.sh <snippet>}"
config=/etc/haproxy/haproxy.cfg
marker='# BEGIN dramaip temporary staging web entry'

[[ "$snippet" == /tmp/haproxy-dramaip-test-entry.cfg ]] || {
  echo "snippet must be /tmp/haproxy-dramaip-test-entry.cfg" >&2
  exit 2
}
[[ -f "$snippet" ]] || { echo "snippet is missing" >&2; exit 2; }
[[ -f "$config" ]] || { echo "HAProxy configuration is missing" >&2; exit 1; }

candidate="$(mktemp /tmp/haproxy-dramaip-candidate.XXXXXX)"
trap 'rm -f "$candidate"' EXIT
cp -- "$config" "$candidate"
if ! grep -qxF "$marker" "$candidate"; then
  printf '\n' >> "$candidate"
  cat "$snippet" >> "$candidate"
fi

haproxy -c -f "$candidate"
if ! grep -qxF "$marker" "$config"; then
  backup="${config}.dramaip-test.$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -a -- "$config" "$backup"
  install -m 0644 -- "$candidate" "$config"
  printf 'HAProxy backup: %s\n' "$backup"
fi
systemctl reload haproxy
systemctl is-active --quiet haproxy
ss -lnt '( sport = :81 )'
