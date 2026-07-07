# DramaIP Platform Baseline

## Goal

Maintain a runnable platform loop for users who do not want to manage their own
model API keys:

- browse subscription plans from PostgreSQL;
- register a development account or log in with the seeded account using bcrypt password verification;
- store the access session in Redis and refresh-token hash in PostgreSQL;
- view active subscription and monthly token balance from PostgreSQL;
- create a checkout order and publish a RabbitMQ event;
- confirm a checkout through the dev/test simulated payment provider;
- call AI through the cloud AI gateway and settle token usage;
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

| Component | Responsibility |
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

## Platform API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Gateway/BFF/dependency health check |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/auth/login` | Login, returns access/refresh tokens |
| `POST` | `/auth/refresh` | Rotate access credentials with a refresh token |
| `POST` | `/auth/logout` | Revoke a refresh token |
| `GET` | `/plans` | PostgreSQL-backed subscription plan catalog |
| `POST` | `/billing/checkout` | Create order/outbox record and publish RabbitMQ event |
| `POST` | `/billing/payments/simulated/confirm` | Dev/test-only simulated payment confirmation |
| `POST` | `/billing/sandbox/confirm-payment` | Deprecated compatibility confirmation endpoint |
| `GET` | `/me/subscription` | Current subscription state |
| `GET` | `/me/orders` | Current user's order list |
| `GET` | `/me/token-usage` | Token usage details |
| `GET` | `/me/usage-trend` | Token usage trend |
| `GET` | `/me/dashboard` | Profile and subscription state |
| `GET` | `/me/token-balance` | Monthly token quota state |
| `POST` | `/ai/chat` | Cloud AI gateway chat with quota reservation/settlement |

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
make platform-up

cd clients
pnpm dev:web
```

Open `http://localhost:3009` and log in with:

- Email: `creator@example.com`
- Password: `password123`

End-to-end check:

```bash
make platform-e2e
```

The end-to-end check enters through Kong and verifies login, plans, account
data, checkout, simulated payment confirmation, AI no-key error handling, test
provider quota settlement, refresh, and logout.

## Next Replacement Points

- Add email verification and account recovery after the registration and
  refresh-token rotation paths are stable.
- Replace checkout placeholder URLs with WeChat Pay / Alipay order creation.
- Keep BFF as the HTTP aggregation layer while auth, user, billing, quota, and
  ai-gateway own their data through Kratos services.
- Add OpenTelemetry SDK instrumentation to emit service traces into the
  existing Collector -> Jaeger pipeline.

See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for ports, environment
variables, API key handling, test provider behavior, simulated payment, and
troubleshooting.
