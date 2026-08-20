import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const codex = await readJson(join(root, "vendor/codex.lock.json"));
const protocol = await readJson(join(root, "vendor/codex.protocol.lock.json"));
const opencode = await readJson(join(root, "vendor/opencode.lock.json"));
const dsh = await readJson(join(root, "vendor/deepseek-harness.lock.json"));
const pi = await readJson(join(root, "vendor/pi.lock.json"));
const grok = await readJson(join(root, "vendor/grok-build.lock.json"));

if (codex.package !== "@openai/codex" || codex.version !== "0.147.0")
  throw new Error("Codex 固定版本必须为 @openai/codex 0.147.0");
if (protocol.package !== codex.package || protocol.version !== codex.version)
  throw new Error("Codex 协议快照与二进制固定版本不一致");
const requiredTriples = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-musl",
  "x86_64-unknown-linux-musl",
  "aarch64-pc-windows-msvc",
  "x86_64-pc-windows-msvc",
];
for (const triple of requiredTriples) {
  const target = codex.platforms?.[triple];
  if (!target) throw new Error(`Codex 锁定文件缺少平台：${triple}`);
  if (!/^sha512-/.test(target.integrity ?? ""))
    throw new Error(`Codex ${triple} 缺少 npm 完整性校验`);
  if (!/^[a-f0-9]{64}$/.test(target.binarySha256 ?? ""))
    throw new Error(`Codex ${triple} 缺少二进制 SHA-256`);
}

if (opencode.version !== "1.18.15" || opencode.license !== "MIT")
  throw new Error("OpenCode 固定版本必须为 1.18.15（MIT）");
const opencodeManifest = await readFile(
  join(root, "vendor/opencode/packages/opencode/package.json"),
);
const manifestSha = createHash("sha256").update(opencodeManifest).digest("hex");
if (manifestSha !== opencode.packageManifestSha256)
  throw new Error("OpenCode 源码清单校验失败，vendor 内容可能已变化");

if (
  dsh.version !== "0.1.0-rc.5" ||
  dsh.license !== "MIT" ||
  dsh.packageManager !== "pnpm@11.7.0" ||
  dsh.lockfile !== "pnpm-lock.yaml"
)
  throw new Error("DSH 固定版本必须为 0.1.0-rc.5（MIT，pnpm 11.7.0）");
const dshRoot = join(root, "vendor/deepseek-harness");
const dshManifest = await readJson(join(dshRoot, "package.json"));
if (
  dshManifest.version !== dsh.version ||
  dshManifest.license !== dsh.license ||
  dshManifest.packageManager !== dsh.packageManager
)
  throw new Error("DSH package.json 与锁定文件不一致");
const dshPnpmLock = await readFile(join(dshRoot, dsh.lockfile));
const dshPnpmLockSha = createHash("sha256").update(dshPnpmLock).digest("hex");
if (dshPnpmLockSha !== dsh.pnpmLockSha256)
  throw new Error("DSH pnpm-lock.yaml 校验失败");

const dshExcludedDirectories = new Set([
  ".git",
  "node_modules",
  "lib",
  "dist",
  "dist-exe",
  "coverage",
  ".turbo",
  ".cache",
]);
const dshRuntimeOutput =
  "python/sdk-runtime/src/deepseek_harness_runtime/runtime/node";
async function collectDshSourceFiles(relative = "") {
  const files = [];
  for (const entry of await readdir(join(dshRoot, relative), {
    withFileTypes: true,
  })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === ".git") continue;
    if (entry.isDirectory()) {
      if (
        dshExcludedDirectories.has(entry.name) ||
        path === dshRuntimeOutput ||
        path.startsWith(`${dshRuntimeOutput}/`)
      )
        continue;
      files.push(...(await collectDshSourceFiles(path)));
    } else if (
      entry.name !== ".DS_Store" &&
      !entry.name.endsWith(".tsbuildinfo")
    ) {
      files.push({ path, link: entry.isSymbolicLink() });
    }
  }
  return files;
}
const dshSourceFiles = (await collectDshSourceFiles()).sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
const dshTreeHash = createHash("sha256");
for (const file of dshSourceFiles) {
  const content = file.link
    ? Buffer.from(`link:${await readlink(join(dshRoot, file.path))}`)
    : await readFile(join(dshRoot, file.path));
  const contentHash = createHash("sha256").update(content).digest("hex");
  dshTreeHash.update(`${file.path}\0${contentHash}\n`);
}
if (
  dshSourceFiles.length !== dsh.sourceTreeFileCount ||
  dshTreeHash.digest("hex") !== dsh.sourceTreeSha256
)
  throw new Error("DSH 完整源码树校验失败，vendor 冻结快照可能已变化");

