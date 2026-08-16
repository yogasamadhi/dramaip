import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(join(root, "generated/plugin-manifest.json"), "utf8"),
) as {
  plugins: Array<{ id: string; requires: string[] }>;
};
const plugins = new Map(manifest.plugins.map((plugin) => [plugin.id, plugin]));
const state = new Map<string, "visiting" | "visited">();
const visit = (id: string, trail: string[]): void => {
  if (state.get(id) === "visited") return;
  if (state.get(id) === "visiting")
    throw new Error(`plugin cycle: ${[...trail, id].join(" -> ")}`);
  const plugin = plugins.get(id);
  if (!plugin) throw new Error(`missing plugin descriptor: ${id}`);
  state.set(id, "visiting");
  for (const dependency of plugin.requires) visit(dependency, [...trail, id]);
  state.set(id, "visited");
};
for (const id of plugins.keys()) visit(id, []);

const boundaryFailures: string[] = [];
const pluginNames = new Set(
  (await readdir(join(root, "plugins"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
for (const plugin of pluginNames) {
  const sourceRoot = join(root, "plugins", plugin, "src");
  for (const entry of await readdir(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/from\s+["']@dramaip\/([^"']+)["']/g)) {
      const imported = match[1]!;
      if (pluginNames.has(imported) && imported !== plugin)
        boundaryFailures.push(relative(root, path));
    }
  }
}
if (boundaryFailures.length)
  throw new Error(
    `cross-plugin implementation import:\n${[...new Set(boundaryFailures)].join("\n")}`,
  );
process.stdout.write(
  `Plugin graph is acyclic and implementation boundaries hold (${plugins.size} builtins)\n`,
);
