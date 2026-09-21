#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { bootRuntime, loadProfile } from "./index.js";

interface CliOptions {
  databasePath: string;
  profileName: string;
  hostname: string;
  port: number;
}

function parseArguments(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set(["database", "profile", "host", "port"]);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--"))
      throw new Error(`Unknown argument: ${key ?? ""}`);
    const name = key.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown argument: ${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${key}`);
    values.set(name, value);
    index += 1;
  }
  const port = Number(values.get("port") ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  return {
    databasePath: resolve(values.get("database") ?? "dramaip.db"),
    profileName: values.get("profile") ?? "safe",
    hostname: values.get("host") ?? "127.0.0.1",
    port,
  };
}

const command = process.argv.slice(2);
const subcommand = command.shift() ?? "serve";
const options = parseArguments(command);
if (subcommand === "desktop") {
  process.stdout.write(
    "Use the Electron desktop application to start Desktop Mode.\n",
  );
  process.exit(0);
}
if (subcommand === "status" || subcommand === "diagnostics") {
  const manager = new ServerConnectionManager();
  const connection = await manager.attach({
    baseUrl: `http://${options.hostname}:${options.port}`,
    accessToken: process.env.DRAMAIP_RUNTIME_TOKEN ?? "",
    source: "attached",
  });
  process.stdout.write(
    `${JSON.stringify(subcommand === "status" ? connection.runtime : connection.runtime, null, 2)}\n`,
  );
  process.exit(0);
}
if (subcommand !== "serve") throw new Error(`Unknown command: ${subcommand}`);
const profilePath = resolve(
  process.env.DRAMAIP_PROFILE_DIRECTORY ??
    fileURLToPath(new URL("../../../profiles", import.meta.url)),
  `${options.profileName}.json`,
);
const runtime = await bootRuntime({
  development:
    process.env.DRAMAIP_RUNTIME_DEV === "1"
      ? {
          onRestart: (reason) => {
            console.warn(`Restarting Core Runtime: ${reason.message}`);
            setImmediate(
              () => void runtime.stop().finally(() => process.exit(75)),
            );
          },
        }
      : undefined,
  databasePath: options.databasePath,
  profile: loadProfile(profilePath),
  accessToken: process.env.DRAMAIP_RUNTIME_TOKEN,
  runtimeKind: "node",
  mode: options.profileName === "server" ? "server" : "headless",
  alpha3AgentCutover: {
    backupDirectory: resolve(dirname(options.databasePath), "backups"),
  },
  migrationWorker: {
    runtimeKind: "node",
    executable: process.execPath,
    entry: fileURLToPath(
      new URL("./migration-worker-process.js", import.meta.url),
    ),
  },
});
const server = await runtime.start({
  hostname: options.hostname,
  port: options.port,
});
const healthResponse = await fetch(
  `http://${server.hostname}:${server.port}/health`,
);
const health = (await healthResponse.json()) as {
  healthy?: unknown;
  apiVersion?: unknown;
};
if (
  !healthResponse.ok ||
  health.healthy !== true ||
  health.apiVersion !== "2"
) {
  await runtime.stop();
  throw new Error("Runtime health check failed before cutover completion");
}
runtime.finalizeCutover();
process.stdout.write(
  `DramaIP Runtime listening on http://${server.hostname}:${server.port}\n`,
);
process.stdout.write(`DRAMAIP_RUNTIME_TOKEN=${runtime.accessToken}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () => void runtime.stop().finally(() => process.exit(0)),
  );
