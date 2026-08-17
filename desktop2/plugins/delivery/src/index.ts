import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  createRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { ApiProblem } from "@dramaip/http";
import { defineDramaPlugin } from "@dramaip/plugin-api";

const creativeVersionData = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  label: z.string(),
  checksum: z.string(),
  frozenAt: z.iso.datetime(),
});
const platformSpecData = z.object({
  platform: z.string(),
  aspectRatio: z.string(),
  codec: z.string(),
  maxDurationMs: z.number().int().positive(),
  metadata: z.record(z.string(), z.string()),
});
const archiveData = z.object({
  versionId: z.uuid(),
  assetIds: z.array(z.uuid()),
  checksum: z.string(),
  locationRef: z.string().optional(),
});
const exportData = z.object({
  versionId: z.uuid(),
  platformSpecId: z.uuid(),
  outputAssetId: z.uuid().optional(),
});
const cloudSyncData = z.object({
  reviewPackageId: z.uuid(),
  provider: z.string(),
  remoteId: z.string().optional(),
  lastSyncedAt: z.iso.datetime().optional(),
});

const cloudPublishAction = {
  verb: "publish",
  input: z.object({}).strict(),
  mutate() {
    throw new ApiProblem(
      409,
      "EXTERNAL_EXECUTION_DISABLED",
      "本版本未启用云审片网络同步；本地发布预览已保留。",
    );
  },
};

export const deliveryResources = [
  {
    kind: "creative-version",
    path: "creative-versions",
    data: creativeVersionData,
    defaultStatus: "frozen",
    validateCreate: (data: z.infer<typeof creativeVersionData>) => {
      if (!data.sourceId.trim() || !data.checksum.trim())
        throw new ApiProblem(
          400,
          "CREATIVE_VERSION_SOURCE_REQUIRED",
          "创意版本必须绑定真实来源和校验和",
        );
    },
  },
  { kind: "platform-spec", path: "platform-specs", data: platformSpecData },
  {
    kind: "archive",
    path: "archives",
    data: archiveData,
    createRequiresIdempotency: true,
    validateCreate: (data: z.infer<typeof archiveData>) => {
      if (!data.assetIds.length)
        throw new ApiProblem(
          400,
          "ARCHIVE_ASSETS_REQUIRED",
          "归档至少需要一个资产",
        );
    },
  },
  {
    kind: "export",
    path: "exports",
    data: exportData,
    createRequiresIdempotency: true,
    validateCreate: (data: z.infer<typeof exportData>) => {
      if (!data.versionId || !data.platformSpecId)
        throw new ApiProblem(
          400,
          "EXPORT_SOURCE_REQUIRED",
          "交付导出必须绑定创意版本和平台规格",
        );
    },
  },
  {
    kind: "cloud-review-sync",
    path: "cloud-review-syncs",
    data: cloudSyncData,
    defaultStatus: "preview",
    createRequiresIdempotency: true,
    validateCreate: (data: z.infer<typeof cloudSyncData>) => {
      if (!data.reviewPackageId)
        throw new ApiProblem(
          400,
          "CLOUD_REVIEW_PACKAGE_REQUIRED",
          "云审片预览必须绑定审片包",
        );
    },
    actions: [cloudPublishAction],
  },
] satisfies readonly NodeResourceDefinition<any>[];

export const deliveryModule = defineDramaPlugin({
  descriptor: {
    id: "delivery",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "media", "timeline", "review"],
    provides: [
      "delivery.versions",
      "delivery.exports",
      "delivery.cloud-review",
    ],
    critical: false,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("creative-version"),
        data: creativeVersionData,
      }),
      z.object({ kind: z.literal("platform-spec"), data: platformSpecData }),
      z.object({ kind: z.literal("archive"), data: archiveData }),
      z.object({ kind: z.literal("export"), data: exportData }),
      z.object({ kind: z.literal("cloud-review-sync"), data: cloudSyncData }),
    ]),
  },
  server: createRelationalPluginServer({
    pluginId: "delivery",
    routeBase: "/api/v2/delivery",
    resources: deliveryResources,
  }),
  migrations: [
    createNodeMigration("delivery", deliveryResources),
    createRelationalMigration("delivery", deliveryResources),
  ],
});
