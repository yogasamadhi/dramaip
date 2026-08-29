COMPOSE ?= deploy/docker-drama/docker-compose.yaml
COMPOSE_PROJECT_NAME ?= dramaip-e2e-local
COMPOSE_ARGS = -f $(COMPOSE) --profile java
E2E_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile e2e
OBSERVABILITY_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile observability
OTEL_JAVAAGENT_OPTS = -javaagent:/app/observability/opentelemetry-javaagent.jar
CI_COMPOSE_PORTS = POSTGRES_HOST_PORT=0 REDIS_HOST_PORT=0 RABBITMQ_HOST_PORT=0 RABBITMQ_MANAGEMENT_HOST_PORT=0 MINIO_HOST_PORT=0 MINIO_CONSOLE_HOST_PORT=0 NACOS_HOST_PORT=0 NACOS_CONSOLE_HOST_PORT=0 NACOS_GRPC_HOST_PORT=0 SEATA_HOST_PORT=0 GATEWAY_HOST_PORT=0
E2E_AI_ENV = AI_PROVIDER_BASE_URL=http://mock-ai:8099 AI_PROVIDER_API_KEY=dramaip-e2e AI_MODELS=dramaip-e2e CORPUS_CRAWLER_ENABLED=true CORPUS_PUBLIC_SEARCH_ENABLED=true CORPUS_PERSONALIZATION_ENABLED=true CORPUS_EXPERIMENTS_ENABLED=true CORPUS_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
E2E_DATA_ENV = DRAMAIP_COMPOSE_DATA_ROOT=/tmp/$(COMPOSE_PROJECT_NAME)-data

.PHONY: platform-package platform-up platform-ci-e2e platform-wait platform-down platform-ci-down platform-logs platform-e2e platform-observability-up platform-observability-smoke platform-observability-down observability-smoke observability-config-smoke observability-rule-test web-route-smoke client-contracts test

platform-package:
	cd server && mvn -B -ntp -DskipTests package

platform-up: platform-package
	docker compose $(COMPOSE_ARGS) up -d --build
	docker compose $(COMPOSE_ARGS) restart java-gateway
	$(MAKE) platform-wait

# CI consumes java_server artifacts and must not rebuild the Maven reactor.
platform-ci-e2e:
	$(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) docker compose $(E2E_COMPOSE_ARGS) up -d --build
	$(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) docker compose $(E2E_COMPOSE_ARGS) restart java-gateway
	gateway=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) docker compose $(E2E_COMPOSE_ARGS) port java-gateway 8080); \
		DRAMAIP_PLATFORM_HEALTH_URL="http://$$gateway" node scripts/wait-for-platform-ready.mjs; \
		DRAMAIP_API_BASE_URL="http://$$gateway" node scripts/java-platform-e2e.mjs

platform-wait:
	DRAMAIP_PLATFORM_HEALTH_URL=http://localhost:8080 node scripts/wait-for-platform-ready.mjs

platform-down:
	docker compose $(COMPOSE_ARGS) down

platform-ci-down:
	$(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) docker compose $(E2E_COMPOSE_ARGS) down -v --remove-orphans

platform-logs:
	docker compose $(COMPOSE_ARGS) logs -f java-gateway identity java-notification java-reporting creation java-quota ai java-billing java-migration postgres redis rabbitmq nacos-mysql nacos seata minio

platform-e2e:
	$(E2E_AI_ENV) $(E2E_DATA_ENV) docker compose $(E2E_COMPOSE_ARGS) up -d mock-ai mock-corpus ai
	DRAMAIP_API_BASE_URL=http://localhost:8080 node scripts/java-platform-e2e.mjs

platform-observability-up: platform-package
	OTEL_JAVAAGENT_OPTS='$(OTEL_JAVAAGENT_OPTS)' docker compose $(OBSERVABILITY_COMPOSE_ARGS) up -d --build
	docker compose $(OBSERVABILITY_COMPOSE_ARGS) restart java-gateway
	$(MAKE) platform-wait

platform-observability-smoke:
	$(MAKE) observability-smoke

platform-observability-down:
	docker compose $(OBSERVABILITY_COMPOSE_ARGS) down

observability-smoke:
	node scripts/observability-smoke.mjs

observability-config-smoke:
	node scripts/observability-config-smoke.mjs

observability-rule-test:
	docker run --rm --mount type=bind,source=$(CURDIR)/deploy/docker-drama/prometheus,target=/etc/prometheus,readonly --entrypoint promtool prom/prometheus:v3.11.3 test rules /etc/prometheus/alerts_test.yml

web-route-smoke:
	node scripts/web-route-smoke.mjs

client-contracts:
	cd clients && bun run contracts:check

test:
	cd server && mvn -B -ntp verify
	cd clients && bun run typecheck
	cd clients && bun run test
	$(MAKE) client-contracts
	$(MAKE) web-route-smoke
