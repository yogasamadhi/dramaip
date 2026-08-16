import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = [
  join(root, "generated"),
  join(root, "packages/client/src/generated"),
];

async function snapshot(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else
        hashes.set(
          relative(root, path),
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        );
    }
  };
  for (const target of targets) await visit(target);
  return hashes;
}

const before = await snapshot();
execFileSync("bun", ["run", "generate"], { cwd: root, stdio: "inherit" });
const after = await snapshot();
if (JSON.stringify([...before]) !== JSON.stringify([...after]))
  throw new Error("generated artifacts drifted; run `bun run generate`");
process.stdout.write(
  "Generated OpenAPI, client, manifests and licenses are reproducible\n",
);
