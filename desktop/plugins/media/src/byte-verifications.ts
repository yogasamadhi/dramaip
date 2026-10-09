import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MEDIA_PLAYBACK_MAX_BYTES,
  MediaByteVerificationInputSchema,
  MediaByteVerificationSchema,
  MediaByteVerificationPageSchema,
  type MediaByteVerification,
  type MediaPlaybackDescriptor,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";

export const mediaByteVerificationMigration: PluginMigration = {
  id: "media.0010.complete-byte-verification-receipts",
  pluginId: "media",
  version: "3.0.0-alpha.4",
  dependsOn: ["media.0009.explicit-audio-revisions"],
  sql: `CREATE TABLE media_byte_verifications (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL, record_version INTEGER NOT NULL,
    request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    verified_at TEXT NOT NULL, value_json TEXT NOT NULL
  ); CREATE INDEX media_byte_verification_page
    ON media_byte_verifications(project_id, record_id, record_version, verified_at DESC, id DESC);`,
};
type Row = {
  id: string;
  request_hash: string;
  value_json: string;
  verified_at: string;
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
};
type Reader = {
  describe(
    id: string,
    projectId: string,
    version: number,
  ): MediaPlaybackDescriptor;
  read(
    descriptor: MediaPlaybackDescriptor,
    signal: AbortSignal,
  ): Promise<Response>;
};
class VerificationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const playbackEtag = (value: MediaPlaybackDescriptor) =>
  `"playback-${value.recordVersion}-${value.sha256}"`;
