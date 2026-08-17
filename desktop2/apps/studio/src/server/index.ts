import { join } from "node:path";
import { copyFile, unlink } from "node:fs/promises";

import { serve } from "@hono/node-server";

import { restoreEngineConfigurations } from "@dramaip/agents";
import type { EngineTokenMap } from "@dramaip/agents";
import {
  bootDramaRuntime,
  ParentPortEngineBridge,
  ParentPortFileCapabilityResolver,
  type ParentPortLike,
} from "@dramaip/runtime";

import studioProfile from "../../../../profiles/studio.json" with { type: "json" };
import e2eProfile from "../../../../profiles/e2e.json" with { type: "json" };

interface BootstrapMessage {
  type: "server:bootstrap";
  userData: string;
  username: string;
  password: string;
  allowedOrigins: string[];
  e2e: boolean;
  engineTokens: EngineTokenMap;
}

const parentPort = process.parentPort as unknown as ParentPortLike | undefined;
if (!parentPort)
  throw new Error("DramaIP server must run as an Electron utility process");
const utilityPort: ParentPortLike = parentPort;

let stop: (() => Promise<void>) | undefined;
let restoreEngines: (() => Promise<void>) | undefined;
let capabilityResolver: ParentPortFileCapabilityResolver | undefined;
let activeKernel: Awaited<ReturnType<typeof bootDramaRuntime>> | undefined;

utilityPort.on("message", (event) => {
  const raw = event.data;
  const message = raw as { type?: string };
  if (message.type === "server:bootstrap") void start(raw as BootstrapMessage);
  if (message.type === "server:stop") void stop?.();
  if (message.type === "server:engines-ready") void restoreEngines?.();
});

async function start(message: BootstrapMessage): Promise<void> {
  if (stop) throw new Error("server already started");
  const bridge = new ParentPortEngineBridge(utilityPort);
  capabilityResolver = new ParentPortFileCapabilityResolver(utilityPort);
  const databaseFile = join(message.userData, "dramaip.db");
  const kernel = await bootDramaRuntime({
    profileText: JSON.stringify(message.e2e ? e2eProfile : studioProfile),
    databaseFile,
    backupDirectory: join(message.userData, "backups"),
    username: message.username,
    password: message.password,
    allowedOrigins: message.allowedOrigins,
    engineBridge: bridge,
    engineTokens: message.engineTokens,
    fileCapabilityResolver: capabilityResolver,
    restoreDatabase: async (backupFile) => {
      if (!activeKernel) throw new Error("runtime is not ready for restore");
      const staged = `${databaseFile}.restore.pending`;
      await copyFile(backupFile, staged);
      setTimeout(() => {
        void (async () => {
          if (!activeKernel) return;
          await activeKernel.dispose();
          await copyFile(staged, databaseFile);
          await unlink(staged).catch(() => undefined);
          activeKernel = await bootDramaRuntime({
            profileText: JSON.stringify(
              message.e2e ? e2eProfile : studioProfile,
            ),
            databaseFile,
            backupDirectory: join(message.userData, "backups"),
            username: message.username,
            password: message.password,
            allowedOrigins: message.allowedOrigins,
            engineBridge: bridge,
            engineTokens: message.engineTokens,
            fileCapabilityResolver: capabilityResolver,
          });
          restoreEngines = () =>
            restoreEngineConfigurations(activeKernel!.context, bridge);
        })().catch((error) =>
          utilityPort.postMessage({
            type: "server:fatal",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }, 50);
    },
  });
  activeKernel = kernel;
  restoreEngines = () => restoreEngineConfigurations(kernel.context, bridge);
  const server = await new Promise<ReturnType<typeof serve>>(
    (resolve, reject) => {
      const instance = serve(
        {
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) => activeKernel!.context.http.fetch(request),
        },
        () => resolve(instance),
      );
      instance.once("error", reject);
    },
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("local server address is unavailable");
  stop = async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await activeKernel?.dispose();
    activeKernel = undefined;
    bridge.dispose();
    capabilityResolver?.dispose();
    capabilityResolver = undefined;
    restoreEngines = undefined;
    stop = undefined;
  };
  utilityPort.postMessage({ type: "server:ready", port: address.port });
}

process.on("uncaughtException", (error) => {
  utilityPort.postMessage({ type: "server:fatal", error: error.message });
});
process.on("unhandledRejection", (error) => {
  utilityPort.postMessage({
    type: "server:fatal",
    error: error instanceof Error ? error.message : String(error),
  });
});
