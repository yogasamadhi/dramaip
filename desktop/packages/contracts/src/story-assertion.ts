import { z } from "zod";
import {
  StorySourceLifecycleSchema,
  StorySourceLifecycleSummarySchema,
} from "./story-source-lifecycle.js";
import { defineServiceContract } from "./service-contract.js";
import {
  AudienceKnowledgeValueSchema,
  StoryCausalEdgeRelationSchema,
  StoryCausalNodeSchema,
} from "./creative-intelligence.js";
import {
  StoryDeclarationBasisSchema,
  StoryDeclarationInputSchema,
} from "./story-declaration.js";
import type { AgentContextReference } from "./agent-context.js";

const node = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const common = {
  title: z.string().trim().min(1).max(240),
  statement: z.string().trim().min(1).max(4000),
  interpretation: z.enum(["source-stated", "author-inferred"]),
  sources: StoryDeclarationInputSchema.shape.sources,
};
export const StoryAssertionInputSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("relationship"),
        from: node,
        to: node,
        relation: StoryCausalEdgeRelationSchema,
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("cognition"),
        subject: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("audience"),
              id: z.string().trim().min(1).max(200),
            })
            .strict(),
          z.object({ kind: z.literal("character"), node }).strict(),
        ]),
        target: node,
        storyOrder: z.number().int().nonnegative(),
        state: AudienceKnowledgeValueSchema,
      })
      .strict(),
  ])
  .superRefine((input, check) => {
    // Reuse exact source-selection validation, not a looser parallel protocol.
    const source = StoryDeclarationInputSchema.safeParse({
      kind: "event",
      title: input.title,
      statement: input.statement,
      sources: input.sources,
    });
    if (!source.success)
      for (const issue of source.error.issues)
        check.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
    if (input.kind === "relationship" && input.from.id === input.to.id)
      check.addIssue({
        code: "custom",
        path: ["to"],
        message: "关系须连接两个不同的实际节点。",
      });
  });
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
export const StoryAssertionBasisSchema = z
  .object({
    format: z.literal("source-anchored-story-assertion-v1"),
    projectId: z.string().uuid(),
    fingerprint,
    interpretationPolicy: z.literal(
      "human-reviewed-not-semantic-or-calibrated-proof",
    ),
    sourceBasis: StoryDeclarationBasisSchema,
    nodes: z.array(StoryCausalNodeSchema).min(1).max(2),
    policyDependencies: StoryDeclarationBasisSchema.shape.policyDependencies,
  })
  .strict();
const adoptedRecord = z
  .object({
    kind: z.enum(["edge", "cognition"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const StoryAssertionSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    status: z.enum(["pending", "adopted", "discarded"]),
    input: StoryAssertionInputSchema,
    basis: StoryAssertionBasisSchema,
    adoptedRecord: adoptedRecord.optional(),
    lifecycle: StorySourceLifecycleSchema.optional(),
    sourceStatus: z
      .object({
        state: z.enum(["current", "stale", "unavailable"]),
        reasons: z.array(z.string()),
      })
      .strict(),
    etag: z.string().regex(/^"[a-f0-9]{64}"$/u),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const StoryAssertionSummarySchema = StoryAssertionSchema.pick({
  id: true,
  projectId: true,
  version: true,
  status: true,
  sourceStatus: true,
  adoptedRecord: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  lifecycle: StorySourceLifecycleSummarySchema.optional(),
  title: z.string(),
  kind: z.enum(["relationship", "cognition"]),
  sourceFingerprint: fingerprint,
});
export const StoryAssertionPageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(StoryAssertionSummarySchema),
    nextCursor: z.string().uuid().optional(),
  })
  .strict();
export const StoryAssertionAdoptInputSchema = z
  .object({
    sourceFingerprint: fingerprint,
    confirmedSourceReview: z.literal(true),
    confirmedInterpretationReview: z.literal(true),
  })
  .strict();
export type StoryAssertionInput = z.infer<typeof StoryAssertionInputSchema>;
export type StoryAssertionBasis = z.infer<typeof StoryAssertionBasisSchema>;
export type StoryAssertion = z.infer<typeof StoryAssertionSchema>;
export type StoryAssertionAdoptInput = z.infer<
  typeof StoryAssertionAdoptInputSchema
>;
export const KNOWLEDGE_STORY_ASSERTION_SERVICE = defineServiceContract<{
  indexRecords(projectId: string): StoryAssertion[];
  references(projectId: string): AgentContextReference[];
  isSourceAnchored(
    projectId: string,
    kind: "edge" | "cognition",
    id: string,
  ): boolean;
  isCurrentRecord(
    projectId: string,
    kind: "edge" | "cognition",
    id: string,
    version: number,
  ): boolean;
}>({
  id: "knowledge.story-assertions.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
