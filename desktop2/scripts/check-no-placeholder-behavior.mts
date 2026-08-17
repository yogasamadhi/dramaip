import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = ["plugins", "packages", "apps/studio/src"];
const files: string[] = [];
async function visit(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "generated") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(path);
  }
}
for (const path of roots) await visit(join(root, path));
const violations: string[] = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const relativeFile = relative(root, file);
  if (
    /crypto\.randomUUID\(\)[^\n]*(?:episodeId|scriptId|sceneId|shotId|versionId|reviewPackageId|platformSpecId)/u.test(
      source,
    )
  )
    violations.push(
      `${relativeFile}: random UUID used as a domain foreign key`,
    );
  if (
    /\b(?:第 1 集临时音轨|无人接听|雨夜敲门|旧照片)\b/u.test(source) &&
    !relativeFile.includes("workspace/src/ui.tsx")
  )
    violations.push(`${relativeFile}: fixed example business state`);
  if (
    /feedbackIds:\s*\[\]|nodes:\s*\[\],\s*edges:\s*\[\]|costMicros:\s*0/u.test(
      source,
    ) &&
    relativeFile.includes("plugins/insights")
  )
    violations.push(`${relativeFile}: empty or zero-valued insight result`);
}
if (violations.length)
  throw new Error(`placeholder behavior detected:\n${violations.join("\n")}`);
process.stdout.write("No placeholder domain behavior detected\n");
