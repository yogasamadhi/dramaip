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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantTimeline } from "../src/client/assistant/AssistantTimeline.tsx";
import { MessageContent } from "../src/client/assistant/MessageContent.tsx";
import type { AssistantDetail } from "../src/client/assistant/types.ts";
import {
  InspirationSpace,
  type InspirationConversionProps,
} from "../src/client/inspiration/InspirationSpace.tsx";
import type { InspirationRemotes } from "../src/client/inspiration/records.ts";
import { memoryJobStatus } from "../src/client/inspiration/SidePanels.tsx";
import { zh } from "../src/client/locale.ts";
import { executionTime } from "../src/client/task-config/copy.ts";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"agents">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const FINGERPRINT = {
  enabled: false,
  dimensions: [
    {
      key: "production_complexity",
      score: 0.4,
      confidence: 0.5,
      frozen: false,
      evidenceIds: [],
    },
  ],
  avoidances: [],
  goals: [],
  version: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function detail(id: string, extra: Partial<AssistantDetail> = {}) {
  return {
    conversation: {
      id,
      title: `对话 ${id}`,
      creativeMode: "guided",
      webAccessMode: "off" as const,
    },
    turns: [],
    runs: [],
    items: [],
    ...extra,
  };
}

function remotes(options: { consentedAt?: string } = {}) {
  const agents = {
    enginesList: vi.fn(() =>
      ok([{ kind: "pi", isDefault: true, canRun: true }]),
    ),
    assistantWebResearchSettingsGet: vi.fn(() => ok({ consented: false })),
    assistantWebResearchSettingsUpdate: vi.fn((input: { consented: boolean }) =>
      ok(input),
    ),
    assistantConversationsList: vi.fn((query: { archived?: string }) =>
      ok(
        query.archived
          ? [{ id: "old" }]
          : [
              { id: "a", title: "第一段", creativeMode: "free" },
              { id: "b", title: "第二段", creativeMode: "guided" },
            ],
      ),
    ),
    assistantConversationsGet: vi.fn((id: string) => ok(detail(id))),
    assistantConversationsCreate: vi.fn((input: Record<string, unknown>) =>
      ok({ id: "new", ...input }),
    ),
    assistantConversationsUpdate: vi.fn(
      (id: string, input: Record<string, unknown>) =>
        ok({ ...detail(id).conversation, ...input }),
    ),
    assistantConversationsSendMessage: vi.fn(() => ok({})),
    assistantConversationsRemove: vi.fn(() => ok(undefined)),
    sessionsFork: vi.fn(() => ok({ id: "fork" })),
    sessionsInterrupt: vi.fn(() => ok({})),
    inspirationMemorySettingsGet: vi.fn(() =>
      ok({ enabled: false, consentedAt: options.consentedAt }),
    ),
    inspirationMemorySettingsUpdate: vi.fn((input: { enabled: boolean }) =>
      ok({ ...input, consentedAt: "2026-11-02T00:00:00.000Z" }),
    ),
    inspirationMemoriesList: vi.fn(() => ok([])),
    inspirationCardsList: vi.fn(() =>
      ok([
        {
          id: "card-1",
          kind: "premise",
          title: "旧书店",
          content: "旧书店里的信",
          adopted: true,
          version: 2,
        },
      ]),
    ),
    inspirationCardsCreate: vi.fn((input: Record<string, unknown>) =>
      ok({ id: "card-2", adopted: false, version: 1, ...input }),
    ),
    inspirationCardsUpdate: vi.fn(),
    inspirationMemoryJobsList: vi.fn(() => ok([])),
    inspirationMemoriesUpdate: vi.fn(),
    inspirationMemoriesRebuild: vi.fn(() => ok({})),
    inspirationMemoriesClear: vi.fn(() => ok(undefined)),
    agentUsageObservationsList: vi.fn(),
  };
  const knowledge = {
    creativeCorpusList: vi.fn(() => ok({ items: [] })),
    creativeCollectionsList: vi.fn(() => ok({ items: [] })),
    creativeCorpusCreate: vi.fn(),
    creativeCollectionsCreate: vi.fn(),
  };
  const quality = {
    creativeFingerprintGet: vi.fn(() => ok(FINGERPRINT)),
    creativeExperimentsList: vi.fn(() => ok({ items: [] })),
    creativeExperimentsCreate: vi.fn(),
    creativeExperimentsReview: vi.fn(),
    creativeFingerprintUpdateSettings: vi.fn(),
    creativeFingerprintClear: vi.fn(),
  };
  const system = {
    events: vi.fn(() => ({
      dispose: () => undefined,
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    })),
    openExternal: vi.fn(() => ok(undefined)),
  };
  return {
    agents,
    knowledge,
    quality,
    system,
    remotes: {
      agents,
      knowledge,
      quality,
      system,
    } as unknown as InspirationRemotes,
  };
}

function space(
  remote: InspirationRemotes,
  renderConversion = (props: InspirationConversionProps) => (
    <p>
      {`conversion ${props.conversationId} ${props.cards
        .filter((card) => card.adopted)
        .map((card) => card.id)
        .join(",")}`}
    </p>
  ),
) {
  return render(
    <InspirationSpace
      {...remote}
      t={t}
      title="灵感空间"
      description="说明"
      renderConversion={renderConversion}
    />,
  );
}

describe("assistant messages", () => {
  it("renders light markdown as elements and never as HTML", () => {
    const { container } = render(
      <MessageContent
        content={
          "## 标题\n\n- 一\n- 二\n\n| 列 | 值 |\n| --- | --- |\n| a | **b** |\n\n```ts\nconst x = 1;\n```\n\n<img src=x onerror=alert(1)>"
        }
      />,
    );
    expect(screen.getByText("标题")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("td strong")?.textContent).toBe("b");
    expect(container.querySelector("pre")?.dataset.language).toBe("ts");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });

  it("shows tool calls, answers and verified web sources per turn", () => {
    const onOpenUrl = vi.fn();
    render(
      <AssistantTimeline
        t={t}
        surface="global"
        onOpenUrl={onOpenUrl}
        renderRun={(id) => <p>{`run ${id}`}</p>}
        detail={{
          ...detail("c"),
          turns: [
            {
              id: "turn",
              runId: "run",
              userMessage: "查一下",
              status: "completed",
              projectId: "p",
              routingInputTokens: 3,
              routingOutputTokens: 2,
              route: { workflowId: "wf" },
            },
          ],
          runs: [{ id: "run", status: "succeeded" }],
          items: [
            {
              id: "call",
              runId: "run",
              type: "tool_call",
              status: "completed",
              content: "dramaip_curl",
            },
            {
              id: "answer",
              runId: "run",
              type: "message",
              status: "completed",
              content: "回答**正文**",
            },
            {
              id: "read",
              runId: "run",
              type: "tool_result",
              status: "completed",
              content: "dramaip_curl",
              payload: { result: { title: "甲", url: "https://a.example/x" } },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("项目上下文 · 意图识别 5 Token")).toBeTruthy();
    expect(screen.getByText("run wf")).toBeTruthy();
    expect(
      screen.getByText("网页已安全读取，正文仅用于本次回答。"),
    ).toBeTruthy();
    expect(screen.getByText("正文").tagName).toBe("STRONG");
    const sources = screen.getByLabelText("公开网络来源");
    expect(within(sources).getAllByRole("button")).toHaveLength(1);
    expect(within(sources).getByText(/^已读取正文/)).toBeTruthy();
    fireEvent.click(within(sources).getByText("甲"));
    expect(onOpenUrl).toHaveBeenCalledWith("https://a.example/x");
  });

  it("invites a first thought on an empty inspiration chat", () => {
    render(
      <AssistantTimeline
        t={t}
        surface="inspiration"
        detail={undefined}
        onOpenUrl={() => undefined}
      />,
    );
    expect(screen.getByText(zh["assistant.empty.inspiration"])).toBeTruthy();
  });
});

describe("inspiration space", () => {
  it("opens the remembered conversation and hands its cards to the conversion", async () => {
    window.localStorage.setItem("dramaip-inspiration-conversation", "b");
    const remote = remotes({ consentedAt: "2026-11-01T00:00:00.000Z" });
    space(remote.remotes);
    await screen.findByText("conversion b card-1");
    expect(remote.agents.assistantConversationsGet).toHaveBeenCalledWith("b");
    expect(remote.agents.inspirationCardsList).toHaveBeenCalledWith({
      conversationId: "b",
    });
    expect(screen.getByText("已归档 1 个对话")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "新手引导" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("制作复杂度")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "联网搜索 · 关闭" }),
    ).toBeTruthy();
  });

  it("asks once before learning across chats and saves the answer", async () => {
    const remote = remotes();
    space(remote.remotes);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(zh["space.memory.consent"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(
        remote.agents.inspirationMemorySettingsUpdate,
      ).toHaveBeenCalledWith({ enabled: true }, undefined, undefined),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps web search off when its consent is declined", async () => {
    const remote = remotes({ consentedAt: "2026-11-01T00:00:00.000Z" });
    space(remote.remotes);
    await screen.findByText("conversion a card-1");
    fireEvent.click(screen.getByRole("switch", { name: "联网搜索 · 关闭" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("不会自动发送项目文件");
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "取消" }).at(-1)!,
    );
    await screen.findByText(zh["space.web.kept"]);
    expect(
      remote.agents.assistantWebResearchSettingsUpdate,
    ).toHaveBeenCalledWith({ consented: false }, undefined, undefined);
    expect(remote.agents.assistantConversationsUpdate).toHaveBeenCalledWith(
      "a",
      { webAccessMode: "off" },
      undefined,
      undefined,
    );
  });

  it("starts a conversation on the default runnable engine and sends the message", async () => {
    const remote = remotes({ consentedAt: "2026-11-01T00:00:00.000Z" });
    remote.agents.assistantConversationsList.mockImplementation(() => ok([]));
    space(remote.remotes);
    const draft = await screen.findByPlaceholderText(
      zh["space.draft.placeholder"],
    );
    fireEvent.click(screen.getByRole("switch", { name: "联网搜索 · 自动" }));
    fireEvent.click(screen.getByRole("tab", { name: "角色访谈" }));
    fireEvent.change(draft, { target: { value: "一个守秘的人" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(
        remote.agents.assistantConversationsSendMessage,
      ).toHaveBeenCalled(),
    );
    expect(remote.agents.assistantConversationsCreate).toHaveBeenCalledWith(
      {
        surface: "inspiration",
        creativeMode: "character_interview",
        engineKind: "pi",
        webAccessMode: "off",
      },
      undefined,
      undefined,
    );
    const [id, input, ifMatch, key] = remote.agents
      .assistantConversationsSendMessage.mock.calls[0] as unknown as [
      string,
      unknown,
      unknown,
      string,
    ];
    expect([id, input, ifMatch]).toEqual([
      "new",
      { message: "一个守秘的人" },
      undefined,
    ]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("records a card through the form instead of a browser prompt", async () => {
    const remote = remotes({ consentedAt: "2026-11-01T00:00:00.000Z" });
    space(remote.remotes);
    await screen.findByText("conversion a card-1");
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("灵感内容"), {
      target: { value: "  信里写着明天的日期  " },
    });
    fireEvent.change(within(dialog).getByLabelText("类型"), {
      target: { value: "scene" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    await screen.findByText("conversion a card-1");
    await waitFor(() =>
      expect(remote.agents.inspirationCardsCreate).toHaveBeenCalledWith(
        {
          conversationId: "a",
          kind: "scene",
          title: "信里写着明天的日期",
          content: "信里写着明天的日期",
        },
        undefined,
        undefined,
      ),
    );
  });
});

describe("usage wording", () => {
  it("never adds estimates to a token total or invents an execution time", () => {
    expect(memoryJobStatus(t, { id: "job", status: "completed" })).toBe(
      "模型配置未记录 · 用量总量与费用未知",
    );
    expect(
      memoryJobStatus(t, { id: "job", status: "failed", error: "超时" }),
    ).toBe("待整理 · 超时");
    expect(executionTime(t, 0)).toBe("0.0 秒");
    for (const value of [undefined, -1, NaN, Infinity])
      expect(executionTime(t, value)).toBe("未知");
  });
});
