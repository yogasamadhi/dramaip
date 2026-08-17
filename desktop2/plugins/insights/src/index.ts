import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  createRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { defineDramaPlugin } from "@dramaip/plugin-api";

const feedbackData = z.object({
  source: z.string(),
  externalId: z.string().optional(),
  body: z.string(),
  sentiment: z.number().min(-1).max(1).optional(),
  receivedAt: z.iso.datetime(),
});
const clusterData = z.object({
  feedbackIds: z.array(z.uuid()),
  label: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});
const graphData = z.object({
  nodes: z.array(
    z.object({ id: z.string(), type: z.string(), label: z.string() }),
  ),
  edges: z.array(
    z.object({ source: z.string(), target: z.string(), relation: z.string() }),
  ),
});
const impactData = z.object({
  changeSetId: z.string(),
  impactedIds: z.array(z.string()),
  risk: z.enum(["low", "medium", "high"]),
  explanation: z.string(),
});
const ledgerData = z.object({
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  runId: z.string(),
});

export const insightsResources = [
  { kind: "feedback", path: "feedback", data: feedbackData },
  {
    kind: "cluster",
    path: "clusters",
    data: clusterData,
    validateCreate: (data: z.infer<typeof clusterData>) => {
      if (!data.feedbackIds.length) throw new Error("评论聚类至少需要一条反馈");
    },
  },
  {
    kind: "production-graph",
    path: "production-graphs",
    data: graphData,
    validateCreate: (data: z.infer<typeof graphData>) => {
      if (!data.nodes.length) throw new Error("生产图至少需要一个节点");
      if (
        data.edges.some(
          (edge) =>
            !data.nodes.some((node) => node.id === edge.source) ||
            !data.nodes.some((node) => node.id === edge.target),
        )
      )
        throw new Error("生产图存在未知节点");
    },
  },
  { kind: "impact-analysis", path: "impact-analyses", data: impactData },
  {
    kind: "generation-ledger",
    path: "generation-ledger",
    data: ledgerData,
    defaultStatus: "final",
    validateCreate: (data: z.infer<typeof ledgerData>) => {
      if (
        data.inputTokens <= 0 ||
        data.outputTokens <= 0 ||
        data.costMicros <= 0 ||
        !data.runId.trim()
      )
        throw new Error("生成账本必须来自真实运行用量");
    },
  },
] satisfies readonly NodeResourceDefinition<any>[];

export const insightsModule = defineDramaPlugin({
  descriptor: {
    id: "insights",
    version: "1.0.0",
    runtime: "both",
    requires: [
      "foundation",
      "workspace",
      "automation",
      "production",
      "media",
      "timeline",
      "review",
      "delivery",
    ],
    provides: ["insights.feedback", "insights.graph", "insights.ledger"],
    critical: false,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("feedback"), data: feedbackData }),
      z.object({ kind: z.literal("cluster"), data: clusterData }),
      z.object({ kind: z.literal("production-graph"), data: graphData }),
      z.object({ kind: z.literal("impact-analysis"), data: impactData }),
      z.object({ kind: z.literal("generation-ledger"), data: ledgerData }),
    ]),
  },
  server: createRelationalPluginServer({
    pluginId: "insights",
    routeBase: "/api/v2/insights",
    resources: insightsResources,
  }),
  migrations: [
    createNodeMigration("insights", insightsResources),
    createRelationalMigration("insights", insightsResources),
  ],
});
