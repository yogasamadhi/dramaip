import {
  defineDramaPlugin,
  type DramaPluginExports,
} from "@dramaip/plugin-api";

import * as contracts from "./contracts.ts";
import {
  createSystemServer,
  migrations,
  type SystemRuntimeConfig,
} from "./server.ts";

export function createSystemModule(
  config: SystemRuntimeConfig,
): DramaPluginExports<unknown> {
  return defineDramaPlugin({
    descriptor: {
      id: "system",
      version: "1.0.0",
      runtime: "server",
      requires: ["foundation"],
      provides: ["system.health", "system.search", "system.backup"],
      critical: true,
    },
    contracts,
    server: createSystemServer(config),
    migrations,
  });
}

export * from "./contracts.ts";
export * from "./server.ts";
