#!/usr/bin/env node

/** Start the DramaIP Web, Admin and Mobile clients in development mode. */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createSocket } from "node:dgram";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIRECTORY = join(SCRIPT_DIRECTORY, "platform", "clients");
const CLIENT_INSTALL_MARKER = join(CLIENTS_DIRECTORY, "node_modules", ".bin");
const WEB_APP_DIRECTORY = join(CLIENTS_DIRECTORY, "apps", "web");
const ADMIN_APP_DIRECTORY = join(CLIENTS_DIRECTORY, "apps", "admin");
const MOBILE_APP_DIRECTORY = join(CLIENTS_DIRECTORY, "apps", "mobile");
const SDK_DIRECTORY = join(CLIENTS_DIRECTORY, "packages", "sdk");

const NODE_MINIMUM_MAJOR = 20;
const REQUIRED_PNPM_VERSION = "11.28.5";
const GATEWAY_PORT = 8080;
const WEB_PORT = 3009;
const ADMIN_PORT = 3010;
// Expo defaults to 8081, which conflicts with the local Java identity service.
const MOBILE_PORT = 3011;
const DEV_ACCOUNT_EMAIL = "creator@example.com";
const DEV_ACCOUNT_PASSWORD = "password123";
const CURRENT_PID = process.pid;

const CLIENT_MODULE_CHECKS = [
  ["@dramaip/web", WEB_APP_DIRECTORY, ["zod", "@dramaip/sdk"]],
  ["@dramaip/admin", ADMIN_APP_DIRECTORY, ["vite", "react", "@dramaip/sdk"]],
  [
    "@dramaip/mobile",
    MOBILE_APP_DIRECTORY,
    ["expo", "expo-router", "@dramaip/sdk"],
  ],
  ["@dramaip/sdk", SDK_DIRECTORY, ["axios", "zod"]],
] as const;

const CLIENT_PORTS = [
  ["Web", WEB_PORT],
  ["Admin", ADMIN_PORT],
  ["Mobile Metro", MOBILE_PORT],
] as const;

type InstallMode = "auto" | "force" | "skip";
type MobileTarget = "ios" | "android" | "none";

interface Options {
  readonly installMode: InstallMode;
  readonly killPorts: boolean;
  readonly apiBaseUrl: string;
  readonly mobileTarget: MobileTarget;
}

interface ManagedClient {
  readonly name: string;
  readonly label: string;
  readonly port: number;
  readonly process: ChildProcess;
}

interface CapturedResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

let shutdownSignal: NodeJS.Signals | undefined;
let resolveShutdown: (() => void) | undefined;
const shutdownRequested = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

function color(code: string, message: string): string {
  return process.stdout.isTTY ? `\u001B[${code}m${message}\u001B[0m` : message;
}

function info(message: string): void {
  process.stdout.write(`${color("36", "* ")}${message}\n`);
}

function ok(message: string): void {
  process.stdout.write(`${color("32", "OK ")}${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${color("33", "! ")}${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestShutdown(signal: NodeJS.Signals): void {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  resolveShutdown?.();
}

function installShutdownHandlers(): void {
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => requestShutdown("SIGBREAK"));
  }
}

function shutdownReason(): string {
  return shutdownSignal ?? "Ctrl+C";
}

function runCaptured(
  command: readonly string[],
  cwd = CLIENTS_DIRECTORY,
): CapturedResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    shell: requiresCommandShell(command[0]),
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function commandOutput(
  command: readonly string[],
  cwd = CLIENTS_DIRECTORY,
): string | undefined {
  const result = runCaptured(command, cwd);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function resolveExecutable(name: string): string | undefined {
  const pathEntries = isAbsolute(name)
    ? [""]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean);
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
      const candidate = isAbsolute(name)
        ? name
        : join(directory, `${name}${extension}`);
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

function requiresCommandShell(executable: string): boolean {
  return process.platform === "win32" && /\.(?:bat|cmd)$/iu.test(executable);
}

async function runForeground(
  command: readonly string[],
  cwd = CLIENTS_DIRECTORY,
): Promise<void> {
  const child = spawn(command[0], command.slice(1), {
    cwd,
    shell: requiresCommandShell(command[0]),
    stdio: "inherit",
  });
  const result = await waitForExit(child);
  if (shutdownSignal) throw new ShutdownError();
  if (result.code !== 0) {
    const reason = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code ?? 1}`;
    fail(`Command failed with ${reason}: ${command.join(" ")}`);
  }
}

