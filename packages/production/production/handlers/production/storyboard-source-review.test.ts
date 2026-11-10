import { describe, expect, it } from "vitest";
import {
  EpisodeDevelopmentImpactSchema,
  type StoryboardSourceReview,
  type StoryboardRedoReceipt,
} from "@dramaip/contracts/production";
import { freezeStoryboardSourceReview } from "./storyboard-source-review.js";

function fixture() {
  const ref = () => ({ id: crypto.randomUUID(), version: 0 });
  const projectId = crypto.randomUUID(),
    result = { ...ref(), version: 1 },
    attribution = { ...ref(), version: 1 },
    blockId = crypto.randomUUID(),
    hash = "1".repeat(64),
    record = () => ({ ...ref(), contentHash: hash });
  const sceneRecord = record(),
    first = record(),
    second = record();
  const observation = (actual: typeof first) => ({
    frozen: actual,
    current: { ...actual, retired: false },
    readState: "available",
    change: "same-reference",
  });
  const block = { id: blockId, index: 0, type: "action", contentHash: hash };
  const report = EpisodeDevelopmentImpactSchema.parse({
    result,
    projectId,
    episodeId: "episode",
    isCurrent: true,
    sourceState: "current",
    staleReasons: [],
    script: {
      id: crypto.randomUUID(),
      result: { ...ref(), version: 1 },
      frozenDocumentVersion: 0,
      currentDocumentVersion: 0,
    },
    blockChanges: [],
    shots: [first, second].map((actual, index) => ({
      sceneId: "scene",
      shotId: `shot-${index}`,
      record: { id: actual.id, frozenVersion: 0, currentVersion: 0 },
      associationImpact: "no-observed-change",
      changedBlockIds: [],
      reasonCodes: [],
    })),
    globalReviewReasons: [],
    comparison: "frozen-script-to-actual-document-and-record-versions-v1",
    semanticVerification: "unverified",
    automaticRedo: false,
    snapshotHash: hash,
    attributionImpact: {
      format: "exact-shot-attribution-impact-v1",
      projectId,
      episodeId: "episode",
      attribution,
      storyboard: result,
      isCurrent: true,
      sourceFingerprint: hash,
      associationFingerprint: hash,
      coverage: {
        totalShots: 2,
        associatedShots: 1,
        nodeAssociatedShots: 0,
        associatedBlockCount: 1,
        unassociatedShotIds: ["shot-1"],
      },
      links: [
        {
          index: 0,
          original: {
            sceneId: "scene",
            shotId: "shot-0",
            blockIds: [blockId],
            evidenceId: "evidence",
            matchIndex: 0,
            evidence: {
              sceneId: "scene",
              evidenceId: "evidence",
              source: {
                sourceKind: "chapter",
                sourceId: crypto.randomUUID(),
                sourceVersion: 0,
                fieldPath: "/chapters/source",
                contentHash: hash,
              },
              valuePath: "/content",
              quoteHash: hash,
              quoteCharacters: 1,
              offsetUnit: "utf16-code-unit",
              match: { start: 0, end: 1 },
              attribution: "model-declared",
              matchVerification: "rule",
              semanticVerification: "unverified",
            },
            attribution: "human-declared",
            matchVerification: "rule",
            semanticVerification: "unverified",
          },
          quote: {
            frozenVerified: true,
            readState: "available",
            currentSourceVersion: 0,
            expressionHash: hash,
            currentSliceHash: hash,
            comparison: "same-position-match",
            sourceBlock: null,
            paragraph: null,
          },
          blocks: [
            {
              id: blockId,
              frozen: block,
              current: block,
              readState: "available",
              change: "same-reference",
            },
          ],
          records: {
            scene: observation(sceneRecord),
            shot: observation(first),
          },
          node: null,
          reasonCodes: [],
          associationImpact: "no-observed-change",
        },
      ],
      textIncluded: false,
      semanticVerification: "unverified",
      automaticRedo: false,
    },
  });
  const review: StoryboardSourceReview = {
    format: "explicit-storyboard-source-review-v1",
    attribution,
    impactHash: report.snapshotHash,
    shots: report.shots.map((shot, index) => ({
      sceneId: shot.sceneId,
      shotId: shot.shotId,
      record: { id: shot.record!.id, version: 0 },
      observedState: index ? "unassociated" : "no-observed-change",
      decision: index ? "retain" : "redo",
    })),
    confirmation: {
      originalAttributionReviewed: true,
      currentImpactReviewed: true,
      completeScopeReviewed: true,
      unassociatedScopeReviewed: true,
      unverifiedSemanticsAcknowledged: true,
    },
  };
  const selected: StoryboardRedoReceipt["shots"] = [
    { shotId: "shot-0", recordId: first.id, version: 0 },
  ];
  return { report, review, selected };
}

