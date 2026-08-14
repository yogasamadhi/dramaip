import { expect, test } from "bun:test";
import type { AgentEngineDescriptor, AgentTaskDescriptor } from "@sdns/schema";
import {
  CONTEXT_ASSISTANT_REGISTRY,
  assertContextAssistantRegistry,
  contextAssistantPage,
  contextAssistantPreflight,
  contextAssistantProjectId,
  resolveContextAssistantActions,
} from "./context-assistant";

const catalog: AgentTaskDescriptor[] = Array.from(
  new Set(
    Object.values(CONTEXT_ASSISTANT_REGISTRY).flatMap((actions) =>
      actions.map((action) => action.taskType),
    ),
  ),
).map((id) => ({
  id,
  label: id,
  category: id === "chapter_diagnostic" ? "章节写作" : "项目与大纲",
  promptVersion: "test",
  writePolicy:
    id === "generate_video_asset_drafts" ||
    id === "plan_image_generation" ||
    id === "plan_video_generation"
      ? "provider-action-preview"
      : "change-preview",
  allowedTools: [],
}));

const availableEngine = {
  kind: "opencode",
  name: "OpenCode",
  version: "test",
  status: "available",
  isDefault: true,
  isBeta: false,
  capabilities: {
    streaming: true,
    interrupt: true,
    resume: true,
    fork: true,
    readOnlyMcp: true,
    structuredOutput: true,
    chatGptLogin: false,
    apiKeyLogin: true,
  },
} as AgentEngineDescriptor;

test("LM6-03 上下文注册表只引用权威任务目录，并为每个页面限制 1–3 个动作", () => {
  expect(() => assertContextAssistantRegistry(catalog)).not.toThrow();
  for (const [page, specs] of Object.entries(CONTEXT_ASSISTANT_REGISTRY)) {
    const resolved = resolveContextAssistantActions({
      page: page as keyof typeof CONTEXT_ASSISTANT_REGISTRY,
      catalog,
    });
    expect(resolved.missingTaskTypes).toEqual([]);
    expect(resolved.actions).toHaveLength(specs.length);
    expect(resolved.actions.map((action) => action.id)).toEqual(
      specs.map((spec) => spec.taskType),
    );
  }
});

test("LM6-03 从页面和项目上下文挑选同一条受控任务路由", () => {
  expect(contextAssistantPage("/projects/project-1")).toBe("project");
  expect(contextAssistantPage("/adapt")).toBe("adapt");
  expect(contextAssistantPage("/unknown")).toBe("home");
  expect(
    contextAssistantProjectId({
      pathname: "/projects/project%201",
      search: "",
    }),
  ).toBe("project 1");
  expect(
    contextAssistantProjectId({
      pathname: "/review",
      search: "?projectId=project-2",
    }),
  ).toBe("project-2");

  const simple = resolveContextAssistantActions({ page: "project", catalog })
    .actions[0]!;
  const advanced = catalog.find((task) => task.id === simple.id)!;
  expect(simple.id).toBe(advanced.id);
  expect(simple.promptVersion).toBe(advanced.promptVersion);
  expect(simple.writePolicy).toBe(advanced.writePolicy);
});

test("LM6-03 预检会阻止缺输入和不可用能力，并标出待预览确认的远程媒体成本", () => {
  const [chapterAction] = resolveContextAssistantActions({
    page: "project",
    catalog,
  }).actions;
  const providerAction = resolveContextAssistantActions({
    page: "produce",
    catalog,
  }).actions.find(
    (action) => action.writePolicy === "provider-action-preview",
  )!;

  const missingInput = contextAssistantPreflight({
    action: chapterAction!,
    projectId: "project-1",
    engine: availableEngine,
    modelId: "test-model",
  });
  expect(missingInput.ready).toBe(false);
  expect(missingInput.input).toBe("chapter-required");

  const unavailable = contextAssistantPreflight({
    action: chapterAction!,
    projectId: "project-1",
    chapterId: "chapter-1",
    engine: { ...availableEngine, status: "unavailable" },
    modelId: "test-model",
  });
  expect(unavailable.ready).toBe(false);
  expect(unavailable.capability).toBe("unavailable");

  const unknownCost = contextAssistantPreflight({
    action: providerAction,
    projectId: "project-1",
    engine: availableEngine,
    modelId: "test-model",
  });
  expect(unknownCost.ready).toBe(true);
  expect(unknownCost.cost).toBe("unknown");
});
