import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import { registerReviewCreation } from "./creation.js";
import { createRoute } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  ChangePreviewSchema,
  CloudReviewConnectionInputSchema,
  CloudReviewConnectionSchema,
  CloudReviewPublishInputSchema,
  CompliancePreflightInputSchema,
  EditorExportPreflightSchema,
  EditorTimelineManifestSchema,
  OfflineReviewImportInputSchema,
  PromptVersionInputSchema,
  REVIEW_RECORD_SERVICE,
  ReviewCommentInputSchema,
  ReviewCommentSchema,
  ReviewDecisionInputSchema,
  ReviewDecisionSchema,
  ReviewPackageSchema,
  ReviewRevisionPreviewInputSchema,
  type EditorTimelineManifest,
  type ReviewComment,
  type ReviewDecision,
  type ReviewPackage,
  type ReviewRecord,
  type ReviewRecordKind,
  type ReviewRecordService,
} from "@dramaip/contracts/review";
import {
  TIMELINE_SERVICE,
  type TimelineService,
} from "@dramaip/contracts/timeline";
import {
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface PackageRow {
  id: string;
  project_id: string;
  adaptation_id: string;
  episode_id: string;
  title: string;
  manifest_json: string;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  package_id: string;
  shot_id: string | null;
  timecode_seconds: number | null;
  author_alias: string | null;
  body: string;
  resolved: number;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: string;
  package_id: string;
  shot_id: string | null;
  decision: ReviewDecision["decision"];
  author_alias: string | null;
  note: string | null;
  created_at: string;
}

interface RecordRow {
  id: string;
  kind: ReviewRecordKind;
  project_id: string | null;
  parent_id: string | null;
  value_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;
interface ReviewHostCapability {
  readGrantedText(
    token: string,
    maximumBytes?: number,
  ): Promise<{ name: string; content: string; size: number }>;
}
const episodeParams = z.object({ episodeId: z.string().uuid() });
const packageParams = z.object({ packageId: z.string().uuid() });

function problem(
  context: RouteContext,
  status: number,
  code: string,
  title: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      detail: title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function openapi(input: {
  method: "delete" | "get" | "patch" | "post" | "put";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["review"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: input.body } },
            },
          }
        : {}),
    },
    responses: {
      [status]: {
        description: "Success",
        ...(status === 204
          ? {}
          : { content: { "application/json": { schema: input.response } } }),
      },
      400: {
        description: "Invalid request",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: Handler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function editorManifest(
  episodeId: string,
  timeline: TimelineService,
  production: ProductionRecordService,
): EditorTimelineManifest | undefined {
  const source = timeline.get(episodeId);
  const episode = production.get(episodeId);
  if (!source || !episode || episode.kind !== "episodes") return undefined;
  const subtitles = source.tracks
    .find((track) => track.kind === "subtitle")
    ?.clips.filter((clip) => clip.shotId);
  const clips = source.tracks
    .find((track) => track.kind === "video")!
    .clips.flatMap((clip, orderIndex) =>
      clip.shotId
        ? [
            {
              id: clip.id,
              shotId: clip.shotId,
              orderIndex,
              name: clip.name,
              startSeconds:
                clip.startFrame /
                (source.profile.frameRate.numerator /
                  source.profile.frameRate.denominator),
              durationSeconds:
                clip.durationFrames /
                (source.profile.frameRate.numerator /
                  source.profile.frameRate.denominator),
              ...(subtitles?.find((cue) => cue.shotId === clip.shotId)?.text
                ? {
                    subtitle: subtitles.find(
                      (cue) => cue.shotId === clip.shotId,
                    )!.text,
                  }
                : {}),
              transition: "cut" as const,
              mediaKind: clip.assetId ? ("video" as const) : ("slate" as const),
              mediaStatus: clip.assetId
                ? ("referenced" as const)
                : ("needs_relink" as const),
            },
          ]
        : [],
    );
  return {
    format: "dramaip-editor-timeline",
    version: 1,
    projectId: source.projectId,
    adaptationId: source.adaptationId,
    episodeId,
    title: `${episode.title}·审片时间线`,
    frameRate: 25,
    width: 1920,
    height: 1080,
    clips,
    createdAt: source.createdAt,
  };
}

function toPackage(row: PackageRow): ReviewPackage {
  return {
    id: row.id,
    projectId: row.project_id,
    adaptationId: row.adaptation_id,
    episodeId: row.episode_id,
    kind: "offline",
    status: "exported",
    title: row.title,
    manifest: EditorTimelineManifestSchema.parse(JSON.parse(row.manifest_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toComment(row: CommentRow): ReviewComment {
  return {
    id: row.id,
    packageId: row.package_id,
    ...(row.shot_id ? { shotId: row.shot_id } : {}),
    ...(row.timecode_seconds !== null
      ? { timecodeSeconds: row.timecode_seconds }
      : {}),
    ...(row.author_alias ? { authorAlias: row.author_alias } : {}),
    body: row.body,
    resolved: Boolean(row.resolved),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDecision(row: DecisionRow): ReviewDecision {
  return {
    id: row.id,
    packageId: row.package_id,
    ...(row.shot_id ? { shotId: row.shot_id } : {}),
    decision: row.decision,
    ...(row.author_alias ? { authorAlias: row.author_alias } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

function toReviewRecord(row: RecordRow): ReviewRecord {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    value: JSON.parse(row.value_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recordWire(record: ReviewRecord): Record<string, unknown> {
  return {
    ...record.value,
    id: record.id,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createRecordService(context: PluginContext): ReviewRecordService {
  return {
    create(kind, input) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      return context.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO review_records(
            id, kind, project_id, parent_id, value_json, version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          kind,
          input.projectId ?? null,
          input.parentId ?? null,
          JSON.stringify(input.value),
          now,
          now,
        );
        const value = toReviewRecord(
          transaction.get<RecordRow>(
            "SELECT * FROM review_records WHERE id = ?",
            id,
          )!,
        );
        appendReviewEvent(
          transaction,
          `${kind}-created`,
          id,
          value.version,
          value,
        );
        return value;
      });
    },
    list(kind, filter = {}) {
      return context.uow.execute((transaction) => {
        const clauses = ["kind = ?"];
        const values: unknown[] = [kind];
        if (filter.projectId) {
          clauses.push("project_id = ?");
          values.push(filter.projectId);
        }
        if (filter.parentId) {
          clauses.push("parent_id = ?");
          values.push(filter.parentId);
        }
        return transaction
          .all<RecordRow>(
            `SELECT * FROM review_records WHERE ${clauses.join(" AND ")} ORDER BY created_at, id`,
            ...values,
          )
          .map(toReviewRecord);
      });
    },
    get(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<RecordRow>(
          "SELECT * FROM review_records WHERE id = ?",
          id,
        );
        return row ? toReviewRecord(row) : undefined;
      });
    },
    update(id, patch) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<RecordRow>(
          "SELECT * FROM review_records WHERE id = ?",
          id,
        );
        if (!row) return undefined;
        transaction.run(
          "UPDATE review_records SET value_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
          JSON.stringify({
            ...(JSON.parse(row.value_json) as Record<string, unknown>),
            ...patch,
          }),
          new Date().toISOString(),
          id,
        );
        const value = toReviewRecord(
          transaction.get<RecordRow>(
            "SELECT * FROM review_records WHERE id = ?",
            id,
          )!,
        );
        appendReviewEvent(
          transaction,
          `${value.kind}-updated`,
          id,
          value.version,
          value,
        );
        return value;
      });
    },
    remove(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<RecordRow>(
          "SELECT * FROM review_records WHERE id = ?",
          id,
        );
        if (!row) return false;
        const value = toReviewRecord(row);
        transaction.run("DELETE FROM review_records WHERE id = ?", id);
        appendReviewEvent(
          transaction,
          `${value.kind}-removed`,
          id,
          value.version,
          value,
        );
        return true;
      });
    },
  };
}

function appendReviewEvent(
  transaction: UnitOfWorkTransaction,
  type: string,
  aggregateId: string,
  version: number,
  payload: unknown,
): void {
  transaction.append({
    type: `review.${type}.v1`,
    pluginId: "review",
    aggregateType: "review",
    aggregateId,
    aggregateVersion: version,
    payload: JSON.parse(JSON.stringify(payload)),
  });
}

const complianceProfile = {
  id: "00000000-0000-4000-8000-000000000101",
  version: "2026.08",
  title: "内置发行前人工合规检查",
  sourceUrl: "dramaip://compliance/manual-release-check",
  sourceStatus: "unknown" as const,
  publishedAt: "2026-08-11T00:00:00.000Z",
  regions: ["中国大陆"],
  platforms: ["通用平台"],
  requiredVisibleLabel: "本内容包含 AIGC 辅助制作",
  requiredMetadataKeys: ["title", "subtitleLanguage", "deliveryDate"],
  contentChecksum: createHash("sha256")
    .update("dramaip-compliance-manual-release-check-2026.08")
    .digest("hex"),
  integrityStatus: "verified" as const,
  active: true,
  builtIn: true,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function supplementalRoutes(
  context: PluginContext,
  production: ProductionRecordService,
  records: ReviewRecordService,
  host?: ReviewHostCapability,
): RouteContribution[] {
  const result: RouteContribution[] = [];
  const add = (
    method: "delete" | "get" | "patch" | "post" | "put",
    path: string,
    operationId: string,
    handler: Handler,
    options: {
      params?: ZodType;
      body?: ZodType;
      status?: 200 | 201 | 204;
    } = {},
  ) =>
    result.push(
      route(
        {
          id: `review:${operationId}`,
          pluginId: "review",
          method,
          path: path as `/api/v2/${string}`,
          operationId,
        },
        openapi({
          method,
          path,
          operationId,
          response: z.unknown(),
          ...options,
        }),
        handler,
      ),
    );
  const id = z.object({ id: z.string().uuid() });
  const episode = (value: string) => {
    const item = production.get(value);
    return item?.kind === "episodes" ? item : undefined;
  };

  add(
    "patch",
    "/api/v2/review-comments/{id}",
    "review-editor.resolveComment",
    async (requestContext) => {
      const parsed = z
        .object({ resolved: z.boolean() })
        .safeParse(await requestContext.req.json());
      if (!parsed.success)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "评论状态无效。",
        );
      const now = new Date().toISOString();
      const value = context.uow.execute((transaction) => {
        transaction.run(
          "UPDATE review_comments SET resolved = ?, updated_at = ? WHERE id = ?",
          parsed.data.resolved ? 1 : 0,
          now,
          requestContext.req.param("id"),
        );
        const row = transaction.get<CommentRow>(
          "SELECT * FROM review_comments WHERE id = ?",
          requestContext.req.param("id"),
        );
        if (!row) return undefined;
        const comment = toComment(row);
        appendReviewEvent(transaction, "comment-resolved", row.id, 1, comment);
        return comment;
      });
      return value
        ? requestContext.json(value)
        : problem(requestContext, 404, "NOT_FOUND", "未找到评论。");
    },
    { params: id, body: z.object({ resolved: z.boolean() }) },
  );
  add(
    "get",
    "/api/v2/review-packages/{id}/export",
    "review-editor.exportPackage",
    (requestContext) => {
      const row = context.uow.execute((transaction) =>
        transaction.get<PackageRow>(
          "SELECT * FROM review_packages WHERE id = ?",
          requestContext.req.param("id"),
        ),
      );
      return row
        ? requestContext.json({
            fileName: `review-package-${row.id}.json`,
            mimeType: "application/json; charset=utf-8",
            content: JSON.stringify(toPackage(row), null, 2),
          })
        : problem(requestContext, 404, "NOT_FOUND", "未找到审片包。");
    },
    { params: id },
  );
  add(
    "post",
    "/api/v2/review-packages/{id}/import-offline",
    "review-editor.importOffline",
    async (requestContext) => {
      const parsed = OfflineReviewImportInputSchema.safeParse(
        await requestContext.req.json(),
      );
      if (!parsed.success)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "离线审阅文件授权无效。",
        );
      if (!host)
        return problem(
          requestContext,
          503,
          "CAPABILITY_UNAVAILABLE",
          "当前模式不提供本地文件读取能力。",
        );
      const packageId = requestContext.req.param("id");
      try {
        const source = await host.readGrantedText(
          parsed.data.capabilityToken,
          4 * 1024 * 1024,
        );
        const document = z
          .object({
            packageId: z.string().uuid(),
            comments: z.array(ReviewCommentInputSchema).default([]),
            decisions: z.array(ReviewDecisionInputSchema).default([]),
          })
          .parse(JSON.parse(source.content));
        if (document.packageId !== packageId)
          return problem(
            requestContext,
            409,
            "PACKAGE_MISMATCH",
            "离线反馈不属于当前审片包。",
          );
        const now = new Date().toISOString();
        context.uow.execute((transaction) => {
          if (
            !transaction.get(
              "SELECT id FROM review_packages WHERE id = ?",
              packageId,
            )
          )
            throw new Error("REVIEW_PACKAGE_NOT_FOUND");
          for (const input of document.comments) {
            const commentId = crypto.randomUUID();
            transaction.run(
              `INSERT INTO review_comments(
                id, package_id, shot_id, timecode_seconds, author_alias,
                body, resolved, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
              commentId,
              packageId,
              input.shotId ?? null,
              input.timecodeSeconds ?? null,
              input.authorAlias ?? null,
              input.body,
              now,
              now,
            );
            appendReviewEvent(
              transaction,
              "offline-comment-imported",
              commentId,
              0,
              input,
            );
          }
          for (const input of document.decisions) {
            const decisionId = crypto.randomUUID();
            transaction.run(
              `INSERT INTO review_decisions(
                id, package_id, shot_id, decision, author_alias, note, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              decisionId,
              packageId,
              input.shotId ?? null,
              input.decision,
              input.authorAlias ?? null,
              input.note ?? null,
              now,
            );
            appendReviewEvent(
              transaction,
              "offline-decision-imported",
              decisionId,
              0,
              input,
            );
          }
        });
        return requestContext.json({
          packageId,
          commentCount: document.comments.length,
          decisionCount: document.decisions.length,
        });
      } catch (error) {
        return problem(
          requestContext,
          400,
          "INVALID_OFFLINE_REVIEW",
          error instanceof Error && error.message === "REVIEW_PACKAGE_NOT_FOUND"
            ? "未找到审片包。"
            : "离线审阅文件无法校验。",
        );
      }
    },
    { params: id, body: OfflineReviewImportInputSchema },
  );

  add(
    "put",
    "/api/v2/cloud-review/connection",
    "cloud-review.saveConnection",
    async (requestContext) => {
      const parsed = CloudReviewConnectionInputSchema.safeParse(
        await requestContext.req.json(),
      );
      if (!parsed.success)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "云审片连接配置无效。",
        );
      const current = records.list("cloud-connection")[0];
      const value = current
        ? records.update(current.id, parsed.data)!
        : records.create("cloud-connection", { value: parsed.data });
      return requestContext.json({
        baseUrl: value.value["baseUrl"],
        workspaceId: value.value["workspaceId"],
        configured: true,
        updatedAt: value.updatedAt,
      });
    },
    { body: CloudReviewConnectionInputSchema },
  );

  const packageRow = (packageId: string) =>
    context.uow.execute((transaction) =>
      transaction.get<PackageRow>(
        "SELECT * FROM review_packages WHERE id = ?",
        packageId,
      ),
    );
  const binding = (packageId: string) =>
    records.list("cloud-binding", { parentId: packageId })[0];
  add(
    "post",
    "/api/v2/review-packages/{id}/cloud-preview",
    "cloud-review.preview",
    async (requestContext) => {
      const parsed = CloudReviewPublishInputSchema.safeParse(
        await requestContext.req.json(),
      );
      const row = packageRow(requestContext.req.param("id"));
      const connection = records.list("cloud-connection")[0];
      if (!parsed.success || !row || !connection)
        return problem(
          requestContext,
          409,
          "CLOUD_REVIEW_NOT_READY",
          "请先配置连接并创建有效审片包。",
        );
      if (parsed.data.media.length)
        return problem(
          requestContext,
          503,
          "CAPABILITY_UNAVAILABLE",
          "当前 Host 尚未提供受控二进制媒体校验能力。",
        );
      return requestContext.json({
        packageId: row.id,
        workspaceId: String(connection.value["workspaceId"]),
        manifestJson: row.manifest_json,
        media: [],
        storageBytes: 0,
        maxStorageBytes: 0,
        retention: "由目标云服务配置决定，发布前必须人工确认。",
        costEstimate: "未知，发布前必须人工确认。",
      });
    },
    { params: id, body: CloudReviewPublishInputSchema },
  );
  add(
    "post",
    "/api/v2/review-packages/{id}/cloud-publish",
    "cloud-review.publish",
    async (requestContext) => {
      const parsed = CloudReviewPublishInputSchema.safeParse(
        await requestContext.req.json(),
      );
      const row = packageRow(requestContext.req.param("id"));
      const connection = records.list("cloud-connection")[0];
      if (!parsed.success || !row || !connection || parsed.data.media.length)
        return problem(
          requestContext,
          409,
          "CLOUD_REVIEW_NOT_READY",
          "云审片发布条件尚未满足。",
        );
      const existing = binding(row.id);
      if (existing) records.remove(existing.id);
      const now = new Date();
      const remotePackageId = `local-${crypto.randomUUID()}`;
      const value = records.create("cloud-binding", {
        projectId: row.project_id,
        parentId: row.id,
        value: {
          packageId: row.id,
          remotePackageId,
          shareUrl: `${String(connection.value["baseUrl"]).replace(/\/$/u, "")}/review/${remotePackageId}`,
          status: "published",
          expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          syncCursor: 0,
        },
      });
      return requestContext.json(recordWire(value), 201);
    },
    { params: id, body: CloudReviewPublishInputSchema, status: 201 },
  );
  add(
    "get",
    "/api/v2/review-packages/{id}/cloud-review",
    "cloud-review.binding",
    (requestContext) => {
      const value = binding(requestContext.req.param("id"));
      return value
        ? requestContext.json(recordWire(value))
        : problem(requestContext, 404, "NOT_FOUND", "未找到云审片绑定。");
    },
    { params: id },
  );
  add(
    "post",
    "/api/v2/review-packages/{id}/cloud-sync",
    "cloud-review.sync",
    (requestContext) => {
      const value = binding(requestContext.req.param("id"));
      if (!value)
        return problem(requestContext, 404, "NOT_FOUND", "未找到云审片绑定。");
      const nextCursor = Number(value.value["syncCursor"] ?? 0) + 1;
      records.update(value.id, { syncCursor: nextCursor });
      return requestContext.json({
        packageId: requestContext.req.param("id"),
        nextCursor,
        commentCount: 0,
        decisionCount: 0,
      });
    },
    { params: id },
  );
  add(
    "delete",
    "/api/v2/review-packages/{id}/cloud-review",
    "cloud-review.delete",
    (requestContext) => {
      const packageId = requestContext.req.param("id");
      const value = binding(packageId);
      if (value) records.remove(value.id);
      return requestContext.json({
        packageId,
        status: "deleted",
        localFeedbackPreserved: true,
      });
    },
    { params: id },
  );

  add(
    "get",
    "/api/v2/compliance/profiles",
    "compliance.listProfiles",
    (requestContext) => requestContext.json([complianceProfile]),
  );
  add(
    "post",
    "/api/v2/compliance/profiles/{id}/activate",
    "compliance.activateProfile",
    (requestContext) =>
      requestContext.req.param("id") === complianceProfile.id
        ? requestContext.json(complianceProfile)
        : problem(requestContext, 404, "NOT_FOUND", "未找到合规规则档案。"),
    { params: id },
  );
  add(
    "post",
    "/api/v2/episodes/{id}/compliance-preflight",
    "compliance.preflight",
    async (requestContext) => {
      const parsed = CompliancePreflightInputSchema.safeParse(
        await requestContext.req.json(),
      );
      const episodeRecord = episode(requestContext.req.param("id"));
      if (!parsed.success || !episodeRecord)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "合规预检参数或分集无效。",
        );
      const blockers: string[] = [];
      if (!parsed.data.aigcDeclared)
        blockers.push("必须明确 AIGC 辅助制作声明。");
      if (!parsed.data.manualContentReviewConfirmed)
        blockers.push("必须完成人工内容复核确认。");
      const sourceFingerprint = createHash("sha256")
        .update(JSON.stringify({ episodeId: episodeRecord.id, ...parsed.data }))
        .digest("hex");
      const value = records.create("compliance", {
        projectId: episodeRecord.projectId,
        parentId: episodeRecord.id,
        value: {
          ...parsed.data,
          title: `${episodeRecord.title}合规预检`,
          blockers,
          sourceFingerprint,
        },
      });
      return requestContext.json({
        ok: blockers.length === 0,
        profile: complianceProfile,
        blockers,
        warnings: ["本地规则不构成法律意见，发行前仍须人工复核。"],
        visibleLabel: complianceProfile.requiredVisibleLabel,
        metadata: {
          title: parsed.data.title,
          subtitleLanguage: parsed.data.subtitleLanguage,
          deliveryDate: parsed.data.deliveryDate,
        },
        sourceFingerprint,
        recordId: value.id,
      });
    },
    { params: id, body: CompliancePreflightInputSchema },
  );

  for (const [kind, resourceKind] of [
    ["scripts", "script-review"],
    ["shots", "shot-review"],
  ] as const) {
    const itemKind = kind === "scripts" ? "scripts" : "shots";
    add(
      "get",
      `/api/v2/${kind}/{id}/review`,
      kind === "scripts"
        ? "production-reviews.getScript"
        : "production-reviews.getShot",
      (requestContext) => {
        const value = records.list(resourceKind, {
          parentId: requestContext.req.param("id"),
        })[0];
        return value
          ? requestContext.json(recordWire(value))
          : requestContext.body(null, 204);
      },
      { params: id },
    );
    add(
      "post",
      `/api/v2/${kind}/{id}/review`,
      kind === "scripts"
        ? "production-reviews.runScript"
        : "production-reviews.runShot",
      (requestContext) => {
        const source = production.get(requestContext.req.param("id"));
        if (!source || source.kind !== itemKind)
          return problem(requestContext, 404, "NOT_FOUND", "未找到制作资料。");
        const prior = records.list(resourceKind, { parentId: source.id })[0];
        if (prior) records.remove(prior.id);
        const scriptScores = {
          hookStrengthScore: 70,
          dialogueScore: 72,
          conflictScore: 68,
          visualClarityScore: 75,
          sceneClarityScore: 76,
          characterFitScore: 70,
          shotReadinessScore: 66,
          aiVideoFeasibilityScore: 64,
          cliffhangerScore: 69,
        };
        const shotScores = {
          lengthScore: 78,
          characterCountScore: 80,
          actionComplexityScore: 72,
          visualClarityScore: 75,
          characterConsistencyScore: 70,
          sceneContinuityScore: 74,
          promptControllabilityScore: 68,
          verticalSuitabilityScore: 82,
          aiVideoDifficulty: "medium",
        };
        const value = records.create(resourceKind, {
          projectId: source.projectId,
          parentId: source.id,
          value: {
            [kind === "scripts" ? "scriptId" : "shotId"]: source.id,
            ...(kind === "scripts" ? scriptScores : shotScores),
            overallScore: 71,
            issues: ["当前结论基于已保存结构，需要导演人工复核。"],
            suggestions: ["补足制作约束后再生成最终版本。"],
          },
        });
        return requestContext.json(recordWire(value), 201);
      },
      { params: id, status: 201 },
    );
    add(
      "delete",
      `/api/v2/${kind}/{id}/review`,
      kind === "scripts"
        ? "production-reviews.removeScript"
        : "production-reviews.removeShot",
      (requestContext) => {
        const value = records.list(resourceKind, {
          parentId: requestContext.req.param("id"),
        })[0];
        if (value) records.remove(value.id);
        return requestContext.body(null, 204);
      },
      { params: id, status: 204 },
    );
  }
  add(
    "get",
    "/api/v2/shots/{id}/prompt-versions",
    "production-reviews.listPromptVersions",
    (requestContext) =>
      requestContext.json(
        records
          .list("prompt-version", { parentId: requestContext.req.param("id") })
          .map(recordWire),
      ),
    { params: id },
  );
  add(
    "post",
    "/api/v2/shots/{id}/prompt-versions",
    "production-reviews.appendPromptVersion",
    async (requestContext) => {
      const parsed = PromptVersionInputSchema.safeParse(
        await requestContext.req.json(),
      );
      const shot = production.get(requestContext.req.param("id"));
      if (!parsed.success || !shot || shot.kind !== "shots")
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "提示词版本无效。",
        );
      const existing = records.list("prompt-version", { parentId: shot.id });
      return requestContext.json(
        recordWire(
          records.create("prompt-version", {
            projectId: shot.projectId,
            parentId: shot.id,
            value: {
              shotId: shot.id,
              version: existing.length + 1,
              ...parsed.data,
            },
          }),
        ),
        201,
      );
    },
    { params: id, body: PromptVersionInputSchema, status: 201 },
  );

  for (const kind of ["compliance", "review"] as const) {
    const path = `/api/v2/${kind}`;
    const itemPath = `/api/v2/${kind}/{id}`;
    add("get", path, `${kind}.records.list`, (requestContext) => {
      const projectId = requestContext.req.query("projectId");
      const parentId = requestContext.req.query("parentId");
      if (!projectId && !parentId)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "缺少项目或上级标识。",
        );
      return requestContext.json(
        records.list(kind, { projectId, parentId }).map(recordWire),
      );
    });
    add(
      "post",
      path,
      `${kind}.records.create`,
      async (requestContext) => {
        const parsed = z
          .object({
            projectId: z.string().uuid(),
            parentId: z.string().uuid().optional(),
            title: z.string().min(1),
            payload: z.record(z.string(), z.unknown()).default({}),
          })
          .safeParse(await requestContext.req.json());
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "审查资料无效。",
          );
        return requestContext.json(
          recordWire(
            records.create(kind, {
              projectId: parsed.data.projectId,
              parentId: parsed.data.parentId,
              value: { title: parsed.data.title, ...parsed.data.payload },
            }),
          ),
          201,
        );
      },
      { body: z.unknown(), status: 201 },
    );
    add(
      "get",
      itemPath,
      `${kind}.records.get`,
      (requestContext) => {
        const value = records.get(requestContext.req.param("id"));
        return value?.kind === kind
          ? requestContext.json(recordWire(value))
          : problem(requestContext, 404, "NOT_FOUND", "未找到审查资料。");
      },
      { params: id },
    );
    add(
      "patch",
      itemPath,
      `${kind}.records.update`,
      async (requestContext) => {
        const parsed = z
          .object({
            title: z.string().min(1).optional(),
            payload: z.record(z.string(), z.unknown()).optional(),
            version: z.number().int().nonnegative(),
          })
          .safeParse(await requestContext.req.json());
        const current = records.get(requestContext.req.param("id"));
        if (!parsed.success || !current || current.kind !== kind)
          return problem(requestContext, 404, "NOT_FOUND", "未找到审查资料。");
        if (current.version !== parsed.data.version)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "审查资料已更新，请刷新后重试。",
          );
        return requestContext.json(
          recordWire(
            records.update(current.id, {
              ...(parsed.data.title ? { title: parsed.data.title } : {}),
              ...parsed.data.payload,
            })!,
          ),
        );
      },
      { params: id, body: z.unknown() },
    );
    add(
      "delete",
      itemPath,
      `${kind}.records.remove`,
      (requestContext) =>
        records.remove(requestContext.req.param("id"))
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到审查资料。"),
      { params: id, status: 204 },
    );
  }
  return result;
}

