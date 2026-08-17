import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(
  process.env.DRAMAIP_GROK_RUNTIME_ROOT ||
    join(desktop, "build/grok/aarch64-apple-darwin"),
);
if (process.platform !== "darwin" || process.arch !== "arm64") {
  process.stderr.write(
    "Grok Runtime 当前仅支持 macOS arm64；跳过本机 Runtime 校验，桌面端将显示为不可用。\n",
  );
  process.exit(0);
}
const manifest = JSON.parse(
  await readFile(join(root, "runtime-manifest.json"), "utf8"),
);
if (
  manifest.engine !== "grok" ||
  manifest.version !== "1.0.5" ||
  manifest.target !== "aarch64-apple-darwin" ||
  manifest.rustToolchain !== "1.94.0" ||
  !/^[a-f0-9]{64}$/.test(manifest.binarySha256 ?? "") ||
  !/^[a-f0-9]{64}$/.test(manifest.sourceTreeSha256 ?? "")
)
  throw new Error("Grok Runtime 清单无效");
const executable = join(root, manifest.entry);
if (!existsSync(executable)) throw new Error("Grok Runtime 缺少入口");
const actual = createHash("sha256")
  .update(await readFile(executable))
  .digest("hex");
if (actual !== manifest.binarySha256)
  throw new Error(`Grok Runtime 二进制校验失败：${actual}`);
try {
  await promisify(execFile)("codesign", ["--verify", "--strict", executable]);
} catch (error) {
  throw new Error(
    `Grok Runtime 的 macOS 签名无效：${error instanceof Error ? error.message : String(error)}`,
  );
}
process.stdout.write("Grok Build 1.0.5 Runtime 校验通过\n");
