# AGENTS.md

DramaIP: two independent subprojects plus root-level launchers and docs. `desktop` (Electron, local-first, open source) and `platform` (closed-source Java/Spring Cloud Alibaba cloud platform). Both must stay within their own directory boundaries.

## Toolchain pins (exact versions matter)

- Bun **1.3.14** exactly, for both JS workspaces (`desktop/`, `platform/clients/`). `run-desktop.ts` hard-fails on any other Bun version.
- Node >= 22.12.0 (desktop; Electron ABI boundary) / >= 20 (platform clients, Expo Mobile).
- Platform server: JDK 21 + Maven 3.9+ (Spring Boot pinned to 4.0.6 in parent POM; never override in submodules).
- Both `bunfig.toml` files set `auto = "disable"`: `bun install` is never run implicitly — run it manually. Desktop uses `linker = "isolated"`, platform clients use `linker = "hoisted"` (Metro/Babel needs hoisting; don't "fix" either one).

## Commands

Desktop (`desktop/`):

- `bun run-desktop.ts` — one-shot dev startup (checks Bun/Node, patches Electron binary, rebuilds better-sqlite3, starts dev). Handles `ELECTRON_RUN_AS_NODE` stripping and Electron-binary repair that bare `bun run dev` does not.
- `bun run test` (typecheck + unit), `bun run test:e2e` (build + Playwright; needs a GUI — CI Linux wraps in `xvfb-run -a bunx playwright test`)
- Single test: `bunx playwright test tests/electron/<file>.spec.ts --reporter=list`, node tests: `node --import tsx --test packages/server/src/sidecar.node.test.ts`
- Native module: rebuild via `bun run rebuild` (root script -> electron-rebuild); bare `bun rebuild` does NOT work.
- Full quality gate (CI order): `lint` (oxlint `--deny-warnings`), `format:check` (prettier), `typecheck`, `test`, `check:generated`, `check:engine-locks`, `check:provider-catalog`, `build`.

Platform (`platform/`):

- `make test` (mvn verify + clients typecheck/test + `contracts:check` + `web-route-smoke`), `make platform-up` / `platform-e2e` / `platform-down` (Docker Compose, `--profile java`)
- Java only: `mvn -B -ntp verify` in `server/`
- Clients: `bun run lint`, `typecheck`, `contracts:check`, `test` in `clients/`
- Host-JDK debug mode: `bun run run-platform-dev.ts` (runs services 8081–8087 on host, infra in Docker); clients: `bun run run-platform-clients.ts`

Root Python launcher tests: `python3 -m unittest discover -s tests` (unittest-based; pytest is NOT installed — do not use it).

## Architecture gotchas

### Desktop Client / Plugin Runtime

`docs/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` is the accepted target architecture and takes precedence for `desktop/` design decisions. Preserve the mature product/UI/E2E/security baseline, but replace its old technical architecture. Implement only in `desktop/`; `desktop/legacy/desktop2` is a pattern reference, never a build or runtime dependency. Do not create `desktop3`.

- Process boundary: `Desktop/Web/CLI Client → HTTP (/api/v2, REST/JSON/SSE/OpenAPI, Bearer auth) → independent Core Runtime → HTTP (/host/v1) → Electron Desktop Host → EngineSupervisor`. Renderer business IPC and Renderer direct `fetch` are forbidden; preload exposes only immutable Runtime bootstrap metadata. Electron Main supervises windows, Runtime, Host, updater and vendor processes — it is not a business Runtime.
- Core Runtime must start and test without Electron, support Desktop and Server/Headless modes, and all clients connect via `ServerConnectionManager` (`discover → attach/spawn → authenticate/negotiate → ready/reconnect`). Node is the required default; Bun support is declared only when the shared conformance suite passes. Keep Node/Bun-specific APIs behind Runtime Adapters.
- Runtime composition is `Plugin → Bundle → Product Profile (+ Installed Extension Set) → Effective Runtime Graph`. Bundles only compose/depend/configure and never own business state. Profiles reference bundles, not copied plugin lists. Keep Kernel minimal: graph/lifecycle/capabilities/events/migrations/diagnostics/effect tracking, never domain business logic.
- First-party bounded-context plugins own their contracts, server/UI contributions and forward-only migrations: `foundation`, `system`, `workspace`, `automation`, `writing`, `knowledge`, `agents`, `creative-quality`, `production`, `media`, `timeline`, `review`, `delivery`, `insights`. Plugins may depend only on stable contracts, typed services, capabilities or events — never another plugin's implementation.
- Every long-lived route, service, event handler, timer, watcher, command, UI contribution or background task must use tracked `ctx.effect()` cleanup. Activation failure, unload and reload unwind effects in reverse order. No untracked long-lived side effects.
- Runtime APIs use RFC 7807 Problem Details, ETag/If-Match, Idempotency-Key, cursor pagination and fetch-based SSE with replay. Build the effective OpenAPI and generated `@dramaip/client`; after contract changes run `bun run check:generated`. Do not add new `@sdns/*`, Effect HttpApi, `/api/v1`, handwritten legacy clients, central domain routers or compatibility bridges.
- SQLite/Drizzle tables have exactly one plugin owner. Migrations are ledgered by plugin/version/dependency/checksum and are forward-only. Persistent domain state and events share a transaction; realtime health/progress/token events are non-persistent. Never auto-import legacy database contents: use the documented cutover backup process.
- Desktop Host is capability-based. File paths and credential plaintext never reach Renderer, Runtime DB, logs or diagnostics; Renderer sees only opaque grants/`credentialRef`. In Headless/Web mode desktop capabilities return structured `CapabilityUnavailable`, not startup failure.
- The only active Agent Engines are Pi, Codex and Grok Build. Keep them under `EngineSupervisor` with `availability/create/prompt/steer/abort/resume/fork/subscribe/dispose/health` and the persisted `Session → Run → Item` model. Pi is the default signed first-party utility-process harness; Codex (native stdio/app-server) and Grok Build (native ACP) are external benchmark engines. Unsupported native features return structured `UnsupportedOperation`; never silently fall back. Core Runtime owns workflow, checkpoints, events, capability grants, Preview/Commit, retry and idempotency; an engine owns reasoning, model interaction, tools and session execution.
- Third-party code must not run in Core Runtime or the main Renderer. The future public SDK exposes only `@dramaip/plugin-api` public exports plus `@dramaip/contracts`; raw SQLite, Cordis internals, Runtime internals and Electron Main are forbidden. Until Extension Host + manifest/permission/trust/compatibility enforcement exist, do not load third-party plugins.
- `@dramaip/agent-runtime` is the vendor-neutral contract and must not expose Electron, SQLite, Hono, Cordis or vendor types. The agents plugin reaches engines only through Host HTTP. OpenCode and DeepSeek Harness are read-only vendor/reference material; LangGraph is not an active engine or workflow runtime. Preserve the Provider Catalog version check. Active locks are Pi 0.84.2, Codex 0.147.0 and Grok Build 1.0.5; reference snapshots retain integrity checks. Run `check:engine-locks` and `check:provider-catalog` when relevant.

For Runtime work, also run `bun run test:runtime` (Node and Bun), `bun run check:architecture`, and the normal quality gate. Full Electron E2E remains the product acceptance gate; do not use empty routes or generic CRUD UI as migration-complete evidence.

Platform:

- Gateway (`localhost:8080`) is the only entry; business APIs are `/api/v1/**`, require header `X-DramaIP-Contract-Version: 2`, wrap responses in `Result<T>`.
- One authoritative writer implementation per business table; Flyway migrations are forward-only.
- Release: only via `python3 run-platform-cicd.py` (check/verify/release/rollback). It never runs `kubectl apply`/`helm upgrade` — Argo CD reconciles the GitOps `staging` branch. CI asserts exact row counts in `deploy/release/images.tsv` (9 Java + 1 web); update tests + CI together if manifest changes.

## Workflow

- Loop mode is opt-in only: do not read, apply, or infer `docs/loop/LOOPRULE.md`; do not create `loop/*` branches or Loop records unless the user explicitly says to enable Loop mode. Otherwise use the normal task workflow and ordinary Git practices.
- Conventional commits with scopes, e.g. `feat(desktop):`, `fix(timeline):`, `docs(desktop):`, `test(e2e):`.
- Git remote is Gitee (`gitee.com`), but CI is GitLab (`.gitlab-ci.yml`, harbor.home.arpa) — don't assume GitHub URLs or workflows.

## Stale references and dead dirs

- Root README mentions `run-platform.py` (does not exist — use `run-platform-dev.ts` + `run-platform-clients.ts`) and `docs/差异演进.md` (missing). Docs cross-link to `desktop/docs/engineering/DEVELOPMENT.md` / `CONTRIBUTING.md`, which also don't exist.
- `desktop/legacy/` is archived and never enters a build or runtime dependency. `desktop/legacy/desktop2` may be read only as an architecture-pattern reference; do not restore or import its code. `desktop/packages/core/` and `desktop/packages/export/` are non-workspace leftovers.

Architecture details: `docs/技术架构.md` (platform red lines), `docs/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` (desktop target architecture), `desktop/docs/engineering/ARCHITECTURE.md` (desktop implementation notes).
