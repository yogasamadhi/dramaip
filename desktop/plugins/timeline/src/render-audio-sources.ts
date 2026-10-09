import { createHash } from "node:crypto";
import {
  MediaArtifactDescriptorSchema,
  MediaSourceStatusSchema,
  type MediaAudioTrackService,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import type { TimelineManifest } from "@dramaip/contracts/timeline";
import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  validManagedMediaReadInput,
} from "@dramaip/desktop-host";
import { buildTimelinePlaybackPlan } from "./playback-plan.js";
import {
  validTimelineRenderAudioPlan,
  type HostTimelineRenderAudioClip,
  type HostTimelineRenderAudioPlan,
} from "@dramaip/desktop-host";

/** Core contribution; only actual public owner reads, never editable clip mediaRef. */
export function buildTimelineRenderAudioSources(
  timeline: TimelineManifest,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
  videoClips: Parameters<typeof validTimelineRenderAudioPlan>[2],
) {
  const playback = buildTimelinePlaybackPlan(timeline, media, audio);
  const blockers = playback.blockers.map((item) => item.message);
  const evidence: unknown[] = [];
  const clips: HostTimelineRenderAudioClip[] = [];
  const excludedClipIds: string[] = [];
  const solo = timeline.tracks.some(
    (track) => track.kind !== "subtitle" && track.solo,
  );
  const all = timeline.tracks.flatMap((track) => track.clips);
  if (new Set(all.map((clip) => clip.id)).size !== all.length)
    blockers.push("时间线片段身份重复，不能冻结唯一音频输入。");
  for (const track of timeline.tracks) {
    if (track.kind === "subtitle") continue;
    if (track.muted || (solo && !track.solo)) {
      excludedClipIds.push(...track.clips.map((clip) => clip.id));
      continue;
    }
    for (const clip of track.clips) {
      const binding = playback.bindings.find(
        (item) =>
          item.clipId === clip.id &&
          item.expectedKind === (track.kind === "video" ? "visual" : "audio"),
      );
      if (!binding) continue; // The playback owner read already produced a blocker.
      const archived = MediaArtifactDescriptorSchema.strict().safeParse(
        media.archivedArtifact(
          binding.assetId,
          timeline.projectId,
          binding.assetVersion,
        ),
      );
      const source = MediaSourceStatusSchema.strict().safeParse(
        media.sourceStatus(binding.assetId),
      );
      if (
        !archived.success ||
        !source.success ||
        archived.data.status !== "archived" ||
        source.data.recordId !== binding.assetId ||
        source.data.recordVersion !== binding.assetVersion ||
        !["current", "unbound"].includes(source.data.state)
      ) {
        blockers.push(
          "音频片段的精确归档或Media来源状态当前无效；不切最新素材或回填可编辑引用。",
        );
        continue;
      }
      const artifact = archived.data;
      const expectedKind = track.kind === "video" ? "video" : "audio";
      if (
        artifact.kind !== expectedKind ||
        !validManagedMediaReadInput(artifact) ||
        HOST_MANAGED_MEDIA_EXTENSIONS[artifact.mimeType] !==
          artifact.extension ||
        (track.kind === "video"
          ? artifact.mimeType !== "video/mp4"
          : !artifact.mimeType.startsWith("audio/"))
      ) {
        blockers.push(
          "片段缺少受支持的精确音频归档格式；不会用空音轨冒充实际来源。",
        );
        continue;
      }
      const input: HostTimelineRenderAudioClip = {
        clipId: clip.id,
        kind: track.kind,
        mediaRef: artifact.mediaRef,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        sourceOffsetFrame: clip.sourceOffsetFrame,
        volume: clip.volume ?? 1,
        fadeInFrames: clip.fadeInFrames ?? 0,
        fadeOutFrames: clip.fadeOutFrames ?? 0,
        duckingGain: clip.duckingGain ?? 0.55,
      };
      clips.push(input);
      evidence.push({ binding, artifact, source: source.data });
    }
  }
  const audioPlan: HostTimelineRenderAudioPlan = {
    format: "dramaip-render-audio",
    version: 1,
    policy: "saved-gains-reject-over-unity",
    videoEmbeddedAudio: "mix-if-present",
    clips,
  };
  if (
    !validTimelineRenderAudioPlan(
      audioPlan,
      timeline.durationFrames,
      videoClips,
    )
  )
    blockers.push(
      "冻结音频输入的身份、参数或来源描述符冲突；不能部分渲染或改写控制值。",
    );
  const snapshot = { audioPlan, evidence, excludedClipIds };
  const sourceFingerprint = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  return {
    audioPlan,
    blockers: [...new Set(blockers)],
    snapshot,
    sourceFingerprint,
  };
}