function help(): void {
  process.stdout.write(`
Start the DramaIP Web, Admin and Mobile development clients.

Usage:
  node run-platform-clients.ts [options]

Options:
  --install                 Force pnpm install before startup
  --no-install              Never install dependencies automatically
  --no-kill-ports           Fail instead of stopping processes on client ports
  --api-base-url <url>      Java Gateway origin (default: http://localhost:8080)
  --mobile-target <target>  ios, android or none (default: none)
  -h, --help                Show this help
`);
}

export function parseClientArguments(
  arguments_: readonly string[],
): Options | undefined {
  let install = false;
  let noInstall = false;
  let killPorts = true;
  let apiBaseUrl = `http://localhost:${GATEWAY_PORT}`;
  let mobileTarget: MobileTarget = "none";

  const takeValue = (argument: string, index: number): [string, number] => {
    const equals = argument.indexOf("=");
    if (equals >= 0) return [argument.slice(equals + 1), index];
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    return [value, index + 1];
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "-h" || argument === "--help") {
      help();
      return undefined;
    }
    if (argument === "--install") install = true;
    else if (argument === "--no-install") noInstall = true;
    else if (argument === "--no-kill-ports") killPorts = false;
    else if (
      argument === "--api-base-url" ||
      argument.startsWith("--api-base-url=")
    ) {
      const [value, consumed] = takeValue(argument, index);
      apiBaseUrl = value;
      index = consumed;
    } else if (
      argument === "--mobile-target" ||
      argument.startsWith("--mobile-target=")
    ) {
      const [value, consumed] = takeValue(argument, index);
      if (value !== "ios" && value !== "android" && value !== "none") {
        fail(
          `invalid --mobile-target: ${value} (expected ios, android or none)`,
        );
      }
      mobileTarget = value;
      index = consumed;
    } else fail(`unknown argument: ${argument}`);
  }

  if (install && noInstall)
    fail("--install and --no-install cannot be used together");
  return {
    installMode: install ? "force" : noInstall ? "skip" : "auto",
    killPorts,
    apiBaseUrl,
    mobileTarget,
  };
}

function checkLayout(): void {
  const missing = [
    CLIENTS_DIRECTORY,
    WEB_APP_DIRECTORY,
    ADMIN_APP_DIRECTORY,
    MOBILE_APP_DIRECTORY,
    SDK_DIRECTORY,
  ].filter((path) => !existsSync(path));
  if (missing.length > 0)
    fail(
      `Missing client paths:\n${missing.map((path) => `  ${path}`).join("\n")}`,
    );
  ok("client layout found");
}

function checkNode(): string {
  const node = resolveExecutable("node");
  if (!node) fail("Node.js is not available. Install Node.js >= 20 first.");
  const version = commandOutput([node, "--version"]);
  const major = Number.parseInt(
    version?.replace(/^v/u, "").split(".")[0] ?? "",
    10,
  );
  if (!version || !Number.isFinite(major))
    fail(`Cannot parse Node.js version: ${version ?? "unknown"}`);
  if (major < NODE_MINIMUM_MAJOR) {
    fail(
      `Node.js version is too old: ${version}. Need >= v${NODE_MINIMUM_MAJOR}.`,
    );
  }
  ok(`node ${version}`);
  return node;
}

