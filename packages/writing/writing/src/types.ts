/**
 * Wire types of the `writing` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/writing-writing/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `writing/analysisRunChapter` (`analysis.runChapter`). */
export type AnalysisRunChapterResult = {
  task: {
    id: string;
    kind: string;
    status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "canceled"
      | "interrupted";
    attentionStatus: "open" | "acknowledged";
    resultStatus: "none" | "pending" | "applied" | "discarded" | "conflicted";
    title: string;
    progress: number;
    projectId?: string;
    parentTaskId?: string;
    conversationId?: string;
    assistantTurnId?: string;
    stage?: string;
    result?: JsonValue;
    error?: string;
    createdAt: string;
    updatedAt: string;
  };
  records: {
    id: string;
    kind:
      | "quality"
      | "episode-analysis"
      | "case-study"
      | "diagnostic"
      | "acknowledgement";
    projectId?: string;
    parentId?: string;
    value: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Query of `writing/chaptersAdoptions` (`chapters.adoptions`). */
export type ChaptersAdoptionsQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `writing/chaptersAdoptions` (`chapters.adoptions`). */
export type ChaptersAdoptionsResult = {
  items: {
    workflowId: string;
    chapterId: string;
    version: number;
    adoptedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/chaptersCreate` (`chapters.create`). */
export type ChaptersCreateInput = {
  projectId: string;
  volumeId?: string;
  title: string;
  summary?: string;
  outline?: string;
  content?: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
};

/** Answer of `writing/chaptersCreate` (`chapters.create`). */
export type ChaptersCreateResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/chaptersGet` (`chapters.get`). */
export type ChaptersGetResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/chaptersList` (`chapters.list`). */
export type ChaptersListResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `writing/chaptersReorder` (`chapters.reorder`). */
export type ChaptersReorderInput = {
  chapterIds: string[];
};

/** Answer of `writing/chaptersReorder` (`chapters.reorder`). */
export type ChaptersReorderResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `writing/chaptersUpdate` (`chapters.update`). */
export type ChaptersUpdateInput = {
  volumeId?: string;
  title?: string;
  summary?: string;
  outline?: string;
  content?: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
};

/** Answer of `writing/chaptersUpdate` (`chapters.update`). */
export type ChaptersUpdateResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/charactersCreate` (`characters.create`). */
export type CharactersCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/charactersCreate` (`characters.create`). */
export type CharactersCreateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/charactersGet` (`characters.get`). */
export type CharactersGetResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `writing/charactersList` (`characters.list`). */
export type CharactersListQuery = {
  projectId?: string;
};

/** Answer of `writing/charactersList` (`characters.list`). */
export type CharactersListResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `writing/charactersUpdate` (`characters.update`). */
export type CharactersUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/charactersUpdate` (`characters.update`). */
export type CharactersUpdateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/contentVersionsList` (`content-versions.list`). */
export type ContentVersionsListResult = {
  id: string;
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  versionNumber: number;
  snapshot: {
    id: string;
    projectId: string;
    volumeId?: string;
    title: string;
    orderIndex: number;
    summary: string;
    outline?: string;
    content: string;
    mainConflict?: string;
    hook?: string;
    highlight?: string;
    reversal?: string;
    cliffhanger?: string;
    shortDramaNote?: string;
    aiVideoNote?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  createdAt: string;
}[];

/** Answer of `writing/contentVersionsRestore` (`content-versions.restore`). */
export type ContentVersionsRestoreResult = {
  targetKind: "chapter";
  targetId: string;
  restoredFromId: string;
  chapter: {
    id: string;
    projectId: string;
    volumeId?: string;
    title: string;
    orderIndex: number;
    summary: string;
    outline?: string;
    content: string;
    mainConflict?: string;
    hook?: string;
    highlight?: string;
    reversal?: string;
    cliffhanger?: string;
    shortDramaNote?: string;
    aiVideoNote?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
};

/** Input of `writing/creatorCalendarCreate` (`creator.calendar.create`). */
export type CreatorCalendarCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorCalendarCreate` (`creator.calendar.create`). */
export type CreatorCalendarCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorCalendarList` (`creator.calendar.list`). */
export type CreatorCalendarListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorCalendarUpdate` (`creator.calendar.update`). */
export type CreatorCalendarUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorCalendarUpdate` (`creator.calendar.update`). */
export type CreatorCalendarUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/creatorColumnCreate` (`creator.column.create`). */
export type CreatorColumnCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorColumnCreate` (`creator.column.create`). */
export type CreatorColumnCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorColumnList` (`creator.column.list`). */
export type CreatorColumnListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorColumnUpdate` (`creator.column.update`). */
export type CreatorColumnUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorColumnUpdate` (`creator.column.update`). */
export type CreatorColumnUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/creatorDraftCreate` (`creator.draft.create`). */
export type CreatorDraftCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorDraftCreate` (`creator.draft.create`). */
export type CreatorDraftCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorDraftList` (`creator.draft.list`). */
export type CreatorDraftListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorDraftUpdate` (`creator.draft.update`). */
export type CreatorDraftUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorDraftUpdate` (`creator.draft.update`). */
export type CreatorDraftUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/creatorIdeaCreate` (`creator.idea.create`). */
export type CreatorIdeaCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorIdeaCreate` (`creator.idea.create`). */
export type CreatorIdeaCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorIdeaList` (`creator.idea.list`). */
export type CreatorIdeaListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorIdeaUpdate` (`creator.idea.update`). */
export type CreatorIdeaUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorIdeaUpdate` (`creator.idea.update`). */
export type CreatorIdeaUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/creatorProfileCreate` (`creator.profile.create`). */
export type CreatorProfileCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorProfileCreate` (`creator.profile.create`). */
export type CreatorProfileCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorProfileList` (`creator.profile.list`). */
export type CreatorProfileListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorProfileUpdate` (`creator.profile.update`). */
export type CreatorProfileUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorProfileUpdate` (`creator.profile.update`). */
export type CreatorProfileUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/creatorVariantCreate` (`creator.variant.create`). */
export type CreatorVariantCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/creatorVariantCreate` (`creator.variant.create`). */
export type CreatorVariantCreateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/creatorVariantList` (`creator.variant.list`). */
export type CreatorVariantListResult = {
  items: {
    id: string;
    kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
    projectId: string;
    parentId?: string;
    title: string;
    status:
      | "draft"
      | "researching"
      | "review_required"
      | "ready"
      | "scheduled"
      | "archived";
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/creatorVariantUpdate` (`creator.variant.update`). */
export type CreatorVariantUpdateInput = {
  title?: string;
  status?:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/creatorVariantUpdate` (`creator.variant.update`). */
export type CreatorVariantUpdateResult = {
  id: string;
  kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar";
  projectId: string;
  parentId?: string;
  title: string;
  status:
    | "draft"
    | "researching"
    | "review_required"
    | "ready"
    | "scheduled"
    | "archived";
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/novelWorkspaceContinueChapter` (`novel-workspace.continueChapter`). */
export type NovelWorkspaceContinueChapterInput = {
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  prompt?: string;
  wordGoal?: number;
  baseVersion: number;
  sourceChapterId: string;
  narrativeContextRequest?: {
    format: "narrative-context-v1";
    chapters: (
      | {
          id: string;
          version: number;
          representation: "original";
        }
      | {
          id: string;
          version: number;
          representation: "summary";
          record: {
            id: string;
            version: number;
          };
        }
      | {
          id: string;
          version: number;
          representation: "paragraphs";
          paragraphIds: string[];
        }
    )[];
    summaries?: {
      id: string;
      version: number;
    }[];
    story?: {
      id: string;
      version: number;
      kind: "declaration" | "assertion";
    }[];
  };
};

/** Answer of `writing/novelWorkspaceContinueChapter` (`novel-workspace.continueChapter`). */
export type NovelWorkspaceContinueChapterResult = {
  chapter: {
    id: string;
    projectId: string;
    volumeId?: string;
    title: string;
    orderIndex: number;
    summary: string;
    outline?: string;
    content: string;
    mainConflict?: string;
    hook?: string;
    highlight?: string;
    reversal?: string;
    cliffhanger?: string;
    shortDramaNote?: string;
    aiVideoNote?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  run: {
    taskId: string;
    sessionId: string;
    runId: string;
    chapterId: string;
    autoCommitWhenReady: boolean;
  };
};

/** Answer of `writing/novelWorkspaceGet` (`novel-workspace.get`). */
export type NovelWorkspaceGetResult = {
  project: {
    id: string;
    title: string;
    shortDramaType?: string;
    mode:
      | "series_longform"
      | "single_season"
      | "personal_theater"
      | "creator_channel";
    modeConfig:
      | {
          mode: "series_longform";
          targetChapterCount?: number;
          targetSeasonCount?: number;
          targetEpisodesPerSeason?: number;
        }
      | {
          mode: "single_season";
          entryPath: "novel" | "source-import" | "script" | "inspiration";
          targetEpisodeCount?: number;
        }
      | {
          mode: "personal_theater";
          storyMethod: "template" | "freeform";
          episodeCount?: number;
          episodeDurationMinutes?: number;
        }
      | {
          mode: "creator_channel";
          topic: string;
          positioning?: string;
          audience?: string;
          platforms?: string[];
          riskDomain?: "general" | "finance" | "health" | "legal";
        };
    lifecycleStatus: "initializing" | "ready" | "failed";
    derivedFromProjectId?: string;
    targetAudience?: string;
    targetWordCount?: number;
    targetEpisodeCount?: number;
    coreHook?: string;
    emotionalCore?: string;
    coreSellingPoint?: string;
    synopsis: string;
    styleGuide?: string;
    visualStyleDirection?: string;
    genreOpportunity?: string;
    productionBrief?: string;
    seriesId?: string;
    seriesTitle?: string;
    currentAdaptationId?: string;
    deletedAt?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  chapters: {
    id: string;
    projectId: string;
    volumeId?: string;
    title: string;
    orderIndex: number;
    summary: string;
    outline?: string;
    content: string;
    mainConflict?: string;
    hook?: string;
    highlight?: string;
    reversal?: string;
    cliffhanger?: string;
    shortDramaNote?: string;
    aiVideoNote?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  characters: Record<string, JsonValue>[];
  outlines: Record<string, JsonValue>[];
  storyArcs: Record<string, JsonValue>[];
  statuses: {
    chapterId: string;
    words: number;
    hasMemory: boolean;
    quality?: "pass" | "warn" | "block";
    latestTaskStatus?: string;
  }[];
};

/** Answer of `writing/novelWorkspaceListChapterVersions` (`novel-workspace.listChapterVersions`). */
export type NovelWorkspaceListChapterVersionsResult = Record<
  string,
  JsonValue
>[];

/** Input of `writing/novelWorkspaceRestoreChapterVersion` (`novel-workspace.restoreChapterVersion`). */
export type NovelWorkspaceRestoreChapterVersionInput = {
  baseVersion: number;
};

/** Answer of `writing/novelWorkspaceRestoreChapterVersion` (`novel-workspace.restoreChapterVersion`). */
export type NovelWorkspaceRestoreChapterVersionResult = {
  id: string;
  projectId: string;
  volumeId?: string;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/novelWorkspaceRunChapterAgent` (`novel-workspace.runChapterAgent`). */
export type NovelWorkspaceRunChapterAgentInput = {
  taskType: string;
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  prompt?: string;
  wordGoal?: number;
  baseVersion: number;
  selection?: JsonValue;
};

/** Answer of `writing/novelWorkspaceRunChapterAgent` (`novel-workspace.runChapterAgent`). */
export type NovelWorkspaceRunChapterAgentResult = {
  taskId: string;
  sessionId: string;
  runId: string;
  chapterId: string;
  autoCommitWhenReady: boolean;
};

/** Input of `writing/outlinesCreate` (`outlines.create`). */
export type OutlinesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/outlinesCreate` (`outlines.create`). */
export type OutlinesCreateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/outlinesGet` (`outlines.get`). */
export type OutlinesGetResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `writing/outlinesList` (`outlines.list`). */
export type OutlinesListQuery = {
  projectId?: string;
};

/** Answer of `writing/outlinesList` (`outlines.list`). */
export type OutlinesListResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `writing/outlinesUpdate` (`outlines.update`). */
export type OutlinesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/outlinesUpdate` (`outlines.update`). */
export type OutlinesUpdateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/storyArcsCreate` (`story-arcs.create`). */
export type StoryArcsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `writing/storyArcsCreate` (`story-arcs.create`). */
export type StoryArcsCreateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `writing/storyArcsGet` (`story-arcs.get`). */
export type StoryArcsGetResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `writing/storyArcsList` (`story-arcs.list`). */
export type StoryArcsListQuery = {
  projectId?: string;
};

/** Answer of `writing/storyArcsList` (`story-arcs.list`). */
export type StoryArcsListResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `writing/storyArcsUpdate` (`story-arcs.update`). */
export type StoryArcsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `writing/storyArcsUpdate` (`story-arcs.update`). */
export type StoryArcsUpdateResult = {
  id: string;
  domain: "characters" | "outlines" | "story-arcs";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `writing/volumesAssignChapters` (`volumes.assignChapters`). */
export type VolumesAssignChaptersInput = {
  chapters: {
    chapterId: string;
    version: number;
    volumeId: string | null;
  }[];
  volumes: {
    id: string;
    version: number;
  }[];
};

/** Answer of `writing/volumesAssignChapters` (`volumes.assignChapters`). */
export type VolumesAssignChaptersResult = {
  id: string;
  projectId: string;
  input: {
    chapters: {
      chapterId: string;
      version: number;
      volumeId: string | null;
    }[];
    volumes: {
      id: string;
      version: number;
    }[];
  };
  chapters: {
    chapterId: string;
    version: number;
    volumeId: string | null;
  }[];
  committedAt: string;
};

/** Input of `writing/volumesCreate` (`volumes.create`). */
export type VolumesCreateInput = {
  title: string;
  outline?: string;
};

/** Answer of `writing/volumesCreate` (`volumes.create`). */
export type VolumesCreateResult = {
  id: string;
  projectId: string;
  title: string;
  outline: string;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `writing/volumesList` (`volumes.list`). */
export type VolumesListQuery = {
  cursor?: string;
  limit?: string;
};

/** Answer of `writing/volumesList` (`volumes.list`). */
export type VolumesListResult = {
  items: {
    id: string;
    projectId: string;
    title: string;
    outline: string;
    orderIndex: number;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `writing/volumesUpdate` (`volumes.update`). */
export type VolumesUpdateInput = {
  title?: string;
  outline?: string;
  version: number;
};

/** Answer of `writing/volumesUpdate` (`volumes.update`). */
export type VolumesUpdateResult = {
  id: string;
  projectId: string;
  title: string;
  outline: string;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
