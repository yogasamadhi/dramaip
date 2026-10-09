import { createHash } from "node:crypto";
import { mediaByteVerificationRoutes } from "./byte-verifications.js";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MEDIA_PLAYBACK_MAX_BYTES,
  MediaPlaybackDescriptorSchema,
  type MediaPlaybackDescriptor,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  type DesktopHostClient,
} from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  type PluginContext,
} from "@dramaip/plugin-api/internal";

class PlaybackError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
type Artifact = {
  artifact_id: string;
  project_id: string;
  media_ref: string;
  kind: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  sha256: string;
  status: string;
};
type Snapshot = {
  descriptor: MediaPlaybackDescriptor;
  bytes?: Uint8Array;
  mediaRef?: string;
};
type Lease = { abort: AbortController; done: Promise<void> };
const etag = (value: MediaPlaybackDescriptor) =>
  `"playback-${value.recordVersion}-${value.sha256}"`;
const same = (a: Snapshot, b: Snapshot) =>
  JSON.stringify(a.descriptor) === JSON.stringify(b.descriptor) &&
  a.mediaRef === b.mediaRef;

/** Owner metadata is not playback evidence. Every content read verifies the complete delivered bytes. */
export function mediaPlaybackRoutes(
  context: PluginContext,
  records: MediaRecordService,
  workspace: WorkspaceProjectService,
  host?: DesktopHostClient,
) {
  const reads = new Set<Lease>();
  let disposed = false;
  context.effect(
    () => async () => {
      disposed = true;
      const active = [...reads];
      for (const read of active) read.abort.abort();
      await Promise.all(active.map((read) => read.done));
    },
    "media:playback-readers",
  );
  const snapshot = (
    id: string,
    projectId: string,
    version: number,
  ): Snapshot => {
    const record = records.get(id);
    if (!workspace.get(projectId) || !record || record.projectId !== projectId)
      throw new PlaybackError(
        404,
        "MEDIA_PLAYBACK_NOT_FOUND",
        "未找到本项目的实际媒体记录。",
      );
    if (record.version !== version)
      throw new PlaybackError(
        412,
        "MEDIA_PLAYBACK_VERSION_CHANGED",
        "媒体版本已变化，请重新核对实际记录。",
      );
    const artifacts = context.uow.execute((tx) =>
      tx.all<Artifact>(
        "SELECT artifact_id,project_id,media_ref,kind,mime_type,extension,size_bytes,sha256,status FROM media_artifacts WHERE media_record_id = ?",
        id,
      ),
    );
    if (artifacts.length) {
      if (
        artifacts.length !== 1 ||
        artifacts[0]!.project_id !== projectId ||
        artifacts[0]!.status !== "archived"
      )
        throw new PlaybackError(
          409,
          "MEDIA_ARCHIVE_UNAVAILABLE",
          "存档状态或归属不能用于播放。",
        );
      const artifact = artifacts[0]!;
      if (
        !["image", "audio", "video"].includes(artifact.kind) ||
        !artifact.mime_type.startsWith(`${artifact.kind}/`) ||
        !Object.hasOwn(HOST_MANAGED_MEDIA_EXTENSIONS, artifact.mime_type) ||
        HOST_MANAGED_MEDIA_EXTENSIONS[artifact.mime_type] !== artifact.extension
      )
        throw new PlaybackError(
          415,
          "MEDIA_PLAYBACK_UNSUPPORTED",
          "此存档格式暂不支持受控播放。",
        );
      return {
        descriptor: MediaPlaybackDescriptorSchema.parse({
          recordId: id,
          projectId,
          recordVersion: version,
          kind: artifact.kind,
          mimeType: artifact.mime_type,
          sizeBytes: artifact.size_bytes,
          sha256: artifact.sha256,
          origin: "managed-archive",
          artifactRef: artifact.artifact_id,
          verification: "owner-metadata-only",
        }),
        mediaRef: artifact.media_ref,
      };
    }
    const data = record.payload.预览数据;
    const parsed =
      typeof data === "string"
        ? /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(data)
        : null;
    const mime = parsed?.[1] ?? "";
    const encoded = parsed?.[2] ?? "";
    const kind = mime.split("/")[0];
    if (
      !parsed ||
      !Object.hasOwn(HOST_MANAGED_MEDIA_EXTENSIONS, mime) ||
      !["image", "audio", "video"].includes(kind!) ||
      record.payload.预览类型 !== kind ||
      encoded.length % 4 !== 0
    )
      throw new PlaybackError(
        415,
        "MEDIA_PLAYBACK_UNSUPPORTED",
        "没有可安全读取的内嵌媒体或归档文件。",
      );
    if (encoded.length > Math.ceil(MEDIA_PLAYBACK_MAX_BYTES / 3) * 4)
      throw new PlaybackError(
        413,
        "MEDIA_PLAYBACK_TOO_LARGE",
        "完整播放暂支持最多 128 MiB；较大文件请另行审阅。",
      );
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.toString("base64") !== encoded)
      throw new PlaybackError(
        415,
        "MEDIA_PLAYBACK_UNSUPPORTED",
        "内嵌媒体编码无效。",
      );
    return {
      descriptor: MediaPlaybackDescriptorSchema.parse({
        recordId: id,
        projectId,
        recordVersion: version,
        kind,
        mimeType: mime,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        origin: "embedded",
        verification: "owner-metadata-only",
      }),
      bytes,
    };
  };
  const read = async (
    c: {
      req: {
        param(key: string): string;
        query(key: string): string | undefined;
        header(key: string): string | undefined;
        raw: { signal: AbortSignal };
      };
    },
    content: boolean,
  ) => {
    let lease: Lease | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let source: ReadableStream<Uint8Array> | undefined;
    let finish = () => {};
    try {
      const id = c.req.param("id");
      const projectId = c.req.query("projectId")!;
      const version = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(c.req.query("recordVersion"));
      const value = snapshot(id, projectId, version);
      const descriptor = value.descriptor;
      if (!content)
        return new Response(JSON.stringify(descriptor), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ETag: etag(descriptor),
          },
        });
      if (descriptor.sizeBytes > MEDIA_PLAYBACK_MAX_BYTES)
        throw new PlaybackError(
          413,
          "MEDIA_PLAYBACK_TOO_LARGE",
          "完整播放暂支持最多 128 MiB；较大文件请另行审阅。",
        );
      if (!c.req.header("If-Match"))
        throw new PlaybackError(
          428,
          "MEDIA_PLAYBACK_PRECONDITION_REQUIRED",
          "读取文件需要明确版本与校验值。",
        );
      if (
        c.req.header("If-Match") !== etag(descriptor) ||
        c.req.query("sha256") !== descriptor.sha256
      )
        throw new PlaybackError(
          412,
          "MEDIA_PLAYBACK_VERSION_CHANGED",
          "媒体版本或校验值已变化。",
        );
      if (disposed || reads.size >= 8)
        throw new PlaybackError(
          503,
          "MEDIA_PLAYBACK_BUSY",
          "媒体读取暂不可用，请稍后重试。",
        );
      const abort = new AbortController();
      lease = {
        abort,
        done: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      reads.add(lease);
      const signal = AbortSignal.any([
        abort.signal,
        c.req.raw.signal,
        AbortSignal.timeout(5 * 60_000),
      ]);
      signal.throwIfAborted();
      if (value.mediaRef) {
        if (!host)
          throw new PlaybackError(
            503,
            "MEDIA_PLAYBACK_HOST_UNAVAILABLE",
            "当前连接不支持归档文件读取。",
          );
        const response = await host.readManagedMedia(
          {
            mediaRef: value.mediaRef,
            mimeType: descriptor.mimeType,
            sizeBytes: descriptor.sizeBytes,
            sha256: descriptor.sha256,
          },
          signal,
        );
        source = response.body ?? undefined;
        if (
          !response.ok ||
          !source ||
          response.headers.get("Content-Type") !== descriptor.mimeType ||
          response.headers.get("Content-Length") !==
            String(descriptor.sizeBytes)
        )
          throw new PlaybackError(
            [404, 409, 413, 415, 503].includes(response.status)
              ? response.status
              : 503,
            "MEDIA_ARCHIVE_READ_FAILED",
            "存档文件不可用、已变化或未完整读取。",
          );
      } else source = new Response(value.bytes as BodyInit).body!;
      if (!same(value, snapshot(id, projectId, version)))
        throw new PlaybackError(
          412,
          "MEDIA_PLAYBACK_VERSION_CHANGED",
          "读取期间媒体归属或版本已变化。",
        );
      reader = source.getReader();
      const upstream = reader;
      const active = lease;
      let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
      let count = 0;
      const hash = createHash("sha256");
      const complete = () => {
        signal.removeEventListener("abort", interrupted);
        reads.delete(active);
        finish();
      };
      const interrupted = () => {
        try {
          sink?.error(new Error("媒体读取已中断。"));
        } catch {}
        void upstream
          .cancel()
          .catch(() => {})
          .finally(complete);
      };
      signal.addEventListener("abort", interrupted, { once: true });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          sink = controller;
          if (signal.aborted) interrupted();
        },
        async pull(controller) {
          try {
            signal.throwIfAborted();
            const chunk = await upstream.read();
            signal.throwIfAborted();
            if (chunk.done) {
              if (
                count !== descriptor.sizeBytes ||
                hash.digest("hex") !== descriptor.sha256 ||
                !same(value, snapshot(id, projectId, version))
              )
                throw new Error("媒体读取未完成或已变化。");
              upstream.releaseLock();
              complete();
              controller.close();
              return;
            }
            count += chunk.value.byteLength;
            if (count > descriptor.sizeBytes)
              throw new Error("媒体大小已变化。");
            hash.update(chunk.value);
            controller.enqueue(chunk.value);
          } catch {
            try {
              controller.error(new Error("媒体读取未完成或已变化。"));
            } catch {}
            await upstream.cancel().catch(() => {});
            complete();
          }
        },
        cancel: () => {
          abort.abort();
          return upstream
            .cancel()
            .catch(() => {})
            .finally(complete);
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": descriptor.mimeType,
          "Content-Length": String(descriptor.sizeBytes),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ETag: etag(descriptor),
        },
      });
    } catch (cause) {
      lease?.abort.abort();
      await (reader ? reader.cancel() : source?.cancel())?.catch(() => {});
      if (lease) reads.delete(lease);
      finish();
      const error =
        cause instanceof PlaybackError
          ? cause
          : new PlaybackError(
              cause instanceof z.ZodError ? 415 : 503,
              "MEDIA_PLAYBACK_UNAVAILABLE",
              "媒体不能安全读取，请重新核对实际记录。",
            );
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: error.message,
          status: error.status,
          code: error.code,
          traceId: crypto.randomUUID(),
        }),
        {
          status: error.status,
          headers: {
            "Content-Type": "application/problem+json",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  };

  const routes = [false, true].map((content) => {
    const operationId = content
      ? "media-playback.read"
      : "media-playback.describe";
    const path =
      `/api/v2/media-records/{id}/playback${content ? "/content" : ""}` as const;
    return defineRouteContribution({
      id: operationId,
      pluginId: "media",
      method: "get",
      path,
      operationId,
      policy: { timeoutMs: 5 * 60_000 },
      declaration: createRoute({
        method: "get",
        path,
        operationId,
        request: {
          params: z.object({ id: z.string().uuid() }),
          query: z.object({
            projectId: z.string().uuid(),
            recordVersion: z.coerce.number().int().nonnegative(),
            ...(content ? { sha256: z.string().regex(/^[a-f0-9]{64}$/u) } : {}),
          }),
          ...(content
            ? { headers: z.object({ "if-match": z.string().optional() }) }
            : {}),
        },
        responses: {
          200: {
            description: content
              ? "Complete verified media bytes, not semantic review evidence"
              : "Owner metadata only, not a file verification",
            content: content
              ? Object.fromEntries(
                  Object.keys(HOST_MANAGED_MEDIA_EXTENSIONS).map((mime) => [
                    mime,
                    { schema: z.string().openapi({ format: "binary" }) },
                  ]),
                )
              : {
                  "application/json": { schema: MediaPlaybackDescriptorSchema },
                },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 413, 415, 428, 503].map((status) => [
              status,
              {
                description: "Media cannot be read safely",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      } as never),
      handler: (c: Parameters<typeof read>[0]) => read(c, content),
    });
  });
  return [
    ...routes,
    ...mediaByteVerificationRoutes(context, records, workspace, {
      describe: (id, projectId, version) =>
        snapshot(id, projectId, version).descriptor,
      read: (descriptor, signal) =>
        read(
          {
            req: {
              param: () => descriptor.recordId,
              query: (key) =>
                key === "projectId"
                  ? descriptor.projectId
                  : key === "recordVersion"
                    ? String(descriptor.recordVersion)
                    : descriptor.sha256,
              header: () => etag(descriptor),
              raw: { signal },
            },
          },
          true,
        ),
    }),
  ];
}
