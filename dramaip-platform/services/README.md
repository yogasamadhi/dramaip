# DramaIP Services

Go/Kratos monorepo for the closed-source cloud platform.

## Layout

```txt
api/       Proto contracts and generated code targets
app/       Runnable Kratos apps
pkg/       Project-specific shared Go code
migrations PostgreSQL migrations by service schema
```

Each runnable app follows:

```txt
app/<domain>/<type>/
  cmd/server/
  configs/
  internal/
    conf/
    server/
    service/
    biz/
    data/
```

`service` is a synchronous domain service, `job` is a domain-owned async worker, and `interface` is a frontend-facing BFF.
