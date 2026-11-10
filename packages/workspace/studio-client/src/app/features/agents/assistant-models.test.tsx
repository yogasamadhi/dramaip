// @vitest-environment jsdom
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createElement } from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  AgentSession,
  ModelProviderCatalog,
} from "@dramaip/contracts/product";
import { QueryClient, QueryClientProvider } from "../../query";
import { assistantProviderModels } from "./assistant-models";
import { AgentSidePanel } from "./impl";

const { client, navigate, savePendingIntent } = vi.hoisted(() => ({
  navigate: vi.fn(),
  savePendingIntent: vi.fn(),
  client: {
    projects: { list: vi.fn() },
    resources: { list: vi.fn() },
    providers: { catalog: vi.fn() },
    agentEngines: {
      list: vi.fn(),
      listTasks: vi.fn(),
      getGlobalSettings: vi.fn(),
    },
    assistantConversations: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      sendMessage: vi.fn(),
      update: vi.fn(),
      getWebResearchSettings: vi.fn(),
    },
    events: {
      subscribe: vi.fn(
        (_listener: (event: { type: string; payload?: unknown }) => void) =>
          () =>
            undefined,
      ),
    },
  },
}));

vi.mock("../../studio-shared", () => ({
  useStudio: () => client,
  message: String,
  agentChangePreview: () => undefined,
  agentProviderActionPreview: () => undefined,
}));
vi.mock("../../studio-session", () => ({
  useStudioSession: () => ({ savePendingIntent }),
}));
vi.mock("../../router", () => ({
  useLocation: () => ({ pathname: "/", search: "" }),
  useNavigate: () => navigate,
}));
vi.mock("../../controls", () => ({ confirmDialog: vi.fn() }));
vi.mock("../../copy", () => ({
  copyText: (key: string) =>
    ({
      "app/features/agents/impl.7": "新建对话",
      "app/features/agents/impl.11": "恢复",
      "app/features/agents/impl.8": "全局助手对话历史",
      "app/features/agents/impl.history": "历史对话",
      "app/features/agents/impl.12": "智能助手模型",
      "app/features/agents/impl.13": "对话项目上下文",
      "app/features/agents/impl.archived": "已归档对话",
      "app/features/agents/impl.usage": "用量报告",
      "app/features/agents/impl.modelSettings": "模型设置",
      "app/features/agents/impl.24": "给 AI 办事助手发消息",
    })[key] ?? key,
}));
vi.mock("../creation-workbench", () => ({ CreationRunCard: () => null }));
vi.mock("../AgentUsagePanel", () => ({
  AgentUsagePanel: ({
    runId,
    projectId,
  }: {
    runId: string;
    projectId?: string;
  }) => (
    <div
      data-testid="usage-report"
      data-run-id={runId}
      data-project-id={projectId}
    />
  ),
}));
vi.mock("../studio-widgets", () => ({
  AgentChangePreviewCard: () => null,
  AgentAssistantProviderActionPreviewCard: () => null,
  recordPayload: (value: unknown) => value ?? {},
}));
vi.mock("../assistant-message-content", () => ({
  useAssistantAutoScroll: () => ({ followLatest: vi.fn() }),
  AssistantMessageContent: () => null,
  AssistantStageSummary: () => null,
  AssistantToolActivity: () => null,
  AssistantWebAccessControl: () => null,
  AssistantWebSourceCards: () => null,
}));
vi.mock("@dramaip/infra-ui-primitives", () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    NativeSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) =>
      createElement("select", props),
    Button: ({
      children,
      size: _size,
      variant: _variant,
      ...props
    }: Record<string, unknown>) => (
      <button {...props}>{children as ReactNode}</button>
    ),
    BareButton: ({ children, ...props }: Record<string, unknown>) => (
      <button {...props}>{children as ReactNode}</button>
    ),
    IconSparkleRegular: () => null,
    DropdownMenu: Object.assign(Container, {
      Trigger: Container,
      Content: Container,
      Item: ({
        children,
        onSelect,
        disabled,
      }: {
        children: ReactNode;
        onSelect?: () => void;
        disabled?: boolean;
      }) => (
        <button role="menuitem" disabled={disabled} onClick={onSelect}>
          {children}
        </button>
      ),
      Separator: () => null,
    }),
    Dialog: Object.assign(
      ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? <>{children}</> : null,
      {
        Content: ({ children }: { children: ReactNode }) => (
          <div role="dialog">{children}</div>
        ),
        Title: Container,
      },
    ),
  };
});

