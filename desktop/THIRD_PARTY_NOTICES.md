# DramaIP Desktop third-party notices

DramaIP Desktop is licensed under Apache-2.0. The application also distributes
third-party components under their own licenses. Release packages include the
corresponding notice and license material under `third-party-notices/`.

Bundled runtime components:

- Pi 1.4.0 — MIT License. Source snapshot: `../vendor/pi`; packaged notice:
  `apps/desktop/pi-adapter/THIRD_PARTY_NOTICES.md`.
- OpenAI Codex CLI 0.163.0 — Apache-2.0. The pinned package license is copied
  to `apps/desktop/build/third-party-notices/` for packaging.
- LangGraph.js 1.4.9 and its active AI SDK dependencies — their pinned notices
  are recorded in
  `apps/desktop/build/third-party-notices/LangGraph-and-AI-SDK-NOTICES.md`.

- DSH 0.2.1-rc.2 supplies nine MIT-licensed framework packages from the pinned
  `../vendor/deepseek-harness/vendor` source tree:
  `@deepseek-ai/cordis` 4.0.5, `@deepseek-ai/cosmokit` 1.8.6,
  `@deepseek-ai/schemastery` 3.18.5, `@deepseek-ai/cordis-plugin-loader` 1.0.6,
  `@deepseek-ai/cordis-plugin-include` 1.0.10, `@deepseek-ai/cordis-plugin-group` 1.0.5,
  `@deepseek-ai/cordis-plugin-timer` 1.1.7, `@deepseek-ai/cordis-plugin-hmr` 1.0.20,
  and `@deepseek-ai/cordis-plugin-logger-console` 1.0.5.
  Each unmodified source license is included at `runtime/framework/<package>/LICENSE`
  in the packaged application resources. Desktop's build manifests are generated
  separately; the vendor snapshot is not modified.

The optional FFmpeg+x264 renderer is not part of DramaIP Desktop. It must be
installed by an explicit user action as a separately signed process and must
ship its own license, corresponding source offer, build recipe and artifact
manifest. No renderer is currently declared verified by this repository.
