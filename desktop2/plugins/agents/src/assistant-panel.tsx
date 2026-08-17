import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  FlaskConical,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { ApiClientError } from "@dramaip/client";
import { Button, Select, ThemeSettings } from "@dramaip/ui";
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  useChapterUi,
  useStudioClient,
  useUiSlots,
} from "@dramaip/ui-shared";

type EngineKind = "opencode" | "codex" | "dsh" | "pi" | "langgraph";
interface Conversation {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  title: string;
  engineKind: EngineKind;
  model: string | null;
  status: "active" | "archived";
  version: number;
  updatedAt: string;
}
interface Turn {
  id: string;
  conversationId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  taskType: string | null;
  contextSnapshotId: string | null;
  changePreviewId: string | null;
  intentConfidence: number | null;
  createdAt: string;
}
interface RunRef {
  taskId: string;
  state: string;
  href: `/api/v2/${string}`;
}
interface MessageResult {
  userTurn: Turn;
  assistantTurn: Turn;
  clarification: boolean;
  run?: RunRef;
}
interface TaskDefinition {
  id: string;
  label: string;
  category: string;
  write: boolean;
  requiresProject: boolean;
  requiresChapter: boolean;
  simple: boolean;
}
interface ChangeTarget {
  id: string;
  kind: string;
  targetId: string;
  baseVersion: number;
  patch: Record<string, unknown>;
  displayDiff?: unknown;
}
interface ChangePreview {
  id: string;
  projectId: string;
  rationale: string;
  status: "pending" | "committed" | "discarded";
  targets: ChangeTarget[];
  version: number;
}
interface AgentRun {
  id: string;
  state: string;
  version: number;
  errorMessage: string | null;
  updatedAt: string;
}
interface Provider {
  kind: EngineKind;
  version: string;
  status: string;
  configured: boolean;
}
interface AgentSetting {
  scope: "global" | "project";
  projectId: string | null;
  engineKind: EngineKind;
  model: string | null;
  advancedMode: boolean;
  version: number;
}
interface ExperimentCandidate {
  id: string;
  ordinal: number;
  runId: string | null;
  state: string;
  output: string;
  engineKind: EngineKind | null;
}
interface Experiment {
  id: string;
  projectId: string;
  prompt: string;
  taskType: string;
  status: "running" | "ready" | "reviewed" | "failed";
  revealed: boolean;
  selectedCandidateId: string | null;
  candidates: ExperimentCandidate[];
  version: number;
}

const engines: EngineKind[] = ["opencode", "codex", "dsh", "pi", "langgraph"];

export function AssistantDrawerContent() {
  const projectId = /^\/projects\/([^/]+)/u.exec(location.pathname)?.[1];
  return (
    <div className="assistant-drawer-content">
      <GlobalAssistantPanel contextProjectId={projectId} />
    </div>
  );
}

