import { creationOperationForTask } from "@dramaip/contracts/creation";
import { CreationRunCard } from "../creation-workbench";
import { AgentUsagePanel } from "../AgentUsagePanel";
import type {
  AgentEngineKind,
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
  Dialog,
  DropdownMenu,
  NativeSelect,
} from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import { useQuery } from "../../query";
import { useEffect, useRef, useState } from "react";
import { IconSparkleRegular as Sparkles } from "@dramaip/infra-ui-primitives";
import { useLocation, useNavigate } from "../../router";
import {
  contextAssistantPage,
  contextAssistantProjectId,
  resolveContextAssistantActions,
} from "../../context-assistant";
import {
  agentChangePreview,
  agentProviderActionPreview,
  message,
  useStudio,
} from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import {
  AssistantMessageContent,
  AssistantStageSummary,
  AssistantToolActivity,
  AssistantWebAccessControl,
  AssistantWebSourceCards,
  useAssistantAutoScroll,
} from "../assistant-message-content";
import {
  AgentChangePreviewCard,
  AgentAssistantProviderActionPreviewCard,
  recordPayload,
} from "../studio-widgets";
import styles from "./impl.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";
import { assistantProviderModels } from "./assistant-models";
export function AgentSidePanel() {
  const client = useStudio();
  const session = useStudioSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [management, setManagement] = useState<
    { kind: "archived" } | { kind: "usage"; runId: string; projectId?: string }
  >();
  const [managementError, setManagementError] = useState<string>();
  const [restoringId, setRestoringId] = useState<string>();
  const { data: projects = [] } = useQuery({
    queryKey: ["assistant-chat-projects"],
    queryFn: client.projects.list,
  });
  const { data: engines = [] } = useQuery({
    queryKey: ["assistant-chat-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 2_000,
  });
  const { data: settings } = useQuery({
    queryKey: ["assistant-chat-settings"],
    queryFn: client.agentEngines.getGlobalSettings,
    refetchInterval: 2_000,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
    refetchInterval: 2_000,
  });
  const { data: modelCatalog } = useQuery({
    queryKey: ["assistant-model-catalog"],
    queryFn: client.providers.catalog,
  });
  const { data: taskDefinitions = [] } = useQuery({
    queryKey: ["assistant-chat-tasks"],
    queryFn: client.agentEngines.listTasks,
  });
  const contextProjectId =
    contextAssistantProjectId(location) ?? session.activeProjectId;
  const [projectId, setProjectId] = useState(contextProjectId ?? "");
  const engineKind: AgentEngineKind = "pi";
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
  const assistantScroll = useAssistantAutoScroll(detail, conversationId);
  const activeRun = detail?.runs.find((run) =>
    ["queued", "preparing", "running"].includes(run.status),
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
  const activeProvider = providers.find(
    (provider) => provider.id === settings?.activeProviderId,
  );
  const models = assistantProviderModels(activeProvider, modelCatalog);
  const configuredModel = recordPayload(activeProvider?.payload)["模型名称"];
  const defaultModelId =
    (!settings?.defaultModel?.providerId ||
      settings.defaultModel.providerId === activeProvider?.id) &&
    models.some((model) => model.id === settings?.defaultModel?.modelId)
      ? (settings?.defaultModel?.modelId ?? "")
      : typeof configuredModel === "string"
        ? configuredModel.trim()
        : "";
  const selectedModelId = modelId || defaultModelId;
  const selectedModelAvailable = models.some(
    (model) => model.id === selectedModelId,
  );

  const beginNewConversation = () => {
    detailRequestRef.current = undefined;
    setConversationId(undefined);
    setDetail(undefined);
    setModelId("");
    setWebAccessMode("auto");
    setNotice(undefined);
    window.localStorage.removeItem("dramaip-global-assistant-conversation");
  };

  const selectModel = (nextModelId: string) => {
    if (nextModelId === selectedModelId || busy || activeRun) return;
    if (!models.some((model) => model.id === nextModelId)) return;
    if (conversationId) {
      beginNewConversation();
    }
    setModelId(nextModelId);
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
    setConversations((items) =>
      items.map((item) =>
        item.id === id ? { ...item, title: value.conversation.title } : item,
      ),
    );
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
    if (!conversationId) setModelId("");
  }, [settings?.activeProviderId]);

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
      if (
        event.type === "agents.assistant-session-updated.v1" &&
        event.payload &&
        typeof event.payload === "object"
      ) {
        const updated = event.payload as Record<string, unknown>;
        if (
          typeof updated.sessionId === "string" &&
          typeof updated.title === "string"
        ) {
          const updateTitle = (items: AgentSession[]) =>
            items.map((item) =>
              item.id === updated.sessionId
                ? { ...item, title: updated.title as string }
                : item,
            );
          setConversations(updateTitle);
          setArchivedConversations(updateTitle);
        }
      }
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
    const requestedModel = selectedModelId.trim() || undefined;
    const selected = conversations.find((item) => item.id === conversationId);
    if (
      selected?.engineKind === engineKind &&
      selected.projectId === (projectId || undefined) &&
      (!selected.model?.providerId ||
        selected.model.providerId === activeProvider?.id) &&
      (selected.model?.modelId ?? defaultModelId) === requestedModel
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
      ...(requestedModel
        ? { model: { providerId: activeProvider?.id, modelId: requestedModel } }
        : {}),
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
    if (!userMessage || busy || activeRun) return;
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
      setNotice("请展开「更多任务」选择本次生成或修订的目标，再执行任务。");
      return;
    }
    if (!selectedEngineCanRun) {
      setNotice(
        selectedEngine?.statusMessage ??
          "智能引擎当前不可用，请前往设置检查配置。",
      );
      return;
    }
    if (!activeProvider || !selectedModelAvailable) {
      setNotice("请先在设置中启用模型服务商，再选择该服务商下的模型。");
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
    <section className={clsx(styles.c1, styles.assistantPanel)}>
      <header className={clsx(styles.c2, styles.assistantHeader)}>
        <div className={styles.c3}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantEmblem} aria-hidden="true">
              <Sparkles />
            </span>
            <div>
              <p className={styles.c4}>
                {copyText("app/features/agents/impl.1")}
              </p>
            </div>
          </div>
          <div className={styles.c6}>
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <BareButton className={styles.c7}>
                  {copyText("app/features/agents/impl.3")}
                </BareButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  disabled={!detail}
                  onSelect={() => void rename()}
                >
                  {copyText("app/features/agents/impl.4")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!detail}
                  onSelect={() => void archive()}
                >
                  {copyText("app/features/agents/impl.5")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!detail}
                  onSelect={() => void remove()}
                >
                  {copyText("app/features/agents/impl.6")}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelect={() => {
                    setManagementError(undefined);
                    setManagement({ kind: "archived" });
                  }}
                >
                  {copyText("app/features/agents/impl.archived")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!latestRun?.usageScope}
                  onSelect={() => {
                    if (!latestRun?.usageScope) return;
                    setManagementError(undefined);
                    setManagement({
                      kind: "usage",
                      runId: latestRun.id,
                      projectId: latestRun.usageScope.projectId,
                    });
                  }}
                >
                  {copyText("app/features/agents/impl.usage")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => {
                    session.savePendingIntent({
                      kind: "ai-action",
                      returnTo: `${location.pathname}${location.search}`,
                      actionId: "global-assistant:send",
                      ...(projectId ? { projectId } : {}),
                      ...(draft ? { input: draft } : {}),
                    });
                    navigate("/settings?setup=ai");
                  }}
                >
                  {copyText("app/features/agents/impl.modelSettings")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
            <BareButton
              className={styles.c7}
              onClick={() => beginNewConversation()}
            >
              {copyText("app/features/agents/impl.7")}
            </BareButton>
          </div>
        </div>
      </header>
      <div
        ref={assistantScroll.scrollRef}
        className={styles.c20}
        aria-label={copyText("app/features/agents/impl.17")}
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
            <AgentAssistantProviderActionPreviewCard
              key={preview.id}
              id={preview.id}
              projectId={detail.conversation.projectId}
              conversationId={detail.conversation.id}
            />
          ))}
        {!detail?.turns.length && (
          <div className={styles.c21}>
            <p className={styles.c22}>
              {copyText("app/features/agents/impl.18")}
            </p>
            {recommendations.slice(0, 3).map((action) => (
              <BareButton
                key={action.actionId}
                className={styles.c23}
                disabled={!selectedEngineCanRun}
                onClick={() => void send(action.id)}
              >
                <span className={styles.c24}>{action.label}</span>
                <span className={styles.c25}>{action.summary}</span>
              </BareButton>
            ))}
          </div>
        )}
        {notice && <p className={styles.c26}>{notice}</p>}
      </div>
      <footer className={clsx(styles.c27, styles.assistantComposer)}>
        <details className={styles.c28}>
          <summary className={styles.c10}>
            {copyText("app/features/agents/impl.19")}
          </summary>
          <div className={styles.c15}>
            <NativeSelect
              className={styles.c30}
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
            </NativeSelect>
            {operation &&
              ["chapter", "script-revision", "shot-prompt", "episode"].includes(
                operation,
              ) && (
                <NativeSelect
                  aria-label={copyText("app/features/agents/impl.21")}
                  className={styles.c31}
                  value={selectedContentTarget?.id ?? ""}
                  onChange={(event) => setContentTargetId(event.target.value)}
                >
                  <option value="">
                    {copyText("app/features/agents/impl.22")}
                  </option>
                  {contentTargets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </NativeSelect>
              )}
            <BareButton
              className={styles.c32}
              disabled={
                busy ||
                Boolean(activeRun) ||
                !selectedEngineCanRun ||
                !selectedModelAvailable
              }
              onClick={() => void send(selectedTask)}
            >
              {copyText("app/features/agents/impl.23")}
            </BareButton>
          </div>
        </details>
        <textarea
          aria-label={copyText("app/features/agents/impl.24")}
          className={styles.c33}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (activeRun) void client.agentSessions.interrupt(activeRun.id);
              else void send();
            }
          }}
          placeholder={copyText("app/features/agents/impl.25")}
        />
        <div className={styles.c34}>
          <div className={styles.c35}>
            <AssistantWebAccessControl
              mode={webAccessMode}
              disabled={Boolean(activeRun)}
              onChange={(next) => void changeWebAccessMode(next)}
            />
            <span className={styles.c36}>
              {projectId ? "使用项目只读上下文" : "通用聊天"}
            </span>
          </div>
          <div className={styles.c37}>
            {!activeRun && interruptedRun && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await client.agentSessions.resume(interruptedRun.id);
                  if (conversationId) await loadDetail(conversationId);
                }}
              >
                {copyText("app/features/agents/impl.11")}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              className={
                session.pendingIntent?.actionId === "global-assistant:send"
                  ? styles.c38
                  : undefined
              }
              disabled={
                busy ||
                (!draft.trim() && !activeRun) ||
                (!activeRun &&
                  (!selectedEngineCanRun || !selectedModelAvailable))
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
        <div className={styles.assistantSettings}>
          <label className={styles.historyRow}>
            <span className={styles.historyLabel}>
              {copyText("app/features/agents/impl.history")}
            </span>
            <NativeSelect
              aria-label={copyText("app/features/agents/impl.8")}
              className={styles.c8}
              value={conversationId ?? ""}
              onChange={(event) => {
                if (event.target.value) setConversationId(event.target.value);
                else beginNewConversation();
              }}
            >
              <option value="">{copyText("app/features/agents/impl.9")}</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title ?? "未命名对话"}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className={styles.c15}>
            <NativeSelect
              aria-label={copyText("app/features/agents/impl.12")}
              className={styles.c16}
              value={selectedModelId}
              disabled={busy || Boolean(activeRun) || !models.length}
              onChange={(event) => selectModel(event.target.value)}
            >
              {!selectedModelId && (
                <option value="">
                  {copyText("app/features/agents/impl.enableProvider")}
                </option>
              )}
              {selectedModelId && !selectedModelAvailable && (
                <option value={selectedModelId} disabled>
                  {selectedModelId}{" "}
                  {copyText("app/features/agents/impl.chooseModelAgain")}
                </option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {model.id === defaultModelId ? " · 默认" : ""}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={copyText("app/features/agents/impl.13")}
              className={styles.c16}
              value={projectId}
              disabled={Boolean(detail?.conversation.projectId)}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
              }}
            >
              <option value="">
                {copyText("app/features/agents/impl.14")}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </NativeSelect>
            {detail && !detail.conversation.projectId && projectId && (
              <BareButton
                className={styles.c17}
                onClick={() => void bindProject()}
              >
                {copyText("app/features/agents/impl.15")}
              </BareButton>
            )}
          </div>
        </div>
      </footer>
      <Dialog
        open={Boolean(management)}
        onOpenChange={(open) => {
          if (!open) setManagement(undefined);
        }}
      >
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>
            {copyText(
              management?.kind === "usage"
                ? "app/features/agents/impl.usage"
                : "app/features/agents/impl.archived",
            )}
          </Dialog.Title>
          {management?.kind === "archived" && (
            <div className={styles.c11}>
              {!archivedConversations.length && (
                <p>{copyText("app/features/agents/impl.noArchived")}</p>
              )}
              {archivedConversations.map((conversation) => (
                <div key={conversation.id} className={styles.c12}>
                  <span className={styles.c13}>
                    {conversation.title ?? "未命名对话"}
                  </span>
                  <Button
                    size="sm"
                    disabled={Boolean(restoringId)}
                    onClick={async () => {
                      setRestoringId(conversation.id);
                      setManagementError(undefined);
                      try {
                        await client.assistantConversations.update(
                          conversation.id,
                          { archived: false },
                        );
                        await loadConversations(conversation.id);
                        setManagement(undefined);
                      } catch (cause) {
                        setManagementError(message(cause));
                      } finally {
                        setRestoringId(undefined);
                      }
                    }}
                  >
                    {copyText("app/features/agents/impl.11")}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {management?.kind === "usage" && (
            <AgentUsagePanel
              key={`${management.projectId ?? "global"}:${management.runId}`}
              runId={management.runId}
              projectId={management.projectId}
            />
          )}
          {managementError && <p role="alert">{managementError}</p>}
        </Dialog.Content>
      </Dialog>
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
      <div className={styles.c39}>
        {props.surface === "inspiration"
          ? "从一个画面、角色、疑问或情绪开始。这里不会催促你创建项目。"
          : "直接告诉我你想了解什么，或者希望我完成什么。未绑定项目时，我只进行通用聊天，不会调用项目工具。"}
      </div>
    );
  return (
    <div
      className={styles.c40}
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
            if (item.type !== "tool_result" || item.content !== "dramaip_curl")
              return [];
            const result = recordPayload(recordPayload(item.payload).result);
            return typeof result.url === "string" ? [result.url] : [];
          }),
        );
        return (
          <article key={turn.id} className={styles.c21}>
            <div className={styles.c41}>
              <p className={styles.c42}>{turn.userMessage}</p>
              <p className={styles.c43}>
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
              <p className={styles.c44}>{turn.route.clarification}</p>
            )}
            {turn.status === "routing" && !run && (
              <p className={styles.c45}>
                <span className={styles.c46} />
                {copyText("app/features/agents/impl.26")}
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
                <div key={item.id} className={styles.c47}>
                  <AssistantMessageContent content={item.content} />
                  {item.status === "streaming" && (
                    <span className={styles.c48} />
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
                <p className={styles.c5}>
                  {copyText("app/features/agents/impl.27")}
                </p>
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
