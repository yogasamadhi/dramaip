# DramaIP Desktop third-party notices

DramaIP Desktop is licensed under Apache-2.0. The application also distributes
third-party components under their own licenses. Release packages include the
corresponding notice and license material under `third-party-notices/`.

Bundled runtime components:

- Pi 1.5.0 — MIT License. Source snapshot: `vendor/pi`; packaged notice:
  `apps/desktop/pi-adapter/THIRD_PARTY_NOTICES.md`.
- Tailwind CSS 4.1 — MIT License (Copyright (c) Tailwind Labs, Inc.). The
  theme and base layers at the top of `packages/app/src/styles.css`, and the
  rules in the app's per-file `*.module.css` files, are Tailwind output
  frozen when the app's utility classes moved into CSS Modules; Tailwind
  itself is no longer a dependency.

- DSH 0.2.2-alpha.3 supplies nine MIT-licensed framework packages from the pinned
  `vendor/deepseek-harness/vendor` source tree:
  `@deepseek-ai/cordis` 4.0.6-alpha.2, `@deepseek-ai/cosmokit` 1.8.7-alpha.2,
  `@deepseek-ai/schemastery` 3.18.6-alpha.2, `@deepseek-ai/cordis-plugin-loader` 1.0.7-alpha.2,
  `@deepseek-ai/cordis-plugin-include` 1.0.11-alpha.2, `@deepseek-ai/cordis-plugin-group` 1.0.6-alpha.2,
  `@deepseek-ai/cordis-plugin-timer` 1.1.8-alpha.2, `@deepseek-ai/cordis-plugin-hmr` 1.0.21-alpha.2,
  and `@deepseek-ai/cordis-plugin-logger-console` 1.0.6-alpha.2.
  Each unmodified source license is included at `runtime/framework/<package>/LICENSE`
  in the packaged application resources. Desktop's build manifests are generated
  separately; the vendor snapshot is not modified.

