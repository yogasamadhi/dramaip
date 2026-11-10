import {
  NarrativeLocalQualityAssessmentSchema,
  type NarrativeLocalQualityReview,
  type NarrativeQualityRequest,
} from "@dramaip/contracts/creative-quality";

/** Retain all valid adopted declarations; a structural rule never supplies semantic coverage. */
export function assessLocalNarrativeReviews(
  target: NarrativeQualityRequest["target"],
  dimensions: NarrativeQualityRequest["dimensions"],
  values: NarrativeLocalQualityReview[],
) {
  const reviews = values.filter((value) => {
    const original = value.source.basis.request.target;
    return (
      value.status === "adopted" &&
      value.sourceState === "current" &&
      original.kind === target.kind &&
      original.id === target.id &&
      original.version === target.version &&
      original.sourceFingerprint === target.sourceFingerprint
    );
  });
  const requiredDimensions = [...new Set(dimensions)];
  const reviewedDimensions = requiredDimensions.filter((dimension) =>
    reviews.some(
      (review) =>
        review.origin === "human-declared" &&
        (target.kind !== "chapter-set" ||
          (review.source.basis.request.chapterScope?.mode === "full" &&
            (!review.source.basis.sourceBasis ||
              review.source.basis.chapterCoverage?.included.every((chapter) =>
                chapter.representations?.includes("original"),
              )))) &&
        review.content.reviewedDimensions.includes(dimension),
    ),
  );
  const missingDimensions = requiredDimensions.filter(
    (dimension) => !reviewedDimensions.includes(dimension),
  );
  const blockers = reviews.flatMap((review) =>
    review.origin === "human-declared"
      ? review.content.issues
          .filter(
            (issue) =>
              issue.severity === "error" && review.blockers.includes(issue.id),
          )
          .map((issue) => ({
            reviewId: review.id,
            issueId: issue.id,
            category: issue.category,
          }))
      : [],
  );
  const acceptedRiskCount = reviews.reduce(
    (count, review) =>
      count +
      review.dispositions.filter(
        (decision) => decision.state === "accepted-risk",
      ).length,
    0,
  );
  return NarrativeLocalQualityAssessmentSchema.parse({
    target,
    qualityState: "unverified",
    requiredDimensions,
    reviewedDimensions,
    missingDimensions,
    reviews: reviews
      .map((review) => ({
        id: review.id,
        version: review.version,
        origin: review.origin,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    blockers,
    acceptedRiskCount,
    state: blockers.length
      ? "blocked"
      : missingDimensions.length
        ? "unknown"
        : acceptedRiskCount
          ? "reviewed-with-risk"
          : "reviewed",
  });
}
