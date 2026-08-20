import { z } from "zod";
import { TaskSchema } from "./automation.js";

export const MediaRecordKindSchema = z.enum([
  "shot-stills",
  "visual-assets",
  "assets",
  "rights",
  "image",
  "audio",
  "video",
  "animatics",
  "renders",
]);

export const MediaRecordSchema = z.object({
  id: z.string().uuid(),
  kind: MediaRecordKindSchema,
  domain: MediaRecordKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  payload: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MediaRecordInputSchema = MediaRecordSchema.pick({
  projectId: true,
  parentId: true,
  title: true,
  payload: true,
}).extend({ payload: z.record(z.string(), z.unknown()).optional() });

export const MediaRecordPatchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().nonnegative(),
});

export const AssetCenterCategorySchema = z.enum([
  "character",
  "scene",
  "prop",
  "voice",
]);

export const AssetCenterPreviewSchema = z.object({
  kind: z.enum(["image", "audio", "none"]),
  status: z.enum(["available", "missing", "unattached"]),
  label: z.string().optional(),
});

export const AssetCenterUsageSchema = z.object({
  shotId: z.string().uuid(),
  shotTitle: z.string(),
  sceneTitle: z.string().optional(),
});

export const AssetCenterAssetSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: AssetCenterCategorySchema,
  subject: z.string(),
  assetVersion: z.string(),
  adopted: z.boolean(),
  lockStatus: z.enum(["locked", "unlocked"]),
  stale: z.boolean(),
  preview: AssetCenterPreviewSchema,
  rightsStatus: z.enum(["verified", "restricted", "unknown"]),
  costStatus: z.enum(["known", "unknown"]),
  providerStatus: z.enum(["available", "unavailable", "not-required"]),
  usages: z.array(AssetCenterUsageSchema),
  version: z.number().int().nonnegative(),
});

export const AssetCenterSchema = z.object({
  projectId: z.string().uuid(),
  assets: z.array(AssetCenterAssetSchema),
});

export const AssetCenterActionInputSchema = z.object({
  action: z.enum(["adopt", "lock", "unlock", "assign-shot", "remove-shot"]),
  version: z.number().int().nonnegative(),
  shotId: z.string().uuid().optional(),
});

export const AssetCenterPreviewMediaSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "audio"]),
  dataUrl: z.string(),
});

export const AudioTrackKindSchema = z.enum([
  "dialogue",
  "narration",
  "bgm",
  "sfx",
]);

export const AudioTrackClipInputSchema = z.object({
  shotId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  voiceProfileId: z.string().uuid().optional(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  text: z.string().optional(),
});

export const AudioTrackClipSchema = AudioTrackClipInputSchema.extend({
  id: z.string().uuid(),
  sourceFingerprint: z.string().optional(),
});

export const AudioTrackInputSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  kind: AudioTrackKindSchema,
  label: z.string().min(1).max(240),
  clips: z.array(AudioTrackClipInputSchema).min(1),
});

export const AudioTrackSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  kind: AudioTrackKindSchema,
  label: z.string(),
  sourceFingerprint: z.string(),
  clips: z.array(AudioTrackClipSchema),
  status: z.enum(["draft", "adopted"]),
  stale: z.boolean(),
  staleReason: z.string().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const VoiceProfileSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
  sampleAssetId: z.string().uuid().optional(),
  title: z.string().min(1),
  providerVoice: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "adopted"]),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const VoiceProfileInputSchema = VoiceProfileSchema.pick({
  projectId: true,
  characterId: true,
  sampleAssetId: true,
  title: true,
  providerVoice: true,
  description: true,
});

export const AnimaticClipSchema = z.object({
  shotId: z.string().uuid(),
  title: z.string(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  mediaAssetId: z.string().uuid().optional(),
  mediaKind: z.enum(["video", "still", "missing"]),
});

export const AnimaticInitializationSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceFingerprint: z.string().min(1),
  clips: z.array(AnimaticClipSchema),
});

export const AnimaticDraftSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceFingerprint: z.string().min(1),
  clips: z.array(AnimaticClipSchema),
  annotations: z.string(),
  status: z.enum(["draft", "approved", "returned"]),
  reviewNote: z.string().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AnimaticDraftInputSchema = AnimaticDraftSchema.pick({
  projectId: true,
  episodeId: true,
  sourceFingerprint: true,
  clips: true,
}).extend({ annotations: z.string().optional() });

export const AnimaticReviewInputSchema = z.object({
  status: z.enum(["approved", "returned"]),
  reviewNote: z.string().optional(),
  version: z.number().int().nonnegative(),
});

export const EpisodeRenderPreflightSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceFingerprint: z.string(),
  ok: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  animaticId: z.string().uuid().optional(),
  audioTrackIds: z.array(z.string().uuid()),
  durationSeconds: z.number().nonnegative(),
});