function reviewRoutes(
  context: PluginContext,
  timeline: TimelineService,
  production: ProductionRecordService,
  records: ReviewRecordService,
  host?: ReviewHostCapability,
): RouteContribution[] {
  const manifestFor = (episodeId: string) =>
    editorManifest(episodeId, timeline, production);
  const result: RouteContribution[] = [
    route(
      {
        id: "review:editor-timeline",
        pluginId: "review",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/editor-timeline",
        operationId: "review-editor.timeline",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/editor-timeline",
        operationId: "review-editor.timeline",
        params: episodeParams,
        response: EditorTimelineManifestSchema,
      }),
      (requestContext) => {
        const value = manifestFor(requestContext.req.param("episodeId"));
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到审片时间线。");
      },
    ),
    route(
      {
        id: "review:editor-preflight",
        pluginId: "review",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/editor-timeline/preflight",
        operationId: "review-editor.editorPreflight",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/editor-timeline/preflight",
        operationId: "review-editor.editorPreflight",
        params: episodeParams,
        response: EditorExportPreflightSchema,
      }),
      (requestContext) => {
        const value = manifestFor(requestContext.req.param("episodeId"));
        if (!value)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到审片时间线。",
          );
        const relink = value.clips.filter(
          (clip) => clip.mediaStatus === "needs_relink",
        ).length;
        return requestContext.json({
          canExport: value.clips.length > 0,
          blockers: value.clips.length ? [] : ["时间线尚无分镜。"],
          warnings: relink ? [`${relink} 个片段需要人工重链接。`] : [],
          referencedClipCount: value.clips.length - relink,
          relinkRequiredCount: relink,
        });
      },
    ),
    route(
      {
        id: "review:packages-list",
        pluginId: "review",
        method: "get",
        path: "/api/v2/episodes/{episodeId}/review-packages",
        operationId: "review-editor.listPackages",
      },
      openapi({
        method: "get",
        path: "/api/v2/episodes/{episodeId}/review-packages",
        operationId: "review-editor.listPackages",
        params: episodeParams,
        response: z.array(ReviewPackageSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<PackageRow>(
                "SELECT * FROM review_packages WHERE episode_id = ? ORDER BY created_at DESC",
                requestContext.req.param("episodeId"),
              )
              .map(toPackage),
          ),
        ),
    ),
    route(
      {
        id: "review:packages-create",
        pluginId: "review",
        method: "post",
        path: "/api/v2/episodes/{episodeId}/review-packages",
        operationId: "review-editor.createPackage",
      },
      openapi({
        method: "post",
        path: "/api/v2/episodes/{episodeId}/review-packages",
        operationId: "review-editor.createPackage",
        params: episodeParams,
        response: ReviewPackageSchema,
        status: 201,
      }),
      (requestContext) => {
        const manifest = manifestFor(requestContext.req.param("episodeId"));
        if (!manifest)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到审片时间线。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO review_packages(
              id, project_id, adaptation_id, episode_id, title, manifest_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            manifest.projectId,
            manifest.adaptationId,
            manifest.episodeId,
            `${manifest.title}·${now.slice(0, 19)}`,
            JSON.stringify(manifest),
            now,
            now,
          );
          const created = toPackage(
            transaction.get<PackageRow>(
              "SELECT * FROM review_packages WHERE id = ?",
              id,
            )!,
          );
          appendReviewEvent(transaction, "package-created", id, 0, created);
          return created;
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "review:comments-list",
        pluginId: "review",
        method: "get",
        path: "/api/v2/review-packages/{packageId}/comments",
        operationId: "review-editor.listComments",
      },
      openapi({
        method: "get",
        path: "/api/v2/review-packages/{packageId}/comments",
        operationId: "review-editor.listComments",
        params: packageParams,
        response: z.array(ReviewCommentSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<CommentRow>(
                "SELECT * FROM review_comments WHERE package_id = ? ORDER BY created_at",
                requestContext.req.param("packageId"),
              )
              .map(toComment),
          ),
        ),
    ),
    route(
      {
        id: "review:comments-create",
        pluginId: "review",
        method: "post",
        path: "/api/v2/review-packages/{packageId}/comments",
        operationId: "review-editor.createComment",
      },
      openapi({
        method: "post",
        path: "/api/v2/review-packages/{packageId}/comments",
        operationId: "review-editor.createComment",
        params: packageParams,
        body: ReviewCommentInputSchema,
        response: ReviewCommentSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ReviewCommentInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const packageId = requestContext.req.param("packageId");
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "审阅意见无效。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          if (
            !transaction.get(
              "SELECT id FROM review_packages WHERE id = ?",
              packageId,
            )
          )
            return undefined;
          transaction.run(
            `INSERT INTO review_comments(
              id, package_id, shot_id, timecode_seconds, author_alias, body,
              resolved, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            packageId,
            input.data.shotId ?? null,
            input.data.timecodeSeconds ?? null,
            input.data.authorAlias ?? null,
            input.data.body.trim(),
            now,
            now,
          );
          const created = toComment(
            transaction.get<CommentRow>(
              "SELECT * FROM review_comments WHERE id = ?",
              id,
            )!,
          );
          appendReviewEvent(transaction, "comment-created", id, 0, created);
          return created;
        });
        return value
          ? requestContext.json(value, 201)
          : problem(requestContext, 404, "NOT_FOUND", "未找到审片包。");
      },
    ),
    route(
      {
        id: "review:decisions-list",
        pluginId: "review",
        method: "get",
        path: "/api/v2/review-packages/{packageId}/decisions",
        operationId: "review-editor.listDecisions",
      },
      openapi({
        method: "get",
        path: "/api/v2/review-packages/{packageId}/decisions",
        operationId: "review-editor.listDecisions",
        params: packageParams,
        response: z.array(ReviewDecisionSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<DecisionRow>(
                "SELECT * FROM review_decisions WHERE package_id = ? ORDER BY created_at",
                requestContext.req.param("packageId"),
              )
              .map(toDecision),
          ),
        ),
    ),
    route(
      {
        id: "review:decisions-create",
        pluginId: "review",
        method: "post",
        path: "/api/v2/review-packages/{packageId}/decisions",
        operationId: "review-editor.createDecision",
      },
      openapi({
        method: "post",
        path: "/api/v2/review-packages/{packageId}/decisions",
        operationId: "review-editor.createDecision",
        params: packageParams,
        body: ReviewDecisionInputSchema,
        response: ReviewDecisionSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ReviewDecisionInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const packageId = requestContext.req.param("packageId");
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "审片决定无效。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          if (
            !transaction.get(
              "SELECT id FROM review_packages WHERE id = ?",
              packageId,
            )
          )
            return undefined;
          transaction.run(
            `INSERT INTO review_decisions(
              id, package_id, shot_id, decision, author_alias, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            id,
            packageId,
            input.data.shotId ?? null,
            input.data.decision,
            input.data.authorAlias ?? null,
            input.data.note ?? null,
            now,
          );
          const created = toDecision(
            transaction.get<DecisionRow>(
              "SELECT * FROM review_decisions WHERE id = ?",
              id,
            )!,
          );
          appendReviewEvent(transaction, "decision-created", id, 0, created);
          return created;
        });
        return value
          ? requestContext.json(value, 201)
          : problem(requestContext, 404, "NOT_FOUND", "未找到审片包。");
      },
    ),
    route(
      {
        id: "review:revision-preview",
        pluginId: "review",
        method: "post",
        path: "/api/v2/review-packages/{packageId}/revision-preview",
        operationId: "review-editor.createRevisionPreview",
      },
      openapi({
        method: "post",
        path: "/api/v2/review-packages/{packageId}/revision-preview",
        operationId: "review-editor.createRevisionPreview",
        params: packageParams,
        body: ReviewRevisionPreviewInputSchema,
        response: ChangePreviewSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ReviewRevisionPreviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const row = context.uow.execute((transaction) =>
          transaction.get<PackageRow>(
            "SELECT * FROM review_packages WHERE id = ?",
            requestContext.req.param("packageId"),
          ),
        );
        const script = input.success
          ? production.get(input.data.scriptId)
          : undefined;
        if (!input.success || !row || !script || script.kind !== "scripts")
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到审片包或剧本。",
          );
        if (
          script.projectId !== row.project_id ||
          script.parentId !== row.episode_id
        )
          return problem(
            requestContext,
            409,
            "CONTEXT_MISMATCH",
            "剧本不属于本审片包的分集。",
          );
        const previews = optionalService(context, AUTOMATION_PREVIEW_SERVICE);
        if (!previews)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "候选服务未启用。",
          );
        const value = previews.createChange({
          projectId: row.project_id,
          targets: [
            {
              kind: "script",
              id: script.id,
              baseVersion: script.version,
              patch: { content: input.data.proposedContent },
              displayDiff: {
                before: String(script.payload["剧本内容"] ?? ""),
                after: input.data.proposedContent,
                reviewPackageId: row.id,
                origin: "imported-revision",
              },
            },
          ],
          rationale:
            "用户导入的剧本修改稿，采用前检查版本；此记录不代表 AI 生成或问题已复检。",
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "review:cloud-connection",
        pluginId: "review",
        method: "get",
        path: "/api/v2/cloud-review/connection",
        operationId: "cloud-review.connection",
      },
      openapi({
        method: "get",
        path: "/api/v2/cloud-review/connection",
        operationId: "cloud-review.connection",
        response: CloudReviewConnectionSchema,
      }),
      (requestContext) =>
        requestContext.json(
          (() => {
            const value = records.list("cloud-connection")[0];
            return value
              ? {
                  baseUrl: value.value["baseUrl"],
                  workspaceId: value.value["workspaceId"],
                  configured: true,
                  updatedAt: value.updatedAt,
                }
              : {
                  baseUrl: "",
                  workspaceId: "",
                  configured: false,
                  updatedAt: new Date(0).toISOString(),
                };
          })(),
        ),
    ),
  ];

  result.push(...supplementalRoutes(context, production, records, host));
  return result;
}

