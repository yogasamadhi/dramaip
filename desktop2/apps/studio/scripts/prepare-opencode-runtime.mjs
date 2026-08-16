import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, "..");
const sharedDesktop = resolve(studio, "../../../desktop");
const vendor = join(sharedDesktop, "vendor/opencode");
const lock = JSON.parse(
  await readFile(join(sharedDesktop, "vendor/opencode.lock.json"), "utf8"),
);
const source = join(vendor, "packages/opencode/dist/node");
const output = join(studio, "build/opencode");

if (
  lock.version !== "1.18.15" ||
  lock.runtimeEntry !== "packages/opencode/dist/node/node.js"
)
  throw new Error("OpenCode runtime lock is invalid");
if (!existsSync(join(source, "node.js")))
  throw new Error("共享 OpenCode 1.18.15 冻结运行文件不存在");
if (relative(studio, output).startsWith("..") || output === studio)
  throw new Error(`拒绝清理不安全的 OpenCode 输出目录：${output}`);

await rm(output, { recursive: true, force: true });
await cp(source, output, {
  recursive: true,
  dereference: true,
  filter: (path) => !path.includes(`${join(source, "node_modules")}`),
});

const vendorModules = join(vendor, "node_modules/.bun/node_modules");
for (const packageName of ["jsonc-parser", "@lydell/node-pty"]) {
  const dependency = await realpath(join(vendorModules, packageName));
  const destination = join(output, "node_modules", packageName);
  await mkdir(dirname(destination), { recursive: true });
  await cp(dependency, destination, { recursive: true, dereference: true });
}
const platformPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
const platformSource = await realpath(join(vendorModules, platformPackage));
const platformDestination = join(output, "node_modules", platformPackage);
await mkdir(dirname(platformDestination), { recursive: true });
await cp(platformSource, platformDestination, {
  recursive: true,
  dereference: true,
});

const runtimeSha256 = createHash("sha256")
  .update(await readFile(join(output, "node.js")))
  .digest("hex");
process.stdout.write(
  `已准备 OpenCode ${lock.version} Runtime（SHA-256 ${runtimeSha256}，${output}）\n`,
);
