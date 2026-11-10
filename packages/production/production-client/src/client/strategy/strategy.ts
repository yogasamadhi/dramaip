import type {
  CreationGetResult,
  CreationStartInput,
} from "@dramaip/automation-automation/types";
import type {
  AdaptationStrategiesGetResult,
  AdaptationStrategiesSourcesResult,
} from "@dramaip/production-production/types";
import { isObject, onlyKeys, UUID } from "../tools/parse.ts";

export type Strategy = AdaptationStrategiesGetResult;
export type StrategyCatalog = AdaptationStrategiesSourcesResult;
export type StrategyRequest = NonNullable<
  CreationStartInput["adaptationStrategyRequest"]
>;
export type Workflow = CreationGetResult;

/** The copy keys of an option's five actions, in the order they show. */
export const STRATEGY_ACTIONS = [
  "preserve",
  "merge",
  "remove",
  "reorder",
  "restructure",
] as const;

/**
 * The strategy run a link names, when it is this project's strategy run
 * with a frozen request and, if a strategy is named, produced that one.
 */
export function originalStrategyWorkflow(
  workflow: Workflow | undefined,
  requested: { projectId: string; workflowId: string; strategyId?: string },
): Workflow | undefined {
  return workflow &&
    workflow.id === requested.workflowId &&
    workflow.input.projectId === requested.projectId &&
    workflow.input.operation === "adaptation-strategy" &&
    workflow.input.adaptationStrategyRequest &&
    (!requested.strategyId ||
      workflow.adaptationStrategyId === requested.strategyId)
    ? workflow
    : undefined;
}

/**
 * The strategy a link names, when it is this project's and, with a run
 * named, that run produced it from the same diagnosis and adopted base.
 */
export function originalStrategyCandidate(
  strategy: Strategy | undefined,
  requested: { projectId: string; strategyId: string; workflowId?: string },
  workflow?: Workflow,
): Strategy | undefined {
  if (
    !strategy ||
    strategy.projectId !== requested.projectId ||
    strategy.id !== requested.strategyId
  )
    return undefined;
  if (!requested.workflowId) return strategy;
  const request = workflow?.input.adaptationStrategyRequest;
  return strategy.workflowId === requested.workflowId &&
    workflow?.id === requested.workflowId &&
    workflow.adaptationStrategyId === strategy.id &&
    request?.diagnosis.id === strategy.basis.diagnosis.id &&
    request.diagnosis.version === strategy.basis.diagnosis.version &&
    request.baseAdoptedId === strategy.basis.baseAdoptedId
    ? strategy
    : undefined;
}

/** A strategy request exactly as the owner takes it, or undefined. */
function parseRequest(item: unknown): StrategyRequest | undefined {
  if (!isObject(item) || !onlyKeys(item, ["diagnosis", "baseAdoptedId"]))
    return undefined;
  const { diagnosis, baseAdoptedId } = item;
  if (
    !isObject(diagnosis) ||
    !onlyKeys(diagnosis, ["id", "version"]) ||
    typeof diagnosis.id !== "string" ||
    !UUID.test(diagnosis.id) ||
    !Number.isInteger(diagnosis.version) ||
    (diagnosis.version as number) < 1
  )
    return undefined;
  if (
    baseAdoptedId !== undefined &&
    (typeof baseAdoptedId !== "string" || !UUID.test(baseAdoptedId))
  )
    return undefined;
  return {
    diagnosis: { id: diagnosis.id, version: diagnosis.version as number },
    ...(baseAdoptedId === undefined ? {} : { baseAdoptedId }),
  };
}

/** The storage key of a project's confirmed strategy sources. */
export const confirmationKey = (projectId: string) =>
  `dramaip-strategy-source-confirmation:${projectId}`;

/** The confirmation record this version writes. */
export const confirmationRecord = (
  projectId: string,
  request: StrategyRequest,
) =>
  JSON.stringify({
    format: "strategy-source-confirmation-v1",
    projectId,
    request,
  });

/** The request a saved confirmation of this project holds, or undefined. */
export function parseStrategyConfirmation(
  raw: string | null,
  projectId: string,
): StrategyRequest | undefined {
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    return isObject(saved) &&
      saved.format === "strategy-source-confirmation-v1" &&
      saved.projectId === projectId
      ? parseRequest(saved.request)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The confirmed request still names the catalog's diagnosis and base. */
export function strategyConfirmationMatchesSource(
  request: StrategyRequest | undefined,
  source: StrategyCatalog | undefined,
): boolean {
  return Boolean(
    request &&
    source?.diagnosis &&
    request.diagnosis.id === source.diagnosis.id &&
    request.diagnosis.version === source.diagnosis.version &&
    request.baseAdoptedId === source.adoptedStrategyId,
  );
}

/** The request the catalog's diagnosis and adopted strategy make, or undefined. */
export function strategyRequest(
  source: StrategyCatalog,
): StrategyRequest | undefined {
  return source.diagnosis
    ? parseRequest({
        diagnosis: source.diagnosis,
        ...(source.adoptedStrategyId === undefined
          ? {}
          : { baseAdoptedId: source.adoptedStrategyId }),
      })
    : undefined;
}
