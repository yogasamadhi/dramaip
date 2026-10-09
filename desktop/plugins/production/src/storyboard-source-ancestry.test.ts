import { describe, expect, it } from "vitest";
import type {
  EpisodeDevelopmentBasis,
  EpisodeScriptContent,
} from "@dramaip/contracts/production";
import type { FormalEpisodeResult } from "./episode-formal-ancestry.js";
import { inspectReviewedStoryboardSourceAncestry } from "./storyboard-source-ancestry.js";

type Input = Parameters<typeof inspectReviewedStoryboardSourceAncestry>[0];
/** Synthetic verified-graph fixtures exercise path selection only. Actual
 * preview/adoption/snapshot verification remains a separate Kernel obligation.
 */
function fixture(): Input {
  const projectId = crypto.randomUUID(),
    episodeId = crypto.randomUUID(),
    scriptId = crypto.randomUUID(),
    documentId = crypto.randomUUID(),
    ref = () => ({ id: crypto.randomUUID(), version: 1 });
  const blocks: EpisodeScriptContent["blocks"] = [
    { id: crypto.randomUUID(), type: "scene_heading", text: "INT. A - NIGHT" },
    { id: crypto.randomUUID(), type: "action", text: "PRIVATE ACTION A" },
    { id: crypto.randomUUID(), type: "scene_heading", text: "INT. B - NIGHT" },
    { id: crypto.randomUUID(), type: "action", text: "PRIVATE ACTION B" },
  ];
  const content: EpisodeScriptContent = {
    blocks,
    sceneLinks: ["a", "b"].map((sceneId, index) => ({
      sceneId,
      blockIds: blocks.slice(index * 2, index * 2 + 2).map((block) => block.id),
    })),
  };
  const basis: EpisodeDevelopmentBasis = {
    request: {
      episodeId,
      direct: {
        entryPath: "inspiration",
        project: { id: projectId, version: 0 },
        authorIntent: ref(),
        episode: { id: episodeId, version: 0 },
        durationSeconds: 60,
      },
    },
    authorIntent: ref(),
    episode: {
      sourcePath: "direct-script",
      id: episodeId,
      version: 0,
      title: "episode",
      orderIndex: 0,
      durationSeconds: 60,
    },
    chapters: [],
    references: [],
  };
  const outline = (version: number) =>
    ({
      ...ref(),
      version,
      projectId,
      episodeId,
      operation: "episode-outline",
      basis: structuredClone(basis),
      content: {
        kind: "episode-outline",
        value: {
          title: "PRIVATE OUTLINE",
          logline: "求证",
          goal: "求证",
          mainConflict: "未知",
          turningPoint: "行动",
          endingHook: "待核对",
          scenes: ["a", "b"].map((id, orderIndex) => ({
            id,
            orderIndex,
            location: id,
            timeOfDay: "夜",
            goal: "求证",
            conflict: "未知",
            outcome: "行动",
            characters: ["林晚"],
            durationSeconds: 30,
            sourceChapters: [],
            beats: [{ id: `beat-${id}`, action: "求证", causalLink: "因果" }],
          })),
        },
      },
      runIds: [],
      sourceSnapshotId: crypto.randomUUID(),
      adoptedAt: new Date().toISOString(),
    }) as FormalEpisodeResult;
  const oldOutline = outline(1),
    newOutline = outline(2);
  const script = (formalOutline: FormalEpisodeResult, version: number) =>
    ({
      ...ref(),
      version,
      projectId,
      episodeId,
      scriptId,
      episodeRecordId: episodeId,
      scriptDocumentVersion: 0,
      operation: "episode-script",
      basis: {
        ...structuredClone(basis),
        request: {
          ...structuredClone(basis.request),
          outline: { id: formalOutline.id, version: formalOutline.version },
        },
      },
      content: { kind: "episode-script", value: structuredClone(content) },
      runIds: [],
      sourceSnapshotId: crypto.randomUUID(),
      adoptedAt: new Date().toISOString(),
    }) as FormalEpisodeResult;
  const oldScript = script(oldOutline, 1),
    newScript = script(newOutline, 2);
  newScript.origin = "human-source-revision";
  const base = {
    ...script(oldOutline, 1),
    id: crypto.randomUUID(),
    operation: "storyboard-package",
    content: { kind: "storyboard-package", value: {} },
    basis: {
      ...structuredClone(oldScript.basis),
      request: {
        ...structuredClone(oldScript.basis.request),
        script: { id: oldScript.id, version: oldScript.version },
      },
    },
  } as FormalEpisodeResult;
  return {
    base,
    script: newScript,
    outline: newOutline,
    ancestry: {
      pairs: [
        {
          script: newScript,
          outline: newOutline,
          role: "current-confirmation-chain",
        },
        {
          script: oldScript,
          outline: oldOutline,
          role: "current-confirmation-chain",
        },
      ],
      edges: [
        {
          from: newScript.id,
          to: oldScript.id,
          kind: "human-confirmation-parent",
        },
      ],
      sourcePreviews: [],
      previewReferences: [],
      documentId,
      branches: [],
    },
    document: {
      id: documentId,
      scriptId,
      version: 0,
      blocks: structuredClone(blocks),
    },
    review: {
      format: "frozen-storyboard-source-review-v1",
      projectId,
      episodeId,
      storyboard: { id: base.id, version: base.version },
      sourceFingerprint: "1".repeat(64),
      associationFingerprint: "2".repeat(64),
      impactContentHash: "3".repeat(64),
      scopeHash: "4".repeat(64),
      semanticVerification: "unverified",
      review: {
        format: "explicit-storyboard-source-review-v1",
        attribution: ref(),
        impactHash: "5".repeat(64),
        shots: [
          {
            sceneId: "a",
            shotId: "shot-a",
            record: ref(),
            observedState: "affected",
            decision: "redo",
          },
        ],
        confirmation: {
          originalAttributionReviewed: true,
          currentImpactReviewed: true,
          completeScopeReviewed: true,
          unassociatedScopeReviewed: true,
          unverifiedSemanticsAcknowledged: true,
        },
      },
    },
  };
}

