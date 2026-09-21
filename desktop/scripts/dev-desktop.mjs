import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const desktop = fileURLToPath(new URL("../", import.meta.url));
const watcher = spawn(
  process.execPath,
  ["scripts/build-runtime.mjs", "--watch"],
  { cwd: desktop, stdio: ["ignore", "pipe", "inherit"] },
);
await new Promise((resolve, reject) => {
  watcher.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (String(chunk).includes("Watching ")) resolve();
  });
  watcher.once("error", reject);
  watcher.once("exit", (code) =>
    reject(new Error(`Runtime watcher exited ${code}`)),
  );
});
const standalone = process.argv[2] === "--runtime";
const app = standalone
  ? spawn(
      process.execPath,
      [
        "scripts/run-node.mjs",
        "scripts/runtime-supervisor.mjs",
        "--dev",
        ...process.argv.slice(3),
      ],
      { cwd: desktop, stdio: "inherit" },
    )
  : spawn(
      process.execPath,
      ["--bun", "run", "electron-vite", "dev", ...process.argv.slice(2)],
      {
        cwd: fileURLToPath(new URL("../apps/desktop/", import.meta.url)),
        stdio: "inherit",
      },
    );
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  watcher.kill("SIGTERM");
  app.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
app.once("exit", (code) => {
  stop();
  process.exitCode = code ?? 1;
});
watcher.once("exit", () => {
  if (!stopping) {
    stop();
    process.exitCode = 1;
  }
});
