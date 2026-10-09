import { creationReference } from "@dramaip/contracts/creation";
import {
  EpisodeUpstreamConstraintsSchema,
  type EpisodeDevelopmentBasis,
} from "@dramaip/contracts/production";
import { episodeBibleReferences } from "./narrative-sources.js";

type Basis = Pick<
  EpisodeDevelopmentBasis,
  | "request"
  | "authorIntent"
  | "diagnosis"
  | "strategy"
  | "references"
  | "sourceBasis"
>;

/** Existing adopted results only: compare the complete original shared values.
 * This is not a new generation/adoption authority, semantic approval, a parent
 * source-state override, or permission to replace a historical reference. */
export function frozenEpisodeSharedInputsMatch(basis: Basis, raw: unknown) {
  if (
    basis.request.direct ||
    !basis.request.episodeNarrativeContext ||
    !basis.sourceBasis ||
    !basis.request.seasonPlan ||
    !basis.diagnosis
  )
    return false;
  const parsed = EpisodeUpstreamConstraintsSchema.safeParse(raw);
  if (!parsed.success) return false;
  const value = parsed.data;
  const expected = new Map([
    ["season-plan", basis.request.seasonPlan],
    ["adaptation-diagnosis", basis.diagnosis],
    ["author-intent", basis.authorIntent],
    ...(basis.strategy
      ? [["adaptation-strategy", basis.strategy] as const]
      : []),
  ]);
  const ordinary = value.items.filter((item) => item.kind !== "story-bible");
  if (
    ordinary.length !== expected.size ||
    ordinary.some((item) => !expected.has(item.kind)) ||
    value.approvedStoryBible.readState !== "available"
  )
    return false;
  const bibles = episodeBibleReferences(basis);
  if (
    value.approvedStoryBible.frozenCount !== bibles.length ||
    value.approvedStoryBible.currentCount !== bibles.length
  )
    return false;
  return value.items.every((item) => {
    const ref =
      item.kind === "story-bible"
        ? bibles.find((ref) => ref.sourceId === item.frozen?.id)
        : expected.get(item.kind);
    if (
      !ref ||
      !item.frozen ||
      !item.current ||
      item.readState !== "available" ||
      item.change !== "same-reference" ||
      (item.kind !== "story-bible" &&
        !["current", "stale"].includes(item.currentSourceState ?? "unverified"))
    )
      return false;
    const original =
      item.kind === "story-bible"
        ? (ref as (typeof bibles)[number])
        : (() => {
            const identity = creationReference(
              item.kind,
              ref as { id: string; version: number },
            );
            const matches = basis.references.filter(
              (reference) =>
                reference.sourceKind === identity.sourceKind &&
                reference.sourceId === identity.sourceId &&
                reference.sourceVersion === identity.sourceVersion &&
                reference.fieldPath === identity.fieldPath,
            );
            return matches.length === 1 ? matches[0] : undefined;
          })();
    return (
      !!original &&
      original.sourceId === item.frozen.id &&
      original.sourceVersion === item.frozen.version &&
      item.frozen.contentHash !== null &&
      original.contentHash === item.frozen.contentHash &&
      item.current.contentHash === item.frozen.contentHash
    );
  });
}