describe("complete original source impact review", () => {
  it("binds every actual shot and the full observation as body-free unverified metadata", () => {
    const { report, review, selected } = fixture();
    const frozen = freezeStoryboardSourceReview(review, report, selected);
    expect(frozen.receipt.review).toEqual(review);
    expect(frozen.receipt.review.shots[1]!.observedState).toBe("unassociated");
    expect(frozen.receipt.semanticVerification).toBe("unverified");
    expect(
      frozen.policyDependencies.some(
        (entry) => entry.sourceId === review.shots[1]!.record.id,
      ),
    ).toBe(true);
    const changed = structuredClone(report);
    changed.globalReviewReasons.push("additional full-scope observation");
    expect(
      freezeStoryboardSourceReview(review, changed, selected).receipt
        .impactContentHash,
    ).not.toBe(frozen.receipt.impactContentHash);
  });
  it.each([
    "omitted",
    "reordered",
    "duplicate",
    "foreign",
    "state",
    "hash",
    "decision",
  ])("refuses %s rather than reducing the complete reviewed scope", (fault) => {
    const { report, review, selected } = fixture();
    if (fault === "omitted") review.shots.pop();
    if (fault === "reordered") review.shots.reverse();
    if (fault === "duplicate") review.shots[1] = { ...review.shots[0]! };
    if (fault === "foreign") review.shots[1]!.record.id = crypto.randomUUID();
    if (fault === "state")
      review.shots[1]!.observedState = "no-observed-change";
    if (fault === "hash") review.impactHash = "0".repeat(64);
    if (fault === "decision") review.shots[1]!.decision = "redo";
    expect(() =>
      freezeStoryboardSourceReview(review, report, selected),
    ).toThrow();
  });
  it("does not turn an unknown actual scope into safe localization even if all shots are selected", () => {
    const { report, review, selected } = fixture();
    report.shots[1]!.associationImpact = "unresolved";
    report.shots[1]!.reasonCodes = ["mapping-unresolved"];
    review.shots[1]!.observedState = "unresolved";
    review.shots[1]!.decision = "redo";
    selected.push({
      shotId: "shot-1",
      recordId: review.shots[1]!.record.id,
      version: 0,
    });
    expect(() =>
      freezeStoryboardSourceReview(review, report, selected),
    ).toThrow();
  });
  it("requires every mechanically affected shot to be explicitly selected", () => {
    const { report, review, selected } = fixture();
    report.shots[1]!.associationImpact = "affected";
    review.shots[1]!.observedState = "affected";
    expect(() =>
      freezeStoryboardSourceReview(review, report, selected),
    ).toThrow();
    review.shots[1]!.decision = "redo";
    selected.push({
      shotId: "shot-1",
      recordId: review.shots[1]!.record.id,
      version: 0,
    });
    expect(
      freezeStoryboardSourceReview(review, report, selected).receipt.review
        .shots,
    ).toEqual(review.shots);
  });
  it("does not retain unassociated shots as unchanged after an observed source change", () => {
    const { report, review, selected } = fixture();
    report.sourceState = "stale";
    expect(() =>
      freezeStoryboardSourceReview(review, report, selected),
    ).toThrow();
  });
  it.each(["retired-attribution", "changed-version", "missing-record"])(
    "refuses %s without selecting a new original or a new actual record",
    (fault) => {
      const { report, review, selected } = fixture();
      if (fault === "retired-attribution")
        report.attributionImpact!.isCurrent = false;
      if (fault === "changed-version") review.attribution.version++;
      if (fault === "missing-record") report.shots[1]!.record = null;
      expect(() =>
        freezeStoryboardSourceReview(review, report, selected),
      ).toThrow();
    },
  );
});
