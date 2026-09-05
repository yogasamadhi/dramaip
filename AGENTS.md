# AGENTS.md

DramaIP: two independent subprojects plus root-level launchers and docs. `desktop` (Electron, local-first, open source) and `platform` (closed-source Java/Spring Cloud Alibaba cloud platform). Both must stay within their own directory boundaries.

## Toolchain pins (exact versions matter)

- Bun **1.4.0** exactly for both JS workspaces (`desktop/`, `platform/clients/`): package managers, CI images and launchers must reject every other Bun version.
- Desktop install/dev/build/test/codegen/package and Headless/Server use Bun only; no system Node is allowed. Desktop-mode Runtime, Extension Host, migration worker and Agent sidecars use Electron's embedded Node. Platform clients independently require Node >= 20 and CI pins 24.18.0.
- Platform server: JDK 21 + Maven 3.9+ (Spring Boot pinned to 4.0.6 in parent POM; never override in submodules).
- Both `bunfig.toml` files set `auto = "disable"`: `bun install` is never run implicitly — run it manually. Desktop uses `linker = "isolated"`, platform clients use `linker = "hoisted"` (Metro/Babel needs hoisting; don't "fix" either one).

## Commands

Desktop (`desktop/`):

- `bun run-desktop.ts` — one-shot dev startup from the repo root (checks Bun 1.4.0 exactly, installs deps, builds agent runtimes, repairs the Electron binary and starts dev; strips `ELECTRON_RUN_AS_NODE`). `desktop`'s own `dev` script delegates to it. Options: `--check`, `--install`, `--rebuild-engines`.
- `bun run test` (typecheck + unit), `bun run test:e2e` (build + Playwright; needs a GUI — CI Linux wraps the Bun-owned Electron Playwright launcher in `xvfb-run`)
- Single test: `bun scripts/run-electron-playwright.ts test tests/electron/<file>.spec.ts --reporter=list`; runtime unit suites run via `bun run test:runtime` under Bun, while Electron E2E is the embedded-Node acceptance gate. Do not use `bunx` for JS CLIs because it may select a system Node.
- SQLite uses `bun:sqlite` in Headless/Server and `node:sqlite` in Electron utility processes; do not reintroduce `better-sqlite3` or a system-Node ABI rebuild step.
- Full quality gate (CI order): `lint` (oxlint `--deny-warnings`), `format:check` (prettier), `typecheck`, `test`, `check:architecture`, `check:generated`, `check:migration:complete`, `check:engine-locks`, `check:provider-catalog`, `check:extension-packages`, `check:renderer-chunks`, `check:timeline-exports`, `build`; tag jobs then add `test:e2e`, `package`, `release:metadata`.

Platform (`platform/`):

- `make test` (mvn verify + clients typecheck/test + `contracts:check` + `web-route-smoke`), `make platform-up` / `platform-e2e` / `platform-down` (Docker Compose, `--profile java`). CI reuses packaged JARs via `make platform-ci-e2e`, assigns random host ports, and cleans with `make platform-ci-down`.
- Java only: `mvn -B -ntp verify` in `server/`
- Clients: `bun run lint`, `typecheck`, `contracts:check`, `test` in `clients/` (CI also runs `build:web` + `build:admin`; `test` includes a mobile security test). The clients workspace also compiles/tests the root `run-platform-dev.ts` / `run-platform-clients.ts` launchers via its `typecheck:launchers` / `test:launchers` scripts.
- Host-JDK debug mode: `bun run run-platform-dev.ts` (runs services 8081–8087 on host, infra in Docker); clients: `bun run run-platform-clients.ts`

Root Python launcher and release-script tests: `python3 -m unittest discover -s tests` (unittest-based; pytest is NOT installed — do not use it). `test_run_platform_dev.py` asserts the installed Bun is exactly 1.4.0 and fails on every other version.

## Architecture gotchas

### Desktop Client / Plugin Runtime

`docs/architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` is the accepted target architecture and takes precedence for `desktop/` design decisions. Preserve the mature product/UI/E2E/security baseline, but replace its old technical architecture. Implement only in `desktop/`; `desktop/legacy/desktop2` is a pattern reference, never a build or runtime dependency. Do not create `desktop3`.

- Process boundary: `Desktop/Web/CLI Client → HTTP (/api/v2, REST/JSON/SSE/OpenAPI, Bearer auth) → independent Core Runtime → HTTP (/host/v1) → Electron Desktop Host → EngineSupervisor`. Renderer business IPC and Renderer direct `fetch` are forbidden; preload exposes only immutable Runtime bootstrap metadata. Electron Main supervises windows, Runtime, Host, updater and vendor processes — it is not a business Runtime.
- Core Runtime must start and test without Electron, support Desktop and Server/Headless modes, and all clients connect via `ServerConnectionManager` (`discover → attach/spawn → authenticate/negotiate → ready/reconnect`). Headless/Server uses Bun; Desktop uses Electron `utilityProcess` and reports `electron-node`. Keep runtime-specific APIs behind adapters and never require a system Node executable.
- Runtime composition is `Plugin → Bundle → Product Profile (+ Installed Extension Set) → Effective Runtime Graph`. Bundles only compose/depend/configure and never own business state. Profiles reference bundles, not copied plugin lists. Keep Kernel minimal: graph/lifecycle/capabilities/events/migrations/diagnostics/effect tracking, never domain business logic.
- First-party bounded-context plugins own their contracts, server/UI contributions and forward-only migrations: `foundation`, `system`, `workspace`, `automation`, `writing`, `knowledge`, `agents`, `creative-quality`, `production`, `media`, `timeline`, `review`, `delivery`, `insights` (plus `legacy-bridge`, the sole migration-era plugin). Plugins may depend only on stable contracts, typed services, capabilities or events — never another plugin's implementation.
- Every long-lived route, service, event handler, timer, watcher, command, UI contribution or background task must use tracked `ctx.effect()` cleanup. Activation failure, unload and reload unwind effects in reverse order. No untracked long-lived side effects.
- Runtime APIs use RFC 7807 Problem Details, ETag/If-Match, Idempotency-Key, cursor pagination and fetch-based SSE with replay. Build the effective OpenAPI and generated `@dramaip/client`; after contract changes run `bun run check:generated`. Do not add new `@sdns/*`, Effect HttpApi, `/api/v1`, handwritten legacy clients, central domain routers or compatibility bridges.
- SQLite/Drizzle tables have exactly one plugin owner. Migrations are ledgered by plugin/version/dependency/checksum and are forward-only. Persistent domain state and events share a transaction; realtime health/progress/token events are non-persistent. Never auto-import legacy database contents: use the documented cutover backup process.
- Desktop Host is capability-based. File paths and credential plaintext never reach Renderer, Runtime DB, logs or diagnostics; Renderer sees only opaque grants/`credentialRef`. In Headless/Web mode desktop capabilities return structured `CapabilityUnavailable`, not startup failure.
- The active Agent Engines are Pi, Codex and LangGraph.js. Keep them under `EngineSupervisor` with `availability/create/prompt/steer/abort/resume/fork/subscribe/dispose/health` and the persisted `Session → Run → Item` model. Pi is the default signed first-party utility-process harness; Codex (native stdio/app-server) and LangGraph.js (Electron utility-process prompt/validation graph) are external benchmark engines. Unsupported native features return structured `UnsupportedOperation`; never silently fall back. Core Runtime owns workflow, checkpoints, events, capability grants, Preview/Commit, retry and idempotency; an engine owns reasoning, model interaction, tools and session execution. LangGraph.js is an Engine baseline, not the Core Runtime workflow runtime, and it does not run an autonomous model-tool loop.
- Third-party code must not run in Core Runtime or the main Renderer. The future public SDK exposes only `@dramaip/plugin-api` public exports plus `@dramaip/contracts`; raw SQLite, Cordis internals, Runtime internals and Electron Main are forbidden. Until Extension Host + manifest/permission/trust/compatibility enforcement exist, do not load third-party plugins.
- `@dramaip/agent-runtime` is the vendor-neutral contract and must not expose Electron, SQLite, Hono, Cordis or vendor types. The agents plugin reaches engines only through Host HTTP. OpenCode and DeepSeek Harness are read-only vendor/reference material. LangGraph.js is active only as an external benchmark Engine and must never become the Core Runtime workflow runtime. Preserve the Provider Catalog version check. Active locks are Pi 0.84.2, Codex 0.147.0 and LangGraph.js 1.4.9; reference snapshots retain integrity checks. Run `check:engine-locks` and `check:provider-catalog` when relevant.

For Runtime work, also run `bun run test:runtime`, `bun run check:architecture` (including the no-system-Node gate), `bun run check:migration:complete`, and the normal quality gate. Full Electron E2E is the `electron-node` product acceptance gate; do not use empty routes or generic CRUD UI as migration-complete evidence.

Platform:

- Gateway (`localhost:8080`) is the only entry; business APIs are `/api/v1/**`, require header `X-DramaIP-Contract-Version: 2`, wrap responses in `Result<T>`. `server/` is a Maven reactor (`common`, `architecture`, `gateway`, `migration` + `services/{identity,notification,reporting,creation,quota,ai,billing}`) whose modules map 1:1 to the `images.tsv` java rows.
- One authoritative writer implementation per business table; Flyway migrations are forward-only (per `docs/后端技术架构.md`; global sequence, no `baselineOnMigrate` in production).
- Release tooling lives in `platform/deploy/release/*.sh`: `preflight.sh` must run from a clean `main` branch, then an approved operator invokes `helm-release.sh <staging|production> <apply|rollback>`. `check-manifest.sh` is the one authoritative validation for the 9 Java + 1 Web image inventory and is reused by CI/build/scan/push/Helm. Refresh pinned Trivy databases explicitly with `update-trivy-db.sh` before scanning. GitLab runs the full Compose journey as a blocking MR/main job on a private Docker-capable Runner.

## Workflow

- Loop mode is opt-in only: do not read, apply, or infer `docs/loop/LOOPRULE.md`; do not create `loop/*` branches or Loop records unless the user explicitly says to enable Loop mode. Otherwise use the normal task workflow and ordinary Git practices.
- Conventional commits with scopes, e.g. `feat(desktop):`, `fix(timeline):`, `docs(desktop):`, `test(e2e):`.
- Git remote is Gitee (`gitee.com`), but CI is GitLab (`.gitlab-ci.yml`, harbor.home.arpa) — don't assume GitHub URLs or workflows.

## Archived and non-workspace sources

- `desktop/legacy/` is archived and never enters a build or runtime dependency. Its historical applications may be read only as architecture-pattern references; do not restore or import their code. There is no supported root launcher for archived apps. `desktop/packages/schema/` (`@dramaip/product-contracts-internal`) is a non-workspace leftover — it is not in `desktop/package.json`'s workspaces and never builds.
- `desktop/vendor/{pi,codex-rust,deepseek-harness,opencode}` are git submodules (submodule URLs point at GitHub while the remote is Gitee) — fresh clones need `git submodule update --init`; vendor content is read-only reference/integrity material, only Pi is packaged into the runtime.

Architecture details: `docs/后端技术架构.md` (platform red lines), `docs/architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` (desktop target architecture), `desktop/docs/engineering/ARCHITECTURE.md` (desktop implementation notes).
