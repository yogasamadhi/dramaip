import type { Chapter, WritingResource } from "@dramaip/contracts/writing";

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** The chapter outlines among a project's outlines, in reading order. */
function chapterOutlines(
  outlines: readonly WritingResource[],
): WritingResource[] {
  return outlines
    .filter((item) => text(item.payload["大纲层级"]) === "章节")
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = Number(a.item.payload["排序"]);
      const right = Number(b.item.payload["排序"]);
      const ordered = Number.isFinite(left) && Number.isFinite(right);
      return ordered && left !== right ? left - right : a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * The chapter outline written for the chapter at `position` (0-based, in
 * reading order): the one whose 排序 is position + 1, or else the n-th
 * chapter outline when the outlines carry no order.
 * @param outlines - the project's outlines of every level.
 * @param position - the chapter's place among the project's chapters.
 */
export function chapterOutlineFor(
  outlines: readonly WritingResource[],
  position: number,
): WritingResource | undefined {
  if (position < 0) return undefined;
  const ordered = chapterOutlines(outlines);
  return (
    ordered.find((item) => Number(item.payload["排序"]) === position + 1) ??
    (ordered.every((item) => !Number.isFinite(Number(item.payload["排序"])))
      ? ordered[position]
      : undefined)
  );
}

/** The outline's text: its 内容, or its title when that is all it has. */
export function outlineText(outline: WritingResource): string {
  return text(outline.payload["内容"]) || text(outline.payload["概要"]);
}

const KEY_POINTS = [
  ["outline", "本章大纲"],
  ["mainConflict", "主要冲突"],
  ["hook", "开篇钩子"],
  ["highlight", "高光看点"],
  ["reversal", "反转"],
  ["cliffhanger", "章末悬念"],
] as const;

/**
 * What the author planned for this chapter, as prompt lines: the chapter's
 * own key points, and the matching chapter outline when the chapter has no
 * outline of its own. Empty when nothing was planned.
 */
export function chapterKeyPoints(
  chapter: Pick<Chapter, (typeof KEY_POINTS)[number][0] | "title">,
  outline: WritingResource | undefined,
): string {
  const lines = KEY_POINTS.flatMap(([key, label]) => {
    const value = text(chapter[key]);
    return value ? [`- ${label}：${value}`] : [];
  });
  if (!text(chapter.outline) && outline) {
    const planned = outlineText(outline);
    if (planned || outline.title)
      lines.unshift(
        `- 本章大纲（${outline.title}）：${planned || outline.title}`,
      );
  }
  return lines.length
    ? `本章要点（作者为这一章做的规划，正文要落实这些要点，不要提前写后面章节的内容）：\n${lines.join("\n")}`
    : "";
}
