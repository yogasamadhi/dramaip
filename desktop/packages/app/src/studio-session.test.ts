import { expect, test } from "vitest";
import type { Project } from "@dramaip/contracts/product";
import {
  contextualNavigationTarget,
  createCreationDraft,
  hasExactWorkflowReference,
  hasExactObjectReference,
  parseActiveProjectState,
  parseCreationDraft,
  parsePendingNavigationIntent,
  projectIdFromLocation,
  resolveActiveProjectId,
  safeLocalRoute,
  workspaceContextFromRoute,
  rememberedWorkspaceContext,
  hasExactWorkspaceReference,
} from "./studio-session";

const projects = [
  { id: "recent", title: "最近更新" },
  { id: "chosen", title: "明确选择" },
] as Project[];

test("精确工作流深链接保留原身份，不能因项目缓存缺失回退到最近项目", () => {
  expect(
    hasExactWorkflowReference("?projectId=unverified&workflowId=original"),
  ).toBe(true);
  expect(
    hasExactWorkflowReference("?workflowId=original&projectId=foreign"),
  ).toBe(true);
  expect(hasExactWorkflowReference("?projectId=missing")).toBe(false);
  expect(hasExactWorkflowReference("?workflowId=%20")).toBe(false);
});
test("正式来源与其他领域精确深链接保留指定对象，空值和普通目录仍按普通导航处理", () => {
  for (const key of [
    "resultId",
    "summaryId",
    "summaryWorkflowId",
    "intentWorkflowId",
    "reportId",
    "scriptRevisionId",
    "manuscriptId",
    "taskId",
    "extractionId",
    "mediaSourceReviewId",
    "audioRevisionId",
    "audioResolutionId",
    "changeSetId",
  ])
    expect(hasExactObjectReference(`?projectId=missing&${key}=original`)).toBe(
      true,
    );
  expect(
    hasExactObjectReference("?resultId=%20&summaryId=&projectId=missing"),
  ).toBe(false);
  expect(
    hasExactObjectReference("?projectId=missing&episodeId=directory"),
  ).toBe(false);
});

test("当前项目优先使用路由，其次明确选择，最后最近更新", () => {
  expect(
    resolveActiveProjectId({
      projects,
      routeProjectId: "chosen",
      storedProjectId: "recent",
    }),
  ).toBe("chosen");
  expect(resolveActiveProjectId({ projects, storedProjectId: "chosen" })).toBe(
    "chosen",
  );
  expect(resolveActiveProjectId({ projects, storedProjectId: "missing" })).toBe(
    "recent",
  );
});

test("旧项目位置记忆可升级，并按项目保存对象层级", () => {
  const upgraded = parseActiveProjectState(
    JSON.stringify({
      schemaVersion: 1,
      projectId: "p1",
      lastRouteByProject: { p1: "/projects/p1" },
      updatedAt: "2026-09-05T00:00:00.000Z",
    }),
  );
  expect(upgraded?.schemaVersion).toBe(2);
  expect(upgraded?.contextByProject).toEqual({});
  expect(
    workspaceContextFromRoute({
      pathname: "/produce",
      search: "?projectId=p1&episodeId=e1&shotId=s8",
    }),
  ).toMatchObject({
    workArea: "produce",
    episodeId: "e1",
    shotId: "s8",
  });
});

test("项目上下文可从查询参数和项目路径读取", () => {
  expect(
    projectIdFromLocation({ pathname: "/produce", search: "?projectId=p2" }),
  ).toBe("p2");
  expect(
    projectIdFromLocation({ pathname: "/projects/p%201", search: "" }),
  ).toBe("p 1");
});

test("项目感知导航只改写允许的工作区", () => {
  expect(contextualNavigationTarget("/write", "p1")).toBe("/projects/p1");
  expect(contextualNavigationTarget("/review", "p1")).toBe(
    "/review?projectId=p1",
  );
  expect(contextualNavigationTarget("/inspiration", "p1")).toBe("/inspiration");
  expect(safeLocalRoute("https://example.com")).toBeUndefined();
  expect(safeLocalRoute("//example.com")).toBeUndefined();
});

