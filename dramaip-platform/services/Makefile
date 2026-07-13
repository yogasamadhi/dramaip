.PHONY: test db-role-matrix plan-snapshot-integration proto event-contracts tidy kong-up kong-down kong-logs \
        run-web-bff run-auth run-user run-billing run-quota run-ai-gateway run-notification run-notification-job run-billing-job run-quota-job run-migrate

GOCACHE ?= /tmp/dramaip-go-build
COMPOSE ?= ../deploy/docker-drama/docker-compose.yaml
COMPOSE_ENV ?= .env

test:
	GOCACHE=$(GOCACHE) go test ./...

# Requires a disposable PostgreSQL database and a DDL account with CREATEROLE.
# See docs/loop/LM3-10-数据库角色验证.md for setup and rollback commands.
db-role-matrix:
	GOCACHE=$(GOCACHE) go test ./pkg/platform -run '^TestDatabaseRoleMatrixIntegration$$' -count=1

# Requires an isolated PostgreSQL instance with a DDL login that has
# CREATEROLE. The test changes a seeded plan after checkout and verifies the
# paid subscription still has the old snapshot.
plan-snapshot-integration:
	GOCACHE=$(GOCACHE) go test ./app/billing/service/internal/data -run '^TestCheckoutSnapshotSurvivesPlanChangeIntegration$$' -count=1

# 单服务宿主机热重载调试用：默认连 localhost 上的 postgres/redis/rabbitmq 和
# 各下游 gRPC 端口（9101-9106）。完整容器栈请用 `make platform-up`（根目录 Makefile）
# 或 `python3 run-platform.py`。

run-web-bff:
	GOCACHE=$(GOCACHE) go run ./app/bff/web/interface/cmd/server

run-auth:
	GOCACHE=$(GOCACHE) go run ./app/auth/service/cmd/server

run-user:
	GOCACHE=$(GOCACHE) go run ./app/user/service/cmd/server

run-billing:
	GOCACHE=$(GOCACHE) go run ./app/billing/service/cmd/server

run-quota:
	GOCACHE=$(GOCACHE) go run ./app/quota/service/cmd/server

run-ai-gateway:
	GOCACHE=$(GOCACHE) go run ./app/ai_gateway/service/cmd/server

run-notification:
	GOCACHE=$(GOCACHE) go run ./app/notification/service/cmd/server

run-notification-job:
	GOCACHE=$(GOCACHE) go run ./app/notification/job/cmd/server

run-billing-job:
	GOCACHE=$(GOCACHE) go run ./app/billing/job/cmd/server

run-quota-job:
	GOCACHE=$(GOCACHE) go run ./app/quota/job/cmd/server

run-migrate:
	GOCACHE=$(GOCACHE) go run ./app/migration/job/cmd/server

# Kong is the sole external entry (:8000). BFF binds loopback; Kong proxies to it.
kong-up:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) up -d kong

kong-down:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) stop kong

kong-logs:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) logs -f kong

tidy:
	go mod tidy

proto:
	@if ! command -v buf >/dev/null 2>&1; then \
		echo "buf is required. Install with: brew install bufbuild/buf/buf"; \
		exit 1; \
	fi
	buf generate

event-contracts:
	bash scripts/check-event-contracts.sh
