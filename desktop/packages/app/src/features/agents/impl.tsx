import { creationOperationForTask } from "@dramaip/contracts/creation";
import { CreationRunCard } from "../creation-workbench";
import type {
  AgentEngineKind,
  AgentExperiment,
  AgentItem,
  AgentSession,
  AgentTaskType,
  AssistantConversationDetail,
  ChangePreview,
  ProviderActionPreview,
} from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  DropdownMenu,
  Input,
  confirmDialog,
} from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  contextAssistantPage,
  contextAssistantPreflight,
  contextAssistantProjectId,
  resolveContextAssistantActions,
} from "../../context-assistant";
import {
  TASK_STATUS_LABELS,
  agentChangePreview,
  agentProviderActionPreview,
  message,
  taskResultText,
  useStudio,
} from "../../studio-shared";
import { AiSettingsLink, useStudioSession } from "../../studio-session";
import {
  AssistantMessageContent,
  AssistantStageSummary,
  AssistantToolActivity,
  AssistantWebAccessControl,
  AssistantWebSourceCards,
  useAssistantAutoScroll,
} from "../assistant-message-content";
import {
  AGENT_ENGINE_LABELS,
  AGENT_EXPERIMENT_ENGINE_LABELS,
} from "../settings/impl";
import {
  AgentChangePreviewCard,
  AgentProviderActionPreviewCard,
  recordPayload,
} from "../studio-widgets";
export function AgentSidePanel() {
  const client = useStudio();
  const session = useStudioSession();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["assistant-chat-projects"],
    queryFn: client.projects.list,
  });
  const { data: engines = [] } = useQuery({
    queryKey: ["assistant-chat-engines"],
    queryFn: client.agentEngines.list,
  });
  const { data: taskDefinitions = [] } = useQuery({
    queryKey: ["assistant-chat-tasks"],
    queryFn: client.agentEngines.listTasks,
  });
  const contextProjectId =
    contextAssistantProjectId(location) ?? session.activeProjectId;
  const [projectId, setProjectId] = useState(contextProjectId ?? "");
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("pi");
  const [modelId, setModelId] = useState("");
  const [conversations, setConversations] = useState<AgentSession[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<
    AgentSession[]
  >([]);
  const [conversationId, setConversationId] = useState<string>();
  const [detail, setDetail] = useState<AssistantConversationDetail>();
  const [draft, setDraft] = useState(
    () =>
      (session.pendingIntent?.actionId === "global-assistant:send"
        ? session.pendingIntent.input
        : undefined) ?? "",
  );
  const [selectedTask, setSelectedTask] =
    useState<AgentTaskType>("chapter_diagnostic");
  const [contentTargetId, setContentTargetId] = useState("");
  const operation = creationOperationForTask(selectedTask);
  const { data: contentTargets = [] } = useQuery({
    queryKey: ["assistant-content-targets", projectId, operation],
    enabled: Boolean(
      projectId &&
      ["chapter", "script-revision", "shot-prompt", "episode"].includes(
        operation ?? "",
      ),
    ),
    queryFn: async () =>
      operation === "chapter"
        ? client.chapters.list(projectId)
        : client.resources.list(
            operation === "episode"
              ? "episodes"
              : operation === "shot-prompt"
                ? "shots"
                : "scripts",
            projectId,
          ),
  });
  const selectedContentTarget = contentTargets.find(
    (item) => item.id === contentTargetId,
  );
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [webAccessMode, setWebAccessMode] = useState<"auto" | "off">("auto");
  const { data: webResearchSettings, refetch: refetchWebResearchSettings } =
    useQuery({
      queryKey: ["assistant-web-research-settings"],
      queryFn: client.assistantConversations.getWebResearchSettings,
    });
  const detailRequestRef = useRef<string | undefined>(undefined);
  const initializedNewConversationEngineRef = useRef(false);
  const assistantScroll = useAssistantAutoScroll(detail, conversationId);
  const activeRun = detail?.runs.find((run) =>
    ["queued", "running"].includes(run.status),
  );
  const latestRun = detail?.runs.at(-1);
  const interruptedRun =
    latestRun?.status === "interrupted" ? latestRun : undefined;
  const conversationRunIds = detail?.runs.map((run) => run.id).join("|") ?? "";
  const contextPage = contextAssistantPage(location.pathname);
  const { actions: recommendations } = resolveContextAssistantActions({
    page: contextPage,
    catalog: taskDefinitions,
  });
  const selectedEngine = engines.find((engine) => engine.kind === engineKind);
  const selectedEngineCanRun = selectedEngine
    ? (selectedEngine.canRun ?? selectedEngine.status === "available")
    : false;

  const beginNewConversation = (nextEngineKind?: AgentEngineKind) => {
    const defaultEngine = engines.find((engine) => engine.isDefault);
    detailRequestRef.current = undefined;
    initializedNewConversationEngineRef.current = Boolean(
      nextEngineKind ?? defaultEngine,
    );
    setConversationId(undefined);
    setDetail(undefined);
    setEngineKind(nextEngineKind ?? defaultEngine?.kind ?? engineKind);
    setModelId("");
    setWebAccessMode("auto");
    setNotice(undefined);
    window.localStorage.removeItem("dramaip-global-assistant-conversation");
  };

  const selectEngine = (nextEngineKind: AgentEngineKind) => {
    if (nextEngineKind === engineKind) return;
    beginNewConversation(nextEngineKind);
    const nextEngine = engines.find((engine) => engine.kind === nextEngineKind);
    setNotice(
      `已切换到 ${nextEngine?.name ?? AGENT_ENGINE_LABELS[nextEngineKind]}，发送消息时将创建新对话。`,
    );
  };

  const loadConversations = async (preferredId?: string) => {
    const [items, archived] = await Promise.all([
      client.assistantConversations.list({ surface: "global" }),
      client.assistantConversations.list({
        surface: "global",
        archived: true,
      }),
    ]);
    setConversations(items);
    setArchivedConversations(archived);
    const stored = window.localStorage.getItem(
      "dramaip-global-assistant-conversation",
    );
    const next =
      preferredId ??
      (stored && items.some((item) => item.id === stored)
        ? stored
        : undefined) ??
      items[0]?.id;
    setConversationId(
      (current) =>
        preferredId ??
        (current && items.some((item) => item.id === current)
          ? current
          : undefined) ??
        next,
    );
  };

  const loadDetail = async (id: string) => {
    detailRequestRef.current = id;
    const value = await client.assistantConversations.get(id);
    if (detailRequestRef.current !== id) return value;
    setDetail(value);
    setEngineKind(value.conversation.engineKind);
    setModelId(value.conversation.model?.modelId ?? "");
    setWebAccessMode(value.conversation.webAccessMode);
    if (value.conversation.projectId)
      setProjectId(value.conversation.projectId);
    return value;
  };

  const requestWebResearchConsent = async (): Promise<boolean> => {
    if (webResearchSettings?.consented) return true;
    const consented = await confirmDialog(
      "联网搜索会把本轮生成的搜索词，以及你要求读取的公开网址发送给第三方网络服务；不会自动发送项目文件、剧本全文或附件。是否允许？",
    );
    const updated =
      await client.assistantConversations.updateWebResearchSettings({
        consented,
      });
    await refetchWebResearchSettings();
    return updated.consented;
  };

  const changeWebAccessMode = async (next: "auto" | "off") => {
    if (activeRun) return;
    try {
      const allowed =
        next === "auto" ? await requestWebResearchConsent() : false;
      const effective = next === "auto" && allowed ? "auto" : "off";
      setWebAccessMode(effective);
      if (conversationId) {
        await client.assistantConversations.update(conversationId, {
          webAccessMode: effective,
        });
        await Promise.all([
          loadDetail(conversationId),
          loadConversations(conversationId),
        ]);
      }
      if (next === "auto" && !allowed)
        setNotice("已保持关闭；本对话不会访问公开网络。");
    } catch (cause) {
      setNotice(message(cause));
    }
  };

  useEffect(() => {
    if (contextProjectId) setProjectId(contextProjectId);
  }, [contextProjectId]);

  useEffect(() => {
    if (
      conversationId ||
      initializedNewConversationEngineRef.current ||
      !engines.length
    )
      return;
    const defaultEngine = engines.find((engine) => engine.isDefault);
    if (defaultEngine) setEngineKind(defaultEngine.kind);
    initializedNewConversationEngineRef.current = true;
  }, [conversationId, engines]);

  useEffect(() => {
    const openConversation = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (id) setConversationId(id);
    };
    window.addEventListener(
      "dramaip:open-assistant-conversation",
      openConversation,
    );
    return () =>
      window.removeEventListener(
        "dramaip:open-assistant-conversation",
        openConversation,
      );
  }, []);

  useEffect(() => {
    void loadConversations().catch((cause) => setNotice(message(cause)));
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setDetail(undefined);
      return;
    }
    window.localStorage.setItem(
      "dramaip-global-assistant-conversation",
      conversationId,
    );
    void loadDetail(conversationId).catch((cause) => setNotice(message(cause)));
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !activeRun) return;
    const timer = window.setInterval(() => {
      void loadDetail(conversationId).catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, conversationId]);

  useEffect(() => {
    const unsubscribe = client.events.subscribe((event) => {
      if (!detail || !event.payload || typeof event.payload !== "object")
        return;
      const payload = event.payload as Record<string, unknown>;
      if (
        event.type.startsWith("agents.assistant-item-") &&
        payload.sessionId === detail.conversation.id
      ) {
        const runId = typeof payload.runId === "string" ? payload.runId : "";
        const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
        const occurredAt =
          typeof payload.occurredAt === "string"
            ? payload.occurredAt
            : event.occurredAt;
        if (!runId || !itemId) return;
        if (event.type === "agents.assistant-item-delta.v1") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (!delta) return;
          setDetail((current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          content: `${item.content ?? ""}${delta}`,
                          updatedAt: occurredAt,
                        }
                      : item,
                  ),
                }
              : current,
          );
          return;
        }
        const status =
          payload.status === "completed" || payload.status === "failed"
            ? payload.status
            : "streaming";
        const content =
          typeof payload.content === "string" ? payload.content : undefined;
        setDetail((current) => {
          if (!current) return current;
          const existing = current.items.find((item) => item.id === itemId);
          const itemType = [
            "message",
            "structured_output",
            "tool_call",
            "tool_result",
            "stage",
            "error",
          ].includes(String(payload.type))
            ? (payload.type as AgentItem["type"])
            : (existing?.type ?? "message");
          const item: AgentItem = {
            id: itemId,
            runId,
            sequence:
              typeof payload.sequence === "number"
                ? payload.sequence
                : (existing?.sequence ?? current.items.length + 1),
            type: itemType,
            status,
            ...(content ? { content } : {}),
            ...(payload.payload !== undefined
              ? { payload: payload.payload }
              : existing?.payload !== undefined
                ? { payload: existing.payload }
                : {}),
            createdAt: existing?.createdAt ?? occurredAt,
            updatedAt: occurredAt,
          };
          return {
            ...current,
            items: upsertGlobalAgentItem(current.items, item),
          };
        });
        return;
      }
      if (
        (event.type.startsWith("assistant_turn.") ||
          event.type.startsWith("agents.assistant-")) &&
        payload.sessionId === detail.conversation.id &&
        conversationId
      ) {
        void loadDetail(conversationId).catch(() => undefined);
        return;
      }
      const runIds = new Set(conversationRunIds.split("|").filter(Boolean));
      if (
        event.type.startsWith("agent_item.") &&
        typeof payload.runId === "string" &&
        runIds.has(payload.runId)
      ) {
        if (event.type === "agent_item.delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          setDetail((current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === payload.itemId
                      ? { ...item, content: `${item.content ?? ""}${delta}` }
                      : item,
                  ),
                }
              : current,
          );
        } else if (typeof payload.id === "string") {
          const item = payload as unknown as AgentItem;
          setDetail((current) =>
            current
              ? {
                  ...current,
                  items: upsertGlobalAgentItem(current.items, item),
                }
              : current,
          );
        }
      }
      if (
        [
          "agent_run.completed",
          "agent_run.failed",
          "agent_run.interrupted",
          "change_preview.created",
          "provider_action_preview.created",
        ].includes(event.type) &&
        conversationId
      )
        void loadDetail(conversationId).catch(() => undefined);
    });
    return unsubscribe;
  }, [client, conversationId, conversationRunIds, detail?.conversation.id]);

  const ensureConversation = async (
    requestedWebAccess = webAccessMode,
  ): Promise<AgentSession> => {
    const requestedModel = modelId.trim() || undefined;
    const selected = conversations.find((item) => item.id === conversationId);
    if (
      selected?.engineKind === engineKind &&
      selected.projectId === (projectId || undefined) &&
      (selected.model?.modelId ?? undefined) === requestedModel
    ) {
      if (selected.webAccessMode !== requestedWebAccess) {
        const updated = await client.assistantConversations.update(
          selected.id,
          {
            webAccessMode: requestedWebAccess,
          },
        );
        setDetail((current) =>
          current?.conversation.id === updated.id
            ? { ...current, conversation: updated }
            : current,
        );
        return updated;
      }
      return selected;
    }
    const created = await client.assistantConversations.create({
      surface: "global",
      ...(projectId ? { projectId } : {}),
      engineKind,
      webAccessMode: requestedWebAccess,
      ...(requestedModel ? { model: { modelId: requestedModel } } : {}),
    });
    await loadConversations(created.id);
    setDetail({
      conversation: created,
      turns: [],
      runs: [],
      items: [],
      changePreviews: [],
      providerActionPreviews: [],
    });
    return created;
  };

  const send = async (taskType?: AgentTaskType) => {
    const userMessage =
      draft.trim() ||
      taskDefinitions.find((item) => item.id === taskType)?.label;
    if (
      !userMessage ||
      busy ||
      (activeRun && ["queued", "running"].includes(activeRun.status))
    )
      return;
    const requestedOperation = taskType
      ? creationOperationForTask(taskType)
      : undefined;
    if (
      requestedOperation &&
      ["chapter", "script-revision", "shot-prompt"].includes(
        requestedOperation,
      ) &&
      (!selectedContentTarget || requestedOperation !== operation)
    ) {
      if (taskType) setSelectedTask(taskType);
      setNotice(
        "请展开「模型与更多任务」选择本次生成或修订的目标，再执行任务。",
      );
      return;
    }
    if (!selectedEngineCanRun) {
      setNotice(
        selectedEngine?.statusMessage ?? "所选智能引擎当前不可用，请切换引擎",
      );
      return;
    }
    if (session.pendingIntent?.actionId === "global-assistant:send")
      session.clearPendingIntent();
    assistantScroll.followLatest();
    setBusy(true);
    setNotice(undefined);
    try {
      let effectiveWebAccess = webAccessMode;
      if (
        effectiveWebAccess === "auto" &&
        !(await requestWebResearchConsent())
      ) {
        effectiveWebAccess = "off";
        setWebAccessMode("off");
      }
      const conversation = await ensureConversation(effectiveWebAccess);
      const started = await client.assistantConversations.sendMessage(
        conversation.id,
        {
          message: userMessage,
          ...(taskType ? { taskType } : {}),
          ...(requestedOperation && selectedContentTarget
            ? requestedOperation === "chapter"
              ? {
                  chapterId: selectedContentTarget.id,
                  chapterBaseVersion: selectedContentTarget.version,
                }
              : {
                  target: {
                    id: selectedContentTarget.id,
                    baseVersion: selectedContentTarget.version,
                  },
                }
            : {}),
        },
      );
      setDraft("");
      setDetail((current) => {
        const previous =
          current?.conversation.id === conversation.id
            ? current
            : {
                conversation: started.conversation,
                turns: [],
                runs: [],
                items: [],
                changePreviews: [],
                providerActionPreviews: [],
              };
        return {
          ...previous,
          conversation: started.conversation,
          turns: [
            ...previous.turns.filter((turn) => turn.id !== started.turn.id),
            started.turn,
          ],
          runs: started.run
            ? [
                ...previous.runs.filter((run) => run.id !== started.run?.id),
                started.run,
              ]
            : previous.runs,
        };
      });
      await loadDetail(conversation.id);
      void loadConversations(conversation.id);
      if (!started.run && !started.turn.route?.workflowId)
        setNotice(started.turn.route?.clarification ?? "请补充任务上下文");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const bindProject = async () => {
    if (!conversationId || !projectId || detail?.conversation.projectId) return;
    try {
      await client.assistantConversations.bindProject(conversationId, {
        projectId,
      });
      await Promise.all([
        loadDetail(conversationId),
        loadConversations(conversationId),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    }
  };

  const archive = async () => {
    if (!conversationId) return;
    await client.assistantConversations.update(conversationId, {
      archived: true,
    });
    detailRequestRef.current = undefined;
    setConversationId(undefined);
    setDetail(undefined);
    await loadConversations();
  };

  const rename = async () => {
    if (!conversationId || !detail) return;
    const title = window
      .prompt("新的对话名称", detail.conversation.title ?? "未命名对话")
      ?.trim();
    if (!title) return;
    await client.assistantConversations.update(conversationId, { title });
    await Promise.all([
      loadDetail(conversationId),
      loadConversations(conversationId),
    ]);
  };

  const remove = async () => {
    if (!conversationId) return;
    if (
      !(await confirmDialog(
        "永久删除此对话及未采用预览？已采用的正式内容不会删除。",
      ))
    )
      return;
    await client.assistantConversations.remove(conversationId);
    detailRequestRef.current = undefined;
    setConversationId(undefined);
    setDetail(undefined);
    await loadConversations();
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-raised shadow-card">
      <header className="shrink-0 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">AI 办事助手</p>
            <p className="text-xs text-muted">
              聊天、读取上下文、执行任务，过程实时可见
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {detail && (
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <BareButton className="rounded-lg border border-line px-2 py-1.5 text-xs">
                    管理
                  </BareButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onSelect={() => void rename()}>
                    重命名
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void archive()}>
                    归档对话
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void remove()}>
                    永久删除
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu>
            )}
            <BareButton
              className="rounded-lg border border-line px-2 py-1.5 text-xs"
              onClick={() => beginNewConversation()}
            >
              新对话
            </BareButton>
          </div>
        </div>
        <select
          aria-label="全局助手对话历史"
          className="mt-3 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-xs"
          value={conversationId ?? ""}
          onChange={(event) => {
            if (event.target.value) setConversationId(event.target.value);
            else beginNewConversation();
          }}
        >
          <option value="">新对话（发送时创建）</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title ?? "未命名对话"} ·{" "}
              {AGENT_ENGINE_LABELS[conversation.engineKind]}
            </option>
          ))}
        </select>
        {!!archivedConversations.length && (
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer">
              已归档对话（{archivedConversations.length}）
            </summary>
            <div className="studio-scrollbar mt-2 max-h-28 space-y-1 overflow-y-auto">
              {archivedConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-2 py-1.5"
                >
                  <span className="truncate">
                    {conversation.title ?? "未命名对话"}
                  </span>
                  <BareButton
                    className="shrink-0 text-brand"
                    onClick={async () => {
                      await client.assistantConversations.update(
                        conversation.id,
                        { archived: false },
                      );
                      await loadConversations(conversation.id);
                    }}
                  >
                    恢复
                  </BareButton>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            aria-label="智能助手引擎"
            className="min-w-0 rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs"
            value={engineKind}
            onChange={(event) =>
              selectEngine(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => {
              const canRun = engine.canRun ?? engine.status === "available";
              return (
                <option
                  key={engine.kind}
                  value={engine.kind}
                  disabled={!canRun && engine.kind !== engineKind}
                >
                  {engine.name}
                  {canRun ? "" : " · 不可用"}
                </option>
              );
            })}
          </select>
          <select
            aria-label="对话项目上下文"
            className="min-w-0 rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs"
            value={projectId}
            disabled={Boolean(detail?.conversation.projectId)}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              if (nextProjectId) session.selectProject(nextProjectId);
            }}
          >
            <option value="">无项目 · 通用聊天</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          {detail && !detail.conversation.projectId && projectId && (
            <BareButton
              className="rounded-lg border border-brand px-2 py-1.5 text-xs text-brand"
              onClick={() => void bindProject()}
            >
              绑定
            </BareButton>
          )}
        </div>
        <p
          className={`mt-2 text-[11px] leading-4 ${selectedEngineCanRun ? "text-muted" : "text-amber-700"}`}
        >
          {conversationId ? "当前对话使用" : "新对话将使用"}「
          {selectedEngine?.name ?? AGENT_ENGINE_LABELS[engineKind]}」
          {conversationId ? "；切换引擎会创建新对话。" : "。"}
          {!selectedEngineCanRun && selectedEngine?.statusMessage
            ? ` ${selectedEngine.statusMessage}`
            : ""}
        </p>
        {!selectedEngineCanRun && (
          <AiSettingsLink
            actionId="global-assistant:send"
            projectId={projectId || undefined}
            input={draft}
            className="mt-1 inline-block text-xs font-medium text-brand underline"
          >
            前往设置并保留当前输入
          </AiSettingsLink>
        )}
      </header>
      <div
        ref={assistantScroll.scrollRef}
        className="studio-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
        aria-label="助手消息列表"
        onScroll={assistantScroll.onScroll}
      >
        <GlobalAssistantTimeline detail={detail} />
        {detail?.changePreviews
          .map(agentChangePreview)
          .filter((preview): preview is ChangePreview => Boolean(preview))
          .map((preview) => (
            <AgentChangePreviewCard
              key={preview.id}
              preview={preview}
              onCommitted={() =>
                conversationId ? void loadDetail(conversationId) : undefined
              }
            />
          ))}
        {detail?.providerActionPreviews
          .map(agentProviderActionPreview)
          .filter((preview): preview is ProviderActionPreview =>
            Boolean(preview),
          )
          .map((preview) => (
            <AgentProviderActionPreviewCard
              key={preview.id}
              preview={preview}
            />
          ))}
        {!detail?.turns.length && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">当前页面推荐</p>
            {recommendations.slice(0, 3).map((action) => (
              <BareButton
                key={action.actionId}
                className="w-full rounded-lg border border-line p-2 text-left text-xs hover:border-brand"
                disabled={!selectedEngineCanRun}
                onClick={() => void send(action.id)}
              >
                <span className="block font-medium">{action.label}</span>
                <span className="mt-1 block text-muted">{action.summary}</span>
              </BareButton>
            ))}
          </div>
        )}
        {notice && (
          <p className="rounded-lg bg-surface-muted p-2 text-xs leading-5 text-muted">
            {notice}
          </p>
        )}
      </div>
      <footer className="shrink-0 border-t border-line p-3">
        <details className="mb-2 text-xs text-muted">
          <summary className="cursor-pointer">模型与更多任务</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input
              className="col-span-2"
              value={modelId}
              placeholder="默认模型"
              onChange={(event) => setModelId(event.target.value)}
            />
            <select
              className="col-span-2 rounded-lg border border-line bg-canvas px-2 py-1.5"
              value={selectedTask}
              onChange={(event) =>
                setSelectedTask(event.target.value as AgentTaskType)
              }
            >
              {taskDefinitions.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.category} · {task.label}
                </option>
              ))}
            </select>
            {operation &&
              ["chapter", "script-revision", "shot-prompt", "episode"].includes(
                operation,
              ) && (
                <select
                  aria-label="AI 内容目标"
                  className="col-span-2 rounded-lg border border-line bg-canvas p-2"
                  value={selectedContentTarget?.id ?? ""}
                  onChange={(event) => setContentTargetId(event.target.value)}
                >
                  <option value="">选择本次内容目标</option>
                  {contentTargets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              )}
            <BareButton
              className="col-span-2 rounded-lg border border-brand py-1.5 text-brand"
              disabled={!selectedEngineCanRun}
              onClick={() => void send(selectedTask)}
            >
              执行所选任务
            </BareButton>
          </div>
        </details>
        <textarea
          aria-label="给 AI 办事助手发消息"
          className="min-h-16 w-full resize-none rounded-xl border border-line bg-canvas p-3 text-sm leading-6 outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (activeRun && ["queued", "running"].includes(activeRun.status))
                void client.agentSessions.interrupt(activeRun.id);
              else void send();
            }
          }}
          placeholder="直接提问或交代任务…"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <AssistantWebAccessControl
              mode={webAccessMode}
              disabled={Boolean(activeRun)}
              onChange={(next) => void changeWebAccessMode(next)}
            />
            <span className="truncate text-[11px] text-muted">
              {projectId ? "使用项目只读上下文" : "通用聊天"}
            </span>
          </div>
          <div className="flex gap-2">
            {!activeRun && interruptedRun && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await client.agentSessions.resume(interruptedRun.id);
                  if (conversationId) await loadDetail(conversationId);
                }}
              >
                恢复
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              className={
                session.pendingIntent?.actionId === "global-assistant:send"
                  ? "ring-2 ring-brand ring-offset-2"
                  : undefined
              }
              disabled={
                busy ||
                (!draft.trim() && !activeRun) ||
                (!activeRun && !selectedEngineCanRun)
              }
              onClick={() =>
                activeRun
                  ? void client.agentSessions.interrupt(activeRun.id)
                  : void send()
              }
            >
              {activeRun
                ? "停止"
                : session.pendingIntent?.actionId === "global-assistant:send"
                  ? "配置已完成，确认继续"
                  : "发送"}
            </Button>
          </div>
        </div>
      </footer>
    </section>
  );
}

