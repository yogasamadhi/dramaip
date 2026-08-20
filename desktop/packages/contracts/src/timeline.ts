import { z } from "zod";

export const TimelineTrackKindSchema = z.enum([
  "video",
  "dialogue",
  "narration",
  "bgm",
  "sfx",
  "subtitle",
]);

export const TimelineClipSchema = z.object({
  id: z.string().uuid(),
  sourceClipId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  audioTrackId: z.string().uuid().optional(),
  name: z.string(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  sourceOffsetSeconds: z.number().nonnegative(),
  mediaStatus: z.enum([
    "linked",
    "missing",
    "unsupported",
    "proxy",
    "unattached",
  ]),
  text: z.string().optional(),
  volume: z.number().optional(),
  fadeInSeconds: z.number().optional(),
  fadeOutSeconds: z.number().optional(),
  duckingGain: z.number().optional(),
  locked: z.boolean().optional(),
  manuallyEdited: z.boolean(),
});

export const TimelineTrackSchema = z.object({
  id: z.string().uuid(),
  kind: TimelineTrackKindSchema,
  label: z.string(),
  muted: z.boolean(),
  solo: z.boolean(),
  clips: z.array(TimelineClipSchema),
});

export const TimelineManifestSchema = z.object({
  format: z.literal("dramaip-timeline"),
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceFingerprint: z.string(),
  frameRate: z.literal(25),
  timebase: z.literal("seconds"),
  durationSeconds: z.number().positive(),
  tracks: z.array(TimelineTrackSchema),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TimelineEditCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    clipId: z.string().uuid(),
    startSeconds: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("trim"),
    clipId: z.string().uuid(),
    startSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().positive(),
  }),
  z.object({
    type: z.literal("split"),
    clipId: z.string().uuid(),
    atSeconds: z.number().positive(),
  }),
  z.object({
    type: z.literal("set-track-audio"),
    trackId: z.string().uuid(),
    muted: z.boolean().optional(),
    solo: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("relink"),
    clipId: z.string().uuid(),
    assetId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("set-clip-audio"),
    clipId: z.string().uuid(),
    volume: z.number().min(0).max(2).optional(),
    locked: z.boolean().optional(),
  }),
]);

export const TimelineCommandInputSchema = z.object({
  version: z.number().int().nonnegative(),
  command: TimelineEditCommandSchema,
});

export const TimelineHistoryAvailabilitySchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

export const TimelineDeliveryManifestSchema = z.object({
  format: z.literal("dramaip-timeline-delivery"),
  schemaVersion: z.literal(1),
  timeline: TimelineManifestSchema,
  media: z.array(
    z.object({
      assetId: z.string().uuid(),
      title: z.string(),
      sourceVersion: z.number().int().nonnegative(),
      relativePath: z.string(),
      checksum: z.string().optional(),
      mediaStatus: TimelineClipSchema.shape.mediaStatus,
      rightsStatus: z.enum(["cleared", "unknown", "restricted"]),
      lineage: z.array(z.string()),
    }),
  ),
  unsupportedFeatures: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const AudioAssemblyClipSchema = z.object({
  id: z.string().uuid(),
  audioTrackId: z.string().uuid(),
  sourceClipId: z.string().uuid(),
  kind: z.enum(["dialogue", "narration", "bgm", "sfx"]),
  name: z.string(),
  shotId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  voiceProfileId: z.string().uuid().optional(),
  text: z.string().optional(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  volume: z.number(),
  fadeInSeconds: z.number(),
  fadeOutSeconds: z.number(),
  duckingGain: z.number().optional(),
  overflowSeconds: z.number().nonnegative(),
  provider: z.string(),
  cost: z.number().optional(),
  rightsStatus: z.enum(["cleared", "unknown", "restricted"]),
});

export const SubtitleCueSchema = z.object({
  id: z.string().uuid(),
  audioTrackId: z.string().uuid(),
  sourceClipId: z.string().uuid(),
  shotId: z.string().uuid().optional(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  text: z.string(),
});

export const AudioAssemblyPreviewSchema = z.object({
  timelineId: z.string().uuid(),
  timelineVersion: z.number().int().nonnegative(),
  sourceFingerprint: z.string(),
  clips: z.array(AudioAssemblyClipSchema),
  subtitleCues: z.array(SubtitleCueSchema),
  srt: z.string(),
  webVtt: z.string(),
  warnings: z.array(z.string()),
  protectedClipIds: z.array(z.string().uuid()),
  staleTrackIds: z.array(z.string().uuid()),
});

export const AudioAssemblyApplyInputSchema = z.object({
  timelineVersion: z.number().int().nonnegative(),
  audioTrackIds: z.array(z.string().uuid()),
  includeSubtitles: z.boolean(),
});

export const ExportDocumentSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

export const TimelineMediaPreviewSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "audio", "video"]),
  dataUrl: z.string().startsWith("data:"),
});

export type TimelineManifest = z.infer<typeof TimelineManifestSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type TimelineEditCommand = z.infer<typeof TimelineEditCommandSchema>;
export type AudioAssemblyPreview = z.infer<typeof AudioAssemblyPreviewSchema>;

export const TIMELINE_SERVICE = "timeline.canonical.v1" as const;

export interface TimelineService {
  get(episodeId: string): TimelineManifest | undefined;
}
