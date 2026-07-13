#!/usr/bin/env bash
set -euo pipefail

services_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(git -C "$services_dir" rev-parse --show-toplevel)"
services_relative="${services_dir#"$repo_root"/}"
baseline_ref="${EVENT_CONTRACT_BASELINE_REF:-origin/main}"
baseline_commit="$(git -C "$repo_root" rev-parse "${baseline_ref}^{commit}")"
status_before="$(mktemp)"
status_after="$(mktemp)"
trap 'rm -f "$status_before" "$status_after"' EXIT

cd "$services_dir"

buf format --diff --exit-code
buf lint
buf breaking --against "${repo_root}/.git#commit=${baseline_commit},subdir=${services_relative}"

# Capture both tracked changes and individual untracked files so a newly added
# proto without its generated .pb.go file cannot pass this check accidentally.
git -C "$repo_root" status --porcelain --untracked-files=all -- "$services_relative/api" "$services_relative/events" >"$status_before"
buf generate
git -C "$repo_root" status --porcelain --untracked-files=all -- "$services_relative/api" "$services_relative/events" >"$status_after"

if ! diff -u "$status_before" "$status_after"; then
	printf '%s\n' 'buf generate changed generated protobuf files; commit the generated output.' >&2
	exit 1
fi