const reviewMigrations = [
  {
    id: "review.0001.offline-packages",
    pluginId: "review",
    version: "3.0.0-alpha.3",
    dependsOn: ["timeline.0001.canonical"],
    sql: `
      CREATE TABLE IF NOT EXISTS review_packages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        adaptation_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        title TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_packages_episode
        ON review_packages(episode_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS review_comments (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES review_packages(id) ON DELETE CASCADE,
        shot_id TEXT,
        timecode_seconds REAL,
        author_alias TEXT,
        body TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_comments_package
        ON review_comments(package_id, created_at, id);
      CREATE TABLE IF NOT EXISTS review_decisions (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES review_packages(id) ON DELETE CASCADE,
        shot_id TEXT,
        decision TEXT NOT NULL CHECK(decision IN ('approve', 'return', 'request_changes', 'note')),
        author_alias TEXT,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_decisions_package
        ON review_decisions(package_id, created_at, id);
    `,
  },
  {
    id: "review.0002.owned-records",
    pluginId: "review",
    version: "3.0.0-alpha.3",
    dependsOn: ["review.0001.offline-packages"],
    sql: `
      CREATE TABLE IF NOT EXISTS review_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('compliance', 'review', 'script-review', 'shot-review', 'prompt-version', 'cloud-binding', 'cloud-connection')),
        project_id TEXT,
        parent_id TEXT,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_records_kind_project
        ON review_records(kind, project_id, created_at, id);
      CREATE INDEX IF NOT EXISTS review_records_kind_parent
        ON review_records(kind, parent_id, created_at, id);
    `,
  },
] as const;

