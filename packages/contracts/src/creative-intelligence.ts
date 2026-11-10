import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

export const CorpusItemKindSchema = z.enum([
  "meme",
  "comic_device",
  "dialogue_pattern",
  "character_hook",
  "relationship_hook",
  "conflict",
  "reversal",
  "scene",
  "world_rule",
  "style",
  "social_observation",
]);
export type CorpusItemKind = z.infer<typeof CorpusItemKindSchema>;

export const CorpusSourceStatusSchema = z.enum([
  "quarantined",
  "allowed",
  "blocked",
  "takedown",
]);
export type CorpusSourceStatus = z.infer<typeof CorpusSourceStatusSchema>;
export const RightsStatusSchema = z.enum([
  "unknown",
  "review_required",
  "allowed",
  "restricted",
  "removed",
]);
export type RightsStatus = z.infer<typeof RightsStatusSchema>;
export const FreshnessStatusSchema = z.enum([
  "emerging",
  "stable",
  "cooling",
  "expired",
  "evergreen",
]);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

export const CorpusSourceSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url().optional(),
  domain: z.string().max(253).optional(),
  title: z.string().min(1).max(500),
  excerpt: z.string().max(500).optional(),
  contentHash: z.string().max(128).optional(),
  status: CorpusSourceStatusSchema,
  rightsStatus: RightsStatusSchema,
  locale: z.string().min(2).max(35).default("zh-CN"),
  retrievedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CorpusSource = z.infer<typeof CorpusSourceSchema>;

export const CorpusItemSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid().optional(),
  visibility: z.enum(["public", "private"]),
  kind: CorpusItemKindSchema,
  title: z.string().min(1).max(240),
  trigger: z.string().max(1_000).default(""),
  mechanism: z.string().min(1).max(4_000),
  emotionalEffect: z.string().max(1_000).default(""),
  contexts: z.array(z.string().max(120)).max(32).default([]),
  riskTags: z.array(z.string().max(120)).max(32).default([]),
  tags: z.array(z.string().max(120)).max(64).default([]),
  freshness: FreshnessStatusSchema,
  rightsStatus: RightsStatusSchema,
  locale: z.string().min(2).max(35),
  tombstonedAt: z.string().datetime().optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CorpusItem = z.infer<typeof CorpusItemSchema>;
export const CorpusItemInputSchema = CorpusItemSchema.pick({
  sourceId: true,
  visibility: true,
  kind: true,
  title: true,
  trigger: true,
  mechanism: true,
  emotionalEffect: true,
  contexts: true,
  riskTags: true,
  tags: true,
  freshness: true,
  rightsStatus: true,
  locale: true,
}).partial({
  sourceId: true,
  trigger: true,
  emotionalEffect: true,
  contexts: true,
  riskTags: true,
  tags: true,
  freshness: true,
  rightsStatus: true,
  locale: true,
});
export type CorpusItemInput = z.infer<typeof CorpusItemInputSchema>;
export const CorpusItemPatchSchema = CorpusItemInputSchema.partial().extend({
  version: z.number().int().nonnegative(),
});
export type CorpusItemPatch = z.infer<typeof CorpusItemPatchSchema>;

