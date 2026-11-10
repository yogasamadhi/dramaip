// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../src/client/locale.ts";
import {
  CONTEXT_ACTIONS,
  assertContextActions,
  contextActions,
  contextPage,
  preflight,
  resultText,
  type TaskDefinition,
} from "../src/client/task-config/context-actions.ts";
import {
  TaskConfig,
  type AgentTaskConfigComponentProps,
} from "../src/client/task-config/TaskConfig.tsx";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"agents">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

/** Every task the action table names, in two categories. */
const CATALOG: TaskDefinition[] = [
  ...new Set(
    Object.values(CONTEXT_ACTIONS).flatMap((actions) =>
      actions.map((action) => action.taskType),
    ),
  ),
].map((id) => ({
  id,
  label: `任务 ${id}`,
  category: id === "chapter_diagnostic" ? "章节写作" : "项目规划",
  writePolicy: id.startsWith("plan_") ? "provider-action-preview" : "readonly",
}));

const ENGINES = [
  { kind: "pi", name: "Pi", status: "available" },
  { kind: "pi", name: "Pi", status: "unavailable" },
];

describe("context actions", () => {
  it("names one to three catalog tasks a page", () => {
    expect(() => assertContextActions(CATALOG)).not.toThrow();
    expect(() => assertContextActions(CATALOG.slice(1))).toThrow();
  });

  it("maps routes to pages and reports catalog gaps", () => {
    expect(contextPage("/projects/p-1/write")).toBe("project");
    expect(contextPage("/tasks")).toBe("tasks");
    expect(contextPage("/")).toBe("home");
    const { actions, missing } = contextActions(
      "tasks",
      CATALOG.filter((task) => task.id !== "generate_revision_tasks"),
    );
    expect(actions.map((action) => action.actionId)).toEqual([
      "retry-diagnostic",
    ]);
    expect(missing).toEqual(["generate_revision_tasks"]);
  });

  it("checks the project, chapter, engine, model and quote in turn", () => {
    const [diagnostic] = contextActions("tasks", CATALOG).actions;
    expect(
      preflight({ action: diagnostic!, engine: undefined }).fixes.map(
        (fix) => fix.key,
      ),
    ).toEqual(["fix.project", "fix.engine"]);
    expect(
      preflight({
        action: diagnostic!,
        projectId: "p-1",
        engine: ENGINES[1],
      }),
    ).toMatchObject({
      ready: false,
      input: "chapter-required",
      capability: "unavailable",
      fixes: [
        { key: "fix.chapter" },
        { key: "fix.engineStart", values: { name: "Pi" } },
      ],
    });
    expect(
      preflight({
        action: diagnostic!,
        projectId: "p-1",
        chapterId: "c-1",
        engine: ENGINES[0],
        modelId: "m",
      }),
    ).toMatchObject({ ready: true, cost: "not-applicable", fixes: [] });
    const [image] = contextActions("produce", CATALOG).actions.filter(
      (action) => action.actionId === "image-plan",
    );
    expect(
      preflight({
        action: image!,
        projectId: "p-1",
        engine: ENGINES[0],
        modelId: "m",
      }),
    ).toMatchObject({
      ready: true,
      cost: "unknown",
      fixes: [{ key: "fix.cost" }],
    });
  });

  it("finds a result's text through its common fields", () => {
    expect(resultText({ output: { summary: " 结论 " } })).toBe("结论");
    expect(resultText([{ parts: [{ text: "片段" }] }])).toBe("片段");
    expect(resultText({ count: 1 })).toBeUndefined();
  });
});

function agentsFace(own: Record<string, unknown> = {}) {
  return {
    enginesList: () => ok(ENGINES),
    enginesListTasks: () => ok(CATALOG),
    enginesGetProjectSettings: () =>
      ok({
        defaultEngineKind: "pi",
        defaultModel: { modelId: "model-x" },
        assistantMode: "simple",
      }),
    enginesUpdateProjectSettings: vi.fn(
      (_id: string, input: { assistantMode: string }) =>
        ok({ defaultEngineKind: "pi", assistantMode: input.assistantMode }),
    ),
    sessionsCreate: vi.fn(() => ok({ id: "s-1" })),
    sessionsRun: vi.fn(() => ok({ runId: "r-1", taskId: "task-12345678" })),
    sessionsGetRun: () => ok({ id: "r-1", status: "running" }),
    sessionsListItems: () =>
      ok([{ id: "i-1", type: "message", content: "第一段输出" }]),
    sessionsInterrupt: vi.fn(() => ok({ id: "r-1", status: "interrupted" })),
    experimentsCreate: vi.fn(() => ok({ id: "e-1" })),
    experimentsGet: () =>
      ok({
        id: "e-1",
        projectId: "p-1",
        status: "ready_for_review",
        comparisonMode: "recommended",
        revealed: false,
        candidates: [
          { candidate: "a", status: "succeeded", output: { summary: "甲" } },
          { candidate: "b", status: "succeeded", output: { summary: "乙" } },
        ],
      }),
    experimentsReview: vi.fn(() =>
      ok({
        id: "e-1",
        projectId: "p-1",
        status: "completed",
        comparisonMode: "recommended",
        revealed: false,
        candidates: [],
      }),
    ),
    ...own,
  };
}

