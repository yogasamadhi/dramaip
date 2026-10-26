#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.versions.node !== "24.18.0")
  throw new Error("Electron E2E requires Node 24.18.0");

const taskRequire = createRequire(import.meta.url);
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const electronExecutable = desktopRequire("electron") as string;
const playwrightCli = taskRequire.resolve("@playwright/test/cli");
const bootstrap = fileURLToPath(
  new URL("./run-playwright-electron-node.cjs", import.meta.url),
);
const child = spawn(
  electronExecutable,
  [bootstrap, playwrightCli, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DRAMAIP_DEBUG_BACKGROUND: "1",
    },
  },
);
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
