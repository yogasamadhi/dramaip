import type { CreationStartInput } from "@dramaip/automation-automation/types";

/** A narrative context request exactly as the owner takes it. */
export type NarrativeContextRequest = NonNullable<
  NonNullable<CreationStartInput["diagnosisRequest"]>["context"]
>;

/** A canonical lower- or upper-case UUID. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A lower-case SHA-256 digest. */
export const HASH = /^[a-f0-9]{64}$/u;

/** A plain object, not an array or null. */
export const isObject = (item: unknown): item is Record<string, unknown> =>
  typeof item === "object" && item !== null && !Array.isArray(item);

/** The object holds no member outside these keys. */
export const onlyKeys = (
  item: Record<string, unknown>,
  keys: readonly string[],
) => Object.keys(item).every((key) => keys.includes(key));

/** An integer at least `min` and at most `max`. */
export const integer = (item: unknown, min: number, max = Infinity) =>
  Number.isInteger(item) && (item as number) >= min && (item as number) <= max;

const unique = (items: readonly string[]) =>
  new Set(items).size === items.length;

/** An `{id, version}` reference with a UUID and a non-negative version. */
export const isRef = (
  item: unknown,
): item is Record<string, unknown> & { id: string; version: number } =>
  isObject(item) &&
  typeof item.id === "string" &&
  UUID.test(item.id) &&
  integer(item.version, 0);

/**
 * A narrative context request exactly as the owner takes it: one entry per
 * chapter and summary, each chapter as its original, a summary record or
 * 1–500 distinct paragraphs, and unique story selections. Anything else,
 * extra members included, is undefined; the owner checks it again.
 */
export function parseNarrativeContext(
  item: unknown,
): NarrativeContextRequest | undefined {
  if (
    !isObject(item) ||
    !onlyKeys(item, ["format", "chapters", "summaries", "story"]) ||
    item.format !== "narrative-context-v1" ||
    !Array.isArray(item.chapters) ||
    item.chapters.length > 2000
  )
    return undefined;
  const chapters = item.chapters.every(
    (chapter: unknown) =>
      isRef(chapter) &&
      isObject(chapter) &&
      ((chapter.representation === "original" &&
        onlyKeys(chapter, ["id", "version", "representation"])) ||
        (chapter.representation === "summary" &&
          onlyKeys(chapter, ["id", "version", "representation", "record"]) &&
          isRef(chapter.record) &&
          onlyKeys(chapter.record as Record<string, unknown>, [
            "id",
            "version",
          ])) ||
        (chapter.representation === "paragraphs" &&
          onlyKeys(chapter, [
            "id",
            "version",
            "representation",
            "paragraphIds",
          ]) &&
          Array.isArray(chapter.paragraphIds) &&
          chapter.paragraphIds.length >= 1 &&
          chapter.paragraphIds.length <= 500 &&
          chapter.paragraphIds.every(
            (id: unknown) => typeof id === "string" && id.length > 0,
          ) &&
          unique(chapter.paragraphIds as string[]))),
  );
  const summaries =
    item.summaries === undefined ||
    (Array.isArray(item.summaries) &&
      item.summaries.length <= 100 &&
      item.summaries.every(
        (summary: unknown) =>
          isRef(summary) &&
          onlyKeys(summary as Record<string, unknown>, ["id", "version"]),
      ));
  const story =
    item.story === undefined ||
    (Array.isArray(item.story) &&
      item.story.length <= 200 &&
      item.story.every(
        (selection: unknown) =>
          isRef(selection) &&
          isObject(selection) &&
          onlyKeys(selection, ["id", "version", "kind"]) &&
          (selection.kind === "declaration" || selection.kind === "assertion"),
      ));
  if (!chapters || !summaries || !story) return undefined;
  const context = item as unknown as NarrativeContextRequest;
  return unique(context.chapters.map((chapter) => chapter.id)) &&
    unique((context.summaries ?? []).map((summary) => summary.id)) &&
    unique((context.story ?? []).map((entry) => `${entry.kind}:${entry.id}`))
    ? context
    : undefined;
}

/**
 * Two frozen snapshots are the same: member order is not a change, array
 * order and every value are; absent optional members are not invented.
 */
export function sameFrozenSnapshot(left: unknown, right: unknown): boolean {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, member]) => member !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, member]) => [key, canonical(member)]),
      );
    return item;
  };
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  );
}
