// The Kernel-era plugin handlers the domain Host packages carry under
// `packages/<group>/<host>/handlers/<id>` until they become controllers.
import { globSync } from "node:fs";
import { dirname, join } from "node:path";

/** Every handler directory as `{ id, directory }`, the directory relative to root. */
export function legacyHandlers(root) {
  return globSync("packages/*/*/handlers/*/index.ts", {
    cwd: root,
    exclude: (path) => path.includes("node_modules"),
  })
    .map((path) => {
      const directory = dirname(path).replaceAll("\\", "/");
      return { id: directory.split("/").at(-1), directory };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The absolute directory of one handler. */
export function legacyHandlerDirectory(root, id) {
  const found = legacyHandlers(root).find((handler) => handler.id === id);
  if (!found) throw new Error(`No legacy handler ${id}`);
  return join(root, found.directory);
}
