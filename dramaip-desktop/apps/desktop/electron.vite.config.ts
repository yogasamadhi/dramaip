import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Bun 在包目录下执行 workspace 脚本，cwd 即 apps/desktop
const root = process.cwd();
const pkgSrc = (p: string) =>
  resolve(root, "../../packages", p, "src", p === "db" ? "v3.ts" : "index.ts");

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "electron/main-v3.ts"),
          "dramaip-server": resolve(
            root,
            "../../packages/server/src/sidecar.ts",
          ),
          "opencode-engine": resolve(
            root,
            "../../packages/ai/src/opencode-sidecar.ts",
          ),
          "codex-engine": resolve(
            root,
            "../../packages/ai/src/codex-sidecar.ts",
          ),
          "langgraph-engine": resolve(
            root,
            "../../packages/ai-legacy/src/langgraph-sidecar.ts",
          ),
        },
      },
    },
    resolve: {
      alias: {
        "@sdns/db": pkgSrc("db"),
        "@sdns/ai": pkgSrc("ai"),
        "@sdns/schema": pkgSrc("schema"),
        "@sdns/protocol": pkgSrc("protocol"),
        "@sdns/client": pkgSrc("client"),
        "@sdns/server": pkgSrc("server"),
        "@sdns/tasks": pkgSrc("tasks"),
        "@sdns/mcp": pkgSrc("mcp"),
        "@sdns/ai-legacy": resolve(
          root,
          "../../packages/ai-legacy/src/index.ts",
        ),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, "electron/preload-v3.ts") },
      },
    },
  },
  renderer: {
    root: resolve(root, "../../packages/app"),
    server: {
      port: 5177,
    },
    build: {
      rollupOptions: {
        input: resolve(root, "../../packages/app/index.html"),
      },
    },
    resolve: {
      alias: {
        "@": resolve(root, "../../packages/app/src"),
        "@sdns/client": pkgSrc("client"),
        "@sdns/schema": pkgSrc("schema"),
        "@sdns/ui": pkgSrc("ui"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
