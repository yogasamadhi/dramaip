# Java migration modes and cutover

- **legacy**: `docker compose up` uses the existing Go/Kong stack. It is the rollback configuration.
- **mixed**: run `docker compose --profile mixed up`; keep `/v1/**` on Kong/Go and direct only `/api/v1/**` to `java-gateway:8080` through the edge route.
- **java**: after every domain has a single Java writer, run `docker compose --profile java up` and route the edge directly to `java-gateway`.

Before each domain write cutover: disable that Go HTTP write route, Go consumer and Go job; wait for in-flight requests, outbox messages and TCC branches to drain; then enable the Java route, consumer and job through Nacos. Never dual-write a table.

Rollback: disable Java writes first, drain Java outbox/queues/TCC, verify data and correlation IDs, remove the Java edge route, then re-enable the corresponding Go writer. `V050+` must remain backward-compatible extensions until Go is fully retired.
