COMPOSE ?= deploy/docker-drama/docker-compose.yaml
COMPOSE_PROJECT_NAME ?= dramaip-e2e-local
COMPOSE_ARGS = -f $(COMPOSE) --profile java
E2E_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile e2e
OBSERVABILITY_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile observability
OBSERVABILITY_TEST_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile observability --profile observability-test
CI_E2E_COMPOSE_ARGS = -f $(COMPOSE) --profile java --profile e2e --profile observability --profile observability-test
OTEL_JAVAAGENT_OPTS = -javaagent:/app/observability/opentelemetry-javaagent.jar
CI_COMPOSE_PORTS = POSTGRES_HOST_PORT=0 REDIS_HOST_PORT=0 RABBITMQ_HOST_PORT=0 RABBITMQ_MANAGEMENT_HOST_PORT=0 MINIO_HOST_PORT=0 MINIO_CONSOLE_HOST_PORT=0 NACOS_HOST_PORT=0 NACOS_CONSOLE_HOST_PORT=0 NACOS_GRPC_HOST_PORT=0 SEATA_HOST_PORT=0 GATEWAY_HOST_PORT=0
CI_OBSERVABILITY_PORTS = PROMETHEUS_HOST_PORT=0 ALLOY_HOST_PORT=0 ALLOY_OTLP_GRPC_HOST_PORT=0 ALLOY_OTLP_HTTP_HOST_PORT=0 LOKI_HOST_PORT=0 TEMPO_HOST_PORT=0 GRAFANA_HOST_PORT=0
E2E_AI_ENV = AI_PROVIDER_BASE_URL=http://mock-ai:8099 AI_PROVIDER_API_KEY=dramaip-e2e AI_MODELS=dramaip-e2e CORPUS_CRAWLER_ENABLED=true CORPUS_PUBLIC_SEARCH_ENABLED=true CORPUS_PERSONALIZATION_ENABLED=true CORPUS_EXPERIMENTS_ENABLED=true CORPUS_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
E2E_DATA_ROOT = /tmp/$(COMPOSE_PROJECT_NAME)-data
E2E_DATA_ENV = DRAMAIP_COMPOSE_DATA_ROOT=$(E2E_DATA_ROOT)

.PHONY: platform-package platform-up platform-ci-e2e platform-wait platform-down platform-ci-down platform-logs platform-e2e platform-observability-up platform-observability-smoke platform-observability-down observability-smoke observability-config-smoke observability-config-validate observability-rule-test web-route-smoke client-contracts test

platform-package:
	cd server && mvn -B -ntp -DskipTests package

platform-up: platform-package
	docker compose $(COMPOSE_ARGS) up -d --build
	docker compose $(COMPOSE_ARGS) restart java-gateway
	$(MAKE) platform-wait

# CI consumes java_server artifacts and must not rebuild the Maven reactor.
platform-ci-e2e:
	@set -eu; \
		export COMPOSE_PROJECT_NAME='$(COMPOSE_PROJECT_NAME)'; \
		canary="dramaip-sensitive-$${CI_PIPELINE_ID:-local}-$${CI_JOB_ID:-$${PPID:-0}}"; \
		witness="dramaip-observability-witness-$${CI_PIPELINE_ID:-local}-$${CI_JOB_ID:-$${PPID:-0}}-$$(date +%s)"; \
		export DRAMAIP_OBSERVABILITY_CANARY="$$canary"; \
		export DRAMAIP_OBSERVABILITY_WITNESS="$$witness"; \
		$(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) OTEL_JAVAAGENT_OPTS='$(OTEL_JAVAAGENT_OPTS)' docker compose $(CI_E2E_COMPOSE_ARGS) up -d --build; \
		$(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) restart java-gateway; \
		gateway=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port java-gateway 8080); \
		prometheus=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port prometheus 9090); \
		alloy=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port alloy 12345); \
		alloy_otlp_http=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port alloy 4318); \
		loki=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port loki 3100); \
		tempo=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port tempo 3200); \
		grafana=$$($(E2E_AI_ENV) $(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) port grafana 3000); \
		DRAMAIP_PLATFORM_HEALTH_URL="http://$$gateway" node scripts/wait-for-platform-ready.mjs; \
		DRAMAIP_API_BASE_URL="http://$$gateway" node scripts/java-platform-e2e.mjs; \
		DRAMAIP_API_BASE_URL="http://$$gateway" \
		DRAMAIP_PROMETHEUS_URL="http://$$prometheus" \
		DRAMAIP_ALLOY_URL="http://$$alloy" \
		DRAMAIP_ALLOY_OTLP_HTTP_URL="http://$$alloy_otlp_http" \
		DRAMAIP_LOKI_URL="http://$$loki" \
		DRAMAIP_TEMPO_URL="http://$$tempo" \
		DRAMAIP_GRAFANA_URL="http://$$grafana" \
		DRAMAIP_LOG_CANARY_EXPECTED=true \
		node scripts/observability-smoke.mjs

