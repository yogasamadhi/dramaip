import { z } from "zod";
import {
  EpisodeScriptContentSchema,
  EpisodeDevelopmentBasisSchema,
  EpisodeScriptRevisionReceiptSchema,
} from "./episode-development.js";

const ref = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
export const EpisodeScriptRevisionInputSchema = z
  .object({
    sourceVersion: z.number().int().positive(),
    documentVersion: z.number().int().nonnegative(),
    sceneLinks: EpisodeScriptContentSchema.shape.sceneLinks,
  })
  .strict();
export const EpisodeScriptRevisionConfirmationSchema =
  EpisodeScriptRevisionReceiptSchema.shape.humanReview;
export const EpisodeScriptRevisionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string(),
  sourceResult: ref,
  outline: ref,
  document: ref.extend({ scriptId: z.string().uuid() }),
  scriptRecordVersion: z.number().int().nonnegative(),
  title: z.string(),
  content: EpisodeScriptContentSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  basis: EpisodeDevelopmentBasisSchema,
  sourceSnapshotId: z.string().uuid(),
  status: z.enum(["pending", "adopted", "discarded"]),
  stateVersion: z.number().int().nonnegative(),
  resultId: z.string().uuid().optional(),
  confirmation: EpisodeScriptRevisionConfirmationSchema.optional(),
  sourceState: z.enum(["current", "stale"]),
  staleReasons: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const EpisodeScriptRevisionPageSchema = z.object({
  items: z.array(EpisodeScriptRevisionSchema),
  nextCursor: z.string().uuid().optional(),
});
export const EpisodeScriptRevisionSummarySchema =
  EpisodeScriptRevisionSchema.pick({
    id: true,
    projectId: true,
    episodeId: true,
    sourceResult: true,
    document: true,
    status: true,
    stateVersion: true,
    resultId: true,
    sourceState: true,
    staleReasons: true,
    createdAt: true,
    updatedAt: true,
  });
export const EpisodeScriptRevisionSummaryPageSchema = z.object({
  items: z.array(EpisodeScriptRevisionSummarySchema),
  nextCursor: z.string().uuid().optional(),
});
export type EpisodeScriptRevisionSummary = z.infer<
  typeof EpisodeScriptRevisionSummarySchema
>;
export type EpisodeScriptRevisionInput = z.infer<
  typeof EpisodeScriptRevisionInputSchema
>;
export type EpisodeScriptRevisionConfirmation = z.infer<
  typeof EpisodeScriptRevisionConfirmationSchema
>;
export type EpisodeScriptRevision = z.infer<typeof EpisodeScriptRevisionSchema>;
