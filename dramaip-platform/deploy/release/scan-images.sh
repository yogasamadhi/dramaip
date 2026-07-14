#!/usr/bin/env bash
set -euo pipefail

# Local, operator-invoked vulnerability gate. It deliberately does not build,
# push, or deploy images. Install Trivy on the approved release workstation.
registry="${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, e.g. registry.example/dramaip}"
tag="${IMAGE_TAG:?IMAGE_TAG is required, e.g. an immutable Git SHA}"

command -v trivy >/dev/null || { echo "trivy is required for image scanning" >&2; exit 127; }

images=(
  web-bff desktop-bff mobile-bff admin-bff auth user billing quota ai-gateway
  notification inspiration reporting notification-job reporting-job billing-job
  quota-job migrate
)

for name in "${images[@]}"; do
  trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "$registry/$name:$tag"
done
