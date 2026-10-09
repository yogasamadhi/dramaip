import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import type {
  MediaRecordService,
  MediaAudioTrackService,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import type { TimelineManifest } from "@dramaip/contracts/timeline";
import {
  TimelineCopyDirectoryInputSchema,
  TimelineCopyDirectorySelectionSchema,
  TimelineCopyManifestSchema,
  TimelineMediaCopyInputSchema,
  TimelineMediaCopyReceiptSchema,
  TimelineMediaCopySchema,
  TimelineMediaCopyPageSchema,
  serializeTimelineMediaCopyReceipt,
  type TimelineMediaCopy,
} from "@dramaip/contracts/timeline-copy";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  validNleCopyInput,
  type DesktopHostClient,
  type NleCopyJob,
} from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  buildCopySnapshot,
  copyDigest,
  copyScope,
  CopySourceError,
} from "./copy-snapshot.js";

export const timelineMediaCopyMigration: PluginMigration = {
  id: "timeline.0007.original-media-copy-receipts",
  pluginId: "timeline",
  version: "3.0.0-alpha.4",
  dependsOn: ["timeline.0006.render-request-and-output-identities"],
  sql: `CREATE TABLE timeline_media_copies(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE, request_hash TEXT NOT NULL, input_json TEXT NOT NULL, frozen_json TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX timeline_media_copies_page ON timeline_media_copies(project_id,timeline_id,created_at DESC,id DESC);
    CREATE TABLE timeline_media_copy_actions(request_key TEXT PRIMARY KEY, copy_id TEXT NOT NULL REFERENCES timeline_media_copies(id) ON DELETE CASCADE, request_hash TEXT NOT NULL, result_json TEXT);`,
};
type Snapshot = ReturnType<typeof buildCopySnapshot>;
type Row = {
  id: string;
  project_id: string;
  timeline_id: string;
  request_hash: string;
  input_json: string;
  frozen_json: string;
  value_json: string;
  created_at: string;
};
type Http = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
    raw: Request;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
};
type Store = {
  read(id: string): TimelineManifest | undefined;
  matches(
    transaction: UnitOfWorkTransaction,
    timeline: TimelineManifest,
  ): boolean;
  document(
    timeline: TimelineManifest,
    format: "fcpxml" | "otio" | "edl" | "srt" | "vtt" | "relink",
  ): { content: string };
};
class CopyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new CopyRequestError(status, code);
}
const uid = z.string().uuid(),
  params = z.object({ id: uid }),
  project = z.object({ projectId: uid }).strict();
const etag = (job: TimelineMediaCopy) =>
  `"media-copy:${job.id}:${job.version}"`;
const timelineEtag = (manifest: TimelineManifest) =>
  `"timeline:${manifest.id}:${manifest.version}"`;
const byteHash = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");
const terminal = (status: TimelineMediaCopy["status"]) =>
  !["submission-unknown", "queued", "running"].includes(status);

