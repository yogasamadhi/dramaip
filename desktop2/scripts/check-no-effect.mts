import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures: string[] = [];

async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", "build", "out", "release", "generated"].includes(
        entry.name,
      )
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:ts|tsx|mts|json)$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      if (/from\s+["'](?:effect|@effect\/)|["']effect["']\s*:/.test(source))
        failures.push(path);
    }
  }
}

for (const directory of ["apps", "packages", "plugins"])
  await scan(join(root, directory));
if (failures.length)
  throw new Error(
    `Effect is forbidden in Desktop2 first-party code:\n${failures.join("\n")}`,
  );
process.stdout.write("No first-party Effect imports or dependencies\n");
