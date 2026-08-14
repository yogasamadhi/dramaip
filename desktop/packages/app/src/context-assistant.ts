import type {
  AgentEngineDescriptor,
  AgentTaskDescriptor,
  AgentTaskType,
} from "@sdns/schema";

export type ContextAssistantMode = "simple" | "advanced";

export type ContextAssistantPage =
  | "project"
  | "create"
  | "adapt"
  | "produce"
  | "review"
  | "tasks"
  | "settings"
  | "home";

type ContextActionSpec = {
  readonly actionId: string;
  readonly taskType: AgentTaskType;
  readonly summary: string;
};

/**
 * This is a routing layer over the authoritative server task catalog.  It only
 * keeps stable task ids; labels, write policy and categories always come from
 * `agentEngines.listTasks`, so a catalog edit cannot create a second UI-only
 * definition of a task.
 */
export const CONTEXT_ASSISTANT_REGISTRY: Readonly<
  Record<ContextAssistantPage, readonly ContextActionSpec[]>
> = {
  home: [
    {
      actionId: "shape-project",
      taskType: "generate_project",
      summary: "把当前简介整理成可审查的项目设定。",
    },
    {
      actionId: "find-hook",
      taskType: "analyze_trope_freshness",
      summary: "检查题材钩子和同质化风险。",
    },
  ],
  project: [
    {
      actionId: "diagnose-chapter",
      taskType: "chapter_diagnostic",
      summary: "检查当前章节的冲突、节奏和下一步。",
    },
    {
      actionId: "propose-bible",
      taskType: "propose_story_bible_changes",
      summary: "把可确认的设定变更整理为预览。",
    },
    {
      actionId: "build-outline",
      taskType: "generate_book_outline",
      summary: "生成可采用的全书大纲建议。",
    },
  ],
  create: [
    {
      actionId: "character-cards",
      taskType: "generate_characters",
      summary: "生成待确认的人物卡建议。",
    },
    {
      actionId: "chapter-outline",
      taskType: "generate_chapter_outline",
      summary: "补足下一章的大纲和冲突。",
    },
    {
      actionId: "quality-gate",
      taskType: "run_quality_gate",
      summary: "先获得可执行的质量检查结论。",
    },
  ],
  adapt: [
    {
      actionId: "adaptation-strategy",
      taskType: "create_adaptation_strategy",
      summary: "生成可审查的改编策略。",
    },
    {
      actionId: "episode-plan",
      taskType: "convert_novel_to_episodes",
      summary: "把已确认内容拆为分集建议。",
    },
    {
      actionId: "script-review",
      taskType: "review_ai_drama_script",
      summary: "审查剧本是否能进入下一制作阶段。",
    },
  ],
  produce: [
    {
      actionId: "video-assets",
      taskType: "generate_video_asset_drafts",
      summary: "先生成媒体资产方案，不直接发起制作。",
    },
    {
      actionId: "image-plan",
      taskType: "plan_image_generation",
      summary: "生成需要人工确认的图片调用预览。",
    },
    {
      actionId: "video-plan",
      taskType: "plan_video_generation",
      summary: "生成需要人工确认的视频调用预览。",
    },
  ],
  review: [
    {
      actionId: "review-quality",
      taskType: "run_quality_gate",
      summary: "整理当前项目的质量闸门结论。",
    },
    {
      actionId: "cost-risk",
      taskType: "analyze_video_cost_risk",
      summary: "识别交付前的成本与制作风险。",
    },
    {
      actionId: "audience-simulation",
      taskType: "simulate_audience_reaction",
      summary: "在交付前模拟受众反馈。",
    },
  ],
  tasks: [
    {
      actionId: "retry-diagnostic",
      taskType: "chapter_diagnostic",
      summary: "基于当前项目重新生成可审查的诊断。",
    },
    {
      actionId: "revision-plan",
      taskType: "generate_revision_tasks",
      summary: "把发现的问题整理成修订任务单。",
    },
  ],
  settings: [
    {
      actionId: "provider-check",
      taskType: "analyze_video_cost_risk",
      summary: "配置完成后检查媒体制作成本风险。",
    },
  ],
};

export type ContextAssistantAction = ContextActionSpec & AgentTaskDescriptor;

