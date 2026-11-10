import type {
  ChangePreview,
  CreationInput,
  CreationWorkflow,
} from "./remote.ts";

/** The frozen requests a run binds, each compared as it was submitted. */
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

/** Members that may be absent or explicitly undefined. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

/** What a workbench is scoped to: the run it may show or start. */
export type CreationWorkbenchScope = Pick<
  CreationInput,
  "projectId" | "operation"
> &
  Loose<
    Pick<
      CreationInput,
      | "targetId"
      | "language"
      | "reviewPackageId"
      | "feedbackClusterId"
      | "sourceIds"
      | (typeof requestKeys)[number]
    >
  > & {
    narrativePlanningRequired?: boolean | undefined;
  };

/**
 * A value with object members sorted and absent members dropped; array order
 * and every actual value stay significant.
 * @param value - the value.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/**
 * Whether two frozen snapshots are the same: member order is not a change,
 * and an absent side never matches.
 * @param left - one snapshot.
 * @param right - the other.
 */
export function sameFrozenSnapshot(left: unknown, right: unknown): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  );
}

/**
 * The key of a workbench scope. Source scope and drafting are separate: a
 * changed target version keeps the old draft, so its explicit merge can run.
 * @param scope - the scope.
 */
export function creationWorkbenchScopeKey(
  scope: CreationWorkbenchScope,
): string {
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

/**
 * Whether a run belongs to the workbench's scope: its identity, project,
 * operation, target and every frozen request it binds.
 * @param value - the run, if read.
 * @param scope - the scope, and the run it must be if one is named.
 */
export function matchesCreationWorkbenchWorkflow(
  value: CreationWorkflow | undefined,
  scope: CreationWorkbenchScope & { workflowId?: string | undefined },
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
    !sameFrozenSnapshot(value.input.sourceIds, scope.sourceIds)
  )
    return false;
  for (const key of requestKeys)
    if (
      scope[key] !== undefined &&
      !sameFrozenSnapshot(value.input[key], scope[key])
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
  // A missing historical basis stays missing; recorded evidence never binds
  // another request because the operation and project happen to match.
  return bindings.every(
    ([basis, request]) =>
      basis === undefined || sameFrozenSnapshot(basis, request),
  );
}

/**
 * Whether a preview is the one a run declares: its identity, project, task,
 * engine, operation and the single target the draft writes.
 * @param value - the preview, if read.
 * @param workflow - the run, if read.
 */
export function matchesCreationWorkbenchPreview(
  value: ChangePreview | undefined,
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
  const record = (item: unknown): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item);
  if (workflow.input.operation === "chapter")
    return (
      target.kind === "chapter" &&
      target.id === workflow.input.targetId &&
      typeof target.patch.content === "string" &&
      record(target.displayDiff) &&
      target.displayDiff.creationWorkflowId === workflow.id
    );
  return (
    target.kind === "creation" &&
    target.id === workflow.id &&
    target.patch.workflowId === workflow.id
  );
}

/**
 * The SHA-256 of a text, as lowercase hex.
 * @param text - the text.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The manifest JSON a context snapshot's fingerprint covers: members sorted,
 * absent members dropped, written without spaces.
 * @param value - the manifest.
 */
export function manifestJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(manifestJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${manifestJSON(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
