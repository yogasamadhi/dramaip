import { spawn, spawnSync } from "node:child_process";
const executable = process.env.DRAMAIP_NODE_PATH || "node";
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const probe = spawnSync(executable, ["--version"], {
  env: environment,
  encoding: "utf8",
});
if (probe.status !== 0 || probe.stdout.trim() !== "v24.18.0")
  throw new Error(
    `Desktop Node tasks require Node 24.18.0; found ${probe.stdout?.trim() || probe.error?.message || "no Node executable"}`,
  );
const child = spawn(executable, process.argv.slice(2), {
  env: environment,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
