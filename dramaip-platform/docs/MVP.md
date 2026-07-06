# DramaIP Platform MVP

## Goal

Build the smallest runnable platform loop for users who do not want to manage
their own model API keys:

- browse subscription plans from PostgreSQL;
- log in with a seeded development account using bcrypt password verification;
- store the access session in Redis and refresh-token hash in PostgreSQL;
- view active subscription and monthly token balance from PostgreSQL;
- create a checkout order and publish a RabbitMQ event;
- expose BFF metrics to Prometheus and BFF logs to the Docker log pipeline.

## Runtime Boundary

```txt
Browser / Next.js Web
  -> Kong (:8000)
    -> BFF container (:8100, Docker network only)
      -> PostgreSQL: users, plans, subscriptions, token accounts, orders, outbox
      -> Redis: access-token session cache
      -> RabbitMQ management API: checkout event publishing
      -> Prometheus: /metrics scrape
      -> Fluent Bit -> OpenSearch: container logs
```

Kong is the only external API entry. The BFF is private inside the Docker
network and is reached by Kong through `http://bff:8100`.

## Docker Stack

| Component | MVP Role |
| --- | --- |
| Kong | External API gateway, CORS, rate limiting, proxy to BFF |
| BFF | Web-facing orchestration service |
| PostgreSQL | Source of truth for auth, billing, quota, and account data |
| Redis | Access-token session cache |
| RabbitMQ | Checkout event bus |
| Prometheus | Metrics scrape for BFF, Kong, RabbitMQ, and OTel Collector |
| Grafana | Metrics UI |
| Fluent Bit | Docker log collection |
| OpenSearch / Dashboards | Log storage and inspection |
| OpenTelemetry Collector / Jaeger | Trace pipeline foundation for later service traces |

## MVP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Gateway/BFF/dependency smoke check |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/auth/login` | Login, returns access/refresh tokens |
| `GET` | `/plans` | PostgreSQL-backed subscription plan catalog |
| `POST` | `/billing/checkout` | Create order/outbox record and publish RabbitMQ event |
| `GET` | `/me/dashboard` | Profile and subscription state |
| `GET` | `/me/token-balance` | Monthly token quota state |

## Web Routes

| Route | Purpose |
| --- | --- |
| `/` | Product entry and service status |
| `/pricing` | Plans and checkout creation |
| `/login` | Seeded development account login |
| `/account` | Protected account and token balance |
| `/billing` | Billing status placeholder |
| `/download` | Desktop download placeholder |

## Local Run

```bash
cd dramaip-platform
make mvp-up

cd clients
pnpm dev:web
```

Open `http://localhost:3009` and log in with:

- Email: `creator@example.com`
- Password: `password123`

Smoke check:

```bash
make mvp-smoke
```

## Next Replacement Points

- Replace seeded account creation with registration, email verification, and
  refresh-token rotation UI.
- Replace checkout placeholder URLs with WeChat Pay / Alipay order creation.
- Move BFF's direct table reads behind the separate auth, user, billing, and
  quota Kratos services as those services become real.
- Add OpenTelemetry SDK instrumentation to emit service traces into the
  existing Collector -> Jaeger pipeline.
