import { z } from "zod";

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

export const PRODUCTION_RECORD_SERVICE = "production.records.v1" as const;

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
