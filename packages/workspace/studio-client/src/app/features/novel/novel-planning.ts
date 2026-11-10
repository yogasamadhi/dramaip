import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { DomainEntity, Project } from "@dramaip/contracts/product";

/** The three things a novel needs before its first chapter, in order. */
export const PLANNING_STEPS = [
  {
    key: "setup",
    operation: "story-setup",
    label: "故事设定",
    section: "settings",
    ask: "先说说你想写一个什么样的故事，一句话也行：题材、主角是谁、想要什么样的冲突。我会整理成故事设定，你确认后再一起做人物和大纲。",
    action: "整理故事设定",
    base: "把作者的想法整理成小说的故事设定。",
  },
  {
    key: "characters",
    operation: "characters",
    label: "主要人物",
    section: "characters",
    ask: "设定已保存。接下来做主要人物：可以直接生成，也可以先说说你对主角、对手或配角的想法。",
    action: "生成主要人物",
    base: "根据已采用的故事设定，生成这部小说的主要人物：主角、对手和关键配角。",
  },
  {
    key: "outline",
    operation: "book-outline",
    label: "全书大纲",
    section: "outlines",
    ask: "人物已保存。最后是全书大纲：可以直接生成，也可以先说说你想要的结局、节奏或篇幅。",
    action: "生成全书大纲",
    base: "根据已采用的故事设定和主要人物，生成全书大纲，写清开端、发展、高潮和结局。",
  },
] as const;

export type PlanningStep = (typeof PLANNING_STEPS)[number];
export type PlanningStepKey = PlanningStep["key"];

/** Creation stages in which a draft is still being written. */
export const ACTIVE_CREATION_STAGES: ReadonlySet<string> = new Set([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
]);

/** Labels for the fields of a story setup draft, in reading order. */
export const SETUP_ORDER = [
  "题材类型",
  "故事梗概",
  "世界观与规则",
  "核心钩子",
  "情感内核",
  "核心卖点",
  "目标读者",
  "文风指南",
];

/** A draft field value as one line of text. */
export function fieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(fieldText).join("、");
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key}：${fieldText(nested)}`)
      .join("；");
  return value === undefined || value === null ? "" : String(value);
}

/**
 * The instruction for a story setup drafted from the 设定 tab: the project's
 * current settings are the author's and are kept unless the request says so.
 */
export function storySetupInstruction(request: string): string {
  const said = request.trim();
  return [
    "整理并补全这部小说的故事设定。项目里已经填写的设定是作者的决定，除非作者要求修改，否则保留原意，只补全空缺的部分。",
    ...(said ? [`作者的要求：\n${said}`] : []),
  ].join("\n\n");
}

/** One line of the planning conversation, kept on this device. */
export interface PlanningMessage {
  readonly id: string;
  readonly role: "author" | "ai";
  readonly step: PlanningStepKey;
  readonly text: string;
  /** The AI draft this line carries. */
  readonly workflowId?: string;
}

/** What is already done, read from the saved project and its materials. */
export function planningProgress(input: {
  project: Pick<Project, "synopsis" | "coreHook">;
  characters: readonly DomainEntity[];
  outlines: readonly DomainEntity[];
}): Record<PlanningStepKey, boolean> {
  return {
    setup: Boolean(
      input.project.synopsis.trim() && input.project.coreHook?.trim(),
    ),
    characters: input.characters.length > 0,
    outline: input.outlines.some((item) => {
      const payload =
        item.payload && typeof item.payload === "object"
          ? (item.payload as Record<string, unknown>)
          : {};
      const level = String(payload["大纲层级"] ?? "");
      return level === "全书" || !level;
    }),
  };
}

/** The first step still to do, or `undefined` when planning is complete. */
export function nextPlanningStep(
  done: Record<PlanningStepKey, boolean>,
): PlanningStep | undefined {
  return PLANNING_STEPS.find((step) => !done[step.key]);
}

/** A draft's items as plain text, for asking the AI to revise it. */
export function draftText(output: CreationWorkflow["output"]): string {
  if (!output) return "";
  const items = output.items.map((item) =>
    [
      item.title,
      ...Object.entries(item.data).map(
        ([key, value]) =>
          `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`,
      ),
    ].join("\n"),
  );
  return [output.content.trim(), ...items].filter(Boolean).join("\n\n");
}

/**
 * The instruction for one AI draft of a step: the step's task, everything the
 * author said for it, and, when revising, the last draft and the new request.
 */
export function planningInstruction(input: {
  step: PlanningStep;
  authorLines: readonly string[];
  previous?: CreationWorkflow["output"];
  feedback?: string;
}): string {
  const said = input.authorLines.map((line) => line.trim()).filter(Boolean);
  const parts: string[] = [input.step.base];
  if (said.length)
    parts.push(
      `${input.step.key === "setup" ? "作者的想法" : "作者的要求"}：\n${said.join("\n")}`,
    );
  if (input.previous) {
    parts.push(`上一版方案：\n${draftText(input.previous)}`);
    parts.push(
      input.feedback?.trim()
        ? `请按作者的新意见修改上一版，未提到的部分尽量保留：${input.feedback.trim()}`
        : "请换一个明显不同的方案。",
    );
  }
  return parts.join("\n\n");
}

const STORAGE_PREFIX = "dramaip-novel-planning:";

/** The planning conversation saved for a project, or none. */
export function readPlanningMessages(projectId: string): PlanningMessage[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(STORAGE_PREFIX + projectId) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value.filter(
          (item): item is PlanningMessage =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as PlanningMessage).id === "string" &&
            typeof (item as PlanningMessage).text === "string" &&
            PLANNING_STEPS.some(
              (step) => step.key === (item as PlanningMessage).step,
            ),
        )
      : [];
  } catch {
    return [];
  }
}

export function savePlanningMessages(
  projectId: string,
  messages: readonly PlanningMessage[],
): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + projectId,
      JSON.stringify(messages.slice(-200)),
    );
  } catch {
    // The conversation is a convenience; saved materials live in the project.
  }
}