describe("reviewed storyboard source confirmation path selection", () => {
  it("selects the exact original pair and all new confirmations without changing owner rows", () => {
    const input = fixture(),
      before = structuredClone(input);
    const result = inspectReviewedStoryboardSourceAncestry(input);
    expect(result.old.id).toBe(input.base.basis.request.script!.id);
    expect(result.oldOutline.id).toBe(input.base.basis.request.outline!.id);
    expect(result.sourceSteps).toBe(1);
    expect(result.topologySteps).toBe(1);
    expect(result.confirmedAncestors).toEqual([input.script.content.value]);
    expect(result.confirmedRefs).toHaveLength(4);
    expect(JSON.stringify(result.confirmedRefs)).not.toContain("PRIVATE");
    expect(input).toEqual(before);
  });
  it.each([
    "review-project",
    "review-episode",
    "review-original",
    "review-version",
    "old-script-version",
    "old-outline-version",
    "old-document-version",
    "document-id",
    "document-version",
    "document-body",
    "record-id",
    "episode-record",
    "new-pair",
    "missing-parent",
    "ambiguous-parent",
    "cycle",
    "duplicate-pair",
    "missing-source-document",
  ] as const)("refuses %s without guessing a new original", (fault) => {
    const input = fixture(),
      original = input.ancestry.pairs[1]!;
    if (fault === "review-project")
      input.review.projectId = crypto.randomUUID();
    if (fault === "review-episode")
      input.review.episodeId = crypto.randomUUID();
    if (fault === "review-original")
      input.review.storyboard.id = crypto.randomUUID();
    if (fault === "review-version") input.review.storyboard.version++;
    if (fault === "old-script-version")
      input.base.basis.request.script!.version++;
    if (fault === "old-outline-version")
      input.base.basis.request.outline!.version++;
    if (fault === "old-document-version")
      input.base.scriptDocumentVersion = input.base.scriptDocumentVersion! + 1;
    if (fault === "document-id") input.document.id = crypto.randomUUID();
    if (fault === "document-version") input.document.version++;
    if (fault === "document-body") input.document.blocks = [];
    if (fault === "record-id") original.script.scriptId = crypto.randomUUID();
    if (fault === "episode-record")
      original.script.episodeRecordId = crypto.randomUUID();
    if (fault === "new-pair")
      input.ancestry.pairs[0] = {
        ...input.ancestry.pairs[0]!,
        script: { ...input.script, version: 99 },
      };
    if (fault === "missing-parent") input.ancestry.edges = [];
    if (fault === "ambiguous-parent")
      input.ancestry.edges.push({ ...input.ancestry.edges[0]! });
    if (fault === "cycle") input.ancestry.edges[0]!.to = input.script.id;
    if (fault === "duplicate-pair")
      input.ancestry.pairs.push(input.ancestry.pairs[0]!);
    if (fault === "missing-source-document")
      input.ancestry.documentId = undefined;
    expect(() => inspectReviewedStoryboardSourceAncestry(input)).toThrow(
      /未核全/u,
    );
  });
  it.each(["model", "outline-provenance"] as const)(
    "does not upgrade %s into the original manuscript's parent",
    (fault) => {
      const input = fixture();
      if (fault === "model") input.script.origin = "model";
      else input.ancestry.edges[0]!.kind = "outline-provenance";
      expect(() => inspectReviewedStoryboardSourceAncestry(input)).toThrow(
        /支线/u,
      );
    },
  );
  it("does not count source confirmation before the original board as a new source transition", () => {
    const input = fixture();
    input.script.origin = "human-script-revision";
    input.ancestry.pairs[1]!.script.origin = "human-source-revision";
    expect(inspectReviewedStoryboardSourceAncestry(input).sourceSteps).toBe(0);
  });
  it("keeps unrelated verified outline provenance out of the local path without discarding it from the full ancestry", () => {
    const input = fixture();
    const branch = structuredClone(input.ancestry.pairs[1]!);
    branch.role = "outline-provenance";
    branch.script.id = crypto.randomUUID();
    branch.script.scriptId = crypto.randomUUID();
    input.ancestry.pairs.push(branch);
    const result = inspectReviewedStoryboardSourceAncestry(input);
    expect(
      result.confirmedRefs.some((ref) => ref.sourceId === branch.script.id),
    ).toBe(false);
    expect(input.ancestry.pairs).toHaveLength(3);
  });
  it("remembers ownership across deletion and later reintroduction, not just adjacent versions", () => {
    const input = fixture(),
      old = input.ancestry.pairs[1]!;
    const middle = structuredClone(old);
    middle.script.id = crypto.randomUUID();
    middle.script.version = 2;
    middle.script.origin = "human-script-revision";
    input.script.version = 3;
    if (
      old.script.content.kind !== "episode-script" ||
      middle.script.content.kind !== "episode-script" ||
      input.script.content.kind !== "episode-script"
    )
      throw new Error("fixture script");
    const removed = old.script.content.value.blocks[1]!,
      replacement = { ...removed, id: crypto.randomUUID() };
    middle.script.content.value.blocks[1] = replacement;
    middle.script.content.value.sceneLinks[0]!.blockIds[1] = replacement.id;
    input.script.content.value.blocks = [
      middle.script.content.value.blocks[0]!,
      replacement,
      ...middle.script.content.value.blocks.slice(2),
      removed,
    ];
    input.script.content.value.sceneLinks[0]!.blockIds[1] = replacement.id;
    input.script.content.value.sceneLinks[1]!.blockIds.push(removed.id);
    input.document.blocks = structuredClone(input.script.content.value.blocks);
    input.ancestry.pairs.splice(1, 0, middle);
    input.ancestry.edges = [
      {
        from: input.script.id,
        to: middle.script.id,
        kind: "human-confirmation-parent",
      },
      {
        from: middle.script.id,
        to: old.script.id,
        kind: "human-confirmation-parent",
      },
    ];
    expect(() => inspectReviewedStoryboardSourceAncestry(input)).toThrow();
  });
});
