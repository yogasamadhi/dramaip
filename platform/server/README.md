# DramaIP Java Server (JDK 21)

This server provides optional cloud capabilities for the canonical [DramaIP product positioning](../../docs/product/POSITIONING.md), including identity, subscriptions, collaboration, review, operations, and cross-client APIs. It does not replace Desktop as the local authoritative creation environment or redefine the product as a cloud content generator.

Maven reactor modules are `common`, `migration`, `gateway`, and seven independently deployable services in dependency order: `identity`, `notification`, `reporting`, `creation`, `quota`, `ai`, `billing`.

Run all verification:

```bash
mvn -B -ntp verify
```

Only `migration` may execute Flyway. It verifies a clean, contiguous `schema_migrations` 001–049 ledger and creates an explicit Flyway 49 baseline. On an empty database it reads the retained forward SQL from `HISTORICAL_MIGRATIONS_DIR`, then baselines at 49 and applies `V050+`. Local launchers set `HISTORICAL_MIGRATIONS_APPLY_PENDING=true` so an older, clean development ledger can transactionally resume through 049; production leaves it false and must arrive with the complete ledger. Production must not set `baselineOnMigrate`.

Every public Java request needs `X-DramaIP-Contract-Version: 2`; public responses use `Result<T>` with `code`, `message`, `data`, `requestId`, and `traceId`.
