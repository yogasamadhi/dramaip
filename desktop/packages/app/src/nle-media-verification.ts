import type { StudioClient } from "@dramaip/client";
import { MEDIA_PLAYBACK_MAX_BYTES } from "@dramaip/contracts/media";
import {
  TimelineDeliveryManifestSchema,
  type TimelineDeliveryManifest,
} from "@dramaip/contracts/timeline";

export const NLE_VERIFICATION_MAX_FILES = 50;
export const NLE_VERIFICATION_MAX_BYTES = 256 * 1024 * 1024;
export type NleMediaVerification = {
  assetId: string;
  status: "verified" | "unavailable";
  message: string;
  sha256?: string;
  sizeBytes?: number;
};
type Reader = Pick<StudioClient, "mediaPlayback" | "timeline">;
const changed = () =>
  new Error(
    "清单的实际时间线／来源／存档已变化；请重新读取清单，不沿旧结果继续。",
  );
const identity = (value: TimelineDeliveryManifest) => JSON.stringify(value);

/** Explicit, bounded sequential reads only. Never create URLs, play, export files, trust editable checksum, or persist consent. */
export async function verifyNleDeliveryMedia(
  original: TimelineDeliveryManifest,
  client: Reader,
  signal: AbortSignal,
  progress?: (done: number, total: number) => void,
): Promise<NleMediaVerification[]> {
  const value = TimelineDeliveryManifestSchema.parse(original);
  const check = async () => {
    signal.throwIfAborted();
    const actual = TimelineDeliveryManifestSchema.parse(
      await client.timeline.deliveryManifest(value.timeline.episodeId),
    );
    signal.throwIfAborted();
    if (identity(actual) !== identity(value)) throw changed();
  };
  if (
    new Set(value.media.map((item) => item.assetId)).size !==
      value.media.length ||
    value.media.some(
      (item) =>
        item.archive &&
        (item.sourceStatus !== "current" ||
          item.sourceVersion === undefined ||
          item.expectedVersions.length !== 1 ||
          item.expectedVersions[0] !== item.sourceVersion ||
          item.checksum !== item.archive.sha256 ||
          item.relativePath !==
            `media/${item.assetId}${item.archive.extension}`),
    )
  )
    throw changed();
  const bytes = value.media.reduce(
    (sum, item) => sum + (item.archive?.sizeBytes ?? 0),
    0,
  );
  if (
    value.media.length > NLE_VERIFICATION_MAX_FILES ||
    bytes > NLE_VERIFICATION_MAX_BYTES ||
    value.media.some(
      (item) => (item.archive?.sizeBytes ?? 0) > MEDIA_PLAYBACK_MAX_BYTES,
    )
  )
    throw new Error(
      "本次全字节核验最多 50 个文件、合计 256 MiB、单文件 128 MiB；超出范围须另行逐文件审阅。",
    );
  await check();
  const results: NleMediaVerification[] = [];
  for (const item of value.media) {
    signal.throwIfAborted();
    if (
      !item.archive ||
      item.sourceVersion === undefined ||
      item.sourceStatus !== "current"
    ) {
      results.push({
        assetId: item.assetId,
        status: "unavailable",
        message: "没有精确来源版本的单一有效存档，不读取占位路径或最新媒体。",
      });
    } else {
      try {
        const opened = await client.mediaPlayback.open(
          item.assetId,
          value.timeline.projectId,
          item.sourceVersion,
          signal,
        );
        signal.throwIfAborted();
        const descriptor = opened.descriptor;
        if (
          descriptor.recordId !== item.assetId ||
          descriptor.projectId !== value.timeline.projectId ||
          descriptor.recordVersion !== item.sourceVersion ||
          descriptor.origin !== "managed-archive" ||
          descriptor.artifactRef !== item.archive.artifactRef ||
          descriptor.kind !== item.archive.kind ||
          descriptor.mimeType !== item.archive.mimeType ||
          descriptor.sha256 !== item.archive.sha256 ||
          descriptor.sizeBytes !== item.archive.sizeBytes ||
          opened.blob.size !== item.archive.sizeBytes ||
          opened.blob.type !== item.archive.mimeType
        )
          throw changed();
        const buffer = await opened.blob.arrayBuffer();
        signal.throwIfAborted();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        signal.throwIfAborted();
        const sha256 = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        if (sha256 !== item.archive.sha256) throw changed();
        results.push({
          assetId: item.assetId,
          status: "verified",
          message:
            "本次受控完整读取的字节数与 SHA-256 一致；不代表质量或授权通过。",
          sha256,
          sizeBytes: buffer.byteLength,
        });
      } catch {
        signal.throwIfAborted();
        results.push({
          assetId: item.assetId,
          status: "unavailable",
          message:
            "实际文件未能核验（缺失、版本变化、格式／字节不符或读取失败）；没有自动换源或重试。",
        });
      }
    }
    progress?.(results.length, value.media.length);
  }
  await check();
  return results;
}
