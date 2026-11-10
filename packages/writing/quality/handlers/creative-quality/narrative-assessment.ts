import type {
  NarrativeQualityReport,
  NarrativeQualityRequest,
  NarrativeQualityAssessment,
  NarrativeQualitySummary,
} from "@dramaip/contracts/creative-quality";

export function summarizeNarrativeReport(
  value: NarrativeQualityReport,
): NarrativeQualitySummary {
  return {
    id: value.id,
    projectId: value.projectId,
    workflowId: value.workflowId,
    version: value.version,
    status: value.status,
    isCurrent: value.isCurrent,
    sourceState: value.sourceState,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    request: value.basis.request,
    openIssueCount: value.content.issues.filter(
      (issue) =>
        !value.dispositions.some(
          (decision) =>
            decision.issueId === issue.id && decision.state !== "open",
        ),
    ).length,
    blockerCount: value.blockers.length,
    acceptedRiskCount: value.dispositions.filter(
      (decision) => decision.state === "accepted-risk",
    ).length,
  };
}

/** Aggregate all valid adopted reports, not only the newest head. No semantic guarantee. */
export function assessNarrativeReports(
  target: NarrativeQualityRequest["target"],
  dimensions: NarrativeQualityRequest["dimensions"],
  values: NarrativeQualityReport[],
): NarrativeQualityAssessment {
  const reports = values.filter(
    (value) =>
      value.status === "adopted" &&
      value.sourceState === "current" &&
      value.basis.request.target.kind === target.kind &&
      value.basis.request.target.id === target.id &&
      value.basis.request.target.version === target.version &&
      value.basis.request.target.sourceFingerprint === target.sourceFingerprint,
  );
  const requiredDimensions = [...new Set(dimensions)];
  const reviewedDimensions = requiredDimensions.filter((dimension) =>
    reports.some(
      (report) =>
        // Selected subsets retain known problems but cannot stand in for full-book coverage.
        (target.kind !== "chapter-set" ||
          (report.basis.request.chapterScope?.mode === "full" &&
            (!report.basis.sourceBasis ||
              report.basis.chapterCoverage?.included.every((chapter) =>
                chapter.representations?.includes("original"),
              )))) &&
        report.content.reviewedDimensions.includes(dimension),
    ),
  );
  const missingDimensions = requiredDimensions.filter(
    (dimension) => !reviewedDimensions.includes(dimension),
  );
  const blockers = reports.flatMap((report) =>
    report.content.issues
      .filter(
        (issue) =>
          issue.severity === "error" && report.blockers.includes(issue.id),
      )
      .map((issue) => ({
        reportId: report.id,
        issueId: issue.id,
        category: issue.category,
      })),
  );
  const acceptedRiskCount = reports.reduce(
    (count, report) =>
      count +
      report.dispositions.filter(
        (decision) => decision.state === "accepted-risk",
      ).length,
    0,
  );
  return {
    target,
    requiredDimensions,
    reviewedDimensions,
    missingDimensions,
    reports: reports
      .map((report) => ({ id: report.id, version: report.version }))
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
  };
}
