import { QuickJsExtensionSandbox } from "@dramaip/extension-host";

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", callback: (event: { data: unknown }) => void): void;
};

type StartCommand = {
  type: "start";
  generation: number;
  pluginId: string;
  revision: string;
  bundle: string;
  capabilityEndpoint: string;
  capabilityToken: string;
  limits: {
    memoryBytes: number;
    maximumConcurrentRequests: number;
    requestsPerMinute: number;
  };
};

type InvokeCommand = {
  type: "invoke";
  generation: number;
  requestId: string;
  handlerId: string;
  payload: unknown;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
const runtimeVersions = process.versions as Record<string, string | undefined>;
if (!parentPort || !runtimeVersions.electron || Boolean(runtimeVersions.bun))
  throw new Error("Extension Host must run as an Electron utility process");

let generation = 0;
let sandbox: QuickJsExtensionSandbox | undefined;

parentPort.on("message", (event) => {
  const command = event.data as
    StartCommand | InvokeCommand | { type: "stop"; generation: number };
  if (command.type === "start") return void start(command);
  if (command.type === "invoke") return void invoke(command);
  if (command.type === "stop" && command.generation === generation) stop();
});

async function start(command: StartCommand): Promise<void> {
  generation = command.generation;
  try {
    sandbox = await QuickJsExtensionSandbox.create({
      bundle: command.bundle,
      limits: command.limits,
      bridge: async (call) => {
        const response = await fetch(command.capabilityEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${command.capabilityToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(call),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw new Error(`Extension capability rejected: ${response.status}`);
        return response.status === 204 ? null : response.json();
      },
    });
    parentPort!.postMessage({
      type: "ready",
      generation,
      pluginId: command.pluginId,
      revision: command.revision,
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "error",
      generation,
      error: error instanceof Error ? error.message : String(error),
    });
    setTimeout(() => process.exit(1), 0).unref?.();
  }
}

async function invoke(command: InvokeCommand): Promise<void> {
  if (command.generation !== generation || !sandbox) return;
  try {
    const result = await sandbox.invoke(command.handlerId, command.payload);
    parentPort!.postMessage({
      type: "response",
      generation,
      requestId: command.requestId,
      result,
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "response",
      generation,
      requestId: command.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (sandbox?.diagnostics().state === "failed")
      setTimeout(() => process.exit(1), 0).unref?.();
  }
}

function stop(): void {
  sandbox?.dispose();
  sandbox = undefined;
  parentPort!.postMessage({ type: "stopped", generation });
}
