import { createHash } from "node:crypto";
import { validNleCopyInput, type NleCopyInput } from "@dramaip/desktop-host";
import {
  type MediaAudioTrackService,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import type { TimelineManifest } from "@dramaip/contracts/timeline";
import {
  TimelineCopyManifestSchema,
  type TimelineCopyScope,
} from "@dramaip/contracts/timeline-copy";
import { buildTimelineDeliveryManifest } from "./delivery-manifest.js";

export function canonicalCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCopyValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonicalCopyValue(item)]),
    );
  return value;
}
export const copyDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalCopyValue(value)))
    .digest("hex");
export const copyScope = (
  manifest: ReturnType<typeof buildTimelineDeliveryManifest>,
): TimelineCopyScope => ({
  projectId: manifest.timeline.projectId,
  episodeId: manifest.timeline.episodeId,
  timelineId: manifest.timeline.id,
  timelineVersion: manifest.timeline.version,
  sourceFingerprint: manifest.sourceFingerprint,
});
export class CopySourceError extends Error {
  constructor() {
    super("原清单／来源不可完整核对，不能自动换源或交付。");
  }
}
export function buildCopySnapshot(
  timeline: TimelineManifest,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
  document: (
    timeline: TimelineManifest,
    format: "fcpxml" | "otio" | "edl" | "srt" | "vtt" | "relink",
  ) => { content: string },
) {
  const manifest = TimelineCopyManifestSchema.parse(
    buildTimelineDeliveryManifest(timeline, media, audio),
  );
  const profile = timeline.profile;
  if (
    manifest.sourceBlockers.length ||
    !manifest.media.length ||
    profile.width !== 1080 ||
    profile.height !== 1920 ||
    profile.frameRate.numerator !== 25 ||
    profile.frameRate.denominator !== 1 ||
    profile.frameRate.dropFrame ||
    profile.audioSampleRate !== 48_000 ||
    profile.channels !== 2
  )
    throw new CopySourceError();
  const sources: NleCopyInput["media"][number][] = [];
  for (const item of manifest.media) {
    if (
      item.sourceStatus !== "current" ||
      item.sourceVersion === undefined ||
      !item.archive ||
      item.rightsStatus === "restricted"
    )
      throw new CopySourceError();
    const artifact = media.archivedArtifact(
      item.assetId,
      timeline.projectId,
      item.sourceVersion,
    );
    if (
      !artifact ||
      artifact.artifactId !== item.archive.artifactRef ||
      artifact.status !== "archived" ||
      artifact.mimeType !== item.archive.mimeType ||
      artifact.sha256 !== item.archive.sha256 ||
      artifact.sizeBytes !== item.archive.sizeBytes ||
      artifact.extension !== item.archive.extension
    )
      throw new CopySourceError();
    sources.push({
      assetId: item.assetId,
      recordVersion: item.sourceVersion,
      artifactId: artifact.artifactId,
      mediaRef: artifact.mediaRef,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    });
  }
  // Editable clip.mediaRef is neither a source nor a needed exported capability.
  const sanitized = {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map(({ mediaRef: _ignored, ...clip }) => clip),
    })),
  };
  const names = {
    fcpxml: "timeline.fcpxml",
    otio: "timeline.otio",
    edl: "timeline.edl",
    srt: "subtitles.srt",
    vtt: "subtitles.vtt",
    relink: "relink.json",
  } as const;
  const documents: { relativePath: string; content: string }[] = Object.entries(
    names,
  ).map(([format, relativePath]) => ({
    relativePath,
    content: document(sanitized, format as keyof typeof names).content,
  }));
  documents.push({
    relativePath: "timeline-manifest.json",
    content:
      JSON.stringify(
        {
          format: "dramaip-nle-copy-plan",
          schemaVersion: 1,
          scope: copyScope(manifest),
          timeline: sanitized,
          media: manifest.media,
          byteReceiptFile: "copied-media.json",
          verification: "copy-plan-only-read-separate-byte-and-core-receipts",
          qualityState: "unverified",
          rightsState: "unverified",
          billingState: "unknown",
          unsupportedFeatures: manifest.unsupportedFeatures.filter(
            (item) => item !== "media-package-copy",
          ),
          warnings: [
            "这些路径为冻结原来源的复制目标；copied-media.json才记录完整复制字节。Core交付回执另核复制前后owner，文件存在不代表交付成功。",
            "不证明当前文件、NLE语义、最终混音／烧录字幕、授权、费用或质量通过。",
          ],
        },
        null,
        2,
      ) + "\n",
  });
  const input: NleCopyInput = {
    ...copyScope(manifest),
    media: sources,
    documents,
  };
  if (!validNleCopyInput(input)) throw new CopySourceError();
  return { manifest, input, fingerprint: copyDigest({ manifest, input }) };
}
