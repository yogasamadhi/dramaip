import { expect, test } from "bun:test";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AdaptationStrategy } from "@dramaip/contracts/production";
import {
  readOriginalStrategyWorkflow,
  readOriginalStrategyCandidate,
  successfulStrategyOwnerRead,
  strategyNavigationError,
  parseStrategyConfirmation,
  strategyConfirmationMatchesSource,
} from "./strategy-exact-navigation";
const workflow = {
  id: "original-run",
  input: {
    projectId: "project",
    operation: "adaptation-strategy",
    adaptationStrategyRequest: { diagnosis: { id: "diagnosis", version: 2 } },
  },
  adaptationStrategyId: "original-strategy",
} as CreationWorkflow;
const candidate = {
  id: "original-strategy",
  projectId: "project",
  workflowId: "original-run",
  sourceState: "stale",
  basis: { diagnosis: workflow.input.adaptationStrategyRequest!.diagnosis },
} as AdaptationStrategy;
const read = { status: "success", isFetchedAfterMount: true };
const scope = {
  projectId: "project",
  workflowId: workflow.id,
  strategyId: candidate.id,
};
test("独立策略原运行逐项核对实际组合，源变不替换原快照", () => {
  expect(readOriginalStrategyWorkflow({ ...read, data: workflow }, scope)).toBe(
    workflow,
  );
  for (const other of [
    { ...scope, projectId: "other" },
    { ...scope, workflowId: "new" },
    { ...scope, strategyId: "new" },
  ])
    expect(
      readOriginalStrategyWorkflow({ ...read, data: workflow }, other),
    ).toBeUndefined();
  expect(
    readOriginalStrategyWorkflow(
      {
        ...read,
        data: {
          ...workflow,
          input: { ...workflow.input, operation: "season-plan" },
        },
      },
      scope,
    ),
  ).toBeUndefined();
});
test("独立策略原候选必须绑定实际ID和原运行，只有候选链接也不找最新", () => {
  expect(
    readOriginalStrategyCandidate(
      { ...read, data: candidate },
      scope,
      workflow,
    ),
  ).toBe(candidate);
  expect(
    readOriginalStrategyCandidate(
      { ...read, data: candidate },
      { projectId: scope.projectId, strategyId: scope.strategyId },
    ),
  ).toBe(candidate);
  for (const other of [
    { ...scope, projectId: "other" },
    { ...scope, workflowId: "new" },
    { ...scope, strategyId: "new" },
  ])
    expect(
      readOriginalStrategyCandidate(
        { ...read, data: candidate },
        other,
        workflow,
      ),
    ).toBeUndefined();
  expect(
    readOriginalStrategyCandidate({ ...read, data: candidate }, scope),
  ).toBeUndefined();
});
test("原运行和候选pending或error不回填缓存，本次未读和迟到原ID也不能复用", () => {
  for (const state of [
    { status: "pending" },
    { status: "error" },
    { error: new Error("实际来源读取失败") },
    { isFetchedAfterMount: false },
  ]) {
    expect(
      readOriginalStrategyWorkflow(
        { ...read, data: workflow, ...state },
        scope,
      ),
    ).toBeUndefined();
    expect(
      readOriginalStrategyCandidate(
        { ...read, data: candidate, ...state },
        scope,
        workflow,
      ),
    ).toBeUndefined();
  }
  expect(successfulStrategyOwnerRead({ ...read, data: candidate })).toBe(
    candidate,
  );
});
test("重复或空白原身份拒绝，不退回无原ID目录", () => {
  for (const search of [
    "strategyId=",
    "workflowId=%20",
    "strategyId=old&strategyId=old",
    "workflowId=old&workflowId=new",
  ])
    expect(strategyNavigationError(new URLSearchParams(search))).toBeTruthy();
  expect(
    strategyNavigationError(
      new URLSearchParams("workflowId=old&strategyId=original"),
    ),
  ).toBeUndefined();
});

test("同原运行但冻结诊断或原采用基准不一致也不能回填", () => {
  expect(
    readOriginalStrategyCandidate(
      {
        ...read,
        data: {
          ...candidate,
          basis: {
            ...candidate.basis,
            diagnosis: { ...candidate.basis.diagnosis, version: 3 },
          },
        },
      },
      scope,
      workflow,
    ),
  ).toBeUndefined();
  expect(
    readOriginalStrategyCandidate(
      {
        ...read,
        data: {
          ...candidate,
          basis: { ...candidate.basis, baseAdoptedId: "different" },
        },
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
