import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const codex = await readJson(join(root, "vendor/codex.lock.json"));
const protocol = await readJson(join(root, "vendor/codex.protocol.lock.json"));
const opencode = await readJson(join(root, "vendor/opencode.lock.json"));

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

process.stdout.write(
  `引擎锁定文件有效：OpenCode ${opencode.version}；Codex ${codex.version}（${requiredTriples.length} 个平台）\n`,
);
