import { defineDramaPlugin } from "@dramaip/plugin-api";

import * as contracts from "./contracts.ts";
import { migrations, writingServer } from "./server.ts";

export const writingModule = defineDramaPlugin({
  descriptor: {
    id: "writing",
    version: "2.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "automation"],
    provides: ["writing.chapters", "writing.versions", "writing.revisions"],
    critical: true,
  },
  contracts,
  server: writingServer,
  migrations,
});

export * from "./contracts.ts";
export * from "./repository.ts";
export * from "./server.ts";