function GlobalAssistantPanel({
  contextProjectId,
}: {
  contextProjectId?: string;
}) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [projectId, setProjectId] = useState(contextProjectId ?? "");
  const [prompt, setPrompt] = useState("");
  const [engineKind, setEngineKind] = useState<EngineKind>("opencode");
  const [advanced, setAdvanced] = useState(false);
  const [activeRun, setActiveRun] = useState<RunRef>();
  const projects = useQuery({
    queryKey: ["workspace", "projects", "assistant"],
    queryFn: () =>
      client.request<{ items: Array<{ id: string; name: string }> }>(
        "/api/v2/workspace/projects?limit=200",
      ),
  });
  const conversations = useQuery({
    queryKey: ["assistant", "global-conversations"],
    queryFn: () =>
      client.request<{ items: Conversation[] }>(
        "/api/v2/agents/assistant/conversations?status=active&limit=200",
      ),
  });
  const selected =
    conversations.data?.items.find(
      (conversation) => conversation.id === selectedId,
    ) ?? conversations.data?.items[0];
  const turns = useQuery({
    queryKey: ["assistant", "global-turns", selected?.id],
    queryFn: () =>
      client.request<{ items: Turn[] }>(
        `/api/v2/agents/assistant/conversations/${selected!.id}/messages?limit=200`,
      ),
    enabled: Boolean(selected),
    refetchInterval: activeRun ? 800 : false,
  });
  const run = useQuery({
    queryKey: ["assistant", "global-run", activeRun?.taskId],
    queryFn: () => client.request<AgentRun>(activeRun!.href),
    enabled: Boolean(activeRun),
    refetchInterval: activeRun ? 600 : false,
  });
  useEffect(() => {
    if (!run.data || ["queued", "running"].includes(run.data.state)) return;
    setActiveRun(undefined);
    void queryClient.invalidateQueries({
      queryKey: ["assistant", "global-turns", selected?.id],
    });
  }, [queryClient, run.data?.state, selected?.id]);
  const createConversation = useMutation({
    mutationFn: () =>
      client.request<Conversation>("/api/v2/agents/assistant/conversations", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectId || null,
          title: "新对话",
          engineKind,
        }),
      }),
    onSuccess: async (conversation) => {
      setSelectedId(conversation.id);
      await queryClient.invalidateQueries({
        queryKey: ["assistant", "global-conversations"],
      });
    },
  });
  const send = useMutation({
    mutationFn: async ({
      content,
      taskType,
    }: {
      content: string;
      taskType?: string;
    }) => {
      let conversation = selected;
      if (conversation && conversation.engineKind !== engineKind)
        conversation = undefined;
      if (!conversation) {
        conversation = await client.request<Conversation>(
          "/api/v2/agents/assistant/conversations",
          {
            method: "POST",
            body: JSON.stringify({
              projectId: projectId || null,
              title: "新对话",
              engineKind,
            }),
          },
        );
      } else if (projectId && conversation.projectId !== projectId) {
        const metadata = await client.requestWithMetadata<Conversation>(
          `/api/v2/agents/assistant/conversations/${conversation.id}`,
        );
        conversation = await client.request<Conversation>(
          `/api/v2/agents/assistant/conversations/${conversation.id}/actions/bind-project`,
          {
            method: "POST",
            headers: {
              "if-match": metadata.response.headers.get("etag")!,
            },
            body: JSON.stringify({ projectId }),
          },
        );
      }
      return client.request<MessageResult>(
        `/api/v2/agents/assistant/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ content, ...(taskType ? { taskType } : {}) }),
        },
      );
    },
    onSuccess: async (result) => {
      setPrompt("");
      setSelectedId(result.userTurn.conversationId);
      if (result.run) setActiveRun(result.run);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["assistant", "global-conversations"],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            "assistant",
            "global-turns",
            result.userTurn.conversationId,
          ],
        }),
      ]);
    },
  });
  const interrupt = useMutation({
    mutationFn: async () => {
      const metadata = await client.requestWithMetadata<AgentRun>(
        activeRun!.href,
      );
      return client.request<AgentRun>(
        `/api/v2/agents/runs/${activeRun!.taskId}/actions/interrupt`,
        {
          method: "POST",
          headers: { "if-match": metadata.response.headers.get("etag")! },
        },
      );
    },
    onSuccess: async () => {
      setActiveRun(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["assistant", "global-turns", selected?.id],
      });
    },
  });
  const submit = (content: string, taskType?: string) => {
    if (!content.trim() || send.isPending || activeRun) return;
    send.mutate({ content: content.trim(), ...(taskType ? { taskType } : {}) });
  };
  const recommendations = [
    {
      id: "generate-project-setting",
      label: "生成项目设定",
      summary: "把当前简介整理成可审查的项目设定。",
    },
    {
      id: "trope-freshness",
      label: "套路新鲜度分析",
      summary: "检查题材钩子和同质化风险。",
    },
  ] as const;
  return (
    <section className="global-assistant-panel">
      <header>
        <div>
          <h2>AI 办事助手</h2>
          <p>聊天、读取上下文、执行任务，过程实时可见</p>
        </div>
        <button
          disabled={Boolean(activeRun)}
          onClick={() => createConversation.mutate()}
        >
          新对话
        </button>
      </header>
      <select
        aria-label="全局助手对话历史"
        value={selected?.id ?? ""}
        onChange={(event) => setSelectedId(event.target.value || undefined)}
      >
        <option value="">新对话（发送时创建）</option>
        {conversations.data?.items.map((conversation) => (
          <option key={conversation.id} value={conversation.id}>
            {conversation.title} · {conversation.engineKind}
          </option>
        ))}
      </select>
      <select
        aria-label="对话项目上下文"
        value={projectId}
        disabled={Boolean(selected?.projectId)}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">无项目 · 通用聊天</option>
        {projects.data?.items.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <main>
        {turns.data?.items.length ? (
          <div className="global-assistant-turns">
            {turns.data.items.map((turn) => (
              <article className={turn.role} key={turn.id}>
                <small>{turn.role === "user" ? "你" : "助手"}</small>
                <p>{turn.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <>
            <p className="global-assistant-empty">
              直接告诉我你想了解什么，或者希望我完成什么。未绑定项目时，我只进行通用聊天，不会调用项目工具。
            </p>
            <div className="global-assistant-recommendations">
              <p>当前页面推荐</p>
              {recommendations.map((recommendation) => (
                <button
                  key={recommendation.id}
                  onClick={() =>
                    submit(
                      `请${recommendation.label}。${recommendation.summary}`,
                      recommendation.id,
                    )
                  }
                >
                  <strong>{recommendation.label}</strong>
                  <span>{recommendation.summary}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
      <footer>
        <details>
          <summary>引擎与更多任务</summary>
          <div>
            <select
              value={engineKind}
              onChange={(event) =>
                setEngineKind(event.target.value as EngineKind)
              }
            >
              {engines.map((engine) => (
                <option key={engine}>{engine}</option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={advanced}
                onChange={(event) => setAdvanced(event.target.checked)}
              />{" "}
              高级模式
            </label>
          </div>
        </details>
        <textarea
          aria-label="给 AI 办事助手发消息"
          placeholder="直接提问或交代任务…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit(prompt);
            }
          }}
        />
        <div>
          <span>
            {projectId ? "将使用项目只读上下文" : "通用聊天 · 无工具权限"}
          </span>
          <button
            disabled={
              activeRun ? interrupt.isPending : !prompt.trim() || send.isPending
            }
            onClick={() => (activeRun ? interrupt.mutate() : submit(prompt))}
          >
            {activeRun ? "停止" : "发送"}
          </button>
        </div>
      </footer>
    </section>
  );
}

export function AssistantPage() {
  const { projectId } = useParams();
  const [tab, setTab] = useState<"chat" | "experiment">("chat");
  return (
    <section className="assistant-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">AGENTS</p>
          <h1>五引擎智能助手</h1>
          <p>
            引擎选择后固定绑定；写入型任务只产生差异预览，确认前不会修改创作数据。
          </p>
        </div>
        <div className="segmented">
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            对话与任务
          </button>
          <button
            className={tab === "experiment" ? "active" : ""}
            onClick={() => setTab("experiment")}
          >
            <FlaskConical size={14} /> 五引擎盲测
          </button>
        </div>
      </header>
      {tab === "chat" ? (
        <AssistantExperience projectId={projectId} full />
      ) : (
        <ExperimentsPanel projectId={projectId!} />
      )}
    </section>
  );
}

export function ChapterAssistant() {
  const chapter = useChapterUi();
  if (!chapter) return <EmptyPanel>选择章节后可使用智能写作。</EmptyPanel>;
  return (
    <AssistantExperience
      projectId={chapter.projectId}
      chapterId={chapter.chapterId}
      compact
    />
  );
}

function AssistantExperience({
  projectId,
  chapterId,
  compact = false,
  full = false,
}: {
  projectId?: string;
  chapterId?: string;
  compact?: boolean;
  full?: boolean;
}) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [activeTask, setActiveTask] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [activeRun, setActiveRun] = useState<RunRef>();
  const [resumableRun, setResumableRun] = useState<RunRef>();
  const [showArchived, setShowArchived] = useState(false);
  const conversations = useQuery({
    queryKey: ["assistant", "conversations", projectId, showArchived],
    queryFn: () =>
      client.request<{ items: Conversation[] }>(
        `/api/v2/agents/assistant/conversations?status=${showArchived ? "archived" : "active"}${projectId ? `&projectId=${projectId}` : ""}`,
      ),
  });
  const selected =
    conversations.data?.items.find((item) => item.id === selectedId) ??
    conversations.data?.items[0];
  const tasks = useQuery({
    queryKey: ["assistant", "tasks", advanced],
    queryFn: () =>
      client.request<{ items: TaskDefinition[] }>(
        `/api/v2/agents/task-definitions?mode=${advanced ? "advanced" : "simple"}`,
      ),
  });
  const turns = useQuery({
    queryKey: ["assistant", "turns", selected?.id],
    queryFn: () =>
      client.request<{ items: Turn[] }>(
        `/api/v2/agents/assistant/conversations/${selected!.id}/messages?limit=200`,
      ),
    enabled: Boolean(selected),
    refetchInterval: activeRun ? 800 : false,
  });
  const recentRuns = useQuery({
    queryKey: ["assistant", "recent-runs", selected?.sessionId],
    queryFn: () =>
      client.request<{ items: AgentRun[] }>(
        `/api/v2/agents/sessions/${selected!.sessionId}/runs?limit=1`,
      ),
    enabled: Boolean(selected?.sessionId),
  });
  const latestRun = recentRuns.data?.items[0];
  const run = useQuery({
    queryKey: ["assistant", "run", activeRun?.taskId],
    queryFn: () => client.request<AgentRun>(activeRun!.href),
    enabled: Boolean(activeRun),
    refetchInterval: activeRun ? 600 : false,
  });
  useEffect(() => {
    if (!run.data || ["queued", "running"].includes(run.data.state)) return;
    if (["interrupted", "failed"].includes(run.data.state) && activeRun)
      setResumableRun(activeRun);
    else setResumableRun(undefined);
    setActiveRun(undefined);
    setStreaming("");
    void queryClient.invalidateQueries({
      queryKey: ["assistant", "turns", selected?.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["assistant", "recent-runs", selected?.sessionId],
    });
  }, [run.data?.state]);
  useEffect(() => {
    if (activeRun) return;
    if (latestRun && ["interrupted", "failed"].includes(latestRun.state)) {
      setResumableRun({
        taskId: latestRun.id,
        state: latestRun.state,
        href: `/api/v2/agents/runs/${latestRun.id}`,
      });
    } else {
      setResumableRun(undefined);
    }
  }, [activeRun?.taskId, latestRun?.id, latestRun?.state, selected?.id]);
  useEffect(() => {
    const controller = new AbortController();
    void client
      .streamEvents(
        (event) => {
          if (event.type !== "agents.token-delta" || !activeRun) return;
          const data = event.data as { runId?: string; delta?: string };
          if (data.runId === activeRun.taskId && data.delta)
            setStreaming((value) => value + data.delta);
        },
        { signal: controller.signal },
      )
      .catch((error) => {
        if (!controller.signal.aborted)
          console.warn("assistant SSE disconnected", error);
      });
    return () => controller.abort();
  }, [client, activeRun?.taskId]);
  const createConversation = useMutation({
    mutationFn: () =>
      client.request<Conversation>("/api/v2/agents/assistant/conversations", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectId ?? null,
          title: compact ? "章节智能写作" : "新对话",
          engineKind: "opencode",
        }),
      }),
    onSuccess: async (value) => {
      setSelectedId(value.id);
      await queryClient.invalidateQueries({
        queryKey: ["assistant", "conversations", projectId],
      });
    },
  });
  const send = useMutation({
    mutationFn: async ({
      taskType,
      content,
    }: {
      taskType?: string;
      content: string;
    }) => {
      let conversation = selected;
      if (!conversation)
        conversation = await client.request<Conversation>(
          "/api/v2/agents/assistant/conversations",
          {
            method: "POST",
            body: JSON.stringify({
              projectId: projectId ?? null,
              title: compact ? "章节智能写作" : "新对话",
              engineKind: "opencode",
            }),
          },
        );
      return client.request<MessageResult>(
        `/api/v2/agents/assistant/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            content,
            ...(taskType ? { taskType } : {}),
            ...(chapterId ? { chapterId } : {}),
          }),
        },
      );
    },
    onSuccess: async (value) => {
      setPrompt("");
      setStreaming("");
      if (value.run) setActiveRun(value.run);
      setResumableRun(undefined);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["assistant", "conversations", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["assistant", "turns", value.userTurn.conversationId],
        }),
      ]);
      setSelectedId(value.userTurn.conversationId);
    },
  });
  const switchEngine = useMutation({
    mutationFn: async (engineKind: EngineKind) => {
      const metadata = await client.requestWithMetadata<Conversation>(
        `/api/v2/agents/assistant/conversations/${selected!.id}`,
      );
      return client.request<Conversation>(
        `/api/v2/agents/assistant/conversations/${selected!.id}`,
        {
          method: "PATCH",
          headers: { "if-match": metadata.response.headers.get("etag")! },
          body: JSON.stringify({ engineKind }),
        },
      );
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["assistant", "conversations", projectId],
      }),
  });
  const interrupt = useMutation({
    mutationFn: async () => {
      const current = await client.requestWithMetadata<AgentRun>(
        activeRun!.href,
      );
      return client.request(
        `/api/v2/agents/runs/${activeRun!.taskId}/actions/interrupt`,
        {
          method: "POST",
          headers: { "if-match": current.response.headers.get("etag")! },
        },
      );
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["assistant", "run", activeRun?.taskId],
      }),
  });
  const resume = useMutation({
    mutationFn: async () => {
      const current = await client.requestWithMetadata<AgentRun>(
        resumableRun!.href,
      );
      return client.request<RunRef>(
        `/api/v2/agents/runs/${resumableRun!.taskId}/actions/resume`,
        {
          method: "POST",
          headers: {
            "if-match": current.response.headers.get("etag")!,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      );
    },
    onSuccess: (value) => {
      setActiveRun(value);
      setResumableRun(undefined);
    },
  });
  const manageConversation = useMutation({
    mutationFn: async ({
      conversation,
      action,
      title,
    }: {
      conversation: Conversation;
      action: "rename" | "archive" | "restore" | "delete";
      title?: string;
    }) => {
      const metadata = await client.requestWithMetadata<Conversation>(
        `/api/v2/agents/assistant/conversations/${conversation.id}`,
      );
      const headers = {
        "if-match": metadata.response.headers.get("etag")!,
      };
      if (action === "rename")
        return client.request(
          `/api/v2/agents/assistant/conversations/${conversation.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ title }),
          },
        );
      if (action === "delete")
        return client.request(
          `/api/v2/agents/assistant/conversations/${conversation.id}`,
          { method: "DELETE", headers },
        );
      return client.request(
        `/api/v2/agents/assistant/conversations/${conversation.id}/actions/${action}`,
        { method: "POST", headers },
      );
    },
    onSuccess: async () => {
      setSelectedId(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["assistant", "conversations", projectId],
      });
    },
  });
  const recommended =
    tasks.data?.items
      .filter(
        (task) =>
          (!compact || task.requiresChapter) &&
          (Boolean(projectId) || !task.requiresProject),
      )
      .slice(0, advanced ? undefined : 3) ?? [];
  return (
    <div
      className={`assistant-experience ${compact ? "compact" : ""} ${full ? "full" : ""}`}
    >
      {!compact && (
        <aside className="conversation-list">
          <header>
            <strong>对话</strong>
            <div className="button-row compact-actions">
              <button
                className={showArchived ? "icon-button active" : "icon-button"}
                title={showArchived ? "查看活动对话" : "查看已归档对话"}
                onClick={() => {
                  setSelectedId(undefined);
                  setShowArchived((value) => !value);
                }}
              >
                <ArchiveRestore size={14} />
              </button>
              {!showArchived && (
                <button
                  className="icon-button"
                  title="新建对话"
                  onClick={() => createConversation.mutate()}
                >
                  <Plus size={15} />
                </button>
              )}
            </div>
          </header>
          {conversations.data?.items.map((conversation) => (
            <div className="conversation-row" key={conversation.id}>
              <button
                className={conversation.id === selected?.id ? "active" : ""}
                onClick={() => setSelectedId(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <small>
                  {conversation.engineKind} ·{" "}
                  {new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}
                </small>
              </button>
              <div className="conversation-actions">
                {showArchived ? (
                  <>
                    <button
                      title="恢复对话"
                      onClick={() =>
                        manageConversation.mutate({
                          conversation,
                          action: "restore",
                        })
                      }
                    >
                      <ArchiveRestore size={12} />
                    </button>
                    <button
                      title="删除对话"
                      onClick={() =>
                        manageConversation.mutate({
                          conversation,
                          action: "delete",
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      title="重命名对话"
                      onClick={() => {
                        const title = window.prompt(
                          "新的对话名称",
                          conversation.title,
                        );
                        if (title?.trim())
                          manageConversation.mutate({
                            conversation,
                            action: "rename",
                            title: title.trim(),
                          });
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      title="归档对话"
                      onClick={() =>
                        manageConversation.mutate({
                          conversation,
                          action: "archive",
                        })
                      }
                    >
                      <Archive size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!conversations.data?.items.length && (
            <EmptyPanel>新建一段对话。</EmptyPanel>
          )}
        </aside>
      )}
      <main className="conversation-main">
        <header className="assistant-context-bar">
          <div>
            <strong className={compact ? "compact-assistant-kicker" : ""}>
              {compact ? "章节智能协作" : (selected?.title ?? "智能助手")}
            </strong>
            <small>
              {compact
                ? `${selected?.engineKind ?? "OpenCode"} · 进程未启动`
                : projectId
                  ? "项目上下文已启用"
                  : "绑定项目后可运行创作任务"}
            </small>
          </div>
          {selected && (
            <label className="engine-select">
              引擎
              <select
                value={selected.engineKind}
                disabled={Boolean(activeRun)}
                onChange={(event) =>
                  switchEngine.mutate(event.target.value as EngineKind)
                }
              >
                {engines.map((engine) => (
                  <option key={engine}>{engine}</option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
          )}
        </header>
        {compact && (
          <>
            <div className="compact-conversation-picker">
              <span>{selected?.title ?? "新对话（发送时创建）"}</span>
              <button
                className="secondary-button"
                onClick={() => createConversation.mutate()}
              >
                新建
              </button>
            </div>
            <div className="compact-assistant-guide">
              可以直接问剧情、讨论人物，也可以说“续写本章”或“润色这一段”。执行过程会在这里实时显示。
            </div>
            <div className="compact-engine-warning">
              <strong>引擎进程未启动</strong>
              <Link to="/settings">前往模型服务商设置</Link>
            </div>
          </>
        )}
        <div className="quick-task-bar">
          <div>
            {recommended.map((task, index) => (
              <button
                className={activeTask === task.id ? "active" : ""}
                key={task.id}
                onClick={() => {
                  setActiveTask(task.id);
                  if (compact)
                    send.mutate({
                      taskType: task.id,
                      content: `请${task.label}，保持与项目设定一致。`,
                    });
                }}
              >
                <span>
                  {compact
                    ? (["续写本章", "改写本章", "润色本章"][index] ??
                      task.label)
                    : task.label}
                </span>
              </button>
            ))}
          </div>
          {!compact && (
            <label>
              <input
                type="checkbox"
                checked={advanced}
                onChange={(event) => setAdvanced(event.target.checked)}
              />
              高级
            </label>
          )}
        </div>
        {!compact && (
          <div className="message-history">
            {turns.isLoading && <LoadingPanel />}
            {turns.data?.items.map((turn) => (
              <article className={`message ${turn.role}`} key={turn.id}>
                <small>
                  {turn.role === "user" ? "你" : "助手"}
                  {turn.taskType ? ` · ${turn.taskType}` : ""}
                </small>
                <p>{turn.content}</p>
                {turn.changePreviewId && (
                  <PreviewCard id={turn.changePreviewId} />
                )}
              </article>
            ))}
            {streaming && (
              <article className="message assistant streaming">
                <small>助手 · 实时生成</small>
                <p>{streaming}</p>
              </article>
            )}
            {!turns.data?.items.length && (
              <EmptyPanel>描述你的创作目标，或选择一个快捷任务。</EmptyPanel>
            )}
          </div>
        )}
        {compact && (
          <div className="compact-hint">
            {streaming && <p className="streaming-text">{streaming}</p>}
            {turns.data?.items
              .filter((turn) => turn.changePreviewId)
              .slice(-1)
              .map((turn) => (
                <PreviewCard key={turn.id} id={turn.changePreviewId!} />
              ))}
          </div>
        )}
        <form
          className="assistant-composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (prompt.trim())
              send.mutate({ taskType: activeTask, content: prompt });
          }}
        >
          <textarea
            aria-label="发送给智能助手"
            rows={compact ? 3 : 4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              chapterId
                ? "直接聊天或交代任务。Enter 发送，Shift+Enter 换行。"
                : "描述你的创作问题…"
            }
          />
          {send.error && <ErrorPanel error={send.error} />}
          <div>
            <span>
              {selected
                ? `${selected.engineKind}${selected.model ? ` · ${selected.model}` : ""}`
                : compact
                  ? "本轮会带入当前章节"
                  : "将创建 OpenCode 对话"}
            </span>
            {activeRun ? (
              <button
                type="button"
                className="danger-button"
                onClick={() => interrupt.mutate()}
              >
                <Square size={13} /> 中断
              </button>
            ) : resumableRun ? (
              <button
                type="button"
                className="secondary-button"
                disabled={resume.isPending}
                onClick={() => resume.mutate()}
              >
                <RotateCcw size={13} /> 从原引擎恢复
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={!prompt.trim() || send.isPending}
              >
                <Send size={14} /> 发送
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

function PreviewCard({ id }: { id: string }) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["automation", "preview", id],
    queryFn: () =>
      client.requestWithMetadata<ChangePreview>(
        `/api/v2/automation/change-previews/${id}`,
      ),
  });
  const [selected, setSelected] = useState<Set<string>>();
  useEffect(() => {
    if (preview.data && !selected)
      setSelected(
        new Set(preview.data.data.targets.map((target) => target.id)),
      );
  }, [preview.data?.data.id]);
  const action = useMutation({
    mutationFn: async (verb: "commit" | "discard") => {
      let value = preview.data!.data;
      let etag = preview.data!.response.headers.get("etag")!;
      if (
        verb === "commit" &&
        selected &&
        selected.size !== value.targets.length
      ) {
        const updated = await client.requestWithMetadata<ChangePreview>(
          `/api/v2/automation/change-previews/${id}`,
          {
            method: "PATCH",
            headers: { "if-match": etag },
            body: JSON.stringify({
              targets: value.targets.filter((target) =>
                selected.has(target.id),
              ),
            }),
          },
        );
        value = updated.data;
        etag = updated.response.headers.get("etag")!;
      }
      return client.request<ChangePreview>(
        `/api/v2/automation/change-previews/${id}/actions/${verb}`,
        {
          method: "POST",
          headers: { "if-match": etag, "idempotency-key": crypto.randomUUID() },
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["automation", "preview", id],
      });
    },
  });
  if (preview.isLoading) return <LoadingPanel label="正在加载差异…" />;
  if (preview.error || !preview.data)
    return <ErrorPanel error={preview.error} />;
  const value = preview.data.data;
  return (
    <section className={`change-preview ${value.status}`}>
      <header>
        <strong>可编辑差异预览</strong>
        <span>{value.status}</span>
      </header>
      <p>{value.rationale}</p>
      {value.targets.map((target) => (
        <label className="preview-target" key={target.id}>
          <input
            type="checkbox"
            disabled={value.status !== "pending"}
            checked={selected?.has(target.id) ?? true}
            onChange={(event) =>
              setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(target.id);
                else next.delete(target.id);
                return next;
              })
            }
          />
          <span>
            <strong>{target.kind}</strong>
            <small>基于 v{target.baseVersion}</small>
            <pre>{JSON.stringify(target.patch, null, 2)}</pre>
          </span>
        </label>
      ))}
      {value.status === "pending" && (
        <div className="button-row">
          <button
            className="primary-button"
            disabled={!selected?.size || action.isPending}
            onClick={() => action.mutate("commit")}
          >
            采用所选
          </button>
          <button
            className="secondary-button"
            onClick={() => action.mutate("discard")}
          >
            放弃候选
          </button>
        </div>
      )}
      {action.error && <ErrorPanel error={action.error} />}
    </section>
  );
}

function ExperimentsPanel({ projectId }: { projectId: string }) {
  const client = useStudioClient();
  const [prompt, setPrompt] = useState("");
  const [experimentId, setExperimentId] = useState<string>();
  const experiment = useQuery({
    queryKey: ["agents", "experiment", experimentId],
    queryFn: () =>
      client.requestWithMetadata<Experiment>(
        `/api/v2/agents/experiments/${experimentId}`,
      ),
    enabled: Boolean(experimentId),
    refetchInterval: (query) =>
      (query.state.data as { data?: Experiment } | undefined)?.data?.status ===
      "running"
        ? 800
        : false,
  });
  const create = useMutation({
    mutationFn: () =>
      client.request<Experiment>("/api/v2/agents/experiments", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          projectId,
          taskType: "project-chat",
          prompt,
          engines,
        }),
      }),
    onSuccess: (value) => setExperimentId(value.id),
  });
  const review = useMutation({
    mutationFn: (candidateId: string) =>
      client.request<Experiment>(
        `/api/v2/agents/experiments/${experimentId}/actions/review`,
        {
          method: "POST",
          headers: {
            "if-match": experiment.data!.response.headers.get("etag")!,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ selectedCandidateId: candidateId, notes: "" }),
        },
      ),
    onSuccess: () => experiment.refetch(),
  });
  return (
    <div className="experiment-panel">
      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h2>五引擎匿名对比</h2>
        <p>
          评价前只显示候选编号；选择后才揭示 OpenCode、Codex、DSH、Pi 与
          LangGraph。
        </p>
        <textarea
          required
          rows={5}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="输入所有引擎共同回答的创作问题…"
        />
        <button
          className="primary-button"
          disabled={!prompt.trim() || create.isPending}
        >
          开始盲测
        </button>
      </form>
      {create.error && <ErrorPanel error={create.error} />}
      {experiment.data && (
        <div className="candidate-grid blind">
          {experiment.data.data.candidates.map((candidate) => (
            <article className="blind-candidate" key={candidate.id}>
              <span className="card-kicker">候选 {candidate.ordinal + 1}</span>
              <h3>{candidate.engineKind ?? "身份隐藏"}</h3>
              <p>{candidate.output || `正在运行 · ${candidate.state}`}</p>
              {experiment.data!.data.status === "ready" && (
                <button
                  className="primary-button"
                  onClick={() => review.mutate(candidate.id)}
                >
                  选择此候选并揭示
                </button>
              )}
              {experiment.data!.data.selectedCandidateId === candidate.id && (
                <strong className="selected-mark">已选择</strong>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [engineKind, setEngineKind] = useState<EngineKind>("opencode");
  const [providerKind, setProviderKind] = useState("openai");
  const [providerAdapter, setProviderAdapter] = useState("openai");
  const [model, setModel] = useState("gpt-5.6-sol");
  const [baseUrl, setBaseUrl] = useState("");
  const [protocol, setProtocol] = useState<"responses" | "chat_completions">(
    "responses",
  );
  const [secret, setSecret] = useState("");
  const settingsSections = useUiSlots("settings.section");
  const providers = useQuery({
    queryKey: ["agent-providers"],
    queryFn: () =>
      client.request<{ items: Provider[] }>("/api/v2/agents/engines"),
  });
  const codexAuth = useQuery({
    queryKey: ["agents", "codex-auth"],
    queryFn: () =>
      client.request<{
        available: true;
        authenticated: boolean;
        mode?: string;
        accountLabel?: string;
        provider?: {
          name: string;
          model: string;
          protocol: "responses" | "chat_completions";
        };
      }>("/api/v2/agents/providers/codex/auth"),
  });
  const codexLogin = useMutation({
    mutationFn: () =>
      client.request<{
        status: string;
        verificationUrl?: string;
        userCode?: string;
        message: string;
      }>("/api/v2/agents/providers/codex/actions/login", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ mode: "chatgpt_device_code" }),
      }),
    onSuccess: async (result) => {
      if (result.verificationUrl)
        await window.dramaip.system.openExternal(result.verificationUrl);
      await codexAuth.refetch();
    },
  });
  const codexLogout = useMutation({
    mutationFn: () =>
      client.request("/api/v2/agents/providers/codex/actions/logout", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: async () => codexAuth.refetch(),
  });
  const settings = useQuery({
    queryKey: ["agent-settings"],
    queryFn: () =>
      client.requestWithMetadata<AgentSetting>("/api/v2/agents/settings"),
  });
  const updateDefaults = useMutation({
    mutationFn: (
      input: Partial<
        Pick<AgentSetting, "engineKind" | "model" | "advancedMode">
      >,
    ) =>
      client.request("/api/v2/agents/settings", {
        method: "PUT",
        headers: { "if-match": settings.data!.response.headers.get("etag")! },
        body: JSON.stringify(input),
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["agent-settings"] }),
  });
  const configure = useMutation({
    mutationFn: async () => {
      const { credentialRef } = await window.dramaip.credentials.store(secret);
      try {
        let etag: string | null = null;
        try {
          etag = (
            await client.requestWithMetadata(
              `/api/v2/agents/providers/${engineKind}/configuration`,
            )
          ).response.headers.get("etag");
        } catch (error) {
          if (
            !(error instanceof ApiClientError) ||
            error.problem.status !== 404
          )
            throw error;
        }
        return await client.request(
          `/api/v2/agents/providers/${engineKind}/configuration`,
          {
            method: "PUT",
            headers: etag ? { "if-match": etag } : undefined,
            body: JSON.stringify({
              providerKind,
              providerAdapter,
              model,
              ...(baseUrl ? { baseUrl } : {}),
              ...(engineKind === "codex" ? { protocol } : {}),
              credentialRef,
            }),
          },
        );
      } catch (error) {
        await window.dramaip.credentials.remove(credentialRef);
        throw error;
      }
    },
    onSuccess: async () => {
      setSecret("");
      await queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
    },
  });
  return (
    <section className="settings-layout">
      <header className="settings-intro">
        <div>
          <p className="eyebrow">应用与智能能力</p>
          <h1>设置中心</h1>
          <p>先配置模型服务商，再管理智能引擎、备份、诊断和外部连接。</p>
        </div>
        <span>安全配置</span>
      </header>
      <section className="settings-theme-card">
        <div>
          <p className="eyebrow">外观</p>
          <h2>界面主题</h2>
          <p>主题仅保存在本机，并与应用栏中的外观菜单保持同步。</p>
        </div>
        <ThemeSettings />
      </section>
      <form
        className="provider-settings-panel"
        onSubmit={(event) => {
          event.preventDefault();
          configure.mutate();
        }}
      >
        <header>
          <div>
            <p className="eyebrow">第一步</p>
            <h2>模型服务商</h2>
            <p>常用服务商已预填接口地址和协议，只需选择模型并填写接口密钥。</p>
          </div>
          <span>模型目录核对于 2026-08-11</span>
        </header>
        <div className="provider-form-body">
          <div className="provider-field-grid">
            <label>
              绑定引擎
              <select
                value={engineKind}
                onChange={(event) =>
                  setEngineKind(event.target.value as EngineKind)
                }
              >
                {engines.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            </label>
            <label>
              服务商
              <select
                value={providerKind}
                onChange={(event) => {
                  setProviderKind(event.target.value);
                  setProviderAdapter(event.target.value);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
              </select>
            </label>
            <label>
              模型
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="gpt-5.6-sol">GPT-5.6 Sol（推荐）</option>
                <option value="gpt-5.5">GPT-5.5</option>
                <option value="custom">自定义模型</option>
              </select>
            </label>
            <label>
              接口密钥（API Key）
              <input
                required
                type="password"
                autoComplete="off"
                placeholder="粘贴接口密钥"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          </div>
          <details className="provider-advanced-fields">
            <summary>高级连接配置</summary>
            <div>
              <label>
                调用协议
                <select
                  value={providerAdapter}
                  onChange={(event) => setProviderAdapter(event.target.value)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                </select>
              </label>
              {engineKind === "codex" && (
                <label>
                  Codex 转换协议
                  <select
                    value={protocol}
                    onChange={(event) =>
                      setProtocol(
                        event.target.value as "responses" | "chat_completions",
                      )
                    }
                  >
                    <option value="responses">Responses 直连</option>
                    <option value="chat_completions">
                      Chat Completions 本地转换
                    </option>
                  </select>
                </label>
              )}
              <label>
                服务地址（可选）
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
            </div>
          </details>
          <div className="provider-form-actions">
            <div>
              <button
                type="button"
                onClick={() =>
                  window.dramaip.system.openExternal(
                    "https://platform.openai.com/api-keys",
                  )
                }
              >
                打开接口密钥申请页面
              </button>
              <span>密钥仅进入本地加密凭据库，业务数据库只保存凭据引用。</span>
            </div>
            <button disabled={!model.trim() || !secret || configure.isPending}>
              {configure.isPending ? "保存中…" : "添加模型服务商"}
            </button>
          </div>
          {configure.error && <ErrorPanel error={configure.error} />}
          {!providers.data?.items.some((provider) => provider.configured) && (
            <p className="provider-empty-copy">
              尚未配置模型服务商，请从上方常用服务商开始添加。
            </p>
          )}
        </div>
      </form>
      <section className="engine-settings-panel">
        <header>
          <div>
            <p className="eyebrow">第二步</p>
            <h2>智能引擎</h2>
            <p>每次任务只运行你明确选择的引擎。引擎失败时不会自动切换。</p>
          </div>
          <span>OpenCode 全局默认</span>
        </header>
        <div className="engine-settings-body">
          <label>
            全局默认引擎
            <select
              value={settings.data?.data.engineKind ?? "opencode"}
              onChange={(event) =>
                updateDefaults.mutate({
                  engineKind: event.target.value as EngineKind,
                })
              }
            >
              {engines.map((engine) => (
                <option key={engine}>{engine}</option>
              ))}
            </select>
          </label>
          <label className="switch-row">
            <span>
              默认高级模式<small>显示完整任务目录与盲测</small>
            </span>
            <input
              type="checkbox"
              checked={settings.data?.data.advancedMode ?? false}
              onChange={(event) =>
                updateDefaults.mutate({ advancedMode: event.target.checked })
              }
            />
          </label>
          <div className="engine-status-list">
            {providers.data?.items.map((provider) => (
              <article key={provider.kind}>
                <div>
                  <strong>{provider.kind}</strong>
                  <small>
                    v{provider.version} ·{" "}
                    {provider.configured ? "已配置" : "未配置"}
                  </small>
                </div>
                <span className={`status ${provider.status}`}>
                  {provider.status}
                </span>
              </article>
            ))}
          </div>
          <section className="codex-account-row">
            <div>
              <strong>Codex 账户</strong>
              <small>
                {codexAuth.data?.authenticated
                  ? codexAuth.data.provider
                    ? `已连接 · ${codexAuth.data.provider.name} · ${codexAuth.data.provider.model} · ${codexAuth.data.provider.protocol === "chat_completions" ? "本地转换" : "Responses"}`
                    : `已登录 · ${codexAuth.data.accountLabel ?? codexAuth.data.mode ?? "Codex"}`
                  : "可使用 ChatGPT 设备码登录"}
              </small>
            </div>
            {codexAuth.data?.authenticated ? (
              <Button
                loading={codexLogout.isPending}
                onClick={() => codexLogout.mutate()}
              >
                退出登录
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={codexLogin.isPending}
                onClick={() => codexLogin.mutate()}
              >
                使用 ChatGPT 登录
              </Button>
            )}
          </section>
          {(codexAuth.error || codexLogin.error || codexLogout.error) && (
            <ErrorPanel
              error={codexAuth.error ?? codexLogin.error ?? codexLogout.error}
            />
          )}
        </div>
      </section>
      {settingsSections.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </section>
  );
}

export function TasksPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [taskSection, setTaskSection] = useState("tasks");
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{ items: Array<{ id: string; name: string }> }>(
        "/api/v2/workspace/projects",
      ),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const chapters = useQuery({
    queryKey: ["writing", "chapters", activeProject],
    queryFn: () =>
      client.request<{
        items: Array<{ id: string; title: string }>;
      }>(`/api/v2/writing/projects/${activeProject}/chapters?limit=200`),
    enabled: Boolean(activeProject),
  });
  const taskDefinitions = useQuery({
    queryKey: ["agents", "task-definitions", advanced],
    queryFn: () =>
      client.request<{ items: TaskDefinition[] }>(
        `/api/v2/agents/task-definitions?mode=${advanced ? "advanced" : "simple"}`,
      ),
  });
  const providers = useQuery({
    queryKey: ["agents", "engines"],
    queryFn: () =>
      client.request<{ items: Provider[] }>("/api/v2/agents/engines"),
  });
  const selectedProvider = providers.data?.items.find(
    (provider) => provider.kind === "opencode",
  );
  const automationRecords = useQuery({
    queryKey: ["automation", taskSection, activeProject],
    queryFn: () =>
      client.request<{
        items: Array<{
          id: string;
          title: string;
          status: string;
          version: number;
          data: { state?: string; progress?: number };
        }>;
      }>(`/api/v2/automation/${taskSection}?projectId=${activeProject}`),
    enabled: Boolean(activeProject),
  });
  const taskAction = useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      action: "cancel" | "retry";
    }) =>
      client.request(
        `/api/v2/automation/tasks/${input.id}/actions/${input.action}`,
        {
          method: "POST",
          headers: { "if-match": `"v${input.version}"` },
          body: JSON.stringify({}),
        },
      ),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["automation", "tasks", activeProject],
      }),
  });
  const startCreativeTask = useMutation({
    mutationFn: async (definition: TaskDefinition) => {
      if (!activeProject) throw new Error("请先选择项目");
      if (definition.requiresChapter && !chapterId)
        throw new Error("此动作需要先选择章节");
      const conversation = await client.request<Conversation>(
        "/api/v2/agents/assistant/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: activeProject,
            title: definition.label,
            engineKind: "opencode",
          }),
        },
      );
      return client.request<MessageResult>(
        `/api/v2/agents/assistant/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            content: `请${definition.label}，保持与项目设定一致，并生成可审阅的预览。`,
            taskType: definition.id,
            ...(chapterId ? { chapterId } : {}),
          }),
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["automation", "tasks", activeProject],
      });
    },
  });
  const taskPriority = ["chapter-diagnostic", "generate-revision-tasks"];
  const recommended = advanced
    ? (taskDefinitions.data?.items ?? [])
    : taskPriority
        .map((id) =>
          taskDefinitions.data?.items.find(
            (definition) => definition.id === id,
          ),
        )
        .filter((definition): definition is TaskDefinition =>
          Boolean(definition),
        );
  const engineReady =
    selectedProvider?.status === "available" && selectedProvider.configured;
  return (
    <section className="task-center-page">
      <header className="task-center-intro">
        <div>
          <p className="eyebrow">执行与恢复</p>
          <h1>任务中心</h1>
          <p>统一查看生成、分析和交付任务的当前阶段、失败原因与恢复入口。</p>
        </div>
        <span>实时阶段</span>
      </header>
      <section className="task-context-card">
        <div className="task-context-title">
          <h2>当前任务上下文</h2>
          <span>受控引擎</span>
        </div>
        <p>
          智能助手经由 DramaIP
          本地服务代理，只使用受控的只读工具；所有内容改动和付费厂商调用都必须由你确认。
        </p>
        <div
          className="task-mode-switch"
          role="group"
          aria-label="智能助手模式"
        >
          <button
            className={!advanced ? "active" : ""}
            onClick={() => setAdvanced(false)}
          >
            简洁模式
          </button>
          <button
            className={advanced ? "active" : ""}
            onClick={() => setAdvanced(true)}
          >
            高级模式
          </button>
        </div>
        <Select
          aria-label="选择诊断项目"
          className="task-project-select"
          value={activeProject}
          options={(projects.data?.items ?? []).map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          onValueChange={(value) => {
            setProjectId(value);
            setChapterId("");
          }}
        />
        <Select
          aria-label="项目级诊断（可选）"
          className="task-chapter-select"
          value={chapterId}
          placeholder="项目级诊断（可选）"
          options={(chapters.data?.items ?? []).map((chapter) => ({
            value: chapter.id,
            label: chapter.title,
          }))}
          onValueChange={setChapterId}
        />
        <div className="task-recommendation-copy">
          <h3>当前页面推荐</h3>
          <p>
            已根据当前页面和项目输入筛选；每次任务都会保留可追溯快照，结果仅进入预览或变更包。
          </p>
        </div>
        <div className="task-recommendations">
          {recommended.map((definition) => {
            const inputReady =
              !definition.requiresProject ||
              (Boolean(activeProject) &&
                (!definition.requiresChapter || Boolean(chapterId)));
            const ready = inputReady && engineReady;
            return (
              <article key={definition.id}>
                <h3>{definition.label}</h3>
                <p>
                  {definition.id === "generate-revision-tasks"
                    ? "把发现的问题整理成修订任务单。"
                    : "基于当前项目重新生成可审查的诊断。"}
                </p>
                <p>
                  输入：
                  {inputReady
                    ? "已就绪"
                    : definition.requiresChapter
                      ? "需要选择章节"
                      : "需要选择项目"}
                  <br />
                  能力：{engineReady ? "OpenCode 可用" : "所选引擎当前不可用"}
                  <br />
                  费用：模型调用按服务商账单结算
                </p>
                {!ready && (
                  <div className="task-preflight-fixes">
                    {!inputReady && (
                      <span>
                        {definition.requiresChapter
                          ? "为此动作选择一个章节"
                          : "为此动作选择一个项目"}
                      </span>
                    )}
                    {!engineReady && <span>启动或配置 OpenCode 引擎</span>}
                    <Link to="/settings">前往设置修复</Link>
                  </div>
                )}
                <button
                  disabled={!ready || startCreativeTask.isPending}
                  onClick={() => startCreativeTask.mutate(definition)}
                >
                  {startCreativeTask.isPending
                    ? "正在创建任务…"
                    : `生成${definition.label}预览`}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <section className="task-records-section">
        <div className="task-record-tabs">
          {(
            [
              ["tasks", "任务列表"],
              ["workflows", "工作流"],
              ["templates", "任务模板"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={taskSection === value ? "active" : ""}
              key={value}
              onClick={() => setTaskSection(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="task-record-grid">
          {automationRecords.data?.items.map((record) => (
            <article className="task-record" key={record.id}>
              <small>
                {record.data.state ?? record.status} · v{record.version}
              </small>
              <h2>{record.title}</h2>
              {record.data.progress !== undefined ? (
                <progress value={record.data.progress} max={1} />
              ) : null}
              {taskSection === "tasks" ? (
                <div>
                  <button
                    disabled={
                      record.data.state !== "queued" &&
                      record.data.state !== "running"
                    }
                    onClick={() =>
                      taskAction.mutate({
                        id: record.id,
                        version: record.version,
                        action: "cancel",
                      })
                    }
                  >
                    取消
                  </button>
                  <button
                    disabled={
                      record.data.state !== "failed" &&
                      record.data.state !== "interrupted"
                    }
                    onClick={() =>
                      taskAction.mutate({
                        id: record.id,
                        version: record.version,
                        action: "retry",
                      })
                    }
                  >
                    重试
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {!automationRecords.data?.items.length ? (
            <EmptyPanel>当前项目还没有相关记录。</EmptyPanel>
          ) : null}
        </div>
      </section>
      {automationRecords.error || taskAction.error ? (
        <ErrorPanel error={automationRecords.error ?? taskAction.error} />
      ) : null}
    </section>
  );
}

export default AssistantPage;
