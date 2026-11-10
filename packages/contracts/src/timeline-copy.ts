import { z } from "zod";
import {
  TimelineClipSchema,
  TimelineTrackSchema,
  TimelineProfileSchema,
  TimelineManifestSchema,
  TimelineDeliveryManifestSchema,
} from "./timeline.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid();
export const TimelineCopyScopeSchema = z
  .object({
    projectId: uuid,
    episodeId: uuid,
    timelineId: uuid,
    timelineVersion: z.number().int().nonnegative(),
    sourceFingerprint: sha,
  })
  .strict();
const exactTimeline = TimelineManifestSchema.extend({
  profile: TimelineProfileSchema.extend({
    frameRate: TimelineProfileSchema.shape.frameRate.strict(),
  }).strict(),
  tracks: z.array(
    TimelineTrackSchema.extend({
      clips: z.array(TimelineClipSchema.strict()),
    }).strict(),
  ),
}).strict();
export const TimelineCopyManifestSchema = TimelineDeliveryManifestSchema.extend(
  { timeline: exactTimeline },
).strict();
export const TimelineCopyDirectorySchema = z
  .object({
    grantId: uuid,
    permission: z.literal("write-directory"),
    displayName: z.string().min(1).max(255),
    expiresAt: z.string().datetime(),
    generation: z.number().int().positive(),
  })
  .strict();
export const TimelineCopyDirectorySelectionSchema = z
  .object({
    scope: TimelineCopyScopeSchema,
    grant: TimelineCopyDirectorySchema.nullable(),
  })
  .strict();
export const TimelineCopyDirectoryInputSchema = z
  .object({ manifest: TimelineCopyManifestSchema })
  .strict();
export const TimelineMediaCopyInputSchema = z
  .object({
    manifest: TimelineCopyManifestSchema,
    directory: TimelineCopyDirectorySelectionSchema,
    purpose: z.literal("local-nle-handoff"),
    acknowledgedLimits: z.literal(true),
  })
  .strict();
const mediaFile = z
  .object({
    kind: z.literal("media"),
    relativePath: z.string().regex(/^media\/[a-f0-9-]{36}\.[a-z0-9]{1,12}$/u),
    sizeBytes: z.number().int().positive(),
    sha256: sha,
    source: z
      .object({
        assetId: uuid,
        recordVersion: z.number().int().nonnegative(),
        artifactId: uuid,
      })
      .strict(),
  })
  .strict();
const documentFile = z
  .object({
    kind: z.literal("document"),
    relativePath: z.enum([
      "timeline.fcpxml",
      "timeline.otio",
      "timeline.edl",
      "subtitles.srt",
      "subtitles.vtt",
      "relink.json",
      "timeline-manifest.json",
    ]),
    sizeBytes: z.number().int().nonnegative(),
    sha256: sha,
  })
  .strict();
export const TimelineMediaCopyReceiptSchema = z
  .object({
    format: z.literal("dramaip-nle-media-copy-receipt"),
    schemaVersion: z.literal(1),
    packageRef: uuid,
    projectId: uuid,
    episodeId: uuid,
    timelineId: uuid,
    timelineVersion: z.number().int().nonnegative(),
    sourceFingerprint: sha,
    verifiedAt: z.string().datetime(),
    evidence: z.literal(
      "complete-copy-and-destination-re-read-at-recorded-time",
    ),
    qualityState: z.literal("unverified"),
    rightsState: z.literal("unverified"),
    billingState: z.literal("unknown"),
    files: z
      .array(z.discriminatedUnion("kind", [mediaFile, documentFile]))
      .min(1)
      .max(1007),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.files.map((item) => item.relativePath)).size !==
      value.files.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate receipt file identities",
      });
  });