platform-wait:
	DRAMAIP_PLATFORM_HEALTH_URL=http://localhost:8080 node scripts/wait-for-platform-ready.mjs

platform-down:
	docker compose $(COMPOSE_ARGS) down

platform-ci-down:
	@set -eu; \
		export COMPOSE_PROJECT_NAME='$(COMPOSE_PROJECT_NAME)'; \
		$(E2E_DATA_ENV) $(CI_COMPOSE_PORTS) $(CI_OBSERVABILITY_PORTS) docker compose $(CI_E2E_COMPOSE_ARGS) down -v --remove-orphans; \
		data_root='$(E2E_DATA_ROOT)'; \
		data_name=$${data_root#/tmp/}; \
		case "$$data_name" in \
			''|*[!A-Za-z0-9_.-]*|dramaip-*-data/*) echo "Refusing to delete unsafe CI data root: $$data_root" >&2; exit 2 ;; \
			dramaip-*-data) ;; \
			*) echo "Refusing to delete unexpected CI data root: $$data_root" >&2; exit 2 ;; \
		esac; \
		if [ -e "$$data_root" ] || [ -L "$$data_root" ]; then find "$$data_root" -depth -delete; fi

platform-logs:
	docker compose $(COMPOSE_ARGS) logs -f java-gateway identity java-notification java-reporting creation java-quota ai java-billing java-migration postgres redis rabbitmq nacos-mysql nacos seata minio

platform-e2e:
	$(E2E_AI_ENV) $(E2E_DATA_ENV) docker compose $(E2E_COMPOSE_ARGS) up -d mock-ai mock-corpus ai
	DRAMAIP_API_BASE_URL=http://localhost:8080 node scripts/java-platform-e2e.mjs

platform-observability-up: platform-package
	./deploy/docker-drama/scripts/init-data-dirs.sh
	OTEL_JAVAAGENT_OPTS='$(OTEL_JAVAAGENT_OPTS)' docker compose $(OBSERVABILITY_COMPOSE_ARGS) up -d --build --remove-orphans
	docker compose $(OBSERVABILITY_COMPOSE_ARGS) restart java-gateway
	$(MAKE) platform-wait

platform-observability-smoke:
	@set -eu; \
		canary="dramaip-sensitive-local-$$(date +%s)-$${PPID:-0}"; \
		witness="dramaip-observability-witness-local-$$(date +%s)-$${PPID:-0}"; \
		cleanup() { \
			status=$$?; \
			trap - 0; \
			if ! DRAMAIP_OBSERVABILITY_CANARY="$$canary" docker compose $(OBSERVABILITY_TEST_COMPOSE_ARGS) rm -sf observability-canary >/dev/null 2>&1; then \
				echo "Failed to remove the local observability canary container" >&2; \
				if [ "$$status" -eq 0 ]; then status=1; fi; \
			fi; \
			exit "$$status"; \
		}; \
		trap cleanup 0; \
		DRAMAIP_OBSERVABILITY_CANARY="$$canary" DRAMAIP_OBSERVABILITY_WITNESS="$$witness" docker compose $(OBSERVABILITY_TEST_COMPOSE_ARGS) up -d --force-recreate observability-canary; \
		DRAMAIP_OBSERVABILITY_CANARY="$$canary" DRAMAIP_OBSERVABILITY_WITNESS="$$witness" DRAMAIP_LOG_CANARY_EXPECTED=true $(MAKE) observability-smoke

platform-observability-down:
	docker compose $(OBSERVABILITY_TEST_COMPOSE_ARGS) down --remove-orphans

observability-smoke:
	node scripts/observability-smoke.mjs

observability-config-smoke:
	node scripts/observability-config-smoke.mjs

observability-config-validate:
	docker compose -f $(COMPOSE) --profile observability config --quiet
	docker run --rm -e DRAMAIP_HOST_LOG_GLOB='/var/log/dramaip/*.log' -e DRAMAIP_COMPOSE_PROJECT_NAME=dramaip-config-validation --mount type=bind,source=$(CURDIR)/deploy/docker-drama/alloy/config.alloy,target=/etc/alloy/config.alloy,readonly grafana/alloy:v1.19.2 validate /etc/alloy/config.alloy
	docker run --rm --mount type=bind,source=$(CURDIR)/deploy/docker-drama/loki/config.yaml,target=/etc/loki/config.yaml,readonly grafana/loki:3.7.3 -config.file=/etc/loki/config.yaml -verify-config=true
	docker run --rm --mount type=bind,source=$(CURDIR)/deploy/docker-drama/tempo/config.yaml,target=/etc/tempo/config.yaml,readonly grafana/tempo:3.0.2 -config.file=/etc/tempo/config.yaml -config.verify=true

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
