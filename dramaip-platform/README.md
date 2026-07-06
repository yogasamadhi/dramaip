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

## Docker MVP

The runnable MVP uses the Docker stack instead of in-memory fake data:

```bash
make mvp-up
```

Start the Web app in another terminal:

```bash
cd clients
pnpm dev:web
```

The Web app defaults to `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (Kong)
and displays BFF health plus plan data on the home page. Verify the proxy with:

```bash
make mvp-smoke
```

The MVP path is:

1. Website home page calls Kong -> BFF health, including Postgres/Redis/RabbitMQ checks.
2. Pricing loads plans from PostgreSQL via `GET /plans`.
3. Login calls `POST /auth/login`, verifies the bcrypt password hash in
   PostgreSQL, issues JWT access/refresh tokens, stores the access session in
   Redis, and stores the refresh-token hash in PostgreSQL.
4. Account reads subscription and token balance from PostgreSQL.
5. Checkout writes a PostgreSQL order/outbox event and publishes a RabbitMQ
   event over AMQP.
6. Prometheus scrapes BFF/Kong/RabbitMQ/Collector metrics; BFF container logs
   are collected by Fluent Bit into OpenSearch.

Open `http://localhost:3009`, then use the seeded development account:

- Email: `creator@example.com`
- Password: `password123`

Implementation notes:

- Kong owns CORS and edge concerns. The BFF intentionally does not emit CORS
  headers.
- Client code should go through `clients/packages/sdk` instead of handwritten
  HTTP calls.
- The BFF container is not exposed directly; clients enter through Kong on
  `http://localhost:8000`.

creator@example.com
password123
