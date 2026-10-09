import { z } from "zod";
import { NarrativeQualityAssessmentSchema } from "./narrative-quality.js";
import { NarrativeLocalQualityAssessmentSchema } from "./narrative-local-quality.js";
import {
  ManuscriptRightsSchema,
  ManuscriptReceiptSchema,
} from "./delivery-save.js";
import { DirectScriptSourceSchema } from "./episode-development.js";

const ref = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const PilotPackagePreviewInputSchema = z
  .object({
    projectVersion: z.number().int().nonnegative(),
    storyboard: ref,
    shotAttribution: ref.optional(),
    includeNle: z.boolean().default(true),
    // Explicit opt-in only; omission keeps historical request hashes unchanged.
    includeWorkflowLineage: z.boolean().optional(),
  })
  .strict();
export const PilotPackageSaveInputSchema = z
  .object({
    version: z.number().int().nonnegative(),
    archiveSha256: sha,
    rights: ManuscriptRightsSchema,
    internalReviewConfirmed: z.literal(true),
    unverifiedChecksAcknowledged: z.literal(true),
  })
  .strict();
export const PilotPackageFileSchema = z.object({
  fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u),
  mimeType: z.string(),
  sha256: sha,
  byteSize: z.number().int().nonnegative(),
});
export const PilotPackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  purpose: z.literal("internal-pilot"),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().nonnegative(),
  projectTitle: z.string(),
  episodeId: z.string(),
  episodeTitle: z.string(),
  durationSeconds: z.number().int().positive(),
  adopted: z
    .object({
      authorIntent: ref,
      diagnosis: ref.extend({ strategyId: z.string() }).optional(),
      strategy: ref.extend({ optionId: z.string() }).optional(),
      seasonPlan: ref.optional(),
      outline: ref,
      script: ref,
      storyboard: ref,
      shotAttribution: ref.optional(),
      directSource: DirectScriptSourceSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        value.directSource
          ? Boolean(value.diagnosis || value.seasonPlan || value.strategy)
          : !value.diagnosis || !value.seasonPlan
      )
        ctx.addIssue({
          code: "custom",
          message:
            "内部包必须保留诊断/季纲链或实际直写来源之一，不补造或混用。",
        });
      if (
        value.directSource &&
        (value.directSource.authorIntent.id !== value.authorIntent.id ||
          value.directSource.authorIntent.version !==
            value.authorIntent.version)
      )
        ctx.addIssue({
          code: "custom",
          message: "直写包必须绑定同一正式作者意图。",
        });
    })
    .describe(
      "Exactly one source chain: diagnosis plus seasonPlan, or directSource. They must never coexist.",
    ),
  scriptRecordId: z.string().uuid(),
  scriptDocumentVersion: z.number().int().nonnegative(),
  productionRecords: z.array(
    z.object({
      id: z.string().uuid(),
      stableId: z.string(),
      kind: z.enum(["scenes", "shots"]),
      version: z.number().int().nonnegative(),
    }),
  ),
  lineage: z.array(
    z.object({
      sourceKind: z.string(),
      sourceId: z.string().uuid(),
      sourceVersion: z.number().int().nonnegative(),
    }),
  ),
  preflight: z.object({
    checks: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        state: z.enum(["passed", "unknown", "blocked"]),
        evidenceKind: z.enum(["rule", "model", "human"]),
        detail: z.string(),
      }),
    ),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  // Old saved packages remain readable. This contains references/counts, not quotes.
  qualityEvidence: z.array(NarrativeQualityAssessmentSchema).optional(),
  // Distinct native identities/origins. Never invent model report or run references.
  localQualityEvidence: z
    .array(NarrativeLocalQualityAssessmentSchema)
    .optional(),
  missingItems: z.array(z.string()),
  externalDependencies: z.array(z.string()),
  costs: z.object({ status: z.literal("unknown"), explanation: z.string() }),
  media: z.object({
    binaryIncluded: z.literal(false),
    generatedByExport: z.literal(false),
  }),
  timeline: ref.optional(),
  files: z.array(PilotPackageFileSchema),
  indexFile: z.literal("manifest.json"),
  createdAt: z.string().datetime(),
});
export const PilotPackageRecordSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  status: z.enum([
    "awaiting-confirmation",
    "saving",
    "saved",
    "canceled",
    "failed",
  ]),
  manifest: PilotPackageManifestSchema,
  archive: z.object({
    fileName: z.string(),
    mimeType: z.literal("application/zip"),
    sha256: sha,
    byteSize: z.number().int().nonnegative(),
  }),
  rights: ManuscriptRightsSchema.optional(),
  receipt: ManuscriptReceiptSchema.optional(),
  sourceState: z.enum(["current", "stale"]),
  sourceIssues: z.array(z.string()),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const PilotPackagePreviewSchema = PilotPackageRecordSchema.extend({
  files: z.array(PilotPackageFileSchema.extend({ content: z.string() })),
});
export const PilotPackagePageSchema = z.object({
  items: z.array(PilotPackageRecordSchema),
  nextCursor: z.string().uuid().optional(),
});
export type PilotPackageManifest = z.infer<typeof PilotPackageManifestSchema>;
export type PilotPackagePreview = z.infer<typeof PilotPackagePreviewSchema>;
export type PilotPackageRecord = z.infer<typeof PilotPackageRecordSchema>;
export type PilotPackagePreviewInput = z.input<
  typeof PilotPackagePreviewInputSchema
>;
export type PilotPackageSaveInput = z.infer<typeof PilotPackageSaveInputSchema>;
export type PilotPackagePage = z.infer<typeof PilotPackagePageSchema>;
