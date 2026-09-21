import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Bun 在包目录下执行 workspace 脚本，cwd 即 apps/desktop
const root = process.cwd();
const pkgSrc = (p: string) =>
  resolve(root, "../../packages", p, "src", p === "db" ? "v3.ts" : "index.ts");
const pluginSrc = (p: string) =>
  resolve(root, "../../plugins", p, "src", "index.ts");
const runtimeAliases = {
  "@dramaip/runtime-adapters/artifact-recovery": resolve(
    root,
    "../../packages/runtime-adapters/src/artifact-recovery.ts",
  ),
  "@dramaip/contracts/agent-context": resolve(
    root,
    "../../packages/contracts/src/agent-context.ts",
  ),
  "@dramaip/contracts/creation": resolve(
    root,
    "../../packages/contracts/src/creation.ts",
  ),
  "@dramaip/contracts/automation": resolve(
    root,
    "../../packages/contracts/src/automation.ts",
  ),
  "@dramaip/contracts/creative-intelligence": resolve(
    root,
    "../../packages/contracts/src/creative-intelligence.ts",
  ),
  "@dramaip/contracts/creative-quality": resolve(
    root,
    "../../packages/contracts/src/creative-quality.ts",
  ),
  "@dramaip/contracts/delivery": resolve(
    root,
    "../../packages/contracts/src/delivery.ts",
  ),
  "@dramaip/contracts/foundation": resolve(
    root,
    "../../packages/contracts/src/foundation.ts",
  ),
  "@dramaip/contracts/knowledge": resolve(
    root,
    "../../packages/contracts/src/knowledge.ts",
  ),
  "@dramaip/contracts/media": resolve(
    root,
    "../../packages/contracts/src/media.ts",
  ),
  "@dramaip/contracts/insights": resolve(
    root,
    "../../packages/contracts/src/insights.ts",
  ),
  "@dramaip/contracts/production": resolve(
    root,
    "../../packages/contracts/src/production.ts",
  ),
  "@dramaip/contracts/review": resolve(
    root,
    "../../packages/contracts/src/review.ts",
  ),
  "@dramaip/contracts/timeline": resolve(
    root,
    "../../packages/contracts/src/timeline.ts",
  ),
  "@dramaip/contracts/workspace": resolve(
    root,
    "../../packages/contracts/src/workspace.ts",
  ),
  "@dramaip/contracts/writing": resolve(
    root,
    "../../packages/contracts/src/writing.ts",
  ),
  "@dramaip/contracts/product": resolve(
    root,
    "../../packages/contracts/src/product.ts",
  ),
  "@dramaip/contracts": pkgSrc("contracts"),
  "@dramaip/agent-runtime": pkgSrc("agent-runtime"),
  "@dramaip/bundles": pkgSrc("bundles"),
  "@dramaip/database/migration-worker": resolve(
    root,
    "../../packages/database/src/migration-worker.ts",
  ),
  "@dramaip/database/migration-worker-runtime": resolve(
    root,
    "../../packages/database/src/migration-worker-runtime.ts",
  ),
  "@dramaip/database": pkgSrc("database"),
  "@dramaip/desktop-host": pkgSrc("desktop-host"),
  "@dramaip/events": pkgSrc("events"),
  "@dramaip/extension-host": pkgSrc("extension-host"),
  "@dramaip/http": pkgSrc("http"),
  "@dramaip/kernel": pkgSrc("kernel"),
  "@dramaip/plugin-api/internal": resolve(
    root,
    "../../packages/plugin-api/src/internal.ts",
  ),
  "@dramaip/plugin-api": pkgSrc("plugin-api"),
  "@dramaip/runtime": pkgSrc("runtime"),
  "@dramaip/server-connection": pkgSrc("server-connection"),
  "@dramaip/ui-runtime": pkgSrc("ui-runtime"),
  "@dramaip/ui-shared": pkgSrc("ui"),
  "@dramaip/agents": pluginSrc("agents"),
  "@dramaip/automation": pluginSrc("automation"),
  "@dramaip/creative-quality": pluginSrc("creative-quality"),
  "@dramaip/delivery": pluginSrc("delivery"),
  "@dramaip/foundation": pluginSrc("foundation"),
  "@dramaip/insights": pluginSrc("insights"),
  "@dramaip/knowledge": pluginSrc("knowledge"),
  "@dramaip/media": pluginSrc("media"),
  "@dramaip/production": pluginSrc("production"),
  "@dramaip/review": pluginSrc("review"),
  "@dramaip/system": pluginSrc("system"),
  "@dramaip/timeline": pluginSrc("timeline"),
  "@dramaip/workspace": pluginSrc("workspace"),
  "@dramaip/writing": pluginSrc("writing"),
};

export default defineConfig({
  main: {
    build: {
      // These first-party workspace packages are source-only and must be
      // compiled into Main/utility-process chunks. Leaving them external makes
      // Electron's Node loader resolve TypeScript source (and its .js specifier
      // aliases) at runtime, causing Core Runtime to exit before ready.
      externalizeDeps: {
        exclude: [
          "@dramaip/client",
          "@dramaip/contracts",
          "@dramaip/extension-host",
          "@dramaip/ui-runtime",
          "@ai-sdk/anthropic",
          "@ai-sdk/google",
          "@ai-sdk/openai",
          "@ai-sdk/openai-compatible",
          "@langchain/core",
          "@langchain/langgraph",
          "ai",
        ],
      },
      rollupOptions: {
        input: {
          index: resolve(root, "electron/main.ts"),
          "extension-host-process": resolve(
            root,
            "electron/extensions/extension-host-process.ts",
          ),
          "codex-engine": resolve(
            root,
            "../../packages/ai/src/codex-sidecar.ts",
          ),
          "pi-engine": resolve(root, "../../packages/ai/src/pi-sidecar.ts"),
          "langgraph-engine": resolve(
            root,
            "../../packages/ai/src/langgraph-sidecar.ts",
          ),
        },
      },
    },
    resolve: {
      alias: {
        ...runtimeAliases,
        "@dramaip/client": pkgSrc("client"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "electron/preload-v3.ts"),
          "credential-capture": resolve(
            root,
            "electron/credential-capture-preload.ts",
          ),
        },
      },
    },
  },
  renderer: {
    root: resolve(root, "../../packages/app"),
    server: {
      port: 5177,
    },
    build: {
      manifest: true,
      rollupOptions: {
        input: resolve(root, "../../packages/app/index.html"),
      },
    },
    resolve: {
      alias: {
        "@dramaip/contracts/creation": resolve(
          root,
          "../../packages/contracts/src/creation.ts",
        ),
        "@dramaip/contracts/automation": resolve(
          root,
          "../../packages/contracts/src/automation.ts",
        ),
        "@dramaip/contracts/product": resolve(
          root,
          "../../packages/contracts/src/product.ts",
        ),
        "@dramaip/contracts/production": resolve(
          root,
          "../../packages/contracts/src/production.ts",
        ),
        "@dramaip/contracts": pkgSrc("contracts"),
        "@": resolve(root, "../../packages/app/src"),
        "@dramaip/client": pkgSrc("client"),
        "@dramaip/server-connection": pkgSrc("server-connection"),
        "@dramaip/ui-shared": pkgSrc("ui"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
