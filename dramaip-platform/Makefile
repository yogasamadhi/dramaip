COMPOSE ?= deploy/docker-drama/docker-compose.yaml
COMPOSE_ENV ?= services/.env

.PHONY: platform-up platform-wait platform-down platform-logs platform-e2e observability-smoke observability-config-smoke observability-rule-test web-route-smoke client-contracts test

platform-up:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) up -d --build
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) restart kong
	$(MAKE) platform-wait

platform-wait:
	node scripts/wait-for-platform-ready.mjs

platform-down:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) down

platform-logs:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) logs -f web-bff auth user billing quota ai-gateway notification notification-job billing-job quota-job kong postgres redis rabbitmq

platform-e2e:
	node scripts/platform-e2e.mjs

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
	$(MAKE) -C services test
	cd clients && pnpm typecheck
	$(MAKE) client-contracts
	$(MAKE) web-route-smoke
