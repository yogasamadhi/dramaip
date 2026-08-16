import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "..");
const lock = JSON.parse(
  await readFile(resolve(root, "generated/vendor-lock.json"), "utf8"),
);

async function files(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "lib", ".git"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else output.push(path);
  }
  return output.sort();
}

async function treeHash(
  target: string,
): Promise<{ files: number; sha256: string }> {
  const hash = createHash("sha256");
  const information = await stat(target);
  const entries = information.isDirectory() ? await files(target) : [target];
  for (const path of entries) {
    const content = await readFile(path);
    const name = information.isDirectory()
      ? relative(target, path)
      : path.split(/[\\/]/).at(-1)!;
    hash.update(`${name.replaceAll("\\", "/")}\0`);
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  }
  return { files: entries.length, sha256: hash.digest("hex") };
}

function assertEqual(label: string, expected: unknown, actual: unknown): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error(
      `${label} vendor hash drift: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}

const expectedVersions = {
  cordis: "4.0.1",
  cosmokit: "1.8.2",
  loader: "1.0.2",
  group: "1.0.1",
  opencode: "1.18.15",
  codex: "0.147.0",
  dsh: "0.1.0-rc.5",
  pi: "0.84.2",
  langgraph: "0.2.43",
};
for (const [name, version] of Object.entries(expectedVersions)) {
  const actual = lock[name]?.version ?? lock.engines?.[name]?.version;
  if (actual !== version)
    throw new Error(
      `${name} vendor version drift: expected ${version}, received ${actual}`,
    );
}

const cordisVendor = resolve(
  repository,
  "desktop/vendor/deepseek-harness/vendor",
);
for (const name of ["cordis", "cosmokit", "loader", "group"] as const) {
  assertEqual(
    name,
    { files: lock[name].files, sha256: lock[name].sha256 },
    await treeHash(join(cordisVendor, name)),
  );
}

const engineLocks = {
  opencode: "desktop/vendor/opencode.lock.json",
  codex: "desktop/vendor/codex.lock.json",
  dsh: "desktop/vendor/deepseek-harness.lock.json",
  pi: "desktop/vendor/pi.lock.json",
} as const;
for (const [name, path] of Object.entries(engineLocks)) {
  const absolute = resolve(repository, path);
  assertEqual(name, lock.engines[name].lock, await treeHash(absolute));
}

const bunLock = await readFile(join(root, "bun.lock"), "utf8");
if (!bunLock.includes('"@langchain/langgraph@0.2.43"'))
  throw new Error("LangGraph 0.2.43 is not locked in desktop2/bun.lock");

process.stdout.write(
  "Cordis source trees, engine locks and LangGraph package are hash-verified\n",
);
