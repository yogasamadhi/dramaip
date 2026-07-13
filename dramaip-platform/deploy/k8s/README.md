# Kubernetes

This directory tracks the Kubernetes rollout plan. The first deployable unit is
the BFF platform flow:

```txt
Internet
  -> Kong Ingress Controller
  -> dramaip-web-bff Service
  -> dramaip-web-bff Deployment
  -> PostgreSQL / Redis / RabbitMQ / OpenTelemetry Collector
```

The Helm chart lives in `../helm/dramaip-platform`.

## Current Scope

The chart deploys the four endpoint-specific BFFs (Web, Desktop, Mobile, and
Admin), synchronous auth/user/billing/quota/ai-gateway/notification/
inspiration/reporting services, their event consumers, and the
billing/quota maintenance jobs. `notification-job` and `reporting-job` use
their own durable queues, Inbox leases, retry limits, and dead-letter queues;
they own only their respective asynchronous effects.

Included:

- service `Deployment` and `Service` resources for the current synchronous
  platform services
- `ConfigMap` for non-secret runtime settings
- `Secret` or `existingSecret` wiring for credentials
- migration `Job`
- optional Kong Ingress Controller `Ingress`
- optional Kong `KongPlugin` resources for CORS and rate limiting
- optional `HorizontalPodAutoscaler` and `PodDisruptionBudget` for all BFFs

## Build Images

Build all service images from the exact release source with the local,
operator-invoked command. It does not push unless `PUSH_IMAGES=1` is explicit:

```bash
cd dramaip-platform
IMAGE_REGISTRY=registry.example.invalid/dramaip \
IMAGE_TAG=<immutable-git-sha> \
  bash deploy/release/build-images.sh

# After the registry operator has pushed the same immutable images:
IMAGE_REGISTRY=registry.example.invalid/dramaip \
IMAGE_TAG=<immutable-git-sha> \
  bash deploy/release/scan-images.sh
```

The scripts are release tools, not a hosted CI/CD pipeline. They never store
registry, cluster, or Secret Manager credentials. For a local kind/minikube
cluster, use `values-dev.yaml` and load development images separately.

## Install

Render development defaults without changing a cluster:

```bash
helm template dramaip-platform ../helm/dramaip-platform \
  -f ../helm/dramaip-platform/values-dev.yaml >/dev/null
```

For staging or production, follow
[`../../../docs/loop/LM3-32-无流水线发布准备.md`](../../../docs/loop/LM3-32-无流水线发布准备.md).
The guarded release command requires explicit approval and an immutable image
tag; it uses Helm `--atomic` and supports a revision-based rollback:

```bash
DRAMAIP_RELEASE_AUTHORIZED=1 IMAGE_REGISTRY=<approved-registry/project> IMAGE_TAG=<immutable-git-sha> \
  bash ../release/helm-release.sh staging apply
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
  --set config.webSession.cookieDomain=example.com \
  --set kong.plugins.rateLimiting.minute=120
```

Prefer one public origin for Web and API, in which case leave
`config.webSession.cookieDomain` empty and keep host-only Cookies. The example
above uses split, controlled subdomains; its common Cookie domain is valid only
when every sibling subdomain covered by `example.com` is trusted. Never use a
wildcard CORS origin with the chart's credentialed Cookie session.

If Kong plugins are managed centrally by the platform team, disable chart-owned
plugins and attach platform-managed plugins through annotations:

```bash
helm upgrade --install dramaip-platform ../helm/dramaip-platform \
  --namespace dramaip \
  --set ingress.enabled=true \
  --set kong.plugins.enabled=false \
  --set ingress.annotations.'konghq\.com/plugins'=shared-cors,shared-rate-limit
```

## Internal gRPC mTLS

Production chart values enable mTLS by default. Before installation, create the
operator-managed Secret named by `internalMTLS.existingSecret` (default
`dramaip-internal-mtls`) with `ca.crt` plus one `*.crt` / `*.key` pair for every
workload key in `internalMTLS.certKeys` and `internalMTLS.keyKeys`. Certificate
CNs must match their workload: `web-bff`, `desktop-bff`, `mobile-bff`,
`admin-bff`, `auth`, `user`, `billing-service`, `quota-service`,
`ai-gateway-service`, `notification-service`, `inspiration-service`,
`reporting-service`, `notification-job`, `reporting-job`, `billing-job`, and
`quota-job`. The gRPC allowlists accept only required callers. Do not reuse a
single client certificate for all workloads.

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
  --from-literal=RABBITMQ_PASSWORD='replace-me'
```

For stronger production hygiene, wire this secret through External Secrets,
Vault, or the cloud provider's secret manager.

Create a separate keyset Secret for auth-service. It is mounted into only that
pod; `private.pem` must never be put in an environment variable or Git. Set
`config.jwt.activeKeyID` and `authJWT.keysetSecret` in the Helm values, then
render the Kong declaration from the public `jwks.json` as documented in
[`../kong/README.md`](../kong/README.md).

```bash
kubectl create secret generic dramaip-auth-jwt-keyset \
  --namespace dramaip \
  --from-file=private.pem=/secure/auth/private.pem \
  --from-file=jwks.json=/secure/auth/jwks.json
```

## Migrations

The chart runs a pre-install/pre-upgrade migration Job by default. The Job uses
the dedicated migration image and the Go migration runner, which records applied
versions in PostgreSQL.

This lets the long-running service pods keep `AUTO_MIGRATE=false`, avoiding
concurrent migrations when replicas scale out.

Because the default migration Job is a Helm hook, it uses the namespace's
`default` ServiceAccount unless `migrations.serviceAccountName` is set. Hook
resources run before normal chart resources such as the app ServiceAccount.

Disable the migration hook only when migrations are handled by an approved
external release operation:

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

## Release boundaries

`values-staging.yaml` names only operator-managed Secrets: runtime credentials,
auth and Admin keysets, internal mTLS, registry pull, and Ingress TLS. It
intentionally contains no secret values. `values.yaml` is the production
baseline and must receive the corresponding production Secrets from the
platform's approved Secret Manager, Vault, External Secrets controller, or
cloud KMS-backed equivalent.

No release script performs a real payment. Provider payment paths remain
disabled unless their dedicated credential Secret and a separate approved
payment rollout are supplied.
