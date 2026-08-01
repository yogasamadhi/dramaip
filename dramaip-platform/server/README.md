# DramaIP Java Server (JDK 21)

Maven reactor modules are `common`, `migration`, `gateway`, and six independently deployable services in dependency order: `identity`, `support`, `creation`, `quota`, `ai`, `billing`.

Run all verification:

```bash
mvn -B -ntp verify
```

Only `migration` may execute Flyway. On an existing Go database it verifies a clean, contiguous `schema_migrations` 001–049 ledger and creates an explicit Flyway 49 baseline. On an empty database it reads the archived forward SQL from `LEGACY_MIGRATIONS_DIR`, then baselines at 49 and applies `V050+`. Production must not set `baselineOnMigrate`.

Every public Java request needs `X-DramaIP-Contract-Version: 2`; public responses use `Result<T>` with `code`, `message`, `data`, `requestId`, and `traceId`.
