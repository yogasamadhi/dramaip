# Legacy backend

`go-services/` is the frozen Go/Kratos backend baseline that existed before the
Java migration. It includes the old application code, protobuf contracts,
event schemas, SQL migrations, build scripts, and tests so behavior can be
reproduced during the strangler migration.

Rules:

- No new product feature is implemented here.
- Only compatibility, security, or cutover-blocking fixes are accepted.
- Every fix must be ported to the owning Java service or explicitly recorded as
  not applicable.
- The directory is removed only after all traffic, events, jobs, rollback
  windows, and audit requirements have moved to Java.

Run the legacy tests from `go-services/`:

```bash
go test ./...
```
