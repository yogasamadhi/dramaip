import { z } from "zod";
import {
  EpisodeDevelopmentBasisSchema,
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  EpisodeSceneEvidenceSchema,
  EpisodeTopologyRevisionReceiptSchema,
} from "./episode-development.js";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
export const EpisodeTopologyRevisionInputSchema = z
  .object({
    sourceVersion: z.number().int().positive(),
    outline: ref,
    documentVersion: z.number().int().nonnegative(),
    outlineContent: EpisodeOutlineContentSchema,
    sceneLinks: EpisodeScriptContentSchema.shape.sceneLinks,
  })
  .strict();
export const EpisodeTopologyRevisionConfirmationSchema =
  EpisodeTopologyRevisionReceiptSchema.shape.humanReview;
const EpisodeTopologyRevisionObjectSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    episodeId: z.string().min(1).max(64),
    sourceScript: ref,
    sourceOutline: ref,
    document: z
      .object({
        id: z.string().uuid(),
        scriptId: z.string().uuid(),
        version: z.number().int().nonnegative(),
      })
      .strict(),
    scriptRecordVersion: z.number().int().nonnegative(),
    scriptRecordHash: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string().min(1).max(240),
    outlineContent: EpisodeOutlineContentSchema,
    scriptContent: EpisodeScriptContentSchema,
    outlineContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    scriptContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    outlineBasis: EpisodeDevelopmentBasisSchema,
    scriptBasis: EpisodeDevelopmentBasisSchema,
    inheritedSnapshots:
      EpisodeTopologyRevisionReceiptSchema.shape.inheritedSnapshots,
    sourceEvidence: z
      .array(EpisodeSceneEvidenceSchema)
      .min(1)
      .max(6000)
      .optional(),
    status: z.enum(["pending", "adopted", "discarded"]),
    stateVersion: z.number().int().nonnegative(),
    results: EpisodeTopologyRevisionReceiptSchema.shape.results.optional(),
    confirmation: EpisodeTopologyRevisionConfirmationSchema.optional(),
    sourceState: z.enum(["current", "stale"]),
    staleReasons: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const EpisodeTopologyRevisionSchema =
  EpisodeTopologyRevisionObjectSchema.superRefine((value, ctx) => {
    if (
      (value.status === "adopted") !==
        Boolean(value.results && value.confirmation) ||
      (value.status !== "adopted" &&
        Boolean(value.results || value.confirmation)) ||
      value.sourceScript.id === value.sourceOutline.id ||
      value.scriptBasis.request.outline?.id !== value.sourceOutline.id ||
      value.scriptBasis.request.outline.version !==
        value.sourceOutline.version ||
      value.outlineBasis.episode.id !== value.episodeId ||
      value.scriptBasis.episode.id !== value.episodeId
    )
      ctx.addIssue({
        code: "custom",
        message:
          "双正式确认必须保留原大纲／剧本基准与实际采用状态，不补造另一头。",
      });
  });
export const EpisodeTopologyRevisionPageSchema = z
  .object({
    items: z.array(EpisodeTopologyRevisionSchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export const EpisodeTopologyRevisionSummarySchema =
  EpisodeTopologyRevisionObjectSchema.pick({
    id: true,
    projectId: true,
    episodeId: true,
    sourceScript: true,
    sourceOutline: true,
    document: true,
    status: true,
    stateVersion: true,
    results: true,
    sourceState: true,
    staleReasons: true,
    createdAt: true,
    updatedAt: true,
  }).superRefine((value, ctx) => {
    if (
      (value.status === "adopted") !== Boolean(value.results) ||
      value.sourceScript.id === value.sourceOutline.id ||
      (value.results &&
        new Set([
          value.sourceScript.id,
          value.sourceOutline.id,
          value.results.outline.id,
          value.results.script.id,
        ]).size !== 4)
    )
      ctx.addIssue({
        code: "custom",
        message: "拓扑摘要必须保留实际双正式结果与原独立身份，不补造采用状态。",
      });
  });
export const EpisodeTopologyRevisionSummaryPageSchema = z
  .object({
    items: z.array(EpisodeTopologyRevisionSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type EpisodeTopologyRevisionInput = z.infer<
  typeof EpisodeTopologyRevisionInputSchema
>;
export type EpisodeTopologyRevision = z.infer<
  typeof EpisodeTopologyRevisionSchema
>;
export type EpisodeTopologyRevisionConfirmation = z.infer<
  typeof EpisodeTopologyRevisionConfirmationSchema
>;
export type EpisodeTopologyRevisionSummary = z.infer<
  typeof EpisodeTopologyRevisionSummarySchema
>;
