import { stagesEn, stagesZh } from "./stages/stages-locale.ts";

/** Copy of the review client: the review and delivery page frame and its stages. */
export const zh = {
  ...stagesZh,
  "page.title": "审核交付",
  "page.description": "按分集完成质量检查、审片和交付导出。",
  "page.noProject": "请先选择项目。",
  "scope.label": "当前制作对象",
  "scope.current": "当前对象",
  "scope.noEpisode": "· 尚未选择分集（制作与交付可选）",
  "scope.open": "切换",
  "scope.close": "收起",
  "scope.project": "项目",
  "scope.project.none": "选择项目",
  "scope.adaptation": "改编项目",
  "scope.adaptation.none": "选择改编项目",
  "scope.episode": "分集",
  "scope.episode.none": "选择分集",
  "scope.check.label": "制作对象归属核对",
  "scope.checking": "正在核对指定项目和制作对象的完整父级…",
  "scope.failed":
    "指定项目或制作对象未能读取、身份或父级归属不符；未改读最近项目、列表首项或上次选择。",
  "scope.failed.back": "返回项目工作台，另行选择对象",
  "stages.label": "审核交付阶段",
  "stage.quality": "问题与阻塞",
  "stage.compliance": "合规复检",
  "stage.review": "预览与修订",
  "stage.localization": "字幕与本地化",
  "stage.delivery": "导出与发布",
  "stage.state.blocked": "需要先完成",
  "stage.state.recommended": "建议现在做",
  "stage.state.later": "可以稍后做",
  "stage.blocked.project": "请先创建或选择一个项目。",
  "stage.blocked.adaptation":
    "审核资料必须归属改编方案，请先创建或选择改编方案。",
  "stage.blocked.episode": "审核资料必须归属具体分集，请先创建或选择分集。",
  "stage.recover.project": "返回项目工作台",
  "stage.recover.adaptation": "去改编工作区补齐",
} as const;

export const en: Record<keyof typeof zh, string> = {
  ...stagesEn,
  "page.title": "Review & delivery",
  "page.description":
    "Check quality, review cuts and export deliveries, episode by episode.",
  "page.noProject": "Choose a project first.",
  "scope.label": "Current production object",
  "scope.current": "Current object",
  "scope.noEpisode":
    "· No episode chosen (optional for production and delivery)",
  "scope.open": "Change",
  "scope.close": "Collapse",
  "scope.project": "Project",
  "scope.project.none": "Choose a project",
  "scope.adaptation": "Adaptation",
  "scope.adaptation.none": "Choose an adaptation",
  "scope.episode": "Episode",
  "scope.episode.none": "Choose an episode",
  "scope.check.label": "Production object check",
  "scope.checking":
    "Checking the project and the full parent chain of the named objects…",
  "scope.failed":
    "The named project or production object could not be read, or its identity or parent does not match; no recent project, first item or last choice was read instead.",
  "scope.failed.back": "Back to the project home to choose again",
  "stages.label": "Review and delivery stages",
  "stage.quality": "Issues & blockers",
  "stage.compliance": "Compliance recheck",
  "stage.review": "Preview & revise",
  "stage.localization": "Subtitles & localization",
  "stage.delivery": "Export & publish",
  "stage.state.blocked": "Needs earlier steps",
  "stage.state.recommended": "Do this now",
  "stage.state.later": "Can wait",
  "stage.blocked.project": "Create or choose a project first.",
  "stage.blocked.adaptation":
    "Review records belong to an adaptation; create or choose one first.",
  "stage.blocked.episode":
    "Review records belong to an episode; create or choose one first.",
  "stage.recover.project": "Back to the project home",
  "stage.recover.adaptation": "Complete it in the adaptation workspace",
};
