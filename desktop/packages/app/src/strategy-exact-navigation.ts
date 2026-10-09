import type { CreationWorkflow } from "@dramaip/contracts/creation";
import {
  AdaptationStrategyRequestSchema,
  type AdaptationStrategy,
  type AdaptationStrategyRequest,
  type AdaptationStrategyCatalog,
} from "@dramaip/contracts/production";
import {
  matchesExactCreationWorkflow,
  matchesExactStageCandidate,
} from "./exact-object-navigation";

import { successfulOwnerRead, type OwnerRead } from "./current-owner-read";
export const successfulStrategyOwnerRead = successfulOwnerRead;

export function readOriginalStrategyWorkflow(
  query: OwnerRead<CreationWorkflow>,
  requested: { projectId: string; workflowId: string; strategyId?: string },
): CreationWorkflow | undefined {
  const value = successfulStrategyOwnerRead(query);
  return matchesExactCreationWorkflow(value, {
    projectId: requested.projectId,
    workflowId: requested.workflowId,
    operation: "adaptation-strategy",
  }) &&
    value.input.adaptationStrategyRequest &&
    (!requested.strategyId ||
      value.adaptationStrategyId === requested.strategyId)
    ? value
    : undefined;
}

export function readOriginalStrategyCandidate(
  query: OwnerRead<AdaptationStrategy>,
  requested: { projectId: string; strategyId: string; workflowId?: string },
  workflow?: CreationWorkflow,
): AdaptationStrategy | undefined {
  const value = successfulStrategyOwnerRead(query);
  return matchesExactStageCandidate(value, {
    projectId: requested.projectId,
    candidateId: requested.strategyId,
    workflowId: requested.workflowId,
  }) &&
    (!requested.workflowId ||
      (workflow?.id === requested.workflowId &&
        workflow.adaptationStrategyId === value.id &&
        workflow.input.adaptationStrategyRequest?.diagnosis.id ===
          value.basis.diagnosis.id &&
        workflow.input.adaptationStrategyRequest.diagnosis.version ===
          value.basis.diagnosis.version &&
        workflow.input.adaptationStrategyRequest.baseAdoptedId ===
          value.basis.baseAdoptedId))
    ? value
    : undefined;
}

export function parseStrategyConfirmation(
  raw: string | null,
  projectId: string,
): AdaptationStrategyRequest | undefined {
  try {
    const saved = JSON.parse(raw ?? "null");
    return saved?.format === "strategy-source-confirmation-v1" &&
      saved.projectId === projectId
      ? AdaptationStrategyRequestSchema.parse(saved.request)
      : undefined;
  } catch {
    return undefined;
  }
}

export function strategyConfirmationMatchesSource(
  request: AdaptationStrategyRequest | undefined,
  source: AdaptationStrategyCatalog | undefined,
): boolean {
  return Boolean(
    request &&
    source?.diagnosis &&
    request.diagnosis.id === source.diagnosis.id &&
    request.diagnosis.version === source.diagnosis.version &&
    request.baseAdoptedId === source.adoptedStrategyId,
  );
}

export function strategyNavigationError(
  params: URLSearchParams,
): string | undefined {
  return ["workflowId", "strategyId"].some((key) => {
    const values = params.getAll(key);
    return values.length > 1 || values.some((value) => !value.trim());
  })
    ? "指定独立策略链接含空白或重复身份；未改用最近候选。"
    : undefined;
}
