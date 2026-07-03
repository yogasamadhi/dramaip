# Release Candidate Draft

## Candidate

- Draft tag: `v1.0.0-rc.1`
- Draft date: 2026-07-03
- Release type: LOOPMAP2 desktop release candidate
- Publish target: manual release after CI package-smoke matrix is green

## RC Gate Results

Local gate results from the current macOS arm64 workstation:

| Gate | Command | Result |
| --- | --- | --- |
| Full test suite | `pnpm test` | Passed: typecheck, 115 unit tests, DB migration replay, DB smoke, Electron ABI restore |
| Electron E2E smoke | `pnpm test:e2e` | Passed: main workflow, Agent command plan, sample-study cards, revision adoption, submission export, project package roundtrip |
| Installer package smoke | `pnpm package:smoke` | Passed: macOS dmg/zip generated, packaged app launched, smoke DB initialized |
| Package boundary check | included in package smoke | Passed |
| Credential/account scan | targeted `git grep -n` for known account/token fragments | No tracked match after replacing account-specific examples with placeholders |
| Tracked artifact/env scan | `git ls-files -- '.env' '.env.*' 'apps/desktop/dist/**' 'apps/desktop/out/**' 'dist/**' 'out/**' 'release/**' '*.dmg' '*.zip' '*.AppImage' '*.deb' '*.rpm'` | No tracked match |

Generated local macOS artifacts:

- `apps/desktop/dist/短剧IP小说工作室-1.0.0-arm64.dmg`
- `apps/desktop/dist/短剧IP小说工作室-1.0.0-arm64-mac.zip`
- `apps/desktop/dist/latest-mac.yml`

Cross-platform release gate:

- The repository defines `pnpm package:smoke` for macOS, Windows, and Linux.
- Before cutting `v1.0.0-rc.1`, run the CI `package-smoke` matrix and require all three platforms to pass.

## Draft Release Notes

### Highlights

- Local-first writing workspace for Chinese short-drama novel projects.
- LOOPMAP2 main workflow guide for setup, characters, outline, chapters, quality gate, adaptation, scripts, shots, and video tasks.
- Agent command console turns natural-language instructions into reviewable execution plans for chapters, episodes, and shots.
- AI context transparency before generation, including section previews, token estimates, trimming notes, and manual pin/exclude controls.
- Local sample-study flow for `.md`, `.txt`, and `.docx` imports, chapter splitting, abstract structure extraction, and reusable creative cards.
- Inspiration desk for genre/template/sample/anti-trope/mobile-import cards, with explicit adoption into project settings or chapter requirements.
- Revision task loop from diagnosis to rewrite preview, explicit adoption, content versions, and recheck.
- Project Skills and project Agent schemes for reusable writing rules, Agent selection, model overrides, and visible context participation.
- Commercial exports: novel submission package, short-drama proposal package, episode delivery package, shot delivery Markdown/JSON/CSV, and project package v6.
- Video preproduction assets for casting, voice, cover, first-frame, narration, subtitle, and shot-linked reference material.
- Versioned SQLite migrations, startup backups, manual backup/restore, and project package import/export.
- Hardened IPC validation, file import limits, Electron CSP/external navigation rules, secret health checks, and diagnostic package export.
- Long-form consistency tools: chapter memories, character states, story events, foreshadowing, visual profiles, and settings.
- Creative diagnosis: freshness reports, anti-trope variants, revision tasks, quality gates, audience simulation, and narrative curve analysis.
- Full novel-to-video production chain: adaptation outlines, scripts, scene splitting, shots, prompt versions, video tasks, result comparison, and asset references.
- Reusable workflow templates, global search, task monitor, usage statistics, updated user guide, roadmap, and troubleshooting guide.

### Packaging Notes

- macOS local smoke builds unsigned/notarization-skipped artifacts when Apple credentials are absent.
- Formal macOS release must inject signing and notarization credentials through CI secrets.
- Automatic update metadata is generated, but runtime auto-update integration is still documented as future work.

### Known Caveats

- Mock video provider is intended for full-flow verification without real platform calls.
- OpenAI Sora and custom OpenAI-compatible video providers have concrete adapters; other named video platforms currently keep independent adapter slots and may return not-implemented errors until their APIs are wired.
- Project packages focus on structured project data; local absolute asset paths from another machine may import as missing unless a remote URL exists.
- Cloud sync, public resource marketplace, and cloud semantic search remain roadmap/design work. They are not required for this release candidate.
- Mobile support is limited to lightweight inspiration records imported into the desktop inspiration desk. Desktop remains the trusted write/adoption surface.

## Rollback Notes

- Keep the previous stable installer and update metadata available before publishing this RC.
- If a release issue is found before auto-update runtime exists, publish manual guidance that links users back to the previous stable installer and checksum.
- If update metadata has already been published, roll back by pointing `latest*.yml` to the previous stable version while preserving the bad artifact for audit.
- Do not downgrade users across an unknown SQLite schema boundary. If the previous binary cannot safely open the current schema, ship a hotfix build from this RC line instead.
- Project data remains local; ask users to create a manual backup from 「设置 → 数据与备份」 before installing or rolling back.

## Draft Tag Command

Run only after the cross-platform package-smoke CI matrix is green:

```bash
git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1"
git push origin v1.0.0-rc.1
```
