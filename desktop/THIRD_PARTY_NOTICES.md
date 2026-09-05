# DramaIP Desktop third-party notices

DramaIP Desktop is licensed under Apache-2.0. The application also distributes
third-party components under their own licenses. Release packages include the
corresponding notice and license material under `third-party-notices/`.

Bundled runtime components:

- Pi 0.84.2 — MIT License. Source snapshot: `vendor/pi`; packaged notice:
  `apps/desktop/pi-adapter/THIRD_PARTY_NOTICES.md`.
- OpenAI Codex CLI 0.147.0 — Apache-2.0. The pinned package license is copied
  to `apps/desktop/build/third-party-notices/` for packaging.
- LangGraph.js 1.4.9 and its active AI SDK dependencies — their pinned notices
  are recorded in
  `apps/desktop/build/third-party-notices/LangGraph-and-AI-SDK-NOTICES.md`.

Reference-only vendor snapshots under `vendor/` are not automatically bundled.
Their own license files remain authoritative for those sources.

The optional FFmpeg+x264 renderer is not part of DramaIP Desktop. It must be
installed by an explicit user action as a separately signed process and must
ship its own license, corresponding source offer, build recipe and artifact
manifest. No renderer is currently declared verified by this repository.
