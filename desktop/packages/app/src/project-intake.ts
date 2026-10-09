import type {
  ProjectInput,
  ProjectMode,
  ProjectModeConfig,
} from "@dramaip/contracts/product";

export const PROJECT_CREATION_SOURCES = [
  "inspiration",
  "source-import",
  "script",
] as const;

export type ProjectCreationSource = (typeof PROJECT_CREATION_SOURCES)[number];

/** Old novel-based single-season projects retain their existing writing route. */
export function isDirectScriptProject(project: {
  modeConfig: ProjectModeConfig;
}): boolean {
  return (
    project.modeConfig.mode === "single_season" &&
    ["script", "inspiration"].includes(project.modeConfig.entryPath)
  );
}

export const PROJECT_SOURCE_OPTIONS = [
  {
    source: "source-import" as const,
    title: "导入小说或大纲",
    description: "预览并确认来源权利，再选择继续写小说或改编剧本。",
    outcome: "导入预览不会创建项目或覆盖原稿",
    recommended: true,
  },
  {
    source: "inspiration" as const,
    title: "从创意开始",
    description: "提供故事想法，选择写小说或直接开发短剧、漫剧剧本。",
    outcome: "保留创作方向，由你审阅与采用",
  },
  {
    source: "script" as const,
    title: "导入已有剧本",
    description: "粘贴已有剧本或预览文件，不要求先写一部小说。",
    outcome: "从已有内容继续检查与制作",
  },
] as const;

export function recommendedProjectMode(
  source: ProjectCreationSource,
): ProjectMode {
  return source === "inspiration" ? "series_longform" : "single_season";
}

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

export function projectModeBrief(
  mode: ProjectMode,
  source: ProjectCreationSource,
  current?: ProductionBriefDraft,
): ProductionBriefDraft {
  const base = defaultProductionBrief(source);
  const modeDefaults: Record<ProjectMode, Partial<ProductionBriefDraft>> = {
    series_longform: {
      shortDramaType: "",
      targetAudience: "小说读者",
      targetPlatform: "",
      aspectRatio: "",
      visualStyleDirection: "",
      targetChapterCount: "300",
      targetSeasonCount: "5",
      targetEpisodesPerSeason: "80",
      episodeDuration: "60—90 秒",
    },
    single_season: {
      shortDramaType: "",
      targetEpisodeCount: "80",
      episodeDuration: "60—90 秒",
    },
    personal_theater: {
      shortDramaType: "个人故事",
      targetAudience: "本人及亲友",
      targetEpisodeCount: "1",
      episodeDuration: "5 分钟",
    },
    creator_channel: {
      shortDramaType: "主题内容",
      targetAudience: "目标账号受众",
      targetEpisodeCount: "",
      episodeDuration: "60—180 秒",
      visualStyleDirection: "统一账号视觉与表达风格",
    },
  };
  return {
    ...base,
    ...modeDefaults[mode],
    title: current?.title ?? "",
    idea: current?.idea ?? "",
  };
}

export function projectModeConfigFromDraft(
  mode: ProjectMode,
  source: ProjectCreationSource,
  brief: ProductionBriefDraft,
  creatorTopic: string,
): ProjectModeConfig | undefined {
  if (mode === "series_longform") {
    const targetChapterCount = positiveInteger(brief.targetChapterCount);
    const targetSeasonCount = positiveInteger(brief.targetSeasonCount);
    const targetEpisodesPerSeason = positiveInteger(
      brief.targetEpisodesPerSeason,
    );
    return targetChapterCount && targetSeasonCount && targetEpisodesPerSeason
      ? {
          mode,
          targetChapterCount,
          targetSeasonCount,
          targetEpisodesPerSeason,
        }
      : undefined;
  }
  if (mode === "single_season") {
    const targetEpisodeCount = positiveInteger(brief.targetEpisodeCount);
    return targetEpisodeCount
      ? {
          mode,
          entryPath:
            source === "script"
              ? "script"
              : source === "source-import"
                ? "source-import"
                : "inspiration",
          targetEpisodeCount,
        }
      : undefined;
  }
  if (mode === "personal_theater") {
    const episodeCount = positiveInteger(brief.targetEpisodeCount);
    const durationMatch = brief.episodeDuration.match(
      /^\s*(\d+)(?:\s*分钟)?\s*$/u,
    );
    const episodeDurationMinutes = positiveInteger(durationMatch?.[1] ?? "");
    return episodeCount && episodeDurationMinutes
      ? {
          mode,
          storyMethod: source === "script" ? "freeform" : "template",
          episodeCount,
          episodeDurationMinutes,
        }
      : undefined;
  }
  const topic = creatorTopic.trim();
  return topic ? { mode, topic, riskDomain: "general" } : undefined;
}

function requiredValue(value: string): string {
  return value.trim() || "待补充";
}
