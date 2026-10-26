import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import {
  CreativeOutcomeKindSchema,
  CreativeOutcomeRecordSchema,
  CreativeOutcomeSummarySchema,
  CreativeFunnelMetricSchema,
  CreativePlanningAdoptionSummarySchema,
  CreativePlanningFunnelSummarySchema,
  type CreativeOutcomeSummary,
  type CreativeContinuationGlobal,
} from "@dramaip/contracts/insights";
import { NarrativePlanningOperationSchema } from "@dramaip/contracts/creation";
import { creativeDeliveryLedgerFixture } from "../../../tests/fixtures/creative-delivery-ledger";
const projectId = "10000000-0000-4000-8000-000000000001";
test("delivery-window SDK uses the same complete GET fence and freezes the first original summary clock, not the later wall clock", async () => {
  const f = creativeDeliveryLedgerFixture(projectId);
  let summaries = 0;
  const calls: Request[] = [];
  const sdk = client((request) => {
    calls.push(request);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    if (new URL(request.url).pathname.endsWith("/summary")) {
      summaries++;
      const asOf =
        summaries === 1
          ? "2026-10-07T00:01:00.000Z"
          : "2026-10-14T00:01:00.000Z";
      return Response.json({
        ...summary,
        asOf,
        window: {
          kind: "rolling-seven-days",
          from: "2026-09-30T00:01:00.000Z",
          to: asOf,
        },
        counts: f.counts,
        projection: f.projection,
      });
    }
    return Response.json(f.pages[0]);
  });
  const value = await sdk.creativeOutcomes.deliveryWindow(projectId);
  expect(value.asOf).toBe("2026-10-07T00:01:00.000Z");
  expect(value.groups[0]!.deliveredInWindow).toBe(2);
  expect(calls).toHaveLength(4);
});
test("delivery-window SDK propagates changed checkpoints, missing owners and late aborts without model/write calls or partial clock statistics", async () => {
  for (const mode of ["change", "failure", "abort"] as const) {
    const f = creativeDeliveryLedgerFixture(projectId),
      controller = new AbortController();
    let summaries = 0,
      calls = 0;
    const sdk = client((request) => {
      calls++;
      expect(request.method).toBe("GET");
      if (new URL(request.url).pathname.endsWith("/summary")) {
        summaries++;
        return Response.json({
          ...summary,
          counts: f.counts,
          projection: {
            ...f.projection,
            checkpoint: mode === "change" && summaries > 1 ? 51 : 50,
          },
        });
      }
      if (mode === "failure") return new Response("", { status: 503 });
      if (mode === "abort") {
        controller.abort();
        expect(request.signal.aborted).toBe(true);
      }
      return Response.json(f.pages[0]);
    });
    await expect(
      sdk.creativeOutcomes.deliveryWindow(projectId, controller.signal),
    ).rejects.toThrow();
    expect(calls).toBe(mode === "change" ? 4 : 2);
  }
});
test("delivery SDK reads complete original pages and fences project projection/head/counts with GET only", async () => {
  const f = creativeDeliveryLedgerFixture(projectId),
    calls: Request[] = [],
    observed = { ...summary, counts: f.counts, projection: f.projection };
  const sdk = client((request) => {
    calls.push(request);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    const url = new URL(request.url);
    if (url.pathname.endsWith("/summary")) return Response.json(observed);
    expect(url.searchParams.get("limit")).toBe("100");
    return Response.json(
      url.searchParams.has("cursor")
        ? { projectId, items: f.records.slice(3) }
        : { projectId, items: f.records.slice(0, 3), nextCursor: 7 },
    );
  });
  const value = await sdk.creativeOutcomes.deliveryCoverage(projectId);
  expect(value.groups[0]!.ratio).toEqual({ numerator: 2, denominator: 3 });
  expect(calls).toHaveLength(5);
});
test("delivery SDK rejects changed final checkpoint, counts, head, truncated pages and owner failures instead of preserving a partial denominator", async () => {
  for (const mode of [
    "checkpoint",
    "counts",
    "head",
    "truncated",
    "fail",
    "catching-up",
  ]) {
    const f = creativeDeliveryLedgerFixture(projectId),
      observed: CreativeOutcomeSummary = {
        ...summary,
        counts: f.counts,
        projection: f.projection,
      };
    let summaries = 0,
      heads = 0;
    const sdk = client((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/summary")) {
        summaries++;
        const value = structuredClone(observed);
        if (mode === "catching-up") value.projection.state = "catching-up";
        if (summaries > 1 && mode === "checkpoint")
          value.projection.checkpoint++;
        if (summaries > 1 && mode === "counts") value.counts[0]!.total++;
        return Response.json(value);
      }
      if (mode === "fail") return new Response("", { status: 503 });
      heads++;
      const items = structuredClone(f.records);
      if (mode === "truncated") items.pop();
      if (mode === "head" && heads > 1)
        items[0]!.receipt!.sha256 = "b".repeat(64);
      return Response.json({ projectId, items });
    });
    await expect(
      sdk.creativeOutcomes.deliveryCoverage(projectId),
    ).rejects.toThrow();
    if (mode === "catching-up") expect(heads).toBe(0);
  }
});
test("delivery SDK shares an explicit AbortSignal and rejects late replies without automatic retry or any write", async () => {
  const f = creativeDeliveryLedgerFixture(projectId),
    observed = { ...summary, counts: f.counts, projection: f.projection },
    controller = new AbortController();
  let calls = 0;
  const sdk = client((request) => {
    calls++;
    expect(request.method).toBe("GET");
    const isSummary = new URL(request.url).pathname.endsWith("/summary");
    if (!isSummary) controller.abort();
    return Response.json(isSummary ? observed : f.pages[0]);
  });
  await expect(
    sdk.creativeOutcomes.deliveryCoverage(projectId, controller.signal),
  ).rejects.toThrow();
  expect(calls).toBe(2);
  await expect(
    sdk.creativeOutcomes.deliveryCoverage(projectId, controller.signal),
  ).rejects.toThrow();
  expect(calls).toBe(2);
});
test("planning SDK preserves new exact original batch receipts separately and older missing protocol remains unknown", async () => {
  const result = structuredClone(summary),
    workflowId = crypto.randomUUID(),
    candidateId = crypto.randomUUID(),
    recordId = crypto.randomUUID(),
    eventId = crypto.randomUUID();
  result.planningBatches = CreativePlanningAdoptionSummarySchema.parse({
    historyPolicy: "recorded-complete-owner-planning-batches-only",
    countingUnit: "adopted-planning-batch-not-individual-records",
    recordedBatches: 1,
    counts: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      batches: operation === "knowledge-plan" ? 1 : 0,
      actualRecords: operation === "knowledge-plan" ? 1 : 0,
    })),
    items: [
      {
        owner: "knowledge",
        eventId,
        cursor: 3,
        occurredAt: at,
        fact: {
          eventVersion: 1,
          kind: "story.planning-batch-adopted",
          workflowPath: "story-planning",
          projectId,
          workflowId,
          operation: "knowledge-plan",
          candidate: { id: candidateId, contentFingerprint: "a".repeat(64) },
          records: [{ id: recordId, kind: "story-bible", version: 0 }],
          recordCount: 1,
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
  result.planningFunnel = CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: 1,
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
  const sdk = client((request) => {
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    return Response.json(result);
  });
  expect(await sdk.creativeOutcomes.summary(projectId)).toEqual(result);
  for (const mutation of [
    () => {
      result.planningBatches!.items[0]!.fact.projectId = other;
    },
    () => {
      result.planningBatches!.items[0]!.owner = "writing";
    },
    () => {
      Object.assign(result.planningBatches!.items[0]!.fact, {
        body: "PRIVATE",
      });
    },
  ]) {
    const preserved = structuredClone(result);
    mutation();
    expect(CreativeOutcomeSummarySchema.safeParse(result).success).toBe(false);
    Object.assign(result, preserved);
  }
  expect(
    CreativeOutcomeSummarySchema.parse(summary).planningBatches,
  ).toBeUndefined();
  expect(
    CreativeOutcomeSummarySchema.parse(summary).planningFunnel,
  ).toBeUndefined();
  expect(
    await client(() => Response.json(summary)).creativeOutcomes.summary(
      projectId,
    ),
  ).toEqual(summary);
});
const other = "10000000-0000-4000-8000-000000000002";
test("planning conflict SDK preserves exact body-free original scope and old missing evidence, rejecting foreign, private or inflated evidence", async () => {
  const result = structuredClone(summary),
    workflowId = crypto.randomUUID(),
    candidateId = crypto.randomUUID(),
    sourceId = crypto.randomUUID();
  result.planningFunnel = CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: 0,
    measures: NarrativePlanningOperationSchema.options.map((operation) => ({
      operation,
      modelEvidence: "unknown",
      recordedRequests: operation === "knowledge-plan" ? 1 : 0,
      requestedTargets: operation === "knowledge-plan" ? 1 : 0,
      unobservedFirstTargets: 0,
      firstCandidates: operation === "knowledge-plan" ? 1 : 0,
      firstAdopted: 0,
      pendingDecision: operation === "knowledge-plan" ? 1 : 0,
      closedWithoutFirstAdoption: 0,
      revisedAdoption: 0,
      retryCandidates: 0,
      adoptionRejectedCount: operation === "knowledge-plan" ? 1 : 0,
      firstCandidateAdoptionRatio: operation === "knowledge-plan" ? 0 : null,
      firstAccepted: null,
      sourceConflicts: {
        candidateCount: operation === "knowledge-plan" ? 1 : 0,
        last:
          operation === "knowledge-plan"
            ? {
                candidate: {
                  id: candidateId,
                  contentFingerprint: "b".repeat(64),
                },
                sourceConflict: {
                  projectId,
                  workflowId,
                  changes: [
                    {
                      sourceKind: "knowledge",
                      frozen: { id: sourceId, version: 0 },
                      current: { id: sourceId, version: 1 },
                    },
                  ],
                },
                eventId: crypto.randomUUID(),
                cursor: 4,
                occurredAt: at,
              }
            : null,
      },
    })),
  });
  const sdk = client((request) => {
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    return Response.json(result);
  });
  expect(await sdk.creativeOutcomes.summary(projectId)).toEqual(result);
  const row = result.planningFunnel.measures.find(
    (item) => item.operation === "knowledge-plan",
  )!;
  for (const mutation of [
    () => {
      row.sourceConflicts!.last!.sourceConflict.projectId = other;
    },
    () => {
      Object.assign(row.sourceConflicts!.last!.sourceConflict, {
        body: "PRIVATE",
      });
    },
    () => {
      row.sourceConflicts!.candidateCount = 2;
    },
  ]) {
    const preserved = structuredClone(row);
    mutation();
    expect(CreativeOutcomeSummarySchema.safeParse(result).success).toBe(false);
    Object.assign(row, preserved);
  }
  for (const measure of result.planningFunnel.measures)
    delete measure.sourceConflicts;
  const older = await sdk.creativeOutcomes.summary(projectId);
  expect(
    older.planningFunnel?.measures.every(
      (measure) => measure.sourceConflicts === undefined,
    ),
  ).toBe(true);
});
const at = "2026-10-02T00:00:00.000Z";
const summary: CreativeOutcomeSummary = {
  projectId,
  asOf: at,
  window: {
    kind: "rolling-seven-days",
    from: "2026-09-25T00:00:00.000Z",
    to: at,
  },
  projection: { state: "healthy", checkpoint: 10 },
  historyPolicy: "recorded-owner-facts-only",
  sourceConfirmations: {
    historyPolicy: "recorded-owner-source-confirmations-only",
    unit: "owner-and-original-source-id",
    recordedConfirmations: 0,
    byWorkflow: [
      { workflowPath: "novel", total: 0 },
      { workflowPath: "adaptation", total: 0 },
      { workflowPath: null, total: 0 },
    ],
    items: [],
  },
  goalConfirmations: {
    historyPolicy: "recorded-explicit-initial-goals-only",
    recordedProjects: 0,
    byWorkflow: [
      { workflowPath: "novel", total: 0 },
      { workflowPath: "adaptation", total: 0 },
    ],
    items: [],
  },
  qualityAssociations: {
    historyPolicy: "recorded-report-adoptions-only",
    associationPolicy: "exact-owner-version-not-current-quality",
    recordedReports: 0,
    reportsWithExactTarget: 0,
    reportsWithScopeMembers: 0,
    reportsWithoutRecordedOutcome: 0,
    linkedResultUnits: 0,
    items: [],
  },
  continuation: {
    unit: "first-recorded-eligible-result-per-project-path",
    windowDays: 7,
    ratePolicy: "matured-projects-only-not-public-quality",
    observations: (["novel", "adaptation"] as const).map((workflowPath) => ({
      workflowPath,
      modelEvidence: "unknown",
      state: "unobserved",
      baseline: null,
      firstStarted: null,
      recordedRequests: 0,
      successfulStarts: 0,
      nextAdoptedTargets: 0,
      unlinkedRequests: 0,
    })),
  },
  funnel: {
    unit: "first-recorded-target-request",
    adoptionBasis: "exact-candidate-owner-fact",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    measures: CreativeFunnelMetricSchema.options.map((metric) => ({
      metric,
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
      sourceConflictCandidateCount: 0,
      lastSourceConflict: null,
      firstCandidateAdoptionRatio: null,
      firstAccepted: null,
    })),
  },
  counts: CreativeOutcomeKindSchema.options.map((kind) => ({
    kind,
    total: 0,
    lastSevenDays: 0,
  })),
  unavailable: ["model-usage-and-cost"],
};
const globalContinuation: CreativeContinuationGlobal = {
  scope: "all-local-recorded-projects",
  asOf: at,
  projection: { state: "healthy", checkpoint: 10 },
  windowDays: 7,
  ratePolicy: "matured-projects-only-not-public-quality",
  measures: (["novel", "adaptation"] as const).map((workflowPath) => ({
    workflowPath,
    modelEvidence: "unknown",
    eligibleProjects: 1,
    maturedProjects: 0,
    continuedProjects: 0,
    closedWithoutStart: 0,
    pendingProjects: 1,
    clockUnknownProjects: 0,
    unobservedBaselineProjects: 2,
    observedEarlyContinuations: 1,
    continuationRatio: null,
  })),
};
const record = {
  eventVersion: 1,
  eventId: other,
  occurredAt: at,
  cursor: 10,
  unitKey: "a".repeat(64),
  kind: "novel.chapter-adopted",
  workflowPath: "novel",
  projectId,
  objectId: other,
  formalVersions: [{ kind: "chapter", id: other, version: 1 }],
  sourceVersions: [],
  evidenceKind: "human",
  modelEvidence: "unknown",
  qualityState: "unverified",
  resultStatus: "adopted",
};
test("native whole-book collection SDK preserves body-free original IDs and requires its committed owner receipt, never partial inventory or invented versions", async () => {
  const result = structuredClone(summary);
  const metric = result.funnel.measures.find(
    (item) => item.metric === "adaptation.diagnosis",
  )!;
  const chapterCollection = {
    scope: "whole-book" as const,
    inventory: "nonempty-chapters" as const,
    inventoryOwner: "writing" as const,
    completeness: "complete-owner-inventory" as const,
    frozenIds: [projectId],
    currentIds: [projectId, other],
  };
  Object.assign(metric, {
    recordedRequests: 1,
    requestedTargets: 1,
    firstCandidates: 1,
    pendingDecision: 1,
    firstCandidateAdoptionRatio: 0,
    adoptionRejectedCount: 1,
    sourceConflictCandidateCount: 1,
    lastSourceConflict: {
      occurredAt: at,
      candidate: { id: other, contentFingerprint: "a".repeat(64) },
      ownerRejection: {
        owner: "production",
        aggregateType: "adaptation-diagnosis",
        stateVersion: 1,
      },
      sourceConflict: {
        projectId,
        workflowId: other,
        changes: [],
        chapterCollection,
      },
    },
  });
  expect(CreativeOutcomeSummarySchema.safeParse(result).success).toBe(true);
  const sdk = client((request) => {
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(new URL(request.url).pathname).toBe(
      `/api/v2/projects/${projectId}/creative-outcomes/summary`,
    );
    return Response.json(result);
  });
  expect(await sdk.creativeOutcomes.summary(projectId)).toEqual(result);
  for (const changed of [
    { ...chapterCollection, completeness: "partial-page" },
    { ...chapterCollection, scope: "selected-chapters" },
    { ...chapterCollection, currentIds: [projectId] },
    { ...chapterCollection, currentVersion: 1 },
    { ...chapterCollection, manuscript: "PRIVATE prose" },
  ]) {
    const invalid = structuredClone(result);
    const last = invalid.funnel.measures.find(
      (item) => item.metric === "adaptation.diagnosis",
    )!.lastSourceConflict!;
    expect(
      CreativeOutcomeSummarySchema.safeParse({
        ...invalid,
        funnel: {
          ...invalid.funnel,
          measures: invalid.funnel.measures.map((item) =>
            item.lastSourceConflict
              ? {
                  ...item,
                  lastSourceConflict: {
                    ...last,
                    sourceConflict: {
                      ...last.sourceConflict,
                      chapterCollection: changed,
                    },
                  },
                }
              : item,
          ),
        },
      }).success,
    ).toBe(false);
  }
});
function client(respond: (request: Request) => Response | Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
}
test("source confirmation SDK reads only exact local project history and rejects private, foreign, incomplete or fabricated receipts", async () => {
  const item = {
    eventVersion: 1,
    owner: "workspace",
    sourceId: crypto.randomUUID(),
    projectId,
    projectVersion: 3,
    projectMode: "series_longform",
    workflowPath: "novel",
    entry: "ordinary-import",
    sourceFormat: "markdown",
    contentKind: "novel",
    scopePolicy: "confirmed-parsed-entries-not-entire-file",
    entryCount: 1,
    sceneCount: 0,
    bindingFingerprint: "a".repeat(64),
    receiptFingerprint: "b".repeat(64),
    rightsState: "declared-not-verified",
    evidenceKind: "explicit-source-declaration-and-owner-commit",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "not-assessed",
    entries: [
      { kind: "chapter", sourceIndex: 0, id: crypto.randomUUID(), version: 0 },
    ],
    bindingDisplay: "first-five-original-bindings",
    eventId: crypto.randomUUID(),
    cursor: 9,
    occurredAt: at,
  };
  const sourceConfirmations = {
    ...summary.sourceConfirmations,
    recordedConfirmations: 1,
    byWorkflow: [
      { workflowPath: "novel", total: 1 },
      { workflowPath: "adaptation", total: 0 },
      { workflowPath: null, total: 0 },
    ],
    items: [item],
  };
  const value = CreativeOutcomeSummarySchema.parse({
    ...summary,
    sourceConfirmations,
  });
  const calls: Request[] = [];
  expect(
    await client((request) => {
      calls.push(request);
      return Response.json(value);
    }).creativeOutcomes.summary(projectId),
  ).toEqual(value);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  for (const patch of [
    { projectId: other },
    { body: "PRIVATE" },
    { sourceKey: "PRIVATE" },
    { fileName: "PRIVATE" },
    { grantId: other },
    { sourceVersion: 0 },
    { qualityState: "passed" },
    { rightsState: "verified" },
    { modelEvidence: "real" },
    { currentValidity: "current" },
    { workflowPath: "adaptation" },
    { entryCount: 2 },
    { entries: [{ ...item.entries[0], version: 1 }] },
  ])
    await expect(
      client(() =>
        Response.json({
          ...value,
          sourceConfirmations: {
            ...sourceConfirmations,
            items: [{ ...item, ...patch }],
          },
        }),
      ).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
  const { sourceConfirmations: omitted, ...old } = value;
  expect(omitted.recordedConfirmations).toBe(1);
  await expect(
    client(() => Response.json(old)).creativeOutcomes.summary(projectId),
  ).rejects.toThrow();
});

test("initial goal SDK reads only the original project receipt and rejects inferred, private or foreign confirmations", async () => {
  const item = {
    eventVersion: 1,
    projectId,
    projectVersion: 0,
    workflowPath: "novel",
    goal: "novel-first",
    material: "inspiration",
    evidenceKind: "explicit-initial-goal-confirmation",
    modelEvidence: "unknown",
    qualityState: "unverified",
    eventId: other,
    cursor: 11,
    occurredAt: at,
  };
  const goalConfirmations = {
    ...summary.goalConfirmations,
    recordedProjects: 1,
    byWorkflow: [
      { workflowPath: "novel", total: 1 },
      { workflowPath: "adaptation", total: 0 },
    ],
    items: [item],
  };
  const value = CreativeOutcomeSummarySchema.parse({
    ...summary,
    goalConfirmations,
  });
  const calls: Request[] = [];
  expect(
    await client((request) => {
      calls.push(request);
      return Response.json(value);
    }).creativeOutcomes.summary(projectId),
  ).toEqual(value);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  for (const patch of [
    { projectId: other },
    { projectVersion: 1 },
    { body: "PRIVATE" },
    { qualityState: "passed" },
    { modelEvidence: "real" },
    { evidenceKind: "human" },
    { workflowPath: "adaptation" },
  ]) {
    await expect(
      client(() =>
        Response.json({
          ...value,
          goalConfirmations: {
            ...goalConfirmations,
            items: [{ ...item, ...patch }],
          },
        }),
      ).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
  }
  const { goalConfirmations: omitted, ...old } = value;
  expect(omitted.recordedProjects).toBe(1);
  await expect(
    client(() => Response.json(old)).creativeOutcomes.summary(projectId),
  ).rejects.toThrow();
});
test("quality history SDK is body-free and rejects approximate, private or foreign report associations without inventing literary quality", async () => {
  const report = {
    eventVersion: 1,
    projectId,
    workflowId: other,
    report: { id: other, version: 1 },
    target: { kind: "chapter", id: other, version: 3 },
    requestedDimensions: ["causality"],
    evidenceKind: "explicit-report-adoption",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "unknown",
    eventId: projectId,
    cursor: 12,
    occurredAt: at,
    links: [
      {
        relation: "exact-target-version",
        outcomeKind: "novel.chapter-adopted",
        objectId: other,
        unitKey: "a".repeat(64),
        formalVersion: { kind: "chapter", id: other, version: 3 },
      },
    ],
  };
  const qualityAssociations = {
    ...summary.qualityAssociations,
    recordedReports: 1,
    reportsWithExactTarget: 1,
    linkedResultUnits: 1,
    items: [report],
  };
  const value = CreativeOutcomeSummarySchema.parse({
    ...summary,
    qualityAssociations,
  });
  const calls: Request[] = [];
  const sdk = client((request) => {
    calls.push(request);
    return Response.json(value);
  });
  expect(await sdk.creativeOutcomes.summary(projectId)).toEqual(value);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  for (const changed of [
    { ...qualityAssociations, recordedReports: 2 },
    {
      ...qualityAssociations,
      reportsWithExactTarget: 0,
      reportsWithoutRecordedOutcome: 1,
    },
    { ...qualityAssociations, items: [{ ...report, projectId: other }] },
    { ...qualityAssociations, items: [{ ...report, note: "PRIVATE" }] },
    {
      ...qualityAssociations,
      items: [{ ...report, target: { ...report.target, title: "PRIVATE" } }],
    },
    { ...qualityAssociations, items: [{ ...report, qualityState: "passed" }] },
    {
      ...qualityAssociations,
      items: [{ ...report, currentValidity: "current" }],
    },
    {
      ...qualityAssociations,
      items: [
        {
          ...report,
          links: [
            {
              ...report.links[0],
              formalVersion: { ...report.links[0]!.formalVersion, version: 4 },
            },
          ],
        },
      ],
    },
  ]) {
    expect(
      CreativeOutcomeSummarySchema.safeParse({
        ...summary,
        qualityAssociations: changed,
      }).success,
    ).toBe(false);
    await expect(
      client(() =>
        Response.json({ ...summary, qualityAssociations: changed }),
      ).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
  }
});
test("local result SDK uses only scoped read routes, forwards cancellation and preserves actual paging without telemetry writes", async () => {
  const calls: Request[] = [];
  const sdk = client((request) => {
    calls.push(request);
    return Response.json(
      request.url.endsWith("/summary")
        ? summary
        : { projectId, items: [record], nextCursor: 10 },
    );
  });
  const controller = new AbortController();
  expect(
    await sdk.creativeOutcomes.summary(projectId, controller.signal),
  ).toEqual(summary);
  expect(
    (await sdk.creativeOutcomes.list(projectId, 11, 1, controller.signal))
      .items,
  ).toHaveLength(1);
  expect(calls.map((request) => request.method)).toEqual(["GET", "GET"]);
  expect(
    calls[1]!.url.endsWith(
      `/projects/${projectId}/creative-outcomes?cursor=11&limit=1`,
    ),
  ).toBe(true);
  expect(calls.every((request) => request.body === null)).toBe(true);
  controller.abort();
  expect(calls.every((request) => request.signal.aborted)).toBe(true);
});
test("source conflict SDK preserves the original body-free candidate and observed versions, rejects private or foreign evidence and never writes or reads source prose", async () => {
  const value = CreativeOutcomeSummarySchema.parse({
    ...summary,
    funnel: {
      ...summary.funnel,
      measures: summary.funnel.measures.map((measure) =>
        measure.metric === "novel.chapter"
          ? {
              ...measure,
              sourceConflictCandidateCount: 1,
              lastSourceConflict: {
                occurredAt: at,
                candidate: { id: other, contentFingerprint: "c".repeat(64) },
                sourceConflict: {
                  projectId,
                  workflowId: other,
                  changes: [
                    {
                      sourceKind: "chapter",
                      frozen: { id: other, version: 0 },
                      current: { id: other, version: 1 },
                    },
                  ],
                },
              },
            }
          : measure,
      ),
    },
  });
  const requests: Request[] = [];
  expect(
    await client((request) => {
      requests.push(request);
      return Response.json(value);
    }).creativeOutcomes.summary(projectId),
  ).toEqual(value);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.method).toBe("GET");
  expect(
    requests[0]!.url.endsWith(
      `/projects/${projectId}/creative-outcomes/summary`,
    ),
  ).toBe(true);
  expect(requests[0]!.body).toBeNull();
  const last = value.funnel.measures[0]!.lastSourceConflict!;
  for (const lastSourceConflict of [
    {
      ...last,
      sourceConflict: {
        ...last.sourceConflict,
        projectId: "10000000-0000-4000-8000-000000000003",
      },
    },
    {
      ...last,
      sourceConflict: {
        ...last.sourceConflict,
        changes: [
          {
            ...last.sourceConflict.changes[0]!,
            content: "PRIVATE source body",
          },
        ],
      },
    },
    {
      ...last,
      sourceConflict: {
        ...last.sourceConflict,
        changes: [
          {
            ...last.sourceConflict.changes[0]!,
            current: last.sourceConflict.changes[0]!.frozen,
          },
        ],
      },
    },
    { ...last, prompt: "PRIVATE prompt" },
  ])
    await expect(
      client(() =>
        Response.json({
          ...value,
          funnel: {
            ...value.funnel,
            measures: value.funnel.measures.map((measure) =>
              measure.metric === "novel.chapter"
                ? { ...measure, lastSourceConflict }
                : measure,
            ),
          },
        }),
      ).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
});

test("native rejection SDK preserves the immutable owner state receipt and original strategy options without inventing a workflow version", async () => {
  const last = {
    occurredAt: at,
    candidate: {
      id: other,
      contentFingerprint: "a".repeat(64),
      selectionOptions: [
        { id: "original-option-a", contentFingerprint: "b".repeat(64) },
        { id: "original-option-b", contentFingerprint: "c".repeat(64) },
      ],
    },
    ownerRejection: {
      owner: "production",
      aggregateType: "adaptation-strategy",
      stateVersion: 1,
    },
    sourceConflict: {
      projectId,
      workflowId: other,
      changes: [
        {
          sourceKind: "author_intent",
          frozen: { id: other, version: 1 },
          current: { id: projectId, version: 2 },
        },
      ],
    },
  };
  const value = CreativeOutcomeSummarySchema.parse({
    ...summary,
    funnel: {
      ...summary.funnel,
      measures: summary.funnel.measures.map((measure) =>
        measure.metric === "adaptation.strategy"
          ? {
              ...measure,
              recordedRequests: 1,
              requestedTargets: 1,
              firstCandidates: 1,
              pendingDecision: 1,
              firstCandidateAdoptionRatio: 0,
              adoptionRejectedCount: 1,
              sourceConflictCandidateCount: 1,
              lastSourceConflict: last,
            }
          : measure,
      ),
    },
  });
  const requests: Request[] = [];
  expect(
    await client((request) => {
      requests.push(request);
      return Response.json(value);
    }).creativeOutcomes.summary(projectId),
  ).toEqual(value);
  expect(requests.map((request) => request.method)).toEqual(["GET"]);
  expect(requests[0]!.body).toBeNull();
  for (const lastSourceConflict of [
    {
      ...last,
      ownerRejection: { ...last.ownerRejection, owner: "automation" },
    },
    { ...last, ownerRejection: { ...last.ownerRejection, stateVersion: 0 } },
    {
      ...last,
      ownerRejection: {
        ...last.ownerRejection,
        aggregateType: "adaptation-diagnosis",
      },
    },
    { ...last, ownerRejection: { ...last.ownerRejection, workflowVersion: 9 } },
    {
      ...last,
      ownerRejection: {
        ...last.ownerRejection,
        credential: "PRIVATE credential",
      },
    },
    {
      ...last,
      sourceConflict: {
        ...last.sourceConflict,
        changes: [
          { ...last.sourceConflict.changes[0], sourceKind: "knowledge" },
        ],
      },
    },
  ])
    await expect(
      client(() =>
        Response.json({
          ...value,
          funnel: {
            ...value.funnel,
            measures: value.funnel.measures.map((measure) =>
              measure.metric === "adaptation.strategy"
                ? { ...measure, lastSourceConflict }
                : measure,
            ),
          },
        }),
      ).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
});

test("seven-day SDK reads the body-free all-local project cohort with cancellation and preserves pending null denominator", async () => {
  const requests: Request[] = [];
  const sdk = client((request) => {
    requests.push(request);
    return Response.json(globalContinuation);
  });
  const controller = new AbortController();
  expect(
    await sdk.creativeOutcomes.continuationSummary(controller.signal),
  ).toEqual(globalContinuation);
  expect(
    requests[0]!.url.endsWith("/api/v2/creative-continuations/summary"),
  ).toBe(true);
  expect(requests[0]!.method).toBe("GET");
  expect(requests[0]!.body).toBeNull();
  controller.abort();
  expect(requests[0]!.signal.aborted).toBe(true);
});
test("seven-day SDK rejects inflated project arithmetic, guessed rates/classification, secret fields and a pending observation after its deadline", async () => {
  for (const value of [
    { ...globalContinuation, projectIds: [projectId] },
    {
      ...globalContinuation,
      measures: globalContinuation.measures.map((item) => ({
        ...item,
        continuationRatio: 0,
      })),
    },
    {
      ...globalContinuation,
      measures: globalContinuation.measures.map((item) => ({
        ...item,
        maturedProjects: 1,
      })),
    },
    {
      ...globalContinuation,
      measures: globalContinuation.measures.map((item) => ({
        ...item,
        modelEvidence: "real-model",
      })),
    },
  ])
    await expect(
      client(() => Response.json(value)).creativeOutcomes.continuationSummary(),
    ).rejects.toThrow();
  const invalid = {
    ...summary,
    continuation: {
      ...summary.continuation,
      observations: summary.continuation.observations.map((item) =>
        item.workflowPath !== "novel"
          ? item
          : {
              ...item,
              state: "pending",
              baseline: {
                eventId: other,
                objectId: other,
                version: 1,
                targetKey: "a".repeat(64),
                position: 0,
                adoptedAt: "2026-09-01T00:00:00.000Z",
                deadline: "2026-09-08T00:00:00.000Z",
              },
            },
      ),
    },
  };
  await expect(
    client(() => Response.json(invalid)).creativeOutcomes.summary(projectId),
  ).rejects.toThrow();
});
test("local result SDK refuses foreign summaries/pages, duplicate event identities and accidental private data", async () => {
  for (const value of [
    { ...summary, projectId: other },
    { ...summary, prompt: "private" },
    { ...summary, actualCost: 0 },
  ])
    await expect(
      client(() => Response.json(value)).creativeOutcomes.summary(projectId),
    ).rejects.toThrow();
  for (const value of [
    { projectId: other, items: [] },
    { projectId, items: [{ ...record, projectId: other }] },
    { projectId, items: [record, record] },
    { projectId, items: [{ ...record, absolutePath: "/secret" }] },
    { projectId, items: [{ ...record, modelEvidence: "real-model" }] },
  ])
    await expect(
      client(() => Response.json(value)).creativeOutcomes.list(projectId),
    ).rejects.toThrow();
});
test("read failures remain failures rather than becoming an empty success ledger", async () => {
  const failure = client(() =>
    Response.json(
      {
        type: "https://dramaip.local/problems/not-found",
        title: "Not found",
        status: 404,
        traceId: other,
      },
      { status: 404 },
    ),
  );
  await expect(
    failure.creativeOutcomes.summary(projectId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(failure.creativeOutcomes.list(projectId)).rejects.toMatchObject({
    status: 404,
  });
});
test("memory write SDK preserves a body-free actual record set and rejects guessed human adoption, foreign sources and private quotes", async () => {
  const item = CreativeOutcomeRecordSchema.parse({
    ...record,
    kind: "novel.chapter-memory-written",
    workflowId: other,
    formalVersions: [{ kind: "knowledge-record", id: other, version: 0 }],
    sourceVersions: [{ id: projectId, version: 3 }],
    memoryWrite: {
      source: { id: projectId, version: 3, contentFingerprint: "b".repeat(64) },
      records: [
        {
          id: other,
          version: 0,
          kind: "chapter-memories",
          contentFingerprint: "c".repeat(64),
        },
      ],
    },
    evidenceKind: "rule",
    resultStatus: "written",
  });
  const calls: Request[] = [];
  const sdk = client((request) => {
    calls.push(request);
    return Response.json({ projectId, items: [item] });
  });
  expect((await sdk.creativeOutcomes.list(projectId)).items).toEqual([item]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  for (const changed of [
    { ...item, evidenceKind: "human" },
    { ...item, resultStatus: "adopted" },
    { ...item, sourceVersions: [{ id: projectId, version: 2 }] },
    { ...item, formalVersions: [{ kind: "chapter", id: other, version: 0 }] },
    {
      ...item,
      memoryWrite: {
        ...item.memoryWrite,
        records: [
          { ...item.memoryWrite!.records[0], evidence: "private quote" },
        ],
      },
    },
  ])
    await expect(
      client(() =>
        Response.json({ projectId, items: [changed] }),
      ).creativeOutcomes.list(projectId),
    ).rejects.toThrow();
});
test("first-candidate summaries reject invented denominators, duplicate categories, private data and inferred model proof", async () => {
  for (const mutate of [
    (value: typeof summary) => ({
      ...value,
      funnel: { ...value.funnel, measures: value.funnel.measures.slice(1) },
    }),
    (value: typeof summary) => ({
      ...value,
      funnel: {
        ...value.funnel,
        measures: value.funnel.measures.map((item) => ({
          ...item,
          metric: "novel.chapter",
        })),
      },
    }),
    (value: typeof summary) => ({
      ...value,
      funnel: {
        ...value.funnel,
        measures: value.funnel.measures.map((item) => ({
          ...item,
          firstCandidateAdoptionRatio: 0,
        })),
      },
    }),
    (value: typeof summary) => ({
      ...value,
      funnel: {
        ...value.funnel,
        measures: value.funnel.measures.map((item) => ({
          ...item,
          firstAdopted: 1,
        })),
      },
    }),
    (value: typeof summary) => ({
      ...value,
      funnel: {
        ...value.funnel,
        measures: value.funnel.measures.map((item) => ({
          ...item,
          modelEvidence: "real-model",
        })),
      },
    }),
    (value: typeof summary) => ({
      ...value,
      funnel: {
        ...value.funnel,
        measures: value.funnel.measures.map((item) => ({
          ...item,
          prompt: "private",
          actualCost: 0,
        })),
      },
    }),
  ])
    await expect(
      client(() => Response.json(mutate(summary))).creativeOutcomes.summary(
        projectId,
      ),
    ).rejects.toThrow();
});
