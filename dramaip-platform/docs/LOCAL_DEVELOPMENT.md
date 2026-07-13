# DramaIP Platform Local Development

This page is the operational checklist for the runnable platform baseline.

## Start

From the repository root:

```bash
python3 run-platform.py
```

The launcher starts the Docker stack and the Next.js web app.

Before v1.0, Docker Compose is the supported development and acceptance path.
K8s/Helm files remain in the repository, but the local baseline is Compose:
Kong -> BFF -> auth/user/billing/quota/ai-gateway/notification, with
`notification-job` consuming its own RabbitMQ event subscription.

| Entry | URL |
| --- | --- |
| Web | `http://localhost:3009` |
| Kong API | `http://localhost:8000` |
| Kong admin | `http://localhost:8001` |
| Grafana | `http://localhost:3000` |
| Jaeger | `http://localhost:16686` |
| RabbitMQ management | `http://localhost:15672` |

Development account:

- Email: `creator@example.com`
- Password: `password123`

## End-To-End Check

After the stack is healthy:

```bash
cd dramaip-platform
make platform-e2e
```

The end-to-end check enters through Kong and verifies:

1. `/v1/healthz`
2. log in with a verified e2e account (the bundled seed account is verified)
3. plan catalog
4. protected dashboard and token balance
5. checkout creation
6. simulated payment confirmation
7. notification job consumes the payment event once and records the in-app notification
8. AI chat without a real key returns an explicit provider-key error
9. AI chat with provider `test` succeeds and consumes quota
10. refresh and logout

## Observability Smoke

After the Compose stack is healthy, run:

```bash
cd dramaip-platform
make observability-smoke
```

The smoke sends a fixed W3C `traceparent` and request ID through
`Kong -> Web BFF -> billing`, then requires the same trace ID in the API
response, a multi-service Jaeger trace, and a structured OpenSearch log.
It does not send payment credentials, AI prompts, cookies, or real payments.

The bundled OpenSearch/Fluent Bit/Dashboards stack is local-development-only:
the unsecured endpoints bind to loopback and must never be exposed or reused
for production. A production log backend must enable TLS and certificate
verification, authentication, least-privilege writer/search roles, tenant/index
isolation, lifecycle/retention, audit logging, backups, and secret injection
outside Git. `plugins.security.disabled=true` and the Dashboards security-plugin
override are prohibited in production deployment values.

## AI Provider Configuration

The default real provider is OpenAI-compatible and is configured only on the
server side:

```bash
AI_PROVIDER_DEFAULT=openai-compatible
AI_PROVIDERS=openai-compatible
AI_PROVIDER_BASE_URL=https://api.openai.com/v1
AI_PROVIDER_API_KEY=sk-replace-me
AI_DEFAULT_MODEL=gpt-4o-mini
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_INPUT_PRICE_PER_MILLION=...
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_OUTPUT_PRICE_PER_MILLION=...
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_CURRENCY=USD
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_EXCHANGE_RATE_TO_CNY=...
```

真实 Provider 必须同时有输入/输出单价和 CNY 汇率；缺失时网关会在调用上游前拒绝请求，
不会用零成本放行。用户/IP 短窗口成本上限与套餐复算方法见
[AI 套餐与成本校准基线](product/AI套餐成本校准.md)。

For local and CI end-to-end checks, provider `test` is enabled automatically when
`ENV=dev` or `ENV=test`. It returns a deterministic response and uses the same
quota reservation and settlement path as a real provider.

Clients, including the future desktop cloud provider, must call the BFF/SDK and
must never receive upstream model API keys or call billing/quota directly.

## Simulated Payment

`POST /v1/billing/payments/simulated/confirm` is available only when `ENV=dev` or
`ENV=test`. It confirms a pending checkout through the simulated payment
provider, creates an active subscription, and creates the current token account.
Production environments must use verified payment webhooks instead.

`POST /v1/billing/sandbox/confirm-payment` is kept only as a deprecated
compatibility endpoint and delegates to the simulated provider path.

## Email Verification and Password Recovery

The Web routes `/verify-email`, `/forgot-password`, and `/reset-password` use
an 8-character, one-time code that expires after 15 minutes. The auth service
stores only a SHA-256 hash of the code; it does not put a code, password, or
token in a URL, trace, or log. Password reset also revokes every refresh token
and invalidates existing access sessions immediately.

To exercise delivery against a controlled local test gateway, set these only in
your untracked local environment (never commit the delivery token):

```bash
AUTH_EMAIL_DELIVERY_URL=https://mail-gateway.example.test/deliver
AUTH_EMAIL_DELIVERY_TOKEN=replace-me
AUTH_EMAIL_FROM=noreply@example.test
AUTH_EMAIL_TIMEOUT=10s
```

The gateway must accept a JSON POST body with `to`, `from`, `template`,
`subject`, and `text`. The public reset request intentionally returns the same
accepted response for registered and unregistered email addresses. Without a
delivery gateway, verification reports that delivery is unavailable and reset
requests remain intentionally non-enumerating; do not treat that state as a
production-ready email flow. Production auth-service accepts only an HTTPS
delivery endpoint.

`make platform-e2e` deliberately uses the verified seed account by default so
the billing/ledger smoke does not require reading a delivery mailbox. To run a
registration-and-verification browser test, point the auth service at an
isolated delivery gateway and use a test account that completes the code entry
through `/verify-email`; do not expose a test-only endpoint that returns codes.

## Useful Commands

```bash
cd dramaip-platform
make platform-up
make platform-e2e
make observability-smoke
make platform-logs
make platform-down

cd services
GOCACHE=/tmp/dramaip-go-build go test ./...
# 需要一个全新隔离 PostgreSQL；验证支付确认、额度激活与 outbox 重放。
POSTGRES_BILLING_SAGA_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_billing_saga?sslmode=disable' \
  make billing-saga-integration
# 需要另一个全新隔离 PostgreSQL；验证 billing-job 的到期取消与模拟订阅续期事务。
POSTGRES_BILLING_LIFECYCLE_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_billing_lifecycle?sslmode=disable' \
  make billing-lifecycle-integration
# 需要另一个全新隔离 PostgreSQL；验证支付账本、订阅和 quota 周期账户的差异建案、重跑幂等和人工操作审计。
POSTGRES_BILLING_RECONCILIATION_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_billing_reconciliation?sslmode=disable' \
  make billing-reconciliation-integration

cd ../clients
pnpm typecheck
```

## Service Layout

Runnable services under `services/app/` follow the Kratos layout:

- `cmd/server`: process bootstrap, Wire wiring, and `kratos.App`.
- `internal/server`: HTTP/gRPC/job lifecycle registration.
- `internal/service`: transport handlers and proto/HTTP shape adapters.
- `internal/biz`: business orchestration and validation.
- `internal/data`: Postgres/Redis/RabbitMQ/provider/RPC clients.

## Common Failures

- `provider openai-compatible api key is not configured`: expected when no real
  `AI_PROVIDER_API_KEY` is configured. Use provider `test` for local end-to-end checks.
- `missing_refresh_cookie`, `invalid_token`, or `csrf_rejected`: log in again;
  the Web app keeps its access/refresh credentials in HttpOnly Cookies and
  automatically sends the matching CSRF header for Cookie session writes.
- Kong health timeout: inspect `docker compose -f deploy/docker-drama/docker-compose.yaml ps`
  and `make platform-logs`.
- notification event remains pending: inspect `notification-job` health/logs and the
  RabbitMQ `dramaip.notification.events` / `.dlq` queues. A failed delivery is
  retried up to `NOTIFICATION_EVENT_MAX_RETRIES`, then retained in the DLQ.
