import { createHash } from "node:crypto";
import type { MediaAudioTrackService } from "@dramaip/contracts/media";
import {
  TimelineRenderSubtitlePolicySchema,
  type TimelineManifest,
  type TimelineRenderSubtitlePolicy,
} from "@dramaip/contracts/timeline";
import {
  validTimelineRenderSubtitlePlan,
  type HostTimelineRenderSubtitleCue,
  type HostTimelineRenderSubtitlePlan,
} from "@dramaip/desktop-host";

/** Saved Timeline owns literal text; adopted Audio owns the exact upstream binding, not editable paths. */
export function buildTimelineRenderSubtitleSources(
  timeline: TimelineManifest,
  audio: MediaAudioTrackService,
  input: TimelineRenderSubtitlePolicy,
) {
  const policy = TimelineRenderSubtitlePolicySchema.parse(input);
  const blockers: string[] = [],
    evidence: unknown[] = [],
    excludedClipIds: string[] = [];
  const cues: HostTimelineRenderSubtitleCue[] = [];
  const tracks = timeline.tracks.filter((track) => track.kind === "subtitle");
  const all = timeline.tracks.flatMap((track) => track.clips);
  if (new Set(all.map((clip) => clip.id)).size !== all.length)
    blockers.push("时间线片段身份重复，不能冻结唯一字幕来源。");
  const upstream =
    policy.mode === "burn-in" ? audio.list(timeline.episodeId) : [];
  for (const track of tracks) {
    if (policy.mode === "omit" || track.muted) {
      excludedClipIds.push(...track.clips.map((clip) => clip.id));
      continue;
    }
    for (const clip of track.clips) {
      if (clip.trackId !== track.id) {
        blockers.push("字幕片段不属于原字幕轨道。");
        continue;
      }
      if (clip.audioTrackId) {
        const owner = upstream.find((item) => item.id === clip.audioTrackId);
        const source = owner?.clips.find(
          (item) => item.id === clip.sourceClipId,
        );
        if (
          !owner ||
          owner.projectId !== timeline.projectId ||
          owner.episodeId !== timeline.episodeId ||
          !["dialogue", "narration"].includes(owner.kind) ||
          owner.status !== "adopted" ||
          owner.stale ||
          owner.sourceState !== "current" ||
          owner.version !== clip.audioTrackVersion ||
          owner.sourceFingerprint !== clip.audioSourceFingerprint ||
          !source ||
          source.shotId !== clip.shotId
        ) {
          blockers.push(
            "字幕的实际Audio归属、采用状态或冻结来源已变化；须明确复核，不切最新来源。",
          );
          continue;
        }
        evidence.push({
          clipId: clip.id,
          ownerId: owner.id,
          ownerVersion: owner.version,
          sourceFingerprint: owner.sourceFingerprint,
          sourceState: owner.sourceState,
          source,
        });
      } else if (
        clip.audioTrackVersion !== undefined ||
        clip.audioSourceFingerprint !== undefined
      ) {
        blockers.push("字幕Audio绑定不完整，不能补齐历史来源。");
        continue;
      } else
        evidence.push({
          clipId: clip.id,
          source: "saved-timeline-text",
          manuallyEdited: clip.manuallyEdited,
        });
      cues.push({
        clipId: clip.id,
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        text: clip.text ?? "",
      });
    }
  }
  const subtitlePlan: HostTimelineRenderSubtitlePlan =
    policy.mode === "omit"
      ? { format: "dramaip-render-subtitles", version: 1, mode: "omit" }
      : {
          format: "dramaip-render-subtitles",
          version: 1,
          mode: "burn-in",
          font: { ...policy.font },
          cues,
        };
  if (!validTimelineRenderSubtitlePlan(subtitlePlan, timeline.durationFrames))
    blockers.push(
      "冻结字幕存在空文本、无参与字幕、非法字节／帧区间、重叠或预算超限；不能截短、补字或降级为omit。",
    );
  const snapshot = { policy, subtitlePlan, evidence, excludedClipIds };
  return {
    subtitlePlan,
    snapshot,
    blockers: [...new Set(blockers)],
    sourceFingerprint: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
  };
}