/** Business owner stores original inputs and observations. Host owns file copying, not the Runtime lifecycle. */
export function timelineMediaCopyRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
  store: Store,
  host?: DesktopHostClient,
): RouteContribution[] {
  let disposed = false;
  const observations = new AbortController();
  const active = new Map<string, Promise<unknown>>();
  context.effect(
    () => async () => {
      disposed = true;
      observations.abort();
      await Promise.allSettled(active.values());
    },
    "timeline:media-copy-observations",
  );
  const track = async <T>(id: string, work: () => Promise<T>) => {
    if (disposed || active.has(id) || active.size >= 4)
      fail(409, "COPY_OBSERVATION_BUSY");
    const promise = work();
    active.set(id, promise);
    try {
      return await promise;
    } finally {
      if (active.get(id) === promise) active.delete(id);
    }
  };
  const readRow = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>("SELECT * FROM timeline_media_copies WHERE id = ?", id),
    );
  const decode = (row: Row) => {
    const original = TimelineMediaCopySchema.parse(JSON.parse(row.value_json));
    const input = TimelineMediaCopyInputSchema.parse(
      JSON.parse(row.input_json),
    );
    const snapshot = JSON.parse(row.frozen_json) as Snapshot;
    if (
      !snapshot ||
      Object.keys(snapshot).sort().join(",") !== "fingerprint,input,manifest" ||
      !validNleCopyInput(snapshot.input) ||
      !TimelineCopyManifestSchema.safeParse(snapshot.manifest).success ||
      snapshot.fingerprint !==
        copyDigest({ manifest: snapshot.manifest, input: snapshot.input }) ||
      original.id !== row.id ||
      original.requestHash !== row.request_hash ||
      row.request_hash !== copyDigest(input) ||
      original.scope.projectId !== row.project_id ||
      original.scope.timelineId !== row.timeline_id ||
      copyDigest(copyScope(snapshot.manifest)) !== copyDigest(original.scope) ||
      copyDigest(snapshot.manifest) !== copyDigest(input.manifest) ||
      !input.directory.grant ||
      copyDigest(input.directory.scope) !== copyDigest(original.scope) ||
      copyDigest({
        projectId: snapshot.input.projectId,
        episodeId: snapshot.input.episodeId,
        timelineId: snapshot.input.timelineId,
        timelineVersion: snapshot.input.timelineVersion,
        sourceFingerprint: snapshot.input.sourceFingerprint,
      }) !== copyDigest(original.scope)
    )
      fail(503, "COPY_RECORD_UNAVAILABLE");
    return { original, input, snapshot };
  };
  const existing = (id: string, projectId: string) => {
    if (!workspace.get(projectId)) fail(404, "NOT_FOUND");
    const row = readRow(id);
    if (!row || row.project_id !== projectId) fail(404, "NOT_FOUND");
    return row;
  };
  const actual = (id: string) => {
    const timeline = store.read(id);
    if (!timeline || !workspace.get(timeline.projectId))
      throw new CopySourceError();
    return buildCopySnapshot(timeline, media, audio, store.document);
  };
  const binding = (row: Row): TimelineMediaCopy["currentBinding"] => {
    const { snapshot } = decode(row);
    try {
      return actual(row.timeline_id).fingerprint === snapshot.fingerprint
        ? "unchanged-metadata"
        : "changed-metadata";
    } catch {
      return store.read(row.timeline_id) ? "changed-metadata" : "unavailable";
    }
  };
  const publicValue = (row: Row) => ({
    ...decode(row).original,
    currentBinding: binding(row),
  });
  const respond = (c: Http, row: Row, status = 200) => {
    const value = publicValue(row);
    c.header("Cache-Control", "no-store");
    c.header("ETag", etag(value));
    return c.json(value, status);
  };
  const persist = (
    tx: UnitOfWorkTransaction,
    row: Row,
    next: TimelineMediaCopy,
  ) => {
    if (!TimelineMediaCopySchema.safeParse(next).success)
      fail(503, "COPY_RECEIPT_INVALID");
    const current = tx.get<Row>(
      "SELECT * FROM timeline_media_copies WHERE id = ?",
      row.id,
    );
    if (
      !current ||
      decode(current).original.version !== decode(row).original.version
    )
      fail(412, "COPY_PRECONDITION_CHANGED");
    tx.run(
      "UPDATE timeline_media_copies SET value_json = ? WHERE id = ?",
      JSON.stringify(next),
      row.id,
    );
    tx.append({
      type: "timeline.media-copy-observed.v1",
      pluginId: "timeline",
      aggregateType: "timeline-media-copy",
      aggregateId: row.id,
      aggregateVersion: next.version,
      payload: {
        projectId: next.scope.projectId,
        timelineId: next.scope.timelineId,
        timelineVersion: next.scope.timelineVersion,
        status: next.status,
        sourceFingerprint: next.scope.sourceFingerprint,
      },
    });
    return tx.get<Row>(
      "SELECT * FROM timeline_media_copies WHERE id = ?",
      row.id,
    )!;
  };
  const validateHost = (raw: unknown, row: Row): NleCopyJob => {
    const { snapshot, input } = decode(row),
      original = snapshot.input;
    const shape = z
      .object({
        id: uid,
        version: z.number().int().nonnegative(),
        status: z.enum([
          "queued",
          "running",
          "completed",
          "failed",
          "canceled",
          "interrupted",
        ]),
        requestSha256: z.string(),
        scope: TimelineMediaCopySchema.shape.scope,
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        copy: z
          .object({
            artifactRef: uid.optional(),
            receipt: TimelineMediaCopyReceiptSchema,
            receiptSha256: z.string(),
            receiptBytes: z.number().int().positive(),
          })
          .strict()
          .optional(),
        failureCode: z
          .enum([
            "COPY_FAILED",
            "COPY_ABORTED",
            "COPY_INTERRUPTED",
            "COPY_JOURNAL_UNAVAILABLE",
          ])
          .optional(),
        scratchState: TimelineMediaCopySchema.shape.scratchState,
      })
      .strict();
    const parsed = shape.safeParse(raw);
    if (!parsed.success) fail(503, "COPY_RECEIPT_INVALID");
    const value = parsed.data;
    if (
      value.id !== row.id ||
      copyDigest(value.scope) !== copyDigest(copyScope(snapshot.manifest)) ||
      value.requestSha256 !==
        copyDigest({
          input: original,
          writeGrantRef: input.directory.grant!.grantId,
        }) ||
      (value.status === "completed") !== Boolean(value.copy) ||
      (["failed", "canceled", "interrupted"].includes(value.status)
        ? !value.failureCode || !value.scratchState
        : value.failureCode !== undefined ||
          value.scratchState !== undefined) ||
      (value.status === "canceled" && value.failureCode !== "COPY_ABORTED") ||
      (value.status === "interrupted" &&
        value.failureCode !== "COPY_INTERRUPTED") ||
      (value.status === "failed" &&
        !["COPY_FAILED", "COPY_JOURNAL_UNAVAILABLE"].includes(
          value.failureCode ?? "",
        )) ||
      Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    )
      fail(503, "COPY_RECEIPT_INVALID");
    if (value.copy) {
      const receipt = value.copy.receipt,
        bytes = serializeTimelineMediaCopyReceipt(receipt);
      if (
        value.copy.artifactRef !== receipt.packageRef ||
        copyDigest({
          projectId: receipt.projectId,
          episodeId: receipt.episodeId,
          timelineId: receipt.timelineId,
          timelineVersion: receipt.timelineVersion,
          sourceFingerprint: receipt.sourceFingerprint,
        }) !== copyDigest(value.scope) ||
        value.copy.receiptBytes !== Buffer.byteLength(bytes, "utf8") ||
        value.copy.receiptSha256 !== byteHash(bytes) ||
        receipt.files.length !==
          original.media.length + original.documents.length
      )
        fail(503, "COPY_RECEIPT_INVALID");
      for (const file of receipt.files) {
        if (file.kind === "media") {
          const source = original.media.find(
            (item) => item.assetId === file.source.assetId,
          );
          if (
            !source ||
            source.recordVersion !== file.source.recordVersion ||
            source.artifactId !== file.source.artifactId ||
            source.sizeBytes !== file.sizeBytes ||
            source.sha256 !== file.sha256 ||
            file.relativePath !==
              `media/${source.assetId}${HOST_MANAGED_MEDIA_EXTENSIONS[source.mimeType]}`
          )
            fail(503, "COPY_RECEIPT_INVALID");
        } else {
          const source = original.documents.find(
            (item) => item.relativePath === file.relativePath,
          );
          if (
            !source ||
            Buffer.byteLength(source.content, "utf8") !== file.sizeBytes ||
            byteHash(source.content) !== file.sha256
          )
            fail(503, "COPY_RECEIPT_INVALID");
        }
      }
    }
    return value;
  };
  const observe = (
    row: Row,
    hostJob: NleCopyJob,
    finalize?: (tx: UnitOfWorkTransaction, row: Row) => void,
  ): Row => {
    // Public owner reads open their own local transactions. Complete them
    // synchronously before entering this owner's write transaction (no await).
    const currentBinding = binding(row);
    return context.uow.execute((tx) => {
      const latest = tx.get<Row>(
        "SELECT * FROM timeline_media_copies WHERE id = ?",
        row.id,
      )!;
      const before = decode(latest).original;
      if (terminal(before.status)) {
        finalize?.(tx, latest);
        return latest;
      }
      const changed =
        currentBinding !== "unchanged-metadata" ||
        !store.matches(tx, decode(latest).snapshot.manifest.timeline);
      const status = changed ? "source-changed" : hostJob.status;
      const next: TimelineMediaCopy = {
        ...before,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
        status,
        currentBinding: changed ? "changed-metadata" : "unchanged-metadata",
        ...(status === "completed" && hostJob.copy?.artifactRef
          ? {
              copy: {
                artifactRef: hostJob.copy.artifactRef,
                receipt: TimelineMediaCopyReceiptSchema.parse(
                  hostJob.copy.receipt,
                ),
                receiptSha256: hostJob.copy.receiptSha256,
                receiptBytes: hostJob.copy.receiptBytes,
              },
            }
          : {}),
        ...(changed
          ? {
              failureCode: "ORIGINAL_SOURCE_CHANGED",
              scratchState: "retained-unpublished",
            }
          : hostJob.failureCode
            ? {
                failureCode: hostJob.failureCode,
                scratchState: hostJob.scratchState,
              }
            : {}),
      };
      const saved = persist(tx, latest, next);
      finalize?.(tx, saved);
      return saved;
    });
  };
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    request: object,
    response: z.ZodType,
    handler: (c: Http) => Response | Promise<Response>,
    picker = false,
  ) =>
    defineRouteContribution({
      id: operationId,
      pluginId: "timeline",
      method,
      path,
      operationId,
      policy:
        method === "get"
          ? { idempotency: "forbidden" }
          : picker
            ? { idempotency: "forbidden", concurrency: "if-match-required" }
            : {
                idempotency: "required",
                idempotencyReplay: "handler",
                concurrency: "if-match-required",
              },
      declaration: createRoute({
        method,
        path,
        operationId,
        tags: ["timeline"],
        request,
        responses: {
          200: {
            description:
              "Original local-copy observation, not current integrity or delivery quality",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 413, 428, 503].map((status) => [
              status,
              {
                description: "Original copy unavailable",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      } as never),
      handler: async (c: Http) => {
        try {
          return await handler(c);
        } catch (cause) {
          const status =
            cause instanceof CopyRequestError
              ? cause.status
              : cause instanceof CopySourceError
                ? 409
                : cause instanceof z.ZodError
                  ? 400
                  : 503;
          return c.json(
            {
              type: "about:blank",
              title: "原媒体包请求不可完整核对或尚无确定结果。",
              detail:
                "不换源、换键或自动重做；旧回执只属于记录时间，质量／授权未核验、费用未知。",
              status,
              code:
                cause instanceof CopyRequestError
                  ? cause.code
                  : cause instanceof CopySourceError
                    ? "COPY_SOURCE_UNAVAILABLE"
                    : "COPY_OBSERVATION_UNAVAILABLE",
              traceId: crypto.randomUUID(),
            },
            status,
          );
        }
      },
    });
  const body = (schema: z.ZodType) => ({
    required: true,
    content: { "application/json": { schema } },
  });
  const checkManifest = (
    c: Http,
    manifest: z.infer<typeof TimelineCopyManifestSchema>,
  ) => {
    if (
      manifest.timeline.id !== c.req.param("id") ||
      c.req.header("If-Match") !== timelineEtag(manifest.timeline)
    )
      fail(412, "COPY_PRECONDITION_CHANGED");
    if (!workspace.get(manifest.timeline.projectId)) fail(404, "NOT_FOUND");
    const current = actual(manifest.timeline.id);
    if (copyDigest(current.manifest) !== copyDigest(manifest))
      fail(412, "COPY_SOURCE_CHANGED");
    return current;
  };
  const routes: RouteContribution[] = [
    add(
      "post",
      "/api/v2/timelines/{id}/media-copy-directory",
      "timeline-media-copies.selectDirectory",
      { params, body: body(TimelineCopyDirectoryInputSchema) },
      TimelineCopyDirectorySelectionSchema,
      (c) =>
        track(`directory:${c.req.param("id")}`, async () => {
          const input = TimelineCopyDirectoryInputSchema.parse(
              await c.req.json(),
            ),
            before = checkManifest(c, input.manifest);
          if (!host) fail(503, "HOST_UNAVAILABLE");
          const grant = await host.pickNleCopyDirectory(observations.signal);
          if (
            actual(before.manifest.timeline.id).fingerprint !==
            before.fingerprint
          )
            fail(412, "COPY_SOURCE_CHANGED");
          return c.json(
            TimelineCopyDirectorySelectionSchema.parse({
              scope: copyScope(before.manifest),
              grant,
            }),
          );
        }),
      true,
    ),
    add(
      "post",
      "/api/v2/timelines/{id}/media-copies",
      "timeline-media-copies.create",
      { params, body: body(TimelineMediaCopyInputSchema) },
      TimelineMediaCopySchema,
      async (c) => {
        const input = TimelineMediaCopyInputSchema.parse(await c.req.json()),
          key = uid.parse(c.req.header("Idempotency-Key")),
          hash = copyDigest(input);
        if (
          input.manifest.timeline.id !== c.req.param("id") ||
          copyDigest(input.directory.scope) !==
            copyDigest(copyScope(input.manifest)) ||
          !input.directory.grant ||
          c.req.header("If-Match") !== timelineEtag(input.manifest.timeline)
        )
          fail(412, "COPY_PRECONDITION_CHANGED");
        if (!workspace.get(input.manifest.timeline.projectId))
          fail(404, "NOT_FOUND");
        const prior = readRow(key);
        if (prior) {
          if (prior.request_hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
          return respond(c, prior);
        }
        return track(key, async () => {
          const frozen = checkManifest(c, input.manifest);
          if (
            !host ||
            Date.parse(input.directory.grant!.expiresAt) <= Date.now()
          )
            fail(503, "COPY_GRANT_UNAVAILABLE");
          const now = new Date().toISOString(),
            value: TimelineMediaCopy = {
              id: key,
              version: 0,
              requestHash: hash,
              scope: copyScope(frozen.manifest),
              status: "submission-unknown",
              createdAt: now,
              updatedAt: now,
              currentBinding: "unchanged-metadata",
            };
          if (
            actual(frozen.manifest.timeline.id).fingerprint !==
            frozen.fingerprint
          )
            fail(412, "COPY_SOURCE_CHANGED");
          const saved = context.uow.execute((tx) => {
            if (!store.matches(tx, frozen.manifest.timeline))
              fail(412, "COPY_SOURCE_CHANGED");
            tx.run(
              "INSERT INTO timeline_media_copies(id,project_id,timeline_id,request_hash,input_json,frozen_json,value_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
              key,
              value.scope.projectId,
              value.scope.timelineId,
              hash,
              JSON.stringify(input),
              JSON.stringify(frozen),
              JSON.stringify(value),
              now,
            );
            tx.append({
              type: "timeline.media-copy-requested.v1",
              pluginId: "timeline",
              aggregateType: "timeline-media-copy",
              aggregateId: key,
              aggregateVersion: 0,
              payload: {
                projectId: value.scope.projectId,
                timelineId: value.scope.timelineId,
                timelineVersion: value.scope.timelineVersion,
                sourceFingerprint: value.scope.sourceFingerprint,
                purpose: input.purpose,
              },
            });
            return tx.get<Row>(
              "SELECT * FROM timeline_media_copies WHERE id = ?",
              key,
            )!;
          });
          let received: unknown;
          try {
            received = await host.startNleMediaCopy(
              key,
              frozen.input,
              input.directory.grant!.grantId,
              observations.signal,
            );
          } catch {
            return respond(c, saved);
          } // Unknown submission is durable, not a failed or retryable copy proof.
          const hostJob = validateHost(received, saved);
          if (
            binding(saved) !== "unchanged-metadata" &&
            ["queued", "running"].includes(hostJob.status)
          )
            await host.cancelNleMediaCopy(
              key,
              saved.project_id,
              observations.signal,
            );
          return respond(c, observe(saved, hostJob));
        });
      },
    ),
    add(
      "get",
      "/api/v2/timeline-media-copies/{id}",
      "timeline-media-copies.get",
      { params, query: project },
      TimelineMediaCopySchema,
      (c) =>
        respond(
          c,
          existing(c.req.param("id"), uid.parse(c.req.query("projectId"))),
        ),
    ),
    add(
      "get",
      "/api/v2/timelines/{id}/media-copies",
      "timeline-media-copies.list",
      {
        params,
        query: project.extend({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: uid.optional(),
        }),
      },
      TimelineMediaCopyPageSchema,
      (c) => {
        const projectId = uid.parse(c.req.query("projectId")),
          timelineId = uid.parse(c.req.param("id")),
          limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .parse(c.req.query("limit") ?? 25),
          cursor = c.req.query("cursor");
        const timeline = store.read(timelineId);
        if (
          !workspace.get(projectId) ||
          !timeline ||
          timeline.projectId !== projectId
        )
          fail(404, "NOT_FOUND");
        const anchor = cursor
          ? existing(uid.parse(cursor), projectId)
          : undefined;
        if (anchor && anchor.timeline_id !== timelineId)
          fail(400, "COPY_CURSOR_SCOPE_MISMATCH");
        const rows = context.uow.execute((tx) =>
          anchor
            ? tx.all<Row>(
                "SELECT * FROM timeline_media_copies WHERE project_id=? AND timeline_id=? AND (created_at < ? OR (created_at=? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?",
                projectId,
                timelineId,
                anchor.created_at,
                anchor.created_at,
                anchor.id,
                limit + 1,
              )
            : tx.all<Row>(
                "SELECT * FROM timeline_media_copies WHERE project_id=? AND timeline_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
                projectId,
                timelineId,
                limit + 1,
              ),
        );
        c.header("Cache-Control", "no-store");
        return c.json({
          timelineId,
          projectId,
          items: rows.slice(0, limit).map(publicValue),
          ...(rows.length > limit ? { nextCursor: rows[limit - 1]!.id } : {}),
        });
      },
    ),
  ];
  for (const operation of ["refresh", "cancel"] as const)
    routes.push(
      add(
        "post",
        `/api/v2/timeline-media-copies/{id}/${operation}`,
        `timeline-media-copies.${operation}`,
        { params, body: body(project) },
        TimelineMediaCopySchema,
        async (c) => {
          const input = project.parse(await c.req.json()),
            id = uid.parse(c.req.param("id")),
            key = uid.parse(c.req.header("Idempotency-Key")),
            row = existing(id, input.projectId),
            expected = c.req.header("If-Match"),
            hash = copyDigest({ id, input, expected, operation });
          const old = context.uow.execute((tx) =>
            tx.get<{
              copy_id: string;
              request_hash: string;
              result_json: string | null;
            }>(
              "SELECT * FROM timeline_media_copy_actions WHERE request_key = ?",
              key,
            ),
          );
          if (old) {
            if (old.copy_id !== id || old.request_hash !== hash)
              fail(409, "IDEMPOTENCY_CONFLICT");
            if (!old.result_json) fail(409, "COPY_ACTION_OUTCOME_UNKNOWN");
            c.header("Cache-Control", "no-store");
            const replay = TimelineMediaCopySchema.parse(
              JSON.parse(old.result_json),
            );
            c.header("ETag", etag(replay));
            return c.json(replay);
          }
          if (expected !== etag(decode(row).original))
            fail(412, "COPY_PRECONDITION_CHANGED");
          return track(id, async () => {
            if (!host) fail(503, "HOST_UNAVAILABLE");
            context.uow.execute((tx) => {
              const latest = tx.get<Row>(
                "SELECT * FROM timeline_media_copies WHERE id = ?",
                id,
              )!;
              if (etag(decode(latest).original) !== expected)
                fail(412, "COPY_PRECONDITION_CHANGED");
              tx.run(
                "INSERT INTO timeline_media_copy_actions(request_key,copy_id,request_hash,result_json) VALUES(?,?,?,NULL)",
                key,
                id,
                hash,
              );
              tx.append({
                type: "timeline.media-copy-action-requested.v1",
                pluginId: "timeline",
                aggregateType: "timeline-media-copy",
                aggregateId: id,
                aggregateVersion: decode(latest).original.version,
                payload: {
                  projectId: input.projectId,
                  timelineId: latest.timeline_id,
                  operation,
                  baseVersion: decode(latest).original.version,
                },
              });
            });
            let next = row;
            let result: TimelineMediaCopy | undefined;
            const actionBinding = binding(row);
            const finish = (tx: UnitOfWorkTransaction, saved: Row) => {
              const recorded = decode(saved).original;
              result = {
                ...recorded,
                currentBinding: terminal(decode(row).original.status)
                  ? actionBinding
                  : recorded.currentBinding,
              };
              tx.run(
                "UPDATE timeline_media_copy_actions SET result_json = ? WHERE request_key = ?",
                JSON.stringify(result),
                key,
              );
            };
            if (!terminal(decode(row).original.status)) {
              const observed = validateHost(
                operation === "cancel"
                  ? await host.cancelNleMediaCopy(
                      id,
                      input.projectId,
                      observations.signal,
                    )
                  : await host.getNleMediaCopy(
                      id,
                      input.projectId,
                      observations.signal,
                    ),
                row,
              );
              // Changing an owner cannot turn a partial physical copy into a delivered package.
              if (
                binding(row) !== "unchanged-metadata" &&
                ["queued", "running"].includes(observed.status)
              )
                await host.cancelNleMediaCopy(
                  id,
                  input.projectId,
                  observations.signal,
                );
              next = observe(row, observed, finish);
            } else {
              context.uow.execute((tx) => finish(tx, row));
            }
            const output = result ?? publicValue(next);
            c.header("Cache-Control", "no-store");
            c.header("ETag", etag(output));
            return c.json(output);
          });
        },
      ),
    );
  routes.push(
    add(
      "post",
      "/api/v2/timeline-media-copies/{id}/reveal",
      "timeline-media-copies.reveal",
      { params, body: body(project.extend({ artifactRef: uid })) },
      z.object({ revealed: z.literal(true) }).strict(),
      async (c) => {
        const input = project
            .extend({ artifactRef: uid })
            .parse(await c.req.json()),
          row = existing(c.req.param("id"), input.projectId),
          value = publicValue(row);
        if (
          !host ||
          value.status !== "completed" ||
          value.copy?.artifactRef !== input.artifactRef ||
          c.req.header("If-Match") !== etag(value)
        )
          fail(409, "COPY_ARTIFACT_UNAVAILABLE");
        return track(`reveal:${value.id}`, async () => {
          await host.revealNleMediaCopy(
            value.id,
            input.projectId,
            input.artifactRef,
            observations.signal,
          );
          return c.json({ revealed: true });
        });
      },
      true,
    ),
  );
  return routes;
}
