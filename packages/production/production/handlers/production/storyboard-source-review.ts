import { createHash } from "node:crypto";
import {
  StoryboardSourceReviewSchema,
  StoryboardSourceReviewReceiptSchema,
  type EpisodeDevelopmentImpact,
  type StoryboardSourceReview,
  type StoryboardRedoReceipt,
} from "@dramaip/contracts/production";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class StoryboardSourceReviewError extends Error {}
function fail(): never {
  throw new StoryboardSourceReviewError(
    "原关联、本次完整影响观察或逐镜头明确决定不符；不推定安全、补最新或缩小未知范围。",
  );
}

/** The report must come from the actual public owner reads now, outside the
 * Production write UOW. This binds author review; it does not relax ancestry,
 * source eligibility, actual-field CAS or the existing redo modes. */
export function freezeStoryboardSourceReview(
  input: StoryboardSourceReview,
  report: EpisodeDevelopmentImpact,
  selected: StoryboardRedoReceipt["shots"],
) {
  const review = StoryboardSourceReviewSchema.parse(input),
    association = report.attributionImpact;
  if (
    !report.isCurrent ||
    !association?.isCurrent ||
    association.projectId !== report.projectId ||
    association.episodeId !== report.episodeId ||
    association.storyboard.id !== report.result.id ||
    association.storyboard.version !== report.result.version ||
    association.attribution.id !== review.attribution.id ||
    association.attribution.version !== review.attribution.version ||
    report.snapshotHash !== review.impactHash ||
    report.shots.length !== review.shots.length ||
    association.coverage.totalShots !== report.shots.length ||
    new Set(report.shots.map((shot) => shot.shotId)).size !==
      report.shots.length ||
    new Set(selected.map((shot) => shot.shotId)).size !== selected.length
  )
    fail();
  const selectedById = new Map(selected.map((shot) => [shot.shotId, shot]));
  const policyDependencies = [
    {
      sourceId: review.attribution.id,
      sourceVersion: review.attribution.version,
      fieldPath: `/production/${review.attribution.id}`,
    },
  ];
  for (const [index, shot] of report.shots.entries()) {
    const decision = review.shots[index]!,
      links = association.links.filter(
        (link) => link.original.shotId === shot.shotId,
      ),
      unknown =
        shot.associationImpact === "unresolved" ||
        links.some((link) => link.associationImpact === "unresolved"),
      affected =
        shot.associationImpact === "affected" ||
        links.some((link) => link.associationImpact === "affected"),
      state = unknown
        ? "unresolved"
        : affected
          ? "affected"
          : !links.length
            ? "unassociated"
            : "no-observed-change",
      selectedShot = selectedById.get(shot.shotId);
    if (
      !shot.record ||
      shot.record.currentVersion === null ||
      shot.sceneId !== decision.sceneId ||
      shot.shotId !== decision.shotId ||
      shot.record.id !== decision.record.id ||
      shot.record.currentVersion !== decision.record.version ||
      state !== decision.observedState ||
      Boolean(selectedShot) !== (decision.decision === "redo") ||
      (selectedShot &&
        (selectedShot.recordId !== decision.record.id ||
          selectedShot.version !== decision.record.version)) ||
      unknown ||
      (affected && decision.decision !== "redo") ||
      // Unassociated is not unchanged. After any observed source change,
      // retaining that uncovered scope cannot be justified as localized safe.
      (!links.length &&
        report.sourceState !== "current" &&
        decision.decision !== "redo")
    )
      fail();
    policyDependencies.push({
      sourceId: decision.record.id,
      sourceVersion: decision.record.version,
      fieldPath: `/production/${decision.record.id}`,
    });
    for (const link of links) {
      const source = link.original.evidence.source;
      policyDependencies.push({
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        fieldPath: source.fieldPath,
      });
      if (link.original.storyNode)
        for (const [reference, fieldPath] of [
          [
            link.original.storyNode.node,
            `/story-declarations/nodes/${link.original.storyNode.node.id}`,
          ],
          [
            link.original.storyNode.declaration,
            `/story-declarations/${link.original.storyNode.declaration.id}`,
          ],
        ] as const)
          policyDependencies.push({
            sourceId: reference.id,
            sourceVersion: reference.version,
            fieldPath,
          });
    }
  }
  if (
    selected.some(
      (shot) => !report.shots.some((actual) => actual.shotId === shot.shotId),
    )
  )
    fail();
  return {
    receipt: StoryboardSourceReviewReceiptSchema.parse({
      format: "frozen-storyboard-source-review-v1",
      projectId: report.projectId,
      episodeId: report.episodeId,
      storyboard: report.result,
      review,
      sourceFingerprint: association.sourceFingerprint,
      associationFingerprint: association.associationFingerprint,
      impactContentHash: hash(report),
      scopeHash: hash({ shots: review.shots, selected }),
      semanticVerification: "unverified",
    }),
    policyDependencies: [
      ...new Map(
        policyDependencies.map((value) => [JSON.stringify(value), value]),
      ).values(),
    ],
  };
}
