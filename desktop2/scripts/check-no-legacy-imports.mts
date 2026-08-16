import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures: string[] = [];

async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "build", "out", "release"].includes(entry.name))
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:ts|tsx|mts|js|json)$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      if (
        /(?:desktop\/packages|desktop\/apps|\/api\/v1(?:\/|["']))/.test(source)
      ) {
        failures.push(relative(root, path));
      }
    }
  }
}

for (const directory of ["apps", "packages", "plugins"])
  await scan(join(root, directory));
if (failures.length)
  throw new Error(`legacy runtime reference found:\n${failures.join("\n")}`);
process.stdout.write("No legacy runtime imports or /api/v1 routes\n");
