/**
 * Vite build of the browser shell (adapted from DSH `apps/web/vite.config.ts`,
 * MIT). The shell is served by the `web` profile, which injects
 * `window.__DRAMAIP_BOOT__` into `index.html`; plugin packages never enter
 * this graph and arrive as runtime bundles through the client module system.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const src = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));
const DEFAULT_CLIENT_TITLE = "DramaIP Local Build";
const STANDALONE_ERROR =
  "apps/web is not a standalone application: bare Vite cannot inject window.__DRAMAIP_BOOT__. " +
  "Run `pnpm run dramaip --profile web` after `pnpm run build:infra`.";

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Project the public build title into the initial HTML document. */
function clientDocumentTitle(): Plugin {
  const title = escapeHtmlText(
    process.env.DRAMAIP_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE,
  );
  return {
    name: "dramaip-client-document-title",
    transformIndexHtml(html) {
      return html.replace(
        `<title>${DEFAULT_CLIENT_TITLE}</title>`,
        `<title>${title}</title>`,
      );
    },
  };
}

/** Keep the redistribution license beside the bundled brand font. */
function brandFontLicense(): Plugin {
  return {
    name: "dramaip-brand-font-license",
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "assets/fonts/Montserrat-OFL.txt",
        source: await readFile(
          src("../../packages/infra/ui-theme/src/styles/Montserrat-OFL.txt"),
        ),
      });
    },
  };
}

/** Fail before a Vite dev or preview server can expose the boot-manifest-free shell. */
function rejectStandaloneServe(): Plugin {
  return {
    name: "dramaip-reject-standalone-web-serve",
    config(_config, env) {
      if (env.command === "serve") throw new Error(STANDALONE_ERROR);
    },
  };
}

const mode = process.env.NODE_ENV ?? "production";

export default defineConfig({
  // Relative asset URLs: the served index resolves them under `<base href="./">`.
  base: "./",
  plugins: [
    rejectStandaloneServe(),
    clientDocumentTitle(),
    brandFontLicense(),
    react(),
  ],
  build: {
    target: "es2022",
    sourcemap: process.env.DRAMAIP_RELEASE !== "1",
    emptyOutDir: true,
  },
  resolve: {
    // One React instance: the shell seeds it into the module table every plugin bundle shares.
    dedupe: ["react", "react-dom"],
    // The vendored Cordis Loader's only Node import.
    alias: [
      { find: /^node:module$/, replacement: src("./src/node-module-stub.ts") },
    ],
  },
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": JSON.stringify(mode),
    ...(process.env.DRAMAIP_CLIENT_TITLE === undefined
      ? {}
      : {
          "process.env.DRAMAIP_CLIENT_TITLE": JSON.stringify(
            process.env.DRAMAIP_CLIENT_TITLE,
          ),
        }),
    // Vendored loader internal.ts probes the Node major; "0.0.0" takes neither
    // branch and leaves the internal slot the shell fills with the module loader.
    "process.versions.node": '"0.0.0"',
    "process.execArgv": "[]",
    "process.env.CORDIS_SHARED": "undefined",
  },
});
