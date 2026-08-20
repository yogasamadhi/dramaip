import { bootRuntime, loadProfile, type RuntimeHandle } from "@dramaip/runtime";

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
};

interface StartCommand {
  type: "start";
  databasePath: string;
  profilePath: string;
  hostname: string;
  port: number;
  accessToken: string;
  allowedOrigins: readonly string[];
  engineMcpTokens?: readonly string[];
  host?: { baseUrl: string; accessToken: string };
  alpha3AgentCutover?: {
    backupDirectory: string;
    alpha2Version?: string;
  };
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("Core Runtime must run in an Electron utilityProcess");

let runtime: RuntimeHandle | undefined;

async function verifyHealth(hostname: string, port: number): Promise<void> {
  const response = await fetch(`http://${hostname}:${port}/health`);
  const health = (await response.json()) as {
    healthy?: unknown;
    apiVersion?: unknown;
  };
  if (!response.ok || health.healthy !== true || health.apiVersion !== "2")
    throw new Error(
      "Core Runtime health check failed before cutover completion",
    );
}

parentPort.on("message", (event) => {
  const command = event.data as Partial<StartCommand> | { type: "stop" };
  if (command.type === "start") void start(command as StartCommand);
  if (command.type === "stop") void stop();
});

async function start(command: StartCommand): Promise<void> {
  try {
    if (runtime) throw new Error("Core Runtime is already running");
    runtime = await bootRuntime({
      databasePath: command.databasePath,
      profile: loadProfile(command.profilePath),
      accessToken: command.accessToken,
      allowedOrigins: command.allowedOrigins,
      engineMcpTokens: command.engineMcpTokens,
      host: command.host,
      runtimeKind: "node",
      mode: command.host ? "desktop" : "headless",
      alpha3AgentCutover: command.alpha3AgentCutover,
    });
    runtime.start({ hostname: command.hostname, port: command.port });
    await verifyHealth(command.hostname, command.port);
    runtime.finalizeCutover();
    parentPort!.postMessage({
      type: "runtime:ready",
      runtimeId: runtime.runtimeInfo.runtimeId,
      runtimeVersion: runtime.runtimeInfo.runtimeVersion,
      apiVersion: runtime.runtimeInfo.apiVersion,
    });
  } catch (error) {
    await runtime?.stop().catch(() => undefined);
    runtime = undefined;
    parentPort!.postMessage({
      type: "runtime:error",
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function stop(): Promise<void> {
  await runtime?.stop();
  runtime = undefined;
  parentPort!.postMessage({ type: "stopped" });
}
