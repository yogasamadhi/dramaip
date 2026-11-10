import type { CreationWorkflow } from "@dramaip/contracts/creation";

const exactReferenceKeys = [
  "workflowId",
  "intentWorkflowId",
  "summaryWorkflowId",
  "summaryId",
  "resultId",
  "reportId",
  "localReviewId",
  "intentId",
  "diagnosisId",
  "strategyId",
  "seasonPlanId",
  "scriptRevisionId",
  "topologyRevisionId",
  "revisionId",
  "taskId",
  "providerActionPreviewId",
  "extractionId",
  "manuscriptId",
  "pilotPackageId",
  "shotAttributionId",
  "mediaSourceReviewId",
  "audioRevisionId",
  "audioResolutionId",
  "changeSetId",
] as const;

// Scope component-local selections to the declared object identities. Query
// order or ordinary directory controls are not a new exact object scope.
export function exactObjectReferenceKey(search: string): string {
  const params = new URLSearchParams(search);
  return JSON.stringify(
    exactReferenceKeys.flatMap((key) => {
      const values = params
        .getAll(key)
        .map((value) => value.trim())
        .filter(Boolean);
      return values.length ? [[key, values]] : [];
    }),
  );
}
export function hasExactObjectReference(search: string): boolean {
  return exactObjectReferenceKey(search) !== "[]";
}

export function resolveStageCandidateId(input: {
  requestedId?: string;
  requestedWorkflowId?: string;
  workflowCandidateId?: string;
  focusedId?: string;
  latestId?: string;
}): string | undefined {
  return (
    input.requestedId ??
    (input.requestedWorkflowId
      ? input.workflowCandidateId
      : (input.focusedId ?? input.latestId))
  );
}

export function matchesExactStageCandidate<
  T extends {
    id: string;
    projectId: string;
    workflowId: string;
  },
>(
  value: T | undefined,
  requested: {
    projectId: string;
    candidateId?: string;
    workflowId?: string;
  },
): value is T {
  return Boolean(
    value &&
    value.projectId === requested.projectId &&
    (!requested.candidateId || value.id === requested.candidateId) &&
    (!requested.workflowId || value.workflowId === requested.workflowId),
  );
}

export function matchesExactCreationWorkflow(
  value: CreationWorkflow | undefined,
  requested: {
    projectId: string;
    workflowId: string;
    operation: CreationWorkflow["input"]["operation"];
  },
): value is CreationWorkflow {
  return Boolean(
    value &&
    value.id === requested.workflowId &&
    value.input.projectId === requested.projectId &&
    value.input.operation === requested.operation,
  );
}
