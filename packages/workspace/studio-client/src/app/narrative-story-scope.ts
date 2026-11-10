import type { Chapter } from "@dramaip/contracts/writing";
import type {
  NarrativeStoryIndexEntry,
  NarrativeStorySelection,
} from "@dramaip/contracts/knowledge";

// An interpretation's source pointers are not an original-text/summary
// representation, and never satisfy whole-chapter coverage by themselves.
export function narrativeStoryScopeReasons(
  entry: NarrativeStoryIndexEntry,
  projectId: string,
  chapters: readonly Pick<
    Chapter,
    "id" | "version" | "projectId" | "content"
  >[],
) {
  const reasons = [...entry.eligibility.reasons];
  if (entry.projectId !== projectId) reasons.push("声明不属于当前项目。");
  if (entry.eligibility.state !== "eligible" && !reasons.length)
    reasons.push("声明尚未通过实际来源核对。");
  if (entry.sourceScripts.length)
    reasons.push("包含剧本来源，不能静默纳入本轮小说章节范围。");
  if (!entry.sourceChapters.length)
    reasons.push("没有本轮章节来源，不当作原著上下文。");
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
    reasons.push(
      "包含未确认范围、当前章／后文或旧章节版本；不能截掉部分来源使用。",
    );
  return reasons;
}
export function sameNarrativeStorySelection(
  left: NarrativeStorySelection,
  right: NarrativeStorySelection,
) {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version
  );
}
