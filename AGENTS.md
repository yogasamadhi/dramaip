# AGENTS.md

DramaIP: two independent subprojects plus root-level launchers and docs. `desktop` (Electron, local-first, open source) and `platform` (closed-source Java/Spring Cloud Alibaba cloud platform). Both must stay within their own directory boundaries.

## Toolchain pins (exact versions matter)

- Bun **1.3.14** exactly, for both JS workspaces (`desktop/`, `platform/clients/`). `run-desktop.py` hard-fails on any other Bun version.
- Node >= 22.12.0 (desktop; Electron ABI boundary) / >= 20 (platform clients, Expo Mobile).
- Platform server: JDK 21 + Maven 3.9+ (Spring Boot pinned to 4.0.6 in parent POM; never override in submodules).
- Both `bunfig.toml` files set `auto = "disable"`: `bun install` is never run implicitly — run it manually. Desktop uses `linker = "isolated"`, platform clients use `linker = "hoisted"` (Metro/Babel needs hoisting; don't "fix" either one).

## Commands

Desktop (`desktop/`):
- `python3 run-desktop.py` — one-shot dev startup (checks Bun/Node, patches Electron binary, rebuilds better-sqlite3, starts dev). Handles `ELECTRON_RUN_AS_NODE` stripping and Electron-binary repair that bare `bun run dev` does not.
- `bun run test` (typecheck + unit), `bun run test:e2e` (build + Playwright; needs a GUI — CI Linux wraps in `xvfb-run -a bunx playwright test`)
- Single test: `bunx playwright test tests/electron/<file>.spec.ts --reporter=list`, node tests: `node --import tsx --test packages/server/src/sidecar.node.test.ts`
- Native module: rebuild via `bun run rebuild` (root script -> electron-rebuild); bare `bun rebuild` does NOT work.
- Full quality gate (CI order): `lint` (oxlint `--deny-warnings`), `format:check` (prettier), `typecheck`, `test`, `check:generated`, `check:engine-locks`, `check:provider-catalog`, `build`.

Platform (`platform/`):
- `make test` (mvn verify + clients typecheck/test + `contracts:check` + `web-route-smoke`), `make platform-up` / `platform-e2e` / `platform-down` (Docker Compose, `--profile java`)
- Java only: `mvn -B -ntp verify` in `server/`
- Clients: `bun run lint`, `typecheck`, `contracts:check`, `test` in `clients/`
- Host-JDK debug mode: `python3 run-platform-dev.py` (runs services 8081–8087 on host, infra in Docker); clients: `python3 run-platform-clients.py`

Root Python launcher tests: `python3 -m unittest discover -s tests` (unittest-based; pytest is NOT installed — do not use it).

## Architecture gotchas

Desktop:
- Only ONE business channel: local HTTP `/api/v1` with per-launch random Basic Auth credentials. Electron IPC is a small whitelist (init/window/file capability/credential refs) — never add business data flows to IPC.
- `@sdns/client` is generated from Effect HttpApi/OpenAPI contracts. After contract changes run `bun run check:generated` (also covers ai-legacy).
- Database: new `dramaip.db` in userData (node:sqlite + Drizzle). Never read/migrate legacy `studio.db`; `db:push`/`db:generate` are intentional no-ops — migrations disabled for the fresh v3 DB.
- Provider catalog in `packages/schema/src/provider-catalog.ts` must stay in sync with the app version (`check:provider-catalog`). Engine binaries are locked: OpenCode 1.18.15 vendored in `vendor/opencode` (frozen — don't edit vendor code), Codex 0.147.0 hashed in `vendor/codex.lock.json` (`check:engine-locks`).
- Credentials: AES-256-GCM local file, not OS keychain; DB stores only `credentialRef`; Server must never log keys/paths.

Platform:
- Gateway (`localhost:8080`) is the only entry; business APIs are `/api/v1/**`, require header `X-DramaIP-Contract-Version: 2`, wrap responses in `Result<T>`.
- One authoritative writer implementation per business table; Flyway migrations are forward-only.
- Release: only via `python3 run-platform-cicd.py` (check/verify/release/rollback). It never runs `kubectl apply`/`helm upgrade` — Argo CD reconciles the GitOps `staging` branch. CI asserts exact row counts in `deploy/release/images.tsv` (9 Java + 1 web); update tests + CI together if manifest changes.

## Workflow

- Team process is Loop Engineering (`docs/loop/LOOPRULE.md`, active map `docs/loop/LOOPMAP.md`): one goal per `loop/<id>-<topic>` branch off `main`, merge back with `--no-ff`, push to remote before marking `done`, append execution records to the LOOPMAP, never use a `blocked` terminal state.
- Conventional commits with scopes, e.g. `feat(desktop):`, `fix(timeline):`, `docs(loop):`, `test(e2e):`.
- Git remote is Gitee (`gitee.com`), but CI is GitLab (`.gitlab-ci.yml`, harbor.home.arpa) — don't assume GitHub URLs or workflows.

## Stale references and dead dirs

- Root README mentions `run-platform.py` (does not exist — use `run-platform-dev.py` + `run-platform-clients.py`) and `docs/差异演进.md` / `docs/loop/LOOPMAP3.md` (missing). Docs cross-link to `desktop/docs/engineering/DEVELOPMENT.md` / `CONTRIBUTING.md`, which also don't exist.
- `desktop/legacy/`, `desktop/packages/core/`, `desktop/packages/export/` are non-workspace leftovers (no package.json, not in bun workspaces) — ignore, don't restore.

Architecture details: `docs/技术架构.md` (platform red lines), `desktop/docs/engineering/ARCHITECTURE.md` (desktop v3).
