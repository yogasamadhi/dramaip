import { createHash } from "node:crypto";
import type {
  MediaAudioTrackService,
  MediaRecordService,
} from "@dramaip/contracts/media";
import type {
  TimelineManifest,
  TimelineRenderSubtitlePolicy,
} from "@dramaip/contracts/timeline";
import type { HostTimelineRenderInput } from "@dramaip/desktop-host";
import { buildTimelinePlaybackPlan } from "./playback-plan.js";
import { buildTimelineRenderAudioSources } from "./render-audio-sources.js";
import { buildTimelineRenderSubtitleSources } from "./render-subtitle-sources.js";

/** Only Media's authoritative archive projection supplies Host refs. Never trust clip/payload mediaRef. */
export function buildTimelineRenderSources(
  timeline: TimelineManifest,
  media: MediaRecordService,
  audio: MediaAudioTrackService,
  subtitlePolicy?: TimelineRenderSubtitlePolicy,
) {
  // New explicit policy owns its own subtitle validation. Legacy absence keeps the old snapshot exactly.
  const mediaTimeline = subtitlePolicy
    ? {
        ...timeline,
        tracks: timeline.tracks.filter((track) => track.kind !== "subtitle"),
      }
    : timeline;
  const plan = buildTimelinePlaybackPlan(mediaTimeline, media, audio);
  const blockers = plan.blockers.map((item) => item.message);
  const clips: HostTimelineRenderInput["clips"][number][] = [];
  const evidence: unknown[] = [];
  const visual = timeline.tracks
    .filter((track) => track.kind === "video")
    .flatMap((track) => track.clips)
    .sort((a, b) => a.startFrame - b.startFrame);
  if (new Set(visual.map((clip) => clip.id)).size !== visual.length)
    blockers.push("视频片段身份重复，不能确定唯一冻结来源。");
  if (visual.length > 10_000)
    blockers.push("当前实验渲染器最多支持 10000 个视频片段。");
  for (const clip of visual) {
    const binding = plan.bindings.find(
      (item) => item.clipId === clip.id && item.expectedKind === "visual",
    );
    if (!binding) continue;
    const artifact = media.archivedArtifact(
      binding.assetId,
      timeline.projectId,
      binding.assetVersion,
    );
    if (
      !artifact ||
      artifact.kind !== "video" ||
      artifact.mimeType !== "video/mp4" ||
      artifact.extension !== ".mp4" ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes > 2 * 1024 * 1024 * 1024
    ) {
      blockers.push(
        "视频片段没有精确版本的单一有效 MP4 归档；可编辑引用、内嵌预览或其他格式不能冒充渲染文件。",
      );
      continue;
    }
    evidence.push({
      binding,
      artifact,
      source: media.sourceStatus(binding.assetId),
    });
    clips.push({
      mediaRef: artifact.mediaRef,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mimeType: "video/mp4",
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      sourceOffsetFrame: clip.sourceOffsetFrame,
    });
  }
  if (!visual.length) blockers.push("时间线没有可渲染的视频片段。");
  for (let index = 1; index < visual.length; index++) {
    if (
      visual[index]!.startFrame <
      visual[index - 1]!.startFrame + visual[index - 1]!.durationFrames
    ) {
      blockers.push("P0 实验渲染器尚不支持重叠视频片段。");
      break;
    }
  }
  const audioSources = buildTimelineRenderAudioSources(
    mediaTimeline,
    media,
    audio,
    clips,
  );
  blockers.push(...audioSources.blockers);
  const subtitles = subtitlePolicy
    ? buildTimelineRenderSubtitleSources(timeline, audio, subtitlePolicy)
    : undefined;
  if (subtitles) blockers.push(...subtitles.blockers);
  const snapshot = {
    timeline,
    bindings: plan.bindings,
    evidence,
    audio: audioSources.snapshot,
    ...(subtitles ? { subtitles: subtitles.snapshot } : {}),
  };
  const sourceFingerprint = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  return {
    clips,
    audioPlan: audioSources.audioPlan,
    ...(subtitles ? { subtitlePlan: subtitles.subtitlePlan } : {}),
    blockers: [...new Set(blockers)],
    snapshot,
    sourceFingerprint,
  };
}
