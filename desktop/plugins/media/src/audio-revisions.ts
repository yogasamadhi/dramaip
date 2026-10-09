import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AudioRevisionSchema,
  AudioRevisionInputSchema,
  AudioRevisionConfirmationSchema,
  AudioRevisionPageSchema,
  AudioRevisionSummarySchema,
  AudioRevisionSummaryPageSchema,
  type AudioRevision,
  type AudioTrack,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import { mediaReviewSummaryRoute } from "./review-summaries.js";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
} from "@dramaip/plugin-api/internal";
import {
  AudioSourceError,
  type AudioSourceInternals,
  type PreparedAudioTrack,
} from "./audio-sources.js";

export const audioRevisionMigration: PluginMigration = {
  id: "media.0009.explicit-audio-revisions",
  pluginId: "media",
  version: "3.0.0-alpha.4",
  dependsOn: ["media.0008.audio-source-snapshots"],
  sql: `CREATE TABLE media_audio_revisions(id TEXT PRIMARY KEY, source_track_id TEXT NOT NULL REFERENCES media_audio_tracks(id), value_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX media_audio_revisions_source ON media_audio_revisions(source_track_id,created_at DESC,id DESC);
    CREATE TABLE media_audio_revision_heads(source_track_id TEXT PRIMARY KEY REFERENCES media_audio_tracks(id), review_id TEXT NOT NULL REFERENCES media_audio_revisions(id));
    CREATE TABLE media_audio_track_revision_links(track_id TEXT PRIMARY KEY REFERENCES media_audio_tracks(id), value_json TEXT NOT NULL);
    CREATE TRIGGER media_audio_revision_link_immutable BEFORE UPDATE ON media_audio_track_revision_links BEGIN SELECT RAISE(ABORT, 'audio revision links are immutable'); END;
    CREATE TABLE media_audio_revision_adopted_heads(source_track_id TEXT PRIMARY KEY REFERENCES media_audio_tracks(id),track_id TEXT NOT NULL REFERENCES media_audio_tracks(id));
    CREATE TABLE media_audio_revision_requests(request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, review_id TEXT NOT NULL REFERENCES media_audio_revisions(id));`,
};
type Stored = AudioRevision & {
  prepared: PreparedAudioTrack;
  sourceHash: string;
  previousHead?: string;
};
interface RequestContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const originalHash = (track: AudioTrack) =>
  hash({
    id: track.id,
    projectId: track.projectId,
    episodeId: track.episodeId,
    version: track.version,
    kind: track.kind,
    label: track.label,
    clips: track.clips,
    sourceFingerprint: track.sourceFingerprint,
  });
