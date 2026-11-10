import { z } from "zod";
import { MediaDeliveryEvidenceSchema } from "./media.js";

const id = z.string().uuid();
const version = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(40_000);
export const PlatformMetadataVariantInputSchema = z
  .object({
    label: text,
    title: text,
    description: text,
    tags: z.array(text).min(1).max(100),
    coverAssetId: id.optional(),
    source: z.enum(["manual", "ai_draft"]).default("manual"),
  })
  .strict();
export const PlatformMetadataProfileSchema = z
  .object({
    id,
    version: text,
    title: text,
    platform: text,
    region: text,
    sourceUrl: z.string().startsWith("dramaip://"),
    sourceStatus: z.literal("internal_master"),
    checkedAt: z.string().datetime(),
    filenamePrefix: z.string().regex(/^[a-z0-9-]+$/),
    video: z
      .object({
        width: version,
        height: version,
        videoCodec: text,
        audioCodec: text,
      })
      .strict(),
    duration: z.object({ status: z.literal("manual"), note: text }).strict(),
    subtitleSafeZone: z
      .object({ bottomMarginPx: version, note: text })
      .strict(),
    requiredListingFields: z.array(text),
    manualFields: z.array(text),
  })
  .strict();
export const PlatformMetadataVariantSchema =
  PlatformMetadataVariantInputSchema.extend({
    id,
    projectId: id,
    adaptationId: id,
    version,
    versionNumber: version,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: z.enum(["candidate", "adopted", "archived"]),
    contentFingerprint: digest,
    projectVersion: version,
    adaptationVersion: version,
    headRevision: version,
    adoptionVerified: z.boolean(),
  }).strict();
export type PlatformMetadataVariant = z.infer<
  typeof PlatformMetadataVariantSchema
>;
export const PlatformMetadataAdoptInputSchema = z
  .object({
    projectId: id,
    adaptationId: id,
    projectVersion: version,
    adaptationVersion: version,
    variantVersion: version,
    contentFingerprint: digest,
    expectedHeadRevision: version,
  })
  .strict();
export const PlatformMetadataPreflightInputSchema = z
  .object({
    projectId: id,
    profileId: id,
    creativeVariantId: id,
    manualFieldsConfirmed: z.boolean(),
  })
  .strict();
export type PlatformMetadataPreflightInput = z.infer<
  typeof PlatformMetadataPreflightInputSchema
>;
const anchor = z.object({ id, version, fingerprint: digest }).strict();
export const PlatformMetadataSnapshotSchema = z
  .object({
    project: anchor,
    adaptation: anchor,
    episode: anchor,
    profile: PlatformMetadataProfileSchema,
    variant: PlatformMetadataVariantSchema,
    cover: MediaDeliveryEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      s.variant.projectId !== s.project.id ||
      s.variant.adaptationId !== s.adaptation.id ||
      s.variant.projectVersion !== s.project.version ||
      s.variant.adaptationVersion !== s.adaptation.version ||
      (s.cover &&
        (s.cover.projectId !== s.project.id ||
          s.cover.recordId !== s.variant.coverAssetId))
    )
      c.addIssue({ code: "custom", message: "Snapshot scope does not match" });
  });
