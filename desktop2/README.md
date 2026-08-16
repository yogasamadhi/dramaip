# DramaIP Studio Next

`desktop2` is the greenfield, plugin-first desktop application. It is an independent, actively maintained product track alongside `desktop`; neither desktop track is frozen or scheduled to replace the other. `desktop2` does not import runtime code from `desktop/apps` or `desktop/packages`.

The only shared source is the read-only engine and Cordis vendor tree in `../desktop/vendor`. First-party code uses Electron, vendored Cordis, Hono, Zod, Drizzle and SQLite. Effect is forbidden outside the shared OpenCode vendor implementation.

## Current product scope

The release-blocking `studio` profile is a complete novel-writing and assistant loop: project creation and packages, source import, chapters and immutable versions, characters/outlines/Story Bible, change previews, conversations, deterministic creation tasks, five isolated engines, interruption/resume and blind comparison. Adaptation, production, media, timeline, review, delivery and insights remain source-only future contexts and are deliberately absent from the production profile, routes and navigation.

## Commands

- `bun install` — install dependencies (Bun 1.3.14 exactly).
- `bun run dev` — start the Electron development app.
- `bun run check` — run the local quality gate.
- `bun run check:core-parity` — verify the release-blocking novel and assistant contract, UI-route and scenario ledger.
- `bun run check:ui-parity` — verify the independent design system, plugin navigation contract and locked Desktop visual references.
- `bun run check:runtimes` — hash-verify prepared OpenCode, Codex, DSH and Pi runtimes for the host platform.
- `bun run test:e2e` — run Electron journeys.
- `bun run package` — build the independent `DramaIP-Studio-Next-*` package.
- `bun run check:parity` — report and validate comparison coverage against the pinned snapshot; open items are non-blocking.
- `bun run check:parity:strict` — optional feature-equivalence gate; it fails while mapped comparison items remain open.

`desktop` continues to own the shared read-only vendor tree and evolves independently. The hash-verified [`docs/parity/baseline-inventory.json`](docs/parity/baseline-inventory.json) is only a stable comparison snapshot for selective capability convergence; it does not freeze `desktop`, block either track's release or imply a future cutover. Capture a deliberately selected new snapshot when comparison scope needs to change instead of silently regenerating it from the latest `desktop` tree.

Packaging prepares and verifies native OpenCode, Codex, DSH and Pi runtimes before invoking Electron Builder. Run the same `bun run package` gate on native macOS, Windows and Linux runners; a package made on one host is not treated as proof for the other platforms. Local packaging never publishes, while the separate release publisher must provide `DRAMAIP_NEXT_UPDATE_URL`.