function mount(
  options: {
    agents?: Record<string, unknown>;
    route?: string;
    intent?: { actionId: string; input?: string };
  } = {},
) {
  const agents = agentsFace(options.agents);
  const intent = {
    current: options.intent,
    clear: vi.fn(),
    save: vi.fn(),
  };
  const scope = {
    projects: [{ id: "p-1", title: "第一个项目" }],
    projectId: "p-1",
    select: vi.fn(),
  };
  const renderRun = vi.fn((id: string) => <p>{`run card ${id}`}</p>);
  const props = {
    t,
    agents,
    writing: {
      chaptersList: () => ok([{ id: "c-1", title: "第一章", content: "正文" }]),
    },
    production: {
      shotsList: () =>
        ok([
          {
            id: "shot-1",
            title: "雨夜追逐",
            payload: { 镜头描述: "主角奔跑" },
          },
        ]),
    },
    route: options.route ?? "/tasks",
    scope,
    intent,
    renderRun,
  } as unknown as AgentTaskConfigComponentProps;
  render(<TaskConfig {...props} />);
  return { agents, intent, scope, renderRun };
}

const panel = () => screen.getByLabelText("智能任务配置");

describe("the new-task settings", () => {
  it("offers this page's checked actions in the simple mode", async () => {
    mount();
    const recommended =
      await within(panel()).findByLabelText("当前页面推荐动作");
    await within(recommended).findByText("任务 chapter_diagnostic");
    expect(
      within(recommended).getByText("任务 generate_revision_tasks"),
    ).toBeTruthy();
    expect(within(panel()).queryByLabelText("智能引擎")).toBeNull();
    // The diagnostic works on a chapter, so it waits for one.
    expect(
      within(recommended).getAllByText("为此动作选择一个章节").length,
    ).toBe(1);
    expect(within(recommended).getAllByText("前往设置修复").length).toBe(1);
  });

  it("saves the assistant mode with the project's settings", async () => {
    const { agents } = mount();
    await within(panel()).findByLabelText("当前页面推荐动作");
    fireEvent.click(screen.getByRole("button", { name: "高级模式" }));
    await screen.findByText("已恢复完整任务目录和高级参数。");
    expect(agents.enginesUpdateProjectSettings).toHaveBeenCalledWith(
      "p-1",
      {
        defaultEngineKind: "pi",
        defaultModel: { modelId: "model-x" },
        assistantMode: "advanced",
      },
      undefined,
      undefined,
    );
    expect(screen.queryByLabelText("智能引擎")).toBeNull();
    expect(screen.queryByLabelText("盲测比较方式")).toBeNull();
    expect(screen.getByLabelText("本次模型（可选）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "简洁模式" }));
    await screen.findByText("已切换为当前页面的简洁助手。");
  });

  it("puts the mode back when saving it fails", async () => {
    mount({
      agents: {
        enginesUpdateProjectSettings: () =>
          Promise.resolve({ ok: false, error: { message: "保存失败" } }),
      },
    });
    await within(panel()).findByLabelText("当前页面推荐动作");
    fireEvent.click(screen.getByRole("button", { name: "高级模式" }));
    await screen.findByText("保存失败");
    expect(screen.getByLabelText("当前页面推荐动作")).toBeTruthy();
  });

  it("runs a recommended action with the shot's context and shows its items", async () => {
    const { agents } = mount({ route: "/tasks?shotId=shot-1" });
    await screen.findByLabelText("当前分镜上下文");
    const revision = await screen.findByRole("button", {
      name: "生成任务 generate_revision_tasks预览",
    });
    fireEvent.click(revision);
    await screen.findByText("任务 generate_revision_tasks任务已创建：task-123");
    expect(agents.sessionsCreate).toHaveBeenCalledWith(
      {
        projectId: "p-1",
        engineKind: "pi",
        taskType: "generate_revision_tasks",
        title: "任务 generate_revision_tasks",
        model: { modelId: "model-x" },
      },
      undefined,
      undefined,
    );
    expect(agents.sessionsRun).toHaveBeenCalledWith(
      "s-1",
      {
        taskType: "generate_revision_tasks",
        model: { modelId: "model-x" },
        prompt: "当前导演看板分镜：雨夜追逐\n镜头画面：主角奔跑",
      },
      undefined,
      undefined,
    );
    await screen.findByText("第一段输出");
    expect(screen.getByText("任务条目流")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中断任务" }));
    await screen.findByText("智能任务已中断");
    expect(screen.getByRole("button", { name: "恢复任务" })).toBeTruthy();
  });

  it("hands a creation run to its owner's card", async () => {
    const { renderRun } = mount({
      agents: {
        sessionsRun: () =>
          ok({ runId: "r-1", taskId: "task-1", workflowId: "w-1" }),
      },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "生成任务 generate_revision_tasks预览",
      }),
    );
    await screen.findByText("run card w-1");
    expect(renderRun).toHaveBeenCalledWith("w-1", "p-1");
    expect(screen.queryByText("任务条目流")).toBeNull();
  });

  it("keeps the action for settings and resumes it on return", async () => {
    const first = mount();
    fireEvent.click(await screen.findByText("前往设置修复"));
    expect(first.intent.save).toHaveBeenCalledWith({
      returnTo: "/tasks",
      projectId: "p-1",
      actionId: "retry-diagnostic",
    });
    cleanup();
    const second = mount({
      intent: { actionId: "revision-plan", input: "补足动机" },
    });
    const resume = await screen.findByRole("button", {
      name: "配置已完成，确认继续",
    });
    fireEvent.click(resume);
    expect(second.intent.clear).toHaveBeenCalled();
    await waitFor(() =>
      expect(second.agents.sessionsRun).toHaveBeenCalledWith(
        "s-1",
        expect.objectContaining({ prompt: "补足动机" }),
        undefined,
        undefined,
      ),
    );
  });
});
