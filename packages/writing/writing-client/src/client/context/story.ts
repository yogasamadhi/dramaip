import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {
  Chapter,
  NarrativeStoryHierarchy,
  NarrativeStoryIndexEntry,
  NarrativeStorySelection,
} from "./types.ts";

type T = TranslateNS<"narrative">;
type Available = Extract<
  NonNullable<NarrativeStoryHierarchy>,
  { state: "available" }
>;
export type StoryGroup = Available["groups"][number];
export type StoryIndexView = "all" | "nodes" | "relationship" | "cognition";

export const storyGroupKey = (group: StoryGroup) => `${group.kind}:${group.id}`;
export const storyGroupLabel = (t: T, group: StoryGroup) =>
  t("story.group", {
    kind: t(`story.group.${group.kind}`),
    title: group.title,
    version: group.version,
  });

/**
 * Why a declaration cannot enter this round: an interpretation's source
 * pointers are not an original text or summary, never satisfy whole-chapter
 * coverage, and every one of them must lie in the confirmed chapters.
 */
export function narrativeStoryScopeReasons(
  t: T,
  entry: NarrativeStoryIndexEntry,
  projectId: string,
  chapters: readonly Pick<
    Chapter,
    "id" | "version" | "projectId" | "content"
  >[],
) {
  const reasons = [...entry.eligibility.reasons];
  if (entry.projectId !== projectId) reasons.push(t("story.reason.project"));
  if (entry.eligibility.state !== "eligible" && !reasons.length)
    reasons.push(t("story.reason.unverified"));
  if (entry.sourceScripts.length) reasons.push(t("story.reason.script"));
  if (!entry.sourceChapters.length) reasons.push(t("story.reason.noChapter"));
  if (
    entry.sourceChapters.some(
      (ref) =>
        !chapters.some(
          (chapter) =>
            chapter.projectId === projectId &&
            chapter.id === ref.id &&
            chapter.version === ref.version &&
            chapter.content.trim(),
        ),
    )
  )
    reasons.push(t("story.reason.scope"));
  return reasons;
}

export const sameNarrativeStorySelection = (
  left: NarrativeStorySelection,
  right: NarrativeStorySelection,
) =>
  left.kind === right.kind &&
  left.id === right.id &&
  left.version === right.version;

/** The current chapter, volume and story arc directory of a story index. */
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

/** Each source chapter of a declaration against the current directory. */
export function narrativeStoryOrigins(
  entry: NarrativeStoryIndexEntry,
  directory: StoryDirectory,
) {
  return entry.sourceChapters.map((source) => {
    const chapter = directory.chapters.get(source.id);
    const state = !directory.available
      ? ("unavailable" as const)
      : !chapter
        ? ("missing" as const)
        : chapter.version !== source.version
          ? ("stale" as const)
          : ("current" as const);
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

/** The declarations a filter shows, in a stable order. */
export function narrativeStoryVisibleEntries(
  entries: readonly NarrativeStoryIndexEntry[],
  directory: StoryDirectory,
  filter: {
    chapterId?: string | undefined;
    groupKey?: string;
    view?: StoryIndexView;
  },
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

/** A relationship's direction or a cognition's subject, target and state. */
export function narrativeStoryConnection(
  t: T,
  entry: NarrativeStoryIndexEntry,
) {
  const endpoint = (ref?: { id: string; version: number }) => {
    const node = entry.endpoints.find(
      (item) => item.id === ref?.id && item.version === ref.version,
    );
    return node
      ? t("story.endpoint", {
          title: node.title,
          version: node.version,
          id: node.id,
        })
      : t("story.endpoint.missing");
  };
  if (entry.classification === "relationship")
    return t("story.connection.relationship", {
      from: endpoint(entry.relationshipEndpoints?.from),
      relation: entry.relation
        ? t(`story.relation.${entry.relation}`)
        : t("story.relation.missing"),
      to: endpoint(entry.relationshipEndpoints?.to),
    });
  if (entry.classification === "cognition") {
    const subject = entry.cognitionSubject;
    return t("story.connection.cognition", {
      subject:
        subject?.kind === "audience"
          ? t("story.subject.audience", { id: subject.id })
          : subject?.kind === "character"
            ? endpoint(subject.node)
            : t("story.subject.missing"),
      target:
        subject?.kind === "audience" || subject?.kind === "character"
          ? endpoint(entry.cognitionTarget)
          : t("story.target.missing"),
      state: entry.knowledgeState
        ? t(`story.knowledge.${entry.knowledgeState}`)
        : t("story.knowledge.missing"),
      order: entry.storyOrder ?? t("story.order.missing"),
    });
  }
  return t("story.connection.node");
}
