import { z } from "zod";
import {
  TimelineCopyScopeSchema,
  TimelineCopyManifestSchema,
  TimelineCopyDirectorySelectionSchema,
  TimelineMediaCopyInputSchema,
  TimelineMediaCopySchema,
  TimelineMediaCopyPageSchema,
  serializeTimelineMediaCopyReceipt,
  type TimelineCopyScope,
  type TimelineMediaCopy,
  type TimelineMediaCopyInput,
} from "@dramaip/contracts/timeline-copy";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/timeline";

const uuid = z.string().uuid();
const invalid = () =>
  new Error("原媒体包身份、完整凭证或冻结输入无法核对；未自动换源或重做。");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const requestHash = (value: unknown) =>
  sha(new TextEncoder().encode(JSON.stringify(canonical(value))));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const scopeOf = (manifest: TimelineDeliveryManifest): TimelineCopyScope => ({
  projectId: manifest.timeline.projectId,
  episodeId: manifest.timeline.episodeId,
  timelineId: manifest.timeline.id,
  timelineVersion: manifest.timeline.version,
  sourceFingerprint: manifest.sourceFingerprint,
});
const tag = (job: TimelineMediaCopy) => `"media-copy:${job.id}:${job.version}"`;

/** Explicit owner operations only: constructing the client never copies, polls or opens an OS window. */
export function createTimelineMediaCopyClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const validate = async (
    raw: unknown,
    scope: TimelineCopyScope,
    id?: string,
    hash?: string,
    original?: TimelineMediaCopyInput,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    const job = TimelineMediaCopySchema.parse(raw);
    if (
      !same(job.scope, scope) ||
      (id && job.id !== id) ||
      (hash && job.requestHash !== hash)
    )
      throw invalid();
    if (job.copy) {
      const bytes = new TextEncoder().encode(
        serializeTimelineMediaCopyReceipt(job.copy.receipt),
      );
      if (
        bytes.byteLength !== job.copy.receiptBytes ||
        (await sha(bytes)) !== job.copy.receiptSha256
      )
        throw invalid();
      const files = job.copy.receipt.files,
        media = files.filter((file) => file.kind === "media"),
        docs = files.filter((file) => file.kind === "document");
      if (
        !media.length ||
        docs.length !== 7 ||
        media.some(
          (file) =>
            !file.relativePath.startsWith(`media/${file.source.assetId}.`),
        )
      )
        throw invalid();
      if (
        original &&
        (media.length !== original.manifest.media.length ||
          media.some((file) => {
            const source = original.manifest.media.find(
              (item) => item.assetId === file.source.assetId,
            );
            return (
              !source?.archive ||
              source.sourceVersion !== file.source.recordVersion ||
              source.archive.artifactRef !== file.source.artifactId ||
              source.archive.sha256 !== file.sha256 ||
              source.archive.sizeBytes !== file.sizeBytes ||
              source.relativePath !== file.relativePath
            );
          }))
      )
        throw invalid();
    }
    signal?.throwIfAborted();
    return job;
  };
  const original = (input: TimelineMediaCopyInput) => {
    const value = TimelineMediaCopyInputSchema.parse(input);
    if (
      !value.directory.grant ||
      !same(value.directory.scope, scopeOf(value.manifest))
    )
      throw invalid();
    return value;
  };
  const get = async (
    id: string,
    scope: TimelineCopyScope,
    signal?: AbortSignal,
  ) => {
    uuid.parse(id);
    TimelineCopyScopeSchema.parse(scope);
    signal?.throwIfAborted();
    return validate(
      await request(
        `/api/v2/timeline-media-copies/${id}?${new URLSearchParams({ projectId: scope.projectId })}`,
        { signal },
      ),
      scope,
      id,
      undefined,
      undefined,
      signal,
    );
  };
  const action = async (
    input: TimelineMediaCopy,
    operation: "refresh" | "cancel",
    key: string,
    signal?: AbortSignal,
  ) => {
    const job = TimelineMediaCopySchema.parse(input);
    uuid.parse(key);
    signal?.throwIfAborted();
    const value = await validate(
      await request(`/api/v2/timeline-media-copies/${job.id}/${operation}`, {
        method: "POST",
        signal,
        headers: { "If-Match": tag(job), "Idempotency-Key": key },
        body: JSON.stringify({ projectId: job.scope.projectId }),
      }),
      job.scope,
      job.id,
      job.requestHash,
      undefined,
      signal,
    );
    if (value.version < job.version) throw invalid();
    return value;
  };
  return {
    chooseDirectory: async (
      input: TimelineDeliveryManifest,
      signal?: AbortSignal,
    ) => {
      const manifest = TimelineCopyManifestSchema.parse(input),
        scope = scopeOf(manifest);
      signal?.throwIfAborted();
      const result = TimelineCopyDirectorySelectionSchema.parse(
        await request(
          `/api/v2/timelines/${manifest.timeline.id}/media-copy-directory`,
          {
            method: "POST",
            signal,
            headers: {
              "If-Match": `"timeline:${manifest.timeline.id}:${manifest.timeline.version}"`,
            },
            body: JSON.stringify({ manifest }),
          },
        ),
      );
      signal?.throwIfAborted();
      if (!same(result.scope, scope)) throw invalid();
      return result;
    },
    create: async (
      input: TimelineMediaCopyInput,
      key: string,
      signal?: AbortSignal,
    ) => {
      const value = original(input);
      uuid.parse(key);
      signal?.throwIfAborted();
      const hash = await requestHash(value);
      signal?.throwIfAborted();
      return validate(
        await request(
          `/api/v2/timelines/${value.manifest.timeline.id}/media-copies`,
          {
            method: "POST",
            signal,
            headers: {
              "If-Match": `"timeline:${value.manifest.timeline.id}:${value.manifest.timeline.version}"`,
              "Idempotency-Key": key,
            },
            body: JSON.stringify(value),
          },
        ),
        scopeOf(value.manifest),
        key,
        hash,
        value,
        signal,
      );
    },
    get,
    recover: async (
      input: TimelineMediaCopyInput,
      key: string,
      signal?: AbortSignal,
    ) => {
      const value = original(input);
      uuid.parse(key);
      signal?.throwIfAborted();
      const hash = await requestHash(value);
      signal?.throwIfAborted();
      const result = await get(key, scopeOf(value.manifest), signal);
      return validate(result, result.scope, key, hash, value, signal);
    },
    list: async (
      timelineId: string,
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) => {
      uuid.parse(timelineId);
      uuid.parse(projectId);
      if (options.cursor) uuid.parse(options.cursor);
      const limit = z
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(options.limit ?? 25);
      signal?.throwIfAborted();
      const page = TimelineMediaCopyPageSchema.parse(
        await request(
          `/api/v2/timelines/${timelineId}/media-copies?${new URLSearchParams({ projectId, limit: String(limit), ...(options.cursor ? { cursor: options.cursor } : {}) })}`,
          { signal },
        ),
      );
      if (
        page.timelineId !== timelineId ||
        page.projectId !== projectId ||
        page.items.length > limit ||
        new Set(page.items.map((item) => item.id)).size !== page.items.length ||
        (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id)
      )
        throw invalid();
      await Promise.all(
        page.items.map((item) => {
          if (
            item.scope.projectId !== projectId ||
            item.scope.timelineId !== timelineId
          )
            throw invalid();
          return validate(
            item,
            item.scope,
            item.id,
            undefined,
            undefined,
            signal,
          );
        }),
      );
      signal?.throwIfAborted();
      return page;
    },
    refresh: (job: TimelineMediaCopy, key: string, signal?: AbortSignal) =>
      action(job, "refresh", key, signal),
    cancel: (job: TimelineMediaCopy, key: string, signal?: AbortSignal) =>
      action(job, "cancel", key, signal),
    reveal: async (input: TimelineMediaCopy, signal?: AbortSignal) => {
      const job = await validate(
        input,
        input.scope,
        input.id,
        input.requestHash,
        undefined,
        signal,
      );
      if (!job.copy || job.status !== "completed") throw invalid();
      const response = z
        .object({ revealed: z.literal(true) })
        .strict()
        .parse(
          await request(`/api/v2/timeline-media-copies/${job.id}/reveal`, {
            method: "POST",
            signal,
            headers: { "If-Match": tag(job) },
            body: JSON.stringify({
              projectId: job.scope.projectId,
              artifactRef: job.copy.artifactRef,
            }),
          }),
        );
      signal?.throwIfAborted();
      return response;
    },
  };
}
export type TimelineMediaCopyClient = ReturnType<
  typeof createTimelineMediaCopyClient
>;
