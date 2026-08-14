import type { AgentTaskType, AssistantIntentRoute } from "@sdns/schema";

const DETERMINISTIC_RULES: Array<{
  pattern: RegExp;
  taskType: AgentTaskType;
  chapterRequired?: boolean;
}> = [
  {
    pattern: /(?:继续写|接着写|续写)/u,
    taskType: "continue_chapter",
    chapterRequired: true,
  },
  {
    pattern: /(?:润色|优化文笔|修饰文字)/u,
    taskType: "polish_chapter",
    chapterRequired: true,
  },
  {
    pattern: /(?:重写|改写)/u,
    taskType: "rewrite_chapter",
    chapterRequired: true,
  },
  {
    pattern: /(?:扩写|写得更长|补充细节)/u,
    taskType: "expand_chapter",
    chapterRequired: true,
  },
  {
    pattern: /(?:诊断|点评|分析这章|检查这章)/u,
    taskType: "chapter_diagnostic",
    chapterRequired: true,
  },
  {
    pattern: /(?:生成|写).*(?:本章|章节|正文)/u,
    taskType: "generate_chapter",
    chapterRequired: true,
  },
  { pattern: /(?:人物卡|角色设定)/u, taskType: "generate_characters" },
  { pattern: /(?:全书大纲|小说大纲)/u, taskType: "generate_book_outline" },
  { pattern: /(?:一致性|前后矛盾|设定冲突)/u, taskType: "check_consistency" },
];

export function routeAssistantIntent(input: {
  message: string;
  explicitTaskType?: AgentTaskType;
  hasProject: boolean;
  hasChapter: boolean;
}): AssistantIntentRoute {
  const message = input.message.trim();
  if (input.explicitTaskType) {
    if (!input.hasProject)
      return clarification("这项任务需要先绑定一个项目。", "shortcut");
    if (isChapterTask(input.explicitTaskType) && !input.hasChapter)
      return clarification("请先打开或选择一个章节。", "shortcut");
    return {
      kind: "task",
      taskType: input.explicitTaskType,
      confidence: 1,
      source: "shortcut",
      explanation: "由界面快捷动作明确指定任务。",
    };
  }

  const matched = DETERMINISTIC_RULES.find((rule) =>
    rule.pattern.test(message),
  );
  if (matched) {
    if (!input.hasProject)
      return clarification(
        "我可以帮你办这件事，请先绑定一个项目。",
        "deterministic",
      );
    if (matched.chapterRequired && !input.hasChapter)
      return clarification(
        "这项操作需要一个明确章节，请先选择章节。",
        "deterministic",
      );
    return {
      kind: "task",
      taskType: matched.taskType,
      confidence: 0.98,
      source: "deterministic",
      explanation: "已由安全的本地规则识别为明确创作任务。",
    };
  }

  return {
    kind: "chat",
    taskType: "chat_project",
    confidence: 0.5,
    source: "fallback",
    explanation: input.hasProject
      ? "未可靠识别为内容修改，按只读项目对话处理。"
      : "未绑定项目，按无工具的通用对话处理。",
  };
}

function clarification(
  message: string,
  source: "shortcut" | "deterministic",
): AssistantIntentRoute {
  return {
    kind: "clarify",
    confidence: 1,
    source,
    explanation: message,
    clarification: message,
  };
}

function isChapterTask(taskType: AgentTaskType): boolean {
  return new Set<AgentTaskType>([
    "chapter_diagnostic",
    "chapter_revision",
    "generate_chapter",
    "continue_chapter",
    "rewrite_chapter",
    "polish_chapter",
    "expand_chapter",
    "enhance_conflict",
    "enhance_highlight",
    "enhance_ai_drama_feel",
    "enhance_author_style",
    "enhance_hook",
    "enhance_reversal",
    "enhance_cliffhanger",
    "rewrite_as_ai_drama_novel",
  ]).has(taskType);
}
