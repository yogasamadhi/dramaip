import { z } from "zod";

export const CREATIVE_QUALITY_SERVICE = "creative-quality.records.v1" as const;

export const CreativeQualityRecordKindSchema = z.enum([
  "quality",
  "episode-analysis",
  "case-study",
  "diagnostic",
  "acknowledgement",
]);
export type CreativeQualityRecordKind = z.infer<
  typeof CreativeQualityRecordKindSchema
>;

export const CreativeQualityRecordSchema = z.object({
  id: z.string().uuid(),
  kind: CreativeQualityRecordKindSchema,
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  value: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CreativeQualityRecord = z.infer<typeof CreativeQualityRecordSchema>;

export interface CreativeQualityRecordService {
  create(
    kind: CreativeQualityRecordKind,
    input: {
      projectId?: string;
      parentId?: string;
      value: Record<string, unknown>;
    },
  ): CreativeQualityRecord;
  list(
    kind: CreativeQualityRecordKind,
    filter?: { projectId?: string; parentId?: string },
  ): readonly CreativeQualityRecord[];
  get(id: string): CreativeQualityRecord | undefined;
  update(
    id: string,
    version: number,
    patch: Record<string, unknown>,
  ): CreativeQualityRecord | "conflict" | undefined;
  remove(id: string): boolean;
}

const stringList = z.array(z.string());
export const CreativeCaseStudyInputSchema = z.object({
  title: z.string().trim().min(1),
  sourceType: z.string().optional(),
  genre: z.string().optional(),
  summary: z.string().optional(),
  relationshipPatterns: stringList.optional(),
  openingHooks: stringList.optional(),
  highlightBeats: stringList.optional(),
  reversalMechanisms: stringList.optional(),
  cliffhangers: stringList.optional(),
  visualPatterns: stringList.optional(),
  rhythmCurve: z.array(z.number()).optional(),
  riskTags: stringList.optional(),
  notes: z.string().optional(),
});
export const CreativeCaseStudyPatchSchema =
  CreativeCaseStudyInputSchema.partial().extend({
    version: z.number().int().nonnegative(),
  });

export const CreativeDiagnosticInputSchema = z.object({
  projectId: z.string().uuid(),
  targetKind: z
    .enum([
      "project",
      "chapter",
      "adaptation",
      "episode",
      "script",
      "scene",
      "shot",
    ])
    .optional(),
  targetId: z.string().uuid().optional(),
  kinds: z
    .array(
      z.enum([
        "freshness",
        "anti_trope",
        "quality_gate",
        "audience",
        "narrative_curve",
      ]),
    )
    .min(1),
  caseStudyIds: z.array(z.string().uuid()).optional(),
});

export const CreativeAcknowledgementInputSchema = z.object({
  projectId: z.string().uuid(),
  diagnosticId: z.string().uuid(),
  issueKey: z.string().trim().min(1),
  disposition: z.enum(["accepted", "fixed", "not_applicable"]),
  note: z.string().optional(),
  actorLabel: z.string().optional(),
});