export function GlobalAssistantTimeline(props: {
  detail?: AssistantConversationDetail;
  surface?: "global" | "inspiration";
}) {
  const client = useStudio();
  if (!props.detail?.turns.length)
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-sm leading-6 text-muted">
        {props.surface === "inspiration"
          ? "从一个画面、角色、疑问或情绪开始。这里不会催促你创建项目。"
          : "直接告诉我你想了解什么，或者希望我完成什么。未绑定项目时，我只进行通用聊天，不会调用项目工具。"}
      </div>
    );
  return (
    <div
      className="space-y-4"
      aria-label={
        props.surface === "inspiration"
          ? "灵感空间消息时间线"
          : "全局助手消息时间线"
      }
    >
      {props.detail.turns.map((turn) => {
        const run = props.detail?.runs.find((item) => item.id === turn.runId);
        const items = run
          ? (props.detail?.items.filter((item) => item.runId === run.id) ?? [])
          : [];
        const verifiedWebUrls = new Set(
          items.flatMap((item) => {
            if (
              item.type !== "tool_result" ||
              item.content !== "dramaip_read_web_page"
            )
              return [];
            const result = recordPayload(recordPayload(item.payload).result);
            return typeof result.url === "string" ? [result.url] : [];
          }),
        );
        return (
          <article key={turn.id} className="space-y-2">
            <div className="ml-8 rounded-xl rounded-tr-sm bg-studio-dark px-3 py-2 text-sm leading-6 text-white">
              <p className="whitespace-pre-wrap">{turn.userMessage}</p>
              <p className="mt-1 text-[10px] text-white/60">
                {props.surface === "inspiration"
                  ? "灵感对话"
                  : turn.projectId
                    ? "项目上下文"
                    : "通用对话"}
                {turn.chapterId ? ` · 章节 ${turn.chapterId.slice(0, 8)}` : ""}
                {turn.routingInputTokens !== undefined
                  ? ` · 意图识别 ${turn.routingInputTokens + (turn.routingOutputTokens ?? 0)} Token`
                  : ""}
              </p>
            </div>
            {turn.route?.workflowId && (
              <CreationRunCard id={turn.route.workflowId} />
            )}
            {turn.route?.kind === "clarify" && (
              <p className="mr-8 rounded-xl rounded-tl-sm bg-surface-muted px-3 py-2 text-sm leading-6">
                {turn.route.clarification}
              </p>
            )}
            {turn.status === "routing" && !run && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                正在理解你的要求
              </p>
            )}
            <AssistantStageSummary
              items={items}
              active={Boolean(
                run && ["queued", "running"].includes(run.status),
              )}
            />
            {items
              .filter((item) => item.type === "tool_call")
              .map((item) => (
                <AssistantToolActivity key={item.id} item={item} />
              ))}
            {items
              .filter((item) =>
                ["message", "structured_output", "error"].includes(item.type),
              )
              .map((item) => (
                <div
                  key={item.id}
                  className="mr-8 rounded-xl rounded-tl-sm border border-line bg-canvas px-3 py-2 text-sm leading-6"
                >
                  <AssistantMessageContent content={item.content} />
                  {item.status === "streaming" && (
                    <span className="inline-block h-3 w-1 animate-pulse bg-brand" />
                  )}
                </div>
              ))}
            {items
              .filter((item) => item.type === "tool_result")
              .map((item) => (
                <AssistantWebSourceCards
                  key={item.id}
                  payload={item.payload}
                  verifiedUrls={verifiedWebUrls}
                  onOpen={(url) => void client.host.openExternal(url)}
                />
              ))}
            {run &&
              ["queued", "running"].includes(run.status) &&
              !items.length && (
                <p className="text-xs text-muted">正在建立实时连接…</p>
              )}
          </article>
        );
      })}
    </div>
  );
}

