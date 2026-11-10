import {
  HOST_MANAGED_MEDIA_EXTENSIONS,
  validManagedMediaReadInput,
  type HostManagedMediaReadInput,
  type HostTimelineRenderInput,
} from "./index.js";

export interface HostTimelineRenderAudioClip extends HostManagedMediaReadInput {
  clipId: string;
  kind: "video" | "dialogue" | "narration" | "bgm" | "sfx";
  startFrame: number;
  durationFrames: number;
  sourceOffsetFrame: number;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  duckingGain: number;
}
export interface HostTimelineRenderAudioPlan {
  format: "dramaip-render-audio";
  version: 1;
  policy: "saved-gains-reject-over-unity";
  videoEmbeddedAudio: "mix-if-present";
  clips: readonly HostTimelineRenderAudioClip[];
}

const keys = [
  "mediaRef",
  "sha256",
  "sizeBytes",
  "mimeType",
  "clipId",
  "kind",
  "startFrame",
  "durationFrames",
  "sourceOffsetFrame",
  "volume",
  "fadeInFrames",
  "fadeOutFrames",
  "duckingGain",
];
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const frames = (value: unknown) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  Number.isSafeInteger(value * 1920);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const descriptor = (value: HostManagedMediaReadInput) =>
  JSON.stringify([
    value.mediaRef,
    value.sha256,
    value.sizeBytes,
    value.mimeType,
  ]);

/** Validate raw, uncoerced input. The old five-field request does not imply this policy. */
export function validTimelineRenderAudioPlan(
  value: unknown,
  durationFrames: number,
  videoClips: HostTimelineRenderInput["clips"],
): value is HostTimelineRenderAudioPlan {
  if (
    !object(value) ||
    Object.keys(value).length !== 5 ||
    value.format !== "dramaip-render-audio" ||
    value.version !== 1 ||
    value.policy !== "saved-gains-reject-over-unity" ||
    value.videoEmbeddedAudio !== "mix-if-present" ||
    !Array.isArray(value.clips) ||
    value.clips.length > 10_000 ||
    !frames(durationFrames) ||
    durationFrames < 1
  )
    return false;
  const identities = new Set<string>();
  const descriptors = new Map<string, string>();
  for (const clip of videoClips) {
    const previous = descriptors.get(clip.mediaRef);
    if (previous && previous !== descriptor(clip)) return false;
    descriptors.set(clip.mediaRef, descriptor(clip));
  }
  for (const raw of value.clips) {
    if (
      !object(raw) ||
      Object.keys(raw).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(raw, key))
    )
      return false;
    const clip = raw as unknown as HostTimelineRenderAudioClip;
    if (
      typeof clip.clipId !== "string" ||
      !uuid.test(clip.clipId) ||
      identities.has(clip.clipId) ||
      !["video", "dialogue", "narration", "bgm", "sfx"].includes(clip.kind) ||
      !validManagedMediaReadInput(clip) ||
      !frames(clip.startFrame) ||
      !frames(clip.durationFrames) ||
      clip.durationFrames < 1 ||
      !frames(clip.sourceOffsetFrame) ||
      !frames(clip.fadeInFrames) ||
      !frames(clip.fadeOutFrames) ||
      !frames(clip.startFrame + clip.durationFrames) ||
      !frames(clip.sourceOffsetFrame + clip.durationFrames) ||
      clip.startFrame + clip.durationFrames > durationFrames ||
      !Number.isFinite(clip.volume) ||
      !Number.isFinite(clip.duckingGain)
    )
      return false;
    if (clip.kind === "video") {
      if (
        clip.mimeType !== "video/mp4" ||
        !videoClips.some(
          (video) =>
            descriptor(video) === descriptor(clip) &&
            video.startFrame === clip.startFrame &&
            video.durationFrames === clip.durationFrames &&
            video.sourceOffsetFrame === clip.sourceOffsetFrame,
        )
      )
        return false;
    } else if (
      !clip.mimeType.startsWith("audio/") ||
      !Object.hasOwn(HOST_MANAGED_MEDIA_EXTENSIONS, clip.mimeType)
    )
      return false;
    const previous = descriptors.get(clip.mediaRef);
    if (previous && previous !== descriptor(clip)) return false;
    descriptors.set(clip.mediaRef, descriptor(clip));
    identities.add(clip.clipId);
  }
  return true;
}
