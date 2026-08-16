import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const repository = resolve(desktop, "../../../desktop");
const lockPath = join(repository, "vendor/codex.lock.json");
const protocolLockPath = join(repository, "vendor/codex.protocol.lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));

function targetTriple() {
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64"
      ? "aarch64-unknown-linux-musl"
      : "x86_64-unknown-linux-musl";
  }
  throw new Error(
    `不支持的 Codex 目标平台：${process.platform}/${process.arch}`,
  );
}

const triple = targetTriple();
const platform = lock.platforms[triple];
if (!platform) throw new Error(`Codex 锁定文件缺少目标平台：${triple}`);

const codexManifest = require.resolve("@openai/codex/package.json");
const codexRequire = createRequire(codexManifest);
const platformManifest = codexRequire.resolve(
  `${platform.package}/package.json`,
);
const platformRoot = await realpath(dirname(platformManifest));
const executable = process.platform === "win32" ? "codex.exe" : "codex";
const source = join(platformRoot, "vendor", triple, "bin", executable);
const bytes = await readFile(source);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (typeof platform.binarySha256 !== "string") {
  throw new Error(`Codex 锁定文件缺少 ${triple} 的二进制 SHA-256`);
}
if (platform.binarySha256 !== sha256) {
  throw new Error(
    `Codex 二进制校验失败：期望 ${platform.binarySha256}，实际 ${sha256}`,
  );
}

const runtime = join(desktop, "build/codex", triple);
const destination = join(runtime, executable);
await rm(join(desktop, "build/codex"), { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await cp(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);

const schemaRoot = join(desktop, "build/codex-schemas");
await rm(schemaRoot, { recursive: true, force: true });
for (const [command, folder] of [
  ["generate-json-schema", "json"],
  ["generate-ts", "typescript"],
]) {
  const output = join(schemaRoot, folder);
  await mkdir(output, { recursive: true });
  const generated = spawnSync(
    destination,
    ["app-server", command, "--out", output],
    { encoding: "utf8" },
  );
  if (generated.status !== 0) {
    throw new Error(
      `Codex 协议生成失败（${command}）：${generated.stderr || generated.stdout}`,
    );
  }
}

async function collectHashes(root, relative = "") {
  const result = {};
  for (const entry of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    const child = relative ? join(relative, entry.name) : entry.name;
    if (entry.isDirectory())
      Object.assign(result, await collectHashes(root, child));
    else
      result[child.replaceAll("\\", "/")] = createHash("sha256")
        .update(await readFile(join(root, child)))
        .digest("hex");
  }
  return result;
}

const protocolSnapshot = {
  package: lock.package,
  version: lock.version,
  generator: "codex app-server generate-json-schema + generate-ts",
  files: await collectHashes(schemaRoot),
};
const protocolSerialized = `${JSON.stringify(protocolSnapshot, null, 2)}\n`;
if (process.argv.includes("--update-protocol-lock"))
  throw new Error("desktop2 不得修改共享 Codex 协议锁定文件");
else {
  let expected;
  try {
    expected = await readFile(protocolLockPath, "utf8");
  } catch {
    throw new Error("缺少 Codex 协议锁定文件，请先运行 update:codex-protocol");
  }
  if (expected !== protocolSerialized)
    throw new Error(
      "Codex App Server 协议与锁定快照不一致，必须单独审核并更新",
    );
}

process.stdout.write(
  `已准备 Codex ${lock.version}（${triple}，SHA-256 ${sha256}）\n`,
);