export function contextAssistantPage(pathname: string): ContextAssistantPage {
  if (pathname.startsWith("/projects/")) return "project";
  if (pathname.startsWith("/write")) return "create";
  if (pathname.startsWith("/create")) return "create";
  if (pathname.startsWith("/adapt")) return "adapt";
  if (pathname.startsWith("/produce")) return "produce";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}

export function contextAssistantProjectId(input: {
  pathname: string;
  search: string;
}): string | undefined {
  const fromQuery = new URLSearchParams(input.search).get("projectId");
  if (fromQuery) return fromQuery;
  const match = /^\/projects\/([^/?]+)/.exec(input.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function resolveContextAssistantActions(input: {
  page: ContextAssistantPage;
  catalog: readonly AgentTaskDescriptor[];
}): {
  actions: ContextAssistantAction[];
  missingTaskTypes: AgentTaskType[];
} {
  const byId = new Map(input.catalog.map((task) => [task.id, task]));
  const actions: ContextAssistantAction[] = [];
  const missingTaskTypes: AgentTaskType[] = [];
  for (const action of CONTEXT_ASSISTANT_REGISTRY[input.page]) {
    const definition = byId.get(action.taskType);
    if (!definition) {
      missingTaskTypes.push(action.taskType);
      continue;
    }
    actions.push({ ...action, ...definition });
  }
  return { actions, missingTaskTypes };
}

export function actionRequiresChapter(action: ContextAssistantAction): boolean {
  return action.category === "章节写作" || action.category === "记忆与连续性";
}

export type AssistantPreflight = {
  ready: boolean;
  capability: "ready" | "missing" | "unavailable";
  input: "ready" | "project-required" | "chapter-required";
  cost: "not-applicable" | "known-after-preview" | "unknown";
  fixes: string[];
};

/**
 * Planning a provider action remains free of a provider-side media call, but
 * the later execution must have a quote.  A missing quote therefore blocks
 * only that explicit paid step; ordinary diagnostic/change-preview tasks keep
 * their existing controlled-run semantics.
 */
export function contextAssistantPreflight(input: {
  action: ContextAssistantAction;
  projectId?: string;
  chapterId?: string;
  engine?: AgentEngineDescriptor;
  modelId?: string;
  hasKnownProviderCost?: boolean;
}): AssistantPreflight {
  const fixes: string[] = [];
  let capability: AssistantPreflight["capability"] = "ready";
  let requirements: AssistantPreflight["input"] = "ready";
  if (!input.projectId) {
    requirements = "project-required";
    fixes.push("选择项目后再运行此动作");
  } else if (actionRequiresChapter(input.action) && !input.chapterId) {
    requirements = "chapter-required";
    fixes.push("为此动作选择一个章节");
  }
  if (!input.engine) {
    capability = "missing";
    fixes.push("在设置中选择并配置智能引擎");
  } else if (input.engine.status !== "available") {
    capability = "unavailable";
    fixes.push(`启动或配置 ${input.engine.name} 引擎`);
  } else if (!input.modelId?.trim()) {
    capability = "missing";
    fixes.push("在项目设置中保存默认模型");
  }
  const cost =
    input.action.writePolicy !== "provider-action-preview"
      ? "not-applicable"
      : input.hasKnownProviderCost
        ? "known-after-preview"
        : "unknown";
  if (cost === "unknown")
    fixes.push("先生成并核对厂商调用预览中的费用，再确认创建远程任务");
  return {
    ready: capability === "ready" && requirements === "ready",
    capability,
    input: requirements,
    cost,
    fixes,
  };
}

export function assertContextAssistantRegistry(
  catalog: readonly AgentTaskDescriptor[],
): void {
  const catalogIds = new Set(catalog.map((task) => task.id));
  for (const [page, actions] of Object.entries(CONTEXT_ASSISTANT_REGISTRY)) {
    if (actions.length < 1 || actions.length > 3)
      throw new Error(`${page} 必须提供 1–3 个上下文动作`);
    const ids = new Set<string>();
    for (const action of actions) {
      if (ids.has(action.actionId))
        throw new Error(`${page} 存在重复上下文动作`);
      ids.add(action.actionId);
      if (!catalogIds.has(action.taskType))
        throw new Error(`${page} 引用了目录外任务：${action.taskType}`);
    }
  }
}
