import type {
  NarrativeStoryHierarchy,
  NarrativeStoryIndexEntry,
} from "@dramaip/contracts/knowledge";

type Available = Extract<NarrativeStoryHierarchy, { state: "available" }>;
export type StoryGroup = Available["groups"][number];
export const storyGroupKey = (group: StoryGroup) => `${group.kind}:${group.id}`;
export const storyGroupLabel = (group: StoryGroup) =>
  `${group.kind === "book" ? "全书" : group.kind === "volume" ? "卷" : "故事弧"}：${group.title} v${group.version}`;

export function narrativeStoryDirectory(hierarchy?: NarrativeStoryHierarchy) {
  const available = hierarchy?.state === "available" ? hierarchy : undefined;
  const chapters = new Map(
    available?.chapters.map((chapter) => [chapter.id, chapter]),
  );
  const groups = new Map(
    available?.groups.map((group) => [storyGroupKey(group), group]),
  );
  const memberships = new Map<string, StoryGroup[]>();
  for (const group of available?.groups ?? []) {
    if (group.state !== "current") continue;
    for (const id of group.chapterIds) {
      const list = memberships.get(id) ?? [];
      list.push(group);
      memberships.set(id, list);
    }
  }
  return { available, chapters, groups, memberships };
}
export type StoryDirectory = ReturnType<typeof narrativeStoryDirectory>;

export function narrativeStoryOrigins(
  entry: NarrativeStoryIndexEntry,
  directory: StoryDirectory,
) {
  return entry.sourceChapters.map((source) => {
    const chapter = directory.chapters.get(source.id);
    const state = !directory.available
      ? "unavailable"
      : !chapter
        ? "missing"
        : chapter.version !== source.version
          ? "stale"
          : "current";
    return {
      source,
      chapter,
      state,
      // Never attach current memberships to an old frozen chapter version.
      groups:
        state === "current" ? (directory.memberships.get(source.id) ?? []) : [],
    };
  });
}

export type StoryIndexView = "all" | "nodes" | "relationship" | "cognition";
export function narrativeStoryVisibleEntries(
  entries: readonly NarrativeStoryIndexEntry[],
  directory: StoryDirectory,
  filter: { chapterId?: string; groupKey?: string; view?: StoryIndexView },
) {
  const group = filter.groupKey
    ? directory.groups.get(filter.groupKey)
    : undefined;
  return entries
    .filter((entry) => {
      if (
        filter.chapterId &&
        !entry.sourceChapters.some((source) => source.id === filter.chapterId)
      )
        return false;
      if (
        filter.groupKey &&
        (!group ||
          group.state !== "current" ||
          !entry.sourceChapters.some(
            (source) =>
              directory.chapters.get(source.id)?.version === source.version &&
              group.chapterIds.includes(source.id),
          ))
      )
        return false;
      if (filter.view === "nodes")
        return entry.selection.kind === "declaration";
      return (
        !filter.view ||
        filter.view === "all" ||
        (entry.selection.kind === "assertion" &&
          entry.classification === filter.view)
      );
    })
    .sort((a, b) => {
      if (filter.view === "cognition") {
        const difference =
          (a.storyOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.storyOrder ?? Number.MAX_SAFE_INTEGER);
        if (difference) return difference;
      }
      return `${a.selection.kind}:${a.selection.id}`.localeCompare(
        `${b.selection.kind}:${b.selection.id}`,
      );
    });
}

export function narrativeStoryConnection(entry: NarrativeStoryIndexEntry) {
  const endpoint = (ref?: { id: string; version: number }) => {
    const node = entry.endpoints.find(
      (node) => node.id === ref?.id && node.version === ref.version,
    );
    return node
      ? `${node.title} v${node.version}（${node.id}）`
      : "原端点暂未核全";
  };
  const relations = {
    causes: "导致",
    enables: "使之成为可能",
    blocks: "阻碍",
    reveals: "揭示",
    conflicts_with: "冲突",
    depends_on: "依赖",
  };
  const states = {
    unknown: "未知",
    suspects: "怀疑",
    misbelieves: "误信",
    knows: "知晓",
  };
  if (entry.classification === "relationship")
    return `${endpoint(entry.relationshipEndpoints?.from)} → ${entry.relation ? relations[entry.relation] : "关系暂未核全"} → ${endpoint(entry.relationshipEndpoints?.to)}`;
  if (entry.classification === "cognition") {
    const subject =
      entry.cognitionSubject?.kind === "audience"
        ? `观众（${entry.cognitionSubject.id}）`
        : entry.cognitionSubject?.kind === "character"
          ? endpoint(entry.cognitionSubject.node)
          : "原认知主体类型未核全";
    const target =
      entry.cognitionSubject?.kind === "audience"
        ? endpoint(entry.cognitionTarget)
        : entry.cognitionSubject?.kind === "character"
          ? endpoint(entry.cognitionTarget)
          : "原认知对象未核全";
    return `${subject} → ${target} · ${entry.knowledgeState ? states[entry.knowledgeState] : "认知状态未核全"} · 人工声明顺序 ${entry.storyOrder ?? "未记录"}`;
  }
  return "来源锚定节点（不是自动提取或语义认证）";
}
