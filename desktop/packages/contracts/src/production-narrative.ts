import { z } from "zod";
import {
  NarrativeSourceBasisSchema,
  narrativeSourceIdentity,
  refineNarrativeSourceSelection,
} from "./narrative-context.js";
import {
  NarrativePlanningSourceSchema,
  NarrativePlanningBasisSchema,
} from "./narrative-planning.js";
import {
  NarrativeSourceScopeFields,
  refineNarrativeSourceScope,
} from "./narrative-source-scope.js";

export const ProductionNarrativeOperationSchema = z.enum([
  "episode",
  "script-revision",
  "review-check",
  "shot-prompt",
]);
export const ProductionNarrativeRequestSchema = z
  .object({
    format: z.literal("production-narrative-v1"),
    ...NarrativeSourceScopeFields,
  })
  .strict()
  .superRefine(refineNarrativeSourceScope);
export type ProductionNarrativeOperation = z.infer<
  typeof ProductionNarrativeOperationSchema
>;
export type ProductionNarrativeRequest = z.infer<
  typeof ProductionNarrativeRequestSchema
>;

const coverage = NarrativePlanningSourceSchema.shape.coverage.shape;
export const ProductionNarrativeCoverageSchema = z.discriminatedUnion(
  "directoryState",
  [
    z
      .object({
        directoryState: z.literal("not-read"),
        included: coverage.included.max(0),
        excluded: coverage.excluded.max(0),
        totalChapterCount: z.null(),
        nonEmptyChapterCount: z.null(),
      })
      .strict(),
    z.object({ directoryState: z.literal("read"), ...coverage }).strict(),
  ],
);

export const ProductionNarrativeSourceSchema = z
  .object({
    kind: z.literal("author-selected-production-narrative"),
    projectId: z.string().uuid(),
    request: ProductionNarrativeRequestSchema,
    sourceBasis: NarrativeSourceBasisSchema,
    coverage: ProductionNarrativeCoverageSchema,
  })
  .superRefine(refineNarrativeSourceSelection);
export const ProductionNarrativeBasisSchema =
  ProductionNarrativeSourceSchema.safeExtend({
    operation: ProductionNarrativeOperationSchema,
    // Complete first-stage context, including actual project/intent/target refs.
    references: z.array(NarrativePlanningBasisSchema.shape.references.element),
    contextBudget: NarrativePlanningBasisSchema.shape.contextBudget,
  });
export type ProductionNarrativeSource = z.infer<
  typeof ProductionNarrativeSourceSchema
>;
export type ProductionNarrativeBasis = z.infer<
  typeof ProductionNarrativeBasisSchema
>;

/** Target-only explicit screenplay merging is not a change of narrative sources. */
export function productionNarrativeIdentity(
  basis: ProductionNarrativeBasis,
): string {
  const value = ProductionNarrativeBasisSchema.parse(basis);
  return JSON.stringify({
    kind: value.kind,
    projectId: value.projectId,
    operation: value.operation,
    request: value.request,
    sourceBasis: narrativeSourceIdentity(value.sourceBasis),
    references: value.references.filter((reference) =>
      value.sourceBasis.references.some(
        (source) =>
          source.sourceKind === reference.sourceKind &&
          source.sourceId === reference.sourceId &&
          source.sourceVersion === reference.sourceVersion &&
          source.fieldPath === reference.fieldPath,
      ),
    ),
  });
}
