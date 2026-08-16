import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const appRoot = import.meta.dirname;
const workspaceRoot = resolve(appRoot, "../..");
const sharedVendor = resolve(
  workspaceRoot,
  "../desktop/vendor/deepseek-harness/vendor",
);

const cordisAliases = {
  "@deepseek-ai/cordis": resolve(sharedVendor, "cordis/src/index.ts"),
  "@deepseek-ai/cosmokit": resolve(sharedVendor, "cosmokit/src/index.ts"),
  "@deepseek-ai/cordis-plugin-loader": resolve(
    sharedVendor,
    "loader/src/index.ts",
  ),
  "@deepseek-ai/cordis-plugin-group": resolve(
    sharedVendor,
    "group/src/index.ts",
  ),
};

const packageSource = (name: string, entry = "index.ts") =>
  resolve(workspaceRoot, "packages", name, "src", entry);
const pluginSource = (name: string) =>
  resolve(workspaceRoot, "plugins", name, "src/index.ts");
const pluginUiSource = (name: string) =>
  resolve(workspaceRoot, "plugins", name, "src/ui.tsx");
const internalAliases = {
  "@dramaip/agents/ui": pluginUiSource("agents"),
  "@dramaip/agents": pluginSource("agents"),
  "@dramaip/automation": pluginSource("automation"),
  "@dramaip/client": packageSource("client"),
  "@dramaip/contracts": packageSource("contracts"),
  "@dramaip/creative-quality/ui": pluginUiSource("creative-quality"),
  "@dramaip/creative-quality": pluginSource("creative-quality"),
  "@dramaip/database": packageSource("database"),
  "@dramaip/delivery/ui": pluginUiSource("delivery"),
  "@dramaip/delivery": pluginSource("delivery"),
  "@dramaip/domain-kit": packageSource("domain-kit"),
  "@dramaip/events": packageSource("events"),
  "@dramaip/foundation": pluginSource("foundation"),
  "@dramaip/http": packageSource("http"),
  "@dramaip/insights/ui": pluginUiSource("insights"),
  "@dramaip/insights": pluginSource("insights"),
  "@dramaip/kernel/renderer": packageSource("kernel", "renderer.ts"),
  "@dramaip/kernel": packageSource("kernel"),
  "@dramaip/knowledge/ui": pluginUiSource("knowledge"),
  "@dramaip/knowledge": pluginSource("knowledge"),
  "@dramaip/media/ui": pluginUiSource("media"),
  "@dramaip/media": pluginSource("media"),
  "@dramaip/plugin-api": packageSource("plugin-api"),
  "@dramaip/production/ui": pluginUiSource("production"),
  "@dramaip/production": pluginSource("production"),
  "@dramaip/review/ui": pluginUiSource("review"),
  "@dramaip/review": pluginSource("review"),
  "@dramaip/runtime": packageSource("runtime"),
  "@dramaip/system/ui": pluginUiSource("system"),
  "@dramaip/system": pluginSource("system"),
  "@dramaip/timeline/ui": pluginUiSource("timeline"),
  "@dramaip/timeline": pluginSource("timeline"),
  "@dramaip/ui": packageSource("ui"),
  "@dramaip/ui-catalog": packageSource("ui-catalog", "index.tsx"),
  "@dramaip/ui-runtime": packageSource("ui-runtime"),
  "@dramaip/ui-shared": packageSource("ui-shared", "index.tsx"),
  "@dramaip/workspace/ui": pluginUiSource("workspace"),
  "@dramaip/workspace": pluginSource("workspace"),
  "@dramaip/writing/ui": pluginUiSource("writing"),
  "@dramaip/writing": pluginSource("writing"),
};

// electron-vite 5.0.0 locates the last ESM import with a permissive regular
// expression before injecting its CommonJS compatibility shim. Large generated
// route bundles can otherwise be mistaken for an import declaration. A real,
// final import gives that pinned transform an unambiguous insertion boundary.
const esmShimBoundaryPlugin = (): Plugin => ({
  name: "dramaip:esm-shim-boundary",
  enforce: "pre",
  renderChunk(code, chunk, options) {
    if (options.format !== "es" || !chunk.isEntry) return null;
    return `${code}\nimport "node:module";\n`;
  },
});

export default defineConfig({
  main: {
    plugins: [esmShimBoundaryPlugin()],
    resolve: { alias: { ...cordisAliases, ...internalAliases } },
    build: {
      externalizeDeps: {
        exclude: [
          ...Object.keys(cordisAliases),
          ...Object.keys(internalAliases),
        ],
      },
      rollupOptions: {
        input: {
          "codex-engine": resolve(appRoot, "src/engines/codex-sidecar.ts"),
          "dsh-engine": resolve(appRoot, "src/engines/dsh-sidecar.ts"),
          "pi-engine": resolve(appRoot, "src/engines/pi-sidecar.ts"),
          index: resolve(appRoot, "src/main/index.ts"),
          "langgraph-engine": resolve(
            appRoot,
            "src/engines/langgraph-sidecar.ts",
          ),
          "opencode-engine": resolve(
            appRoot,
            "src/engines/opencode-sidecar.ts",
          ),
          "studio-server": resolve(appRoot, "src/server/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(appRoot, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    base: "/",
    root: resolve(appRoot, "src/renderer"),
    resolve: { alias: { ...cordisAliases, ...internalAliases } },
    server: {
      port: 5182,
      strictPort: true,
      fs: {
        allow: [
          resolve(appRoot, "src/renderer"),
          resolve(workspaceRoot, "packages"),
          resolve(workspaceRoot, "plugins"),
          resolve(sharedVendor, "cordis"),
          resolve(sharedVendor, "cosmokit"),
        ],
      },
    },
    build: {
      rollupOptions: { input: resolve(appRoot, "src/renderer/index.html") },
    },
    plugins: [react(), tailwindcss()],
  },
});
