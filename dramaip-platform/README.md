# DramaIP Platform

Closed-source platform workspace for DramaIP web, mobile, and cloud services.

See the shared architecture document:

- [../docs/技术架构.md](../docs/技术架构.md)

## Workspace

```txt
clients/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  apps/
    web/       Next.js website, pricing, account, billing
    mobile/    Expo mobile lightweight creation app
  packages/
    sdk/       TypeScript API client shared by clients

services/
  api/       Proto contracts
  app/       Kratos service apps
  pkg/       Go shared packages
  migrations/

deploy/
  docker/
  kong/
  k8s/
```

## Commands

```bash
cd clients
pnpm install
pnpm dev:web
pnpm dev:mobile

cd ../services
GOCACHE=/tmp/dramaip-go-build go test ./...
make run-bff
```

The clients workspace is managed from `clients/`. The Go services are initialized as a single-module Kratos monorepo under `services/`. Service implementation will be added incrementally behind the existing proto and directory boundaries.

## Local Web → Kong → BFF Smoke

Kong is the sole external entry. The BFF binds loopback only, so clients must
go through Kong (`:8000`); the BFF (`:8100`) is not reachable from other hosts.

Start Kong, then the BFF:

```bash
cd services
make kong-up      # docker compose up -d kong  (proxy :8000, admin :8001)
make run-bff      # listens on 127.0.0.1:8100
```

Start the Web app in another terminal:

```bash
cd clients
pnpm dev:web
```

The Web app defaults to `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (Kong)
and displays BFF health plus demo dashboard data on the home page. Verify the
proxy directly with `curl http://localhost:8000/healthz`.
