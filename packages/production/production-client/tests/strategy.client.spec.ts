import { expect, test } from "vitest";
import {
  originalStrategyCandidate,
  originalStrategyWorkflow,
  parseStrategyConfirmation,
  strategyConfirmationMatchesSource,
  strategyRequest,
  type Strategy,
  type Workflow,
} from "../src/client/strategy/strategy.ts";
import { ambiguousNavigation } from "../src/client/tools/remote.ts";

const workflow = {
  id: "original-run",
  input: {
    projectId: "project",
    operation: "adaptation-strategy",
    adaptationStrategyRequest: { diagnosis: { id: "diagnosis", version: 2 } },
  },
  adaptationStrategyId: "original-strategy",
} as Workflow;
const candidate = {
  id: "original-strategy",
  projectId: "project",
  workflowId: "original-run",
  sourceState: "stale",
  basis: { diagnosis: workflow.input.adaptationStrategyRequest!.diagnosis },
} as Strategy;
const scope = {
  projectId: "project",
  workflowId: workflow.id,
  strategyId: candidate.id,
};

test("独立策略原运行逐项核对实际组合，源变不替换原快照", () => {
  expect(originalStrategyWorkflow(workflow, scope)).toBe(workflow);
  for (const other of [
    { ...scope, projectId: "other" },
    { ...scope, workflowId: "new" },
    { ...scope, strategyId: "new" },
  ])
    expect(originalStrategyWorkflow(workflow, other)).toBeUndefined();
  expect(
    originalStrategyWorkflow(
      { ...workflow, input: { ...workflow.input, operation: "season-plan" } },
      scope,
    ),
  ).toBeUndefined();
  expect(originalStrategyWorkflow(undefined, scope)).toBeUndefined();
});

test("独立策略原候选必须绑定实际ID和原运行，只有候选链接也不找最新", () => {
  expect(originalStrategyCandidate(candidate, scope, workflow)).toBe(candidate);
  expect(
    originalStrategyCandidate(candidate, {
      projectId: scope.projectId,
      strategyId: scope.strategyId,
    }),
  ).toBe(candidate);
  for (const other of [
    { ...scope, projectId: "other" },
    { ...scope, workflowId: "new" },
    { ...scope, strategyId: "new" },
  ])
    expect(
      originalStrategyCandidate(candidate, other, workflow),
    ).toBeUndefined();
  expect(originalStrategyCandidate(candidate, scope)).toBeUndefined();
  expect(originalStrategyCandidate(undefined, scope, workflow)).toBeUndefined();
});

test("重复或空白原身份拒绝，不退回无原ID目录", () => {
  const keys = ["workflowId", "strategyId"];
  for (const search of [
    "strategyId=",
    "workflowId=%20",
    "strategyId=old&strategyId=old",
    "workflowId=old&workflowId=new",
  ])
    expect(ambiguousNavigation(new URLSearchParams(search), keys)).toBe(true);
  expect(
    ambiguousNavigation(
      new URLSearchParams("workflowId=old&strategyId=original"),
      keys,
    ),
  ).toBe(false);
});

test("同原运行但冻结诊断或原采用基准不一致也不能回填", () => {
  expect(
    originalStrategyCandidate(
      {
        ...candidate,
        basis: {
          ...candidate.basis,
          diagnosis: { ...candidate.basis.diagnosis, version: 3 },
        },
      },
      scope,
      workflow,
    ),
  ).toBeUndefined();
  expect(
    originalStrategyCandidate(
      {
        ...candidate,
        basis: { ...candidate.basis, baseAdoptedId: "different" },
      },
      scope,
      workflow,
    ),
  ).toBeUndefined();
});

test("显式来源确认只恢复同项目同格式合法原请求，当前来源变化不重绑", () => {
  const request = {
    diagnosis: { id: "00000000-0000-4000-8000-000000000001", version: 2 },
  };
  const saved = {
    format: "strategy-source-confirmation-v1",
    projectId: "project",
    request,
  };
  expect(parseStrategyConfirmation(JSON.stringify(saved), "project")).toEqual(
    request,
  );
  for (const raw of [
    null,
    "{",
    JSON.stringify({ ...saved, projectId: "other" }),
    JSON.stringify({ ...saved, format: "legacy" }),
    JSON.stringify({
      ...saved,
      request: { diagnosis: { ...request.diagnosis, version: -1 } },
    }),
    JSON.stringify({ ...saved, request: { ...request, extra: true } }),
    JSON.stringify({
      ...saved,
      request: { ...request, baseAdoptedId: "not-a-uuid" },
    }),
  ])
    expect(parseStrategyConfirmation(raw, "project")).toBeUndefined();
  const source = { projectId: "project", diagnosis: request.diagnosis };
  expect(strategyConfirmationMatchesSource(request, source)).toBe(true);
  expect(
    strategyConfirmationMatchesSource(request, {
      ...source,
      diagnosis: { ...request.diagnosis, version: 3 },
    }),
  ).toBe(false);
  expect(
    strategyConfirmationMatchesSource(request, {
      ...source,
      adoptedStrategyId: "new",
    }),
  ).toBe(false);
  expect(strategyConfirmationMatchesSource(request, undefined)).toBe(false);
});

test("来源确认只由有效诊断和原采用头组成", () => {
  const diagnosis = { id: "00000000-0000-4000-8000-000000000001", version: 2 };
  const base = "00000000-0000-4000-8000-000000000002";
  expect(strategyRequest({ projectId: "p" })).toBeUndefined();
  expect(strategyRequest({ projectId: "p", diagnosis })).toEqual({ diagnosis });
  expect(
    strategyRequest({ projectId: "p", diagnosis, adoptedStrategyId: base }),
  ).toEqual({ diagnosis, baseAdoptedId: base });
});
