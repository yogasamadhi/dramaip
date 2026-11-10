import { evidenceEn, evidenceZh } from "./evidence/evidence-locale.ts";

/** Copy of the media client: the production page frame and the evidence. */
export const zh = {
  ...evidenceZh,
  "produce.title": "制作",
  "produce.description": "分镜、素材、音视频与成片输出。",
  "review.title": "媒体待确认对象",
  "review.description":
    "只返回指定身份的实际记录。打开不确认、不采用、不调用模型、不初始化时间线；审阅声明每次重新勾选。",
} as const;

/** English copy, key for key. */
export const en: Record<keyof typeof zh, string> = {
  ...evidenceEn,
  "produce.title": "Production",
  "produce.description":
    "Storyboards, assets, audio, video and the finished cut.",
  "review.title": "Media awaiting confirmation",
  "review.description":
    "Returns only the actual record of the named identity. Opening it confirms nothing, adopts nothing, calls no model and initializes no timeline; review declarations are checked anew each time.",
};
