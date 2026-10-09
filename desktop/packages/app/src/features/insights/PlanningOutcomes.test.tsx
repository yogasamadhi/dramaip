import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NarrativePlanningOperationSchema } from "@dramaip/contracts/creation";
import {
  CreativePlanningAdoptionSummarySchema,
  CreativePlanningFunnelSummarySchema,
} from "@dramaip/contracts/insights";
import { PlanningOutcomes } from "./PlanningOutcomes";
test("missing planning protocol stays unrecorded, never empty counts or default zero adoption", () => {
  const html = renderToStaticMarkup(
    <PlanningOutcomes batches={undefined} funnel={undefined} />,
  );
  expect(html).toContain("旧服务缺失不代表零采用");
  expect(html).toContain("不从当前资料或旧工作流补造分母");
  expect(html).not.toContain("0.0%");
  expect(html).not.toContain("data-planning-batch-workflow-id");
});
test("a current service with no actual planning activity adds no empty planning card to the original ledger", () => {
  const batches = CreativePlanningAdoptionSummarySchema.parse({
    historyPolicy: "recorded-complete-owner-planning-batches-only",
    countingUnit: "adopted-planning-batch-not-individual-records",
    recordedBatches: 0,
    counts: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      batches: 0,
      actualRecords: 0,
    })),
    items: [],
  });
  const funnel = CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: 0,
    measures: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      modelEvidence: "unknown",
      recordedRequests: 0,
      requestedTargets: 0,
      unobservedFirstTargets: 0,
      firstCandidates: 0,
      firstAdopted: 0,
      pendingDecision: 0,
      closedWithoutFirstAdoption: 0,
      revisedAdoption: 0,
      retryCandidates: 0,
      adoptionRejectedCount: 0,
      firstCandidateAdoptionRatio: null,
      firstAccepted: null,
    })),
  });
  expect(
    renderToStaticMarkup(
      <PlanningOutcomes batches={batches} funnel={funnel} />,
    ),
  ).toBe("");
});
test("body-free planning view keeps exact original IDs, full batch count and first-candidate denominator distinct from individual records", () => {
  const id = () => crypto.randomUUID(),
    workflowId = id(),
    candidateId = id(),
    recordId = id(),
    eventId = id(),
    conflictWorkflowId = id(),
    conflictCandidateId = id(),
    sourceId = id();
  const batches = CreativePlanningAdoptionSummarySchema.parse({
    historyPolicy: "recorded-complete-owner-planning-batches-only",
    countingUnit: "adopted-planning-batch-not-individual-records",
    recordedBatches: 1,
    counts: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      batches: operation === "characters" ? 1 : 0,
      actualRecords: operation === "characters" ? 7 : 0,
    })),
    items: [
      {
        owner: "writing",
        eventId,
        cursor: 3,
        occurredAt: "2026-10-04T00:00:00.000Z",
        fact: {
          eventVersion: 1,
          kind: "story.planning-batch-adopted",
          workflowPath: "story-planning",
          projectId: id(),
          workflowId,
          operation: "characters",
          candidate: { id: candidateId, contentFingerprint: "a".repeat(64) },
          records: [recordId, id(), id(), id(), id()].map((id) => ({
            id,
            kind: "characters",
            version: 0,
          })),
          recordCount: 7,
          recordDisplay: "first-five-actual-records",
          sourceVersions: [],
          evidenceKind: "human",
          modelEvidence: "unknown",
          qualityState: "unverified",
          resultStatus: "adopted",
        },
      },
    ],
  });
  const funnel = CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: 0,
    measures: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      modelEvidence: "unknown",
      recordedRequests: operation === "characters" ? 2 : 0,
      requestedTargets: operation === "characters" ? 2 : 0,
      unobservedFirstTargets: 0,
      firstCandidates: operation === "characters" ? 2 : 0,
      firstAdopted: operation === "characters" ? 1 : 0,
      pendingDecision: operation === "characters" ? 1 : 0,
      closedWithoutFirstAdoption: 0,
      revisedAdoption: 0,
      retryCandidates: 0,
      adoptionRejectedCount: operation === "characters" ? 1 : 0,
      sourceConflicts: {
        candidateCount: operation === "characters" ? 1 : 0,
        last:
          operation === "characters"
            ? {
                candidate: {
                  id: conflictCandidateId,
                  contentFingerprint: "b".repeat(64),
                },
                sourceConflict: {
                  projectId: batches.items[0]!.fact.projectId,
                  workflowId: conflictWorkflowId,
                  changes: [
                    {
                      sourceKind: "chapter",
                      frozen: { id: sourceId, version: 2 },
                      current: { id: sourceId, version: 3 },
                    },
                  ],
                },
                eventId: id(),
                cursor: 6,
                occurredAt: "2026-10-04T00:00:01.000Z",
              }
            : null,
      },
      firstCandidateAdoptionRatio: operation === "characters" ? 0.5 : null,
      firstAccepted: null,
    })),
  });
  const html = renderToStaticMarkup(
    <PlanningOutcomes batches={batches} funnel={funnel} />,
  );
  for (const value of [
    workflowId,
    candidateId,
    recordId,
    eventId,
    "a".repeat(64),
    "完整采用 7 条",
    "1/2（50.0%）",
    "模型来源未知",
    "质量未验证",
    "修改后采用",
    conflictWorkflowId,
    conflictCandidateId,
    sourceId,
    "已核对来源冲突候选 1",
    "原版本",
    "当前观察",
    "不是完整冲突率",
  ])
    expect(html).toContain(value);
  expect(html.match(/data-planning-original-record-id=/gu)).toHaveLength(5);
  expect(html).not.toContain("PRIVATE");
  expect(html).not.toContain("<button");
});
test("older planning funnel without conflict protocol explicitly stays unrecorded instead of rendering a zero conflict count", () => {
  const funnel = CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: 0,
    measures: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      modelEvidence: "unknown",
      recordedRequests: 1,
      requestedTargets: 1,
      unobservedFirstTargets: 0,
      firstCandidates: 1,
      firstAdopted: 0,
      pendingDecision: 1,
      closedWithoutFirstAdoption: 0,
      revisedAdoption: 0,
      retryCandidates: 0,
      adoptionRejectedCount: 0,
      firstCandidateAdoptionRatio: 0,
      firstAccepted: null,
    })),
  });
  const html = renderToStaticMarkup(
    <PlanningOutcomes batches={undefined} funnel={funnel} />,
  );
  expect(html).toContain("准确规划来源冲突凭证未记录");
  expect(html).not.toContain("已核对来源冲突候选 0");
  expect(html).not.toContain("<button");
});
