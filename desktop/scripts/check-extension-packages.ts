import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseExtensionManifest } from "../packages/extension-host/src/index.ts";

async function main(): Promise<void> {
const root = resolve(import.meta.dirname, "..");
const manifest = parseExtensionManifest(
  JSON.parse(
    await readFile(
      resolve(root, "examples/official-isolated-extension/manifest.json"),
      "utf8",
    ),
  ),
);
const source = await readFile(
  resolve(root, "examples/official-isolated-extension/src/extension.ts"),
  "utf8",
);
if (/from\s+["'](?:node:|electron|better-sqlite3|@dramaip\/plugin-api\/internal)/u.test(source))
  throw new Error("Official isolated fixture imports a forbidden capability");
if (!source.includes("@dramaip/plugin-api"))
  throw new Error("Official isolated fixture must consume Public Plugin API v1");
if (manifest.uiContributions.some((item) => item.kind === undefined))
  throw new Error("Official isolated fixture has invalid declarative UI");
process.stdout.write("Extension package fixtures passed\n");
}

void main();