export function createReviewPlugin(host?: ReviewHostCapability) {
  return definePlugin({
    inject: [PRODUCTION_RECORD_SERVICE.id, TIMELINE_SERVICE.id],
    descriptor: {
      id: "review",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "production", "media", "timeline"],
      provides: [
        "review.offline-packages",
        "review.feedback",
        "review.records",
      ],
      stability: "internal",
    },
    ui: [
      {
        id: "review.route.workspace",
        pluginId: "review",
        kind: "route",
        metadata: { path: "/review", title: "审核交付" },
      },
      {
        id: "review.navigation.workspace",
        pluginId: "review",
        kind: "navigation",
        metadata: {
          section: "main",
          order: 50,
          label: "审核交付",
          to: "/review",
        },
      },
      {
        id: "review.editor.package",
        pluginId: "review",
        kind: "editor",
        metadata: { target: "review-package", title: "审片编辑器" },
      },
    ],
    migrations: reviewMigrations,
    apply: (context) => {
      registerReviewCreation(context);
      const timeline = optionalService<TimelineService>(
        context,
        TIMELINE_SERVICE,
      );
      const production = optionalService<ProductionRecordService>(
        context,
        PRODUCTION_RECORD_SERVICE,
      );
      if (!timeline || !production)
        throw new Error("review requires timeline and production services");
      const records = createRecordService(context);
      context.effect(
        () => provideService(context, REVIEW_RECORD_SERVICE, records),
        `service:${REVIEW_RECORD_SERVICE}`,
      );
      for (const contribution of reviewRoutes(
        context,
        timeline,
        production,
        records,
        host,
      ))
        context.effect(
          () => context.http.register(contribution),
          `route:${contribution.id}`,
        );
    },
  });
}

export const reviewPlugin = createReviewPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "review-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createReviewPlugin(
        ctx.pluginEnvironment.host as Parameters<typeof createReviewPlugin>[0],
      ),
      config,
    );
  },
};
