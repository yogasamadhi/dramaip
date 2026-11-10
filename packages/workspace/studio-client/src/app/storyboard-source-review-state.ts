import {
  EpisodeDevelopmentImpactSchema,
  StoryboardSourceReviewSchema,
  type EpisodeDevelopmentImpact,
  type StoryboardSourceReview,
  type StoryboardAttributionImpactSelection,
} from "@dramaip/contracts/production";
import {
  episodeImpactIdentityMatches,
  type EpisodeImpactReference,
} from "./episode-impact-view";
import { sameFrozenOwnerSnapshot } from "./current-owner-read";

export const sourceReviewConfirmations = {
  originalAttributionReviewed: "我已核对明确的原关联身份与版本",
  currentImpactReviewed: "我已审阅本次完整实际影响观察",
  completeScopeReviewed: "我已逐一决定全部实际镜头的重做或保留",
  unassociatedScopeReviewed: "我已单独核对未关联范围，未将其当作未变化",
  unverifiedSemanticsAcknowledged: "我知悉机械观察与作者确认不证明语义安全",
} satisfies Record<keyof StoryboardSourceReview["confirmation"], string>;
export type SourceReviewDraft = {
  decisions: Record<string, "redo" | "retain">;
  confirmation: Partial<
    Record<keyof StoryboardSourceReview["confirmation"], boolean>
  >;
};
export type StoryboardSourceReviewFrame = {
  reference: EpisodeImpactReference;
  scopeKey: string;
  report: EpisodeDevelopmentImpact;
  review: StoryboardSourceReview;
};
export function sourceReviewShotState(
  report: EpisodeDevelopmentImpact,
  shot: EpisodeDevelopmentImpact["shots"][number],
): StoryboardSourceReview["shots"][number]["observedState"] {
  const links =
    report.attributionImpact?.links.filter(
      (link) => link.original.shotId === shot.shotId,
    ) ?? [];
  return shot.associationImpact === "unresolved" ||
    links.some((link) => link.associationImpact === "unresolved")
    ? "unresolved"
    : shot.associationImpact === "affected" ||
        links.some((link) => link.associationImpact === "affected")
      ? "affected"
      : !links.length
        ? "unassociated"
        : "no-observed-change";
}
const fail = (): never => {
  throw new Error(
    "原关联、完整当前观察、全部镜头决定或五项审阅尚未核全；不会补最新、推定安全或缩小范围。",
  );
};
export function freezeStoryboardSourceReviewFrame(
  reference: EpisodeImpactReference,
  attribution: StoryboardAttributionImpactSelection,
  reportInput: EpisodeDevelopmentImpact,
  selectedShotIds: readonly string[],
  draft: SourceReviewDraft,
  scopeKey: string,
): StoryboardSourceReviewFrame {
  const report = EpisodeDevelopmentImpactSchema.parse(reportInput);
  if (
    !episodeImpactIdentityMatches(reference, report, attribution) ||
    !report.isCurrent ||
    !report.attributionImpact?.isCurrent ||
    report.attributionImpact.coverage.totalShots !== report.shots.length ||
    new Set(selectedShotIds).size !== selectedShotIds.length ||
    new Set(report.shots.map((shot) => shot.shotId)).size !==
      report.shots.length ||
    Object.keys(draft.decisions).length !== report.shots.length ||
    selectedShotIds.some(
      (id) => !report.shots.some((shot) => shot.shotId === id),
    )
  )
    fail();
  const selected = new Set(selectedShotIds);
  const shots = report.shots.map((shot) => {
    const state = sourceReviewShotState(report, shot),
      decision = draft.decisions[shot.shotId];
    if (
      !shot.record ||
      shot.record.currentVersion === null ||
      !decision ||
      selected.has(shot.shotId) !== (decision === "redo") ||
      state === "unresolved" ||
      (state === "affected" && decision !== "redo") ||
      (state === "unassociated" &&
        report.sourceState !== "current" &&
        decision !== "redo")
    )
      fail();
    return {
      sceneId: shot.sceneId,
      shotId: shot.shotId,
      record: { id: shot.record!.id, version: shot.record!.currentVersion! },
      observedState: state,
      decision,
    };
  });
  return {
    reference: {
      id: reference.id,
      version: reference.version,
      projectId: reference.projectId,
      episodeId: reference.episodeId,
    },
    scopeKey,
    report,
    review: StoryboardSourceReviewSchema.parse({
      format: "explicit-storyboard-source-review-v1",
      attribution,
      impactHash: report.snapshotHash,
      shots,
      confirmation: draft.confirmation,
    }),
  };
}
export function currentStoryboardSourceReviewFrame(
  frame: StoryboardSourceReviewFrame | undefined,
  reference: EpisodeImpactReference | undefined,
  selectedShotIds: readonly string[],
  scopeKey: string,
) {
  if (
    !frame ||
    !reference ||
    frame.scopeKey !== scopeKey ||
    !sameFrozenOwnerSnapshot(frame.reference, {
      id: reference.id,
      version: reference.version,
      projectId: reference.projectId,
      episodeId: reference.episodeId,
    })
  )
    return undefined;
  try {
    const actual = freezeStoryboardSourceReviewFrame(
      reference,
      frame.review.attribution,
      frame.report,
      selectedShotIds,
      {
        decisions: Object.fromEntries(
          frame.review.shots.map((shot) => [shot.shotId, shot.decision]),
        ),
        confirmation: frame.review.confirmation,
      },
      scopeKey,
    );
    return sameFrozenOwnerSnapshot(actual.review, frame.review)
      ? frame
      : undefined;
  } catch {
    return undefined;
  }
}
/** A repeated hash alone cannot certify a newly read complete owner report. */
export function matchesStoryboardSourceReviewObservation(
  frame: StoryboardSourceReviewFrame,
  report: EpisodeDevelopmentImpact,
) {
  return sameFrozenOwnerSnapshot(frame.report, report);
}
