import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MediaRecordSchema,
  MediaSourceStatusSchema,
  MediaSourceReviewSchema,
  MediaSourceReviewInputSchema,
  MediaSourceReviewConfirmationSchema,
  MediaSourceReviewPageSchema,
  MediaSourceReviewSummarySchema,
  MediaSourceReviewSummaryPageSchema,
  type MediaRecord,
  type MediaRecordService,
  type MediaSourceBinding,
  type MediaSourceStatus,
  type MediaSourceReview,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import { mediaReviewSummaryRoute } from "./review-summaries.js";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  StoryboardShotSourceObservationSchema,
} from "@dramaip/contracts/production";
import {
  optionalService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const mediaSourceMigration: PluginMigration = {
  id: "media.0007.immutable-source-bindings",
  pluginId: "media",
  version: "3.0.0-alpha.4",
  dependsOn: ["media.0006.shot-source-versions"],
  // Existing editable payloads are not evidence: no historical backfill.
  sql: `CREATE TABLE media_record_source_bindings (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES media_records(id) ON DELETE CASCADE,
    shot_id TEXT NOT NULL, shot_version INTEGER NOT NULL CHECK(shot_version >= 0),
    content_hash TEXT NOT NULL, binding_version INTEGER NOT NULL CHECK(binding_version > 0),
    origin TEXT NOT NULL CHECK(origin IN ('generation','manual-record','human-review')),
    created_at TEXT NOT NULL, UNIQUE(record_id,binding_version)
  );
  CREATE TRIGGER media_source_binding_immutable BEFORE UPDATE ON media_record_source_bindings
    BEGIN SELECT RAISE(ABORT, 'media source bindings are immutable'); END;
  CREATE TABLE media_record_source_heads (
    record_id TEXT PRIMARY KEY REFERENCES media_records(id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES media_record_source_bindings(id)
  );
  CREATE TABLE media_source_reviews (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES media_records(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX media_source_review_record ON media_source_reviews(record_id,created_at DESC,id DESC);
  CREATE TABLE media_source_review_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response_json TEXT NOT NULL
  );`,
};

type ShotSource = { id: string; version: number };
export class RetiredShotSourceError extends Error {
  constructor() {
    super("实际镜头已退役，保留历史素材但不能创建新的当前来源。");
  }
}
const administrative = new Set([
  "采用状态",
  "adopted",
  "锁定状态",
  "locked",
  "stale",
  "staleReason",
  "过期状态",
  "sourceShotId",
  "sourceShotVersion",
  "invalidatedByStoryboardResultId",
  "invalidatedShotVersion",
  "镜头用途",
]);
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const mediaContentHash = (record: MediaRecord) =>
  hash({
    kind: record.kind,
    projectId: record.projectId,
    parentId: record.parentId,
    payload: Object.fromEntries(
      Object.entries(record.payload).filter(
        ([key]) => !administrative.has(key),
      ),
    ),
  });

export function sourceBinding(
  tx: UnitOfWorkTransaction,
  recordId: string,
): MediaSourceBinding | undefined {
  const row = tx.get<{
    id: string;
    record_id: string;
    shot_id: string;
    shot_version: number;
    content_hash: string;
    binding_version: number;
    origin: MediaSourceBinding["origin"];
    created_at: string;
  }>(
    `SELECT b.* FROM media_record_source_bindings b JOIN media_record_source_heads h ON h.binding_id = b.id WHERE h.record_id = ?`,
    recordId,
  );
  return row
    ? {
        id: row.id,
        recordId: row.record_id,
        shotId: row.shot_id,
        shotVersion: row.shot_version,
        contentHash: row.content_hash,
        version: row.binding_version,
        origin: row.origin,
        createdAt: row.created_at,
      }
    : undefined;
}
export function appendSourceBinding(
  tx: UnitOfWorkTransaction,
  record: MediaRecord,
  source: ShotSource,
  origin: MediaSourceBinding["origin"],
): MediaSourceBinding {
  const previous = sourceBinding(tx, record.id);
  const value: MediaSourceBinding = {
    id: crypto.randomUUID(),
    recordId: record.id,
    shotId: source.id,
    shotVersion: source.version,
    contentHash: mediaContentHash(record),
    version: (previous?.version ?? 0) + 1,
    origin,
    createdAt: new Date().toISOString(),
  };
  tx.run(
    "INSERT INTO media_record_source_bindings VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    value.id,
    value.recordId,
    value.shotId,
    value.shotVersion,
    value.contentHash,
    value.version,
    value.origin,
    value.createdAt,
  );
  tx.run(
    "INSERT INTO media_record_source_heads VALUES (?, ?) ON CONFLICT(record_id) DO UPDATE SET binding_id = excluded.binding_id",
    value.recordId,
    value.id,
  );
  return value;
}
export function manualShotSource(
  context: PluginContext,
  record: Pick<MediaRecord, "projectId" | "parentId" | "payload">,
): ShotSource | undefined {
  const production = optionalService(context, PRODUCTION_RECORD_SERVICE);
  const parent = record.parentId ? production?.get(record.parentId) : undefined;
  const shotId =
    parent?.kind === "shots"
      ? parent.id
      : typeof record.payload["关联分镜"] === "string"
        ? record.payload["关联分镜"]
        : undefined;
  if (!shotId) return undefined;
  const shot = production?.get(shotId);
  if (shot?.retirement) throw new RetiredShotSourceError();
  if (
    !shot ||
    shot.kind !== "shots" ||
    shot.projectId !== record.projectId ||
    shot.retirement
  )
    throw new Error("素材必须关联同项目的实际镜头。");
  return { id: shot.id, version: shot.version };
}

/** Cross-owner access is exclusively through Production's public services. */
export function inspectShot(
  context: PluginContext,
  projectId: string,
  shotId: string,
) {
  const production = optionalService(context, PRODUCTION_RECORD_SERVICE);
  const shot = production?.get(shotId);
  const reasons: string[] = [];
  if (!shot || shot.kind !== "shots" || shot.projectId !== projectId)
    return {
      shot: undefined,
      episodeId: undefined,
      sceneId: undefined,
      scriptId: undefined,
      reasons: ["关联实际镜头不存在或不属于本项目。"],
      fingerprint: "missing",
    };
  if (shot.retirement)
    reasons.push("关联实际镜头已退役，历史素材保留但不能视作当前来源。");
  const scene = shot.parentId ? production?.get(shot.parentId) : undefined;
  const script = scene?.parentId ? production?.get(scene.parentId) : undefined;
  const episode = script?.parentId
    ? production?.get(script.parentId)
    : undefined;
  if (
    scene?.kind !== "scenes" ||
    script?.kind !== "scripts" ||
    episode?.kind !== "episodes" ||
    [scene, script, episode].some((item) => item?.projectId !== projectId)
  )
    reasons.push("镜头的实际场景、剧本和分集归属未核全。");
  let formal:
    | { id: string; version: number; sourceState: "current" | "stale" }
    | undefined;
  try {
    const observation = StoryboardShotSourceObservationSchema.parse(
      optionalService(
        context,
        PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
      )?.observeStoryboardShot(projectId, shotId),
    );
    formal = "formal" in observation ? observation.formal : undefined;
    if (observation.state === "stale")
      reasons.push(
        "当前正式分镜的上游或实际镜头依据已变化，须先完成正式修订。",
      );
    if (observation.state === "unavailable")
      reasons.push("当前正式分镜来源资格不可核对。");
  } catch {
    reasons.push("当前正式分镜来源资格不可核对。");
  }
  return {
    shot,
    episodeId: episode?.id,
    sceneId: scene?.id,
    scriptId: script?.id,
    reasons,
    fingerprint: hash({
      shot: [shot.id, shot.version],
      scene: scene?.id,
      script: script?.id,
      episode: episode?.id,
      formal: formal ? [formal.id, formal.version, formal.sourceState] : null,
    }),
  };
}
export function mediaSourceStatus(
  context: PluginContext,
  record: MediaRecord,
): MediaSourceStatus {
  const binding = context.uow.execute((tx) => sourceBinding(tx, record.id));
  const base = {
    recordId: record.id,
    recordVersion: record.version,
    verification: "actual-record-version-only" as const,
  };
  if (!binding) {
    const claimed = record.payload.sourceShotId ?? record.payload["关联分镜"];
    const parent = record.parentId
      ? optionalService(context, PRODUCTION_RECORD_SERVICE)?.get(
          record.parentId,
        )
      : undefined;
    const mapped = Boolean(
      claimed ||
      parent?.kind === "shots" ||
      record.kind === "shot-stills" ||
      record.kind === "video",
    );
    return {
      ...base,
      state: mapped ? "unverified" : "unbound",
      reasons: mapped ? ["历史素材没有不可编辑的来源绑定，须人工复核。"] : [],
    };
  }
  const actual = inspectShot(context, record.projectId, binding.shotId);
  const reasons = [...actual.reasons];
  if (actual.shot && actual.shot.version !== binding.shotVersion)
    reasons.push("实际镜头版本已变化，原素材保留待复核。");
  if (mediaContentHash(record) !== binding.contentHash)
    reasons.push("素材内容或归属已变化，原来源绑定不能证明新内容。");
  if (record.payload.stale === true)
    reasons.push(String(record.payload.staleReason ?? "该素材已标记待复核。"));
  return {
    ...base,
    binding,
    state: reasons.length ? "stale" : "current",
    reasons,
    ...(actual.shot ? { actualShotVersion: actual.shot.version } : {}),
  };
}

class ReviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new ReviewError(409, message);
}
type StoredReview = Omit<MediaSourceReview, "sourceState" | "staleReasons">;
interface RequestContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  json(value: unknown, status?: number): Response;
  header(name: string, value: string): void;
}
export function mediaSourceRoutes(
  context: PluginContext,
  records: MediaRecordService,
  workspace: WorkspaceProjectService,
) {
  const read = (id: string) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM media_source_reviews WHERE id = ?",
        id,
      );
      return row ? (JSON.parse(row.value_json) as StoredReview) : undefined;
    });
  const reasons = (value: StoredReview) => {
    const record = records.get(value.recordId);
    if (!record) return ["原素材不存在。"];
    const result = inspectShot(context, value.projectId, value.shotId);
    const issues = [...result.reasons];
    if (result.fingerprint !== value.sourceFingerprint)
      issues.push("实际镜头或正式来源已变化，请重新建立复核预览。");
    if (value.state === "pending") {
      if (
        record.version !== value.recordVersion ||
        mediaContentHash(record) !== value.contentHash
      )
        issues.push("素材已变化，原复核预览不可采用。");
      const head = context.uow.execute((tx) => sourceBinding(tx, record.id));
      if (head?.id !== value.previousBinding?.id)
        issues.push("已有另一份复核更新了来源绑定。");
    }
    if (value.state === "adopted") {
      const head = context.uow.execute((tx) => sourceBinding(tx, record.id));
      if (
        !head ||
        head.id !== value.adoptedBindingId ||
        mediaContentHash(record) !== head.contentHash
      )
        issues.push("这份历史复核的素材内容或采用绑定已变化。");
    }
    return issues;
  };
  const decode = (value: StoredReview): MediaSourceReview => {
    const issues = reasons(value);
    return {
      ...value,
      sourceState: issues.length ? "stale" : "current",
      staleReasons: issues,
    };
  };
  const params = z.object({ id: z.string().uuid() });
  const make = (
    action:
      "record" | "status" | "list" | "preview" | "get" | "adopt" | "discard",
  ) => {
    const method =
      action === "record" ||
      action === "status" ||
      action === "get" ||
      action === "list"
        ? "get"
        : "post";
    const path =
      action === "record"
        ? "/api/v2/media-records/{id}"
        : action === "status"
          ? "/api/v2/media-records/{id}/source"
          : action === "list" || action === "preview"
            ? "/api/v2/media-records/{id}/source-reviews"
            : `/api/v2/media-source-reviews/{id}${action === "get" ? "" : `/${action}`}`;
    const response =
      action === "record"
        ? MediaRecordSchema
        : action === "status"
          ? MediaSourceStatusSchema
          : action === "list"
            ? MediaSourceReviewPageSchema
            : MediaSourceReviewSchema;
    const body =
      action === "preview"
        ? MediaSourceReviewInputSchema
        : action === "adopt"
          ? MediaSourceReviewConfirmationSchema
          : z.object({});
    const operationId = `media-sources.${action}`;
    return defineRouteContribution({
      id: `media:source-${action}`,
      pluginId: "media",
      method,
      path: path as `/api/v2/${string}`,
      operationId,
      ...(method === "post"
        ? {
            policy: {
              idempotency: "required" as const,
              idempotencyReplay: "handler" as const,
              ...(action === "preview"
                ? {}
                : { concurrency: "if-match-required" as const }),
            },
          }
        : {}),
      declaration: createRoute({
        method,
        path,
        operationId,
        request: {
          params,
          ...(action === "list"
            ? {
                query: z.object({
                  cursor: z.string().max(1000).optional(),
                  limit: z.coerce.number().int().min(1).max(100).optional(),
                }),
              }
            : {}),
          ...(method === "post"
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: body } },
                },
                headers: z.object({
                  "Idempotency-Key": z.string().min(1).max(240),
                  ...(action === "preview" ? {} : { "If-Match": z.string() }),
                }),
              }
            : {}),
        },
        responses: {
          200: {
            description: "Owner-verified source metadata",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 412, 428].map((status) => [
              status,
              {
                description: "Validation or conditional request failed",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
          409: {
            description: "Source conflict",
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
      }),
      handler: async (c: RequestContext) => {
        const respond = (value: unknown) => {
          const version =
            value && typeof value === "object" && "stateVersion" in value
              ? value.stateVersion
              : undefined;
          c.header(
            "ETag",
            typeof version === "number"
              ? `"${version}"`
              : `"source-${hash(value)}"`,
          );
          return c.json(value);
        };
        try {
          const id = c.req.param("id");
          if (action === "record") {
            const record = records.get(id);
            if (!record) throw new ReviewError(404, "未找到实际素材记录。");
            return respond(record);
          }
          if (action === "status") {
            const record = records.get(id);
            if (!record) throw new ReviewError(404, "未找到素材。");
            return respond(mediaSourceStatus(context, record));
          }
          if (action === "list") {
            if (!records.get(id)) throw new ReviewError(404, "未找到素材。");
            const limit = z.coerce
              .number()
              .int()
              .min(1)
              .max(100)
              .parse(c.req.query("limit") ?? 25);
            let cursor: { createdAt: string; id: string } | undefined;
            if (c.req.query("cursor")) {
              try {
                cursor = z
                  .object({
                    createdAt: z.string().datetime(),
                    id: z.string().uuid(),
                  })
                  .parse(
                    JSON.parse(
                      Buffer.from(c.req.query("cursor")!, "base64url").toString(
                        "utf8",
                      ),
                    ),
                  );
              } catch {
                throw new ReviewError(400, "复核历史游标无效。");
              }
            }
            const rows = context.uow.execute((tx) =>
              cursor
                ? tx.all<{
                    value_json: string;
                    created_at: string;
                    id: string;
                  }>(
                    "SELECT * FROM media_source_reviews WHERE record_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?",
                    id,
                    cursor.createdAt,
                    cursor.createdAt,
                    cursor.id,
                    limit + 1,
                  )
                : tx.all<{
                    value_json: string;
                    created_at: string;
                    id: string;
                  }>(
                    "SELECT * FROM media_source_reviews WHERE record_id = ? ORDER BY created_at DESC,id DESC LIMIT ?",
                    id,
                    limit + 1,
                  ),
            );
            const page = rows.slice(0, limit);
            const last = page.at(-1);
            return respond({
              items: page.map((row) =>
                decode(JSON.parse(row.value_json) as StoredReview),
              ),
              ...(rows.length > limit && last
                ? {
                    nextCursor: Buffer.from(
                      JSON.stringify({
                        createdAt: last.created_at,
                        id: last.id,
                      }),
                    ).toString("base64url"),
                  }
                : {}),
            });
          }
          if (action === "get") {
            const value = read(id);
            if (!value) throw new ReviewError(404, "未找到复核预览。");
            return respond(decode(value));
          }
          const input = body.parse(await c.req.json());
          const key = c.req.header("Idempotency-Key");
          if (!key) throw new ReviewError(400, "复核操作需要幂等键。");
          const versionHeader = c.req.header("If-Match");
          const requestHash = hash({ id, action, input, versionHeader });
          const old = context.uow.execute((tx) =>
            tx.get<{ request_hash: string; response_json: string }>(
              "SELECT * FROM media_source_review_requests WHERE request_key = ?",
              key,
            ),
          );
          if (old) {
            if (old.request_hash !== requestHash)
              fail("同一幂等键不能复用于不同复核操作。");
            const replay = read(
              (JSON.parse(old.response_json) as MediaSourceReview).id,
            );
            if (!replay) throw new ReviewError(404, "原复核已随素材移除。");
            return respond(decode(replay));
          }
          // Service reads happen outside the Media transaction. No asynchronous
          // gap exists between verification and the atomic Media CAS/receipt.
          if (action === "preview") {
            const target = MediaSourceReviewInputSchema.parse(input);
            const record = records.get(id);
            if (!record) throw new ReviewError(404, "未找到素材。");
            if (record.version !== target.recordVersion)
              fail("素材版本已变化，请刷新。");
            const actual = inspectShot(
              context,
              record.projectId,
              target.shotId,
            );
            if (
              !actual.shot ||
              actual.shot.version !== target.shotVersion ||
              actual.reasons.length
            )
              fail(actual.reasons.join("；") || "实际镜头版本已变化。");
            const now = new Date().toISOString();
            const previousBinding = context.uow.execute((tx) =>
              sourceBinding(tx, record.id),
            );
            const shot = actual.shot!;
            const mapped = manualShotSource(context, record);
            if (
              (previousBinding && previousBinding.shotId !== shot.id) ||
              (!previousBinding && mapped && mapped.id !== shot.id)
            )
              fail("本次复核只更新原镜头版本，不允许悄悄改绑其他镜头。");
            const review: StoredReview = {
              id: crypto.randomUUID(),
              recordId: id,
              projectId: record.projectId,
              recordVersion: record.version,
              contentHash: mediaContentHash(record),
              ...(previousBinding ? { previousBinding } : {}),
              shotId: shot.id,
              shotVersion: shot.version,
              sourceFingerprint: actual.fingerprint,
              state: "pending",
              stateVersion: 0,
              createdAt: now,
              updatedAt: now,
            };
            const response: MediaSourceReview = {
              ...review,
              sourceState: "current",
              staleReasons: [],
            };
            context.uow.execute((tx) => {
              const actualRecord = tx.get<{ version: number }>(
                "SELECT version FROM media_records WHERE id = ?",
                id,
              );
              if (
                actualRecord?.version !== record.version ||
                sourceBinding(tx, id)?.id !== previousBinding?.id
              )
                fail("素材或来源绑定已变化。");
              tx.run(
                "INSERT INTO media_source_reviews VALUES (?, ?, ?, ?)",
                review.id,
                id,
                JSON.stringify(review),
                now,
              );
              tx.append({
                type: "media.source-review-created.v1",
                pluginId: "media",
                aggregateType: "media-source-review",
                aggregateId: review.id,
                aggregateVersion: 0,
                payload: {
                  id: review.id,
                  recordId: id,
                  projectId: record.projectId,
                  shotId: review.shotId,
                  shotVersion: review.shotVersion,
                },
              });
              tx.run(
                "INSERT INTO media_source_review_requests VALUES (?, ?, ?)",
                key,
                requestHash,
                JSON.stringify(response),
              );
            });
            return respond(response);
          }
          const review = read(id);
          if (!review) throw new ReviewError(404, "未找到复核预览。");
          if (versionHeader !== `"${review.stateVersion}"`)
            throw new ReviewError(412, "复核状态版本已变化，请刷新。");
          if (review.state !== "pending") fail("复核状态已变化，请刷新。");
          const issues = reasons(review);
          if (action === "adopt" && issues.length) fail(issues.join("；"));
          const record = records.get(review.recordId);
          const updated: StoredReview = {
            ...review,
            state: action === "adopt" ? "adopted" : "discarded",
            stateVersion: review.stateVersion + 1,
            updatedAt: new Date().toISOString(),
          };
          const response: MediaSourceReview = {
            ...updated,
            sourceState: issues.length ? "stale" : "current",
            staleReasons: issues,
          };
          context.uow.execute((tx) => {
            const stored = tx.get<{ value_json: string }>(
              "SELECT value_json FROM media_source_reviews WHERE id = ?",
              id,
            );
            const currentReview = stored
              ? (JSON.parse(stored.value_json) as StoredReview)
              : undefined;
            if (currentReview?.stateVersion !== review.stateVersion)
              throw new ReviewError(412, "复核状态版本已变化。");
            if (currentReview.state !== "pending") fail("复核状态已变化。");
            if (action === "adopt") {
              if (
                !record ||
                tx.get<{ version: number }>(
                  "SELECT version FROM media_records WHERE id = ?",
                  record.id,
                )?.version !== review.recordVersion ||
                sourceBinding(tx, record.id)?.id !== review.previousBinding?.id
              )
                fail("素材或绑定已变化。");
              const payload: Record<string, unknown> = {
                ...record.payload,
                sourceShotId: review.shotId,
                sourceShotVersion: review.shotVersion,
              };
              for (const key of [
                "stale",
                "staleReason",
                "invalidatedByStoryboardResultId",
                "invalidatedShotVersion",
                "过期状态",
              ])
                delete payload[key];
              // Review updates proof, not adoption/lock/cost/rights decisions.
              payload["采用状态"] = "未采用";
              payload.adopted = false;
              tx.run(
                "UPDATE media_records SET payload_json = ?,version = version + 1,updated_at = ? WHERE id = ? AND version = ?",
                JSON.stringify(payload),
                new Date().toISOString(),
                record.id,
                record.version,
              );
              const binding = appendSourceBinding(
                tx,
                { ...record, payload, version: record.version + 1 },
                { id: review.shotId, version: review.shotVersion },
                "human-review",
              );
              updated.adoptedBindingId = binding.id;
              response.adoptedBindingId = binding.id;
            }
            tx.run(
              "UPDATE media_source_reviews SET value_json = ? WHERE id = ?",
              JSON.stringify(updated),
              id,
            );
            tx.append({
              type: `media.source-review-${action === "adopt" ? "adopted" : "discarded"}.v1`,
              pluginId: "media",
              aggregateType: "media-source-review",
              aggregateId: id,
              aggregateVersion: updated.stateVersion,
              payload: {
                id,
                recordId: review.recordId,
                projectId: review.projectId,
                shotId: review.shotId,
                shotVersion: review.shotVersion,
              },
            });
            tx.run(
              "INSERT INTO media_source_review_requests VALUES (?, ?, ?)",
              key,
              requestHash,
              JSON.stringify(response),
            );
          });
          return respond(response);
        } catch (error) {
          if (!(error instanceof ReviewError) && !(error instanceof z.ZodError))
            throw error;
          const status = error instanceof ReviewError ? error.status : 400;
          return new Response(
            JSON.stringify({
              type: "about:blank",
              title: status === 404 ? "Not found" : "Source review conflict",
              status,
              code:
                status === 412
                  ? "PRECONDITION_FAILED"
                  : status === 400
                    ? "VALIDATION_ERROR"
                    : "MEDIA_SOURCE_REVIEW",
              traceId: crypto.randomUUID(),
              detail: error.message,
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
  };
  return [
    mediaReviewSummaryRoute<StoredReview>(context, workspace, {
      id: "media:source-review-summaries",
      operationId: "media-sources.summaries",
      path: "/api/v2/projects/{projectId}/media-source-review-summaries",
      table: "media_source_reviews",
      schema: MediaSourceReviewSummaryPageSchema,
      project: (stored) => {
        const value = decode(stored);
        const {
          id,
          recordId,
          projectId,
          recordVersion,
          shotId,
          shotVersion,
          state,
          stateVersion,
          sourceState,
          createdAt,
          updatedAt,
        } = value;
        return MediaSourceReviewSummarySchema.parse({
          id,
          recordId,
          projectId,
          recordVersion,
          shotId,
          shotVersion,
          state,
          stateVersion,
          sourceState,
          createdAt,
          updatedAt,
          reasonCount: value.staleReasons.length,
        });
      },
    }),
    ...(
      [
        "record",
        "status",
        "list",
        "preview",
        "get",
        "adopt",
        "discard",
      ] as const
    ).map(make),
  ];
}
