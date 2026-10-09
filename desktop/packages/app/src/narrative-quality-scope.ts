import type {
  NarrativeQualityRequest,
  NarrativeQualityCatalog,
} from "@dramaip/contracts/creative-quality";
import { NarrativeContextRequestSchema } from "@dramaip/contracts/creation";

export const QUALITY_DIMENSION_LABELS: Record<
  NarrativeQualityRequest["dimensions"][number],
  string
> = {
  "author-intent": "作者意图",
  "character-knowledge": "人物认知",
  relationships: "人物关系",
  timeline: "时间线",
  causality: "因果",
  foreshadowing: "伏笔",
  repetition: "重复",
  pacing: "节奏",
  dialogue: "对白",
  "production-risk": "可选制作风险",
};

export function sameQualityTarget(
  left: NarrativeQualityRequest["target"],
  right: NarrativeQualityRequest["target"],
): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version &&
    left.sourceFingerprint === right.sourceFingerprint
  );
}

export function sameQualityRequest(
  left: NarrativeQualityRequest | undefined,
  right: NarrativeQualityRequest | undefined,
): boolean {
  if (!left || !right || !sameQualityTarget(left.target, right.target))
    return false;
  const leftDimensions = new Set(left.dimensions);
  const rightDimensions = new Set(right.dimensions);
  const leftScope = left.chapterScope;
  const rightScope = right.chapterScope;
  if (Boolean(leftScope) !== Boolean(rightScope)) return false;
  if (
    JSON.stringify(
      left.context ? NarrativeContextRequestSchema.parse(left.context) : null,
    ) !==
    JSON.stringify(
      right.context ? NarrativeContextRequestSchema.parse(right.context) : null,
    )
  )
    return false;
  if (
    leftScope &&
    rightScope &&
    (leftScope.mode !== rightScope.mode ||
      leftScope.directoryFingerprint !== rightScope.directoryFingerprint ||
      leftScope.chapters.length !== rightScope.chapters.length ||
      leftScope.chapters.some(
        (chapter, index) =>
          chapter.id !== rightScope.chapters[index]?.id ||
          chapter.version !== rightScope.chapters[index]?.version,
      ))
  )
    return false;
  return (
    leftDimensions.size === rightDimensions.size &&
    [...leftDimensions].every((dimension) => rightDimensions.has(dimension))
  );
}

export function isQualityRequestCurrent(
  request: NarrativeQualityRequest | undefined,
  catalog: NarrativeQualityCatalog | undefined,
): boolean {
  if (
    !request ||
    !catalog?.targets.some((item) =>
      sameQualityTarget(item.target, request.target),
    )
  )
    return false;
  if (request.target.kind !== "chapter-set") return !request.chapterScope;
  const scope = request.chapterScope;
  const source = catalog.chapterSet;
  if (!scope || !source || !sameQualityTarget(request.target, source.target))
    return false;
  const selected = source.chapters.filter((chapter) =>
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
    (scope.directoryFingerprint === source.directoryFingerprint &&
      selected.length ===
        source.chapters.filter((chapter) => chapter.hasContent).length)
  );
}
