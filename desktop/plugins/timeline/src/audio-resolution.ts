import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import type {
  AudioTrack,
  MediaAudioTrackService,
  MediaRecordService,
} from "@dramaip/contracts/media";
import {
  AudioResolutionSchema,
  AudioResolutionInputSchema,
  AudioResolutionConfirmationSchema,
  AudioResolutionPageSchema,
  AudioResolutionOptionsSchema,
  TimelineManifestSchema,
  AudioResolutionSummarySchema,
  AudioResolutionSummaryPageSchema,
  type AudioResolution,
  type AudioResolutionInput,
  type AudioResolutionOptions,
  type TimelineManifest,
  type TimelineClip,
} from "@dramaip/contracts/timeline";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const audioResolutionMigration: PluginMigration = {
  id: "timeline.0004.explicit-audio-source-resolutions",
  pluginId: "timeline",
  version: "3.0.0-alpha.4",
  dependsOn: ["timeline.0003.audio-assembly-receipts"],
  sql: `CREATE TABLE timeline_audio_resolutions(id TEXT PRIMARY KEY,timeline_id TEXT NOT NULL REFERENCES timelines(id),value_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX timeline_audio_resolutions_history ON timeline_audio_resolutions(timeline_id,created_at DESC,id DESC);
    CREATE TABLE timeline_audio_resolution_requests(request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,review_id TEXT NOT NULL REFERENCES timeline_audio_resolutions(id));`,
};
interface Store {
  read(id: string): TimelineManifest | undefined;
  matches(tx: UnitOfWorkTransaction, current: TimelineManifest): boolean;
  save(
    current: TimelineManifest,
    next: TimelineManifest,
    finalize: (tx: UnitOfWorkTransaction, saved: TimelineManifest) => void,
  ): TimelineManifest | "conflict";
}
interface RequestContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
}
type Stored = AudioResolution & {
  input: AudioResolutionInput;
  sourceHash: string;
};
class ResolutionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    text: string,
  ) {
    super(text);
  }
}
const fail = (status: number, code: string, text: string): never => {
  throw new ResolutionError(status, code, text);
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fps = (timeline: TimelineManifest) =>
  timeline.profile.frameRate.numerator / timeline.profile.frameRate.denominator;

/** All ancestry comes from Media's public immutable revision projections, never peer SQL or editable payload. */
function lineage(
  timeline: TimelineManifest,
  before: TimelineClip,
  target: AudioTrack,
  targetClipId: string,
  all: readonly AudioTrack[],
): string[] | undefined {
  const seen = new Set<string>();
  const reviews: string[] = [];
  let track = target;
  let clipId = targetClipId;
  while (!seen.has(track.id)) {
    seen.add(track.id);
    if (
      track.projectId !== timeline.projectId ||
      track.episodeId !== timeline.episodeId ||
      !track.clips.some((clip) => clip.id === clipId)
    )
      return undefined;
    if (track.id === before.audioTrackId)
      return clipId === before.sourceClipId ? reviews : undefined;
    const link = track.revision;
    const mapping = link?.clipLinks.find((item) => item.nextClipId === clipId);
    const parent = all.find((item) => item.id === link?.sourceTrackId);
    if (!link || !mapping || !parent) return undefined;
    reviews.push(link.reviewId);
    track = parent;
    clipId = mapping.previousClipId;
  }
  return undefined;
}

export function audioResolutionRoutes(
  context: PluginContext,
  audio: MediaAudioTrackService,
  media: MediaRecordService,
  store: Store,
  workspace: WorkspaceProjectService,
) {
  const read = (id: string) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM timeline_audio_resolutions WHERE id = ?",
        id,
      );
      return row ? (JSON.parse(row.value_json) as Stored) : undefined;
    });
  const options = (timeline: TimelineManifest): AudioResolutionOptions => {
    const all = audio.list(timeline.episodeId);
    return {
      timelineId: timeline.id,
      timelineVersion: timeline.version,
      items: timeline.tracks.flatMap((group) =>
        group.clips
          .filter((clip) => clip.audioTrackId)
          .map((clip) => {
            const source = all.find((track) => track.id === clip.audioTrackId);
            const original = source?.clips.find(
              (item) => item.id === clip.sourceClipId,
            );
            const reasons: string[] = [];
            if (
              !source ||
              source.projectId !== timeline.projectId ||
              source.episodeId !== timeline.episodeId ||
              source.status !== "adopted" ||
              source.stale ||
              source.sourceState !== "current"
            )
              reasons.push(
                "原装配音轨已过期、未核验或不再是本分集有效采用轨。",
              );
            if (
              !original ||
              clip.audioTrackVersion !== source?.version ||
              clip.audioSourceFingerprint !== source?.sourceFingerprint ||
              original.shotId !== clip.shotId ||
              (group.kind !== "subtitle" && original.assetId !== clip.assetId)
            )
              reasons.push("原装配的冻结版本或片段关联不一致。");
            const replacements = all
              .filter(
                (track) =>
                  track.projectId === timeline.projectId &&
                  track.episodeId === timeline.episodeId &&
                  track.status === "adopted" &&
                  !track.stale &&
                  track.sourceState === "current" &&
                  (group.kind === "subtitle"
                    ? track.kind === "dialogue" || track.kind === "narration"
                    : track.kind === group.kind),
              )
              .flatMap((track) =>
                track.clips.flatMap((item) => {
                  const path = lineage(timeline, clip, track, item.id, all);
                  const availableFrames = Math.max(
                    1,
                    Math.round(item.durationSeconds * fps(timeline)),
                  );
                  return path &&
                    clip.sourceOffsetFrame + clip.durationFrames <=
                      availableFrames
                    ? [
                        {
                          track,
                          sourceClipId: item.id,
                          lineageReviewIds: path,
                          availableFrames,
                        },
                      ]
                    : [];
                }),
              );
            return {
              clip,
              kind: group.kind,
              ...(source?.projectId === timeline.projectId
                ? { sourceTrack: source }
                : {}),
              sourceState:
                source?.sourceState === "unverified"
                  ? ("unverified" as const)
                  : reasons.length
                    ? ("stale" as const)
                    : ("current" as const),
              reasons,
              replacements,
            };
          }),
      ),
    };
  };
  const compile = (timeline: TimelineManifest, input: AudioResolutionInput) => {
    if (timeline.version !== input.timelineVersion)
      fail(412, "PRECONDITION_FAILED", "时间线版本已变化。");
    if (
      new Set(input.changes.map((change) => change.clipId)).size !==
      input.changes.length
    )
      fail(400, "VALIDATION_ERROR", "不能重复处理同一时间线片段。");
    const catalog = options(timeline);
    const after = structuredClone(timeline);
    const changes: AudioResolution["changes"] = [];
    for (const change of input.changes) {
      const entry = catalog.items.find(
        (item) => item.clip.id === change.clipId,
      );
      if (!entry)
        fail(
          400,
          "VALIDATION_ERROR",
          "只能处理本时间线真实引用的音轨／字幕片段。",
        );
      const group = after.tracks.find(
        (item) => item.id === entry!.clip.trackId,
      )!;
      const position = group.clips.findIndex(
        (item) => item.id === change.clipId,
      );
      if (change.action === "remove") {
        group.clips.splice(position, 1);
        changes.push({
          input: change,
          kind: entry!.kind,
          before: entry!.clip,
          ...(entry!.sourceTrack ? { originalSource: entry!.sourceTrack } : {}),
        });
        continue;
      }
      const target = entry!.replacements.find(
        (item) =>
          item.track.id === change.audioTrackId &&
          item.sourceClipId === change.sourceClipId,
      );
      if (!target)
        fail(
          409,
          "AUDIO_RESOLUTION_SOURCE_CONFLICT",
          "目标须是同分集当前已采用、谱系对应且足够长的实际片段；不能猜映射或自动裁短。",
        );
      if (entry!.kind !== "subtitle" && change.subtitleText !== "keep")
        fail(400, "VALIDATION_ERROR", "只有字幕片段可以明确改用新文本。");
      const source = target!.track.clips.find(
        (item) => item.id === target!.sourceClipId,
      )!;
      const next = {
        ...entry!.clip,
        audioTrackId: target!.track.id,
        audioTrackVersion: target!.track.version,
        audioSourceFingerprint: target!.track.sourceFingerprint,
        sourceClipId: source.id,
        manuallyEdited: true,
      };
      delete next.mediaRef;
      delete next.assetId;
      delete next.assetVersion;
      delete next.shotId;
      if (source.shotId) next.shotId = source.shotId;
      next.mediaStatus = "unattached";
      if (entry!.kind === "subtitle") {
        if (change.subtitleText === "replacement") {
          if (!source.text?.trim())
            fail(
              409,
              "AUDIO_RESOLUTION_SOURCE_CONFLICT",
              "新片段没有实际字幕文本，不能替换。 ",
            );
          next.text = source.text!;
          next.name = source.text!;
        }
      } else if (source.assetId) {
        const asset = media.get(source.assetId);
        const expected = source.sourceVersions?.find(
          (item) => item.kind === "asset" && item.id === source.assetId,
        )?.version;
        if (
          !asset ||
          asset.projectId !== timeline.projectId ||
          asset.version !== expected
        )
          fail(
            409,
            "AUDIO_RESOLUTION_SOURCE_CONFLICT",
            "目标实际素材版本已变化。",
          );
        next.assetId = source.assetId;
        next.assetVersion = expected;
        const ref = asset!.payload["mediaRef"];
        if (
          typeof ref === "string" &&
          /^[a-z0-9][a-z0-9_-]{0,199}$/iu.test(ref)
        ) {
          next.mediaRef = ref;
          next.mediaStatus = "linked";
        }
      }
      group.clips[position] = next;
      changes.push({
        input: change,
        kind: entry!.kind,
        before: entry!.clip,
        ...(entry!.sourceTrack ? { originalSource: entry!.sourceTrack } : {}),
        after: next,
        target,
      });
    }
    after.durationFrames = Math.max(
      1,
      ...after.tracks.flatMap((group) =>
        group.clips.map((clip) => clip.startFrame + clip.durationFrames),
      ),
    );
    after.version = timeline.version + 1;
    // Use the same canonical projection as Timeline reads. Rebinding removes and
    // re-adds optional references; insertion order must not make a saved receipt stale.
    const normalized = TimelineManifestSchema.parse(after);
    return {
      after: normalized,
      changes,
      sourceHash: hash({
        changes: changes.map(
          ({ originalSource: _originalSource, ...change }) => change,
        ),
        tracks: normalized.tracks,
        durationFrames: normalized.durationFrames,
      }),
    };
  };
  const project = (value: Stored): AudioResolution => {
    const { input, sourceHash, ...result } = value;
    const reasons: string[] = [];
    const current = store.read(value.timelineId);
    if (value.state !== "discarded") {
      const expected = value.state === "pending" ? value.before : value.after;
      if (!current || hash(current) !== hash(expected))
        reasons.push(
          value.state === "pending"
            ? "时间线已有新的实际编辑，禁止确认旧差异。"
            : "时间线已发生后续编辑或撤销；本回执保留为历史。",
        );
      try {
        if (compile(value.before, input).sourceHash !== sourceHash)
          reasons.push("候选实际来源、谱系或素材引用已变化。");
      } catch (error) {
        reasons.push(
          error instanceof Error ? error.message : "候选来源已变化。",
        );
      }
    }
    return {
      ...result,
      sourceState: reasons.length ? "stale" : "current",
      reasons,
      isCurrent: value.state === "confirmed" && !reasons.length,
    };
  };
  const reply = (value: unknown, version?: number) =>
    new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        ETag: version === undefined ? `"${hash(value)}"` : `"${version}"`,
      },
    });
  const definitions = [
    {
      action: "options",
      method: "get",
      path: "/api/v2/timelines/{id}/audio-source-options",
    },
    {
      action: "list",
      method: "get",
      path: "/api/v2/timelines/{id}/audio-resolution-previews",
    },
    {
      action: "preview",
      method: "post",
      path: "/api/v2/timelines/{id}/audio-resolution-previews",
    },
    { action: "get", method: "get", path: "/api/v2/audio-resolutions/{id}" },
    {
      action: "confirm",
      method: "post",
      path: "/api/v2/audio-resolutions/{id}/confirm",
    },
    {
      action: "discard",
      method: "post",
      path: "/api/v2/audio-resolutions/{id}/discard",
    },
  ] as const;
  const summaries = defineRouteContribution({
    id: "timeline:audio-resolution-summaries",
    pluginId: "timeline",
    method: "get",
    path: "/api/v2/projects/{projectId}/audio-resolution-summaries",
    operationId: "audio-resolutions.summaries",
    declaration: createRoute({
      method: "get",
      path: "/api/v2/projects/{projectId}/audio-resolution-summaries",
      operationId: "audio-resolutions.summaries",
      request: {
        params: z.object({ projectId: z.string().uuid() }),
        query: z.object({
          cursor: z.string().max(1000).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
      responses: {
        200: {
          description: "Identity-only actual Timeline resolution summaries",
          content: {
            "application/json": { schema: AudioResolutionSummaryPageSchema },
          },
        },
        400: {
          description: "Invalid project-bound cursor",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
        404: {
          description: "Project not found",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      },
    } as never),
    handler: (request: RequestContext) => {
      try {
        const projectId = request.req.param("projectId");
        if (!workspace.get(projectId))
          fail(404, "NOT_FOUND", "未找到实际项目。");
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(request.req.query("limit") ?? 100);
        let after: [string, string] | undefined;
        const cursor = request.req.query("cursor");
        if (cursor) {
          try {
            const parsed = z
              .tuple([
                z.literal("audio-resolutions.summaries"),
                z.literal(projectId),
                z.string().datetime(),
                z.string().uuid(),
              ])
              .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
            after = [parsed[2], parsed[3]];
          } catch {
            fail(400, "VALIDATION_ERROR", "游标无效或不属于本项目／领域。");
          }
        }
        const rows = context.uow.execute((tx) => {
          if (after) {
            const actual = tx.get<{ created_at: string }>(
              "SELECT created_at FROM timeline_audio_resolutions WHERE id = ? AND json_extract(value_json, '$.projectId') = ?",
              after[1],
              projectId,
            );
            if (actual?.created_at !== after[0])
              fail(400, "VALIDATION_ERROR", "游标不对应实际预览。");
          }
          return tx.all<{ id: string; created_at: string; value_json: string }>(
            `SELECT id,created_at,value_json FROM timeline_audio_resolutions WHERE json_extract(value_json, '$.projectId') = ? ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
            projectId,
            ...(after ? [after[0], after[0], after[1]] : []),
            limit + 1,
          );
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return reply({
          items: page.map((row) => {
            const value = project(JSON.parse(row.value_json) as Stored);
            const {
              id,
              timelineId,
              projectId: ownerId,
              episodeId,
              state,
              stateVersion,
              sourceState,
              isCurrent,
              resultTimelineVersion,
              createdAt,
              updatedAt,
            } = value;
            return AudioResolutionSummarySchema.parse({
              id,
              timelineId,
              projectId: ownerId,
              episodeId,
              state,
              stateVersion,
              sourceState,
              isCurrent,
              resultTimelineVersion,
              createdAt,
              updatedAt,
              timelineVersion: value.before.version,
              changeCount: value.changes.length,
              replaceCount: value.changes.filter(
                (item) => item.input.action === "replace",
              ).length,
              removeCount: value.changes.filter(
                (item) => item.input.action === "remove",
              ).length,
              protectedCount: value.changes.filter(
                (item) => item.before.locked || item.before.manuallyEdited,
              ).length,
              reasonCount: value.reasons.length,
            });
          }),
          ...(rows.length > limit && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify([
                    "audio-resolutions.summaries",
                    projectId,
                    last.created_at,
                    last.id,
                  ]),
                ).toString("base64url"),
              }
            : {}),
        });
      } catch (error) {
        if (
          !(error instanceof ResolutionError) &&
          !(error instanceof z.ZodError)
        )
          throw error;
        const status = error instanceof ResolutionError ? error.status : 400;
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title:
              status === 404 ? "未找到实际项目。" : "摘要游标或分页条件无效。",
            status,
            code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
            traceId: crypto.randomUUID(),
          }),
          { status, headers: { "Content-Type": "application/problem+json" } },
        );
      }
    },
  });
  return [
    summaries,
    ...definitions.map(({ action, method, path }) =>
      defineRouteContribution({
        id: `timeline:audio-resolutions-${action}`,
        pluginId: "timeline",
        method,
        path,
        operationId: `audio-resolutions.${action}`,
        ...(method === "post"
          ? {
              policy: {
                idempotency: "required" as const,
                idempotencyReplay: "handler" as const,
                concurrency: "if-match-required" as const,
              },
            }
          : {}),
        declaration: createRoute({
          method,
          path,
          operationId: `audio-resolutions.${action}`,
          request: {
            params: z.object({ id: z.string().uuid() }),
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
                  headers: z.object({
                    "Idempotency-Key": z.string().min(1).max(200),
                    "If-Match": z.string(),
                  }),
                  body: {
                    required: true,
                    content: {
                      "application/json": {
                        schema:
                          action === "preview"
                            ? AudioResolutionInputSchema
                            : action === "confirm"
                              ? AudioResolutionConfirmationSchema
                              : z.object({}).strict(),
                      },
                    },
                  },
                }
              : {}),
          },
          responses: {
            200: {
              description: "Explicit, frozen audio resolution",
              content: {
                "application/json": {
                  schema:
                    action === "options"
                      ? AudioResolutionOptionsSchema
                      : action === "list"
                        ? AudioResolutionPageSchema
                        : AudioResolutionSchema,
                },
              },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428].map((status) => [
                status,
                {
                  description: "Invalid or changed actual source",
                  content: {
                    "application/problem+json": {
                      schema: ProblemDetailsSchema,
                    },
                  },
                },
              ]),
            ),
          },
        } as never),
        handler: async (request: RequestContext) => {
          try {
            const id = request.req.param("id");
            if (action === "options" || action === "list") {
              const timeline = store.read(id);
              if (!timeline) fail(404, "NOT_FOUND", "未找到时间线。");
              if (action === "options") return reply(options(timeline!));
              const limit = Number(request.req.query("limit") ?? 25);
              const cursor = request.req.query("cursor");
              let after: [string, string] | undefined;
              if (cursor) {
                try {
                  const value = z
                    .tuple([
                      z.literal(id),
                      z.string().datetime(),
                      z.string().uuid(),
                    ])
                    .parse(
                      JSON.parse(Buffer.from(cursor, "base64url").toString()),
                    );
                  after = [value[1], value[2]];
                } catch {
                  fail(400, "VALIDATION_ERROR", "游标无效或不属于本时间线。");
                }
              }
              const rows = context.uow.execute((tx) =>
                tx.all<{ id: string; created_at: string; value_json: string }>(
                  `SELECT * FROM timeline_audio_resolutions WHERE timeline_id = ? ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
                  id,
                  ...(after ? [after[0], after[0], after[1]] : []),
                  limit + 1,
                ),
              );
              const selected = rows.slice(0, limit);
              const last = selected.at(-1);
              return reply({
                items: selected.map((row) =>
                  project(JSON.parse(row.value_json) as Stored),
                ),
                ...(rows.length > limit && last
                  ? {
                      nextCursor: Buffer.from(
                        JSON.stringify([id, last.created_at, last.id]),
                      ).toString("base64url"),
                    }
                  : {}),
              });
            }
            if (action === "get") {
              const value = read(id);
              if (!value) fail(404, "NOT_FOUND", "未找到换源预览。");
              return reply(project(value!), value!.stateVersion);
            }
            const key = request.req.header("Idempotency-Key")?.trim();
            const match = request.req.header("If-Match")?.match(/^"(\d+)"$/u);
            if (!key || key.length > 200 || !match)
              fail(428, "PRECONDITION_REQUIRED", "须提供版本和幂等键。");
            const version = Number(match![1]);
            const body = (
              action === "preview"
                ? AudioResolutionInputSchema
                : action === "confirm"
                  ? AudioResolutionConfirmationSchema
                  : z.object({}).strict()
            ).safeParse(await request.req.json());
            if (!body.success)
              fail(400, "VALIDATION_ERROR", "须核对明确片段动作和全部确认项。");
            const requestHash = hash({ action, id, version, body: body.data });
            const receipt = context.uow.execute((tx) =>
              tx.get<{ request_hash: string; review_id: string }>(
                "SELECT * FROM timeline_audio_resolution_requests WHERE request_key = ?",
                key!,
              ),
            );
            if (receipt) {
              if (receipt.request_hash !== requestHash)
                fail(409, "IDEMPOTENCY_CONFLICT", "同一请求键不能更换输入。");
              const value = read(receipt.review_id)!;
              return reply(project(value), value.stateVersion);
            }
            if (action === "preview") {
              const timeline = store.read(id);
              if (!timeline) fail(404, "NOT_FOUND", "未找到时间线。");
              const input = AudioResolutionInputSchema.parse(body.data);
              if (
                timeline!.version !== version ||
                input.timelineVersion !== version
              )
                fail(412, "PRECONDITION_FAILED", "时间线版本已变化。");
              const prepared = compile(timeline!, input);
              const at = new Date().toISOString();
              const reviewId = crypto.randomUUID();
              const value: Stored = {
                id: reviewId,
                timelineId: id,
                projectId: timeline!.projectId,
                episodeId: timeline!.episodeId,
                state: "pending",
                stateVersion: 0,
                sourceState: "current",
                reasons: [],
                isCurrent: false,
                before: timeline!,
                after: prepared.after,
                changes: prepared.changes,
                warnings: [
                  "只处理明确选择的音频／字幕片段；选择外片段、源轨和原文件保留。",
                  "机械来源与人工声明不证明声音质量、授权或正式 Media Gate。",
                  "移除只修改本时间线引用，确认后可撤销；换源保持起点、时长、源偏移、音量、淡入淡出及锁定。",
                ],
                createdAt: at,
                updatedAt: at,
                input,
                sourceHash: prepared.sourceHash,
              };
              context.uow.execute((tx) => {
                const row = tx.get<{ manifest_json: string }>(
                  "SELECT manifest_json FROM timelines WHERE id = ?",
                  id,
                );
                if (!row || !store.matches(tx, timeline!))
                  fail(412, "PRECONDITION_FAILED", "时间线已变化。");
                tx.run(
                  "INSERT INTO timeline_audio_resolutions VALUES (?,?,?,?)",
                  reviewId,
                  id,
                  JSON.stringify(value),
                  at,
                );
                tx.run(
                  "INSERT INTO timeline_audio_resolution_requests VALUES (?,?,?)",
                  key!,
                  requestHash,
                  reviewId,
                );
                tx.append({
                  type: "timeline.audio-resolution-previewed.v1",
                  pluginId: "timeline",
                  aggregateType: "audio-resolution",
                  aggregateId: reviewId,
                  aggregateVersion: 0,
                  payload: {
                    id: reviewId,
                    timelineId: id,
                    projectId: timeline!.projectId,
                    clipIds: input.changes.map((change) => change.clipId),
                  },
                });
              });
              return reply(project(value), 0);
            }
            const value = read(id);
            if (!value) fail(404, "NOT_FOUND", "未找到换源预览。");
            if (value!.stateVersion !== version)
              fail(412, "PRECONDITION_FAILED", "预览状态已变化。");
            if (value!.state !== "pending")
              fail(409, "STATE_CONFLICT", "预览已经结束。");
            if (
              action === "confirm" &&
              project(value!).sourceState !== "current"
            )
              fail(
                409,
                "AUDIO_RESOLUTION_SOURCE_CONFLICT",
                "时间线或候选实际来源已变化，不能沿旧预览确认。",
              );
            const next: Stored = {
              ...value!,
              state: action === "confirm" ? "confirmed" : "discarded",
              stateVersion: version + 1,
              updatedAt: new Date().toISOString(),
              ...(action === "confirm"
                ? {
                    confirmation: {
                      ...AudioResolutionConfirmationSchema.parse(body.data),
                      confirmedAt: new Date().toISOString(),
                    },
                  }
                : {}),
            };
            const finalize = (
              tx: UnitOfWorkTransaction,
              saved?: TimelineManifest,
            ) => {
              const actual = tx.get<{ value_json: string }>(
                "SELECT value_json FROM timeline_audio_resolutions WHERE id = ?",
                id,
              );
              if (!actual || actual.value_json !== JSON.stringify(value))
                fail(412, "PRECONDITION_FAILED", "预览已变化。");
              if (saved) {
                next.after = saved;
                next.resultTimelineVersion = saved.version;
              }
              tx.run(
                "UPDATE timeline_audio_resolutions SET value_json = ? WHERE id = ?",
                JSON.stringify(next),
                id,
              );
              tx.run(
                "INSERT INTO timeline_audio_resolution_requests VALUES (?,?,?)",
                key!,
                requestHash,
                id,
              );
              const event = {
                pluginId: "timeline",
                aggregateType: "audio-resolution",
                aggregateId: id,
                aggregateVersion: next.stateVersion,
                payload: {
                  id,
                  timelineId: next.timelineId,
                  projectId: next.projectId,
                  clipIds: next.changes.map((change) => change.before.id),
                },
              };
              tx.append(
                action === "confirm"
                  ? { ...event, type: "timeline.audio-resolution-confirmed.v1" }
                  : {
                      ...event,
                      type: "timeline.audio-resolution-discarded.v1",
                    },
              );
            };
            if (action === "confirm") {
              const saved = store.save(
                value!.before,
                structuredClone(value!.after),
                (tx, timeline) => finalize(tx, timeline),
              );
              if (saved === "conflict")
                fail(412, "PRECONDITION_FAILED", "时间线已变化，未应用换源。");
            } else context.uow.execute((tx) => finalize(tx));
            return reply(project(next), next.stateVersion);
          } catch (error) {
            if (
              error instanceof ResolutionError ||
              error instanceof SyntaxError
            ) {
              const status =
                error instanceof ResolutionError ? error.status : 400;
              const code =
                error instanceof ResolutionError
                  ? error.code
                  : "VALIDATION_ERROR";
              return new Response(
                JSON.stringify({
                  type: `https://dramaip.local/problems/${code.toLowerCase()}`,
                  title: error.message,
                  status,
                  code,
                  traceId: crypto.randomUUID(),
                }),
                {
                  status,
                  headers: { "Content-Type": "application/problem+json" },
                },
              );
            }
            throw error;
          }
        },
      }),
    ),
  ];
}