const provider = {
  id: "active-provider",
  title: "MiniMax CN",
  payload: {
    预设服务商: "minimax-cn",
    模型名称: "model-a",
    可用模型: "model-b、 account-only、model-a",
  },
};
const catalog: ModelProviderCatalog = {
  release: "test",
  updatedAt: "2026-11-05",
  providers: [
    {
      id: "minimax-cn",
      name: "MiniMax CN",
      protocol: "Anthropic",
      sourceUrl: "https://example.com",
      models: [
        { id: "model-a", label: "模型 A" },
        { id: "model-b", label: "模型 B" },
      ],
    },
    {
      id: "other",
      name: "Other",
      protocol: "Anthropic",
      sourceUrl: "https://example.com",
      models: [{ id: "other-model", label: "其他服务商模型" }],
    },
  ],
};
const conversation: AgentSession = {
  id: "conversation-1",
  engineSessionId: "engine-session-1",
  engineKind: "pi",
  surface: "global",
  title: "原对话",
  model: { providerId: provider.id, modelId: "model-a" },
  webAccessMode: "off",
  status: "idle",
  lastOpenedAt: "2026-11-05T00:00:00Z",
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};
const detail = (session = conversation) => ({
  conversation: session,
  turns: [],
  runs: [],
  items: [],
  changePreviews: [],
  providerActionPreviews: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  client.projects.list.mockResolvedValue([]);
  client.resources.list.mockResolvedValue([provider]);
  client.providers.catalog.mockResolvedValue(catalog);
  client.agentEngines.list.mockResolvedValue([
    { kind: "pi", name: "Pi", canRun: true, isDefault: true },
  ]);
  client.agentEngines.listTasks.mockResolvedValue([]);
  client.agentEngines.getGlobalSettings.mockResolvedValue({
    defaultEngineKind: "pi",
    activeProviderId: provider.id,
  });
  client.assistantConversations.list.mockResolvedValue([]);
  client.assistantConversations.update.mockResolvedValue(conversation);
  client.assistantConversations.get.mockResolvedValue(detail());
  client.assistantConversations.getWebResearchSettings.mockResolvedValue({
    consented: true,
  });
  client.assistantConversations.create.mockImplementation(async (input) => ({
    ...conversation,
    ...input,
    id: "new-conversation",
  }));
  client.assistantConversations.sendMessage.mockRejectedValue(
    new Error("测试在已捕获的发送请求处结束"),
  );
});

test("会话历史只显示会话标题，不附加 Pi 标识", async () => {
  client.assistantConversations.list.mockImplementation(async ({ archived }) =>
    archived ? [] : [{ ...conversation, title: "海底城市与失踪邮差" }],
  );
  client.assistantConversations.get.mockResolvedValue(
    detail({ ...conversation, title: "海底城市与失踪邮差" }),
  );
  mount();
  const history = await screen.findByRole("combobox", {
    name: "全局助手对话历史",
  });
  await within(history).findByRole("option", {
    name: "海底城市与失踪邮差",
  });
  expect(within(history).queryByRole("option", { name: /·\s*Pi/u })).toBeNull();
});

test("后台标题更新会刷新历史名称，不会切走用户刚打开的新对话", async () => {
  client.assistantConversations.list.mockImplementation(async ({ archived }) =>
    archived ? [] : [{ ...conversation, title: "新对话" }],
  );
  client.assistantConversations.get.mockResolvedValue(
    detail({ ...conversation, title: "新对话" }),
  );
  mount();
  const history = (await screen.findByRole("combobox", {
    name: "全局助手对话历史",
  })) as HTMLSelectElement;
  await waitFor(() => expect(history.value).toBe(conversation.id));
  fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
  expect(history.value).toBe("");
  const listener = client.events.subscribe.mock.calls.at(-1)![0];
  act(() =>
    listener({
      type: "agents.assistant-session-updated.v1",
      payload: { sessionId: conversation.id, title: "海底城市与失踪邮差" },
    }),
  );
  await within(history).findByRole("option", { name: "海底城市与失踪邮差" });
  expect(history.value).toBe("");
});
afterEach(cleanup);

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AgentSidePanel />
    </QueryClientProvider>,
  );
}
async function readyModel() {
  const select = screen.getByRole("combobox", {
    name: "智能助手模型",
  }) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("model-a"));
  return select;
}

test("只合并当前服务商的目录、账户模型和自定义模型，并去重", () => {
  expect(
    assistantProviderModels(provider, catalog).map((model) => model.id),
  ).toEqual(["model-a", "model-b", "account-only"]);
  expect(
    assistantProviderModels(
      {
        payload: { 模型名称: "custom-model", 可用模型: "custom-model、extra" },
      },
      undefined,
    ).map((model) => model.id),
  ).toEqual(["custom-model", "extra"]);
  expect(assistantProviderModels(undefined, catalog)).toEqual([]);
});

