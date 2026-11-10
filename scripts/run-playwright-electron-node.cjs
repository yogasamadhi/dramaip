"use strict";

const playwrightCli = process.argv[2];
if (!playwrightCli) throw new Error("Playwright CLI path is required");

delete process.env.ELECTRON_RUN_AS_NODE;
const cleanupRequire = `--require=${JSON.stringify(require.resolve("./clear-electron-run-as-node.cjs"))}`;
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, cleanupRequire]
  .filter(Boolean)
  .join(" ");
process.argv = [process.argv[0], playwrightCli, ...process.argv.slice(3)];
require(playwrightCli);
