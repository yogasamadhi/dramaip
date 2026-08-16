import { defineDramaPlugin } from "@dramaip/plugin-api";

import * as contracts from "./contracts.ts";
import { knowledgeServer, migrations } from "./server.ts";

export const knowledgeModule = defineDramaPlugin({
  descriptor: {
    id: "knowledge",
    version: "2.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "automation", "writing"],
    provides: [
      "knowledge.characters",
      "knowledge.outlines",
      "knowledge.story-bibles",
    ],
    critical: true,
  },
  contracts,
  server: knowledgeServer,
  migrations,
});

export * from "./contracts.ts";
export * from "./repository.ts";
export * from "./server.ts";
