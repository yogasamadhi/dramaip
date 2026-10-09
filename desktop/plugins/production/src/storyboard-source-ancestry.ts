import { createHash } from "node:crypto";
import {
  StoryboardSourceReviewReceiptSchema,
  type EpisodeDevelopmentBasis,
  type EpisodeScriptContent,
  type StoryboardSourceReviewReceipt,
} from "@dramaip/contracts/production";
import type {
  FormalEpisodeResult,
  inspectEpisodeFormalAncestry,
} from "./episode-formal-ancestry.js";

type Ancestry = ReturnType<typeof inspectEpisodeFormalAncestry>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class StoryboardSourceAncestryError extends Error {}
function fail(): never {
  throw new StoryboardSourceAncestryError(
    "原分镜双正式来源、新来源人工父链或实际稿件未核全；不将大纲来源支线当作父版本，不推定局部安全。",
  );
}

/** Select only the actual current manuscript's human-confirmation path from
 * the complete, already owner-verified ancestry. This helper cannot verify
 * adoption or snapshots on its own: callers must first run
 * inspectEpisodeFormalAncestry against immutable owner rows, then inspect all
 * original snapshot policy dependencies outside the Production write UOW.
 * No peer reads, author decisions, source eligibility or record CAS occur here.
 */
export function inspectStoryboardSourceAncestry(input: {
  base: FormalEpisodeResult;
  script: FormalEpisodeResult;
  outline: FormalEpisodeResult;
  ancestry: Ancestry;
  document: {
    id: string;
    scriptId: string;
    version: number;
    blocks: unknown;
  };
}) {
  try {
    const { base, script, outline, ancestry, document } = input,
      previousScript = base.basis.request.script,
      previousOutline = base.basis.request.outline;
    if (
      base.content.kind !== "storyboard-package" ||
      !previousScript ||
      !previousOutline ||
      !base.scriptId ||
      !base.episodeRecordId ||
      script.content.kind !== "episode-script" ||
      outline.content.kind !== "episode-outline" ||
      script.projectId !== base.projectId ||
      outline.projectId !== base.projectId ||
      script.episodeId !== base.episodeId ||
      outline.episodeId !== base.episodeId ||
      script.scriptId !== base.scriptId ||
      script.episodeRecordId !== base.episodeRecordId ||
      document.scriptId !== script.scriptId ||
      document.version !== script.scriptDocumentVersion ||
      hash(document.blocks) !== hash(script.content.value.blocks) ||
      (ancestry.documentId !== undefined && ancestry.documentId !== document.id)
    )
      fail();
    const pairs = new Map(ancestry.pairs.map((pair) => [pair.script.id, pair]));
    if (pairs.size !== ancestry.pairs.length) fail();
    const path: Ancestry["pairs"] = [],
      seen = new Set<string>();
    let id = script.id;
    while (true) {
      const pair = pairs.get(id);
      if (
        !pair ||
        seen.has(id) ||
        seen.size >= 1000 ||
        pair.role !== "current-confirmation-chain" ||
        pair.script.projectId !== base.projectId ||
        pair.outline.projectId !== base.projectId ||
        pair.script.episodeId !== base.episodeId ||
        pair.outline.episodeId !== base.episodeId ||
        pair.script.scriptId !== base.scriptId ||
        pair.script.episodeRecordId !== base.episodeRecordId ||
        pair.script.content.kind !== "episode-script" ||
        pair.outline.content.kind !== "episode-outline" ||
        pair.script.basis.request.outline?.id !== pair.outline.id ||
        pair.script.basis.request.outline.version !== pair.outline.version
      )
        fail();
      seen.add(id);
      path.push(pair);
      if (
        path.length === 1 &&
        (hash(pair.script) !== hash(script) ||
          hash(pair.outline) !== hash(outline))
      )
        fail();
      if (id === previousScript.id) {
        if (
          pair.script.version !== previousScript.version ||
          pair.outline.id !== previousOutline.id ||
          pair.outline.version !== previousOutline.version ||
          pair.script.scriptDocumentVersion !== base.scriptDocumentVersion
        )
          fail();
        break;
      }
      const parents = ancestry.edges.filter((edge) => edge.from === id);
      // Even a fully verified model-outline provenance edge is not an in-place
      // parent and cannot be used to turn a replacement manuscript into a redo.
      if (
        parents.length !== 1 ||
        parents[0]!.kind !== "human-confirmation-parent" ||
        ![
          "human-script-revision",
          "human-topology-revision",
          "human-source-revision",
        ].includes(pair.script.origin ?? "model")
      )
        fail();
      id = parents[0]!.to;
    }
    const sourceSteps = path
      .slice(0, -1)
      .filter((pair) => pair.script.origin === "human-source-revision").length;
    if (sourceSteps && !ancestry.documentId) fail();

    // Accumulate identities over the entire actual path, not only adjacent
    // versions. Removal/reintroduction and a move that is later undone must
    // not erase an earlier cross-scene identity violation.
    const owners = new Map<string, string>(),
      headings = new Map<string, string>();
    for (const pair of [...path].reverse()) {
      const content = pair.script.content.value as EpisodeScriptContent;
      for (const link of content.sceneLinks) {
        const heading = link.blockIds[0];
        if (
          !heading ||
          (headings.has(link.sceneId) && headings.get(link.sceneId) !== heading)
        )
          fail();
        headings.set(link.sceneId, heading);
        for (const blockId of link.blockIds) {
          if (owners.has(blockId) && owners.get(blockId) !== link.sceneId)
            fail();
          owners.set(blockId, link.sceneId);
        }
      }
    }
    const last = path.at(-1)!;
    const references: EpisodeDevelopmentBasis["references"] = path.flatMap(
      (pair) =>
        [pair.script, pair.outline].map((value) => ({
          sourceKind: "production" as const,
          sourceId: value.id,
          sourceVersion: value.version,
          fieldPath: `/production/${value.id}`,
          contentHash: hash(value.content.value),
        })),
    );
    return {
      old: last.script,
      oldOutline: last.outline,
      sourceSteps,
      topologySteps: path
        .slice(0, -1)
        .filter(
          (pair) =>
            pair.script.origin === "human-topology-revision" ||
            pair.script.origin === "human-source-revision",
        ).length,
      // Oldest new confirmation first; callers retain each redo mode's own
      // unchanged-map/block/shot/topology plan admission and patch rules.
      confirmedAncestors: path
        .slice(0, -1)
        .reverse()
        .map((pair) => pair.script.content.value as EpisodeScriptContent),
      confirmedRefs: [
        ...new Map(
          references.map((reference) => [reference.sourceId, reference]),
        ).values(),
      ],
    };
  } catch (error) {
    if (error instanceof StoryboardSourceAncestryError) throw error;
    fail();
  }
}

/** Write admission additionally requires the exact original-board review.
 * The read-only selector above never creates or substitutes author approval. */
export function inspectReviewedStoryboardSourceAncestry(
  input: Parameters<typeof inspectStoryboardSourceAncestry>[0] & {
    review: StoryboardSourceReviewReceipt;
  },
) {
  try {
    const review = StoryboardSourceReviewReceiptSchema.parse(input.review);
    if (
      review.projectId !== input.base.projectId ||
      review.episodeId !== input.base.episodeId ||
      review.storyboard.id !== input.base.id ||
      review.storyboard.version !== input.base.version
    )
      fail();
    return inspectStoryboardSourceAncestry(input);
  } catch (error) {
    if (error instanceof StoryboardSourceAncestryError) throw error;
    fail();
  }
}