const boundary = {
  scope: z.literal("submission-metadata-only"),
  releaseReady: z.literal(false),
  unknowns: z.tuple([
    z.literal("CONTENT_QUALITY_UNVERIFIED"),
    z.literal("LEGAL_RIGHTS_UNVERIFIED"),
    z.literal("SETTLEMENT_UNKNOWN"),
    z.literal("CURRENT_FILES_NOT_READ"),
    z.literal("PLATFORM_RULES_NOT_VERIFIED"),
  ]),
};
export const PlatformMetadataPreflightSchema = z
  .object({
    ...boundary,
    episodeId: id,
    input: PlatformMetadataPreflightInputSchema,
    ok: z.boolean(),
    profile: PlatformMetadataProfileSchema.optional(),
    blockers: z.array(text),
    warnings: z.array(text),
    expectedFiles: z.array(text),
    finalBaseName: z.string().regex(/^[a-z0-9-]+$/),
    sourceFingerprint: digest,
    snapshot: PlatformMetadataSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((p, c) => {
    if (
      p.ok !== (p.blockers.length === 0) ||
      (p.ok &&
        (!p.snapshot ||
          !p.input.manualFieldsConfirmed ||
          !p.snapshot.variant.adoptionVerified)) ||
      (p.snapshot &&
        (p.snapshot.episode.id !== p.episodeId ||
          p.snapshot.project.id !== p.input.projectId ||
          p.snapshot.variant.id !== p.input.creativeVariantId ||
          p.snapshot.profile.id !== p.input.profileId))
    )
      c.addIssue({
        code: "custom",
        message: "Invalid preflight scope or decision",
      });
  });
export type PlatformMetadataPreflight = z.infer<
  typeof PlatformMetadataPreflightSchema
>;
export const PlatformMetadataArchiveInputSchema =
  PlatformMetadataPreflightInputSchema.extend({
    sourceFingerprint: digest,
  }).strict();
export const PlatformMetadataArchiveSchema = z
  .object({
    ...boundary,
    id,
    projectId: id,
    adaptationId: id,
    episodeId: id,
    profileId: id,
    profileVersion: text,
    creativeVariantId: id,
    deliveryVersion: version,
    sourceFingerprint: digest,
    createdAt: z.string().datetime(),
    preflight: PlatformMetadataPreflightSchema,
  })
  .strict()
  .superRefine((a, c) => {
    const p = a.preflight;
    if (
      !p.ok ||
      a.sourceFingerprint !== p.sourceFingerprint ||
      a.projectId !== p.input.projectId ||
      a.episodeId !== p.episodeId ||
      a.adaptationId !== p.snapshot?.adaptation.id ||
      a.creativeVariantId !== p.input.creativeVariantId ||
      a.profileId !== p.input.profileId ||
      a.profileVersion !== p.profile?.version
    )
      c.addIssue({
        code: "custom",
        message: "Archive does not freeze the original preflight",
      });
  });
export type PlatformMetadataArchive = z.infer<
  typeof PlatformMetadataArchiveSchema
>;
export const PlatformMetadataLegacyArchiveSchema = z
  .object({
    scope: z.literal("legacy-submission-metadata-unverified"),
    releaseReady: z.literal(false),
    id,
    projectId: id,
    episodeId: id,
    createdAt: z.string().datetime(),
    deliveryVersion: version,
    profileId: id,
    adaptationId: id.optional(),
    creativeVariantId: id.optional(),
    profileVersion: text.optional(),
    sourceFingerprint: digest.optional(),
  })
  .strict();
export const PlatformMetadataArchiveEntrySchema = z.union([
  PlatformMetadataArchiveSchema,
  PlatformMetadataLegacyArchiveSchema,
]);
export type PlatformMetadataArchiveEntry = z.infer<
  typeof PlatformMetadataArchiveEntrySchema
>;
export const PlatformMetadataReceiptSchema = z.discriminatedUnion("operation", [
  z
    .object({
      requestKey: id,
      projectId: id,
      aggregateId: id,
      requestHash: digest,
      createdAt: z.string().datetime(),
      operation: z.literal("adopt"),
      input: PlatformMetadataAdoptInputSchema,
      result: PlatformMetadataVariantSchema,
    })
    .strict(),
  z
    .object({
      requestKey: id,
      projectId: id,
      aggregateId: id,
      requestHash: digest,
      createdAt: z.string().datetime(),
      operation: z.literal("archive"),
      input: PlatformMetadataArchiveInputSchema,
      result: PlatformMetadataArchiveSchema,
    })
    .strict(),
]);
export type PlatformMetadataReceipt = z.infer<
  typeof PlatformMetadataReceiptSchema
>;
export type PlatformMetadataAdoptInput = z.infer<
  typeof PlatformMetadataAdoptInputSchema
>;
export type PlatformMetadataArchiveInput = z.infer<
  typeof PlatformMetadataArchiveInputSchema
>;
