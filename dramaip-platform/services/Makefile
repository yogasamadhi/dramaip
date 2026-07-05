.PHONY: test proto tidy kong-up kong-down kong-logs

GOCACHE ?= /tmp/dramaip-go-build
COMPOSE ?= ../deploy/docker-drama/docker-compose.yaml

test:
	GOCACHE=$(GOCACHE) go test ./...

run-bff:
	GOCACHE=$(GOCACHE) go run ./app/bff/interface/cmd/server

# Kong is the sole external entry (:8000). BFF binds loopback; Kong proxies to it.
kong-up:
	docker compose -f $(COMPOSE) up -d kong

kong-down:
	docker compose -f $(COMPOSE) stop kong

kong-logs:
	docker compose -f $(COMPOSE) logs -f kong

tidy:
	go mod tidy

proto:
	@echo "TODO: add buf/protoc generation for services/api"
