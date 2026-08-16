import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "..");
const studio = join(root, "apps/studio");

function platformTriple(): string {
  if (process.platform === "darwin")
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  if (process.platform === "win32")
    return process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  return process.arch === "arm64"
    ? "aarch64-unknown-linux-musl"
    : "x86_64-unknown-linux-musl";
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function runtimeTree(
  directory: string,
  allowInternalSymlinks: boolean,
): Promise<{ fileCount: number; treeSha256: string }> {
  const files: string[] = [];
  async function collect(relativePath = ""): Promise<void> {
    for (const entry of await readdir(join(directory, relativePath), {
      withFileTypes: true,
    })) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (path === "runtime-manifest.json") continue;
      const metadata = await lstat(join(directory, path));
      if (metadata.isSymbolicLink()) {
        if (!allowInternalSymlinks)
          throw new Error(`runtime contains an unresolved symlink: ${path}`);
        const target = await realpath(join(directory, path));
        if (relative(directory, target).startsWith(".."))
          throw new Error(`runtime symlink escapes its root: ${path}`);
      }
      if (entry.isDirectory()) await collect(path);
      else files.push(path);
    }
  }
  await collect();
  files.sort();
  const hash = createHash("sha256");
  for (const path of files)
    hash.update(`${path}\0${await sha256(join(directory, path))}\n`);
  return { fileCount: files.length, treeSha256: hash.digest("hex") };
}

function assertEntry(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} runtime entry is missing`);
}

const opencodeLock = JSON.parse(
  await readFile(join(repository, "desktop/vendor/opencode.lock.json"), "utf8"),
);
const opencodeSource = join(
  repository,
  "desktop/vendor/opencode",
  opencodeLock.runtimeEntry,
);
const opencodeRuntime = join(studio, "build/opencode/node.js");
assertEntry(opencodeRuntime, "OpenCode");
if ((await sha256(opencodeSource)) !== (await sha256(opencodeRuntime)))
  throw new Error("OpenCode local runtime differs from frozen shared vendor");
for (const entry of [
  "build/opencode/node_modules/jsonc-parser/package.json",
  `build/opencode/node_modules/@lydell/node-pty-${process.platform}-${process.arch}/package.json`,
])
  assertEntry(join(studio, entry), "OpenCode dependency");

const codexLock = JSON.parse(
  await readFile(join(repository, "desktop/vendor/codex.lock.json"), "utf8"),
);
const triple = platformTriple();
const codexRuntime = join(
  studio,
  "build/codex",
  triple,
  process.platform === "win32" ? "codex.exe" : "codex",
);
assertEntry(codexRuntime, "Codex");
if ((await sha256(codexRuntime)) !== codexLock.platforms[triple]?.binarySha256)
  throw new Error(`Codex ${triple} binary hash does not match shared lock`);

const dshDirectory = join(studio, "build/dsh");
const dshManifest = JSON.parse(
  await readFile(join(dshDirectory, "runtime-manifest.json"), "utf8"),
);
if (
  dshManifest.engine !== "dsh" ||
  dshManifest.version !== "0.1.0-rc.5" ||
  dshManifest.platform !== process.platform ||
  dshManifest.arch !== process.arch
)
  throw new Error("dsh runtime manifest identity is invalid");
const actualDshTree = await runtimeTree(dshDirectory, false);
if (
  actualDshTree.fileCount !== dshManifest.fileCount ||
  actualDshTree.treeSha256 !== dshManifest.treeSha256
)
  throw new Error("dsh runtime tree differs from its build manifest");

const piDirectory = join(studio, "build/pi");
const piManifest = JSON.parse(
  await readFile(join(piDirectory, "runtime-manifest.json"), "utf8"),
);
const piEntry = join(piDirectory, piManifest.entry ?? "runtime.mjs");
assertEntry(piEntry, "Pi");
if (
  piManifest.engine !== "pi" ||
  piManifest.version !== "0.84.2" ||
  piManifest.node !== ">=22.19.0" ||
  (await sha256(piEntry)) !== piManifest.runtimeSha256
)
  throw new Error("Pi runtime manifest identity or hash is invalid");

assertEntry(
  join(
    studio,
    "build/dsh/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js",
  ),
  "DSH",
);
const forbiddenDshPlugins = [
  "dsh-bash",
  "dsh-fs-local",
  "dsh-tool-web",
  "dsh-skill",
  "dsh-subagent",
  "dsh-workflow",
  "dsh-session-persistence",
];
for (const provider of ["openai", "anthropic", "google"]) {
  const source = await readFile(
    join(studio, `dsh-config/${provider}.cordis.yml`),
    "utf8",
  );
  for (const plugin of forbiddenDshPlugins)
    if (source.includes(`@deepseek-ai/${plugin}`))
      throw new Error(`DSH profile enables forbidden plugin ${plugin}`);
}

process.stdout.write(
  `OpenCode, Codex, DSH and Pi local runtime trees verified for ${process.platform}/${process.arch}\n`,
);
