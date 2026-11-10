import type {
  CreationInput,
  CreationWorkflow,
} from "@dramaip/contracts/creation";
import type { ChangePreview } from "@dramaip/contracts/product";
import {
  sameFrozenOwnerSnapshot,
  successfulOwnerRead,
  type OwnerRead,
} from "./current-owner-read";

const requestKeys = [
  "authorIntentRequest",
  "diagnosisRequest",
  "adaptationStrategyRequest",
  "seasonPlanRequest",
  "episodeDevelopmentRequest",
  "qualityReviewRequest",
  "narrativeContextRequest",
  "narrativePlanningRequest",
  "productionNarrativeRequest",
  "narrativeSummaryRequest",
] as const;

// Creation previews are owned by Automation and carry creation.<operation>,
// not the older AgentTaskType enum. Compare the actual string without changing
// that public contract or asserting an unsupported enum member into it.
export type CreationWorkbenchPreviewRead = Omit<ChangePreview, "taskType"> & {
  taskType?: string;
};

export type CreationWorkbenchScope = Pick<
  CreationInput,
  | "projectId"
  | "operation"
  | "targetId"
  | "language"
  | "reviewPackageId"
  | "feedbackClusterId"
> &
  Partial<Pick<CreationInput, "sourceIds" | (typeof requestKeys)[number]>> & {
    narrativePlanningRequired?: boolean;
  };

// Source scope and drafting are separate. Actual target version changes must
// retain the old candidate so the existing explicit merge can still run.
export function creationWorkbenchScopeKey(
  scope: CreationWorkbenchScope,
): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return JSON.stringify(
    canonical({
      projectId: scope.projectId,
      operation: scope.operation,
      targetId: scope.targetId,
      language: scope.language,
      reviewPackageId: scope.reviewPackageId,
      feedbackClusterId: scope.feedbackClusterId,
      sourceIds: scope.sourceIds ?? [],
      ...Object.fromEntries(requestKeys.map((key) => [key, scope[key]])),
      narrativePlanningRequired: Boolean(scope.narrativePlanningRequired),
    }),
  );
}

export function matchesCreationWorkbenchWorkflow(
  value: CreationWorkflow | undefined,
  scope: CreationWorkbenchScope & { workflowId?: string },
): boolean {
  if (
    !value ||
    (scope.workflowId && value.id !== scope.workflowId) ||
    value.input.projectId !== scope.projectId ||
    value.input.operation !== scope.operation ||
    value.input.targetId !== scope.targetId ||
    value.input.language !== scope.language ||
    value.input.reviewPackageId !== scope.reviewPackageId ||
    value.input.feedbackClusterId !== scope.feedbackClusterId ||
    (scope.narrativePlanningRequired && !value.narrativePlanningBasis) ||
    (scope.productionNarrativeRequest && !value.productionNarrativeBasis) ||
    Boolean(value.input.productionNarrativeRequest) !==
      Boolean(value.productionNarrativeBasis)
  )
    return false;
  if (
    scope.sourceIds !== undefined &&
    !sameFrozenOwnerSnapshot(value.input.sourceIds, scope.sourceIds)
  )
    return false;
  for (const key of requestKeys)
    if (
      scope[key] !== undefined &&
      !sameFrozenOwnerSnapshot(value.input[key], scope[key])
    )
      return false;
  const bindings = [
    [
      value.productionNarrativeBasis?.request,
      value.input.productionNarrativeRequest,
    ],
    [value.authorIntentBasis?.request, value.input.authorIntentRequest],
    [
      value.episodeDevelopmentBasis?.request,
      value.input.episodeDevelopmentRequest,
    ],
    [value.narrativeQualityBasis?.request, value.input.qualityReviewRequest],
    [
      value.narrativePlanningBasis?.request,
      value.input.narrativePlanningRequest,
    ],
    [value.narrativeSummaryBasis?.request, value.input.narrativeSummaryRequest],
  ];
  // Missing historical basis remains missing. Existing evidence cannot bind
  // another request just because the operation and project happen to match.
  return bindings.every(
    ([basis, request]) =>
      basis === undefined || sameFrozenOwnerSnapshot(basis, request),
  );
}

export function readCreationWorkbenchWorkflow(
  query: OwnerRead<CreationWorkflow>,
  scope: CreationWorkbenchScope & { workflowId: string },
): CreationWorkflow | undefined {
  const value = successfulOwnerRead(query);
  return matchesCreationWorkbenchWorkflow(value, scope) ? value : undefined;
}

export function matchesCreationWorkbenchPreview(
  value: CreationWorkbenchPreviewRead | undefined,
  workflow: CreationWorkflow | undefined,
): boolean {
  if (
    !value ||
    !workflow ||
    value.id !== workflow.previewId ||
    value.projectId !== workflow.input.projectId ||
    value.taskId !== workflow.taskId ||
    value.targets.length !== 1 ||
    (value.engineKind !== undefined &&
      value.engineKind !== workflow.input.engineKind) ||
    (value.taskType !== undefined &&
      value.taskType !== `creation.${workflow.input.operation}`)
  )
    return false;
  const target = value.targets[0]!;
  if (workflow.input.operation === "chapter")
    return (
      target.kind === "chapter" &&
      target.id === workflow.input.targetId &&
      typeof target.patch === "object" &&
      target.patch !== null &&
      !Array.isArray(target.patch) &&
      typeof (target.patch as { content?: unknown }).content === "string" &&
      typeof target.displayDiff === "object" &&
      target.displayDiff !== null &&
      !Array.isArray(target.displayDiff) &&
      (target.displayDiff as { creationWorkflowId?: unknown })
        .creationWorkflowId === workflow.id
    );
  return (
    target.kind === "creation" &&
    target.id === workflow.id &&
    typeof target.patch === "object" &&
    target.patch !== null &&
    !Array.isArray(target.patch) &&
    (target.patch as { workflowId?: unknown }).workflowId === workflow.id
  );
}
