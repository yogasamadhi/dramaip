import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

export const ResearchTopicStatusSchema = z.enum([
  "draft",
  "researching",
  "ready",
  "archived",
]);
export const ResearchTopicSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(240),
  query: z.string().min(1).max(500),
  riskDomain: z.enum(["general", "finance", "health", "legal"]),
  status: ResearchTopicStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const ResearchTopicInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  query: z.string().trim().min(1).max(500),
  riskDomain: z
    .enum(["general", "finance", "health", "legal"])
    .default("general"),
});
export const ResearchSourceSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  sourceType: z.enum([
    "duckduckgo",
    "gdelt",
    "wikimedia",
    "rss_atom",
    "manual_url",
    "local",
  ]),
  title: z.string().min(1).max(500),
  url: z.string().url().optional(),
  excerpt: z.string().max(4_000).optional(),
  publishedAt: z.string().optional(),
  dataDate: z.string().optional(),
  retrievedAt: z.string().datetime(),
  status: z.enum(["discovered", "adopted", "rejected"]),
  createdAt: z.string().datetime(),
});
export const ResearchFindingSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  statement: z.string().min(1).max(4_000),
  kind: z.enum(["fact", "quote", "inference", "creator_opinion"]),
  sourceIds: z.array(z.string().uuid()),
  status: z.enum(["draft", "supported", "stale", "blocked"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const ResearchSourceInputSchema = z.object({
  sourceType: z.enum(["rss_atom", "manual_url", "local"]),
  title: z.string().trim().min(1).max(500),
  // Local material is represented only by a user supplied title/excerpt. A
  // file grant is consumed by the Host before it reaches this contract.
  url: z.string().url().optional(),
  excerpt: z.string().trim().max(4_000).optional(),
  publishedAt: z.string().max(80).optional(),
  dataDate: z.string().max(80).optional(),
});
export const ResearchFindingInputSchema = z.object({
  statement: z.string().trim().min(1).max(4_000),
  kind: z.enum(["fact", "quote", "inference", "creator_opinion"]),
  sourceIds: z.array(z.string().uuid()).max(32).default([]),
});
export const ResearchSourcePageSchema = z.object({
  items: z.array(ResearchSourceSchema),
  nextCursor: z.string().optional(),
});
export const ResearchFindingPageSchema = z.object({
  items: z.array(ResearchFindingSchema),
  nextCursor: z.string().optional(),
});
export const ResearchSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
});
export const ResearchSearchResultSchema = z.object({
  source: z.enum(["duckduckgo", "gdelt", "wikimedia"]),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      excerpt: z.string().optional(),
      publishedAt: z.string().optional(),
    }),
  ),
  coverage: z.string(),
});
export const ResearchSearchResponseSchema = z.object({
  topicId: z.string().uuid(),
  results: z.array(ResearchSearchResultSchema),
  coverage: z.array(z.string()),
  fallbackUsed: z.boolean(),
});
export type ResearchSearchResponse = z.infer<
  typeof ResearchSearchResponseSchema
>;
export const ResearchPageSchema = z.object({
  items: z.array(ResearchTopicSchema),
  nextCursor: z.string().optional(),
});
export type ResearchTopic = z.infer<typeof ResearchTopicSchema>;

export const KNOWLEDGE_RESEARCH_SERVICE =
  defineServiceContract<KnowledgeResearchService>({
    id: "knowledge.research.v1",
    owner: "knowledge",
    major: 1,
    capabilities: ["read", "write", "search"],
    degradable: true,
  });
export interface KnowledgeResearchService {
  listTopics(
    projectId: string,
    options?: { cursor?: string; limit?: number; status?: string },
  ): { items: readonly ResearchTopic[]; nextCursor?: string };
}

export const StoryBibleSettingsSchema = z.object({
  projectId: z.string().uuid(),
  autoSuggest: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleChangeSetStatusSchema = z.enum([
  "queued",
  "draft",
  "applied",
  "paused",
  "skipped",
  "discarded",
  "stale",
  "failed",
]);

export const StoryBibleChangePreviewSchema = z.object({
  title: z.string(),
  fields: z.array(z.object({ key: z.string(), value: z.string() })),
});

export const StoryBibleChangeSetSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  sourceVersion: z.number().int().nonnegative(),
  status: StoryBibleChangeSetStatusSchema,
  summary: z.string(),
  taskId: z.string().uuid().optional(),
  conflictNotes: z.array(z.string()),
  preview: StoryBibleChangePreviewSchema,
  appliedAt: z.string().datetime().optional(),
  undoneAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleStaleMarkSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  reason: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StoryBibleChangeSetInputSchema = z.object({
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

export const StoryBibleChangeSetApplyInputSchema = z.object({
  fields: z.array(z.string()).optional(),
});

export type StoryBibleChangeSet = z.infer<typeof StoryBibleChangeSetSchema>;
