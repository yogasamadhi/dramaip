import {
  NarrativePlanningRequestSchema,
  narrativePlanningDirectory,
  type NarrativePlanningRequest,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";

export async function planningDirectoryFingerprint(
  chapters: readonly Chapter[],
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(narrativePlanningDirectory(chapters)),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function samePlanningRequest(
  left: NarrativePlanningRequest | undefined,
  right: NarrativePlanningRequest | undefined,
): boolean {
  if (!left || !right) return false;
  const a = NarrativePlanningRequestSchema.safeParse(left);
  const b = NarrativePlanningRequestSchema.safeParse(right);
  return (
    a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data)
  );
}

/** This only checks current local metadata, not summary adoption or privacy. */
export function isPlanningRequestCurrent(
  request: NarrativePlanningRequest | undefined,
  chapters: readonly Chapter[],
  directoryFingerprint: string | undefined,
): boolean {
  if (!request || !NarrativePlanningRequestSchema.safeParse(request).success)
    return false;
  const scope = request.chapterScope;
  if (scope.mode === "none") return true;
  const directory = narrativePlanningDirectory(chapters);
  const selected = directory.filter((chapter) =>
    scope.chapters.some((ref) => ref.id === chapter.id),
  );
  if (
    selected.length !== scope.chapters.length ||
    selected.some(
      (chapter, index) =>
        !chapter.hasContent ||
        chapter.id !== scope.chapters[index]?.id ||
        chapter.version !== scope.chapters[index]?.version,
    )
  )
    return false;
  return (
    scope.mode === "selection" ||
    (scope.directoryFingerprint === directoryFingerprint &&
      selected.length ===
        directory.filter((chapter) => chapter.hasContent).length)
  );
}
