import { diagnosisEn, diagnosisZh } from "./diagnosis/diagnosis-locale.ts";
import { seasonEn, seasonZh } from "./season/season-locale.ts";
import { strategyEn, strategyZh } from "./strategy/strategy-locale.ts";

/** Copy of the production client: the adaptation page frame and the tools. */
export const zh = {
  ...diagnosisZh,
  ...strategyZh,
  ...seasonZh,
  "intro.story.title": "从故事到单集开发",
  "intro.story.description":
    "按诊断、策略、季纲、单集剧本逐步推进，每一步由你确认。",
  "intro.script.title": "从创意到分集剧本",
  "intro.script.description": "从故事构思直接生成分集剧本，不必先写小说。",
};

/** English copy, key for key. */
export const en: Record<keyof typeof zh, string> = {
  ...diagnosisEn,
  ...strategyEn,
  ...seasonEn,
  "intro.story.title": "From story to episode development",
  "intro.story.description":
    "Move through diagnosis, strategy, the season outline and each episode script one step at a time; you confirm every step.",
  "intro.script.title": "From idea to episode scripts",
  "intro.script.description":
    "Generate episode scripts straight from the story idea, without writing a novel first.",
};