- DSH 0.2.1-rc.3 is also the source of the app-owned infrastructure and launcher
  packages below. Their sources and tests were copied from the pinned
  `vendor/deepseek-harness` tree and adapted for DramaIP. Each package keeps
  the upstream MIT `LICENSE` (Copyright (c) 2026 DeepSeek), adds a `NOTICE`,
  and records its source in `package.json` `dramaip.copiedFrom`. Run
  `pnpm run check:licenses -- --files` to list every copied file and its source.
  - `@dramaip/infra-app-boot` ← `@deepseek-ai/dsh-app-boot` (`packages/boot/app-boot`)
  - `@dramaip/infra-atomic-write` ← `@deepseek-ai/dsh-atomic-write` (`packages/util/atomic-write`)
  - `@dramaip/infra-brand` ← `@deepseek-ai/dsh-brand` (`packages/util/brand`)
  - `@dramaip/infra-client-hmr` ← `@deepseek-ai/dsh-client-hmr` (`packages/client/hmr`)
  - `@dramaip/infra-client-modules` ← `@deepseek-ai/dsh-client-modules` (`packages/client/modules`)
  - `@dramaip/infra-client-shortcuts` ← `@deepseek-ai/dsh-client-shortcuts` (`packages/client/shortcuts`)
  - `@dramaip/infra-client-store` ← `@deepseek-ai/dsh-client-store` (`packages/client/store`)
  - `@dramaip/infra-client-web` ← `@deepseek-ai/dsh-client-web` (`packages/client/web`)
  - `@dramaip/infra-cmdline` ← `@deepseek-ai/dsh-cmdline` (`packages/boot/cmdline`)
  - `@dramaip/infra-code-language` ← `@deepseek-ai/dsh-util-code-language` (`packages/util/code-language`)
  - `@dramaip/infra-config-editor` ← `@deepseek-ai/dsh-config-editor` (`packages/boot/config-editor`)
  - `@dramaip/infra-connection` ← `@deepseek-ai/dsh-client-connection` (`packages/client/connection`)
  - `@dramaip/infra-credentials` ← `@deepseek-ai/dsh-credentials` (`packages/credentials/credentials`)
  - `@dramaip/infra-credentials-local` ← `@deepseek-ai/dsh-credentials-local` (`packages/credentials/credentials-local`)
  - `@dramaip/infra-deque` ← `@deepseek-ai/dsh-deque` (`packages/util/deque`)
  - `@dramaip/infra-frontend-static` ← `@deepseek-ai/dsh-host-frontend-static` (`packages/host/frontend-static`)
  - `@dramaip/infra-gateway` ← `@deepseek-ai/dsh-api-gateway` (`packages/api/gateway`)
  - `@dramaip/infra-hmr` ← `@deepseek-ai/dsh-hmr` (`packages/boot/hmr`)
  - `@dramaip/infra-home-paths` ← `@deepseek-ai/dsh-home-paths` (`packages/util/home-paths`)
  - `@dramaip/infra-http-proxy` ← `@deepseek-ai/dsh-http-proxy` (`packages/util/http-proxy`)
  - `@dramaip/infra-launch-environment` ← `@deepseek-ai/dsh-launch-environment` (`packages/util/launch-environment`)
  - `@dramaip/infra-lazy-require` ← `@deepseek-ai/dsh-lazy-require` (`packages/util/lazy-require`)
  - `@dramaip/infra-locale` ← `@deepseek-ai/dsh-client-locale` (`packages/client/locale`)
  - `@dramaip/infra-package-manifest` ← `@deepseek-ai/dsh-package-manifest` (`packages/util/package-manifest`)
  - `@dramaip/infra-remote-access` ← `@deepseek-ai/dsh-api-remote-access` (`packages/api/remote-access`)
  - `@dramaip/infra-remote-mock` ← `@deepseek-ai/dsh-remote-mock` (`packages/test-support/remote-mock`)
  - `@dramaip/infra-remotes` ← `@deepseek-ai/dsh-api-remotes` (`packages/api/remotes`)
  - `@dramaip/infra-scope` ← `@deepseek-ai/dsh-scope` (`packages/core/scope`)
  - `@dramaip/infra-settings` ← `@deepseek-ai/dsh-settings` (`packages/settings/settings`)
  - `@dramaip/infra-settings-controller` ← `@deepseek-ai/dsh-api-settings-controller` (`packages/api/settings-controller`)
  - `@dramaip/infra-storage` ← `@deepseek-ai/dsh-storage` (`packages/storage/storage`)
  - `@dramaip/infra-storage-domain` ← `@deepseek-ai/dsh-storage-domain` (`packages/storage/storage-domain`)
  - `@dramaip/infra-storage-sqlite` ← `@deepseek-ai/dsh-storage-sqlite` (`packages/storage/storage-sqlite`)
  - `@dramaip/infra-subprocess` ← `@deepseek-ai/dsh-subprocess` (`packages/subprocess/subprocess`)
  - `@dramaip/infra-subprocess-local` ← `@deepseek-ai/dsh-subprocess-local` (`packages/subprocess/subprocess-local`)
  - `@dramaip/infra-test-runtime` ← `@deepseek-ai/dsh-client-test-runtime` (`packages/test-support/client-runtime`)
  - `@dramaip/infra-timeout` ← `@deepseek-ai/dsh-timeout` (`packages/util/timeout`)
  - `@dramaip/infra-typert-generator` ← `@deepseek-ai/dsh-typert-generator` (`packages/typert/generator`)
  - `@dramaip/infra-typert-loader` ← `@deepseek-ai/dsh-typert-loader` (`packages/typert/loader`)
  - `@dramaip/infra-typert-protocol` ← `@deepseek-ai/dsh-typert-protocol` (`packages/typert/protocol`)
  - `@dramaip/infra-typert-registry` ← `@deepseek-ai/dsh-typert-registry` (`packages/typert/registry`)
  - `@dramaip/infra-ui-layout` ← `@deepseek-ai/dsh-client-ui-layout` (`packages/client/ui-layout`)
  - `@dramaip/infra-ui-primitives` ← `@deepseek-ai/dsh-client-ui-primitives` (`packages/client/ui-primitives`)
  - `@dramaip/infra-ui-renderer` ← `@deepseek-ai/dsh-client-ui-renderer` (`packages/client/ui-renderer`)
  - `@dramaip/infra-ui-settings` ← `@deepseek-ai/dsh-client-ui-settings` (`packages/client/ui-settings`)
  - `@dramaip/infra-ui-slots` ← `@deepseek-ai/dsh-client-ui-slots` (`packages/client/ui-slots`)
  - `@dramaip/infra-ui-theme` ← `@deepseek-ai/dsh-client-ui-theme` (`packages/client/ui-theme`)
  - `@dramaip/infra-util-crypto` ← `@deepseek-ai/dsh-util-crypto` (`packages/util/crypto`)
  - `@dramaip/infra-values` ← `@deepseek-ai/dsh-util-values` (`packages/util/values`)
  - `@dramaip/infra-web-runtime` ← `@deepseek-ai/dsh-web-app` (`packages/bundle/web-app`)
  - `@dramaip/infra-webserver` ← `@deepseek-ai/dsh-host-webserver` (`packages/host/webserver`)
  - `@dramaip/infra-win32-process` ← `@deepseek-ai/dsh-win32-process` (`packages/subprocess/win32-process`)
  - `@dramaip/infra-workspace-path` ← `@deepseek-ai/dsh-util-workspace-path` (`packages/util/workspace-path`)
  - `@dramaip/cli` ← `@deepseek-ai/dsh` (`apps/cli`)
  - `scripts/vitest/standard-decorators.ts` ← `vitest.shared.ts`
    (`standardDecoratorPlugin`)
  - `scripts/vitest/dom-environment.ts` ← `scripts/test-dom-environment.ts`
  - `scripts/build-infra-clients.mjs` ← `packages/client/tsdown.client.ts`
    (client bundle format and purity rules, rewritten on esbuild)
  - `apps/web/vite.config.ts` ← `apps/web/vite.config.ts`
  - `packages/infra/typert-generator/tests/json-schema.ts` ←
    `packages/core/tools/src/json-schema.ts` (test copy)
  - `scripts/check-level2-gates.mjs` and its test ←
    `scripts/verify-application-entrypoints.ts` (bin, executable and
    root-script launch classification) and `scripts/verify-cordis-config.ts`
    (bundle patch names against the bundle's dependencies), rewritten as one
    Node gate

The optional FFmpeg+x264 renderer is not part of DramaIP Desktop. It must be
installed by an explicit user action as a separately signed process and must
ship its own license, corresponding source offer, build recipe and artifact
manifest. No renderer is currently declared verified by this repository.