async function frozenTree(
  rootDirectory,
  excludedDirectories,
  excludedPaths = new Set(),
) {
  async function collect(relative = "") {
    const files = [];
    for (const entry of await readdir(join(rootDirectory, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name === ".git" || excludedPaths.has(path)) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name))
          files.push(...(await collect(path)));
      } else if (
        entry.name !== ".DS_Store" &&
        !entry.name.endsWith(".pyc") &&
        !entry.name.endsWith(".tsbuildinfo")
      ) {
        files.push({ path, link: entry.isSymbolicLink() });
      }
    }
    return files;
  }
  const files = (await collect()).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const file of files) {
    const content = file.link
      ? Buffer.from(`link:${await readlink(join(rootDirectory, file.path))}`)
      : await readFile(join(rootDirectory, file.path));
    hash.update(
      `${file.path}\0${createHash("sha256").update(content).digest("hex")}\n`,
    );
  }
  return { count: files.length, sha256: hash.digest("hex") };
}

const piRoot = join(root, "vendor/pi");
const piManifest = await readJson(join(piRoot, "packages/agent/package.json"));
if (
  pi.package !== "@earendil-works/pi-agent-core" ||
  pi.version !== "0.84.2" ||
  pi.license !== "MIT" ||
  pi.node !== ">=22.19.0" ||
  pi.lockfile !== "package-lock.json"
)
  throw new Error("Pi 固定版本必须为 0.84.2（MIT，Node >=22.19.0）");
if (
  piManifest.name !== pi.package ||
  piManifest.version !== pi.version ||
  piManifest.license !== pi.license ||
  piManifest.engines?.node !== pi.node
)
  throw new Error("Pi Agent package.json 与锁定文件不一致");
const piPackageLock = await readFile(join(piRoot, pi.lockfile));
if (
  createHash("sha256").update(piPackageLock).digest("hex") !==
  pi.packageLockSha256
)
  throw new Error("Pi package-lock.json 校验失败");
const piTree = await frozenTree(
  piRoot,
  new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".cache",
    "out",
  ]),
);
if (
  piTree.count !== pi.sourceTreeFileCount ||
  piTree.sha256 !== pi.sourceTreeSha256
)
  throw new Error("Pi 完整源码树校验失败，vendor 冻结快照可能已变化");

const grokRoot = join(root, "vendor/grok-build");
const grokTarget = "aarch64-apple-darwin";
if (
  grok.version !== "1.0.5" ||
  grok.license !== "Apache-2.0" ||
  grok.target !== grokTarget ||
  grok.rustToolchain !== "1.94.0" ||
  grok.sourceTreeAlgorithm !==
    "sha256(path + NUL + sha256(content) + LF), sorted by path"
)
  throw new Error("Grok Build 固定版本必须为 1.0.5（Apache-2.0，Rust 1.94.0）");
const grokSourceRev = (
  await readFile(join(grokRoot, "SOURCE_REV"), "utf8")
).trim();
if (grokSourceRev !== grok.sourceRev)
  throw new Error("Grok SOURCE_REV 校验失败");
const grokCargoLockSha = createHash("sha256")
  .update(await readFile(join(grokRoot, "Cargo.lock")))
  .digest("hex");
if (grokCargoLockSha !== grok.cargoLockSha256)
  throw new Error("Grok Cargo.lock 校验失败");
for (const file of ["LICENSE", "THIRD-PARTY-NOTICES"])
  if (!(await readFile(join(grokRoot, file), "utf8")).trim())
    throw new Error(`Grok ${file} 不能为空`);
const grokTree = await frozenTree(
  grokRoot,
  new Set([".git", "target", "node_modules", "build", "dist"]),
);
if (
  grokTree.count !== grok.sourceTreeFileCount ||
  grokTree.sha256 !== grok.sourceTreeSha256
)
  throw new Error("Grok 完整源码树校验失败，vendor 冻结快照可能已变化");
const grokBinarySha = grok.platforms?.[grokTarget]?.binarySha256;
if (grok.platforms?.[grokTarget]?.binary !== "xai-grok-pager")
  throw new Error("Grok macOS arm64 入口必须为 xai-grok-pager");
if (!/^[a-f0-9]{64}$/.test(grokBinarySha ?? ""))
  throw new Error("Grok macOS arm64 缺少二进制 SHA-256");

process.stdout.write(
  `活动引擎锁定文件有效：Pi ${pi.version}；Codex ${codex.version}（${requiredTriples.length} 个平台）；Grok Build ${grok.version}。归档参考快照完整：OpenCode ${opencode.version}；DSH ${dsh.version}\n`,
);