test("侧栏只传同项目实际资源路由身份，不混用正式 stable 分集或工作流", () => {
  const context = workspaceContextFromRoute({
    pathname: "/adapt",
    search:
      "?projectId=p1&episodeId=e1&scriptId=s1&shotId=h1&workflowId=private&stage=scripts",
  })!;
  expect(contextualNavigationTarget("/produce", "p1", context)).toBe(
    "/produce?projectId=p1&episodeId=e1&scriptId=s1&shotId=h1",
  );
  expect(contextualNavigationTarget("/review", "p2", context)).toBe(
    "/review?projectId=p2",
  );
  expect(contextualNavigationTarget("/tasks", "p1", context)).toBe(
    "/tasks?projectId=p1",
  );
  const formal = workspaceContextFromRoute({
    pathname: "/projects/p1/tools/episode-development",
    search: "?episodeId=stable-key&resultId=original",
  })!;
  expect(contextualNavigationTarget("/produce", "p1", formal)).toBe(
    "/produce?projectId=p1",
  );
  const tampered = {
    ...context,
    episodeId: "foreign",
    route: "https://example.com/?projectId=p1&episodeId=foreign",
  };
  expect(contextualNavigationTarget("/review", "p1", tampered)).toBe(
    "/review?projectId=p1",
  );
  expect(rememberedWorkspaceContext(context, formal)).toBe(context);
  const switched = workspaceContextFromRoute({
    pathname: "/review",
    search: "?projectId=p1&episodeId=other",
  })!;
  expect(rememberedWorkspaceContext(context, switched)).toBe(switched);
});

test("创作草稿按版本恢复，未知或损坏内容安全忽略", () => {
  const draft = createCreationDraft("project-home", "single_season");
  expect(parseCreationDraft(JSON.stringify(draft))?.draftId).toBe(
    draft.draftId,
  );
  expect(parseCreationDraft("{")).toBeUndefined();
  expect(
    parseCreationDraft(JSON.stringify({ ...draft, schemaVersion: 2 })),
  ).toBeUndefined();
});

test("实际工作区显式项目由 GET 核对，项目列表未知不替换链接", () => {
  for (const pathname of ["/adapt", "/produce", "/review"]) {
    expect(
      hasExactWorkspaceReference({ pathname, search: "?projectId=missing" }),
    ).toBe(true);
    expect(
      resolveActiveProjectId({
        projects,
        routeProjectId: "missing",
        storedProjectId: "chosen",
        preserveRouteIdentity: true,
      }),
    ).toBe("missing");
  }
  expect(
    hasExactWorkspaceReference({
      pathname: "/tasks",
      search: "?projectId=missing",
    }),
  ).toBe(false);
  for (const search of [
    "?chapterId=original",
    "?chapterId=",
    "?chapterId=a&chapterId=b",
  ])
    expect(
      hasExactWorkspaceReference({ pathname: "/projects/missing", search }),
    ).toBe(true);
});

test("素材优先草稿恢复确认目标的位置，旧草稿仍兼容", () => {
  const draft = createCreationDraft(
    "project-home",
    "single_season",
    "source-import",
  );
  expect(parseCreationDraft(JSON.stringify(draft))?.intakeStep).toBeUndefined();
  for (const intakeStep of [1, 2, 3] as const) {
    expect(
      parseCreationDraft(JSON.stringify({ ...draft, intakeStep }))?.intakeStep,
    ).toBe(intakeStep);
  }
  for (const intakeStep of [0, 4, "2", "unknown", null]) {
    expect(
      parseCreationDraft(JSON.stringify({ ...draft, intakeStep })),
    ).toBeUndefined();
  }
});

test("创建前原生预览草稿只恢复同一身份，不继承授权、正文或勾选", () => {
  const nativeScriptIntake = {
    previewId: crypto.randomUUID(),
    etag: '"exact:0"',
    requestKey: crypto.randomUUID(),
  };
  const draft = {
    ...createCreationDraft("project-home", "single_season", "script"),
    nativeScriptIntake,
  };
  expect(parseCreationDraft(JSON.stringify(draft))?.nativeScriptIntake).toEqual(
    nativeScriptIntake,
  );
  for (const extra of [
    { grantId: crypto.randomUUID() },
    { rightsDeclared: true },
    { blocks: [] },
    { request: {} },
  ])
    expect(
      parseCreationDraft(
        JSON.stringify({
          ...draft,
          nativeScriptIntake: { ...nativeScriptIntake, ...extra },
        }),
      ),
    ).toBeUndefined();
});

test("AI 返回意图过期或路由不合法时失效", () => {
  const now = Date.now();
  const intent = {
    schemaVersion: 1,
    kind: "ai-action",
    returnTo: "/projects/p1",
    actionId: "generate",
    createdAt: new Date(now).toISOString(),
  };
  expect(
    parsePendingNavigationIntent(JSON.stringify(intent), now)?.actionId,
  ).toBe("generate");
  expect(
    parsePendingNavigationIntent(
      JSON.stringify({ ...intent, returnTo: "https://example.com" }),
      now,
    ),
  ).toBeUndefined();
  expect(
    parsePendingNavigationIntent(
      JSON.stringify({
        ...intent,
        createdAt: new Date(now - 25 * 60 * 60 * 1_000).toISOString(),
      }),
      now,
    ),
  ).toBeUndefined();
});