export const ImageGenerationInputSchema = z.object({
  providerId: z.string().uuid(),
  projectId: z.string().uuid(),
  shotId: z.string().uuid(),
  kind: z.enum(["still", "first_frame", "last_frame", "cover"]),
  prompt: z.string().min(1).max(20_000),
  negativePrompt: z.string().max(20_000).optional(),
  size: z.string().max(80).optional(),
  quality: z.string().max(80).optional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
});
export const ImageGenerationRunSchema = z.object({
  task: TaskSchema,
  assets: z.array(MediaRecordSchema),
  candidates: z.array(MediaRecordSchema),
});
export const TtsGenerationInputSchema = z.object({
  providerId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  shotId: z.string().uuid().optional(),
  voiceProfileId: z.string().uuid().optional(),
  kind: z.enum(["dialogue", "narration"]),
  input: z.string().min(1).max(100_000),
  voice: z.string().min(1).max(200),
  instructions: z.string().max(10_000).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  responseFormat: z
    .enum(["mp3", "opus", "aac", "flac", "wav", "pcm"])
    .optional(),
});
export const TtsGenerationRunSchema = z.object({
  task: TaskSchema,
  asset: MediaRecordSchema,
});
export const VideoGenerationInputSchema = z.object({
  providerId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(20_000),
  negativePrompt: z.string().max(20_000).optional(),
  seconds: z.number().int().min(1).max(60).optional(),
  size: z.string().max(80).optional(),
  readinessHash: z.string().optional(),
  confirmUnknownCost: z.boolean().optional(),
});
export const VideoGenerationPreflightSchema = z.object({
  shotId: z.string().uuid(),
  providerId: z.string().uuid(),
  snapshotHash: z.string(),
  ready: z.boolean(),
  adoptedStillId: z.string().uuid().optional(),
  lockedAssetIds: z.array(z.string().uuid()),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  costStatus: z.enum(["known", "unknown"]),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.string().optional(),
});
export const VideoGenerationBatchPreflightInputSchema = z.object({
  projectId: z.string().uuid(),
  submissions: z.array(VideoGenerationInputSchema).min(1),
});
export const VideoGenerationBatchPreflightSchema = z.object({
  projectId: z.string().uuid(),
  ready: z.boolean(),
  items: z.array(VideoGenerationPreflightSchema),
  blockers: z.array(z.string()),
  knownEstimatedCost: z.number().nonnegative(),
  unknownCostCount: z.number().int().nonnegative(),
});
export const VideoGenerationJobSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  remoteJobId: z.string(),
  prompt: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
  results: z.array(MediaRecordSchema),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const VideoGenerationRetryInputSchema = z.object({
  providerId: z.string().uuid().optional(),
});

export type MediaRecordKind = z.infer<typeof MediaRecordKindSchema>;
export type MediaRecord = z.infer<typeof MediaRecordSchema>;
export type MediaRecordInput = z.infer<typeof MediaRecordInputSchema>;
export type AssetCenter = z.infer<typeof AssetCenterSchema>;
export type AssetCenterAsset = z.infer<typeof AssetCenterAssetSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;
export type AudioTrackInput = z.infer<typeof AudioTrackInputSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type VoiceProfileInput = z.infer<typeof VoiceProfileInputSchema>;
export type AnimaticClip = z.infer<typeof AnimaticClipSchema>;
export type AnimaticInitialization = z.infer<
  typeof AnimaticInitializationSchema
>;
export type AnimaticDraft = z.infer<typeof AnimaticDraftSchema>;
export type AnimaticDraftInput = z.infer<typeof AnimaticDraftInputSchema>;
export type EpisodeRenderPreflight = z.infer<
  typeof EpisodeRenderPreflightSchema
>;
export type ImageGenerationInput = z.infer<typeof ImageGenerationInputSchema>;
export type TtsGenerationInput = z.infer<typeof TtsGenerationInputSchema>;
export type VideoGenerationInput = z.infer<typeof VideoGenerationInputSchema>;
export type VideoGenerationPreflight = z.infer<
  typeof VideoGenerationPreflightSchema
>;
export type VideoGenerationJob = z.infer<typeof VideoGenerationJobSchema>;

export const MEDIA_RECORD_SERVICE = "media.records.v1" as const;
export const MEDIA_AUDIO_TRACK_SERVICE = "media.audio-tracks.v1" as const;

export interface MediaRecordService {
  create(kind: MediaRecordKind, input: MediaRecordInput): MediaRecord;
  list(
    kind: MediaRecordKind,
    filter: { projectId?: string; parentId?: string },
  ): readonly MediaRecord[];
  get(id: string): MediaRecord | undefined;
  update(
    id: string,
    patch: {
      title?: string;
      payload?: Record<string, unknown>;
      version: number;
    },
  ): MediaRecord | "conflict" | undefined;
  remove(id: string, expectedVersion?: number): boolean;
}

export interface MediaAudioTrackService {
  list(episodeId: string): readonly AudioTrack[];
  create(input: AudioTrackInput): AudioTrack;
  adopt(id: string): AudioTrack | undefined;
}
