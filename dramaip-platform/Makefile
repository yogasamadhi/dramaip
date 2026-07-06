COMPOSE ?= deploy/docker-drama/docker-compose.yaml

.PHONY: mvp-up mvp-down mvp-logs mvp-smoke test

mvp-up:
	docker compose -f $(COMPOSE) up -d --build

mvp-down:
	docker compose -f $(COMPOSE) down

mvp-logs:
	docker compose -f $(COMPOSE) logs -f bff auth user billing quota ai-gateway billing-job quota-job kong postgres redis rabbitmq

mvp-smoke:
	curl -fsS http://localhost:8000/healthz

test:
	$(MAKE) -C services test
	cd clients && pnpm typecheck
