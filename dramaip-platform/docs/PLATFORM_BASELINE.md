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
      -> auth/user/billing/quota/ai-gateway/notification over internal gRPC
        -> PostgreSQL: users, plans, subscriptions, token accounts, orders, outbox, notifications, notification inbox
        -> Redis: access-token session cache
        -> RabbitMQ topic exchange: versioned events; notification-job consumes its dedicated queue
      -> Prometheus: /metrics scrape
      -> Fluent Bit -> OpenSearch: container logs
```

Kong is the only external API entry. The BFF is private inside the Docker
network and is reached by Kong through `http://web-bff:8100`.

## Docker Stack

| Component | Responsibility |
| --- | --- |
| Kong | External API gateway, CORS, rate limiting, proxy to BFF |
| BFF | Web-facing orchestration service |
| PostgreSQL | Source of truth for auth, billing, quota, and account data |
| Redis | Access-token session cache |
| RabbitMQ | Versioned event topic exchange with dedicated domain queues and dead-letter queues |
| Prometheus | Metrics scrape for BFF, Kong, RabbitMQ, and OTel Collector |
| Grafana | Metrics UI |
| Fluent Bit | Docker log collection |
| OpenSearch / Dashboards | Log storage and inspection |
| OpenTelemetry Collector / Jaeger | Trace pipeline foundation for later service traces |

## Platform API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/healthz` | Gateway/BFF/dependency health check |
| `GET` | `/v1/metrics` | Prometheus metrics |
| `POST` | `/v1/auth/login` | Login and set HttpOnly access/refresh Cookie sessions; JSON returns only the user |
| `GET` | `/v1/auth/session` | Validate the current Web access Cookie session |
| `POST` | `/v1/auth/refresh` | Rotate Cookie credentials using the HttpOnly refresh Cookie and CSRF header |
| `POST` | `/v1/auth/logout` | Revoke the refresh session and clear Web Cookie sessions |
| `POST` | `/v1/auth/email-verification/request` | Send a short-lived verification code to the authenticated user's email |
| `POST` | `/v1/auth/email-verification/confirm` | Consume a one-time verification code for the authenticated user |
| `POST` | `/v1/auth/password-reset/request` | Request a recovery code with enumeration-safe response semantics |
| `POST` | `/v1/auth/password-reset/confirm` | Reset password, revoke refresh tokens, and invalidate existing access sessions |
| `GET` | `/v1/plans` | PostgreSQL-backed subscription plan catalog |
| `POST` | `/v1/billing/checkout` | Create order/outbox record and publish RabbitMQ event |
| `POST` | `/v1/billing/payments/simulated/confirm` | Dev/test-only simulated payment confirmation |
| `POST` | `/v1/billing/sandbox/confirm-payment` | Deprecated compatibility confirmation endpoint |
| `GET` | `/v1/me/subscription` | Current subscription state |
| `GET` | `/v1/me/orders` | Current user's order list |
| `GET` | `/v1/me/token-usage` | Token usage details |
| `GET` | `/v1/me/usage-trend` | Token usage trend |
| `GET` | `/v1/me/notifications` | Current user's notification list |
| `POST` | `/v1/me/notifications/{id}/read` | Mark a current-user notification read |
| `GET` | `/v1/me/dashboard` | Profile and subscription state |
| `GET` | `/v1/me/token-balance` | Monthly token quota state |
| `GET` | `/v1/ai/models` | Authenticated, billable model catalog; no provider secrets |
| `POST` | `/v1/ai/preflight` | Bind the exact author request and verify model/remaining quota before execution |
| `POST` | `/v1/ai/chat/stream` | SSE authoring output with durable idempotency, reservation/settlement and reconnect-safe completion |
| `POST` | `/v1/ai/chat/cancel` | Request cancellation of the current author generation and release its reservation |
| `GET` | `/v1/ai/chat/status` | Owner-scoped recovery of an existing request; excludes input prompts |
| `POST` | `/v1/ai/chat` | Backward-compatible synchronous Cloud AI chat with quota reservation/settlement |

## Web Routes

| Route | Purpose |
| --- | --- |
| `/` | Product entry and service status |
| `/pricing` | Plans and checkout creation |
| `/login` | Seeded development account login |
| `/account` | Protected account and token balance |
| `/billing` | Orders, subscription period, usage and token balance overview |
| `/download` | Official Gitee Release download and installation entry |
| `/verify-email` | Authenticated email verification using an out-of-band one-time code |
| `/forgot-password` and `/reset-password` | Enumeration-safe recovery request and password reset |

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

The end-to-end check enters through Kong and verifies Cookie login, CSRF-protected
state changes, plans, account data, checkout, simulated payment confirmation,
AI no-key error handling, test-provider quota settlement, refresh, and logout.

## Email Delivery Boundary

Email verification and recovery use an 8-character one-time code with a
15-minute expiry. Only its SHA-256 hash is persisted. Configure
`AUTH_EMAIL_DELIVERY_URL`, `AUTH_EMAIL_DELIVERY_TOKEN`, and
`AUTH_EMAIL_FROM` with a provider-owned HTTPS delivery gateway before opening
public registration. The gateway receives the recipient, template, subject,
and message body in a POST request; codes are never returned through the Web
API, written to logs, or placed in a URL.

Unverified accounts may browse plans but the Web BFF rejects checkout creation
until verification succeeds. This keeps the billing state machine independent
of Web UI state while making registration verification a real commercial-flow
gate.

## Next Replacement Points

- Replace checkout placeholder URLs with WeChat Pay / Alipay order creation.
- Keep BFF as the HTTP aggregation layer while auth, user, billing, quota,
  ai-gateway, and notification own their data through Kratos services.
- Add OpenTelemetry SDK instrumentation to emit service traces into the
  existing Collector -> Jaeger pipeline.

See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for ports, environment
variables, API key handling, test provider behavior, simulated payment, and
troubleshooting.
