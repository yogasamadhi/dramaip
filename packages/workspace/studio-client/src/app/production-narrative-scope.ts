import {
  ProductionNarrativeRequestSchema,
  narrativePlanningDirectory,
  type ProductionNarrativeRequest,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import { sameFrozenOwnerSnapshot } from "./current-owner-read";

export function sameProductionNarrativeRequest(
  left: ProductionNarrativeRequest | undefined,
  right: ProductionNarrativeRequest | undefined,
): boolean {
  if (!left || !right) return false;
  const a = ProductionNarrativeRequestSchema.safeParse(left),
    b = ProductionNarrativeRequestSchema.safeParse(right);
  return a.success && b.success && sameFrozenOwnerSnapshot(a.data, b.data);
}

/** Local directory metadata only. Adoption heads, privacy and budget need owners. */
export function isProductionNarrativeRequestCurrent(
  request: ProductionNarrativeRequest | undefined,
  chapters: readonly Chapter[],
  fingerprint: string | undefined,
): boolean {
  if (!request || !ProductionNarrativeRequestSchema.safeParse(request).success)
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
    (scope.directoryFingerprint === fingerprint &&
      selected.length ===
        directory.filter((chapter) => chapter.hasContent).length)
  );
}