function checkPnpm(): string {
  const pnpm = resolveExecutable("pnpm");
  // The version is read from the clients workspace so the package manager
  // resolves the pinned `packageManager` field of that workspace.
  const version = pnpm
    ? commandOutput([pnpm, "--version"], CLIENTS_DIRECTORY)
    : undefined;
  if (!pnpm || version !== REQUIRED_PNPM_VERSION) {
    fail(
      `pnpm version mismatch: found ${version ?? "unknown"}, need ${REQUIRED_PNPM_VERSION}.`,
    );
  }
  ok(`pnpm ${version}`);
  return pnpm;
}

function clientModulesResolve(node: string): boolean {
  if (!existsSync(CLIENT_INSTALL_MARKER)) return false;
  for (const [packageName, packageDirectory, modules] of CLIENT_MODULE_CHECKS) {
    for (const moduleName of modules) {
      const result = runCaptured(
        [
          node,
          "-e",
          "require.resolve(process.argv[1], { paths: [process.argv[2]] })",
          moduleName,
          packageDirectory,
        ],
        CLIENTS_DIRECTORY,
      );
      if (result.status !== 0) {
        warn(
          `${packageName} cannot resolve ${moduleName}; reinstalling clients dependencies.`,
        );
        return false;
      }
    }
  }
  return true;
}

async function ensureClientDependencies(
  pnpm: string,
  node: string,
  mode: InstallMode,
): Promise<void> {
  if (mode === "skip") {
    warn("Skipping clients dependency install.");
    return;
  }
  if (mode !== "force" && clientModulesResolve(node)) {
    ok("clients dependencies already installed");
    return;
  }
  info("Installing clients dependencies with pnpm install...");
  await runForeground([pnpm, "install"]);
  if (!clientModulesResolve(node))
    fail("Clients dependencies are still incomplete after pnpm install.");
  ok("clients dependencies ready");
}

