import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures: string[] = [];

async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      const source = await readFile(path, "utf8");
      if (
        /\b(?:createNodePluginServer|installNodePluginServer)\b/u.test(source)
      )
        failures.push(relative(root, path));
      if (/\bDomainResourcePage\b|\bDashboardPage\b/u.test(source))
        failures.push(relative(root, path));
      if (/\b501\b|TODO\s*:/u.test(source)) failures.push(relative(root, path));
    }
  }
}

await scan(join(root, "plugins"));
if (failures.length)
  throw new Error(
    `product plugin still contains generic runtime or placeholder UI:\n${[
      ...new Set(failures),
    ].join("\n")}`,
  );
process.stdout.write(
  "Product plugins use relational runtime and contain no placeholder pages\n",
);
