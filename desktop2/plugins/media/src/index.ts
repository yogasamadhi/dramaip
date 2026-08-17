import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { Service, type Context, type Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  installRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { ApiProblem } from "@dramaip/http";
import { idempotentResponse } from "@dramaip/http";
import {
  defineDramaPlugin,
  type MediaAssetReference,
  type MediaReadService,
  type RouteContribution,
} from "@dramaip/plugin-api";
import { problemDetailsSchema } from "@dramaip/contracts";

const assetData = z.object({
  mediaType: z
    .enum(["image", "video", "audio", "voice", "document", "other"])
    .default("other"),
  contentRef: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  checksum: z.string(),
  rightsStatus: z
    .enum(["unverified", "cleared", "restricted"])
    .default("unverified"),
  adoptionStatus: z
    .enum(["candidate", "adopted", "locked", "rejected"])
    .default("candidate"),
});
const visualData = z.object({
  prompt: z.string(),
  style: z.string(),
  assetId: z.uuid().optional(),
});
const stillData = z.object({
  shotId: z.uuid(),
  assetId: z.uuid(),
  frame: z.number().int().nonnegative(),
});
const imageRunData = z.object({
  provider: z.string(),
  prompt: z.string(),
  outputAssetIds: z.array(z.uuid()).default([]),
  estimatedCostMicros: z.number().int().nonnegative().default(0),
});
const ttsRunData = z.object({
  provider: z.string(),
  text: z.string(),
  voiceId: z.string(),
  outputAssetId: z.uuid().optional(),
  estimatedCostMicros: z.number().int().nonnegative().default(0),
});
const videoRunData = z.object({
  provider: z.string(),
  prompt: z.string(),
  sourceAssetIds: z.array(z.uuid()),
  outputAssetId: z.uuid().optional(),
  estimatedCostMicros: z.number().int().nonnegative().default(0),
});
const voiceData = z.object({
  provider: z.string(),
  providerVoiceId: z.string(),
  locale: z.string(),
  sampleAssetId: z.uuid().optional(),
});
const audioData = z.object({
  assetId: z.uuid(),
  durationMs: z.number().int().nonnegative(),
  channels: z.number().int().positive(),
});
const animaticData = z.object({
  timelineId: z.uuid(),
  outputAssetId: z.uuid().optional(),
  durationMs: z.number().int().nonnegative(),
});

const externalExecutionAction = {
  verb: "submit",
  input: z.object({}).strict(),
  mutate() {
    throw new ApiProblem(
      409,
      "EXTERNAL_EXECUTION_DISABLED",
      "本版本仅保留生成预检与费用预览，未启用媒体远程执行。",
    );
  },
};

const assetAction = (verb: "adopt" | "lock" | "reject" | "clear-rights") => ({
  verb,
  input: z.object({}).strict(),
  mutate(data: z.infer<typeof assetData>) {
    if (verb === "clear-rights")
      return { ...data, rightsStatus: "cleared" as const };
    if (verb === "reject")
      return { ...data, adoptionStatus: "rejected" as const };
    if (data.rightsStatus !== "cleared")
      throw new ApiProblem(
        409,
        "MEDIA_RIGHTS_NOT_CLEARED",
        "确认权利后才能采用媒体资产",
      );
    return {
      ...data,
      adoptionStatus:
        verb === "lock" ? ("locked" as const) : ("adopted" as const),
    };
  },
});

export const mediaResources = [
  {
    kind: "asset",
    path: "assets",
    data: assetData,
    defaultStatus: "available",
    actions: [
      assetAction("clear-rights"),
      assetAction("adopt"),
      assetAction("lock"),
      assetAction("reject"),
    ],
  },
  { kind: "visual", path: "visuals", data: visualData },
  { kind: "still", path: "stills", data: stillData },
  {
    kind: "image-run",
    path: "image-runs",
    data: imageRunData,
    defaultStatus: "preview",
    createRequiresIdempotency: true,
    actions: [externalExecutionAction],
  },
  {
    kind: "tts-run",
    path: "tts-runs",
    data: ttsRunData,
    defaultStatus: "preview",
    createRequiresIdempotency: true,
    actions: [externalExecutionAction],
  },
  {
    kind: "video-run",
    path: "video-runs",
    data: videoRunData,
    defaultStatus: "preview",
    createRequiresIdempotency: true,
    actions: [externalExecutionAction],
  },
  { kind: "voice", path: "voices", data: voiceData },
  { kind: "audio", path: "audio", data: audioData },
  {
    kind: "animatic",
    path: "animatics",
    data: animaticData,
    createRequiresIdempotency: true,
  },
] satisfies readonly NodeResourceDefinition<any>[];

interface AssetRow {
  id: string;
  project_id: string;
  title: string;
  data_json: string;
  version: number;
}

class MediaReadServiceImpl extends Service implements MediaReadService {
  static provide = "mediaRead";

  constructor(
    ctx: Context,
    private readonly read: Context["uow"],
  ) {
    super(ctx, "mediaRead");
  }

  private value(row: AssetRow): MediaAssetReference {
    const data = assetData.parse(JSON.parse(row.data_json));
    return {
      id: row.id,
      projectId: row.project_id,
      kind: data.mediaType,
      title: row.title,
      mimeType: data.mimeType,
      rightsStatus: data.rightsStatus,
      adoptionStatus: data.adoptionStatus,
      version: row.version,
      byteLength: data.byteSize,
    };
  }

  list(projectId: string): readonly MediaAssetReference[] {
    return this.read.execute((tx) =>
      tx
        .all<AssetRow>(
          "SELECT id, project_id, title, data_json, version FROM media_asset WHERE project_id = ? ORDER BY ordinal, created_at",
          projectId,
        )
        .map((row) => this.value(row)),
    );
  }

  get(assetId: string): MediaAssetReference | undefined {
    return this.read.execute((tx) => {
      const row = tx.get<AssetRow>(
        "SELECT id, project_id, title, data_json, version FROM media_asset WHERE id = ?",
        assetId,
      );
      return row ? this.value(row) : undefined;
    });
  }

  assertUsable(assetId: string): void {
    const asset = this.get(assetId);
    if (!asset)
      throw new ApiProblem(404, "MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
    if (asset.rightsStatus !== "cleared")
      throw new ApiProblem(409, "MEDIA_RIGHTS_NOT_CLEARED", "媒体权利尚未确认");
    if (asset.adoptionStatus === "rejected")
      throw new ApiProblem(409, "MEDIA_ASSET_REJECTED", "媒体资产已被拒绝");
  }
}

const mediaServer: Plugin = {
  name: "dramaip-media",
  provide: "mediaRead",
  inject: ["http", "uow", "productionRead", "fileCapabilities"],
  apply(ctx) {
    installRelationalPluginServer(ctx, {
      pluginId: "media",
      routeBase: "/api/v2/media",
      resources: mediaResources,
    });
    new MediaReadServiceImpl(ctx, ctx.uow);
    installLocalAssetRoutes(ctx);
  },
};

function mediaType(name: string) {
  const extension = name.toLowerCase().split(".").at(-1);
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension ?? ""))
    return {
      kind: "image" as const,
      mime:
        extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : "image/jpeg",
    };
  if (["mp4", "mov", "m4v", "webm"].includes(extension ?? ""))
    return {
      kind: "video" as const,
      mime: extension === "webm" ? "video/webm" : "video/mp4",
    };
  if (["wav", "mp3", "m4a", "aac"].includes(extension ?? ""))
    return {
      kind: "audio" as const,
      mime: extension === "wav" ? "audio/wav" : "audio/mpeg",
    };
  return { kind: "other" as const, mime: "application/octet-stream" };
}

