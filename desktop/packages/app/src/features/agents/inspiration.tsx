import type {
  AgentEngineKind,
  AgentSession,
  AssistantConversationDetail,
  CreativeMemory,
  CreativeMemorySettings,
  CreativeMode,
  InspirationCard,
  InspirationCardKind,
  InspirationMemoryJob,
  InspirationProjectPreview,
  ProjectMode,
} from "@dramaip/contracts/product";
import type {
  CorpusCollectionItem,
  CorpusItem,
  CreativeExperiment,
  CreativeFingerprint,
  CreativeFingerprintDimensionKey,
} from "@dramaip/contracts";
import { BareButton, Button, Input, confirmDialog } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FlaskConical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message, useStudio } from "../../studio-shared";
import { AgentUsagePanel } from "../AgentUsagePanel";
import { inspirationMemoryStatus } from "../AgentAuxiliaryUsage";
import {
  projectInputFromBrief,
  projectModeBrief,
  projectModeConfigFromDraft,
} from "../../project-intake";
import {
  initializeProjectMaterials,
  ProjectInitializationError,
} from "../../project-creation-coordinator";
import { createCreationDraft, useStudioSession } from "../../studio-session";
import { NovelStoryPresetPicker } from "../novel/NovelStoryPresetPicker";
import {
  novelStoryPreset,
  projectInputFromStoryPreset,
  type NovelStoryPresetId,
} from "../novel/story-presets";
import { AssistantWebAccessControl } from "../assistant-message-content";
import { GlobalAssistantTimeline } from "./impl";

const MODES: readonly {
  id: CreativeMode;
  name: string;
  description: string;
  starter: string;
}[] = [
  {
    id: "free",
    name: "自由漫游",
    description: "开放联想，不急着得出结论",
    starter: "我脑中有一个模糊的画面，请陪我自由联想，不要急着下结论。",
  },
  {
    id: "guided",
    name: "新手引导",
    description: "一次一个问题，逐步找到故事前提",
    starter: "我想创作一个故事，但还没有方向。请一次只问我一个问题。",
  },
  {
    id: "character_interview",
    name: "角色访谈",
    description: "探索人物动机、秘密与矛盾",
    starter: "请像一位敏锐的访谈者，帮我发现这个角色真正想隐瞒的东西。",
  },
  {
    id: "world_simulation",
    name: "世界推演",
    description: "推演规则、阵营、历史与后果",
    starter: "我有一条世界规则，请和我一起推演它会造成的连锁反应。",
  },
  {
    id: "conflict_lab",
    name: "冲突实验室",
    description: "实验冲突、反转和替代方向",
    starter: "请为我的想法设计三个性质不同的核心冲突，并追问我更偏爱哪一个。",
  },
] as const;

const CARD_KINDS: readonly [InspirationCardKind, string][] = [
  ["premise", "故事前提"],
  ["character", "人物"],
  ["world", "世界观"],
  ["conflict", "冲突"],
  ["scene", "场景"],
  ["style", "风格"],
  ["question", "待探索问题"],
];

const PROJECT_MODES: readonly {
  id: ProjectMode;
  label: string;
  outcome: string;
}[] = [
  { id: "series_longform", label: "系列长篇", outcome: "第一章与长篇故事骨架" },
  { id: "single_season", label: "单季短剧", outcome: "母稿、人物、季纲与首集" },
  {
    id: "personal_theater",
    label: "我的 AI 小剧场",
    outcome: "第一集故事与人物授权",
  },
  {
    id: "creator_channel",
    label: "博主内容工作室",
    outcome: "主题与持续内容工作台",
  },
];

const FINGERPRINT_DIMENSION_LABELS: Record<
  CreativeFingerprintDimensionKey,
  string
> = {
  humor: "幽默感",
  genre: "题材偏好",
  tone: "叙事基调",
  pace: "节奏速度",
  conflict: "冲突强度",
  reversal: "反转偏好",
  emotional_intensity: "情绪浓度",
  visuality: "视觉表现",
  novelty: "新颖程度",
  production_complexity: "制作复杂度",
};

function activeRun(detail?: AssistantConversationDetail) {
  return detail?.runs.find((run) => ["queued", "running"].includes(run.status));
}

