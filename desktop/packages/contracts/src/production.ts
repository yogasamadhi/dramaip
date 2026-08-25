import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";

export const SeasonStatusSchema = z.enum([
  "draft",
  "ready",
  "review_required",
  "archived",
]);
export const SeasonSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  outline: z.string(),
  sourceChapterVersion: z.string().optional(),
  status: SeasonStatusSchema,
  orderIndex: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const SeasonInputSchema = z.object({
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  outline: z.string().optional(),
  sourceChapterVersion: z.string().optional(),
});
export const SeasonPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  outline: z.string().optional(),
  status: SeasonStatusSchema.optional(),
  version: z.number().int().nonnegative(),
});
export const SeasonChapterMappingInputSchema = z.object({
  seasonId: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterVersion: z.number().int().nonnegative(),
});
export const SeasonChapterMappingSchema =
  SeasonChapterMappingInputSchema.extend({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
  });
export const SeasonPageSchema = z.object({
  items: z.array(SeasonSchema),
  nextCursor: z.string().optional(),
});
export type Season = z.infer<typeof SeasonSchema>;
export type SeasonChapterMapping = z.infer<typeof SeasonChapterMappingSchema>;

export const PRODUCTION_SEASON_SERVICE =
  defineServiceContract<ProductionSeasonService>({
    id: "production.seasons.v1",
    owner: "production",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });
export interface ProductionSeasonService {
  create(input: z.infer<typeof SeasonInputSchema>): Season;
  get(id: string): Season | undefined;
  list(
    projectId: string,
    options?: { cursor?: string; limit?: number },
  ): { items: readonly Season[]; nextCursor?: string };
  update(
    id: string,
    patch: z.infer<typeof SeasonPatchSchema>,
  ): Season | "conflict" | undefined;
  mapChapter(
    input: z.infer<typeof SeasonChapterMappingInputSchema>,
  ): SeasonChapterMapping;
}

export const ProductionRecordKindSchema = z.enum([
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
]);

export const ProductionRecordSchema = z.object({
  id: z.string().uuid(),
  kind: ProductionRecordKindSchema,
  domain: ProductionRecordKindSchema,
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(240),
  payload: z.record(z.string(), z.unknown()),
  orderIndex: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProductionRecordInputSchema = ProductionRecordSchema.pick({
  projectId: true,
  parentId: true,
  title: true,
  payload: true,
}).extend({ payload: z.record(z.string(), z.unknown()).optional() });

export const ProductionRecordPatchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().nonnegative(),
});

export const ProductionGraphNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
});

export const ProductionGraphSchema = z.object({
  projectId: z.string().uuid(),
  nodes: z.array(ProductionGraphNodeSchema),
  edges: z.array(
    z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
      relation: z.string(),
    }),
  ),
  coverage: z.object({
    episodes: z.number().int().nonnegative(),
    scripts: z.number().int().nonnegative(),
    scenes: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    stills: z.number().int().nonnegative(),
    adoptedStills: z.number().int().nonnegative(),
  }),
});

export const ProductionImpactInputSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const ProductionImpactSchema = z.object({
  sourceId: z.string().uuid(),
  affected: z.array(ProductionGraphNodeSchema),
  summary: z.string(),
});

export const ProductionReorderInputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      version: z.number().int().nonnegative(),
    }),
  ),
});

export const ProductionReorderResultSchema = z.object({
  records: z.array(ProductionRecordSchema),
});

export type ProductionRecordKind = z.infer<typeof ProductionRecordKindSchema>;
export type ProductionRecord = z.infer<typeof ProductionRecordSchema>;
export type ProductionRecordInput = z.infer<typeof ProductionRecordInputSchema>;

export const PRODUCTION_RECORD_SERVICE =
  defineServiceContract<ProductionRecordService>({
    id: "production.records.v1",
    owner: "production",
    major: 1,
    capabilities: ["read", "write"],
    degradable: true,
  });

export interface ProductionRecordService {
  create(
    kind: ProductionRecordKind,
    input: ProductionRecordInput,
  ): ProductionRecord;
  list(
    kind: ProductionRecordKind,
    filter: { projectId?: string; parentId?: string },
  ): readonly ProductionRecord[];
  get(id: string): ProductionRecord | undefined;
  update(
    id: string,
    patch: {
      title?: string;
      payload?: Record<string, unknown>;
      version: number;
    },
  ): ProductionRecord | "conflict" | undefined;
  remove(id: string, expectedVersion?: number): boolean;
}
