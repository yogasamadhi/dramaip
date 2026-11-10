import type { CreationStartInput } from "@dramaip/automation-automation/types";
import type { AuthorIntentsSourcesResult } from "@dramaip/workspace-workspace/types";

export type AuthorIntentCreationRequest = NonNullable<
  CreationStartInput["authorIntentRequest"]
>;
export type AuthorIntentCreationSource =
  AuthorIntentCreationRequest["sources"][number];
export type NarrativeContextRequest = NonNullable<
  AuthorIntentCreationRequest["context"]
>;

/** Why a source confirmation was refused. */
export type RequestError = "duplicate" | "missing" | "context" | "sources";

/** The same frozen source: identity, version, hash and script document. */
export function sameAuthorIntentCreationSource(
  a: AuthorIntentCreationSource,
  b: AuthorIntentCreationSource,
): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.version === b.version &&
    a.contentHash === b.contentHash &&
    (a.kind !== "script" ||
      (b.kind === "script" && a.documentVersion === b.documentVersion))
  );
}

const unique = (keys: readonly string[]) => new Set(keys).size === keys.length;

/**
 * A context request within its limits and without a repeated chapter,
 * summary, paragraph or story selection; the owner checks it again.
 */
function wellFormedContext(context: NarrativeContextRequest): boolean {
  return (
    context.format === "narrative-context-v1" &&
    context.chapters.length <= 2000 &&
    (context.summaries?.length ?? 0) <= 100 &&
    (context.story?.length ?? 0) <= 200 &&
    unique(context.chapters.map((chapter) => chapter.id)) &&
    unique((context.summaries ?? []).map((summary) => summary.id)) &&
    unique((context.story ?? []).map((item) => `${item.kind}:${item.id}`)) &&
    context.chapters.every(
      (chapter) =>
        chapter.representation !== "paragraphs" ||
        (chapter.paragraphIds.length >= 1 &&
          chapter.paragraphIds.length <= 500 &&
          chapter.paragraphIds.every(Boolean) &&
          unique(chapter.paragraphIds)),
    )
  );
}

/**
 * The exact sources the author confirmed, in catalog order. Explicit
 * confirmation only: missing ids, duplicates or a scope past its limit are
 * refused, never ignored or truncated. The owner checks the request again.
 */
export function confirmAuthorIntentCreationRequest(
  catalog: AuthorIntentsSourcesResult,
  selectedIds: readonly string[],
  context?: NarrativeContextRequest,
): { request: AuthorIntentCreationRequest } | { error: RequestError } {
  if (new Set(selectedIds).size !== selectedIds.length)
    return { error: "duplicate" };
  if (
    selectedIds.some(
      (id) => !catalog.items.some((item) => item.source.id === id),
    )
  )
    return { error: "missing" };
  const sources = catalog.items
    .filter((item) => selectedIds.includes(item.source.id))
    .map((item) => item.source);
  const chapters = sources.filter((source) => source.kind === "chapter");
  const scripts = sources.filter((source) => source.kind === "script");
  const invalid = context
    ? !chapters.length ||
      !wellFormedContext(context) ||
      sources.length > 2000 ||
      scripts.length > 100 ||
      context.chapters.some(
        (selected) =>
          !chapters.some(
            (source) =>
              source.id === selected.id && source.version === selected.version,
          ),
      ) ||
      context.chapters.reduce(
        (sum, item) =>
          sum +
          (item.representation === "paragraphs" ? item.paragraphIds.length : 1),
        0,
      ) +
        (context.summaries?.length ?? 0) +
        (context.story?.length ?? 0) >
        10000
    : sources.length > 100;
  if (invalid) return { error: context ? "context" : "sources" };
  return {
    request: {
      ...(context ? { context } : {}),
      projectVersion: catalog.projectVersion,
      ...(catalog.baseAdoptedId === undefined
        ? {}
        : { baseAdoptedId: catalog.baseAdoptedId }),
      sources,
    },
  };
}

/**
 * Two frozen snapshots are the same: member order is not a change, array
 * order and every value are; absent optional fields are not invented.
 */
export function sameFrozenSnapshot(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  );
}

/** A link names an id twice or blank; nothing nearest stands in for it. */
export function ambiguousNavigation(
  params: URLSearchParams,
  keys: readonly string[],
): boolean {
  return keys.some((key) => {
    const values = params.getAll(key);
    return values.length > 1 || values.some((value) => !value.trim());
  });
}
