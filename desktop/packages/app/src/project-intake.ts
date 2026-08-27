import type {
  ProjectInput,
  ProjectModeConfig,
} from "@dramaip/contracts/product";

export const PROJECT_CREATION_SOURCES = [
  "inspiration",
  "source-import",
  "script",
] as const;

export type ProjectCreationSource = (typeof PROJECT_CREATION_SOURCES)[number];

export type ProductionBriefDraft = {
  creationSource: ProjectCreationSource;
  title: string;
  idea: string;
  shortDramaType: string;
  targetAudience: string;
  targetPlatform: string;
  episodeDuration: string;
  targetEpisodeCount: string;
  targetChapterCount: string;
  targetSeasonCount: string;
  targetEpisodesPerSeason: string;
  aspectRatio: string;
  visualStyleDirection: string;
};

export const DEFAULT_PRODUCTION_BRIEF: Omit<
  ProductionBriefDraft,
  "creationSource" | "title"
> = {
  idea: "",
  shortDramaType: "都市情感",
  targetAudience: "18—35 岁短剧观众",
  targetPlatform: "短视频平台",
  episodeDuration: "60—90 秒",
  targetEpisodeCount: "80",
  targetChapterCount: "300",
  targetSeasonCount: "5",
  targetEpisodesPerSeason: "80",
  aspectRatio: "9:16 竖屏",
  visualStyleDirection: "写实电影感，强调人物情绪与镜头叙事",
};

const sourceLabels: Record<ProjectCreationSource, string> = {
  inspiration: "从灵感开始",
  "source-import": "导入原著",
  script: "直接导入 / 粘贴剧本",
};

const contentLabels: Record<ProjectCreationSource, string> = {
  inspiration: "故事构思",
  "source-import": "已授权原著或 IP",
  script: "剧本草稿",
};

export function defaultProductionBrief(
  creationSource: ProjectCreationSource,
): ProductionBriefDraft {
  return {
    creationSource,
    title: "",
    ...DEFAULT_PRODUCTION_BRIEF,
  };
}

export function productionBriefText(
  draft: ProductionBriefDraft,
  modeConfig?: ProjectModeConfig,
): string {
  const common = [
    "DramaIP 生产简报 v1",
    `创建路径：${sourceLabels[draft.creationSource]}`,
    `内容形态：${contentLabels[draft.creationSource]}`,
    `目标受众：${requiredValue(draft.targetAudience)}`,
    `目标平台：${requiredValue(draft.targetPlatform)}`,
  ];
  const scale =
    modeConfig?.mode === "series_longform"
      ? [
          `母本章节：${modeConfig.targetChapterCount ?? "待补充"} 章`,
          `计划季数：${modeConfig.targetSeasonCount ?? "待补充"} 季`,
          `每季集数：${modeConfig.targetEpisodesPerSeason ?? "待补充"} 集`,
        ]
      : modeConfig?.mode === "creator_channel"
        ? []
        : [
            `单集时长：${requiredValue(draft.episodeDuration)}`,
            `计划集数：${requiredValue(draft.targetEpisodeCount)} 集`,
          ];
  return [
    ...common,
    ...scale,
    `画幅：${requiredValue(draft.aspectRatio)}`,
    `视觉方向：${requiredValue(draft.visualStyleDirection)}`,
  ].join("\n");
}

export function projectInputFromBrief(
  draft: ProductionBriefDraft,
  modeConfig?: ProjectModeConfig,
): ProjectInput {
  const targetEpisodeCount = Number(draft.targetEpisodeCount);
  return {
    title: draft.title.trim(),
    shortDramaType: draft.shortDramaType.trim() || undefined,
    ...(modeConfig ? { mode: modeConfig.mode, modeConfig } : {}),
    targetAudience: draft.targetAudience.trim() || undefined,
    ...(modeConfig?.mode !== "series_longform" &&
    modeConfig?.mode !== "creator_channel" &&
    Number.isInteger(targetEpisodeCount) &&
    targetEpisodeCount > 0
      ? { targetEpisodeCount }
      : {}),
    visualStyleDirection: draft.visualStyleDirection.trim() || undefined,
    synopsis: draft.idea.trim(),
    styleGuide: draft.idea.trim()
      ? `【创作灵感】\n${draft.idea.trim()}`
      : undefined,
    productionBrief: productionBriefText(draft, modeConfig),
  };
}

export function positiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function requiredValue(value: string): string {
  return value.trim() || "待补充";
}