function listeningPids(port: number): number[] {
  if (process.platform === "win32") {
    const result = runCaptured(
      ["netstat", "-ano", "-p", "TCP"],
      SCRIPT_DIRECTORY,
    );
    if (result.status !== 0) {
      warn(`netstat failed while checking port ${port}.`);
      return [];
    }
    const pids: number[] = [];
    for (const line of result.stdout.split(/\r?\n/u)) {
      const fields = line.trim().split(/\s+/u);
      if (
        fields.length < 5 ||
        fields[0].toUpperCase() !== "TCP" ||
        fields.at(-2)?.toUpperCase() !== "LISTENING" ||
        fields[1].split(":").at(-1) !== String(port)
      ) {
        continue;
      }
      const pid = Number.parseInt(fields.at(-1) ?? "", 10);
      if (Number.isFinite(pid) && pid !== CURRENT_PID && !pids.includes(pid))
        pids.push(pid);
    }
    return pids;
  }

  const lsof = resolveExecutable("lsof");
  if (!lsof) {
    warn("lsof was not found; cannot detect processes by port.");
    return [];
  }
  const result = runCaptured(
    [lsof, "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    SCRIPT_DIRECTORY,
  );
  if (result.status !== 0 && result.status !== 1) {
    warn(`lsof failed while checking port ${port}.`);
    return [];
  }
  return [...new Set(result.stdout.split(/\s+/u).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && pid !== CURRENT_PID,
  );
}

function processExists(pid: number): boolean {
  if (process.platform === "win32") {
    const result = runCaptured(
      ["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      SCRIPT_DIRECTORY,
    );
    return (
      result.status === 0 &&
      result.stdout.split(/\r?\n/u).some((line) => {
        const columns = [...line.matchAll(/"([^"]*)"/gu)].map(
          (match) => match[1],
        );
        return columns[1]?.trim() === String(pid);
      })
    );
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function processCommand(pid: number): string {
  const command =
    process.platform === "win32"
      ? ["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]
      : ["ps", "-p", String(pid), "-o", "command="];
  const result = runCaptured(command, SCRIPT_DIRECTORY);
  return result.status === 0 ? result.stdout.trim() : "";
}

function isDockerProcess(pid: number): boolean {
  const command = processCommand(pid).toLowerCase();
  return ["com.docker", "docker-proxy", "dockerd", "vpnkit"].some((marker) =>
    command.includes(marker),
  );
}

async function killPids(pids: readonly number[], label: string): Promise<void> {
  const targets = pids.filter((pid) => !isDockerProcess(pid));
  const dockerPids = pids.filter((pid) => !targets.includes(pid));
  if (dockerPids.length > 0) {
    warn(
      `${label} has Docker PID(s) ${dockerPids.join(", ")}; leaving them running.`,
    );
  }
  if (targets.length === 0) return;

  warn(`${label} is occupied by PID(s) ${targets.join(", ")}; stopping them.`);
  for (const pid of targets) {
    if (process.platform === "win32") {
      const result = runCaptured(
        ["taskkill", "/PID", String(pid), "/T", "/F"],
        SCRIPT_DIRECTORY,
      );
      if (result.status !== 0 && processExists(pid)) {
        fail(
          `No permission to force stop PID ${pid} for ${label}: ${(result.stderr || result.stdout).trim()}`,
        );
      }
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH")
          fail(`No permission to stop PID ${pid} for ${label}.`);
      }
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && targets.some(processExists)) await sleep(200);
  const remaining = targets.filter(processExists);
  if (remaining.length > 0) {
    warn(`${label} did not stop after SIGTERM; forcing termination.`);
    for (const pid of remaining) {
      if (process.platform === "win32") {
        const result = runCaptured(
          ["taskkill", "/PID", String(pid), "/T", "/F"],
          SCRIPT_DIRECTORY,
        );
        if (result.status !== 0 && processExists(pid))
          fail(`No permission to force stop PID ${pid} for ${label}.`);
      } else {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            fail(`No permission to force stop PID ${pid} for ${label}.`);
          }
        }
      }
    }
  }
  if (targets.some(processExists)) fail(`PID(s) still occupy ${label}.`);
  ok(`${label} is free`);
}

async function releasePort(
  port: number,
  label: string,
  killPorts: boolean,
): Promise<void> {
  const pids = listeningPids(port);
  if (pids.length === 0) return;
  if (!killPorts)
    fail(`${label} port ${port} is occupied by PID(s) ${pids.join(", ")}.`);
  await killPids(pids, `${label} port ${port}`);
  const remaining = listeningPids(port);
  if (remaining.length > 0) {
    fail(
      `${label} port ${port} is still occupied by PID(s) ${remaining.join(", ")}.`,
    );
  }
}

async function startClient(
  name: string,
  label: string,
  port: number,
  command: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<ManagedClient> {
  info(`Starting ${name}: ${command.join(" ")}`);
  const child = spawn(command[0], command.slice(1), {
    cwd: CLIENTS_DIRECTORY,
    detached: true,
    env: environment,
    shell: requiresCommandShell(command[0]),
    stdio: ["ignore", "inherit", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return { name, label, port, process: child };
}

async function stopClient(client: ManagedClient): Promise<void> {
  const child = client.process;
  if (child.exitCode !== null || child.signalCode !== null) return;
  warn(`Stopping ${client.name}...`);

  if (process.platform === "win32") {
    const result = runCaptured(
      ["taskkill", "/PID", String(child.pid), "/T", "/F"],
      SCRIPT_DIRECTORY,
    );
    if (result.status !== 0 && child.pid && processExists(child.pid)) {
      fail(
        `Could not stop ${client.name} process tree (PID ${child.pid}): ${(result.stderr || result.stdout).trim()}`,
      );
    }
  } else if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        child.kill("SIGTERM");
    }
  }

  if (!(await waitForExitWithTimeout(child, 8_000))) {
    warn(`Killing ${client.name}...`);
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    } else child.kill("SIGKILL");
    await waitForExitWithTimeout(child, 2_000);
  }
}

async function cleanupClients(
  clients: readonly ManagedClient[],
): Promise<void> {
  const errors: string[] = [];
  for (const client of [...clients].reverse()) {
    try {
      await stopClient(client);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  for (const client of clients) {
    try {
      await releasePort(client.port, client.label, true);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (errors.length > 0) fail(errors.join("; "));
  ok(
    `Client processes stopped; port(s) ${clients.map(({ port }) => port).join(", ")} are free`,
  );
}

async function lanIp(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (value?: string): void => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // The socket may fail before its implicit bind completes.
      }
      resolve(value);
    };
    socket.once("error", () => finish());
    socket.connect(80, "8.8.8.8", () => {
      const address = socket.address();
      finish(typeof address === "object" ? address.address : undefined);
    });
  });
}

function qrCodeTerminalRoot(): string | undefined {
  const hoisted = join(CLIENTS_DIRECTORY, "node_modules", "qrcode-terminal");
  if (existsSync(hoisted) && statSync(hoisted).isDirectory()) return hoisted;
  const store = join(CLIENTS_DIRECTORY, "node_modules", ".pnpm");
  if (!existsSync(store)) return undefined;
  for (const entry of readdirSync(store).sort()) {
    if (!entry.startsWith("qrcode-terminal@")) continue;
    const candidate = join(store, entry, "node_modules", "qrcode-terminal");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function printExpoGoQr(node: string): Promise<void> {
  const ip = await lanIp();
  if (!ip) {
    warn(
      "Could not detect a LAN IP; Expo Go on a physical device needs one on the same network.",
    );
    return;
  }
  const url = `exp://${ip}:${MOBILE_PORT}`;
  info(
    "Expo Go (physical device, same Wi-Fi): scan this QR in the Expo Go app, or enter the URL",
  );
  process.stdout.write(`  ${url}\n`);
  const root = qrCodeTerminalRoot();
  if (!root) {
    warn(
      "qrcode-terminal not found under node_modules; run with --install to render the QR art.",
    );
    return;
  }
  const script =
    "const qt=require(process.argv[1]);qt.generate(process.argv[2],{small:true},q=>process.stdout.write(q+'\\n'));";
  const result = runCaptured([node, "-e", script, root, url]);
  if (result.status !== 0 || !result.stdout) {
    warn(
      "Failed to render the Expo Go QR; open the URL above in Expo Go instead.",
    );
    return;
  }
  process.stdout.write(`\n${result.stdout}\n`);
}

async function watchClients(
  clients: readonly ManagedClient[],
  apiBaseUrl: string,
  mobileTarget: MobileTarget,
  node: string,
): Promise<number> {
  ok("Web, Admin, and Mobile clients started");
  process.stdout.write(`Web: http://localhost:${WEB_PORT}\n`);
  process.stdout.write(`Admin: http://localhost:${ADMIN_PORT}\n`);
  process.stdout.write(`Mobile Metro: http://localhost:${MOBILE_PORT}\n`);
  if (mobileTarget === "ios") {
    process.stdout.write(
      "Expo Go: launching on iOS Simulator (use --mobile-target android|none to change)\n",
    );
  } else if (mobileTarget === "android") {
    process.stdout.write(
      "Expo Go: launching on Android emulator (use --mobile-target ios|none to change)\n",
    );
  }
  await printExpoGoQr(node);
  process.stdout.write(`Gateway: ${apiBaseUrl}\n`);
  process.stdout.write(
    `Dev account: ${DEV_ACCOUNT_EMAIL} / ${DEV_ACCOUNT_PASSWORD}\n`,
  );
  process.stdout.write(
    "Press Ctrl+C to stop all clients. The Java platform stack stays running.\n",
  );

  const alive = [...clients];
  let exitCode = 0;
  while (alive.length > 0) {
    if (shutdownSignal) {
      process.stdout.write("\n");
      warn(`Received ${shutdownReason()}.`);
      return 0;
    }
    for (const client of [...alive]) {
      const code = childExitCode(client.process);
      if (code === undefined) continue;
      warn(
        `${client.name} exited with code ${code}; remaining clients keep running.`,
      );
      exitCode ||= code || 1;
      alive.splice(alive.indexOf(client), 1);
    }
    await Promise.race([sleep(500), shutdownRequested]);
  }
  warn("All clients have exited.");
  return exitCode;
}

function childExitCode(child: ChildProcess): number | undefined {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return 1;
  return undefined;
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForExitWithTimeout(
  child: ChildProcess,
  timeout: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    waitForExit(child).then(() => true),
    sleep(timeout).then(() => false),
  ]);
}

class ShutdownError extends Error {}

export async function main(
  arguments_ = process.argv.slice(2),
): Promise<number> {
  const options = parseClientArguments(arguments_);
  if (!options) return 0;

  const clients: ManagedClient[] = [];
  let exitCode = 0;
  try {
    checkLayout();
    installShutdownHandlers();
    const node = checkNode();
    const pnpm = checkPnpm();
    await ensureClientDependencies(pnpm, node, options.installMode);

    for (const [label, port] of CLIENT_PORTS)
      await releasePort(port, label, options.killPorts);

    const webEnvironment = { ...process.env };
    webEnvironment.NEXT_PUBLIC_API_BASE_URL = "";
    webEnvironment.DRAMAIP_WEB_API_PROXY_TARGET = options.apiBaseUrl;
    webEnvironment.NEXT_PUBLIC_PAYMENT_MODE ??= "simulated";

    const adminEnvironment = {
      ...process.env,
      VITE_ADMIN_API_BASE_URL: options.apiBaseUrl,
    };
    const mobileEnvironment = {
      ...process.env,
      EXPO_PUBLIC_MOBILE_API_ORIGIN: options.apiBaseUrl,
      EXPO_PUBLIC_API_BASE_URL: options.apiBaseUrl,
    };
    const mobileCommand = [
      pnpm,
      "--filter",
      "@dramaip/mobile",
      "run",
      "start",
      "--",
      "--port",
      String(MOBILE_PORT),
      ...(options.mobileTarget === "none" ? [] : [`--${options.mobileTarget}`]),
    ];
    const commands = [
      [
        "clients:web",
        "Web",
        WEB_PORT,
        [pnpm, "--filter", "@dramaip/web", "run", "dev"],
        webEnvironment,
      ],
      [
        "clients:admin",
        "Admin",
        ADMIN_PORT,
        [pnpm, "--filter", "@dramaip/admin", "run", "dev"],
        adminEnvironment,
      ],
      [
        "clients:mobile",
        "Mobile Metro",
        MOBILE_PORT,
        mobileCommand,
        mobileEnvironment,
      ],
    ] as const;

    for (const [name, label, port, command, environment] of commands) {
      const client = await startClient(name, label, port, command, environment);
      clients.push(client);
      await Promise.race([sleep(800), shutdownRequested]);
      if (shutdownSignal) throw new ShutdownError();
      const code = childExitCode(client.process);
      if (code !== undefined)
        fail(`${name} exited during startup with code ${code}.`);
    }
    exitCode = await watchClients(
      clients,
      options.apiBaseUrl,
      options.mobileTarget,
      node,
    );
  } catch (error) {
    if (error instanceof ShutdownError) {
      warn(`Received ${shutdownReason()}; client startup cancelled.`);
      exitCode = 0;
    } else {
      process.stderr.write(
        `${color("31", "ERR ")}${(error as Error).message}\n`,
      );
      exitCode = 1;
    }
  } finally {
    if (clients.length > 0) {
      try {
        await cleanupClients(clients);
      } catch (error) {
        process.stderr.write(
          `${color("31", "ERR ")}${(error as Error).message}\n`,
        );
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exitCode = await main();
}
