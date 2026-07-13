COMPOSE ?= deploy/docker-drama/docker-compose.yaml
COMPOSE_ENV ?= services/.env

.PHONY: platform-up platform-down platform-logs platform-e2e web-route-smoke test

platform-up:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) up -d --build

platform-down:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) down

platform-logs:
	docker compose --env-file $(COMPOSE_ENV) -f $(COMPOSE) logs -f web-bff auth user billing quota ai-gateway notification notification-job billing-job quota-job kong postgres redis rabbitmq

platform-e2e:
	node scripts/platform-e2e.mjs

web-route-smoke:
	node scripts/web-route-smoke.mjs

test:
	$(MAKE) -C services test
	cd clients && pnpm typecheck
	$(MAKE) web-route-smoke
