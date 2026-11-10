import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
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

// pnpm runs the workspace scripts the dev server needs first.
const pnpm = resolveExecutable("pnpm") ?? "pnpm";

// Electron must not start in Node mode, so the flag never reaches the shell.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

/** Run one pnpm command to completion. */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      cwd: desktop,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pnpm ${args.join(" ")} exited ${code}`)),
    );
  });
}

// The shell serves the built web entry; the Host runs its sources through tsx,
// so the web entry is the only thing to build before electron-vite starts.
await run(["--filter", "@dramaip/web", "run", "build"]);
// electron-vite and the Electron app it starts run in their own process
// group, and stopping this script signals the whole group: electron-vite
// alone exits without stopping Electron, and pnpm exec passes nothing on.
const shell = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const manifest = createRequire(join(shell, "package.json")).resolve(
  "electron-vite/package.json",
);
const app = spawn(
  process.execPath,
  [
    join(
      dirname(manifest),
      JSON.parse(readFileSync(manifest, "utf8")).bin["electron-vite"],
    ),
    "dev",
    ...process.argv.slice(2),
  ],
  {
    cwd: shell,
    env: environment,
    stdio: "inherit",
    detached: process.platform !== "win32",
  },
);
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  try {
    if (process.platform === "win32") app.kill(signal);
    else process.kill(-app.pid, signal);
  } catch {
    // The group has already exited.
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => stop(signal));
app.once("exit", (code) => {
  stop();
  process.exitCode = code ?? 1;
});
