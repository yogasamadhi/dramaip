import { format } from "prettier";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFirstPartyPluginRegistry } from "./first-party-sources.js";
import { legacyHandlerDirectory } from "./legacy-handlers.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
// A handler's entry is its Host face's `./handlers/<id>` export.
const entryOf = (id: string): string => {
  const host = dirname(dirname(legacyHandlerDirectory(root, id)));
  const { name } = JSON.parse(readFileSync(join(host, "package.json"), "utf8"));
  return `${name}/handlers/${id}`;
};
const target = fileURLToPath(
  new URL(
    "../packages/compat/runtime/src/plugin-manifests.generated.json",
    import.meta.url,
  ),
);
const data = [...createFirstPartyPluginRegistry()].map(([id, plugin]) => ({
  id,
  descriptor: plugin.descriptor,
  migrations: plugin.migrations ?? [],
  ui: plugin.ui ?? [],
  entry: entryOf(id),
}));
const content = await format(JSON.stringify(data), { parser: "json" });
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== content)
    throw new Error(
      "First-party manifests are stale; run pnpm run plugins:generate",
    );
} else await writeFile(target, content);
console.log(
  "First-party manifests generated from the fourteen plugin declarations",
);