test("助手提供模型切换，并按设置中的引擎和服务商创建会话", async () => {
  mount();
  const select = await readyModel();
  expect([...select.options].map((option) => option.value)).toEqual([
    "model-a",
    "model-b",
    "account-only",
  ]);
  expect(screen.queryByRole("combobox", { name: "智能助手引擎" })).toBeNull();
  expect(
    screen
      .getByText("历史对话")
      .closest("label")
      ?.contains(screen.getByRole("combobox", { name: "全局助手对话历史" })),
  ).toBe(true);
  expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
  fireEvent.change(select, { target: { value: "model-b" } });
  fireEvent.change(
    screen.getByRole("textbox", { name: "给 AI 办事助手发消息" }),
    { target: { value: "你好" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(client.assistantConversations.sendMessage).toHaveBeenCalled(),
  );
  expect(client.assistantConversations.create).toHaveBeenCalledWith(
    expect.objectContaining({
      engineKind: "pi",
      model: { providerId: provider.id, modelId: "model-b" },
    }),
  );
});

test("已有对话切换模型时保留输入和历史，在发送时创建新会话", async () => {
  client.assistantConversations.list.mockImplementation(async ({ archived }) =>
    archived ? [] : [conversation],
  );
  mount();
  const select = await readyModel();
  await waitFor(() =>
    expect(client.assistantConversations.get).toHaveBeenCalledWith(
      conversation.id,
    ),
  );
  const input = screen.getByRole("textbox", {
    name: "给 AI 办事助手发消息",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "保留这段输入" } });
  fireEvent.change(select, { target: { value: "model-b" } });
  expect(input.value).toBe("保留这段输入");
  expect(screen.getByRole("option", { name: /原对话/ })).toBeTruthy();
  expect(client.assistantConversations.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(client.assistantConversations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerId: provider.id, modelId: "model-b" },
      }),
    ),
  );
});

test("从管理中恢复归档对话，失败可重试且保留模型和项目选择", async () => {
  let restored = false;
  const archived = { ...conversation, id: "archived-chat", title: "归档草稿" };
  client.assistantConversations.list.mockImplementation(
    async ({ archived: listArchived }) =>
      listArchived ? (restored ? [] : [archived]) : restored ? [archived] : [],
  );
  client.assistantConversations.update.mockRejectedValueOnce(
    new Error("恢复失败"),
  );
  client.assistantConversations.update.mockImplementationOnce(async () => {
    restored = true;
    return archived;
  });
  client.assistantConversations.get.mockResolvedValue(detail(archived));
  mount();
  await readyModel();
  expect(screen.getByRole("combobox", { name: "对话项目上下文" })).toBeTruthy();
  expect(screen.queryByText("归档草稿")).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "已归档对话" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("归档草稿")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "恢复" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toContain("恢复失败"),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "恢复" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.assistantConversations.update).toHaveBeenLastCalledWith(
    "archived-chat",
    { archived: false },
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("combobox", {
          name: "全局助手对话历史",
        }) as HTMLSelectElement
      ).value,
    ).toBe("archived-chat"),
  );
});

test("用量报告仅从管理打开，并使用原运行的项目范围", async () => {
  client.assistantConversations.list.mockImplementation(async ({ archived }) =>
    archived ? [] : [conversation],
  );
  client.assistantConversations.get.mockResolvedValue({
    ...detail(),
    runs: [
      {
        id: "original-run",
        status: "completed",
        usageScope: { projectId: "original-project" },
      },
    ],
  });
  mount();
  await readyModel();
  const usage = screen.getByRole("menuitem", {
    name: "用量报告",
  }) as HTMLButtonElement;
  await waitFor(() => expect(usage.disabled).toBe(false));
  expect(screen.queryByTestId("usage-report")).toBeNull();
  fireEvent.click(usage);
  const report = within(screen.getByRole("dialog")).getByTestId("usage-report");
  expect(report.getAttribute("data-run-id")).toBe("original-run");
  expect(report.getAttribute("data-project-id")).toBe("original-project");
});

test("管理中的模型设置保留尚未发送的输入及返回位置", async () => {
  mount();
  await readyModel();
  fireEvent.change(
    screen.getByRole("textbox", { name: "给 AI 办事助手发消息" }),
    { target: { value: "尚未发送的内容" } },
  );
  expect(
    screen.queryByRole("link", { name: "前往设置并保留当前输入" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "模型设置" }));
  expect(savePendingIntent).toHaveBeenCalledWith({
    kind: "ai-action",
    returnTo: "/",
    actionId: "global-assistant:send",
    input: "尚未发送的内容",
  });
  expect(navigate).toHaveBeenCalledWith("/settings?setup=ai");
});

test.each(["queued", "preparing", "running"])(
  "%s 期间锁定模型，未启用服务商时不展示其他服务商模型",
  async (status) => {
    client.assistantConversations.list.mockImplementation(
      async ({ archived }) => (archived ? [] : [conversation]),
    );
    client.assistantConversations.get.mockResolvedValue({
      ...detail(),
      runs: [{ id: "active-run", status }],
    });
    mount();
    const select = await readyModel();
    await waitFor(() => expect(select.disabled).toBe(true));
    cleanup();
    client.assistantConversations.list.mockResolvedValue([]);
    client.agentEngines.getGlobalSettings.mockResolvedValue({
      defaultEngineKind: "pi",
    });
    mount();
    const emptySelect = screen.getByRole("combobox", {
      name: "智能助手模型",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect(client.agentEngines.getGlobalSettings).toHaveBeenCalledTimes(2),
    );
    expect(emptySelect.disabled).toBe(true);
    expect([...emptySelect.options].map((option) => option.value)).toEqual([
      "",
    ]);
  },
);
