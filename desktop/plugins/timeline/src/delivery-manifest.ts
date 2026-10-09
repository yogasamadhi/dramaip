import { createHash } from "node:crypto";
import type {
  MediaAudioTrackService,
  MediaRecordService,
} from "@dramaip/contracts/media";
import { mediaDeclarationStatus } from "@dramaip/contracts/media";
import {
  TimelineDeliveryManifestSchema,
  type TimelineDeliveryManifest,
  type TimelineManifest,
} from "@dramaip/contracts/timeline";
import { buildTimelinePlaybackPlan } from "./playback-plan.js";
import { HOST_MANAGED_MEDIA_EXTENSIONS } from "@dramaip/desktop-host";

/** NLE exports include inactive tracks too. Read every source through its public owner; no Host reads or writes. */
export function buildTimelineDeliveryManifest(
  timeline: TimelineManifest,
  records: MediaRecordService,
  audio: MediaAudioTrackService,
): TimelineDeliveryManifest {
  const plan = buildTimelinePlaybackPlan(
    {
      ...timeline,
      tracks: timeline.tracks.map((track) => ({
        ...track,
        muted: false,
        solo: false,
      })),
    },
    records,
    audio,
  );
  const clips = timeline.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip, kind: track.kind })),
  );
  const counts = new Map<string, number>();
  for (const { clip } of clips)
    counts.set(clip.id, (counts.get(clip.id) ?? 0) + 1);
  const sourceBlockers = [
    ...plan.blockers,
    ...[...counts]
      .filter(([, count]) => count > 1)
      .map(([clipId]) => ({
        clipId,
        code: "STALE_SOURCE" as const,
        message: "片段身份重复，无法核对唯一 NLE 来源映射。",
      })),
  ];
  const ids = [
    ...new Set(
      clips.flatMap(({ clip }) => (clip.assetId ? [clip.assetId] : [])),
    ),
  ].sort();
  const media: TimelineDeliveryManifest["media"] = ids.map((assetId) => {
    const uses = clips.filter(({ clip }) => clip.assetId === assetId);
    const actual = records.get(assetId);
    const record =
      actual?.projectId === timeline.projectId ? actual : undefined;
    const bindings = plan.bindings.filter((item) => item.assetId === assetId);
    const clipIds = uses.map(({ clip }) => clip.id).sort();
    const expectedVersions = [
      ...new Set([
        ...uses.flatMap(({ clip }) =>
          clip.assetVersion === undefined ? [] : [clip.assetVersion],
        ),
        ...bindings.map((item) => item.assetVersion),
      ]),
    ].sort((a, b) => a - b);
    const blockers = sourceBlockers.filter((item) =>
      clipIds.includes(item.clipId),
    );
    const complete =
      uses.some(({ kind }) => kind !== "subtitle") &&
      uses.every(
        ({ clip, kind }) =>
          kind === "subtitle" ||
          bindings.some((item) => item.clipId === clip.id),
      );
    const sourceStatus = !actual
      ? "missing"
      : !record
        ? "foreign"
        : blockers.some((item) => item.code === "UNVERIFIED_SOURCE")
          ? "unverified"
          : blockers.length
            ? "stale"
            : !complete || expectedVersions.length !== 1
              ? "unverified"
              : "current";
    const version =
      sourceStatus === "current" ? expectedVersions[0] : undefined;
    const descriptor =
      version === undefined
        ? undefined
        : records.archivedArtifact(assetId, timeline.projectId, version);
    const archive =
      descriptor &&
      descriptor.status === "archived" &&
      bindings.every((item) =>
        item.expectedKind === "audio"
          ? descriptor.kind === "audio"
          : descriptor.kind === "image" || descriptor.kind === "video",
      ) &&
      descriptor.mimeType.startsWith(`${descriptor.kind}/`) &&
      Object.hasOwn(HOST_MANAGED_MEDIA_EXTENSIONS, descriptor.mimeType) &&
      HOST_MANAGED_MEDIA_EXTENSIONS[descriptor.mimeType] ===
        descriptor.extension &&
      ["image", "audio", "video"].includes(descriptor.kind)
        ? {
            artifactRef: descriptor.artifactId,
            kind: descriptor.kind as "image" | "audio" | "video",
            mimeType: descriptor.mimeType,
            extension: descriptor.extension,
            sizeBytes: descriptor.sizeBytes,
            sha256: descriptor.sha256,
            verification: "owner-metadata-only" as const,
          }
        : undefined;
    const declaration = mediaDeclarationStatus(
      record?.payload ?? {},
      record?.kind,
    );
    return {
      assetId,
      title: record?.title ?? "未核对的素材",
      clipIds,
      expectedVersions,
      sourceStatus,
      ...(version === undefined ? {} : { sourceVersion: version }),
      relativePath: `media/${assetId}${archive?.extension ?? ""}`,
      ...(archive ? { archive, checksum: archive.sha256 } : {}),
      mediaStatus: "unattached",
      rightsStatus: declaration.rightsStatus,
      rightsDeclaration: declaration.rightsDeclaration,
      lineage: record ? [record.kind, assetId] : [assetId],
    };
  });
  const projection = {
    format: "dramaip-timeline-delivery" as const,
    schemaVersion: 3 as const,
    timeline,
    media,
    sourceBlockers,
    unsupportedFeatures: [
      "media-package-copy",
      "rights-evidence-validation",
      "final-audio-mix",
      "subtitle-burn-in",
      "fcpxml-video-only",
      "edl-video-only",
      "otio-mute-volume-fades-not-translated",
    ],
    warnings: [
      "相对路径是重链接目标，没有复制媒体；存档 SHA-256 仅为 owner 元数据，未读取实际文件字节。",
      "可编辑权利字段仅是人工声明，不代表授权证据或费用已核验；正式交付须另行审查。",
      ...(media.some((item) => !item.archive)
        ? ["部分素材没有精确来源版本的单一有效存档；占位路径不能作为实际文件。"]
        : []),
      ...sourceBlockers.map((item) => `${item.clipId}：${item.message}`),
    ],
  };
  return TimelineDeliveryManifestSchema.parse({
    ...projection,
    sourceFingerprint: createHash("sha256")
      .update(JSON.stringify(projection))
      .digest("hex"),
  });
}
