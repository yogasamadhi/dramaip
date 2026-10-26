import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopRoot } from "./dsh-framework.mjs";

if (process.versions.node !== "24.18.0" || process.versions.bun)
  throw new Error("Build watcher tests require Node 24.18.0");
const output = await mkdtemp(join(tmpdir(), "dramaip-runtime-watch-"));
const name = `cordis_watch_probe_${randomUUID().replaceAll("-", "")}`;
const source = join(desktopRoot, "plugins/system/src", `${name}.ts`);
const target = join(output, "plugins/system/src", `${name}.js`);
const watcher = spawn(
  process.execPath,
  ["scripts/build-runtime.mjs", "--watch"],
  {
    cwd: desktopRoot,
    env: { ...process.env, DRAMAIP_RUNTIME_BUILD: output },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
watcher.stdout.on("data", (chunk) => {
  log += chunk;
});
watcher.stderr.on("data", (chunk) => {
  log += chunk;
});
const exited = new Promise((resolve) => watcher.once("exit", resolve));
async function until(check) {
  const deadline = Date.now() + 40000;
  while (!(await check())) {
    if (watcher.exitCode !== null || Date.now() > deadline)
      throw new Error(`Runtime source watcher failed: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  await until(() => log.includes("Watching "));
  const metadata = join(
    output,
    "packages/runtime/src/plugin-manifests.generated.json",
  );
  const entry = join(output, "packages/runtime/src/index.js");
  const stamps = async () =>
    Promise.all(
      [metadata, entry].map(async (path) =>
        String((await stat(path, { bigint: true })).mtimeNs),
      ),
    );
  const before = await stamps();
  const content = (kind) =>
    `import { RuntimeKind } from "@dramaip/contracts";\nexport const kind: RuntimeKind = "${kind}";\n`;
  await writeFile(source, content("node"), { flag: "wx" });
  await until(() => existsSync(target));
  assert.doesNotMatch(
    await readFile(target, "utf8"),
    /import /,
    "Type imports must be erased from ESM",
  );
  await writeFile(source, content("electron-node"));
  await until(async () =>
    (await readFile(target, "utf8")).includes("electron-node"),
  );
  assert.deepEqual(
    await stamps(),
    before,
    "Business module edits must not touch shared modules or metadata and trigger full restarts",
  );
  await rm(source);
  await until(() => !existsSync(target));
  console.log(
    "Runtime source watcher passed: added/changed/deleted modules, erased types, unchanged metadata and shared-module mtimes",
  );
} finally {
  await rm(source, { force: true });
  watcher.kill("SIGTERM");
  const timeout = setTimeout(() => watcher.kill("SIGKILL"), 10000);
  await exited;
  clearTimeout(timeout);
  await rm(output, { recursive: true, force: true });
}