export function upsertGlobalAgentItem(
  items: AgentItem[],
  next: AgentItem,
): AgentItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  const updated = [...items];
  updated[index] = { ...updated[index]!, ...next };
  return updated;
}

export function AgentTaskConfigPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const session = useStudioSession();
  const { data: projects = [] } = useQuery({
    queryKey: ["agent-projects", location.pathname],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(
    () => contextAssistantProjectId(location) ?? session.activeProjectId ?? "",
  );
  const [chapterId, setChapterId] = useState("");
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("pi");
  const [taskType, setTaskType] = useState<AgentTaskType>("chapter_diagnostic");
  const [modelId, setModelId] = useState("");
  const [experimentMode, setExperimentMode] = useState<
    "recommended" | "same_model"
  >("recommended");
  const [assistantMode, setAssistantMode] = useState<"simple" | "advanced">(
    "simple",
  );
  const [prompt, setPrompt] = useState(
    () => session.pendingIntent?.input ?? "",
  );
  const [notice, setNotice] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>();
  const [experimentId, setExperimentId] = useState<string>();
  const { data: engines = [] } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 5_000,
  });
  const { data: taskDefinitions = [] } = useQuery({
    queryKey: ["agent-task-definitions"],
    queryFn: client.agentEngines.listTasks,
  });
  const { data: projectSettings } = useQuery({
    queryKey: ["project-agent-settings", projectId],
    queryFn: () => client.agentEngines.getProjectSettings(projectId),
    enabled: Boolean(projectId),
  });
  const { data: chapters = [] } = useQuery({
    queryKey: ["agent-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: contextShots = [] } = useQuery({
    queryKey: ["agent-shots", projectId],
    queryFn: () => client.resources.list("shots", projectId),
    enabled: Boolean(projectId),
  });
  const requestedProjectId =
    contextAssistantProjectId(location) ?? session.activeProjectId;
  const requestedShotId = new URLSearchParams(location.search).get("shotId");
  useEffect(() => {
    if (requestedProjectId && projectId !== requestedProjectId) {
      setProjectId(requestedProjectId);
      return;
    }
  }, [projectId, projects, requestedProjectId]);
  useEffect(() => setChapterId(""), [projectId]);
  useEffect(() => {
    if (projectSettings) {
      setEngineKind(projectSettings.defaultEngineKind);
      setModelId(projectSettings.defaultModel?.modelId ?? "");
      setAssistantMode(projectSettings.assistantMode);
    }
  }, [projectSettings]);
  const selectedTask = taskDefinitions.find((item) => item.id === taskType);
  const requiresChapter =
    selectedTask?.category === "章节写作" ||
    selectedTask?.category === "记忆与连续性";
  const contextPage = contextAssistantPage(location.pathname);
  const selectedShot = contextShots.find((shot) => shot.id === requestedShotId);
  const selectedShotPayload = selectedShot
    ? recordPayload(selectedShot.payload)
    : {};
  const shotContext = selectedShot
    ? [
        `当前导演看板分镜：${selectedShot.title}`,
        selectedShotPayload["镜头描述"]
          ? `镜头画面：${String(selectedShotPayload["镜头描述"])}`
          : "",
        selectedShotPayload["生成提示"]
          ? `已有提示：${String(selectedShotPayload["生成提示"])}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const contextualPrompt = [shotContext, prompt.trim()]
    .filter(Boolean)
    .join("\n\n");
  const { actions: contextActions, missingTaskTypes } =
    resolveContextAssistantActions({
      page: contextPage,
      catalog: taskDefinitions,
    });
  const selectedEngine = engines.find((engine) => engine.kind === engineKind);
  const preflightFor = (action: (typeof contextActions)[number]) =>
    contextAssistantPreflight({
      action,
      projectId,
      chapterId,
      engine: selectedEngine,
      modelId,
    });
  const updateAssistantMode = useMutation({
    mutationFn: (nextMode: "simple" | "advanced") => {
      if (!projectId) throw new Error("请先选择项目以保存助手偏好");
      return client.agentEngines.updateProjectSettings(projectId, {
        defaultEngineKind: projectSettings?.defaultEngineKind ?? engineKind,
        ...(projectSettings?.defaultModel
          ? { defaultModel: projectSettings.defaultModel }
          : {}),
        assistantMode: nextMode,
      });
    },
    onSuccess: async (settings) => {
      setAssistantMode(settings.assistantMode);
      setNotice(
        settings.assistantMode === "advanced"
          ? "已恢复完整任务目录和高级参数。"
          : "已切换为当前页面的简洁助手。",
      );
      await queryClient.invalidateQueries({
        queryKey: ["project-agent-settings", projectId],
      });
    },
    onError: (cause) => {
      setAssistantMode(projectSettings?.assistantMode ?? "simple");
      setNotice(message(cause));
    },
  });
  const runAgent = useMutation({
    mutationFn: async (requested?: { taskType?: AgentTaskType }) => {
      if (!projectId) throw new Error("请先创建或选择一个项目");
      const requestedTaskType = requested?.taskType ?? taskType;
      const definition = taskDefinitions.find(
        (item) => item.id === requestedTaskType,
      );
      const taskRequiresChapter =
        definition?.category === "章节写作" ||
        definition?.category === "记忆与连续性";
      if (taskRequiresChapter && !chapterId)
        throw new Error("此智能任务需要先选择一个章节");
      const session = await client.agentSessions.create({
        projectId,
        ...(chapterId ? { chapterId } : {}),
        engineKind,
        taskType: requestedTaskType,
        title: definition?.label,
        ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
      });
      return client.agentSessions.run(session.id, {
        taskType: requestedTaskType,
        ...(modelId.trim() ? { model: { modelId: modelId.trim() } } : {}),
        ...(contextualPrompt ? { prompt: contextualPrompt } : {}),
      });
    },
    onSuccess: (result, requested) => {
      const definition = taskDefinitions.find(
        (item) => item.id === (requested?.taskType ?? taskType),
      );
      setActiveRunId(result.runId);
      setActiveWorkflowId(result.workflowId);
      setNotice(
        `${definition?.label ?? "智能"}任务已创建：${result.taskId.slice(0, 8)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const { data: activeRun } = useQuery({
    queryKey: ["agent-run", activeRunId],
    queryFn: () => client.agentSessions.getRun(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 1_000 : false,
  });
  const { data: activeItems = [] } = useQuery({
    queryKey: ["agent-run-items", activeRunId],
    queryFn: () => client.agentSessions.listItems(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: activeRun?.status === "running" ? 1_000 : false,
  });
  const interruptRun = useMutation({
    mutationFn: () => client.agentSessions.interrupt(activeRunId!),
    onSuccess: (run) => {
      setNotice("智能任务已中断");
      queryClient.setQueryData(["agent-run", run.id], run);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const resumeRun = useMutation({
    mutationFn: () => client.agentSessions.resume(activeRunId!),
    onSuccess: (run) => {
      setNotice("智能任务已恢复");
      queryClient.setQueryData(["agent-run", run.id], run);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const createExperiment = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("请先选择项目");
      if (requiresChapter && !chapterId)
        throw new Error("此盲测任务需要先选择章节");
      if (experimentMode === "same_model" && !modelId.trim())
        throw new Error("同模型盲测需要先填写本次模型");
      const selectedChapter = chapters.find((item) => item.id === chapterId);
      const estimatedInputPerEngine = Math.max(
        800,
        Math.ceil(
          ((selectedChapter?.content.length ?? 0) + contextualPrompt.length) /
            1.6,
        ) + 600,
      );
      const estimatedOutputPerEngine =
        selectedTask?.writePolicy === "readonly" ? 1_200 : 2_400;
      const confirmed = await confirmDialog(
        [
          "三引擎盲测会分别调用 Pi、Codex 和 LangGraph.js，共产生三次模型费用。",
          experimentMode === "same_model"
            ? `比较方式：三个引擎统一使用模型 ${modelId.trim()}。`
            : "比较方式：各引擎使用各自当前推荐配置。",
          `预估输入：每个引擎约 ${estimatedInputPerEngine.toLocaleString("zh-CN")} Token；三次合计约 ${(estimatedInputPerEngine * 3).toLocaleString("zh-CN")} Token。`,
          `预估输出上限：每个引擎约 ${estimatedOutputPerEngine.toLocaleString("zh-CN")} Token；三次合计约 ${(estimatedOutputPerEngine * 3).toLocaleString("zh-CN")} Token。`,
          "预估费用：各引擎的模型与认证计价可能不同，未配置统一单价时无法可靠折算金额；应用会在运行后记录实际 Token 与厂商返回的费用。",
          "确认开始吗？",
        ].join("\n\n"),
      );
      if (!confirmed) throw new Error("已取消三引擎盲测");
      return client.agentExperiments.create(
        {
          projectId,
          ...(chapterId ? { chapterId } : {}),
          taskType,
          comparisonMode: experimentMode,
          ...(experimentMode === "same_model"
            ? { model: { modelId: modelId.trim() } }
            : {}),
          ...(contextualPrompt ? { prompt: contextualPrompt } : {}),
          confirmedEstimatedCost: true,
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: (experiment) => {
      setExperimentId(experiment.id);
      setNotice("三引擎盲测已开始，结果将匿名展示");
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const { data: experiment } = useQuery({
    queryKey: ["agent-experiment", experimentId],
    queryFn: () => client.agentExperiments.get(experimentId!),
    enabled: Boolean(experimentId),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "")
        ? 1_000
        : false,
  });
  const reviewExperiment = useMutation({
    mutationFn: (preferredCandidate: "a" | "b" | "c" | "tie") =>
      client.agentExperiments.review(experimentId!, { preferredCandidate }),
    onSuccess: (result) => {
      queryClient.setQueryData(["agent-experiment", result.id], result);
      setNotice("盲测评价已保存，现在可以查看引擎名称");
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const revealExperiment = useMutation({
    mutationFn: () => client.agentExperiments.reveal(experimentId!),
    onSuccess: (result) => {
      queryClient.setQueryData(["agent-experiment", result.id], result);
      setNotice("盲测引擎已揭晓");
    },
    onError: (cause) => setNotice(message(cause)),
  });
  return (
    <section
      aria-label="智能任务配置"
      className="rounded-xl border border-line bg-gradient-to-br from-surface-raised to-brand-soft p-6 shadow-card"
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">当前任务上下文</p>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
          受控引擎
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        尽意智能助手经由
        本地服务代理，只使用受控的只读工具；所有内容改动和付费厂商调用都必须由你确认。
      </p>
      <div
        className="mt-3 flex rounded-lg border border-line bg-surface-raised p-1 text-xs"
        role="group"
        aria-label="智能助手模式"
      >
        <BareButton
          className={`flex-1 rounded-md px-2 py-1.5 ${assistantMode === "simple" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
          disabled={!projectId || updateAssistantMode.isPending}
          onClick={() => {
            setAssistantMode("simple");
            updateAssistantMode.mutate("simple");
          }}
        >
          简洁模式
        </BareButton>
        <BareButton
          className={`flex-1 rounded-md px-2 py-1.5 ${assistantMode === "advanced" ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
          disabled={!projectId || updateAssistantMode.isPending}
          onClick={() => {
            setAssistantMode("advanced");
            updateAssistantMode.mutate("advanced");
          }}
        >
          高级模式
        </BareButton>
      </div>
      <select
        className="mt-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm"
        value={projectId}
        onChange={(event) => {
          const nextProjectId = event.target.value;
          setProjectId(nextProjectId);
          if (nextProjectId) session.selectProject(nextProjectId);
        }}
      >
        <option value="">选择诊断项目</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
      {selectedShot && (
        <p
          className="mt-3 rounded-lg bg-brand-soft p-3 text-xs leading-5 text-brand"
          aria-label="当前分镜上下文"
        >
          当前分镜：{selectedShot.title}
          。已从导演看板带入；新建任务会附带这段镜头上下文，不需要重复选择父级资料。
        </p>
      )}
      <select
        className="mt-3 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm"
        value={chapterId}
        onChange={(event) => setChapterId(event.target.value)}
        disabled={!projectId}
      >
        <option value="">项目级诊断（可选）</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.title}（助手上下文）
          </option>
        ))}
      </select>
      {assistantMode === "simple" && (
        <section className="mt-4 space-y-3" aria-label="当前页面推荐动作">
          <div>
            <p className="text-sm font-medium">当前页面推荐</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              已根据当前页面和项目输入筛选；每次任务都会保留可追溯快照，结果仅进入预览或变更包。
            </p>
          </div>
          {contextActions.map((action) => {
            const preflight = preflightFor(action);
            const isReturnedAction =
              session.pendingIntent?.actionId === action.actionId;
            const costLabel =
              preflight.cost === "unknown"
                ? "费用：待厂商调用预览确认"
                : "费用：模型调用按服务商账单结算";
            return (
              <article
                key={action.actionId}
                className="rounded-xl border border-line bg-surface-raised p-3"
              >
                <p className="text-sm font-medium">{action.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {action.summary}
                </p>
                <p className="mt-2 text-xs text-muted">
                  输入：
                  {preflight.input === "ready"
                    ? "已就绪"
                    : preflight.input === "chapter-required"
                      ? "需要选择章节"
                      : "需要选择项目"}
                  <br />
                  能力：
                  {preflight.capability === "ready"
                    ? `${selectedEngine?.name ?? "智能引擎"} 可用`
                    : preflight.capability === "unavailable"
                      ? "所选引擎当前不可用"
                      : "需要配置引擎或默认模型"}
                  <br />
                  {costLabel}
                </p>
                {!preflight.ready && (
                  <div className="mt-2 text-xs leading-5 text-amber-700">
                    {preflight.fixes.map((fix) => (
                      <p key={fix}>{fix}</p>
                    ))}
                    <AiSettingsLink
                      actionId={action.actionId}
                      projectId={projectId || undefined}
                      chapterId={chapterId || undefined}
                      input={prompt}
                      className="text-brand hover:underline"
                    >
                      前往设置修复
                    </AiSettingsLink>
                  </div>
                )}
                <BareButton
                  className={`mt-3 w-full rounded-lg border border-brand bg-surface-raised px-3 py-2 text-sm font-medium text-brand disabled:opacity-50 ${isReturnedAction ? "ring-2 ring-brand ring-offset-2" : ""}`}
                  disabled={runAgent.isPending || !preflight.ready}
                  onClick={() => {
                    if (isReturnedAction) session.clearPendingIntent();
                    runAgent.mutate({ taskType: action.id });
                  }}
                >
                  {runAgent.isPending
                    ? "正在创建任务…"
                    : isReturnedAction
                      ? "配置已完成，确认继续"
                      : `生成${action.label}预览`}
                </BareButton>
              </article>
            );
          })}
          {!contextActions.length && !missingTaskTypes.length && (
            <p className="rounded-lg border border-line bg-surface-raised p-3 text-xs text-muted">
              正在读取受控任务目录…
            </p>
          )}
          {!!missingTaskTypes.length && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              当前安装的任务目录缺少推荐动作，请更新本地服务后重试。
            </p>
          )}
        </section>
      )}
      {assistantMode === "advanced" && (
        <>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            智能引擎
            <select
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              value={engineKind}
              onChange={(event) =>
                setEngineKind(event.target.value as AgentEngineKind)
              }
            >
              {engines.map((engine) => (
                <option
                  key={engine.kind}
                  value={engine.kind}
                  disabled={engine.status !== "available"}
                >
                  {engine.name} ·{" "}
                  {engine.status === "available"
                    ? "可用"
                    : engine.status === "degraded"
                      ? "运行异常"
                      : "不可用"}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            智能任务
            <select
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              value={taskType}
              onChange={(event) =>
                setTaskType(event.target.value as AgentTaskType)
              }
            >
              {Array.from(
                new Set(taskDefinitions.map((item) => item.category)),
              ).map((category) => (
                <optgroup key={category} label={category}>
                  {taskDefinitions
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            本次模型（可选）
            <input
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="留空时使用项目或引擎默认模型"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          <label className="mt-3 grid gap-1 text-sm text-muted">
            盲测比较方式
            <select
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              value={experimentMode}
              onChange={(event) =>
                setExperimentMode(
                  event.target.value as "recommended" | "same_model",
                )
              }
            >
              <option value="recommended">各引擎推荐配置</option>
              <option value="same_model">三个引擎使用同一模型</option>
            </select>
          </label>
          {requiresChapter && !chapterId && (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              此任务需要先选择章节。生成结果只会创建待确认预览，不会直接改写正式内容。
            </p>
          )}
          <label className="mt-3 grid gap-1 text-sm text-muted">
            任务要求（可选）
            <textarea
              className="min-h-24 rounded-lg border border-line bg-surface-raised p-3 text-sm text-ink"
              placeholder={
                selectedTask?.writePolicy === "change-preview"
                  ? "例如：保持原有悬疑节奏，强化主角动机，并保留结尾钩子。"
                  : "例如：检查人物动机是否连贯，并给出可执行建议。"
              }
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <BareButton
            className="mt-3 w-full rounded-lg border border-brand bg-surface-raised px-3 py-2 text-sm font-medium text-brand disabled:opacity-50"
            disabled={
              runAgent.isPending ||
              !projectId ||
              (requiresChapter && !chapterId) ||
              engines.find((engine) => engine.kind === engineKind)?.status !==
                "available"
            }
            onClick={() => runAgent.mutate({})}
          >
            {runAgent.isPending
              ? "正在创建任务…"
              : `执行${selectedTask?.label ?? "智能任务"}`}
          </BareButton>
          <BareButton
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={
              createExperiment.isPending ||
              !projectId ||
              (requiresChapter && !chapterId)
            }
            onClick={() => createExperiment.mutate()}
          >
            {createExperiment.isPending ? "正在创建盲测…" : "启动三引擎盲测"}
          </BareButton>
        </>
      )}
      {activeWorkflowId && <CreationRunCard id={activeWorkflowId} />}
      {activeRun && !activeWorkflowId && (
        <section className="mt-4 rounded-xl border border-line bg-surface-raised p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">任务条目流</p>
            <span className="text-xs text-muted">
              {TASK_STATUS_LABELS[activeRun.status] ?? "状态未知"}
            </span>
          </div>
          <div className="mt-2 max-h-48 space-y-2 overflow-auto">
            {activeItems.map((item) => (
              <div key={item.id} className="rounded-lg bg-canvas p-2 text-xs">
                <p className="font-medium">
                  {item.type === "message"
                    ? "正式输出"
                    : item.type === "tool_call"
                      ? "工具调用"
                      : item.type === "tool_result"
                        ? "工具结果"
                        : item.type === "usage"
                          ? "用量"
                          : item.type === "structured_output"
                            ? "结构化结果"
                            : item.type === "error"
                              ? "错误"
                              : "推理摘要"}
                </p>
                {item.content && (
                  <p className="mt-1 whitespace-pre-wrap text-muted">
                    {item.content}
                  </p>
                )}
              </div>
            ))}
            {!activeItems.length && (
              <p className="text-xs text-muted">正在等待引擎返回正式输出…</p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            输入 {activeRun.inputTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            输出 {activeRun.outputTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            缓存 {activeRun.cachedTokens?.toLocaleString("zh-CN") ?? "待统计"} ·
            {activeRun.estimatedCost === undefined
              ? "费用待厂商结算"
              : `预估费用 ${activeRun.estimatedCost.toFixed(4)} ${activeRun.currency ?? "USD"}`}
          </p>
          <div className="mt-2 flex gap-2">
            {activeRun.status === "running" && (
              <BareButton
                className="rounded-md border border-line px-2 py-1 text-xs"
                disabled={interruptRun.isPending}
                onClick={() => interruptRun.mutate()}
              >
                中断任务
              </BareButton>
            )}
            {activeRun.status === "interrupted" && (
              <BareButton
                className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                disabled={resumeRun.isPending}
                onClick={() => resumeRun.mutate()}
              >
                恢复任务
              </BareButton>
            )}
          </div>
        </section>
      )}
      {experiment && (
        <AgentExperimentCard
          experiment={experiment}
          reviewing={reviewExperiment.isPending}
          onReview={(candidate) => reviewExperiment.mutate(candidate)}
          revealing={revealExperiment.isPending}
          onReveal={() => revealExperiment.mutate()}
        />
      )}
      {notice && <p className="mt-3 text-xs leading-5 text-muted">{notice}</p>}
      <p className="mt-3 text-xs leading-5 text-muted">
        任务状态会实时同步到任务中心。
      </p>
    </section>
  );
}

export function AgentExperimentCard(props: {
  experiment: AgentExperiment;
  reviewing: boolean;
  onReview(candidate: "a" | "b" | "c" | "tie"): void;
  revealing: boolean;
  onReveal(): void;
}) {
  const candidateLabels = {
    a: "方案 A",
    b: "方案 B",
    c: "方案 C",
  };
  const candidateCount = props.experiment.candidates?.length ?? 0;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{candidateCount || 3} 引擎盲测</p>
        <span className="text-xs text-muted">
          {props.experiment.status === "ready_for_review"
            ? "等待评价"
            : props.experiment.status === "completed"
              ? "评价完成"
              : props.experiment.status === "failed"
                ? "盲测失败"
                : "运行中"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {props.experiment.comparisonMode === "same_model"
          ? `同模型比较：${props.experiment.model?.modelId ?? "模型未记录"}`
          : "各引擎推荐配置比较"}
      </p>
      <div className="mt-2 space-y-2">
        {props.experiment.candidates?.map((candidate) => (
          <article
            key={candidate.candidate}
            className="rounded-lg bg-canvas p-2 text-xs"
          >
            <p className="font-medium">
              {candidateLabels[candidate.candidate]}
              {props.experiment.revealed && candidate.engineKind
                ? ` · ${AGENT_EXPERIMENT_ENGINE_LABELS[candidate.engineKind]}`
                : ""}
            </p>
            <p className="mt-1 text-muted">
              {TASK_STATUS_LABELS[candidate.status] ?? "状态未知"}
            </p>
            {candidate.metrics && (
              <p className="mt-1 text-muted">
                耗时 {(candidate.metrics.latencyMs / 1000).toFixed(1)} 秒 · 输入{" "}
                {candidate.metrics.inputTokens.toLocaleString("zh-CN")} · 输出{" "}
                {candidate.metrics.outputTokens.toLocaleString("zh-CN")}
                {candidate.metrics.estimatedCost !== undefined
                  ? ` · 预估费用 ${candidate.metrics.estimatedCost.toFixed(4)} ${candidate.metrics.currency ?? "USD"}`
                  : " · 费用待厂商结算"}
                {candidate.metrics.formatError ? " · 格式不合格" : ""}
                {candidate.metrics.toolViolation ? " · 工具违规" : ""}
                {candidate.metrics.adopted ? " · 已采用" : ""}
              </p>
            )}
            {candidate.output !== undefined && (
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-muted">
                {taskResultText(candidate.output)}
              </p>
            )}
            {props.experiment.status === "ready_for_review" && (
              <BareButton
                className="mt-2 rounded-md border border-brand px-2 py-1 text-brand disabled:opacity-50"
                disabled={props.reviewing}
                onClick={() => props.onReview(candidate.candidate)}
              >
                选择此方案
              </BareButton>
            )}
          </article>
        ))}
      </div>
      {props.experiment.status === "ready_for_review" && (
        <BareButton
          className="mt-2 rounded-md border border-line px-2 py-1 text-xs disabled:opacity-50"
          disabled={props.reviewing}
          onClick={() => props.onReview("tie")}
        >
          {candidateCount} 个方案相当
        </BareButton>
      )}
      {props.experiment.status === "completed" &&
        !props.experiment.revealed && (
          <BareButton
            className="mt-2 rounded-md border border-brand px-2 py-1 text-xs text-brand disabled:opacity-50"
            disabled={props.revealing}
            onClick={props.onReveal}
          >
            {props.revealing ? "正在揭晓…" : "揭晓引擎"}
          </BareButton>
        )}
    </section>
  );
}
