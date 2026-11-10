import type {
  CreationGetResult,
  CreationStartInput,
} from "@dramaip/automation-automation/types";
import type {
  SeasonPlansGetResult,
  SeasonPlansSourcesResult,
} from "@dramaip/production-production/types";
import {
  integer,
  isObject,
  onlyKeys,
  sameFrozenSnapshot,
  UUID,
} from "../tools/parse.ts";

export type SeasonPlan = SeasonPlansGetResult;
export type SeasonCatalog = SeasonPlansSourcesResult;
export type SeasonPlanRequest = NonNullable<
  CreationStartInput["seasonPlanRequest"]
>;
export type Workflow = CreationGetResult;

/** Why a plan's lineage could not be checked. */
export type LineageError = "workflow" | "chain" | "parent" | "model";

/** The storage key of a project's confirmed season plan basis. */
export const seasonDraftKey = (projectId: string) =>
  `dramaip-season-plan-basis:${projectId}`;

const reference = (item: unknown, extra: string) =>
  isObject(item) &&
  onlyKeys(item, ["id", "version", extra]) &&
  typeof item.id === "string" &&
  UUID.test(item.id) &&
  integer(item.version, 1) &&
  typeof item[extra] === "string" &&
  (item[extra] as string).trim().length >= 1 &&
  (item[extra] as string).trim().length <= 64;

/**
 * A season plan request exactly as the owner takes it: the adopted
 * diagnosis with its strategy, the independent strategy when the path
 * has one, and the adopted plan it replaces; nothing else.
 */
export function parseSeasonPlanRequest(
  item: unknown,
): SeasonPlanRequest | undefined {
  return isObject(item) &&
    onlyKeys(item, ["diagnosis", "strategy", "baseAdoptedId"]) &&
    reference(item.diagnosis, "strategyId") &&
    (item.strategy === undefined || reference(item.strategy, "optionId")) &&
    (item.baseAdoptedId === undefined ||
      (typeof item.baseAdoptedId === "string" && UUID.test(item.baseAdoptedId)))
    ? (item as unknown as SeasonPlanRequest)
    : undefined;
}

/** The basis saved for a project, when it still parses. */
export function readSeasonDraft(
  raw: string | null,
): SeasonPlanRequest | undefined {
  try {
    return parseSeasonPlanRequest(JSON.parse(raw ?? "null"));
  } catch {
    return undefined;
  }
}

/** The basis the catalog offers, or undefined without an adopted diagnosis. */
export function seasonPlanRequest(
  catalog: SeasonCatalog,
): SeasonPlanRequest | undefined {
  if (!catalog.diagnosis) return undefined;
  return parseSeasonPlanRequest({
    diagnosis: catalog.diagnosis,
    ...(catalog.strategy ? { strategy: catalog.strategy } : {}),
    ...(catalog.adoptedPlanId === undefined
      ? {}
      : { baseAdoptedId: catalog.adoptedPlanId }),
  });
}

/** The season plan run a link names, when it is this project's with a request. */
export function originalSeasonWorkflow(
  workflow: Workflow | undefined,
  requested: { projectId: string; workflowId: string },
): Workflow | undefined {
  return workflow &&
    workflow.id === requested.workflowId &&
    workflow.input.projectId === requested.projectId &&
    workflow.input.operation === "season-plan" &&
    workflow.input.seasonPlanRequest
    ? workflow
    : undefined;
}

const immutableBasis = (plan: SeasonPlan) => {
  const { baseAdoptedId: _head, ...basis } = plan.basis;
  return basis;
};

/**
 * Follow a plan back to the model plan its run produced. A human reorder
 * is its own record and may move the adopted head without a new run, so
 * each reorder must name a parent of the same project, run and snapshot
 * with the same frozen basis; the model plan at the root must match the
 * run's frozen basis and snapshot.
 * @returns the reason the lineage fails, or undefined when it holds.
 */
export async function seasonPlanLineageError(
  plan: SeasonPlan,
  workflow: Workflow,
  read: (id: string) => Promise<SeasonPlan>,
): Promise<LineageError | undefined> {
  if (
    workflow.id !== plan.workflowId ||
    workflow.input.projectId !== plan.projectId ||
    workflow.input.operation !== "season-plan"
  )
    return "workflow";
  const seen = new Set([plan.id]);
  let current = plan;
  while (current.origin === "human-reorder") {
    const id = current.sourcePlanId;
    if (!id || seen.has(id)) return "chain";
    seen.add(id);
    const parent = await read(id);
    if (
      parent.id !== id ||
      parent.projectId !== plan.projectId ||
      parent.workflowId !== plan.workflowId ||
      parent.sourceSnapshotId !== plan.sourceSnapshotId ||
      !sameFrozenSnapshot(immutableBasis(parent), immutableBasis(current))
    )
      return "parent";
    current = parent;
  }
  return current.origin === "model" &&
    current.sourceSnapshotId === workflow.sourceSnapshotId &&
    sameFrozenSnapshot(current.basis, workflow.seasonPlanBasis)
    ? undefined
    : "model";
}
