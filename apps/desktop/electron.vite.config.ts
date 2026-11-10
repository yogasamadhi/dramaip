import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// pnpm 在包目录下执行 workspace 脚本，cwd 即 apps/desktop
const root = process.cwd();

// The shell imports one source-only workspace module (the Node IPC protocol);
// it is compiled into the Main and preload chunks. Everything the Desktop
// Host runs is loaded by the Host process itself, never bundled here.
const sourceOnly = ["@dramaip/host-shell-bridge"];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: sourceOnly },
      rollupOptions: {
        input: { index: resolve(root, "electron/main.ts") },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: sourceOnly },
      rollupOptions: {
        input: {
          index: resolve(root, "electron/shell/preload.ts"),
          "credential-capture": resolve(
            root,
            "electron/shell/credential-capture-preload.ts",
          ),
        },
        // Windows run with `sandbox: true`, which only loads CommonJS
        // preloads; the package's "type": "module" would otherwise emit ESM.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
});
