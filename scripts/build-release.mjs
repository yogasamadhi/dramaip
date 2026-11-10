// Build the exact optimized artifacts consumed by electron-builder. Every
// transformation happens before desktop-runtime.json is signed/verified.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env, DRAMAIP_RELEASE: "1" };
delete env.ELECTRON_RUN_AS_NODE;
function run(command, args) {
  const child = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
function node(...args) {
  run(process.execPath, args);
}
function pnpm(...args) {
  if (process.env.npm_execpath) node(process.env.npm_execpath, ...args);
  else run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args);
}
node("--import", "tsx", "scripts/generate-typert.mjs");
node("scripts/build-infra-clients.mjs");
pnpm("--filter", "@dramaip/web", "run", "build");
pnpm("--filter", "@dramaip/desktop", "exec", "electron-vite", "build");
node("apps/desktop/scripts/prepare-pi-runtime.mjs", "--release");
node("apps/desktop/scripts/verify-pi-runtime.mjs");
node("scripts/build-runtime.mjs", "--release");
node(
  "scripts/check-desktop-runtime.mjs",
  resolve(root, process.env.DRAMAIP_RUNTIME_BUILD ?? "build/runtime"),
);