export const CorpusCollectionItemSchema = z.object({
  id: z.string().uuid(),
  corpusItemId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  mechanism: z.string().min(1).max(4_000),
  notes: z.string().max(4_000).default(""),
  tags: z.array(z.string().max(120)).max(64).default([]),
  adopted: z.boolean(),
  useCount: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CorpusCollectionItem = z.infer<typeof CorpusCollectionItemSchema>;

export const ProvenanceRelationSchema = z.enum([
  "collected_from",
  "inspired_by",
  "derived_from",
  "generated_from",
  "adopted_from",
  "quoted_from",
]);
export type ProvenanceRelation = z.infer<typeof ProvenanceRelationSchema>;
export const ProvenanceEdgeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  fromType: z.string().min(1).max(80),
  fromId: z.string().min(1).max(200),
  relation: ProvenanceRelationSchema,
  toType: z.string().min(1).max(80),
  toId: z.string().min(1).max(200),
  quoteExcerpt: z.string().max(500).optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type ProvenanceEdge = z.infer<typeof ProvenanceEdgeSchema>;

export const CreativeFingerprintDimensionKeySchema = z.enum([
  "humor",
  "genre",
  "tone",
  "pace",
  "conflict",
  "reversal",
  "emotional_intensity",
  "visuality",
  "novelty",
  "production_complexity",
]);
export type CreativeFingerprintDimensionKey = z.infer<
  typeof CreativeFingerprintDimensionKeySchema
>;
export const CreativeFingerprintDimensionSchema = z.object({
  key: CreativeFingerprintDimensionKeySchema,
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  frozen: z.boolean(),
  evidenceIds: z.array(z.string()).max(100),
});
export type CreativeFingerprintDimension = z.infer<
  typeof CreativeFingerprintDimensionSchema
>;
export const CreativeFingerprintSchema = z.object({
  enabled: z.boolean(),
  consentedAt: z.string().datetime().optional(),
  dimensions: z.array(CreativeFingerprintDimensionSchema),
  avoidances: z.array(z.string().max(500)).max(100),
  goals: z.array(z.string().max(500)).max(100),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type CreativeFingerprint = z.infer<typeof CreativeFingerprintSchema>;

export const CreativeVariantSchema = z.object({
  id: z.string().uuid(),
  lane: z.enum(["conservative", "balanced", "wild"]),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(20_000),
  scores: z.record(z.string(), z.number().min(0).max(100)),
  selected: z.boolean(),
});
export type CreativeVariant = z.infer<typeof CreativeVariantSchema>;
export const CreativeExperimentSchema = z.object({
  id: z.string().uuid(),
  originType: z.enum(["inspiration", "corpus", "project"]),
  originId: z.string().max(200).optional(),
  projectId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(20_000),
  strategyVersion: z.string(),
  status: z.enum(["draft", "ready", "completed", "rejected"]),
  variants: z.array(CreativeVariantSchema),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CreativeExperiment = z.infer<typeof CreativeExperimentSchema>;

export const StoryCausalNodeKindSchema = z.enum([
  "character",
  "event",
  "secret",
  "rule",
  "location",
  "organization",
  "resource",
  "relationship",
  "inspiration",
]);
export const StoryCausalNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: StoryCausalNodeKindSchema,
  title: z.string().min(1).max(240),
  summary: z.string().max(4_000),
  sourceType: z.string().max(80),
  sourceId: z.string().max(200),
  sourceVersion: z.number().int().nonnegative(),
  confirmed: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoryCausalNode = z.infer<typeof StoryCausalNodeSchema>;
export const StoryCausalEdgeRelationSchema = z.enum([
  "causes",
  "enables",
  "blocks",
  "reveals",
  "conflicts_with",
  "depends_on",
]);
export const StoryCausalEdgeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  relation: StoryCausalEdgeRelationSchema,
  rationale: z.string().max(4_000),
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoryCausalEdge = z.infer<typeof StoryCausalEdgeSchema>;

export const AudienceKnowledgeValueSchema = z.enum([
  "unknown",
  "suspects",
  "misbelieves",
  "knows",
]);
export const AudienceKnowledgeStateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  subjectType: z.enum(["audience", "character"]),
  subjectId: z.string().max(200),
  knowledgeNodeId: z.string().uuid(),
  storyOrder: z.number().int().nonnegative(),
  state: AudienceKnowledgeValueSchema,
  evidence: z.string().max(4_000),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AudienceKnowledgeState = z.infer<
  typeof AudienceKnowledgeStateSchema
>;

export const StoryRuleRecordReferenceSchema = z
  .object({
    kind: z.enum(["node", "edge", "cognition"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const StoryRuleFindingSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.enum([
      "self-causal-link",
      "declared-conflict",
      "causal-cycle",
      "cognition-order-conflict",
      "cognition-decrease",
      "secret-without-incoming-reveal",
    ]),
    severity: z.literal("review"),
    summary: z.string().min(1).max(4_000),
    advice: z.string().min(1).max(4_000),
    records: z.array(StoryRuleRecordReferenceSchema).min(1),
  })
  .strict();
export type StoryRuleFinding = z.infer<typeof StoryRuleFindingSchema>;
export const StoryRuleAnalysisSchema = z
  .object({
    ruleSet: z.literal("story-structure-rules-v1"),
    evidencePolicy: z.literal("frozen-author-declarations-not-semantic-proof"),
    coverage: z
      .object({
        nodeCount: z.number().int().nonnegative(),
        edgeCount: z.number().int().nonnegative(),
        cognitionCount: z.number().int().nonnegative(),
      })
      .strict(),
    findings: z.array(StoryRuleFindingSchema),
  })
  .strict();
export type StoryRuleAnalysis = z.infer<typeof StoryRuleAnalysisSchema>;

export const IPTwinSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceFingerprint: z.string(),
  stale: z.boolean(),
  nodes: z.array(StoryCausalNodeSchema),
  edges: z.array(StoryCausalEdgeSchema),
  audienceStates: z.array(AudienceKnowledgeStateSchema),
  conflicts: z.array(z.string()),
  // Absent on historical snapshots: never recompute or upgrade them on a GET.
  ruleAnalysis: StoryRuleAnalysisSchema.optional(),
  createdAt: z.string().datetime(),
});
export type IPTwinSnapshot = z.infer<typeof IPTwinSnapshotSchema>;

export const ScenarioRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  hypothesis: z.string().min(1).max(4_000),
  status: z.enum(["preview", "committed", "discarded"]),
  deterministicFindings: z.array(z.string()),
  modelInferences: z.array(z.string()),
  affectedNodeIds: z.array(z.string().uuid()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScenarioRun = z.infer<typeof ScenarioRunSchema>;

export const OriginalityRiskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  targetType: z.string(),
  targetId: z.string(),
  severity: z.enum(["info", "review", "high"]),
  reason: z.string(),
  evidenceEdgeIds: z.array(z.string().uuid()),
  legalConclusion: z.literal(false),
  createdAt: z.string().datetime(),
});
export type OriginalityRisk = z.infer<typeof OriginalityRiskSchema>;

export const CreativePackageAssetsSchema = z.object({
  corpusItems: z.array(
    CorpusItemSchema.pick({
      id: true,
      kind: true,
      title: true,
      trigger: true,
      mechanism: true,
      emotionalEffect: true,
      contexts: true,
      riskTags: true,
      tags: true,
      freshness: true,
      rightsStatus: true,
      locale: true,
    }),
  ),
  causalNodes: z.array(StoryCausalNodeSchema.omit({ projectId: true })),
  causalEdges: z.array(StoryCausalEdgeSchema.omit({ projectId: true })),
  audienceStates: z.array(
    AudienceKnowledgeStateSchema.omit({ projectId: true }),
  ),
  provenance: z.array(ProvenanceEdgeSchema.omit({ projectId: true })),
});
export type CreativePackageAssets = z.infer<typeof CreativePackageAssetsSchema>;

export const CREATIVE_KNOWLEDGE_SERVICE =
  defineServiceContract<CreativeKnowledgeService>({
    id: "knowledge.creative-intelligence.v1",
    owner: "knowledge",
    major: 1,
    capabilities: ["read", "write", "simulate"],
    degradable: true,
  });

export interface CreativeKnowledgeService {
  listCorpus(input?: {
    query?: string;
    visibility?: "public" | "private";
    limit?: number;
  }): readonly CorpusItem[];
  listNodes(projectId: string): readonly StoryCausalNode[];
  listEdges(projectId: string): readonly StoryCausalEdge[];
  listProvenance(projectId?: string): readonly ProvenanceEdge[];
  exportPackageAssets(projectId: string): CreativePackageAssets;
  importPackageAssets(projectId: string, assets: CreativePackageAssets): number;
  buildTwin(projectId: string): IPTwinSnapshot;
}
