import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));

function resolveExecutable(name) {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((extension) => extension.toLowerCase())
      : [""];
  const hasWindowsExtension = extensions.some((extension) =>
    name.toLowerCase().endsWith(extension),
  );
  for (const entry of pathEntries) {
    const directory = entry.replace(/^"|"$/gu, "");
    for (const extension of hasWindowsExtension ? [""] : extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        accessSync(
          candidate,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

// pnpm exposes workspace binaries through its own resolver, so the dev server
// is started through the package manager instead of a raw binary path.
const pnpm = resolveExecutable("pnpm") ?? "pnpm";
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
      pnpm,
      [
        "--filter",
        "@dramaip/desktop",
        "exec",
        "electron-vite",
        "dev",
        ...process.argv.slice(2),
      ],
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
