import { format } from "prettier";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFirstPartyPluginRegistry } from "./first-party-sources.js";
const target = fileURLToPath(
  new URL(
    "../packages/runtime/src/plugin-manifests.generated.json",
    import.meta.url,
  ),
);
const data = [...createFirstPartyPluginRegistry()].map(([id, plugin]) => ({
  id,
  descriptor: plugin.descriptor,
  migrations: plugin.migrations ?? [],
  ui: plugin.ui ?? [],
  entry: `@dramaip/${id}`,
}));
const content = await format(JSON.stringify(data), { parser: "json" });
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== content)
    throw new Error(
      "First-party manifests are stale; run bun run plugins:generate",
    );
} else await writeFile(target, content);
console.log(
  "First-party manifests generated from the fourteen plugin declarations",
);
