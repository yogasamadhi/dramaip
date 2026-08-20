#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RuntimeKind } from "@dramaip/contracts";
import { ServerConnectionManager } from "@dramaip/server-connection";
import { bootRuntime, loadProfile } from "./index.js";

interface CliOptions {
  databasePath: string;
  profileName: string;
  hostname: string;
  port: number;
  runtimeKind: RuntimeKind;
}

function parseArguments(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--"))
      throw new Error(`Unknown argument: ${key ?? ""}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${key}`);
    values.set(key.slice(2), value);
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
    runtimeKind: (() => {
      const value =
        values.get("runtime") ?? process.env.DRAMAIP_RUNTIME_KIND ?? "node";
      if (value !== "node" && value !== "bun")
        throw new Error("Runtime must be node or bun");
      return value;
    })(),
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
  databasePath: options.databasePath,
  profile: loadProfile(profilePath),
  accessToken: process.env.DRAMAIP_RUNTIME_TOKEN,
  runtimeKind: options.runtimeKind,
  mode: options.profileName === "server" ? "server" : "headless",
  alpha3AgentCutover: {
    backupDirectory: resolve(dirname(options.databasePath), "backups"),
  },
});
runtime.start({ hostname: options.hostname, port: options.port });
const healthResponse = await fetch(
  `http://${options.hostname}:${options.port}/health`,
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
  `DramaIP Runtime listening on http://${options.hostname}:${options.port}\n`,
);
process.stdout.write(`DRAMAIP_RUNTIME_TOKEN=${runtime.accessToken}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () => void runtime.stop().finally(() => process.exit(0)),
  );
