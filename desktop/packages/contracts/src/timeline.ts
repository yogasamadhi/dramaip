import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { AudioTrackSchema } from "./media.js";

export const TimelineTrackKindSchema = z.enum([
  "video",
  "dialogue",
  "narration",
  "bgm",
  "sfx",
  "subtitle",
]);

export const FrameRateSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
  dropFrame: z.boolean(),
});

export const TimelineProfileSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: FrameRateSchema,
  audioSampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
});

export const TimelineClipSchema = z.object({
  id: z.string().uuid(),
  sourceClipId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  /** Set only by an explicit owner-validated relink; absent historical links are unverified. */
  assetVersion: z.number().int().nonnegative().optional(),
  audioTrackId: z.string().uuid().optional(),
  audioTrackVersion: z.number().int().nonnegative().optional(),
  audioSourceFingerprint: z.string().optional(),
  mediaRef: z.string().min(1).optional(),
  trackId: z.string().uuid(),
  name: z.string(),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  sourceOffsetFrame: z.number().int().nonnegative(),
  mediaStatus: z.enum([
    "linked",
    "missing",
    "unsupported",
    "proxy",
    "unattached",
  ]),
  text: z.string().optional(),
  volume: z.number().optional(),
  fadeInFrames: z.number().int().nonnegative().optional(),
  fadeOutFrames: z.number().int().nonnegative().optional(),
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
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceFingerprint: z.string(),
  profile: TimelineProfileSchema,
  timebase: z.literal("frames"),
  durationFrames: z.number().int().positive(),
  migrationWarnings: z.array(z.string()),
  tracks: z.array(TimelineTrackSchema),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AudioResolutionChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("remove"),
      clipId: z.string().uuid(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("replace"),
      clipId: z.string().uuid(),
      audioTrackId: z.string().uuid(),
      sourceClipId: z.string().uuid(),
      subtitleText: z.enum(["keep", "replacement"]),
    })
    .strict(),
]);
export const AudioResolutionInputSchema = z
  .object({
    timelineVersion: z.number().int().nonnegative(),
    changes: z.array(AudioResolutionChangeSchema).min(1).max(500),
  })
  .strict();
export const AudioResolutionConfirmationSchema = z
  .object({
    differencesReviewed: z.literal(true),
    protectedEditsReviewed: z.literal(true),
    authorIntentAndRightsReviewed: z.literal(true),
  })
  .strict();