export function InspirationSpace() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const { data: engines = [] } = useQuery({
    queryKey: ["inspiration-engines"],
    queryFn: client.agentEngines.list,
  });
  const { data: webResearchSettings, refetch: refetchWebResearchSettings } =
    useQuery({
      queryKey: ["assistant-web-research-settings"],
      queryFn: client.assistantConversations.getWebResearchSettings,
    });
  const [conversations, setConversations] = useState<AgentSession[]>([]);
  const [archived, setArchived] = useState<AgentSession[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [detail, setDetail] = useState<AssistantConversationDetail>();
  const [mode, setMode] = useState<CreativeMode>("free");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cards, setCards] = useState<InspirationCard[]>([]);
  const [memories, setMemories] = useState<CreativeMemory[]>([]);
  const [settings, setSettings] = useState<CreativeMemorySettings>();
  const [memoryJobs, setMemoryJobs] = useState<InspirationMemoryJob[]>([]);
  const [corpusItems, setCorpusItems] = useState<CorpusItem[]>([]);
  const [collections, setCollections] = useState<CorpusCollectionItem[]>([]);
  const [fingerprint, setFingerprint] = useState<CreativeFingerprint>();
  const [experiments, setExperiments] = useState<CreativeExperiment[]>([]);
  const [corpusSearch, setCorpusSearch] = useState("");
  const [notice, setNotice] = useState<string>();
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionMode, setConversionMode] = useState<ProjectMode | undefined>(
    session.creationDraft?.projectMode,
  );
  const [conversionTitle, setConversionTitle] = useState(
    session.creationDraft?.brief.title ?? "",
  );
  const [conversionPresetId, setConversionPresetId] = useState<
    NovelStoryPresetId | undefined
  >(() =>
    novelStoryPreset(session.creationDraft?.storyPresetId as NovelStoryPresetId)
      ? (session.creationDraft?.storyPresetId as NovelStoryPresetId)
      : undefined,
  );
  const [conversionPreview, setConversionPreview] =
    useState<InspirationProjectPreview>();
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webAccessMode, setWebAccessMode] = useState<"auto" | "off">("auto");
  const loadedConsent = useRef(false);
  const run = activeRun(detail);
  const selectedEngine =
    engines.find((engine) => engine.isDefault && engine.canRun) ??
    engines.find((engine) => engine.canRun);

  const visibleConversations = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return keyword
      ? conversations.filter((item) =>
          (item.title ?? "未命名对话").toLocaleLowerCase().includes(keyword),
        )
      : conversations;
  }, [conversations, search]);

  const loadConversations = async (preferredId?: string) => {
    const [current, old] = await Promise.all([
      client.assistantConversations.list({ surface: "inspiration" }),
      client.assistantConversations.list({
        surface: "inspiration",
        archived: true,
      }),
    ]);
    setConversations(current);
    setArchived(old);
    const stored = window.localStorage.getItem(
      "dramaip-inspiration-conversation",
    );
    const next =
      preferredId ??
      (stored && current.some((item) => item.id === stored)
        ? stored
        : current[0]?.id);
    if (next) setConversationId(next);
  };

  const loadDetail = async (id: string) => {
    const value = await client.assistantConversations.get(id);
    setDetail(value);
    setMode(value.conversation.creativeMode ?? "free");
    setWebAccessMode(value.conversation.webAccessMode);
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
    if (run) return;
    try {
      const allowed =
        next === "auto" ? await requestWebResearchConsent() : false;
      const effective = next === "auto" && allowed ? "auto" : "off";
      setWebAccessMode(effective);
      if (conversationId) {
        const updated = await client.assistantConversations.update(
          conversationId,
          { webAccessMode: effective },
        );
        setDetail((current) =>
          current ? { ...current, conversation: updated } : current,
        );
        await loadConversations(conversationId);
      }
      if (next === "auto" && !allowed)
        setNotice("已保持关闭；这段灵感对话不会访问公开网络。");
    } catch (cause) {
      setNotice(message(cause));
    }
  };

  const loadOutcomes = async (id?: string) => {
    const [
      nextSettings,
      nextMemories,
      nextCards,
      nextJobs,
      nextCorpus,
      nextCollections,
      nextFingerprint,
      nextExperiments,
    ] = await Promise.all([
      client.inspiration.getMemorySettings(),
      client.inspiration.listMemories(),
      id ? client.inspiration.listCards(id) : Promise.resolve([]),
      id ? client.inspiration.listMemoryJobs(id) : Promise.resolve([]),
      client.creativeCorpus.list({ query: corpusSearch, limit: 50 }),
      client.creativeCorpus.listCollections(),
      client.creativeFingerprint.get(),
      client.creativeExperiments.list(),
    ]);
    setSettings(nextSettings);
    setMemories(nextMemories);
    setCards(nextCards);
    setMemoryJobs(nextJobs);
    setCorpusItems(nextCorpus);
    setCollections(nextCollections);
    setFingerprint(nextFingerprint);
    setExperiments(nextExperiments);
  };

  useEffect(() => {
    void loadConversations().catch((cause) => setNotice(message(cause)));
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setDetail(undefined);
      setCards([]);
      setMemoryJobs([]);
      void loadOutcomes().catch(() => undefined);
      return;
    }
    window.localStorage.setItem(
      "dramaip-inspiration-conversation",
      conversationId,
    );
    void Promise.all([
      loadDetail(conversationId),
      loadOutcomes(conversationId),
    ]).catch((cause) => setNotice(message(cause)));
  }, [conversationId]);

  useEffect(() => {
    if (!run || !conversationId) return;
    const timer = window.setInterval(() => {
      void loadDetail(conversationId).catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [conversationId, run?.id]);

  useEffect(() => {
    if (!settings || settings.consentedAt || loadedConsent.current) return;
    loadedConsent.current = true;
    void confirmDialog(
      "是否允许灵感空间自动学习你的创作偏好？只会提取主题、风格、禁区和长期目标；可随时在右侧记忆中心暂停或清空。",
    ).then(async (enabled) => {
      const next = await client.inspiration.updateMemorySettings({ enabled });
      setSettings(next);
    });
  }, [settings]);

  useEffect(() => {
    const unsubscribe = client.events.subscribe((event) => {
      if (
        !conversationId ||
        !event.payload ||
        typeof event.payload !== "object"
      )
        return;
      const payload = event.payload as Record<string, unknown>;
      if (
        payload.sessionId === conversationId ||
        payload.conversationId === conversationId
      )
        void loadDetail(conversationId).catch(() => undefined);
      if (event.type === "agents.inspiration-memory-completed.v1")
        void loadOutcomes(conversationId).catch(() => undefined);
    });
    return unsubscribe;
  }, [client, conversationId]);

  const newConversation = () => {
    setConversationId(undefined);
    setDetail(undefined);
    setCards([]);
    setMode("free");
    setWebAccessMode("auto");
    setDraft("");
    setNotice(undefined);
    window.localStorage.removeItem("dramaip-inspiration-conversation");
  };

  const ensureConversation = async (
    requestedWebAccess = webAccessMode,
  ): Promise<AgentSession> => {
    if (detail?.conversation && detail.conversation.creativeMode === mode) {
      if (detail.conversation.webAccessMode !== requestedWebAccess) {
        const updated = await client.assistantConversations.update(
          detail.conversation.id,
          { webAccessMode: requestedWebAccess },
        );
        setDetail({ ...detail, conversation: updated });
        return updated;
      }
      return detail.conversation;
    }
    if (detail?.conversation) {
      const updated = await client.assistantConversations.update(
        detail.conversation.id,
        { creativeMode: mode },
      );
      setDetail({ ...detail, conversation: updated });
      return updated;
    }
    if (!selectedEngine)
      throw new Error("没有可用的 AI 引擎，请先在设置中完成配置。");
    const created = await client.assistantConversations.create({
      surface: "inspiration",
      creativeMode: mode,
      engineKind: selectedEngine.kind as AgentEngineKind,
      webAccessMode: requestedWebAccess,
    });
    setConversationId(created.id);
    setDetail({
      conversation: created,
      turns: [],
      runs: [],
      items: [],
      changePreviews: [],
      providerActionPreviews: [],
    });
    await loadConversations(created.id);
    return created;
  };

  const send = async (starter?: string) => {
    const content = (starter ?? draft).trim();
    if (!content || busy || run) return;
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
      await client.assistantConversations.sendMessage(conversation.id, {
        message: content,
      });
      setDraft("");
      await Promise.all([
        loadDetail(conversation.id),
        loadConversations(conversation.id),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!conversationId || !detail) return;
    const title = window
      .prompt("新的灵感对话名称", detail.conversation.title ?? "未命名对话")
      ?.trim();
    if (!title) return;
    await client.assistantConversations.update(conversationId, { title });
    await Promise.all([
      loadDetail(conversationId),
      loadConversations(conversationId),
    ]);
  };

  const fork = async () => {
    if (!conversationId) return;
    const created = await client.agentSessions.fork(conversationId);
    await loadConversations(created.id);
    setConversationId(created.id);
    setNotice("已从当前状态创建独立分支，原对话保持不变。");
  };

  const archiveConversation = async () => {
    if (!conversationId) return;
    await client.assistantConversations.update(conversationId, {
      archived: true,
    });
    newConversation();
    await loadConversations();
  };

  const removeConversation = async () => {
    if (
      !conversationId ||
      !(await confirmDialog("永久删除这段对话、摘要、卡片和仅由它产生的记忆？"))
    )
      return;
    await client.assistantConversations.remove(conversationId);
    newConversation();
    await Promise.all([loadConversations(), loadOutcomes()]);
  };

  const createCard = async () => {
    if (!conversationId) return;
    const content = window.prompt("记录下这条灵感")?.trim();
    if (!content) return;
    const kind = (window.prompt(
      `类型：${CARD_KINDS.map(([id, label]) => `${id}=${label}`).join("、")}`,
      "premise",
    ) ?? "premise") as InspirationCardKind;
    if (!CARD_KINDS.some(([id]) => id === kind)) return;
    const card = await client.inspiration.createCard({
      conversationId,
      kind,
      title: content.slice(0, 32),
      content,
    });
    setCards((current) => [card, ...current]);
  };

  const createPrivateCorpusItem = async () => {
    const title = window.prompt("这条有趣语料的名称")?.trim();
    if (!title) return;
    const mechanism = window
      .prompt("它为什么有趣？请记录可复用机制，不要粘贴大段原文。")
      ?.trim();
    if (!mechanism) return;
    const created = await client.creativeCorpus.create({
      visibility: "private",
      kind: "comic_device",
      title,
      mechanism,
      locale: "zh-CN",
      freshness: "stable",
      rightsStatus: "unknown",
    });
    setCorpusItems((items) => [created, ...items]);
  };

  const collectCorpusItem = async (item: CorpusItem) => {
    const created = await client.creativeCorpus.collect({
      corpusItemId: item.id,
      title: item.title,
      mechanism: item.mechanism,
      tags: item.tags,
    });
    setCollections((items) => [created, ...items]);
    setNotice("已加入私人灵感库；公共条目变化不会覆盖你的备注。");
  };

  const createExperiment = async (source?: CorpusItem) => {
    const prompt = window
      .prompt(
        "输入要探索的创意原点",
        source?.mechanism ??
          cards.find((card) => card.adopted)?.content ??
          draft,
      )
      ?.trim();
    if (!prompt) return;
    const created = await client.creativeExperiments.create({
      originType: source ? "corpus" : "inspiration",
      ...(source ? { originId: source.id } : {}),
      prompt,
    });
    setExperiments((items) => [created, ...items]);
  };

  const conversionBrief = () => {
    if (!conversionMode) return undefined;
    const adoptedIdea = cards
      .filter((card) => card.adopted)
      .map((card) => card.content.trim())
      .filter(Boolean)
      .join("\n");
    const current = session.creationDraft?.brief;
    const brief = projectModeBrief(conversionMode, "inspiration", current);
    brief.title = conversionTitle.trim();
    if (!brief.idea.trim()) brief.idea = adoptedIdea;
    return brief;
  };

  const persistConversion = (
    mode: ProjectMode,
    title = conversionTitle,
    presetId = conversionPresetId,
  ) => {
    const current =
      session.creationDraft ??
      createCreationDraft("inspiration", mode, "inspiration");
    const brief = projectModeBrief(mode, "inspiration", current.brief);
    brief.title = title;
    session.saveCreationDraft({
      ...current,
      projectMode: mode,
      creationSource: "inspiration",
      brief,
      storyPresetId: presetId,
      origin: "inspiration",
      updatedAt: new Date().toISOString(),
    });
  };

  const createConversionPreview = async () => {
    if (!conversationId || !conversionMode || !conversionTitle.trim()) return;
    const brief = conversionBrief();
    if (!brief) return;
    const modeConfig = projectModeConfigFromDraft(
      conversionMode,
      "inspiration",
      brief,
      brief.idea || brief.title,
    );
    if (!modeConfig) {
      setNotice("请补充当前模式所需的主题或规模设置。");
      return;
    }
    const preset =
      conversionMode === "series_longform" || conversionMode === "single_season"
        ? novelStoryPreset(conversionPresetId)
        : undefined;
    const selectedCards = cards
      .filter((card) => card.adopted)
      .map((card) => card.id);
    setConverting(true);
    setNotice(undefined);
    try {
      const preview = await client.inspiration.createProjectPreview({
        conversationId,
        project: preset
          ? projectInputFromStoryPreset(brief, preset, modeConfig)
          : projectInputFromBrief(brief, modeConfig),
        cardIds: selectedCards,
      });
      setConversionPreview(preview);
      persistConversion(conversionMode, conversionTitle, conversionPresetId);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setConverting(false);
    }
  };

  const commitConversion = async () => {
    if (!conversionPreview || !conversionMode) return;
    setConverting(true);
    setNotice(undefined);
    let committedProjectId: string | undefined;
    let committedDraft = session.creationDraft;
    let failedInitializationSteps = committedDraft?.initializationSteps ?? [];
    try {
      const result = await client.inspiration.commitProjectPreview(
        conversionPreview.id,
      );
      committedProjectId = result.project.id;
      committedDraft =
        committedDraft ??
        createCreationDraft("inspiration", conversionMode, "inspiration");
      session.saveCreationDraft(
        {
          ...committedDraft,
          projectMode: conversionMode,
          createdProjectId: committedProjectId,
          initializationSteps: [
            {
              key: "project",
              status: "completed",
              message: "项目记录与已采用卡片已创建",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        true,
      );
      const brief = conversionBrief();
      const preset =
        conversionMode === "series_longform" ||
        conversionMode === "single_season"
          ? novelStoryPreset(conversionPresetId)
          : undefined;
      if (!brief) throw new Error("创作草稿缺少模式初始化资料");
      const initialized = await initializeProjectMaterials(client, {
        project: result.project,
        brief,
        preset,
      }).catch((cause: unknown) => {
        if (cause instanceof ProjectInitializationError)
          failedInitializationSteps = cause.steps;
        throw cause;
      });
      if (initialized.chapterId)
        window.localStorage.setItem(
          `dramaip-novel-last-chapter:${result.project.id}`,
          initialized.chapterId,
        );
      session.clearCreationDraft();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNotice(
        `项目已创建，复制 ${result.cardsCopied} 张已采用卡片；原灵感对话仍保留。`,
      );
      navigate(`/projects/${result.project.id}`);
    } catch (cause) {
      if (committedProjectId && committedDraft) {
        session.saveCreationDraft(
          {
            ...committedDraft,
            createdProjectId: committedProjectId,
            initializationSteps: [
              {
                key: "project",
                status: "completed",
                message: "项目记录与已采用卡片已创建",
              },
              ...failedInitializationSteps,
            ],
            updatedAt: new Date().toISOString(),
          },
          true,
        );
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        setNotice(
          `${message(cause)} 项目与已采用卡片均已安全保留，可在项目首页继续补齐初始化材料。`,
        );
        navigate("/");
      } else {
        setConversionPreview(undefined);
        setNotice(
          `${message(cause)} 项目转换预览可能已过期；创作草稿和已采用卡片均已保留，请重新预览。`,
        );
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="grid h-[calc(100dvh-7rem)] min-h-0 grid-cols-[240px_minmax(0,1fr)_320px] gap-3 overflow-hidden p-4 lg:h-[calc(100dvh-7.5rem)]">
      <aside className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface-raised p-3">
        <div className="mb-3">
          <h1 className="text-xl font-semibold">灵感空间</h1>
          <p className="mt-1 text-xs leading-5 text-muted">
            不必创建项目，先让想象力走得更远。
          </p>
        </div>
        <Button onClick={newConversation}>新建对话</Button>
        <Input
          className="mt-3"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索对话"
        />
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visibleConversations.map((item) => (
            <BareButton
              key={item.id}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm ${conversationId === item.id ? "bg-brand/10 text-brand" : "hover:bg-surface-muted"}`}
              onClick={() => setConversationId(item.id)}
            >
              <span className="block truncate">
                {item.title ?? "未命名灵感"}
              </span>
              <span className="block text-[11px] text-muted">
                {MODES.find((entry) => entry.id === item.creativeMode)?.name ??
                  "自由漫游"}
              </span>
            </BareButton>
          ))}
          {archived.length > 0 && (
            <p className="pt-3 text-xs text-muted">
              已归档 {archived.length} 个对话
            </p>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <div>
            <p className="font-semibold">
              {detail?.conversation.title ?? "新的灵感对话"}
            </p>
            <p className="text-xs text-muted">
              只进行创意对话，不读取项目、文件或 Provider 写能力
            </p>
          </div>
          <div className="flex gap-1 text-xs">
            <BareButton
              className="rounded border border-line px-2 py-1"
              onClick={rename}
              disabled={!conversationId}
            >
              重命名
            </BareButton>
            <BareButton
              className="rounded border border-line px-2 py-1"
              onClick={fork}
              disabled={!conversationId}
            >
              分支
            </BareButton>
            <BareButton
              className="rounded border border-line px-2 py-1"
              onClick={archiveConversation}
              disabled={!conversationId}
            >
              归档
            </BareButton>
            <BareButton
              className="rounded border border-line px-2 py-1 text-danger"
              onClick={removeConversation}
              disabled={!conversationId}
            >
              删除
            </BareButton>
          </div>
        </header>
        <div className="shrink-0 border-b border-line px-3 py-2.5">
          <div
            role="tablist"
            aria-label="灵感模式"
            className="grid grid-cols-5 gap-1 rounded-xl border border-brand/15 bg-brand-soft/70 p-1"
          >
            {MODES.map((entry) => (
              <BareButton
                key={entry.id}
                role="tab"
                aria-selected={mode === entry.id}
                className={`min-w-0 truncate rounded-lg px-1.5 py-2 text-center text-xs font-medium xl:text-sm ${mode === entry.id ? "bg-surface-raised text-brand-strong shadow-control ring-1 ring-brand/15" : "text-muted hover:bg-surface-raised/65 hover:text-brand-strong"}`}
                onClick={() => setMode(entry.id)}
                title={`${entry.name}：${entry.description}`}
              >
                {entry.name}
              </BareButton>
            ))}
          </div>
          <p className="mt-2 truncate px-1 text-xs text-muted">
            {MODES.find((entry) => entry.id === mode)?.description}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!detail?.turns.length && (
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              {MODES.filter((entry) => entry.id === mode).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="rounded-xl border border-dashed border-line p-4 text-left text-sm leading-6 hover:border-brand"
                  onClick={() => void send(entry.starter)}
                >
                  {entry.starter}
                </button>
              ))}
            </div>
          )}
          <GlobalAssistantTimeline detail={detail} surface="inspiration" />
        </div>
        <footer className="shrink-0 border-t border-line p-3">
          {notice && (
            <p className="mb-2 rounded-lg bg-surface-muted px-3 py-2 text-xs">
              {notice}
            </p>
          )}
          <textarea
            className="min-h-24 w-full resize-none rounded-xl border border-line bg-canvas p-3 text-sm outline-none focus:border-brand"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                void send();
            }}
            placeholder="说出一个画面、人物、疑问，或任何还没成形的念头…"
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
            <div className="flex min-w-0 items-center gap-2">
              <AssistantWebAccessControl
                mode={webAccessMode}
                disabled={Boolean(run)}
                onChange={(next) => void changeWebAccessMode(next)}
              />
              <span className="truncate">⌘/Ctrl + Enter 发送</span>
            </div>
            <div className="flex gap-2">
              {run && (
                <Button
                  variant="secondary"
                  onClick={() => void client.agentSessions.interrupt(run.id)}
                >
                  停止
                </Button>
              )}
              <Button
                disabled={busy || Boolean(run) || !draft.trim()}
                onClick={() => void send()}
              >
                {busy ? "发送中…" : "发送"}
              </Button>
            </div>
          </div>
        </footer>
      </section>

      <aside className="studio-scrollbar min-h-0 space-y-3 overflow-y-auto pr-1">
        <section className="rounded-2xl border border-line bg-surface-raised p-4 shadow-control">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">趣味语料库</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                保存机制和用法，不囤积网页原文
              </p>
            </div>
            <Button
              className="shrink-0"
              size="sm"
              variant="secondary"
              onClick={createPrivateCorpusItem}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              私人添加
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              value={corpusSearch}
              onChange={(event) => setCorpusSearch(event.target.value)}
              placeholder="搜索梗、机制、风格"
            />
            <Button
              variant="secondary"
              onClick={() =>
                void client.creativeCorpus
                  .list({ query: corpusSearch, limit: 50 })
                  .then(setCorpusItems)
              }
            >
              <Search aria-hidden="true" className="size-4" />
              搜索
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {corpusItems.slice(0, 8).map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-line p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <strong>{item.title}</strong>
                  <span className="text-[10px] text-muted">
                    {item.visibility === "public" ? "公共" : "私人"} ·{" "}
                    {item.freshness}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted">
                  {item.mechanism}
                </p>
                <div className="mt-2 flex gap-3">
                  <BareButton
                    className="text-xs font-medium text-brand hover:text-brand-strong"
                    onClick={() => void collectCorpusItem(item)}
                  >
                    收藏
                  </BareButton>
                  <BareButton
                    className="text-xs font-medium text-brand hover:text-brand-strong"
                    onClick={() => void createExperiment(item)}
                  >
                    做实验
                  </BareButton>
                </div>
              </article>
            ))}
            {!corpusItems.length && (
              <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-muted">
                公共快照尚未导入时仍可建立完全本地的私人语料。
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[11px] text-muted">
            <span>本地私人收藏</span>
            <strong className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-ink">
              {collections.length} 条
            </strong>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface-raised p-4 shadow-control">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">创意实验室</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                稳健、平衡、大胆三条路线，先比较后采用
              </p>
            </div>
            <Button
              className="shrink-0"
              size="sm"
              variant="secondary"
              onClick={() => void createExperiment()}
            >
              <FlaskConical aria-hidden="true" className="size-3.5" />
              新实验
            </Button>
          </div>
          {experiments.slice(0, 3).map((experiment) => (
            <article
              key={experiment.id}
              className="mt-3 rounded-xl border border-line p-3 text-xs"
            >
              <p className="line-clamp-2 font-medium">{experiment.prompt}</p>
              <div className="mt-2 space-y-2">
                {experiment.variants.map((variant) => (
                  <label
                    key={variant.id}
                    className="block rounded-lg bg-subtle p-2"
                  >
                    <span className="font-medium">{variant.title}</span>
                    <span className="mt-1 block text-muted">
                      {variant.content}
                    </span>
                    {experiment.status === "ready" && (
                      <BareButton
                        className="mt-1 font-medium text-brand hover:text-brand-strong"
                        onClick={async () => {
                          const next = await client.creativeExperiments.review(
                            experiment.id,
                            {
                              version: experiment.version,
                              selectedVariantId: variant.id,
                            },
                          );
                          setExperiments((items) =>
                            items.map((item) =>
                              item.id === next.id ? next : item,
                            ),
                          );
                          setFingerprint(
                            await client.creativeFingerprint.get(),
                          );
                        }}
                      >
                        采用这条路线
                      </BareButton>
                    )}
                  </label>
                ))}
              </div>
              {experiment.status === "ready" && (
                <BareButton
                  className="mt-2 font-medium text-danger"
                  onClick={async () => {
                    const next = await client.creativeExperiments.review(
                      experiment.id,
                      { version: experiment.version, rejected: true },
                    );
                    setExperiments((items) =>
                      items.map((item) => (item.id === next.id ? next : item)),
                    );
                  }}
                >
                  全部拒绝
                </BareButton>
              )}
            </article>
          ))}
          {!experiments.length && (
            <p className="mt-3 rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-muted">
              选择一个灵感或输入实验命题，比较三条不同强度的创作路线。
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface-raised p-4 shadow-control">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">我的创意指纹</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                与长期记忆分开授权
              </p>
            </div>
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-muted shadow-control">
              <input
                className="size-3.5 accent-brand"
                type="checkbox"
                checked={fingerprint?.enabled ?? false}
                onChange={async (event) => {
                  if (
                    event.target.checked &&
                    !(await confirmDialog(
                      "允许根据你明确采用、拒绝和评分的结果生成创意指纹？不会读取未采用的完整对话，也不会用于训练。",
                    ))
                  )
                    return;
                  setFingerprint(
                    await client.creativeFingerprint.setEnabled(
                      event.target.checked,
                    ),
                  );
                }}
              />
              个性化
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {fingerprint?.dimensions.map((dimension) => (
              <div
                key={dimension.key}
                className="rounded-xl border border-line/80 bg-surface-muted/60 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted">
                    {FINGERPRINT_DIMENSION_LABELS[dimension.key]}
                  </span>
                  <strong className="text-sm tabular-nums">
                    {Math.round(dimension.score * 100)}
                  </strong>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${Math.round(dimension.score * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  可信度 {Math.round(dimension.confidence * 100)}%
                </p>
              </div>
            ))}
          </div>
          {fingerprint?.consentedAt && (
            <Button
              className="mt-3 text-danger"
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await confirmDialog("清空创意指纹和全部证据关联？")) {
                  await client.creativeFingerprint.clear();
                  setFingerprint(await client.creativeFingerprint.get());
                }
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              清空指纹
            </Button>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface-raised p-4 shadow-control">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">灵感卡片</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                只复制你采用的卡片
              </p>
            </div>
            <Button
              className="shrink-0"
              size="sm"
              variant="secondary"
              onClick={createCard}
              disabled={!conversationId}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              添加
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {cards.map((card) => (
              <article
                key={card.id}
                className="rounded-xl border border-line p-3 text-sm"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={card.adopted}
                    onChange={async (event) => {
                      const next = await client.inspiration.updateCard(
                        card.id,
                        {
                          adopted: event.target.checked,
                          version: card.version,
                        },
                      );
                      setCards((items) =>
                        items.map((item) =>
                          item.id === next.id ? next : item,
                        ),
                      );
                    }}
                  />
                  <span>
                    <strong>{card.title}</strong>
                    <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">
                      {card.content}
                    </span>
                  </span>
                </label>
              </article>
            ))}
            {!cards.length && (
              <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-muted">
                把值得保留的前提、角色、场景或问题放在这里。
              </p>
            )}
          </div>
          {conversionOpen && (
            <section
              aria-label="灵感转项目预览"
              className="mt-3 space-y-3 rounded-xl border border-brand/25 bg-brand-soft/45 p-3"
            >
              <div>
                <p className="text-sm font-semibold">确认创作模式</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  原对话不会移动；只复制已经采用的卡片。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PROJECT_MODES.map((entry) => (
                  <BareButton
                    key={entry.id}
                    type="button"
                    aria-pressed={conversionMode === entry.id}
                    className={`rounded-lg border p-2 text-left text-xs ${conversionMode === entry.id ? "border-brand bg-surface-raised text-brand" : "border-line bg-surface text-muted"}`}
                    onClick={() => {
                      setConversionMode(entry.id);
                      setConversionPreview(undefined);
                      if (
                        entry.id !== "series_longform" &&
                        entry.id !== "single_season"
                      )
                        setConversionPresetId(undefined);
                      persistConversion(
                        entry.id,
                        conversionTitle,
                        entry.id === "series_longform" ||
                          entry.id === "single_season"
                          ? conversionPresetId
                          : undefined,
                      );
                    }}
                  >
                    <span className="block font-medium text-ink">
                      {entry.label}
                    </span>
                    <span className="mt-1 block leading-4">
                      {entry.outcome}
                    </span>
                  </BareButton>
                ))}
              </div>
              <label className="grid gap-1 text-xs font-medium">
                项目名称
                <Input
                  value={conversionTitle}
                  placeholder={detail?.conversation.title ?? "新创作项目"}
                  onChange={(event) => {
                    setConversionTitle(event.target.value);
                    setConversionPreview(undefined);
                    if (conversionMode)
                      persistConversion(
                        conversionMode,
                        event.target.value,
                        conversionPresetId,
                      );
                  }}
                />
              </label>
              {conversionMode &&
                (conversionMode === "series_longform" ||
                  conversionMode === "single_season") && (
                  <NovelStoryPresetPicker
                    selectedId={conversionPresetId}
                    mode={conversionMode}
                    compact
                    onSelect={(id) => {
                      setConversionPresetId(id);
                      setConversionPreview(undefined);
                      persistConversion(conversionMode, conversionTitle, id);
                    }}
                    onClear={() => {
                      setConversionPresetId(undefined);
                      setConversionPreview(undefined);
                      persistConversion(
                        conversionMode,
                        conversionTitle,
                        undefined,
                      );
                    }}
                  />
                )}
              {conversionPreview ? (
                <div className="rounded-lg border border-brand/25 bg-surface-raised p-3 text-xs leading-5">
                  <p className="font-medium text-ink">最终写入预览</p>
                  <p className="mt-1 text-muted">
                    创建“{conversionPreview.project.title}” ·
                    {PROJECT_MODES.find(
                      (entry) => entry.id === conversionPreview.project.mode,
                    )?.label ?? "创作项目"}
                    · 复制 {conversionPreview.cards.length} 张卡片
                    {conversionPresetId
                      ? ` · 使用${novelStoryPreset(conversionPresetId)?.label ?? "所选"}预设`
                      : ""}
                  </p>
                  <p className="mt-1 text-emerald-800">
                    确认前不会创建项目或修改正式资料。
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={converting}
                      onClick={() => void commitConversion()}
                    >
                      {converting ? "正在创建…" : "确认创建项目"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={converting}
                      onClick={() => setConversionPreview(undefined)}
                    >
                      修改
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="w-full"
                  size="sm"
                  disabled={
                    converting || !conversionMode || !conversionTitle.trim()
                  }
                  onClick={() => void createConversionPreview()}
                >
                  {converting ? "正在生成预览…" : "生成最终预览"}
                </Button>
              )}
            </section>
          )}
          <Button
            className="mt-3 w-full"
            variant="secondary"
            disabled={!conversationId}
            onClick={() => {
              const opening = !conversionOpen;
              setConversionOpen(opening);
              setConversionPreview(undefined);
              if (opening && !conversionTitle.trim())
                setConversionTitle(
                  session.creationDraft?.brief.title ||
                    detail?.conversation.title ||
                    "",
                );
            }}
          >
            <ArrowRight aria-hidden="true" className="size-4" />
            {conversionOpen ? "收起项目预览" : "预览并转为项目"}
          </Button>
        </section>

        <section className="rounded-2xl border border-line bg-surface-raised p-4 shadow-control">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">记忆中心</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                跨会话学习由你控制
              </p>
            </div>
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-muted shadow-control">
              <input
                className="size-3.5 accent-brand"
                type="checkbox"
                checked={settings?.enabled ?? false}
                onChange={async (event) =>
                  setSettings(
                    await client.inspiration.updateMemorySettings({
                      enabled: event.target.checked,
                    }),
                  )
                }
              />
              自动学习
            </label>
          </div>
          <div className="mt-3 space-y-2">
            {memories.map((memory) => (
              <article
                key={memory.id}
                className={`rounded-xl border border-line p-3 text-xs ${memory.status === "disabled" ? "opacity-50" : ""}`}
              >
                <p className="whitespace-pre-wrap">{memory.content}</p>
                <div className="mt-2 flex justify-between text-[11px] text-muted">
                  <span>
                    {memory.kind} · 可信度 {Math.round(memory.confidence * 100)}
                    %
                  </span>
                  <BareButton
                    className="font-medium text-brand hover:text-brand-strong"
                    onClick={async () => {
                      const next = await client.inspiration.updateMemory(
                        memory.id,
                        {
                          status:
                            memory.status === "active" ? "disabled" : "active",
                          version: memory.version,
                        },
                      );
                      setMemories((items) =>
                        items.map((item) =>
                          item.id === next.id ? next : item,
                        ),
                      );
                    }}
                  >
                    {memory.status === "active" ? "停用" : "启用"}
                  </BareButton>
                </div>
              </article>
            ))}
            {!memories.length && (
              <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-muted">
                每累计 6
                轮完整问答、上下文压缩或归档时批量整理；失败不会阻塞聊天。
              </p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!conversationId}
              onClick={() =>
                conversationId &&
                void client.inspiration
                  .rebuildMemories(conversationId)
                  .then(() => setNotice("已加入重新整理队列。"))
              }
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              重新整理
            </Button>
            <Button
              className="text-danger"
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (
                  await confirmDialog(
                    "清空全部长期创意记忆？当前会话和摘要不会删除。",
                  )
                ) {
                  await client.inspiration.clearMemories();
                  setMemories([]);
                }
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              清空
            </Button>
          </div>
          {memoryJobs[0] ? (
            <div className="mt-3 rounded-xl bg-subtle px-3 py-2 text-[11px] leading-5 text-muted">
              <p>
                最近整理：
                {inspirationMemoryStatus(memoryJobs[0])}
              </p>
              <p>上下文预算与字符估算不是实际 token；历史缺报告不补零。</p>
              {memoryJobs[0].usageRuns?.map((run) => (
                <AgentUsagePanel
                  key={run.runId}
                  runId={run.runId}
                  projectId={run.projectId}
                />
              ))}
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
