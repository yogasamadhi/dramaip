import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export async function saveRuntimeArtifact(
  base: string,
  files: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const target = join(base, ".last-good.json");
  await writeFile(
    `${target}.tmp`,
    JSON.stringify({
      version: 1,
      files: [...files].map(([path, data]) => [path, data.toString("base64")]),
    }),
  );
  await rename(`${target}.tmp`, target);
}

/** Supervisor-only code recovery. The journal contains code/config, never runtime data. */
export function isRuntimeConfigurationPath(path: string): boolean {
  const local = path.replaceAll("\\", "/");
  return (
    local === "cordis.yml" ||
    local.startsWith("profiles/") ||
    local.startsWith("bundles/")
  );
}

export async function restoreRuntimeArtifact(
  base: string,
  options: { preserveConfiguration?: boolean } = {},
): Promise<boolean> {
  const content = await readFile(join(base, ".last-good.json"), "utf8").catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!content) return false;
  const journal = JSON.parse(content) as {
    version: number;
    files: [string, string][];
  };
  if (journal.version !== 1 || !Array.isArray(journal.files))
    throw new Error("Invalid Runtime recovery journal");
  const entries = journal.files.map(([path, data]) => {
    const target = resolve(base, path);
    const local = relative(resolve(base), target);
    if (
      !local ||
      local.startsWith("..") ||
      isAbsolute(local) ||
      local.split(/[\\/]/).includes("node_modules")
    )
      throw new Error("Invalid Runtime recovery path");
    return [target, Buffer.from(data, "base64")] as const;
  });
  for (const [target, data] of entries) {
    if (
      options.preserveConfiguration &&
      isRuntimeConfigurationPath(relative(resolve(base), target))
    )
      continue;
    if ((await readFile(target).catch(() => undefined))?.equals(data)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return true;
}