function installLocalAssetRoutes(ctx: Context): void {
  const contribution: RouteContribution = {
    id: "media.local-assets.http.v2",
    pluginId: "media",
    install(app) {
      const importRoute = createRoute({
        method: "post",
        path: "/api/v2/media/assets/actions/import",
        request: {
          body: {
            content: {
              "application/json": {
                schema: z.object({
                  projectId: z.uuid(),
                  capability: z.string().min(16),
                  title: z.string().trim().min(1).max(500).optional(),
                  rightsConfirmed: z.literal(true),
                }),
              },
            },
          },
        },
        responses: {
          201: { description: "Local asset imported" },
          400: {
            content: {
              "application/problem+json": { schema: problemDetailsSchema },
            },
            description: "Invalid request",
          },
          404: {
            content: {
              "application/problem+json": { schema: problemDetailsSchema },
            },
            description: "Capability not found",
          },
          409: {
            content: {
              "application/problem+json": { schema: problemDetailsSchema },
            },
            description: "Conflict",
          },
        },
      });
      app.openapi(
        importRoute as never,
        (async (context: any) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "media.asset.import",
            input,
            async () => {
              const capability = await ctx.fileCapabilities.resolve(
                input.capability,
              );
              if (!capability)
                throw new ApiProblem(
                  404,
                  "FILE_CAPABILITY_NOT_FOUND",
                  "文件授权无效或已过期",
                );
              const metadata = await stat(capability.path);
              if (!metadata.isFile() || metadata.size > 512 * 1024 * 1024)
                throw new ApiProblem(
                  409,
                  "MEDIA_FILE_REJECTED",
                  "媒体文件无效或超过 512MB",
                );
              const bytes = await readFile(capability.path);
              const id = randomUUID();
              const now = new Date().toISOString();
              const detected = mediaType(capability.name);
              const data = assetData.parse({
                mediaType: detected.kind,
                contentRef: `blob:${id}`,
                mimeType: detected.mime,
                byteSize: bytes.byteLength,
                checksum: createHash("sha256").update(bytes).digest("hex"),
                rightsStatus: "cleared",
                adoptionStatus: "candidate",
              });
              const value = {
                id,
                kind: "asset" as const,
                projectId: input.projectId,
                parentId: null,
                title: input.title ?? capability.name,
                status: "available",
                ordinal: 0,
                data,
                version: 1,
                createdAt: now,
                updatedAt: now,
              };
              ctx.uow.execute((tx) => {
                tx.run(
                  `INSERT INTO media_asset
                  (id, kind, project_id, parent_id, title, status, ordinal, data_json, version, created_at, updated_at)
                 VALUES (?, 'asset', ?, NULL, ?, 'available', 0, ?, 1, ?, ?)`,
                  id,
                  input.projectId,
                  value.title,
                  JSON.stringify(data),
                  now,
                  now,
                );
                tx.run(
                  "INSERT INTO media_asset_blobs (asset_id, bytes) VALUES (?, ?)",
                  id,
                  bytes,
                );
                tx.append({
                  type: "media.asset-imported.v1",
                  pluginId: "media",
                  aggregateType: "asset",
                  aggregateId: id,
                  aggregateVersion: 1,
                  payload: value,
                });
              });
              context.header("etag", '"v1"');
              context.header("location", `/api/v2/media/assets/${id}`);
              return context.json(value, 201);
            },
          );
        }) as never,
      );

      const contentRoute = createRoute({
        method: "get",
        path: "/api/v2/media/assets/{id}/content",
        request: { params: z.object({ id: z.uuid() }) },
        responses: {
          200: {
            content: { "application/octet-stream": { schema: z.string() } },
            description: "Asset bytes",
          },
          206: {
            content: { "application/octet-stream": { schema: z.string() } },
            description: "Asset byte range",
          },
          404: {
            content: {
              "application/problem+json": { schema: problemDetailsSchema },
            },
            description: "Asset not found",
          },
          416: {
            content: {
              "application/problem+json": { schema: problemDetailsSchema },
            },
            description: "Range not satisfiable",
          },
        },
      });
      app.openapi(
        contentRoute as never,
        ((context: any) => {
          const row = ctx.uow.execute((tx) =>
            tx.get<{ bytes: Uint8Array; data_json: string }>(
              "SELECT b.bytes, a.data_json FROM media_asset_blobs b JOIN media_asset a ON a.id = b.asset_id WHERE a.id = ?",
              context.req.valid("param").id,
            ),
          );
          if (!row)
            throw new ApiProblem(
              404,
              "MEDIA_ASSET_NOT_FOUND",
              "媒体资产不存在",
            );
          const data = assetData.parse(JSON.parse(row.data_json));
          const bytes = new Uint8Array(row.bytes);
          const range = context.req.header("range") as string | undefined;
          const headers = {
            "accept-ranges": "bytes",
            "content-type": data.mimeType,
          };
          if (!range)
            return new Response(bytes, {
              status: 200,
              headers: {
                ...headers,
                "content-length": String(bytes.byteLength),
              },
            });
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          const start = match?.[1] ? Number(match[1]) : 0;
          const end = match?.[2] ? Number(match[2]) : bytes.byteLength - 1;
          if (!match || start < 0 || end < start || end >= bytes.byteLength)
            throw new ApiProblem(
              416,
              "INVALID_BYTE_RANGE",
              "请求的媒体范围无效",
            );
          const part = bytes.slice(start, end + 1);
          return new Response(part, {
            status: 206,
            headers: {
              ...headers,
              "content-length": String(part.byteLength),
              "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
            },
          });
        }) as never,
      );
    },
  };
  ctx.http.register(contribution);
}

