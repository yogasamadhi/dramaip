import type { Plugin } from "@deepseek-ai/cordis";

import {
  defineDramaPlugin,
  type DramaPluginExports,
} from "@dramaip/plugin-api";

import * as contracts from "./contracts.ts";
import {
  BridgeEngineProvider,
  type EngineControlBridge,
  type EngineKind,
  type EngineTokenMap,
} from "./engine-registry.ts";
import { createAgentsServer, migrations } from "./server.ts";

export const engineVersions: Readonly<Record<EngineKind, string>> = {
  opencode: "1.18.15",
  codex: "0.147.0",
  dsh: "0.1.0-rc.5",
  pi: "0.84.2",
  langgraph: "0.2.43",
};

function createEngineModule(
  kind: EngineKind,
  bridge: EngineControlBridge,
): DramaPluginExports<unknown> {
  const server: Plugin = {
    name: `dramaip-engine-${kind}`,
    inject: ["engineRegistry"],
    apply(ctx) {
      ctx.engineRegistry.register(
        new BridgeEngineProvider(kind, bridge, engineVersions[kind]),
      );
    },
  };
  return defineDramaPlugin({
    descriptor: {
      id: `engine-${kind}`,
      version: engineVersions[kind],
      runtime: "server",
      requires: ["agents"],
      provides: [`agents.engine.${kind}`],
      critical: kind === "opencode",
    },
    contracts: {},
    server,
    migrations: [],
  });
}

export function createAgentModules(
  bridge: EngineControlBridge,
  engineTokens: EngineTokenMap,
): readonly DramaPluginExports<unknown>[] {
  const agents = defineDramaPlugin({
    descriptor: {
      id: "agents",
      version: "3.0.0",
      runtime: "both",
      requires: [
        "foundation",
        "workspace",
        "automation",
        "writing",
        "knowledge",
        "creative-quality",
      ],
      provides: [
        "agents.registry",
        "agents.sessions",
        "agents.runs",
        "agents.assistant",
        "agents.context-snapshots",
        "agents.experiments",
        "agents.mcp",
      ],
      critical: true,
    },
    contracts,
    server: createAgentsServer(bridge, engineTokens),
    migrations,
  });
  return [
    agents,
    createEngineModule("opencode", bridge),
    createEngineModule("codex", bridge),
    createEngineModule("dsh", bridge),
    createEngineModule("pi", bridge),
    createEngineModule("langgraph", bridge),
  ];
}

export * from "./contracts.ts";
export * from "./assistant.ts";
export * from "./engine-registry.ts";
export * from "./server.ts";
