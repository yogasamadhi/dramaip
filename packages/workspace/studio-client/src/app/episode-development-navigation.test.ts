import { expect, test } from "vitest";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";
import {
  episodeDevelopmentReferenceKey,
  episodeDevelopmentNavigationError,
  matchesEpisodeWorkflow,
  readExactEpisodeResult,
  readExactEpisodeWorkflow,
  readEpisodeWorkbenchWorkflow,
  sameEpisodeDevelopmentRequest,
  newEpisodeConfirmationSearch,
} from "./episode-development-navigation";

const requested = {
  projectId: "project",
  episodeId: "episode-original",
  operation: "episode-script",
  workflowId: "run-original",
};
const request = { episodeId: requested.episodeId };
const workflow = {
  id: requested.workflowId,
  input: {
    projectId: requested.projectId,
    operation: requested.operation,
    episodeDevelopmentRequest: request,
  },
  episodeDevelopmentBasis: { request },
} as CreationWorkflow;
const read = {
  status: "success",
  isFetching: false,
  isFetchedAfterMount: true,
};

test("新来源链接必须精确原结果／分集／操作，重复、混用及错误 UUID 都拒绝", () => {
  const id = "92000000-0000-4000-8000-000000000001",
    result = "92000000-0000-4000-8000-000000000002";
  const exact = `?sourceRevisionId=${id}&resultId=${result}&episodeId=original&operation=episode-script`;
  expect(
    episodeDevelopmentNavigationError(new URLSearchParams(exact)),
  ).toBeUndefined();
  for (const search of [
    `?sourceRevisionId=${id}`,
    exact.replace(result, "bad"),
    exact.replace(id, "bad"),
    exact.replace("episode-script", "episode-outline"),
    `${exact}&workflowId=run`,
    `${exact}&sourceRevisionId=${id}`,
    `${exact}&topologyRevisionId=${id}`,
  ])
    expect(
      episodeDevelopmentNavigationError(new URLSearchParams(search)),
    ).toBeTruthy();
  expect(episodeDevelopmentReferenceKey(exact)).not.toBe(
    episodeDevelopmentReferenceKey(exact.replace(id, result)),
  );
});

test("单集目录切换隔离本地选择，查询顺序稳定而重复身份不合并", () => {
  const original = "?operation=episode-script&episodeId=episode&workflowId=old";
  expect(episodeDevelopmentReferenceKey(original)).toBe(
    episodeDevelopmentReferenceKey(
      "?workflowId=old&episodeId=episode&operation=episode-script",
    ),
  );
  for (const changed of [
    "?operation=storyboard-package&episodeId=episode&workflowId=old",
    "?operation=episode-script&episodeId=other&workflowId=old",
    "?operation=episode-script&episodeId=episode&workflowId=new",
    `${original}&episodeId=episode`,
  ])
    expect(episodeDevelopmentReferenceKey(changed)).not.toBe(
      episodeDevelopmentReferenceKey(original),
    );
});

test("显式空白、重复和未知操作不退回普通来源或默认操作", () => {
  for (const search of [
    "?episodeId=",
    "?operation=unsupported",
    "?operation=episode-script&operation=episode-script",
    "?resultId=original&resultId=other",
    "?workflowId=%20",
  ])
    expect(
      episodeDevelopmentNavigationError(new URLSearchParams(search)),
    ).toBeTruthy();
  expect(
    episodeDevelopmentNavigationError(new URLSearchParams()),
  ).toBeUndefined();
});
test("人工镜头关联深链接必须明确原分镜，不和模型运行或其他操作混用", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  for (const search of [
    `?shotAttributionId=${id}`,
    `?shotAttributionId=${id}&resultId=original&operation=episode-script`,
    `?shotAttributionId=${id}&resultId=original&workflowId=old`,
    "?shotAttributionId=bad&resultId=original",
  ])
    expect(
      episodeDevelopmentNavigationError(new URLSearchParams(search)),
    ).toBeTruthy();
  expect(
    episodeDevelopmentNavigationError(
      new URLSearchParams(
        `?shotAttributionId=${id}&resultId=original&operation=storyboard-package`,
      ),
    ),
  ).toBeUndefined();
  expect(
    episodeDevelopmentReferenceKey(
      `?resultId=original&shotAttributionId=${id}`,
    ),
  ).not.toBe(episodeDevelopmentReferenceKey("?resultId=original"));
});

test("原运行绑定自身身份、项目、操作、分集与原冻结请求，历史缺基准不补造", () => {
  expect(matchesEpisodeWorkflow(workflow, requested)).toBe(true);
  for (const foreign of [
    { ...requested, projectId: "other" },
    { ...requested, workflowId: "new" },
    { ...requested, episodeId: "later" },
    { ...requested, operation: "storyboard-package" },
  ])
    expect(matchesEpisodeWorkflow(workflow, foreign)).toBe(false);
  expect(
    matchesEpisodeWorkflow(
      { ...workflow, episodeDevelopmentBasis: undefined },
      requested,
    ),
  ).toBe(true);
  expect(
    matchesEpisodeWorkflow(
      {
        ...workflow,
        episodeDevelopmentBasis: {
          ...workflow.episodeDevelopmentBasis!,
          request: { ...request, episodeId: "changed" },
        },
      },
      requested,
    ),
  ).toBe(false);
  expect(
    matchesEpisodeWorkflow(
      { ...workflow, input: { ...workflow.input, operation: "chapter" } },
      requested,
    ),
  ).toBe(false);
  expect(matchesEpisodeWorkflow(undefined, requested)).toBe(false);
});

