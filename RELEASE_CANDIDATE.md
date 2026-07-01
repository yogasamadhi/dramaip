# Release Candidate Draft

## Candidate

- Draft tag: `v1.0.0-rc.1`
- Draft date: 2026-07-01
- Release type: desktop release candidate
- Publish target: manual release after CI package-smoke matrix is green

## RC Gate Results

Local gate results from the current macOS arm64 workstation:

| Gate | Command | Result |
| --- | --- | --- |
| Full test suite | `pnpm test` | Passed |
| Unpacked package smoke | `pnpm package:smoke:dir` | Passed |
| Installer package smoke | `pnpm package:smoke` | Passed |
| Package boundary check | included in package smoke | Passed |
| Credential/account scan | `git grep -n 'qq_connect_hkp' -- .` | No tracked match |
| Tracked artifact/env scan | `git ls-files \| rg '(^|/)(\\.env(\\..*)?\|dist/\|out/\|release/\|.*\\.(dmg\|zip\|AppImage\|deb\|rpm))$'` | No tracked match |

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
- Versioned SQLite migrations, startup backups, manual backup/restore, and project package import/export.
- Hardened IPC validation, file import limits, Electron CSP/external navigation rules, secret health checks, and diagnostic package export.
- Long-form consistency tools: chapter memories, character states, story events, foreshadowing, visual profiles, and settings.
- Creative diagnosis: freshness reports, anti-trope variants, revision tasks, quality gates, audience simulation, and narrative curve analysis.
- Full novel-to-video production chain: adaptation outlines, scripts, scene splitting, shots, prompt versions, video tasks, result comparison, and asset references.
- Reusable workflow templates, global search, task monitor, usage statistics, user guide, and troubleshooting guide.

### Packaging Notes

- macOS local smoke builds unsigned/notarization-skipped artifacts when Apple credentials are absent.
- Formal macOS release must inject signing and notarization credentials through CI secrets.
- Automatic update metadata is generated, but runtime auto-update integration is still documented as future work.

### Known Caveats

- Mock video provider is intended for full-flow verification without real platform calls.
- OpenAI Sora and custom OpenAI-compatible video providers have concrete adapters; other named video platforms currently keep independent adapter slots and may return not-implemented errors until their APIs are wired.
- Project packages focus on structured project data; local absolute asset paths from another machine may import as missing unless a remote URL exists.

## Draft Tag Command

Run only after the cross-platform package-smoke CI matrix is green:

```bash
git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1"
git push origin v1.0.0-rc.1
```
