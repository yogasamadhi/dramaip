import { expect, test } from "bun:test";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import {
  exactObjectReferenceKey,
  hasExactObjectReference,
  resolveStageCandidateId,
  matchesExactStageCandidate,
  matchesExactCreationWorkflow,
} from "./exact-object-navigation";

test("exact identity scope is stable and keeps all declared references", () => {
  expect(exactObjectReferenceKey("?workflowId=old&seasonPlanId=order")).toBe(
    exactObjectReferenceKey(
      "?seasonPlanId=order&workflowId=old&episodeId=directory",
    ),
  );
  expect(
    exactObjectReferenceKey("?workflowId=new&seasonPlanId=order"),
  ).not.toBe(exactObjectReferenceKey("?workflowId=old&seasonPlanId=order"));
  expect(hasExactObjectReference("?summaryId=%20&episodeId=directory")).toBe(
    false,
  );
  expect(hasExactObjectReference("?pilotPackageId=original")).toBe(true);
  expect(hasExactObjectReference("?providerActionPreviewId=original-fee")).toBe(
    true,
  );
  expect(
    exactObjectReferenceKey("?providerActionPreviewId=original-fee"),
  ).not.toBe(exactObjectReferenceKey("?providerActionPreviewId=new-fee"));
  expect(exactObjectReferenceKey("?workflowId=old&workflowId=new")).not.toBe(
    exactObjectReferenceKey("?workflowId=old"),
  );
});
test("exact candidates and unknown workflows never fall back to local or latest selections", () => {
  const local = { focusedId: "selected", latestId: "latest" };
  expect(
    resolveStageCandidateId({
      ...local,
      requestedId: "old",
      requestedWorkflowId: "run",
    }),
  ).toBe("old");
  expect(
    resolveStageCandidateId({ ...local, requestedWorkflowId: "run" }),
  ).toBeUndefined();
  expect(
    resolveStageCandidateId({
      ...local,
      requestedWorkflowId: "run",
      workflowCandidateId: "original",
    }),
  ).toBe("original");
  expect(resolveStageCandidateId(local)).toBe("selected");
});
test("candidate and workflow ownership require each declared binding, not freshness", () => {
  const result = {
    id: "original",
    projectId: "project",
    workflowId: "run",
    sourceState: "stale",
  };
  expect(
    matchesExactStageCandidate(result, {
      projectId: "project",
      candidateId: "original",
      workflowId: "run",
    }),
  ).toBe(true);
  for (const requested of [
    { projectId: "foreign" },
    { projectId: "project", candidateId: "new" },
    { projectId: "project", workflowId: "other" },
  ])
    expect(matchesExactStageCandidate(result, requested)).toBe(false);
  const workflow = {
    id: "run",
    input: { projectId: "project", operation: "season-plan" },
  } as CreationWorkflow;
  expect(
    matchesExactCreationWorkflow(workflow, {
      projectId: "project",
      workflowId: "run",
      operation: "season-plan",
    }),
  ).toBe(true);
  expect(
    matchesExactCreationWorkflow(workflow, {
      projectId: "project",
      workflowId: "run",
      operation: "adaptation-diagnosis",
    }),
  ).toBe(false);
  expect(
    matchesExactCreationWorkflow(workflow, {
      projectId: "project",
      workflowId: "other",
      operation: "season-plan",
    }),
  ).toBe(false);
});
