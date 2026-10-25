import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PI_VERSION = "1.4.0";
const here = dirname(fileURLToPath(import.meta.url));
const desktopApp = resolve(here, "..");
const desktop = resolve(desktopApp, "../..");
const repository = resolve(desktop, "..");
const source = join(repository, "vendor/pi");
const lockPath = join(repository, "vendor/pi.lock.json");
const adapter = join(desktopApp, "pi-adapter/dramaip-pi-runtime.ts");
const adapterTsconfig = join(desktopApp, "pi-adapter/tsconfig.json");
const output = join(desktopApp, "build/pi");
const runtimeEntry = join(output, "runtime.mjs");

for (const [path, label] of [
  [join(source, "package-lock.json"), "Pi package-lock.json"],
  [join(source, "packages/agent/src/agent.ts"), "Pi Agent"],
  [join(source, "packages/ai/src/index.ts"), "Pi AI"],
  [lockPath, "Pi 引擎锁"],
  [adapter, "DramaIP Pi 适配器"],
  [adapterTsconfig, "DramaIP Pi 类型检查配置"],
])
  if (!existsSync(path)) throw new Error(`${label}不存在`);

const engineLock = JSON.parse(await readFile(lockPath, "utf8"));
if (engineLock.version !== PI_VERSION)
  throw new Error(`Pi 引擎锁版本必须为 ${PI_VERSION}`);

if (!runtimeDependenciesReady()) {
  await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: source,
  });
}

await run(
  process.execPath,
  [join(source, "node_modules/typescript/bin/tsc"), "-p", adapterTsconfig],
  { cwd: desktop },
);

const esbuildPath = join(source, "node_modules/esbuild/lib/main.js");
const esbuild = await import(pathToFileURL(esbuildPath).href);
if (relative(desktopApp, output).startsWith("..") || output === desktopApp)
  throw new Error(`拒绝清理不安全的 Pi 输出目录：${output}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o755 });
await esbuild.build({
  entryPoints: [adapter],
  outfile: runtimeEntry,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22.19",
  packages: "bundle",
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: 'import { createRequire as __dramaipCreateRequire } from "node:module"; const require = __dramaipCreateRequire(import.meta.url);',
  },
  alias: {
    "@earendil-works/pi-ai": join(source, "packages/ai/src/index.ts"),
    "@earendil-works/pi-telemetry": join(
      source,
      "packages/telemetry/src/index.ts",
    ),
  },
});

const runtime = await readFile(runtimeEntry);
await writeFile(
  join(output, "runtime-manifest.json"),
  `${JSON.stringify(
    {
      engine: "pi",
      version: PI_VERSION,
      node: ">=22.19.0",
      entry: "runtime.mjs",
      sourceTreeSha256: engineLock.sourceTreeSha256,
      runtimeSha256: createHash("sha256").update(runtime).digest("hex"),
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`已准备 Pi ${PI_VERSION} Runtime（${output}）\n`);

function runtimeDependenciesReady() {
  return [
    "esbuild/lib/main.js",
    "openai/package.json",
    "@anthropic-ai/sdk/package.json",
    "@google/genai/package.json",
    "typebox/package.json",
  ].every((path) => existsSync(join(source, "node_modules", path)));
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${command} 执行失败（退出码 ${code ?? "unknown"}）`));
    });
  });
}
