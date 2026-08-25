import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GROK_VERSION = "1.0.5";
const TARGET = "aarch64-apple-darwin";
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const repository = resolve(desktop, "../..");
const source = join(repository, "vendor/grok-build");
const output = join(desktop, "build/grok", TARGET);
const executable = join(output, "grok");
const lockPath = join(repository, "vendor/grok-build.lock.json");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  await mkdir(output, { recursive: true, mode: 0o755 });
  await writeFile(
    join(output, "RUNTIME_UNAVAILABLE"),
    "Grok Build Runtime 当前只提供 macOS arm64 构建。\n",
    "utf8",
  );
  process.stderr.write(
    "Grok Runtime 当前仅支持 macOS arm64；跳过本机 Runtime 构建，桌面端将显示为不可用。\n",
  );
  process.exit(0);
}

for (const [path, label] of [
  [join(source, "Cargo.toml"), "Grok Cargo.toml"],
  [join(source, "Cargo.lock"), "Grok Cargo.lock"],
  [join(source, "rust-toolchain.toml"), "Grok Rust 工具链配置"],
  [join(source, "SOURCE_REV"), "Grok SOURCE_REV"],
  [join(source, "LICENSE"), "Grok License"],
  [join(source, "THIRD-PARTY-NOTICES"), "Grok 第三方声明"],
])
  if (!existsSync(path)) throw new Error(`${label}不存在`);

const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.version !== GROK_VERSION || lock.target !== TARGET)
  throw new Error("Grok 引擎锁版本或目标平台不匹配");
const sourceRev = (await readFile(join(source, "SOURCE_REV"), "utf8")).trim();
if (sourceRev !== lock.sourceRev)
  throw new Error("Grok SOURCE_REV 与锁定文件不一致");
const cargoLockSha256 = createHash("sha256")
  .update(await readFile(join(source, "Cargo.lock")))
  .digest("hex");
if (cargoLockSha256 !== lock.cargoLockSha256)
  throw new Error("Grok Cargo.lock 与锁定文件不一致");

const rustToolchain = await readFile(
  join(source, "rust-toolchain.toml"),
  "utf8",
);
const pinnedToolchain = rustToolchain.match(/channel\s*=\s*"([^"]+)"/)?.[1];
if (pinnedToolchain !== "1.94.0")
  throw new Error(
    `Grok 源码 Rust 工具链必须固定为 1.94.0，实际为 ${pinnedToolchain ?? "未知"}`,
  );

const sourceTree = await frozenTree(source);
if (
  sourceTree.count !== lock.sourceTreeFileCount ||
  sourceTree.sha256 !== lock.sourceTreeSha256
)
  throw new Error(
    `Grok 完整源码树校验失败：expected ${lock.sourceTreeFileCount}/${lock.sourceTreeSha256}, actual ${sourceTree.count}/${sourceTree.sha256}`,
  );

let cargoVersion;
try {
  cargoVersion = await run("cargo", ["--version"], source, true);
} catch (error) {
  throw new Error(
    `Grok Runtime 构建需要 Rust 1.94.0（cargo）：${error instanceof Error ? error.message : String(error)}`,
  );
}
if (!/cargo 1\.(?:94)\./.test(cargoVersion))
  process.stderr.write(
    `警告：源码固定 Rust 1.94.0，当前 ${cargoVersion.trim()}；建议安装并使用 Rust 1.94.0。\n`,
  );
try {
  await run("dotslash", ["--help"], source, true);
} catch (error) {
  throw new Error(
    `Grok Runtime 构建需要 DotSlash（请安装 dotslash 并加入 PATH）：${error instanceof Error ? error.message : String(error)}`,
  );
}

await run(
  "cargo",
  ["build", "--locked", "-p", "xai-grok-pager-bin", "--release"],
  source,
);
const built = join(source, "target/release/xai-grok-pager");
if (!existsSync(built)) throw new Error("Grok Rust 构建未生成 xai-grok-pager");
if (relative(desktop, output).startsWith("..") || output === desktop)
  throw new Error(`拒绝清理不安全的 Grok 输出目录：${output}`);
await rm(join(desktop, "build/grok"), { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o755 });
await cp(built, executable);
await normalizeMachOUuid(executable);
await chmod(executable, 0o755);
// normalizeMachOUuid mutates the load commands after Rust's linker has
// written its ad-hoc signature. macOS rejects a modified Mach-O with
// SIGKILL, so always replace that signature before packaging the runtime.
try {
  await run("codesign", ["--force", "--sign", "-", executable], output);
} catch (error) {
  throw new Error(
    `Grok Runtime 需要 macOS codesign 重新签名：${error instanceof Error ? error.message : String(error)}`,
  );
}

const binarySha256 = createHash("sha256")
  .update(await readFile(executable))
  .digest("hex");
if (lock.platforms?.[TARGET]?.binarySha256 !== binarySha256)
  process.stderr.write(
    `警告：Grok 上游 Mach-O 构建包含非确定性链接数据；锁定参考 SHA-256 ${lock.platforms?.[TARGET]?.binarySha256}，本次产物为 ${binarySha256}。运行时将使用清单中的实际哈希。\n`,
  );

await writeFile(
  join(output, "runtime-manifest.json"),
  `${JSON.stringify(
    {
      engine: "grok",
      version: GROK_VERSION,
      target: TARGET,
      rustToolchain: pinnedToolchain,
      sourceRev,
      binarySha256,
      sourceTreeSha256: lock.sourceTreeSha256,
      entry: "grok",
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`已准备 Grok Build ${GROK_VERSION}（${TARGET}）\n`);

function run(command, args, cwd, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (value) => (stdout += value));
      child.stderr.on("data", (value) => (stderr += value));
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolvePromise(capture ? stdout : undefined);
      reject(
        new Error(
          `${command} 执行失败（退出码 ${code ?? "unknown"}）${stderr ? `：${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function frozenTree(root, relativePath = "") {
  const files = [];
  for (const entry of await readdir(join(root, relativePath), {
    withFileTypes: true,
  })) {
    const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.name === ".git") continue;
    if (entry.isDirectory()) {
      if (["target", "node_modules", "build", "dist"].includes(entry.name))
        continue;
      files.push(...(await frozenTree(root, path)));
    } else if (
      entry.name !== ".DS_Store" &&
      !entry.name.endsWith(".pyc") &&
      !entry.name.endsWith(".tsbuildinfo")
    ) {
      const content = entry.isSymbolicLink()
        ? Buffer.from(`link:${await readlink(join(root, path))}`)
        : await readFile(join(root, path));
      files.push({ path, content });
    }
  }
  if (relativePath) return files;
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(
      `${file.path}\0${createHash("sha256").update(file.content).digest("hex")}\n`,
    );
  return { count: files.length, sha256: hash.digest("hex") };
}

async function normalizeMachOUuid(path) {
  const binary = await readFile(path);
  if (binary.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Grok Runtime 仅支持 64 位 little-endian Mach-O");
  const commands = binary.readUInt32LE(16);
  let offset = 32;
  const stableUuid = Buffer.from("00000000000000000000000000000001", "hex");
  for (let index = 0; index < commands; index += 1) {
    const command = binary.readUInt32LE(offset);
    const size = binary.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > binary.length)
      throw new Error("Grok Runtime Mach-O load command 损坏");
    if (command === 0x1b) {
      if (size < 24) throw new Error("Grok Runtime Mach-O UUID 命令损坏");
      stableUuid.copy(binary, offset + 8);
      await writeFile(path, binary);
      return;
    }
    offset += size;
  }
  throw new Error("Grok Runtime Mach-O 缺少 LC_UUID");
}
