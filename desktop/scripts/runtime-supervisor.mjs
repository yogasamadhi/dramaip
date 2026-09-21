import { restoreRuntimeArtifact } from "../build/runtime/packages/runtime-adapters/src/artifact-recovery.js";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.versions.node !== "24.18.0" || process.versions.bun)
  throw new Error("Standalone Core Runtime requires Node 24.18.0");
const args = process.argv.slice(2);
const development = args[0] === "--dev";
if (development) args.shift();
let child;
let stopping = false;
let failures = 0;
function start() {
  child = fork(
    fileURLToPath(
      new URL("../build/runtime/packages/runtime/src/cli.js", import.meta.url),
    ),
    args,
    {
      execArgv: development ? ["--expose-internals"] : [],
      env: { ...process.env, DRAMAIP_RUNTIME_DEV: development ? "1" : "0" },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    },
  );
  child.once("exit", async (code) => {
    if (!stopping && development && code === 75) return start();
    if (
      !stopping &&
      development &&
      code !== 0 &&
      failures++ < 3 &&
      (await restoreRuntimeArtifact(
        fileURLToPath(new URL("../build/runtime/", import.meta.url)),
      ))
    )
      return start();
    process.exitCode = code ?? 1;
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
start();
