import { z } from "zod";
import type { JsonValue } from "./index.js";
import { TaskSchema } from "./automation.js";
import { defineServiceContract } from "./service-contract.js";

export const LikenessRelationshipSchema = z.enum([
  "self",
  "adult_relative_or_friend",
  "minor",
]);
export const LikenessAgeBandSchema = z.enum([
  "adult",
  "minor_14_to_17",
  "under_14",
]);
export const LikenessConsentStatusSchema = z.enum([
  "missing",
  "active",
  "revoked",
  "expired",
]);
export const LikenessSubjectSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  displayName: z.string().min(1).max(160),
  relationship: LikenessRelationshipSchema,
  ageBand: LikenessAgeBandSchema,
  consentStatus: LikenessConsentStatusSchema,
  contentRestrictions: z.string().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const LikenessSubjectInputSchema = z.object({
  projectId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(160),
  relationship: LikenessRelationshipSchema,
  ageBand: LikenessAgeBandSchema,
  contentRestrictions: z.string().trim().max(2_000).optional(),
});
export const LikenessConsentInputSchema = z.object({
  purposeScopes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  validUntil: z.string().datetime(),
  /** Self/adult acknowledgement; no signed-document body is persisted. */
  participantConfirmed: z.boolean(),
  /** Mandatory for every minor. */
  guardianConfirmed: z.boolean().optional(),
  /** Mandatory where the person is under 14. */
  under14SeparateConsentConfirmed: z.boolean().optional(),
});
export const LikenessPhotoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  mediaRef: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mimeType: z.literal("image/png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().positive(),
  status: z.enum(["active", "removed"]),
  createdAt: z.string().datetime(),
  removedAt: z.string().datetime().optional(),
});
export const LikenessPhotoAttachInputSchema = z.object({
  grantId: z.string().uuid(),
});
export const LikenessReferencePreflightInputSchema = z.object({
  subjectIds: z.array(z.string().uuid()).min(1).max(12),
  confirmed: z.literal(true),
});
export const LikenessReferencePreflightSchema = z.object({
  ok: z.boolean(),
  subjectIds: z.array(z.string().uuid()),
  mediaRefs: z.array(z.string().uuid()),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type LikenessSubject = z.infer<typeof LikenessSubjectSchema>;
export type LikenessPhoto = z.infer<typeof LikenessPhotoSchema>;
export type LikenessReferencePreflight = z.infer<
  typeof LikenessReferencePreflightSchema
>;

export const MEDIA_LIKENESS_SERVICE =
  defineServiceContract<MediaLikenessService>({
    id: "media.likeness.v1",
    owner: "media",
    major: 1,
    capabilities: ["read", "write", "revoke"],
    degradable: true,
  });
export interface MediaLikenessService {
  getSubject(id: string): LikenessSubject | undefined;
  listSubjects(projectId: string): readonly LikenessSubject[];
  preflight(
    input: z.infer<typeof LikenessReferencePreflightInputSchema>,
  ): z.infer<typeof LikenessReferencePreflightSchema>;
}

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

/** Stored owner metadata only; actual bytes are verified separately on every explicit load. */
export const MEDIA_PLAYBACK_MAX_BYTES = 128 * 1024 * 1024;
export const MediaPlaybackDescriptorSchema = z
  .object({
    recordId: z.string().uuid(),
    projectId: z.string().uuid(),
    recordVersion: z.number().int().nonnegative(),
    kind: z.enum(["image", "audio", "video"]),
    mimeType: z.string().min(1).max(80),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    origin: z.enum(["embedded", "managed-archive"]),
    artifactRef: z.string().uuid().optional(),
    verification: z.literal("owner-metadata-only"),
  })
  .strict();
export type MediaPlaybackDescriptor = z.infer<
  typeof MediaPlaybackDescriptorSchema
>;

/** A durable observation of one complete read, never ongoing file integrity. */
export const MediaByteVerificationInputSchema = z
  .object({
    descriptor: MediaPlaybackDescriptorSchema,
  })
  .strict();
export const MediaByteVerificationSchema = z
  .object({
    id: z.string().uuid(),
    version: z.literal(0),
    requestKey: z.string().uuid(),
    descriptor: MediaPlaybackDescriptorSchema,
    verifiedAt: z.string().datetime(),
    evidence: z.literal("complete-byte-read-at-recorded-time"),
    qualityState: z.literal("unverified"),
    rightsState: z.literal("unverified"),
    currentBinding: z.enum([
      "unchanged-metadata",
      "changed-metadata",
      "unavailable",
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      Boolean(value.descriptor.artifactRef) !==
      (value.descriptor.origin === "managed-archive")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A read receipt preserves its exact origin and opaque archive identity.",
      });
  });
export const MediaByteVerificationPageSchema = z
  .object({
    recordId: z.string().uuid(),
    projectId: z.string().uuid(),
    recordVersion: z.number().int().nonnegative(),
    items: z.array(MediaByteVerificationSchema).max(100),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type MediaByteVerification = z.infer<typeof MediaByteVerificationSchema>;
export type MediaByteVerificationPage = z.infer<
  typeof MediaByteVerificationPageSchema
>;

/** Owner-verified, mechanical lineage only; never a quality or rights score. */
export const MediaSourceBindingSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
  shotId: z.string().uuid(),
  shotVersion: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  version: z.number().int().positive(),
  origin: z.enum(["generation", "manual-record", "human-review"]),
  createdAt: z.string().datetime(),
});
export const MediaSourceStatusSchema = z.object({
  recordId: z.string().uuid(),
  recordVersion: z.number().int().nonnegative(),
  state: z.enum(["current", "stale", "unverified", "unbound"]),
  verification: z.literal("actual-record-version-only"),
  binding: MediaSourceBindingSchema.optional(),
  actualShotVersion: z.number().int().nonnegative().optional(),
  reasons: z.array(z.string()),
});
export const MediaSourceReviewInputSchema = z.object({
  recordVersion: z.number().int().nonnegative(),
  shotId: z.string().uuid(),
  shotVersion: z.number().int().nonnegative(),
});
export const MediaSourceReviewConfirmationSchema = z.object({
  mediaReviewed: z.literal(true),
  shotMappingReviewed: z.literal(true),
  authorIntentReviewed: z.literal(true),
});
export const MediaSourceReviewSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
  projectId: z.string().uuid(),
  recordVersion: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  previousBinding: MediaSourceBindingSchema.optional(),
  adoptedBindingId: z.string().uuid().optional(),
  shotId: z.string().uuid(),
  shotVersion: z.number().int().nonnegative(),
  sourceFingerprint: z.string(),
  state: z.enum(["pending", "adopted", "discarded"]),
  stateVersion: z.number().int().nonnegative(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MediaSourceBinding = z.infer<typeof MediaSourceBindingSchema>;
export type MediaSourceStatus = z.infer<typeof MediaSourceStatusSchema>;
export type MediaSourceReview = z.infer<typeof MediaSourceReviewSchema>;
export type MediaSourceReviewInput = z.infer<
  typeof MediaSourceReviewInputSchema
>;
export type MediaSourceReviewConfirmation = z.infer<
  typeof MediaSourceReviewConfirmationSchema
>;
export const MediaSourceReviewPageSchema = z.object({
  items: z.array(MediaSourceReviewSchema),
  nextCursor: z.string().optional(),
});
export type MediaSourceReviewPage = z.infer<typeof MediaSourceReviewPageSchema>;
// Deliberate allow-list: no media payload, title, content hash, reasons or consent.
export const MediaSourceReviewSummarySchema = MediaSourceReviewSchema.pick({
  id: true,
  recordId: true,
  projectId: true,
  recordVersion: true,
  shotId: true,
  shotVersion: true,
  state: true,
  stateVersion: true,
  sourceState: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({ reasonCount: z.number().int().nonnegative() })
  .strict();
export const MediaSourceReviewSummaryPageSchema = z.object({
  items: z.array(MediaSourceReviewSummarySchema),
  nextCursor: z.string().optional(),
});
export type MediaSourceReviewSummary = z.infer<
  typeof MediaSourceReviewSummarySchema
>;
export type MediaSourceReviewSummaryPage = z.infer<
  typeof MediaSourceReviewSummaryPageSchema
>;

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
  // Editable media payloads are declarations, never verification or settlement receipts.
  rightsStatus: z.enum(["restricted", "unknown"]),
  costStatus: z.literal("unknown"),
  providerStatus: z.enum(["unavailable", "unknown"]),
  rightsDeclaration: z.enum([
    "user-reported-cleared",
    "user-reported-restricted",
    "not-provided",
  ]),
  costDeclaration: z.enum(["user-reported-known", "not-provided"]),
  providerDeclaration: z.enum([
    "user-reported-available",
    "user-reported-unavailable",
    "user-reported-not-required",
    "not-provided",
  ]),
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
  sourceVersions: z
    .array(
      z.object({
        kind: z.enum([
          "shot",
          "asset",
          "voice-profile",
          "voice-sample",
          "voice-character",
        ]),
        id: z.string().uuid(),
        version: z.number().int().nonnegative(),
      }),
    )
    .optional(),
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
  sourceState: z.enum(["current", "stale", "unverified"]),
  sourceReasons: z.array(z.string()),
  revision: z
    .object({
      reviewId: z.string().uuid(),
      sourceTrackId: z.string().uuid(),
      sourceVersion: z.number().int().nonnegative(),
      clipLinks: z.array(
        z.object({
          previousClipId: z.string().uuid(),
          nextClipId: z.string().uuid(),
        }),
      ),
    })
    .optional(),
  supersededBy: z.string().uuid().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AudioRevisionInputSchema = z.object({
  sourceVersion: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(240),
  kind: AudioTrackKindSchema,
  clips: z
    .array(
      AudioTrackClipInputSchema.extend({
        previousClipId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export const AudioRevisionConfirmationSchema = z.object({
  contentReviewed: z.literal(true),
  mappingsReviewed: z.literal(true),
  authorIntentAndRightsReviewed: z.literal(true),
});
export const AudioRevisionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  sourceTrackId: z.string().uuid(),
  original: AudioTrackSchema,
  candidate: AudioTrackSchema,
  clipLinks: z.array(
    z.object({
      previousClipId: z.string().uuid(),
      nextClipId: z.string().uuid(),
    }),
  ),
  removedClipIds: z.array(z.string().uuid()),
  addedClipIds: z.array(z.string().uuid()),
  state: z.enum(["pending", "confirmed", "discarded"]),
  stateVersion: z.number().int().nonnegative(),
  sourceState: z.enum(["current", "stale"]),
  reasons: z.array(z.string()),
  isCurrent: z.boolean(),
  targetTrackId: z.string().uuid().optional(),
  confirmation: AudioRevisionConfirmationSchema.extend({
    confirmedAt: z.string().datetime(),
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const AudioRevisionPageSchema = z.object({
  items: z.array(AudioRevisionSchema),
  nextCursor: z.string().optional(),
});
export type AudioRevisionInput = z.infer<typeof AudioRevisionInputSchema>;
export type AudioRevision = z.infer<typeof AudioRevisionSchema>;
export type AudioRevisionConfirmation = z.infer<
  typeof AudioRevisionConfirmationSchema
>;
export type AudioRevisionPage = z.infer<typeof AudioRevisionPageSchema>;
export const AudioRevisionSummarySchema = AudioRevisionSchema.pick({
  id: true,
  projectId: true,
  episodeId: true,
  sourceTrackId: true,
  state: true,
  stateVersion: true,
  sourceState: true,
  isCurrent: true,
  targetTrackId: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    originalVersion: z.number().int().nonnegative(),
    candidateId: z.string().uuid(),
    candidateClipCount: z.number().int().nonnegative(),
    mappedCount: z.number().int().nonnegative(),
    removedCount: z.number().int().nonnegative(),
    addedCount: z.number().int().nonnegative(),
    reasonCount: z.number().int().nonnegative(),
    targetStatus: z.enum(["draft", "adopted", "missing"]).optional(),
    targetVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export const AudioRevisionSummaryPageSchema = z.object({
  items: z.array(AudioRevisionSummarySchema),
  nextCursor: z.string().optional(),
});
export type AudioRevisionSummary = z.infer<typeof AudioRevisionSummarySchema>;
export type AudioRevisionSummaryPage = z.infer<
  typeof AudioRevisionSummaryPageSchema
>;

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
  referenceSubjectIds: z.array(z.string().uuid()).min(1).max(12).optional(),
  portraitPreflightConfirmed: z.literal(true).optional(),
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
  providerKind: z.enum(["seedance", "minimax_h3_cloud"]).optional(),
  providerCapabilities: z
    .object({
      cancellation: z.enum(["unsupported", "queued_only", "supported"]),
      nativeAudio: z.boolean(),
      durationSeconds: z.union([
        z.array(z.number().int().positive()),
        z.object({
          minimum: z.number().int().positive(),
          maximum: z.number().int().positive(),
        }),
      ]),
      resolutions: z.array(z.string()),
      aspectRatios: z.array(z.string()),
    })
    .optional(),
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
  knownEstimatedCost: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Deprecated legacy sum; current Runtime never combines configured unit estimates.",
    ),
  aggregationStatus: z.literal("not-aggregated").optional(),
  unknownCostCount: z.number().int().nonnegative(),
});
export const VideoGenerationJobSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  providerKind: z.enum(["seedance", "minimax_h3_cloud"]).optional(),
  modelRevision: z.string().optional(),
  remoteJobId: z.string(),
  prompt: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
  remoteStatus: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "canceled",
  ]),
  archiveStatus: z.enum([
    "not_started",
    "pending",
    "archived",
    "failed",
    "unavailable",
  ]),
  results: z.array(MediaRecordSchema),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const VideoGenerationRetryInputSchema = z.object({
  providerId: z.string().uuid().optional(),
});

export const MediaArtifactDescriptorSchema = z.object({
  artifactId: z.string().uuid(),
  mediaRef: z.string().uuid(),
  kind: z.enum(["image", "audio", "video", "subtitle", "project-package"]),
  mimeType: z.string().min(1).max(200),
  extension: z.string().regex(/^\.[a-z0-9]{1,12}$/u),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationFrames: z.number().int().positive().optional(),
  frameRate: z
    .object({
      numerator: z.number().int().positive(),
      denominator: z.number().int().positive(),
      dropFrame: z.boolean(),
    })
    .optional(),
  status: z.enum(["archived", "quarantined", "removed"]),
});

export type MediaRecordKind = z.infer<typeof MediaRecordKindSchema>;

/** Editable declarations never establish authorization, bills or provider capability. Negative aliases win. */
export function mediaDeclarationStatus(
  payload: Record<string, unknown>,
  kind?: MediaRecordKind,
) {
  const rights = [
    payload["权利状态"],
    payload.rightsStatus,
    ...(kind === "rights" ? [payload.status] : []),
  ];
  const restricted = rights.some(
    (value) =>
      typeof value === "string" &&
      ["受限", "已撤回", "已过期", "restricted", "revoked", "expired"].includes(
        value.trim().toLowerCase(),
      ),
  );
  return {
    rightsStatus: restricted ? ("restricted" as const) : ("unknown" as const),
    rightsDeclaration: restricted
      ? ("user-reported-restricted" as const)
      : rights.some((value) => value === "已核验" || value === "cleared")
        ? ("user-reported-cleared" as const)
        : ("not-provided" as const),
    costStatus: "unknown" as const,
    costDeclaration:
      payload["费用状态"] === "已知" || payload.costStatus === "known"
        ? ("user-reported-known" as const)
        : ("not-provided" as const),
    providerStatus:
      payload["服务状态"] === "不可用" ||
      payload.providerStatus === "unavailable"
        ? ("unavailable" as const)
        : ("unknown" as const),
    providerDeclaration:
      payload["服务状态"] === "不可用" ||
      payload.providerStatus === "unavailable"
        ? ("user-reported-unavailable" as const)
        : payload["服务状态"] === "可用" ||
            payload.providerStatus === "available"
          ? ("user-reported-available" as const)
          : payload["服务状态"] === "无需服务"
            ? ("user-reported-not-required" as const)
            : ("not-provided" as const),
  };
}

export const MediaDeliveryEvidenceQuerySchema = z
  .object({
    projectId: z.string().uuid(),
    recordVersion: z.coerce.number().int().nonnegative(),
  })
  .strict();
/** One exact record's owner metadata, not a whole delivery, legal review or ongoing byte proof. */
export const MediaDeliveryEvidenceSchema = z
  .object({
    recordId: z.string().uuid(),
    projectId: z.string().uuid(),
    recordVersion: z.number().int().nonnegative(),
    kind: MediaRecordKindSchema,
    scope: z.literal("exact-media-record-metadata"),
    releaseReady: z.literal(false),
    qualityState: z.literal("unverified"),
    settlementState: z.literal("unknown"),
    currentFileIntegrity: z.literal("not-read"),
    declarations: AssetCenterAssetSchema.pick({
      rightsStatus: true,
      rightsDeclaration: true,
      costStatus: true,
      costDeclaration: true,
      providerStatus: true,
      providerDeclaration: true,
    }).strict(),
    source: MediaSourceStatusSchema.strict(),
    archive: MediaArtifactDescriptorSchema.strict().optional(),
    latestByteRead: z
      .object({
        id: z.string().uuid(),
        verifiedAt: z.string().datetime(),
        descriptor: MediaPlaybackDescriptorSchema,
        evidence: z.literal("complete-byte-read-at-recorded-time"),
        currentArchiveBinding: z.enum([
          "matching-archive-metadata",
          "changed-archive-metadata",
          "not-rechecked",
        ]),
      })
      .strict()
      .optional(),
    blockers: z.array(
      z.enum([
        "DECLARED_RIGHTS_RESTRICTED",
        "DECLARED_PROVIDER_UNAVAILABLE",
        "SOURCE_STALE",
        "SOURCE_UNVERIFIED",
        "ARCHIVE_UNAVAILABLE",
      ]),
    ),
    unknowns: z.tuple([
      z.literal("CONTENT_QUALITY_UNVERIFIED"),
      z.literal("LEGAL_RIGHTS_UNVERIFIED"),
      z.literal("SETTLEMENT_UNKNOWN"),
      z.literal("CURRENT_FILE_NOT_READ"),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.source.recordId !== value.recordId ||
      value.source.recordVersion !== value.recordVersion ||
      (value.archive && value.archive.status !== "archived") ||
      (value.latestByteRead &&
        (value.latestByteRead.descriptor.recordId !== value.recordId ||
          value.latestByteRead.descriptor.projectId !== value.projectId ||
          value.latestByteRead.descriptor.recordVersion !==
            value.recordVersion ||
          (value.latestByteRead.descriptor.origin === "managed-archive") !==
            Boolean(value.latestByteRead.descriptor.artifactRef)))
    )
      ctx.addIssue({
        code: "custom",
        message: "Evidence must preserve the exact owner record/version/scope.",
      });
    const expected = [
      ...(value.declarations.rightsStatus === "restricted"
        ? ["DECLARED_RIGHTS_RESTRICTED"]
        : []),
      ...(value.declarations.providerStatus === "unavailable"
        ? ["DECLARED_PROVIDER_UNAVAILABLE"]
        : []),
      ...(value.source.state === "stale" ? ["SOURCE_STALE"] : []),
      ...(value.source.state === "unverified" ? ["SOURCE_UNVERIFIED"] : []),
      ...(!value.archive ? ["ARCHIVE_UNAVAILABLE"] : []),
    ];
    if (JSON.stringify(value.blockers) !== JSON.stringify(expected))
      ctx.addIssue({
        code: "custom",
        message:
          "Negative source/declaration facts cannot disappear from blockers.",
      });
    if (
      (value.declarations.rightsStatus === "restricted") !==
        (value.declarations.rightsDeclaration === "user-reported-restricted") ||
      (value.declarations.providerStatus === "unavailable") !==
        (value.declarations.providerDeclaration === "user-reported-unavailable")
    )
      ctx.addIssue({
        code: "custom",
        message: "Declaration status must preserve its negative declaration.",
      });
    const receipt = value.latestByteRead,
      archive = value.archive;
    if (receipt) {
      const same = Boolean(
        archive &&
        receipt.descriptor.origin === "managed-archive" &&
        receipt.descriptor.artifactRef === archive.artifactId &&
        receipt.descriptor.sha256 === archive.sha256 &&
        receipt.descriptor.sizeBytes === archive.sizeBytes &&
        receipt.descriptor.mimeType === archive.mimeType &&
        receipt.descriptor.kind === archive.kind,
      );
      const state =
        archive && receipt.descriptor.origin === "managed-archive"
          ? same
            ? "matching-archive-metadata"
            : "changed-archive-metadata"
          : "not-rechecked";
      if (receipt.currentArchiveBinding !== state)
        ctx.addIssue({
          code: "custom",
          message:
            "Historical bytes cannot certify a changed or unobserved archive.",
        });
    }
  });
export type MediaDeliveryEvidence = z.infer<typeof MediaDeliveryEvidenceSchema>;
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
export type MediaArtifactDescriptor = z.infer<
  typeof MediaArtifactDescriptorSchema
>;

export const MEDIA_RECORD_SERVICE = defineServiceContract<MediaRecordService>({
  id: "media.records.v1",
  owner: "media",
  major: 1,
  capabilities: ["read", "write"],
  degradable: true,
});
export const MEDIA_AUDIO_TRACK_SERVICE =
  defineServiceContract<MediaAudioTrackService>({
    id: "media.audio-tracks.v1",
    owner: "media",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

export interface MediaRecordService {
  create(kind: MediaRecordKind, input: MediaRecordInput): MediaRecord;
  list(
    kind: MediaRecordKind,
    filter: { projectId?: string; parentId?: string },
  ): readonly MediaRecord[];
  get(id: string): MediaRecord | undefined;
  /** Immutable owner source projection; callers must not infer it from editable payload. */
  sourceStatus(id: string): MediaSourceStatus | undefined;
  /** Read-only exact owner evidence, never legal/quality approval or a current byte read. */
  deliveryEvidence?(
    id: string,
    projectId: string,
    recordVersion: number,
  ): MediaDeliveryEvidence;
  /** Exact owner archive metadata only, not byte verification or editable payload. */
  archivedArtifact(
    id: string,
    projectId: string,
    recordVersion: number,
  ): MediaArtifactDescriptor | undefined;
  update(
    id: string,
    patch: {
      title?: string;
      payload?: Record<string, unknown>;
      version: number;
    },
  ): MediaRecord | "conflict" | undefined;
  remove(id: string, expectedVersion?: number): boolean;
  registerArchivedArtifact(input: {
    projectId: string;
    parentId?: string;
    title: string;
    descriptor: Omit<MediaArtifactDescriptor, "artifactId">;
    lineage: JsonValue;
  }): MediaRecord;
}

export interface MediaAudioTrackService {
  list(episodeId: string): readonly AudioTrack[];
  create(input: AudioTrackInput): AudioTrack;
  adopt(id: string, version: number, key: string): AudioTrack | undefined;
}
