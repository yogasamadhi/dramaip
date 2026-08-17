import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  createRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { defineDramaPlugin } from "@dramaip/plugin-api";
import { ApiProblem } from "@dramaip/http";

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
  {
    kind: "review-package",
    path: "packages",
    data: packageData,
    validateCreate: (data: z.infer<typeof packageData>) => {
      if (!data.assetIds.length)
        throw new ApiProblem(
          400,
          "REVIEW_PACKAGE_EMPTY",
          "审片包必须绑定至少一个本地资产",
        );
    },
  },
  {
    kind: "comment",
    path: "comments",
    data: commentData,
    validateCreate: (data: z.infer<typeof commentData>) => {
      if (!data.body.trim())
        throw new ApiProblem(400, "COMMENT_EMPTY", "评论正文不能为空");
    },
  },
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
    validateCreate: (data: z.infer<typeof productionReviewData>) => {
      if (!data.checklist.length)
        throw new ApiProblem(
          400,
          "REVIEW_CHECKLIST_EMPTY",
          "制作审查必须包含检查项",
        );
    },
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
