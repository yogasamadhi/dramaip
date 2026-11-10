import { z } from "zod";
import { AgentContextEntrySchema } from "./agent-context.js";
import {
  EpisodeDevelopmentRequestSchema,
  EpisodeDevelopmentBasisSchema,
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  EpisodeSceneEvidenceSchema,
} from "./episode-development.js";
import {
  EpisodeSourceRevisionReceiptSchema,
  EpisodeSourceRevisionConfirmationSchema,
} from "./episode-source-receipt.js";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const EpisodeSourceRevisionInputSchema = z
  .object({
    sourceVersion: z.number().int().positive(),
    outline: ref,
    documentVersion: z.number().int().nonnegative(),
    request: EpisodeDevelopmentRequestSchema,
    tokenBudget: z.number().int().min(128).max(1_000_000),
    outlineContent: EpisodeOutlineContentSchema,
    sceneLinks: EpisodeScriptContentSchema.shape.sceneLinks,
  })
  .strict()
  .superRefine((value, ctx) => {
    const request = value.request;
    if (
      request.baseOutlineId !== value.outline.id ||
      request.outline ||
      request.script ||
      request.baseScriptId ||
      request.baseScriptDocumentVersion !== undefined ||
      request.baseStoryboardId ||
      request.redoShots ||
      request.redoMode ||
      request.redoShotPlan ||
      request.redoTopologyPlan
    )
      ctx.addIssue({
        code: "custom",
        message:
          "来源确认只接受明确的新来源与原大纲头，不混入剧本生成或分镜重做请求。",
      });
  });
const object = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    episodeId: z.string().min(1).max(64),
    sourceScript: ref,
    sourceOutline: ref,
    document: EpisodeSourceRevisionReceiptSchema.shape.document,
    scriptRecordVersion: z.number().int().nonnegative(),
    scriptRecordHash: sha,
    title: z.string().min(1).max(240),
    input: EpisodeSourceRevisionInputSchema,
    outlineContent: EpisodeOutlineContentSchema,
    scriptContent: EpisodeScriptContentSchema,
    outlineContentHash: sha,
    scriptContentHash: sha,
    sourceBasisHash: sha,
    outlineBasis: EpisodeDevelopmentBasisSchema,
    sourceSnapshotId: z.string().uuid(),
    sourceManifestHash: sha,
    sourcePromptHash: sha,
    policyDependencies:
      EpisodeSourceRevisionReceiptSchema.shape.policyDependencies,
    sourceEvidence: z
      .array(EpisodeSceneEvidenceSchema)
      .min(1)
      .max(6000)
      .optional(),
    status: z.enum(["pending", "adopted", "discarded"]),
    stateVersion: z.number().int().nonnegative(),
    results: EpisodeSourceRevisionReceiptSchema.shape.results.optional(),
    confirmation: EpisodeSourceRevisionConfirmationSchema.optional(),
    sourceState: z.enum(["current", "stale"]),
    staleReasons: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const EpisodeSourceRevisionSchema = object.superRefine((value, ctx) => {
  if (
    (value.status === "adopted") !==
      Boolean(value.results && value.confirmation) ||
    (value.status !== "adopted" &&
      Boolean(value.results || value.confirmation)) ||
    value.sourceScript.id === value.sourceOutline.id ||
    value.sourceScript.version !== value.input.sourceVersion ||
    JSON.stringify(value.sourceOutline) !==
      JSON.stringify(value.input.outline) ||
    JSON.stringify(value.outlineBasis.request) !==
      JSON.stringify(value.input.request) ||
    value.input.request.episodeId !== value.episodeId ||
    value.outlineBasis.episode.id !== value.episodeId ||
    value.document.version !== value.input.documentVersion ||
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
      message: "来源确认须精确绑定原正式身份、新来源请求、实际文档及真实决定。",
    });
});
export const EpisodeSourceRevisionPageSchema = z
  .object({
    items: z.array(EpisodeSourceRevisionSchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
// Dedicated author review: only the exact selected basis values, never an
// arbitrary snapshot, final prompt, excluded entries or ancestor private text.
export const EpisodeSourceRevisionContextSchema = object
  .pick({
    id: true,
    projectId: true,
    episodeId: true,
    sourceScript: true,
    sourceOutline: true,
    document: true,
    stateVersion: true,
    status: true,
    sourceBasisHash: true,
    sourceSnapshotId: true,
    sourceManifestHash: true,
    sourcePromptHash: true,
  })
  .extend({
    tokenBudget: EpisodeSourceRevisionInputSchema.shape.tokenBudget,
    entries: z
      .array(
        EpisodeDevelopmentBasisSchema.shape.references.element
          // OpenAPI's generator cannot directly encode the recursive lazy
          // JSON schema. Keep its runtime JSON validation, as in local quality.
          .extend({ value: z.unknown() })
          .strict()
          .superRefine((entry, ctx) => {
            if (
              !AgentContextEntrySchema.shape.value.safeParse(entry.value)
                .success
            )
              ctx.addIssue({
                code: "custom",
                path: ["value"],
                message: "来源正文须为完整有限 JSON 值。",
              });
          }),
      )
      .min(4)
      .max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const identities = value.entries.map((entry) =>
      JSON.stringify([
        entry.sourceKind,
        entry.sourceId,
        entry.sourceVersion,
        entry.fieldPath,
      ]),
    );
    if (new Set(identities).size !== identities.length)
      ctx.addIssue({ code: "custom", message: "来源正文含重复表达身份。" });
  });
export type EpisodeSourceRevisionContext = z.infer<
  typeof EpisodeSourceRevisionContextSchema
>;
export const EpisodeSourceRevisionSummarySchema = object
  .pick({
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
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === "adopted") !== Boolean(value.results) ||
      value.sourceScript.id === value.sourceOutline.id ||
      (value.sourceState === "current") !== (value.staleReasons.length === 0) ||
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
        message: "来源确认摘要的原／新身份、真实决定或当前状态不符。",
      });
  });
export const EpisodeSourceRevisionSummaryPageSchema = z
  .object({
    items: z.array(EpisodeSourceRevisionSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export type EpisodeSourceRevisionInput = z.infer<
  typeof EpisodeSourceRevisionInputSchema
>;
export type EpisodeSourceRevision = z.infer<typeof EpisodeSourceRevisionSchema>;
export type EpisodeSourceRevisionConfirmation = z.infer<
  typeof EpisodeSourceRevisionConfirmationSchema
>;
export type EpisodeSourceRevisionSummary = z.infer<
  typeof EpisodeSourceRevisionSummarySchema
>;
