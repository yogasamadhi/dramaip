import {
  MEDIA_PLAYBACK_MAX_BYTES,
  MediaPlaybackDescriptorSchema,
  type MediaPlaybackDescriptor,
  MediaByteVerificationSchema,
  MediaByteVerificationPageSchema,
  MediaDeliveryEvidenceSchema,
  MediaDeliveryEvidenceQuerySchema,
  type MediaDeliveryEvidence,
  type MediaByteVerification,
  type MediaByteVerificationPage,
} from "@dramaip/contracts/media";
import type { StudioClientOptions } from "./generated.js";
import {
  createGeneratedOpenApiClient,
  requestGeneratedApi,
} from "./openapi-client.js";
import { asApiError, StudioClientError } from "./errors.js";

export interface MediaPlaybackClient {
  deliveryEvidence(
    id: string,
    projectId: string,
    version: number,
    signal?: AbortSignal,
  ): Promise<MediaDeliveryEvidence>;
  verifyBytes(
    descriptor: MediaPlaybackDescriptor,
    key: string,
    signal?: AbortSignal,
  ): Promise<MediaByteVerification>;
  byteVerification(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<MediaByteVerification>;
  recoverByteVerification(
    recordId: string,
    projectId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<MediaByteVerification>;
  byteVerifications(
    recordId: string,
    projectId: string,
    version: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<MediaByteVerificationPage>;
  describe(
    id: string,
    projectId: string,
    version: number,
    signal?: AbortSignal,
  ): Promise<MediaPlaybackDescriptor>;
  open(
    id: string,
    projectId: string,
    version: number,
    signal?: AbortSignal,
  ): Promise<{ descriptor: MediaPlaybackDescriptor; blob: Blob }>;
}
const interrupted = () =>
  new StudioClientError(409, {
    code: "CONFLICT",
    details: { playbackCode: "MEDIA_PLAYBACK_INTERRUPTED" },
    message: "媒体读取未完成或已变化，请重新加载。",
    requestId: "media-playback",
  });

/** Authenticated, version-bound complete read. Consumers receive a Blob, never tokens, paths or raw Runtime URLs. */
export function createMediaPlaybackClient(
  options: StudioClientOptions,
): MediaPlaybackClient {
  const generated = createGeneratedOpenApiClient(options);
  const receiptRequest = async (path: string, init?: RequestInit) => {
    const result = await requestGeneratedApi(generated, path, init);
    if (!result.response.ok)
      throw new StudioClientError(
        result.response.status,
        asApiError(result.error),
      );
    return result.data;
  };
  const receiptPath = (id: string) =>
    `/api/v2/media-records/${encodeURIComponent(id)}/byte-verifications`;
  const path = (id: string, projectId: string, version: number) =>
    `/api/v2/media-records/${encodeURIComponent(id)}/playback?${new URLSearchParams({ projectId, recordVersion: String(version) })}`;
  const describe: MediaPlaybackClient["describe"] = async (
    id,
    projectId,
    version,
    signal,
  ) => {
    const result = await requestGeneratedApi(
      generated,
      path(id, projectId, version),
      { signal },
    );
    if (!result.response.ok)
      throw new StudioClientError(
        result.response.status,
        asApiError(result.error),
      );
    const value = MediaPlaybackDescriptorSchema.safeParse(result.data);
    if (
      !value.success ||
      value.data.recordId !== id ||
      value.data.projectId !== projectId ||
      value.data.recordVersion !== version
    )
      throw interrupted();
    return value.data;
  };
  return {
    deliveryEvidence: async (id, projectId, version, signal) => {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(version) || version < 0) throw interrupted();
      const query = MediaDeliveryEvidenceQuerySchema.parse({
        projectId,
        recordVersion: version,
      });
      const value = MediaDeliveryEvidenceSchema.parse(
        await receiptRequest(
          `/api/v2/media-records/${encodeURIComponent(id)}/delivery-evidence?${new URLSearchParams({ projectId: query.projectId, recordVersion: String(query.recordVersion) })}`,
          { signal },
        ),
      );
      signal?.throwIfAborted();
      if (
        value.recordId !== id ||
        value.projectId !== projectId ||
        value.recordVersion !== version
      )
        throw interrupted();
      return value;
    },
    verifyBytes: async (input, key, signal) => {
      const descriptor = MediaPlaybackDescriptorSchema.parse(input);
      const value = MediaByteVerificationSchema.parse(
        await receiptRequest(receiptPath(descriptor.recordId), {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            "If-Match": `"playback-${descriptor.recordVersion}-${descriptor.sha256}"`,
          },
          body: JSON.stringify({ descriptor }),
        }),
      );
      if (
        value.requestKey !== key ||
        JSON.stringify(value.descriptor) !== JSON.stringify(descriptor)
      )
        throw interrupted();
      return value;
    },
    byteVerification: async (id, projectId, signal) => {
      const value = MediaByteVerificationSchema.parse(
        await receiptRequest(
          `/api/v2/media-byte-verifications/${encodeURIComponent(id)}?${new URLSearchParams({ projectId })}`,
          { signal },
        ),
      );
      if (value.id !== id || value.descriptor.projectId !== projectId)
        throw interrupted();
      return value;
    },
    recoverByteVerification: async (recordId, projectId, key, signal) => {
      const value = MediaByteVerificationSchema.parse(
        await receiptRequest(
          `${receiptPath(recordId)}/requests/${encodeURIComponent(key)}?${new URLSearchParams({ projectId })}`,
          { signal },
        ),
      );
      if (
        value.descriptor.recordId !== recordId ||
        value.descriptor.projectId !== projectId ||
        value.requestKey !== key
      )
        throw interrupted();
      return value;
    },
    byteVerifications: async (recordId, projectId, version, cursor, signal) => {
      const query = new URLSearchParams({
        projectId,
        recordVersion: String(version),
        ...(cursor ? { cursor } : {}),
      });
      const value = MediaByteVerificationPageSchema.parse(
        await receiptRequest(`${receiptPath(recordId)}?${query}`, { signal }),
      );
      if (
        value.recordId !== recordId ||
        value.projectId !== projectId ||
        value.recordVersion !== version ||
        new Set(value.items.map((item) => item.id)).size !==
          value.items.length ||
        value.items.some(
          (item) =>
            item.descriptor.recordId !== recordId ||
            item.descriptor.projectId !== projectId ||
            item.descriptor.recordVersion !== version,
        )
      )
        throw interrupted();
      return value;
    },
    describe,
    open: async (id, projectId, version, signal) => {
      const descriptor = await describe(id, projectId, version, signal);
      if (descriptor.sizeBytes > MEDIA_PLAYBACK_MAX_BYTES)
        throw new StudioClientError(413, {
          code: "VALIDATION_ERROR",
          message: "完整播放暂支持最多 128 MiB；较大文件请另行审阅。",
          requestId: "media-playback",
        });
      const query = new URLSearchParams({
        projectId,
        recordVersion: String(version),
        sha256: descriptor.sha256,
      });
      const result = await requestGeneratedApi(
        generated,
        `/api/v2/media-records/${encodeURIComponent(id)}/playback/content?${query}`,
        {
          signal,
          headers: { "If-Match": `"playback-${version}-${descriptor.sha256}"` },
        },
        "stream",
      );
      if (!result.response.ok)
        throw new StudioClientError(
          result.response.status,
          asApiError(result.error),
        );
      const source = result.data as ReadableStream<Uint8Array> | undefined;
      if (
        !source ||
        typeof source.getReader !== "function" ||
        result.response.headers.get("Content-Type") !== descriptor.mimeType ||
        result.response.headers.get("Content-Length") !==
          String(descriptor.sizeBytes)
      ) {
        await source?.cancel?.().catch(() => {});
        throw interrupted();
      }
      const reader = source.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let count = 0;
      try {
        for (;;) {
          signal?.throwIfAborted();
          const chunk = await reader.read();
          signal?.throwIfAborted();
          if (chunk.done) break;
          count += chunk.value.byteLength;
          if (count > descriptor.sizeBytes) throw interrupted();
          chunks.push(new Uint8Array(chunk.value));
        }
        if (count !== descriptor.sizeBytes) throw interrupted();
        return {
          descriptor,
          blob: new Blob(chunks, { type: descriptor.mimeType }),
        };
      } catch {
        await reader.cancel().catch(() => {});
        throw interrupted();
      } finally {
        reader.releaseLock();
      }
    },
  };
}
