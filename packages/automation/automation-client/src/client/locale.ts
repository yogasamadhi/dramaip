import {
  confirmationsEn,
  confirmationsZh,
} from "./confirmations/confirmations-locale.ts";

/**
 * Copy of the automation client: the task and pending confirmation page
 * frames, then their centers.
 */
export const zh = {
  "tasks.title": "任务中心",
  "tasks.description":
    "先处理待确认结果和异常任务；运行配置仅在新建任务时展开。",
  "pending.title": "待确认中心",
  "pending.description.project":
    "当前项目中等待你决定的 AI 草稿、声明、费用预览和异常任务；打开本页不会采用内容或授权费用。",
  "pending.description.all":
    "全部项目中等待你决定的 AI 草稿、声明、费用预览和异常任务；打开本页不会采用内容或授权费用。",
  ...confirmationsZh,
} as const;

/** English copy, key for key. */
export const en: Record<keyof typeof zh, string> = {
  "tasks.title": "Task center",
  "tasks.description":
    "Handle results awaiting confirmation and failed tasks first; run settings open only when you start a new task.",
  "pending.title": "Pending confirmations",
  "pending.description.project":
    "AI drafts, declarations, cost previews and failed tasks in this project that wait for your decision; opening this page adopts no content and authorizes no cost.",
  "pending.description.all":
    "AI drafts, declarations, cost previews and failed tasks across all projects that wait for your decision; opening this page adopts no content and authorizes no cost.",
  ...confirmationsEn,
};
