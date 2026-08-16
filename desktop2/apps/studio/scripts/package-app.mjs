import { resolve } from "node:path";

import { build } from "electron-builder";

// electron-builder expands publish configuration even when it is only creating
// local artifacts. Keep packaging deterministic without weakening the separate
// production update channel: a release publisher must still provide the real
// DRAMAIP_NEXT_UPDATE_URL before invoking its publishing step.
process.env.DRAMAIP_NEXT_UPDATE_URL ??=
  "https://updates.invalid/dramaip-studio-next";

await build({
  projectDir: resolve(import.meta.dirname, ".."),
  config: resolve(import.meta.dirname, "../electron-builder.yml"),
  publish: "never",
});
