import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  createRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { defineDramaPlugin } from "@dramaip/plugin-api";

const packageData = z.object({
  versionId: z.string(),
  assetIds: z.array(z.uuid()),
  reviewerIds: z.array(z.string()),
  dueAt: z.iso.datetime().optional(),
});
const commentData = z.object({
  packageId: z.uuid(),
  authorId: z.string(),
  body: z.string(),
  timecodeMs: z.number().int().nonnegative().optional(),
  resolved: z.boolean().default(false),
});
const decisionData = z.object({
  packageId: z.uuid(),
  reviewerId: z.string(),
  decision: z.enum(["approved", "changes-requested", "rejected"]),
  rationale: z.string(),
});
const productionReviewData = z.object({
  targetType: z.string(),
  targetId: z.string(),
  checklist: z.array(
    z.object({ label: z.string(), passed: z.boolean(), note: z.string() }),
  ),
});

export const reviewResources = [
  { kind: "review-package", path: "packages", data: packageData },
  { kind: "comment", path: "comments", data: commentData },
  {
    kind: "decision",
    path: "decisions",
    data: decisionData,
    defaultStatus: "final",
  },
  {
    kind: "production-review",
    path: "production-reviews",
    data: productionReviewData,
  },
] satisfies readonly NodeResourceDefinition<any>[];

export const reviewModule = defineDramaPlugin({
  descriptor: {
    id: "review",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "production", "media", "timeline"],
    provides: ["review.packages", "review.comments", "review.decisions"],
    critical: false,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("review-package"), data: packageData }),
      z.object({ kind: z.literal("comment"), data: commentData }),
      z.object({ kind: z.literal("decision"), data: decisionData }),
      z.object({
        kind: z.literal("production-review"),
        data: productionReviewData,
      }),
    ]),
  },
  server: createRelationalPluginServer({
    pluginId: "review",
    routeBase: "/api/v2/review",
    resources: reviewResources,
  }),
  migrations: [
    createNodeMigration("review", reviewResources),
    createRelationalMigration("review", reviewResources),
  ],
});