export const TimelineMediaCopySchema = z
  .object({
    id: uuid,
    version: z.number().int().nonnegative(),
    requestHash: sha,
    scope: TimelineCopyScopeSchema,
    status: z.enum([
      "submission-unknown",
      "queued",
      "running",
      "completed",
      "failed",
      "canceled",
      "interrupted",
      "source-changed",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    currentBinding: z.enum([
      "unchanged-metadata",
      "changed-metadata",
      "unavailable",
    ]),
    copy: z
      .object({
        artifactRef: uuid,
        receipt: TimelineMediaCopyReceiptSchema,
        receiptSha256: sha,
        receiptBytes: z.number().int().positive(),
      })
      .strict()
      .optional(),
    failureCode: z
      .enum([
        "COPY_FAILED",
        "COPY_ABORTED",
        "COPY_INTERRUPTED",
        "COPY_JOURNAL_UNAVAILABLE",
        "ORIGINAL_SOURCE_CHANGED",
      ])
      .optional(),
    scratchState: z
      .enum(["not-created", "cleaned", "retained-unpublished"])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === "completed") !== Boolean(value.copy))
      ctx.addIssue({
        code: "custom",
        message: "Only completed original jobs have a copy receipt",
      });
    if (
      value.copy &&
      (value.copy.artifactRef !== value.copy.receipt.packageRef ||
        Object.entries(value.scope).some(
          ([key, expected]) =>
            value.copy!.receipt[key as keyof typeof value.copy.receipt] !==
            expected,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Copy receipt scope or artifact binding differs",
      });
    if (value.copy) {
      const media = value.copy.receipt.files.filter(
        (file) => file.kind === "media",
      );
      const documents = value.copy.receipt.files.filter(
        (file) => file.kind === "document",
      );
      if (
        !media.length ||
        documents.length !== 7 ||
        new Set(media.map((file) => file.source.assetId)).size !==
          media.length ||
        media.some(
          (file) =>
            !file.relativePath.startsWith(`media/${file.source.assetId}.`),
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Original Timeline package file set is incomplete or mismatched",
        });
    }
    const failed = [
      "failed",
      "canceled",
      "interrupted",
      "source-changed",
    ].includes(value.status);
    if (
      failed
        ? !value.failureCode || !value.scratchState
        : value.failureCode !== undefined || value.scratchState !== undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "Failure evidence is incomplete or unexpected",
      });
    if (
      (value.status === "source-changed" &&
        value.failureCode !== "ORIGINAL_SOURCE_CHANGED") ||
      (value.status === "canceled" && value.failureCode !== "COPY_ABORTED") ||
      (value.status === "interrupted" &&
        value.failureCode !== "COPY_INTERRUPTED") ||
      (value.status === "failed" &&
        !["COPY_FAILED", "COPY_JOURNAL_UNAVAILABLE"].includes(
          value.failureCode ?? "",
        )) ||
      Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    )
      ctx.addIssue({
        code: "custom",
        message: "Copy status or observation time differs from evidence",
      });
  });
export const TimelineMediaCopyPageSchema = z
  .object({
    timelineId: uuid,
    projectId: uuid,
    items: z.array(TimelineMediaCopySchema).max(100),
    nextCursor: uuid.optional(),
  })
  .strict();
export type TimelineCopyScope = z.infer<typeof TimelineCopyScopeSchema>;
export type TimelineCopyDirectorySelection = z.infer<
  typeof TimelineCopyDirectorySelectionSchema
>;
export type TimelineMediaCopyInput = z.infer<
  typeof TimelineMediaCopyInputSchema
>;
export type TimelineMediaCopy = z.infer<typeof TimelineMediaCopySchema>;
export type TimelineMediaCopyPage = z.infer<typeof TimelineMediaCopyPageSchema>;

/** Matches copied-media.json's fixed key order, independent of transport object key order. */
export function serializeTimelineMediaCopyReceipt(
  receipt: z.infer<typeof TimelineMediaCopyReceiptSchema>,
): string {
  return JSON.stringify(
    {
      format: receipt.format,
      schemaVersion: receipt.schemaVersion,
      packageRef: receipt.packageRef,
      projectId: receipt.projectId,
      episodeId: receipt.episodeId,
      timelineId: receipt.timelineId,
      timelineVersion: receipt.timelineVersion,
      sourceFingerprint: receipt.sourceFingerprint,
      verifiedAt: receipt.verifiedAt,
      evidence: receipt.evidence,
      qualityState: receipt.qualityState,
      rightsState: receipt.rightsState,
      billingState: receipt.billingState,
      files: receipt.files.map((file) => ({
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        kind: file.kind,
        ...(file.kind === "media"
          ? {
              source: {
                assetId: file.source.assetId,
                recordVersion: file.source.recordVersion,
                artifactId: file.source.artifactId,
              },
            }
          : {}),
      })),
    },
    null,
    2,
  );
}