test("原运行恢复要求本次实际成功读取，错误、待取与迟到异作用域缓存不恢复", () => {
  expect(readExactEpisodeWorkflow({ ...read, data: workflow }, requested)).toBe(
    workflow,
  );
  for (const state of [
    { error: new Error("本次原运行不可读") },
    { status: "error" },
    { status: "pending" },
    { isFetching: true },
    { isFetchedAfterMount: false },
  ])
    expect(
      readExactEpisodeWorkflow(
        { ...read, data: workflow, ...state },
        requested,
      ),
    ).toBeUndefined();
  expect(
    readExactEpisodeWorkflow(
      { ...read, data: workflow },
      { ...requested, workflowId: "later" },
    ),
  ).toBeUndefined();
});

test("正式原快照首读缓存不可见，失败隐藏；后续后台复核保留实际原快照而不改身份", () => {
  const result = {
    ...requested,
    id: "original",
    sourceState: "stale",
  } as EpisodeDevelopmentResult;
  const expected = { ...requested, resultId: result.id };
  expect(readExactEpisodeResult({ ...read, data: result }, expected)).toBe(
    result,
  );
  expect(
    readExactEpisodeResult(
      { ...read, data: result, isFetching: true },
      expected,
    ),
  ).toBe(result);
  for (const state of [
    { isFetchedAfterMount: false },
    { status: "pending" },
    { status: "error" },
    { error: new Error("本次正式结果不可读") },
  ])
    expect(
      readExactEpisodeResult({ ...read, data: result, ...state }, expected),
    ).toBeUndefined();
  for (const scope of [
    { ...expected, episodeId: "other" },
    { ...expected, projectId: "other" },
    { ...expected, operation: "episode-outline" },
    { ...expected, workflowId: "other" },
    { ...expected, resultId: "latest" },
  ])
    expect(
      readExactEpisodeResult({ ...read, data: result }, scope),
    ).toBeUndefined();
});

test("单集运行轮询只展示本次读过的同一完整请求，迟到同集不同请求也不回填", () => {
  const expected = {
    ...requested,
    request: workflow.input.episodeDevelopmentRequest!,
  };
  expect(
    readEpisodeWorkbenchWorkflow({ ...read, data: workflow }, expected),
  ).toBe(workflow);
  expect(
    readEpisodeWorkbenchWorkflow(
      { ...read, data: workflow, isFetching: true },
      expected,
    ),
  ).toBe(workflow);
  for (const state of [
    { status: "pending" },
    { isFetchedAfterMount: false },
    { error: new Error("原运行复核失败") },
  ])
    expect(
      readEpisodeWorkbenchWorkflow(
        { ...read, data: workflow, ...state },
        expected,
      ),
    ).toBeUndefined();
  expect(
    readEpisodeWorkbenchWorkflow(
      { ...read, data: workflow },
      {
        ...expected,
        request: { ...expected.request, baseScriptDocumentVersion: 999 },
      },
    ),
  ).toBeUndefined();
  expect(
    readEpisodeWorkbenchWorkflow(
      { ...read, data: { ...workflow, id: "late-other-run" } },
      expected,
    ),
  ).toBeUndefined();
});

test("冻结请求对象序列化顺序可不同，镜头数组顺序和任一版本不能忽略", () => {
  const a = {
    ...request,
    baseScriptDocumentVersion: 3,
    redoShots: [
      { shotId: "first", recordId: "first-row", version: 1 },
      { shotId: "second", recordId: "second-row", version: 2 },
    ],
  };
  const b = {
    redoShots: a.redoShots.map(({ version, recordId, shotId }) => ({
      version,
      recordId,
      shotId,
    })),
    baseScriptDocumentVersion: 3,
    episodeId: request.episodeId,
  };
  expect(sameEpisodeDevelopmentRequest(a, b)).toBe(true);
  expect(
    sameEpisodeDevelopmentRequest(a, {
      ...b,
      redoShots: [...b.redoShots].reverse(),
    }),
  ).toBe(false);
  expect(
    sameEpisodeDevelopmentRequest(a, { ...b, baseScriptDocumentVersion: 4 }),
  ).toBe(false);
});

test("仅明确新基准确认才退出旧运行链接，原身份和原基准不重绑", () => {
  const search = `workflowId=${workflow.id}&episodeId=${request.episodeId}&operation=episode-script`;
  const confirmed = { operation: "episode-script", request };
  expect(
    newEpisodeConfirmationSearch(search, confirmed, workflow),
  ).toBeUndefined();
  const next = new URLSearchParams(
    newEpisodeConfirmationSearch(
      search,
      {
        operation: "storyboard-package",
        request: { ...request, baseScriptDocumentVersion: 4 },
      },
      workflow,
    ),
  );
  expect(next.has("workflowId")).toBe(false);
  expect(next.get("operation")).toBe("storyboard-package");
  expect(next.get("episodeId")).toBe(request.episodeId);
  expect(workflow.input.episodeDevelopmentRequest).toEqual(request);
  expect(
    newEpisodeConfirmationSearch("operation=episode-script", confirmed),
  ).toBeUndefined();
});
