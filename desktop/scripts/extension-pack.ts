import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import {
  createExtensionPackage,
  parseExtensionManifest,
} from "../packages/extension-host/src/index.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return resolve(value);
}

async function main(): Promise<void> {
const manifestPath = argument("manifest");
const entryPath = argument("entry");
const privateKeyPath = argument("private-key");
const outputPath = argument("out");
const manifest = parseExtensionManifest(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

const publicApi: Plugin = {
  name: "dramaip-public-plugin-api",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@dramaip\/plugin-api$/ }, () => ({
      path: "public-api",
      namespace: "dramaip",
    }));
    pluginBuild.onLoad(
      { filter: /^public-api$/, namespace: "dramaip" },
      () => ({
        contents: `export const defineExtension = extension => Object.freeze(extension);`,
        loader: "js",
      }),
    );
    pluginBuild.onResolve({ filter: /^[^./].*/ }, (args) => ({
      errors: [{ text: `Extension dependency is not allowed: ${args.path}` }],
    }));
  },
};

const built = await build({
  entryPoints: [entryPath],
  absWorkingDir: dirname(entryPath),
  bundle: true,
  format: "iife",
  globalName: "__dramaipModule",
  platform: "neutral",
  target: "es2020",
  write: false,
  plugins: [publicApi],
  legalComments: "none",
  minify: true,
});
const source = built.outputFiles[0]?.text;
if (!source) throw new Error("Extension bundle was not produced");
const bootstrap = `
${source}
(() => {
  const extension = __dramaipModule.default ?? __dramaipModule.extension;
  if (!extension || typeof extension.activate !== "function") {
    throw new TypeError("Extension entrypoint must default-export defineExtension(...)");
  }
  const cleanups = [];
  const context = Object.freeze({
    pluginId: ${JSON.stringify(manifest.id)},
    revision: ${JSON.stringify(manifest.version)},
    handle(id, handler) {
      dramaip.registerHandler(id, handler);
      return () => undefined;
    },
    subscribe(id, handler) {
      dramaip.registerHandler(id, handler);
      return () => undefined;
    },
    capability(name, payload) {
      return dramaip.capability(name, payload);
    },
    async effect(label, acquire) {
      if (typeof label !== "string" || !label) throw new TypeError("effect label is required");
      const cleanup = await acquire();
      if (typeof cleanup !== "function") throw new TypeError("effect must acquire a cleanup");
      cleanups.push(cleanup);
    },
  });
  globalThis.__dramaipActivation = Promise.resolve(extension.activate(context)).then(cleanup => {
    if (typeof cleanup === "function") cleanups.push(cleanup);
  });
  globalThis.__dramaipDispose = () => {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch {}
    }
  };
})();
`;
const archive = createExtensionPackage({
  manifest,
  bundle: bootstrap,
  privateKeyPem: await readFile(privateKeyPath, "utf8"),
});
await writeFile(outputPath, archive, { mode: 0o600 });
process.stdout.write(`${outputPath}\n`);
}

void main();
