COMPOSE ?= deploy/docker-drama/docker-compose.yaml
COMPOSE_ARGS = -f $(COMPOSE) --profile java

.PHONY: platform-package platform-up platform-wait platform-down platform-logs platform-e2e observability-smoke observability-config-smoke observability-rule-test web-route-smoke client-contracts test

platform-package:
	cd server && mvn -B -ntp -DskipTests package

platform-up: platform-package
	docker compose $(COMPOSE_ARGS) up -d --build
	docker compose $(COMPOSE_ARGS) restart java-gateway
	$(MAKE) platform-wait

platform-wait:
	DRAMAIP_PLATFORM_HEALTH_URL=http://localhost:8080 node scripts/wait-for-platform-ready.mjs

platform-down:
	docker compose $(COMPOSE_ARGS) down

platform-logs:
	docker compose $(COMPOSE_ARGS) logs -f java-gateway identity support creation java-quota ai java-billing java-migration postgres redis rabbitmq nacos seata minio

platform-e2e:
	DRAMAIP_API_BASE_URL=http://localhost:8080 node scripts/java-platform-e2e.mjs

observability-smoke:
	node scripts/observability-smoke.mjs

observability-config-smoke:
	node scripts/observability-config-smoke.mjs

observability-rule-test:
	docker run --rm --mount type=bind,source=$(CURDIR)/deploy/docker-drama/prometheus,target=/etc/prometheus,readonly --entrypoint promtool prom/prometheus:v3.11.3 test rules /etc/prometheus/alerts_test.yml

web-route-smoke:
	node scripts/web-route-smoke.mjs

client-contracts:
	cd clients && pnpm contracts:check

test:
	cd server && mvn -B -ntp verify
	cd clients && pnpm typecheck
	cd clients && pnpm test
	$(MAKE) client-contracts
	$(MAKE) web-route-smoke
