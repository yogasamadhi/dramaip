# Kubernetes

This directory tracks the Kubernetes rollout plan. The first deployable unit is
the BFF platform flow:

```txt
Internet
  -> Kong Ingress Controller
  -> dramaip-bff Service
  -> dramaip-bff Deployment
  -> PostgreSQL / Redis / RabbitMQ / OpenTelemetry Collector
```

The Helm chart lives in `../helm/dramaip-platform`.

## Current Scope

The chart intentionally deploys only the BFF. The other planned platform
services (`auth`, `user`, `billing`, `quota`, `ai-gateway`) still need complete
service implementations and image build targets before they should become
Kubernetes Deployments.

Included:

- BFF `Deployment`
- BFF `Service`
- `ConfigMap` for non-secret runtime settings
- `Secret` or `existingSecret` wiring for credentials
- migration `Job`
- optional Kong Ingress Controller `Ingress`
- optional Kong `KongPlugin` resources for CORS and rate limiting
- optional `HorizontalPodAutoscaler`
- optional `PodDisruptionBudget`

## Build Images

Build and push all service images before installing the chart. Each service is
built from the same `Dockerfile.service` with a different `TARGET` build arg:

```bash
cd dramaip-platform/services
for svc in \
  "bff ./app/bff/interface/cmd/server" \
  "auth ./app/auth/service/cmd/server" \
  "user ./app/user/service/cmd/server" \
  "billing ./app/billing/service/cmd/server" \
  "quota ./app/quota/service/cmd/server" \
  "ai_gateway ./app/ai_gateway/service/cmd/server" \
  "billing_job ./app/billing/job/cmd/server" \
  "quota_job ./app/quota/job/cmd/server"; do
  set -- $svc; name=$1; target=$2
  docker build -f Dockerfile.service \
    --build-arg TARGET=$target --build-arg OUTPUT=dramaip-$name \
    -t ghcr.io/dramaip/dramaip-$name:0.1.0 .
  docker push ghcr.io/dramaip/dramaip-$name:0.1.0
done
```

(Or use `python3 run-platform-k8s.py` from the repo root, which builds and
loads all 8 images into a local kind/minikube cluster automatically.)

For a local cluster such as kind or minikube, load the image into the cluster
and override the repository/tag with `values-dev.yaml`.

## Install

Create a namespace:

```bash
kubectl create namespace dramaip
```

Install with development defaults:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  -f ../helm/dramaip-platform/values-dev.yaml
```

Install with production values:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  --set image.repository=ghcr.io/dramaip/dramaip-bff \
  --set image.tag=0.1.0 \
  --set secret.existingSecret=dramaip-platform-secret \
  --set config.postgres.host=postgres.example.internal \
  --set config.redis.addr=redis.example.internal:6379 \
  --set config.rabbitmq.managementUrl=http://rabbitmq.example.internal:15672 \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=api.example.com
```

## Kong Ingress Controller

Production ingress is expected to use Kong Ingress Controller, not a custom
Kratos gateway service. Install Kong separately with the official chart or your
platform's managed add-on, then use `ingress.className=kong`.

The chart can render Kong CRDs for edge concerns:

- `KongPlugin` `cors`
- `KongPlugin` `rate-limiting`

They are enabled when `ingress.enabled=true` and `kong.plugins.enabled=true`.
The Ingress is annotated with `konghq.com/plugins` automatically.

Example:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  --set ingress.enabled=true \
  --set ingress.className=kong \
  --set ingress.hosts[0].host=api.example.com \
  --set kong.plugins.cors.origins[0]=https://app.example.com \
  --set kong.plugins.rateLimiting.minute=120
```

If Kong plugins are managed centrally by the platform team, disable chart-owned
plugins and attach platform-managed plugins through annotations:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  --set ingress.enabled=true \
  --set kong.plugins.enabled=false \
  --set ingress.annotations.'konghq\.com/plugins'=shared-cors,shared-rate-limit
```

## Secrets

For production, prefer a pre-created secret instead of putting secret values in
Helm values:

```bash
kubectl create secret generic dramaip-platform-secret \
  --namespace dramaip \
  --from-literal=POSTGRES_USER=dramaip \
  --from-literal=POSTGRES_PASSWORD='replace-me' \
  --from-literal=REDIS_PASSWORD='replace-me' \
  --from-literal=RABBITMQ_USER=dramaip \
  --from-literal=RABBITMQ_PASSWORD='replace-me' \
  --from-literal=JWT_ACCESS_SECRET='replace-me' \
  --from-literal=JWT_REFRESH_SECRET='replace-me'
```

For stronger production hygiene, wire this secret through External Secrets,
Vault, or the cloud provider's secret manager.

## Migrations

The chart runs a pre-install/pre-upgrade migration Job by default. The Job uses
the dedicated migration image and the Go migration runner, which records applied
versions in PostgreSQL.

This lets the long-running service pods keep `AUTO_MIGRATE=false`, avoiding
concurrent migrations when replicas scale out.

Because the default migration Job is a Helm hook, it uses the namespace's
`default` ServiceAccount unless `migrations.serviceAccountName` is set. Hook
resources run before normal chart resources such as the app ServiceAccount.

Disable the migration hook when migrations are handled by CI/CD:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  --set migrations.enabled=false
```

## Health and Metrics

The BFF exposes:

- `/healthz` for readiness and startup probes
- `/metrics` for Prometheus scraping

The chart uses a TCP liveness probe so transient database or queue outages do
not force Kubernetes to restart otherwise healthy application processes.

## Next Work

- Add charts or subcharts for PostgreSQL, Redis, RabbitMQ, OTel, and Kong for
  ephemeral development clusters.
- Add image build targets for `auth`, `user`, `billing`, `quota`, and
  `ai-gateway` once those services move beyond scaffold code.
- Replace placeholder secrets with External Secrets or a cloud KMS-backed
  secret manager.
- Add Kong JWT plugin wiring after auth-service issues production tokens.
