import type {
  AgentEngineDescriptor,
  AgentTaskDescriptor,
  AgentTaskType,
} from "@dramaip/contracts/product";
import {
  CONTEXT_ACTIONS,
  contextPage,
  type ContextPage,
} from "@dramaip/contracts/context-actions";

export type ContextAssistantMode = "simple" | "advanced";

export type ContextAssistantPage = ContextPage;

type ContextActionSpec = {
  readonly actionId: string;
  readonly taskType: AgentTaskType;
  readonly summary: string;
};

/** What each recommended action does, in a sentence, by action id. */
const ACTION_SUMMARIES: Readonly<Record<string, string>> = {
  "shape-project": "把当前简介整理成可审查的项目设定。",
  "find-hook": "检查题材钩子和同质化风险。",
  "diagnose-chapter": "检查当前章节的冲突、节奏和下一步。",
  "propose-bible": "把可确认的设定更新整理成草案。",
  "build-outline": "生成可采用的全书大纲建议。",
  "character-cards": "生成待确认的人物卡建议。",
  "chapter-outline": "补足下一章的大纲和冲突。",
  "quality-gate": "先获得可执行的质量检查结论。",
  "script-review": "审查剧本是否能进入下一制作阶段。",
  "first-episodes": "检查前十集的开场、钩子和留存风险。",
  "video-assets": "先生成媒体资产方案，不直接发起制作。",
  "image-plan": "生成需要人工确认的图片调用预览。",
  "video-plan": "生成需要人工确认的视频调用预览。",
  "review-quality": "整理当前项目的质量闸门结论。",
  "cost-risk": "识别交付前的成本与制作风险。",
  "audience-simulation": "在交付前模拟受众反馈。",
  "retry-diagnostic": "基于当前项目重新生成可审查的诊断。",
  "revision-plan": "把发现的问题整理成修订任务单。",
  "provider-check": "配置完成后检查媒体制作成本风险。",
};

/**
 * The shared routing layer over the authoritative server task catalog (see
 * `@dramaip/contracts/context-actions`), with each action's summary. Labels,
 * write policy and categories always come from `agentEngines.listTasks`.
 */
export const CONTEXT_ASSISTANT_REGISTRY: Readonly<
  Record<ContextAssistantPage, readonly ContextActionSpec[]>
> = Object.fromEntries(
  Object.entries(CONTEXT_ACTIONS).map(([page, actions]) => [
    page,
    actions.map((action) => ({
      actionId: action.actionId,
      taskType: action.taskType as AgentTaskType,
      summary: ACTION_SUMMARIES[action.actionId] ?? "",
    })),
  ]),
) as unknown as Record<ContextAssistantPage, readonly ContextActionSpec[]>;

export type ContextAssistantAction = ContextActionSpec & AgentTaskDescriptor;

export function contextAssistantPage(pathname: string): ContextAssistantPage {
  return contextPage(pathname);
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
    fixes.push("先设置 AI 模型");
  } else if (input.engine.status !== "available") {
    capability = "unavailable";
    fixes.push("检查 AI 模型设置");
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