const params = z.object({ id: z.string().uuid() });
const scope = z.object({ projectId: z.string().uuid() });
const page = scope.extend({
  recordVersion: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

/** Persist only after EOF, exact-byte/hash and owner recheck. Reads share Playback's tracked lease. */
export function mediaByteVerificationRoutes(
  context: PluginContext,
  records: MediaRecordService,
  workspace: WorkspaceProjectService,
  reader: Reader,
): RouteContribution[] {
  let disposed = false;
  const inFlight = new Set<string>();
  const active = new Set<{ abort: AbortController; done: Promise<void> }>();
  context.effect(
    () => async () => {
      disposed = true;
      const pending = [...active];
      for (const value of pending) value.abort.abort();
      await Promise.all(pending.map((value) => value.done));
    },
    "media:byte-verification-readers",
  );
  const readRow = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>("SELECT * FROM media_byte_verifications WHERE id = ?", id),
    );
  const project = (id: string) => {
    if (!workspace.get(id)) throw new VerificationError(404, "NOT_FOUND");
  };
  const decode = (row: Row): MediaByteVerification => {
    const original = MediaByteVerificationSchema.parse(
      JSON.parse(row.value_json),
    );
    let currentBinding: MediaByteVerification["currentBinding"] = "unavailable";
    try {
      const actual = reader.describe(
        original.descriptor.recordId,
        original.descriptor.projectId,
        original.descriptor.recordVersion,
      );
      currentBinding =
        digest(actual) === digest(original.descriptor)
          ? "unchanged-metadata"
          : "changed-metadata";
    } catch {
      const actual = records.get(original.descriptor.recordId);
      if (
        actual?.projectId === original.descriptor.projectId &&
        actual.version !== original.descriptor.recordVersion
      )
        currentBinding = "changed-metadata";
    }
    return { ...original, currentBinding };
  };
  const respond = (c: Http, row: Row, status = 200) => {
    c.header("Cache-Control", "no-store");
    c.header("ETag", `"byte-verification:${row.id}:0"`);
    return c.json(decode(row), status);
  };
  const routes: RouteContribution[] = [];
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    request: object,
    response: z.ZodType,
    handler: (c: Http) => Response | Promise<Response>,
  ) => {
    routes.push(
      defineRouteContribution({
        id: operationId,
        pluginId: "media",
        method,
        path,
        operationId,
        policy:
          method === "post"
            ? {
                idempotency: "required",
                idempotencyReplay: "handler",
                concurrency: "if-match-required",
                timeoutMs: 300_000,
              }
            : { idempotency: "forbidden" },
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["media"],
          request,
          responses: {
            [method === "post" ? 201 : 200]: {
              description:
                "Historical complete-byte read observation, not current file, quality or rights verification",
              content: { "application/json": { schema: response } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 413, 428, 503].map((status) => [
                status,
                {
                  description: "Exact verification unavailable",
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
        handler: async (c: Http) => {
          try {
            return await handler(c);
          } catch (error) {
            const status =
              error instanceof VerificationError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 503;
            const code =
              error instanceof VerificationError
                ? error.code
                : status === 400
                  ? "VALIDATION_ERROR"
                  : "MEDIA_BYTE_VERIFICATION_UNAVAILABLE";
            return c.json(
              {
                type: "about:blank",
                title:
                  "完整字节核验未完成或原身份不可核对；没有保存新的通过凭证。",
                detail:
                  "旧凭证仅描述原记录时间的读取，不保证文件现在未变化，不自动换源或重试。",
                status,
                code,
                traceId: crypto.randomUUID(),
              },
              status,
            );
          }
        },
      }),
    );
  };
  add(
    "post",
    "/api/v2/media-records/{id}/byte-verifications",
    "media-byte-verifications.create",
    {
      params,
      body: {
        required: true,
        content: {
          "application/json": { schema: MediaByteVerificationInputSchema },
        },
      },
    },
    MediaByteVerificationSchema,
    async (c) => {
      const input = MediaByteVerificationInputSchema.parse(await c.req.json());
      const descriptor = input.descriptor;
      const key = z.string().uuid().parse(c.req.header("Idempotency-Key"));
      if (descriptor.recordId !== c.req.param("id"))
        throw new VerificationError(400, "VERIFICATION_IDENTITY_MISMATCH");
      project(descriptor.projectId);
      if (c.req.header("If-Match") !== playbackEtag(descriptor))
        throw new VerificationError(412, "VERIFICATION_PRECONDITION_MISMATCH");
      const requestHash = digest(input);
      const previous = context.uow.execute((tx) =>
        tx.get<Row>(
          "SELECT * FROM media_byte_verifications WHERE request_key = ?",
          key,
        ),
      );
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new VerificationError(409, "IDEMPOTENCY_CONFLICT");
        return respond(c, previous);
      }
      if (disposed || active.size >= 4 || inFlight.has(key))
        throw new VerificationError(409, "VERIFICATION_BUSY");
      if (descriptor.sizeBytes > MEDIA_PLAYBACK_MAX_BYTES)
        throw new VerificationError(413, "VERIFICATION_TOO_LARGE");
      const same = () => {
        try {
          if (
            digest(
              reader.describe(
                descriptor.recordId,
                descriptor.projectId,
                descriptor.recordVersion,
              ),
            ) === digest(descriptor)
          )
            return;
        } catch {}
        throw new VerificationError(412, "VERIFICATION_SOURCE_CHANGED");
      };
      same();
      const abort = new AbortController();
      let finish = () => {};
      const lease = {
        abort,
        done: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      active.add(lease);
      inFlight.add(key);
      const signal = AbortSignal.any([
        abort.signal,
        c.req.raw.signal,
        AbortSignal.timeout(300_000),
      ]);
      let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        signal.throwIfAborted();
        const response = await reader.read(descriptor, signal);
        if (
          !response.ok ||
          !response.body ||
          response.headers.get("Content-Type") !== descriptor.mimeType ||
          response.headers.get("Content-Length") !==
            String(descriptor.sizeBytes)
        ) {
          await response.body?.cancel().catch(() => {});
          throw new VerificationError(409, "VERIFICATION_READ_FAILED");
        }
        stream = response.body.getReader();
        let count = 0;
        const hash = createHash("sha256");
        for (;;) {
          signal.throwIfAborted();
          const chunk = await stream.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          count += chunk.value.byteLength;
          if (count > descriptor.sizeBytes)
            throw new VerificationError(409, "VERIFICATION_BYTES_CHANGED");
          hash.update(chunk.value);
        }
        if (
          count !== descriptor.sizeBytes ||
          hash.digest("hex") !== descriptor.sha256
        )
          throw new VerificationError(409, "VERIFICATION_BYTES_CHANGED");
        signal.throwIfAborted();
        same();
        const verifiedAt = new Date().toISOString();
        const value = MediaByteVerificationSchema.parse({
          id: crypto.randomUUID(),
          version: 0,
          requestKey: key,
          descriptor,
          verifiedAt,
          evidence: "complete-byte-read-at-recorded-time",
          qualityState: "unverified",
          rightsState: "unverified",
          currentBinding: "unchanged-metadata",
        });
        context.uow.execute((tx) => {
          tx.run(
            "INSERT INTO media_byte_verifications(id,project_id,record_id,record_version,request_key,request_hash,verified_at,value_json) VALUES (?,?,?,?,?,?,?,?)",
            value.id,
            descriptor.projectId,
            descriptor.recordId,
            descriptor.recordVersion,
            key,
            requestHash,
            verifiedAt,
            JSON.stringify(value),
          );
          tx.append({
            type: "media.complete-byte-verified.v1",
            pluginId: "media",
            aggregateType: "media-byte-verification",
            aggregateId: value.id,
            aggregateVersion: 0,
            payload: {
              projectId: descriptor.projectId,
              recordId: descriptor.recordId,
              recordVersion: descriptor.recordVersion,
              sha256: descriptor.sha256,
              sizeBytes: count,
              origin: descriptor.origin,
              ...(descriptor.artifactRef
                ? { artifactRef: descriptor.artifactRef }
                : {}),
            },
          });
        });
        return respond(c, readRow(value.id)!, 201);
      } finally {
        await stream?.cancel().catch(() => {});
        stream?.releaseLock();
        inFlight.delete(key);
        active.delete(lease);
        finish();
      }
    },
  );
  add(
    "get",
    "/api/v2/media-byte-verifications/{id}",
    "media-byte-verifications.get",
    { params, query: scope },
    MediaByteVerificationSchema,
    (c) => {
      const { projectId } = scope.parse({
        projectId: c.req.query("projectId"),
      });
      project(projectId);
      const row = readRow(c.req.param("id"));
      if (!row || JSON.parse(row.value_json).descriptor.projectId !== projectId)
        throw new VerificationError(404, "NOT_FOUND");
      return respond(c, row);
    },
  );
  add(
    "get",
    "/api/v2/media-records/{id}/byte-verifications/requests/{key}",
    "media-byte-verifications.recover",
    {
      params: params.extend({ key: z.string().uuid() }),
      query: scope,
    },
    MediaByteVerificationSchema,
    (c) => {
      const { projectId } = scope.parse({
        projectId: c.req.query("projectId"),
      });
      project(projectId);
      const row = context.uow.execute((tx) =>
        tx.get<Row>(
          "SELECT * FROM media_byte_verifications WHERE request_key = ? AND project_id = ? AND record_id = ?",
          c.req.param("key"),
          projectId,
          c.req.param("id"),
        ),
      );
      if (!row) throw new VerificationError(404, "NOT_FOUND");
      return respond(c, row);
    },
  );
  add(
    "get",
    "/api/v2/media-records/{id}/byte-verifications",
    "media-byte-verifications.list",
    { params, query: page },
    MediaByteVerificationPageSchema,
    (c) => {
      const input = page.parse({
        projectId: c.req.query("projectId"),
        recordVersion: c.req.query("recordVersion"),
        limit: c.req.query("limit"),
        cursor: c.req.query("cursor"),
      });
      project(input.projectId);
      const recordId = c.req.param("id");
      const rows = context.uow.execute((tx) => {
        const marker = input.cursor
          ? tx.get<Row>(
              "SELECT * FROM media_byte_verifications WHERE id = ? AND project_id = ? AND record_id = ? AND record_version = ?",
              input.cursor,
              input.projectId,
              recordId,
              input.recordVersion,
            )
          : undefined;
        if (input.cursor && !marker)
          throw new VerificationError(400, "INVALID_CURSOR");
        return tx.all<Row>(
          `SELECT * FROM media_byte_verifications WHERE project_id = ? AND record_id = ? AND record_version = ?
        ${marker ? "AND (verified_at < ? OR (verified_at = ? AND id < ?))" : ""}
        ORDER BY verified_at DESC, id DESC LIMIT ?`,
          input.projectId,
          recordId,
          input.recordVersion,
          ...(marker
            ? [marker.verified_at, marker.verified_at, marker.id]
            : []),
          input.limit + 1,
        );
      });
      c.header("Cache-Control", "no-store");
      return c.json(
        MediaByteVerificationPageSchema.parse({
          recordId,
          projectId: input.projectId,
          recordVersion: input.recordVersion,
          items: rows.slice(0, input.limit).map(decode),
          ...(rows.length > input.limit
            ? { nextCursor: rows[input.limit - 1]!.id }
            : {}),
        }),
      );
    },
  );
  return routes;
}