const AudioResolutionTargetSchema = z.object({
  track: AudioTrackSchema,
  sourceClipId: z.string().uuid(),
  lineageReviewIds: z.array(z.string().uuid()),
  availableFrames: z.number().int().positive(),
});
export const AudioResolutionOptionsSchema = z.object({
  timelineId: z.string().uuid(),
  timelineVersion: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      clip: TimelineClipSchema,
      kind: TimelineTrackKindSchema,
      sourceTrack: AudioTrackSchema.optional(),
      sourceState: z.enum(["current", "stale", "unverified"]),
      reasons: z.array(z.string()),
      replacements: z.array(AudioResolutionTargetSchema),
    }),
  ),
});
export const AudioResolutionSchema = z.object({
  id: z.string().uuid(),
  timelineId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  state: z.enum(["pending", "confirmed", "discarded"]),
  stateVersion: z.number().int().nonnegative(),
  sourceState: z.enum(["current", "stale"]),
  reasons: z.array(z.string()),
  isCurrent: z.boolean(),
  before: TimelineManifestSchema,
  after: TimelineManifestSchema,
  changes: z.array(
    z.object({
      input: AudioResolutionChangeSchema,
      kind: TimelineTrackKindSchema,
      before: TimelineClipSchema,
      after: TimelineClipSchema.optional(),
      target: AudioResolutionTargetSchema.optional(),
      originalSource: AudioTrackSchema.optional(),
    }),
  ),
  warnings: z.array(z.string()),
  confirmation: AudioResolutionConfirmationSchema.extend({
    confirmedAt: z.string().datetime(),
  }).optional(),
  resultTimelineVersion: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const AudioResolutionPageSchema = z.object({
  items: z.array(AudioResolutionSchema),
  nextCursor: z.string().optional(),
});
export type AudioResolutionInput = z.infer<typeof AudioResolutionInputSchema>;
export type AudioResolutionConfirmation = z.infer<
  typeof AudioResolutionConfirmationSchema
>;
export type AudioResolutionOptions = z.infer<
  typeof AudioResolutionOptionsSchema
>;
export type AudioResolution = z.infer<typeof AudioResolutionSchema>;
export type AudioResolutionPage = z.infer<typeof AudioResolutionPageSchema>;
export const AudioResolutionSummarySchema = AudioResolutionSchema.pick({
  id: true,
  timelineId: true,
  projectId: true,
  episodeId: true,
  state: true,
  stateVersion: true,
  sourceState: true,
  isCurrent: true,
  resultTimelineVersion: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    timelineVersion: z.number().int().nonnegative(),
    changeCount: z.number().int().nonnegative(),
    replaceCount: z.number().int().nonnegative(),
    removeCount: z.number().int().nonnegative(),
    protectedCount: z.number().int().nonnegative(),
    reasonCount: z.number().int().nonnegative(),
  })
  .strict();
export const AudioResolutionSummaryPageSchema = z.object({
  items: z.array(AudioResolutionSummarySchema),
  nextCursor: z.string().optional(),
});
export type AudioResolutionSummary = z.infer<
  typeof AudioResolutionSummarySchema
>;
export type AudioResolutionSummaryPage = z.infer<
  typeof AudioResolutionSummaryPageSchema
>;

export const TimelineEditCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    clipId: z.string().uuid(),
    startFrame: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("trim"),
    clipId: z.string().uuid(),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("split"),
    clipId: z.string().uuid(),
    atFrame: z.number().int().positive(),
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

/** Read-only source proof. No physical paths, playback URLs, byte or quality claims. */
export const TimelinePlaybackPlanSchema = z
  .object({
    timeline: TimelineManifestSchema,
    bindings: z.array(
      z
        .object({
          clipId: z.string().uuid(),
          assetId: z.string().uuid(),
          assetVersion: z.number().int().nonnegative(),
          expectedKind: z.enum(["visual", "audio"]),
          sourceProof: z.enum([
            "timeline-asset-version",
            "audio-source-version",
          ]),
        })
        .strict(),
    ),
    blockers: z.array(
      z
        .object({
          clipId: z.string().uuid(),
          code: z.enum(["MISSING_MEDIA", "UNVERIFIED_SOURCE", "STALE_SOURCE"]),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type TimelinePlaybackPlan = z.infer<typeof TimelinePlaybackPlanSchema>;

export const TimelineDeliveryMediaSchema = z
  .object({
    assetId: z.string().uuid(),
    title: z.string(),
    clipIds: z.array(z.string().uuid()),
    expectedVersions: z.array(z.number().int().nonnegative()),
    /** Only a proven frozen source, never the latest record version. */
    sourceVersion: z.number().int().nonnegative().optional(),
    sourceStatus: z.enum([
      "current",
      "unverified",
      "stale",
      "missing",
      "foreign",
    ]),
    relativePath: z
      .string()
      .regex(/^media\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,12})?$/u),
    /** Owner metadata only; this is not a complete-byte verification receipt. */
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    archive: z
      .object({
        artifactRef: z.string().uuid(),
        kind: z.enum(["image", "audio", "video"]),
        mimeType: z.string().min(1).max(200),
        extension: z.string().regex(/^\.[a-z0-9]{1,12}$/u),
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        verification: z.literal("owner-metadata-only"),
      })
      .strict()
      .optional(),
    mediaStatus: z.literal("unattached"),
    rightsStatus: z.enum(["unknown", "restricted"]),
    rightsDeclaration: z.enum([
      "not-provided",
      "user-reported-cleared",
      "user-reported-restricted",
    ]),
    lineage: z.array(z.string()),
  })
  .strict();

export const TimelineDeliveryManifestSchema = z
  .object({
    format: z.literal("dramaip-timeline-delivery"),
    schemaVersion: z.literal(3),
    timeline: TimelineManifestSchema,
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    media: z.array(TimelineDeliveryMediaSchema),
    sourceBlockers: TimelinePlaybackPlanSchema.shape.blockers,
    unsupportedFeatures: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();
export type TimelineDeliveryManifest = z.infer<
  typeof TimelineDeliveryManifestSchema
>;

export const TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION =
  "1080x1920-25-48000-stereo-subtitles-v1";
export const TimelineRendererFontRefSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
      ),
    packVersion: z
      .string()
      .max(120)
      .regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export const TimelineRendererFontDescriptorSchema =
  TimelineRendererFontRefSchema.extend({
    label: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => Boolean(value.trim())),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    license: z
      .string()
      .min(1)
      .max(2000)
      .refine((value) => Boolean(value.trim())),
    sourceUrl: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }),
  }).strict();
export const TimelineRenderSubtitlePolicySchema = z.discriminatedUnion("mode", [
  z.object({ version: z.literal(1), mode: z.literal("omit") }).strict(),
  z
    .object({
      version: z.literal(1),
      mode: z.literal("burn-in"),
      font: TimelineRendererFontRefSchema,
    })
    .strict(),
]);
export type TimelineRenderSubtitlePolicy = z.infer<
  typeof TimelineRenderSubtitlePolicySchema
>;
export const TimelineRenderPreflightQuerySchema = z
  .object({
    subtitleMode: z.enum(["omit", "burn-in"]).optional(),
    fontId: TimelineRendererFontRefSchema.shape.id.optional(),
    fontPackVersion: TimelineRendererFontRefSchema.shape.packVersion.optional(),
    fontSha256: TimelineRendererFontRefSchema.shape.sha256.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const count = [
      value.fontId,
      value.fontPackVersion,
      value.fontSha256,
    ].filter((item) => item !== undefined).length;
    if (value.subtitleMode === "burn-in" ? count !== 3 : count !== 0)
      ctx.addIssue({
        code: "custom",
        message: "烧录须提供完整原字体身份；omit／旧absence不能携带字体。",
      });
  });

export const TimelineRenderPreflightSchema = z.object({
  timelineId: z.string().uuid(),
  timelineVersion: z.number().int().nonnegative(),
  timelineEtag: z.string().min(1),
  profileVersion: z.string().min(1),
  ready: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  rendererVersion: z.string().optional(),
  sidecarArtifactVersion: z.string().optional(),
  subtitlePolicy: TimelineRenderSubtitlePolicySchema.optional(),
  subtitleBurnInAvailable: z.boolean().optional(),
  subtitleFonts: z
    .array(TimelineRendererFontDescriptorSchema)
    .max(16)
    .optional(),
  sourceFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

export const TimelineRenderCreateInputSchema = z
  .object({
    timelineProfileVersion: z.string().min(1).max(120),
    rendererVersion: z.string().min(1).max(120),
    sidecarArtifactVersion: z.string().min(1).max(120),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    subtitlePolicy: TimelineRenderSubtitlePolicySchema.optional(),
  })
  .strict();

export const TimelineRenderJobSchema = z.object({
  jobId: z.string().uuid(),
  timelineId: z.string().uuid(),
  timelineVersion: z.number().int().nonnegative(),
  timelineProfileVersion: z.string(),
  rendererVersion: z.string(),
  sidecarArtifactVersion: z.string(),
  subtitlePolicy: TimelineRenderSubtitlePolicySchema.optional(),
  sourceFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "canceled",
    "interrupted",
  ]),
  progress: z.number().min(0).max(1),
  outputMediaRef: z.string().uuid().optional(),
  outputSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  requestFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  outputRecord: z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      version: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
  failureCode: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TimelineRenderCatalogQuerySchema = z
  .object({
    projectId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z
      .string()
      .min(1)
      .max(2000)
      .regex(/^[\w-]+$/u)
      .optional(),
    requestFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict();
export const TimelineRenderCatalogSchema = z
  .object({
    projectId: z.string().uuid(),
    episodeId: z.string().uuid(),
    timeline: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().nonnegative(),
        etag: z.string().min(1),
      })
      .strict()
      .optional(),
    items: z.array(TimelineRenderJobSchema.strict()),
    nextCursor: z.string().optional(),
  })
  .strict();
export type TimelineRenderCatalog = z.infer<typeof TimelineRenderCatalogSchema>;

export const AudioAssemblyClipSchema = z.object({
  id: z.string().uuid(),
  audioTrackId: z.string().uuid(),
  audioTrackVersion: z.number().int().nonnegative(),
  audioSourceFingerprint: z.string(),
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
  audioTrackVersion: z.number().int().nonnegative(),
  audioSourceFingerprint: z.string(),
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
  timelineId: z.string().uuid(),
  timelineVersion: z.number().int().nonnegative(),
  sourceFingerprint: z.string().min(1),
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
export type FrameRate = z.infer<typeof FrameRateSchema>;
export type TimelineProfile = z.infer<typeof TimelineProfileSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type TimelineEditCommand = z.infer<typeof TimelineEditCommandSchema>;
export type TimelineRenderJob = z.infer<typeof TimelineRenderJobSchema>;
export type TimelineRenderCreateInput = z.infer<
  typeof TimelineRenderCreateInputSchema
>;
export type AudioAssemblyPreview = z.infer<typeof AudioAssemblyPreviewSchema>;
export type AudioAssemblyApplyInput = z.infer<
  typeof AudioAssemblyApplyInputSchema
>;
export type TimelineRenderPreflight = z.infer<
  typeof TimelineRenderPreflightSchema
>;

export const TIMELINE_SERVICE = defineServiceContract<TimelineService>({
  id: "timeline.canonical.v1",
  owner: "timeline",
  major: 1,
  capabilities: ["read", "write", "export"],
  degradable: true,
});

export interface TimelineService {
  get(episodeId: string): TimelineManifest | undefined;
  peek?(episodeId: string): TimelineManifest | undefined;
  deliveryManifest?(episodeId: string): TimelineDeliveryManifest | undefined;
  export?(
    episodeId: string,
    format: "manifest" | "fcpxml" | "otio" | "edl" | "srt" | "vtt" | "relink",
  ): z.infer<typeof ExportDocumentSchema> | undefined;
}
