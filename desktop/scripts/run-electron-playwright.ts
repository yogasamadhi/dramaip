#!/usr/bin/env bun
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.versions.bun !== "1.4.0")
  throw new Error("Electron E2E requires Bun 1.4.0");

const taskRequire = createRequire(import.meta.url);
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const electronExecutable = desktopRequire("electron") as string;
const playwrightCli = taskRequire.resolve("@playwright/test/cli");
const bootstrap = fileURLToPath(
  new URL("./run-playwright-electron-node.cjs", import.meta.url),
);
const child = Bun.spawn(
  [electronExecutable, bootstrap, playwrightCli, ...process.argv.slice(2)],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DRAMAIP_DEBUG_BACKGROUND: "1",
    },
  },
);

process.exitCode = await child.exited;
