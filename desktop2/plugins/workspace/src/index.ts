import { defineDramaPlugin } from "@dramaip/plugin-api";

import * as contracts from "./contracts.ts";
import { createWorkspaceServer, migrations } from "./server.ts";
import type { FileCapabilityResolver } from "./services.ts";

const unavailableResolver: FileCapabilityResolver = {
  async resolve() {
    return undefined;
  },
};

export function createWorkspaceModule(
  capabilityResolver: FileCapabilityResolver = unavailableResolver,
) {
  return defineDramaPlugin({
    descriptor: {
      id: "workspace",
      version: "2.0.0",
      runtime: "both",
      requires: ["foundation"],
      provides: [
        "workspace.projects",
        "workspace.series",
        "workspace.packages",
        "workspace.extensions",
        "fileCapabilities",
      ],
      critical: true,
    },
    contracts,
    server: createWorkspaceServer(capabilityResolver),
    migrations,
  });
}

export const workspaceModule = createWorkspaceModule();

export * from "./contracts.ts";
export * from "./repository.ts";
export * from "./server.ts";
export * from "./services.ts";
export * from "./source-import.ts";
