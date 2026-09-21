import type { AgentContextReference } from "./agent-context.js";
import { z } from "zod";
import { AgentEngineKindSchema } from "./index.js";
import { defineServiceContract } from "./service-contract.js";

export const CreationOperationSchema = z.enum([
  "chapter",
  "characters",
  "book-outline",
  "chapter-outline",
  "story-arc",
  "episode",
  "script-revision",
  "review-check",
  "shot-prompt",
  "delivery-copy",
  "localization",
  "creator-content",
  "chapter-memory",
  "knowledge-plan",
]);
export const CreationInputSchema = z.object({
  projectId: z.string().uuid(),
  operation: CreationOperationSchema,
  targetId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  instruction: z.string().trim().min(1).max(100_000),
  engineKind: AgentEngineKindSchema,
  model: z.record(z.string(), z.unknown()).optional(),
  wordGoal: z.number().int().positive().max(100_000).optional(),
  sourceIds: z.array(z.string().uuid()).max(100).default([]),
  language: z.string().max(100).optional(),
  reviewPackageId: z.string().uuid().optional(),
  feedbackClusterId: z.string().uuid().optional(),
});
export const CreationIssueSchema = z.object({
  severity: z.enum(["error", "warning", "suggestion"]),
  message: z.string().min(1),
  evidence: z.string(),
  location: z.string(),
  suggestion: z.string(),
  source: z.enum(["rule", "model"]),
});
export const CreationCheckSchema = z.object({
  issues: z.array(CreationIssueSchema).max(100),
});
export const CreationContentSchema = z.object({
  title: z.string().default(""),
  brief: z.string().optional(),
  content: z.string().default(""),
  items: z
    .array(
      z.object({
        ref: z.string().min(1),
        parentRef: z.string().optional(),
        kind: z.string().min(1),
        title: z.string().min(1),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(1000)
    .default([]),
});
export const CreationStageSchema = z.enum([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
  "awaiting-review",
  "applied",
  "discarded",
  "failed",
  "canceled",
  "interrupted",
]);
export const CreationWorkflowSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  input: CreationInputSchema,
  stage: CreationStageSchema,
  version: z.number().int().nonnegative(),
  rebaseSource: z
    .object({
      id: z.string().uuid(),
      baseVersion: z.number().int(),
      choices: z.record(z.string(), z.enum(["main", "branch"])),
    })
    .optional(),
  sourceWorkflowId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  runIds: z.array(z.string().uuid()),
  contextSnapshotIds: z.array(z.string().uuid()),
  referenceVersions: z
    .array(
      z.object({
        sourceId: z.string(),
        sourceVersion: z.number(),
        fieldPath: z.string(),
      }),
    )
    .default([]),
  sources: z.array(
    z.object({ kind: z.string(), id: z.string(), version: z.number() }),
  ),
  preparedPrompt: z.string(),
  baseText: z.string().optional(),
  baseBlocks: z.array(z.record(z.string(), z.unknown())).optional(),
  sourceSnapshotId: z.string().uuid().optional(),
  contextEntries: z
    .array(
      z.object({
        title: z.string(),
        included: z.boolean(),
        reason: z.string(),
      }),
    )
    .default([]),
  output: CreationContentSchema.optional(),
  issues: z.array(CreationIssueSchema),
  previewId: z.string().uuid().optional(),
  error: z.string().optional(),
  adoptionCheckId: z.string().uuid().optional(),
  adoptionCheckError: z.string().optional(),
  memoryState: z
    .enum(["running", "synced", "review-required", "failed"])
    .optional(),
  memoryWorkflowId: z.string().uuid().optional(),
  memoryError: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreationActionSchema = z.object({
  action: z.enum(["cancel", "retry", "continue"]),
});
export type CreationInput = z.infer<typeof CreationInputSchema>;
export type CreationContent = z.infer<typeof CreationContentSchema>;
export type CreationIssue = z.infer<typeof CreationIssueSchema>;
export type CreationWorkflow = z.infer<typeof CreationWorkflowSchema>;
export const CreationMergeSchema = z.object({
  currentVersion: z.number().int(),
  units: z.array(
    z.object({
      id: z.string(),
      current: z.string(),
      candidate: z.string(),
      conflict: z.boolean(),
      choice: z.enum(["main", "branch"]),
    }),
  ),
  output: CreationContentSchema.optional(),
});
export type CreationMerge = z.infer<typeof CreationMergeSchema>;
export interface CreationAdapter {
  merge?(
    workflow: CreationWorkflow,
    choices?: Record<string, "main" | "branch">,
  ): CreationMerge;
  mergeText?(
    base: string,
    current: string,
    candidate: string,
  ): Array<{
    id: string;
    base: string;
    current: string;
    candidate: string;
    conflict: boolean;
    content: string;
  }>;
  references?(
    projectId: string,
    chapterId?: string,
  ): {
    prompt: string;
    sources: CreationWorkflow["sources"];
    references?: AgentContextReference[];
  };
  prepare(input: CreationInput): {
    prompt: string;
    baseBlocks?: Array<Record<string, unknown>>;
    checkContent?: CreationContent;
    sources: CreationWorkflow["sources"];
    references?: AgentContextReference[];
  };
  validate(input: CreationInput, content: CreationContent): CreationIssue[];
  apply(workflow: CreationWorkflow): void;
}
export const CREATION_WRITING_SERVICE = defineServiceContract<CreationAdapter>({
  id: "writing.creation.v1",
  owner: "writing",
  major: 1,
  capabilities: ["prepare", "validate", "apply"],
  degradable: true,
});
export const CREATION_PRODUCTION_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "production.creation.v1",
    owner: "production",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const CREATION_DELIVERY_SERVICE = defineServiceContract<CreationAdapter>(
  {
    id: "delivery.creation.v1",
    owner: "delivery",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  },
);
export const CREATION_KNOWLEDGE_SERVICE =
  defineServiceContract<CreationAdapter>({
    id: "knowledge.creation.v1",
    owner: "knowledge",
    major: 1,
    capabilities: ["prepare", "validate", "apply"],
    degradable: true,
  });
export const CREATION_WORKFLOW_SERVICE = defineServiceContract<{
  start(
    input: CreationInput,
    key: string,
    sourceWorkflowId?: string,
    rebaseSource?: CreationWorkflow["rebaseSource"],
  ): CreationWorkflow;
  get(id: string): CreationWorkflow | undefined;
  launch(id: string): Promise<CreationWorkflow>;
  action(
    id: string,
    action: "cancel" | "retry" | "continue",
    key: string,
  ): Promise<CreationWorkflow>;
  apply(
    id: string,
    chapterPatch?: {
      previewId: string;
      id: string;
      version: number;
      content: string;
    },
  ): "updated" | "conflict" | "unsupported";
}>({
  id: "automation.creation.v1",
  owner: "automation",
  major: 1,
  capabilities: ["start", "read", "apply"],
  degradable: true,
});

export function parseCreationContent(text: string): CreationContent {
  const body =
    text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u)?.[1] ?? text;
  try {
    const value = JSON.parse(body);
    // Models commonly express omitted optional strings as null. Normalize only
    // these envelope fields; business data and required fields remain strict.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.brief === null) delete value.brief;
      if (Array.isArray(value.items))
        for (const item of value.items)
          if (item && typeof item === "object" && item.parentRef === null)
            delete item.parentRef;
    }
    return CreationContentSchema.parse(value);
  } catch {
    throw new Error("AI 返回的候选格式不完整，已保留返回内容，请重试。");
  }
}

export function creationReference(
  kind: string,
  value: { id: string; version: number; [key: string]: unknown },
): AgentContextReference {
  const sourceKind =
    kind === "project"
      ? "project"
      : kind === "chapter"
        ? "chapter"
        : ["characters", "outlines", "story-arcs"].includes(kind)
          ? "writing_resource"
          : kind === "knowledge"
            ? "knowledge"
            : "production";
  const fieldPath =
    sourceKind === "project"
      ? "/project"
      : sourceKind === "chapter"
        ? `/chapters/${value.id}`
        : sourceKind === "writing_resource"
          ? `/writing-resources/${kind}/${value.id}`
          : `/${sourceKind}/${value.id}`;
  return {
    sourceKind,
    sourceId: value.id,
    sourceVersion: value.version,
    fieldPath,
    value: JSON.parse(JSON.stringify(value)),
    sensitivity: "project",
  };
}

export const CREATION_QUALITY_SERVICE = defineServiceContract<{
  prompt: string;
  collect(raw: string, rules: CreationIssue[]): CreationIssue[];
}>({
  id: "creative-quality.creation.v1",
  owner: "creative-quality",
  major: 1,
  capabilities: ["check"],
  degradable: true,
});

export interface CreationFeedbackService {
  references(
    projectId: string,
    id: string,
    targetId: string,
  ): import("./agent-context.js").AgentContextReference[];
}
export const CREATION_REVIEW_SERVICE =
  defineServiceContract<CreationFeedbackService>({
    id: "review.creation-feedback.v1",
    owner: "review",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });
export const CREATION_INSIGHTS_SERVICE =
  defineServiceContract<CreationFeedbackService>({
    id: "insights.creation-feedback.v1",
    owner: "insights",
    major: 1,
    capabilities: ["read"],
    degradable: true,
  });

export function creationOperationForTask(
  task: string,
): CreationInput["operation"] | undefined {
  const map: Record<string, CreationInput["operation"]> = {
    generate_characters: "characters",
    generate_book_outline: "book-outline",
    generate_chapter_outline: "chapter-outline",
    generate_story_arc_outline: "story-arc",
    chapter_revision: "chapter",
    generate_chapter: "chapter",
    expand_chapter: "chapter",
    enhance_conflict: "chapter",
    enhance_highlight: "chapter",
    enhance_ai_drama_feel: "chapter",
    enhance_author_style: "chapter",
    enhance_hook: "chapter",
    enhance_reversal: "chapter",
    enhance_cliffhanger: "chapter",
    continue_chapter: "chapter",
    rewrite_chapter: "chapter",
    polish_chapter: "chapter",
    rewrite_as_ai_drama_novel: "chapter",
    generate_ai_drama_script: "episode",
    rewrite_episode_outline: "episode",
    rewrite_ai_drama_script: "script-revision",
    enhance_dialogue_conflict: "script-revision",
    enhance_episode_cliffhanger: "script-revision",
    enhance_script_dialogue_voice: "script-revision",
    enhance_script_visuality: "script-revision",
    generate_character_visual_profile: "knowledge-plan",
    generate_visual_setting: "knowledge-plan",
    propose_story_bible_changes: "knowledge-plan",
    generate_shot_prompt: "shot-prompt",
    optimize_prompt_for_video_platform: "shot-prompt",
    generate_negative_prompt: "shot-prompt",
    rewrite_shot_prompt: "shot-prompt",
  };
  return map[task];
}

/** Verify only references actually disclosed to this frozen run. */
export function assertCreationReferencesCurrent(
  workflow: CreationWorkflow,
  references: AgentContextReference[],
): void {
  for (const source of workflow.referenceVersions) {
    const current = references.find(
      (entry) =>
        entry.sourceId === source.sourceId &&
        entry.fieldPath === source.fieldPath,
    );
    if (!current || current.sourceVersion !== source.sourceVersion)
      throw new Error("本轮引用的资料已更新或失效，请按当前资料重新生成候选。");
  }
}