export const mediaModule = defineDramaPlugin({
  descriptor: {
    id: "media",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "production"],
    provides: [
      "media.assets",
      "media.generation",
      "media.animatics",
      "mediaRead",
    ],
    critical: false,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("asset"), data: assetData }),
      z.object({ kind: z.literal("visual"), data: visualData }),
      z.object({ kind: z.literal("still"), data: stillData }),
      z.object({ kind: z.literal("image-run"), data: imageRunData }),
      z.object({ kind: z.literal("tts-run"), data: ttsRunData }),
      z.object({ kind: z.literal("video-run"), data: videoRunData }),
      z.object({ kind: z.literal("voice"), data: voiceData }),
      z.object({ kind: z.literal("audio"), data: audioData }),
      z.object({ kind: z.literal("animatic"), data: animaticData }),
    ]),
  },
  server: mediaServer,
  migrations: [
    createNodeMigration("media", mediaResources),
    createRelationalMigration("media", mediaResources),
    {
      id: "media-0003",
      pluginId: "media",
      version: "3.0.0",
      dependsOn: ["media-0002"],
      sql: `
        CREATE TABLE media_asset_blobs (
          asset_id TEXT PRIMARY KEY REFERENCES media_asset(id) ON DELETE CASCADE,
          bytes BLOB NOT NULL
        );
      `,
    },
  ],
});