const fail = (status: number, code: string, text: string): never => {
  throw new AudioSourceError(status, code, text);
};
export function audioRevisionRoutes(
  context: PluginContext,
  sources: AudioSourceInternals,
  workspace: WorkspaceProjectService,
) {
  const read = (id: string): Stored | undefined =>
    context.uow.execute((tx) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM media_audio_revisions WHERE id = ?",
        id,
      );
      return row ? (JSON.parse(row.value_json) as Stored) : undefined;
    });
  const head = (id: string) =>
    context.uow.execute(
      (tx) =>
        tx.get<{ review_id: string }>(
          "SELECT review_id FROM media_audio_revision_heads WHERE source_track_id = ?",
          id,
        )?.review_id,
    );
  const project = (value: Stored): AudioRevision => {
    const { prepared, sourceHash, previousHead, ...result } = value;
    const reasons: string[] = [];
    if (value.state === "pending") {
      const original = sources.read(value.sourceTrackId);
      if (!original || originalHash(original) !== sourceHash)
        reasons.push("原音轨版本或片段已变化。");
      if (head(value.sourceTrackId) !== previousHead)
        reasons.push("另一份音轨修订已确认。");
      try {
        sources.assertPrepared(prepared);
      } catch (error) {
        reasons.push(
          error instanceof Error ? error.message : "候选实际来源已变化。",
        );
      }
    } else if (value.state === "confirmed") {
      const target = value.targetTrackId
        ? sources.read(value.targetTrackId)
        : undefined;
      if (!target || target.sourceState !== "current")
        reasons.push(...(target?.sourceReasons ?? ["实际候选音轨不存在。"]));
    }
    return {
      ...result,
      sourceState: reasons.length ? "stale" : "current",
      reasons,
      isCurrent:
        value.state === "confirmed" && head(value.sourceTrackId) === value.id,
    };
  };
  const reply = (value: unknown, etag?: string) =>
    new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        ETag: etag ?? `"${hash(value)}"`,
      },
    });
  const required = (request: RequestContext) => {
    const key = request.req.header("Idempotency-Key")?.trim();
    const match = request.req.header("If-Match")?.match(/^"(\d+)"$/u);
    if (!key || key.length > 200 || !match)
      fail(428, "PRECONDITION_REQUIRED", "须提供版本和幂等键。");
    return { key: key!, version: Number(match![1]) };
  };
  const definitions = [
    {
      action: "list",
      method: "get",
      path: "/api/v2/audio-tracks/{id}/revision-previews",
    },
    {
      action: "preview",
      method: "post",
      path: "/api/v2/audio-tracks/{id}/revision-previews",
    },
    { action: "get", method: "get", path: "/api/v2/audio-revisions/{id}" },
    {
      action: "confirm",
      method: "post",
      path: "/api/v2/audio-revisions/{id}/confirm",
    },
    {
      action: "discard",
      method: "post",
      path: "/api/v2/audio-revisions/{id}/discard",
    },
  ] as const;
  const summaries = mediaReviewSummaryRoute<Stored>(context, workspace, {
    id: "media:audio-revision-summaries",
    operationId: "audio-revisions.summaries",
    path: "/api/v2/projects/{projectId}/audio-revision-summaries",
    table: "media_audio_revisions",
    schema: AudioRevisionSummaryPageSchema,
    project: (stored) => {
      const value = project(stored);
      const target = value.targetTrackId
        ? sources.read(value.targetTrackId)
        : undefined;
      const {
        id,
        projectId,
        episodeId,
        sourceTrackId,
        state,
        stateVersion,
        sourceState,
        isCurrent,
        targetTrackId,
        createdAt,
        updatedAt,
      } = value;
      return AudioRevisionSummarySchema.parse({
        id,
        projectId,
        episodeId,
        sourceTrackId,
        state,
        stateVersion,
        sourceState,
        isCurrent,
        targetTrackId,
        createdAt,
        updatedAt,
        originalVersion: value.original.version,
        candidateId: value.candidate.id,
        candidateClipCount: value.candidate.clips.length,
        mappedCount: value.clipLinks.length,
        removedCount: value.removedClipIds.length,
        addedCount: value.addedClipIds.length,
        reasonCount: value.reasons.length,
        ...(state === "confirmed"
          ? {
              targetStatus: target?.status ?? "missing",
              ...(target ? { targetVersion: target.version } : {}),
            }
          : {}),
      });
    },
  });
  return [
    summaries,
    ...definitions.map(({ action, method, path }) =>
      defineRouteContribution({
        id: `media:audio-revisions-${action}`,
        pluginId: "media",
        method,
        path,
        operationId: `audio-revisions.${action}`,
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
          operationId: `audio-revisions.${action}`,
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
                            ? AudioRevisionInputSchema
                            : action === "confirm"
                              ? AudioRevisionConfirmationSchema
                              : z.object({}),
                      },
                    },
                  },
                }
              : {}),
          },
          responses: {
            200: {
              description: "Frozen author-controlled audio revision",
              content: {
                "application/json": {
                  schema:
                    action === "list"
                      ? AudioRevisionPageSchema
                      : AudioRevisionSchema,
                },
              },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428].map((status) => [
                status,
                {
                  description: "Invalid, missing or changed source",
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
            if (action === "list") {
              if (!sources.read(id)) fail(404, "NOT_FOUND", "未找到原音轨。");
              const limit = Number(request.req.query("limit") ?? 25);
              const cursor = request.req.query("cursor");
              let after: [string, string] | undefined;
              if (cursor) {
                try {
                  const parsed = z
                    .tuple([
                      z.literal(id),
                      z.string().datetime(),
                      z.string().uuid(),
                    ])
                    .parse(
                      JSON.parse(Buffer.from(cursor, "base64url").toString()),
                    );
                  after = [parsed[1], parsed[2]];
                } catch {
                  fail(400, "VALIDATION_ERROR", "历史游标无效或不属于本音轨。");
                }
              }
              const rows = context.uow.execute((tx) =>
                tx.all<{ id: string; created_at: string; value_json: string }>(
                  `SELECT * FROM media_audio_revisions WHERE source_track_id = ? ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
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
              if (!value) fail(404, "NOT_FOUND", "未找到音轨复核。");
              return reply(project(value!), `"${value!.stateVersion}"`);
            }
            const { key, version } = required(request);
            const rawBody = await request.req.json();
            const body = (
              action === "preview"
                ? AudioRevisionInputSchema
                : action === "confirm"
                  ? AudioRevisionConfirmationSchema
                  : z.object({})
            ).safeParse(rawBody);
            if (!body.success)
              fail(400, "VALIDATION_ERROR", "须核对完整片段和所有确认项。");
            const requestHash = hash({ action, id, version, body: body.data });
            const replay = context.uow.execute((tx) =>
              tx.get<{ request_hash: string; review_id: string }>(
                "SELECT * FROM media_audio_revision_requests WHERE request_key = ?",
                key,
              ),
            );
            if (replay) {
              if (replay.request_hash !== requestHash)
                fail(409, "IDEMPOTENCY_CONFLICT", "同一复核键不能换输入。");
              const value = read(replay.review_id)!;
              return reply(project(value), `"${value.stateVersion}"`);
            }
            if (action === "preview") {
              const input = AudioRevisionInputSchema.parse(body.data);
              const original = sources.read(id);
              if (!original) fail(404, "NOT_FOUND", "未找到原音轨。");
              if (
                original!.version !== version ||
                input.sourceVersion !== version
              )
                fail(412, "PRECONDITION_FAILED", "原音轨版本已变。");
              const links = input.clips.flatMap((clip) =>
                clip.previousClipId ? [clip.previousClipId] : [],
              );
              if (
                new Set(links).size !== links.length ||
                links.some(
                  (clipId) =>
                    !original!.clips.some((clip) => clip.id === clipId),
                )
              )
                fail(
                  400,
                  "VALIDATION_ERROR",
                  "旧片段映射必须唯一且真实属于原音轨。",
                );
              const prepared = sources.prepare({
                projectId: original!.projectId,
                episodeId: original!.episodeId,
                label: input.label,
                kind: input.kind,
                clips: input.clips.map(
                  ({ previousClipId: _previous, ...clip }) => clip,
                ),
              });
              const at = new Date().toISOString();
              const reviewId = crypto.randomUUID();
              const value: Stored = {
                id: reviewId,
                projectId: original!.projectId,
                episodeId: original!.episodeId,
                sourceTrackId: id,
                original: original!,
                candidate: prepared.track,
                clipLinks: input.clips.flatMap((clip, index) =>
                  clip.previousClipId
                    ? [
                        {
                          previousClipId: clip.previousClipId,
                          nextClipId: prepared.track.clips[index]!.id,
                        },
                      ]
                    : [],
                ),
                removedClipIds: original!.clips
                  .filter((clip) => !links.includes(clip.id))
                  .map((clip) => clip.id),
                addedClipIds: prepared.track.clips
                  .filter((_clip, index) => !input.clips[index]!.previousClipId)
                  .map((clip) => clip.id),
                state: "pending",
                stateVersion: 0,
                sourceState: "current",
                reasons: [],
                isCurrent: false,
                createdAt: at,
                updatedAt: at,
                prepared,
                sourceHash: originalHash(original!),
                previousHead: head(id),
              };
              context.uow.execute((tx) => {
                const actual = tx.get<{ version: number }>(
                  "SELECT version FROM media_audio_tracks WHERE id = ?",
                  id,
                );
                if (actual?.version !== version)
                  fail(412, "PRECONDITION_FAILED", "原音轨已变。");
                tx.run(
                  "INSERT INTO media_audio_revisions VALUES (?,?,?,?)",
                  reviewId,
                  id,
                  JSON.stringify(value),
                  at,
                );
                tx.run(
                  "INSERT INTO media_audio_revision_requests VALUES (?,?,?)",
                  key,
                  requestHash,
                  reviewId,
                );
                tx.append({
                  type: "media.audio-revision-previewed.v1",
                  pluginId: "media",
                  aggregateType: "audio-revision",
                  aggregateId: reviewId,
                  aggregateVersion: 0,
                  payload: {
                    id: reviewId,
                    sourceTrackId: id,
                    sourceVersion: version,
                    projectId: value.projectId,
                  },
                });
              });
              return reply(project(value), '"0"');
            }
            const value = read(id);
            if (!value) fail(404, "NOT_FOUND", "未找到音轨复核。");
            if (value!.stateVersion !== version)
              fail(412, "PRECONDITION_FAILED", "复核状态已变化。");
            if (value!.state !== "pending")
              fail(409, "STATE_CONFLICT", "复核已结束。");
            if (
              action === "confirm" &&
              project(value!).sourceState !== "current"
            )
              fail(
                409,
                "AUDIO_REVISION_SOURCE_STALE",
                "原轨、候选来源或竞争头已变化，不能确认旧预览。",
              );
            const next: Stored = {
              ...value!,
              state: action === "confirm" ? "confirmed" : "discarded",
              stateVersion: version + 1,
              updatedAt: new Date().toISOString(),
              ...(action === "confirm"
                ? {
                    targetTrackId: value!.candidate.id,
                    confirmation: {
                      ...AudioRevisionConfirmationSchema.parse(body.data),
                      confirmedAt: new Date().toISOString(),
                    },
                  }
                : {}),
            };
            context.uow.execute((tx) => {
              const actual = tx.get<{ value_json: string }>(
                "SELECT value_json FROM media_audio_revisions WHERE id = ?",
                id,
              );
              if (!actual || actual.value_json !== JSON.stringify(value))
                fail(412, "PRECONDITION_FAILED", "复核已变化。");
              if (action === "confirm") {
                const original = tx.get<{ version: number }>(
                  "SELECT version FROM media_audio_tracks WHERE id = ?",
                  value!.sourceTrackId,
                );
                const adoptedHead = tx.get<{ review_id: string }>(
                  "SELECT review_id FROM media_audio_revision_heads WHERE source_track_id = ?",
                  value!.sourceTrackId,
                )?.review_id;
                if (
                  original?.version !== value!.original.version ||
                  adoptedHead !== value!.previousHead
                )
                  fail(409, "AUDIO_REVISION_CONFLICT", "原轨或竞争头已变化。");
                sources.persistPrepared(tx, value!.prepared);
                tx.run(
                  "INSERT INTO media_audio_track_revision_links VALUES (?,?)",
                  value!.candidate.id,
                  JSON.stringify({
                    reviewId: value!.id,
                    sourceTrackId: value!.sourceTrackId,
                    sourceVersion: value!.original.version,
                    clipLinks: value!.clipLinks,
                  }),
                );
                tx.run(
                  "INSERT INTO media_audio_revision_heads VALUES (?,?) ON CONFLICT(source_track_id) DO UPDATE SET review_id = excluded.review_id",
                  value!.sourceTrackId,
                  id,
                );
              }
              tx.run(
                "UPDATE media_audio_revisions SET value_json = ? WHERE id = ?",
                JSON.stringify(next),
                id,
              );
              tx.run(
                "INSERT INTO media_audio_revision_requests VALUES (?,?,?)",
                key,
                requestHash,
                id,
              );
              const event = {
                pluginId: "media",
                aggregateType: "audio-revision",
                aggregateId: id,
                aggregateVersion: next.stateVersion,
                payload: {
                  id,
                  sourceTrackId: next.sourceTrackId,
                  ...(next.targetTrackId
                    ? { targetTrackId: next.targetTrackId }
                    : {}),
                  projectId: next.projectId,
                },
              };
              tx.append(
                action === "confirm"
                  ? { ...event, type: "media.audio-revision-confirmed.v1" }
                  : { ...event, type: "media.audio-revision-discarded.v1" },
              );
            });
            return reply(project(next), `"${next.stateVersion}"`);
          } catch (error) {
            if (
              error instanceof AudioSourceError ||
              error instanceof SyntaxError
            ) {
              const status =
                error instanceof AudioSourceError ? error.status : 400;
              const code =
                error instanceof AudioSourceError
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
