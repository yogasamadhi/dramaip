# Desktop2 architecture

## Hard boundaries

Electron Main owns windows, the custom protocol, credentials, file capabilities, system operations and child-process supervision. The server utility process owns SQLite and all business state. Renderer business traffic uses authenticated loopback HTTP `/api/v2`; IPC is never a business-data bus.

The server kernel creates one Cordis context, registers trusted builtins, applies a validated profile through the vendored Cordis Loader and rolls back failed startup. The renderer creates a separate Cordis context and uses a compile-time UI registry; it never executes the Node loader.

Profiles contain only builtin plugin IDs and JSON-compatible configuration. Package names, paths, environment interpolation, YAML JavaScript tags and runtime editing are rejected. Production always uses `studio`.

Every bounded-context plugin owns four public surfaces: `contracts`, `server`, `ui` and `migrations`. Cross-plugin implementation imports are forbidden. Collaboration happens through contract packages or typed Cordis services. HTTP routes are immutable contributions; the host rebuilds and atomically swaps the active Hono snapshot whenever a Cordis fiber is added or removed.

SQLite relational tables are authoritative. State changes and durable domain events are committed by one Unit of Work. Live token deltas, immediate progress and health signals are not persisted. Durable consumers advance independent checkpoints only after successful handling.

## Process topology and engine boundary

Electron Main starts one Server utility process and five independently supervised engine utility processes. Main is the only process that resolves encrypted credential references or engine/runtime paths. The Renderer receives neither value. Server-to-Main engine control is typed request/response or streamed event RPC; an unavailable selected engine fails explicitly and is never replaced by another engine.

The Agent plugin owns Studio sessions, runs, items, checkpoints, usage and state transitions. Engine adapters only create/generate/interrupt/resume/fork/dispose. A run-bound, read-only MCP claim limits each engine to one project/session/run, an expiry and a maximum result count. Every engine gets a different random Bearer token. The MCP endpoint exposes only project lookup and scoped search; DSH and Pi runtime profiles do not enable shell, filesystem, web, skill, subagent, workflow or engine persistence plugins.

OpenCode 1.18.15, Codex 0.147.0, DSH 0.1.0-rc.5, Pi 0.84.2 and LangGraph 0.2.43 are exact locks. DSH is built in a Desktop2-owned staging copy. Pi is bundled from the frozen vendored TypeScript source and lockfile. Local runtime manifests hash the complete DSH output tree and the Pi runtime bundle, and verification must not mutate those outputs.

## HTTP and concurrency

`/api/v2` uses per-launch Basic Auth plus a strict Renderer Origin allowlist. Zod OpenAPI routes are the contract source. Successful bodies are resources or cursor pages; failures are `application/problem+json`. Versioned mutation uses `If-Match`; external, costly or task-producing POSTs use `Idempotency-Key`. Durable and live events share `/api/v2/events`, but only durable events receive cursors and replay through `Last-Event-ID`.

Agent task transitions are enforced in the repository transaction. Late token, item, success or failure events cannot overwrite an interrupted run. Interrupt creates the checkpoint and durable event atomically; resume creates its new read-only claim and queued transition atomically.

## Bounded contexts

The first-party graph contains `system`, `workspace`, `writing`, `knowledge`, `automation`, `agents`, `production`, `creative-quality`, `media`, `timeline`, `review`, `delivery` and `insights`. Foundation services are infrastructure and are not business-context shortcuts. There is no global untyped `resources/:domain` API or cross-domain `domain_entities` table.

## Renderer design system and navigation

`@dramaip/ui` is Desktop2's independent Tailwind CSS 4 and Radix UI design system. It owns the light/dark tokens, controls, dialogs, drawers, menus, focus behavior and the `system | light | dark` theme contract persisted under `dramaip-theme-v1`. Core plugins depend on this package and never import `@sdns/ui` or any `desktop/packages` implementation.

The React Shell owns only the 64px application bar, project navigation host, route outlet, error boundary and assistant Drawer. Main, project and settings navigation entries are Cordis UI contributions; project IDs are resolved by the Shell at render time. Agents contributes assistant content through `shell.assistant`, but the Shell owns overlay, focus lock and Escape behavior. Writing and Knowledge continue to own their project pages and chapter auxiliary panels.

Electron Main accepts only the non-business `window:set-theme` IPC for visual synchronization. It updates the window background and native title-bar overlay without exposing business state to IPC. Production protocol handling normalizes nested-route asset requests so BrowserRouter deep links can be refreshed safely.

The locked Desktop reference manifest and Desktop2's reviewed light/dark snapshots cover projects, novel home, editor, knowledge, search, tasks, settings and the global assistant at 1440×920. `check:ui-parity` protects reference hashes, token contracts, navigation ownership and forbidden legacy chrome; Playwright applies a 1.5% maximum pixel-difference threshold and also checks 1080×700 and narrow-window behavior.

## Identity

- Product name: `DramaIP Studio`
- Application ID: `com.sdns.dramaip.next`
- User data directory: `DramaIP Studio Next`
- Update variable: `DRAMAIP_NEXT_UPDATE_URL`

## Parallel-track policy

`desktop` and `desktop2` are independent, actively maintained desktop products. Neither is a staging tree for the other, neither is frozen, and feature parity is not a prerequisite for either track to develop, package or release. They keep separate application identities, user data, build outputs and release channels. The only shared source boundary is the read-only `desktop/vendor` tree owned by `desktop`.

The pinned comparison snapshot inventories 181 `desktop` API paths, 15 UI routes and 32 scenario-level Electron journeys. It stabilizes the measurement reference without restricting subsequent `desktop` changes. `check:core-parity` is the release gate for this novel-writing and assistant scope; `check:parity` validates and reports wider comparison coverage without failing on open mappings, while `check:parity:strict` remains an opt-in full-product equivalence milestone.

Root launchers, CI jobs and release documentation must name the intended track explicitly. Reaching parity never triggers an automatic cutover, and changes in either track do not silently enter the other track's scope.
