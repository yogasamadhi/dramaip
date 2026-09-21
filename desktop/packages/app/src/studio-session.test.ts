import { expect, test } from "bun:test";
import type { Project } from "@dramaip/contracts/product";
import {
  contextualNavigationTarget,
  createCreationDraft,
  parseActiveProjectState,
  parseCreationDraft,
  parsePendingNavigationIntent,
  projectIdFromLocation,
  resolveActiveProjectId,
  safeLocalRoute,
  workspaceContextFromRoute,
} from "./studio-session";

const projects = [
  { id: "recent", title: "最近更新" },
  { id: "chosen", title: "明确选择" },
] as Project[];

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
