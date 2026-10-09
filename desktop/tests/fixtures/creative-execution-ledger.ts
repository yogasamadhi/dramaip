import { CreativeWorkflowExecutionSchema } from "@dramaip/contracts/insights";

/** Controlled metadata fixture only; never real model/quality/billing evidence. */
export function creativeExecutionLedgerFixture(
  projectId = crypto.randomUUID(),
  workflowId = crypto.randomUUID(),
) {
  const requestedAt = "2026-10-07T00:00:00.000Z";
  const request = {
    family: "creative" as const,
    record: {
      eventId: crypto.randomUUID(),
      cursor: 1,
      occurredAt: requestedAt,
      fact: {
        eventVersion: 1,
        kind: "request",
        projectId,
        workflowId,
        workflowVersion: 0,
        workflowPath: "novel",
        metric: "novel.chapter",
        targetKey: "a".repeat(64),
        requestedAt,
        evidenceKind: "rule",
        modelEvidence: "unknown",
        targetAttempt: 1,
        requestKind: "new-request",
        sourceVersions: [],
      },
    },
  };
  const candidate = {
    id: crypto.randomUUID(),
    contentFingerprint: "b".repeat(64),
  };
  const {
    targetAttempt: _attempt,
    requestKind: _kind,
    sourceVersions: _sources,
    ...common
  } = request.record.fact;
  const chapterId = crypto.randomUUID();
  const runs = (
    ["generating", "checking", "revising", "rechecking"] as const
  ).map((phase) => {
    const runId = crypto.randomUUID();
    return {
      state: "recorded",
      runId,
      phase,
      execution: {
        format: "agent-run-execution-v1",
        runId,
        sessionId: crypto.randomUUID(),
        projectId,
        contextSnapshotId: crypto.randomUUID(),
        engineKind: "codex",
        taskType: `creation_${phase}`,
        status: "completed",
        model: {
          status: "recorded",
          modelId: "controlled-requested-model",
          providerId: "controlled-requested-provider",
        },
        timing: {
          status: "measured",
          startedAt: requestedAt,
          completedAt: "2026-10-07T00:00:01.000Z",
          durationMs: 1000,
        },
        source: "persisted-agent-run",
      },
    };
  });
  return CreativeWorkflowExecutionSchema.parse({
    format: "creative-workflow-execution-v1",
    projectId,
    workflowId,
    request,
    projection: { state: "healthy", checkpoint: 3 },
    facts: {
      items: [
        {
          family: "outcome",
          record: {
            eventVersion: 1,
            eventId: crypto.randomUUID(),
            cursor: 3,
            occurredAt: "2026-10-07T00:00:03.000Z",
            kind: "novel.chapter-adopted",
            workflowPath: "novel",
            projectId,
            workflowId,
            objectId: chapterId,
            candidate,
            formalVersions: [{ kind: "chapter", id: chapterId, version: 1 }],
            sourceVersions: [],
            evidenceKind: "human",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "adopted",
            unitKey: "c".repeat(64),
          },
        },
        {
          family: "creative",
          record: {
            eventId: crypto.randomUUID(),
            cursor: 2,
            occurredAt: "2026-10-07T00:00:02.000Z",
            fact: {
              ...common,
              kind: "candidate-ready",
              workflowVersion: 8,
              candidate,
            },
          },
        },
        request,
      ],
    },
    execution: {
      state: "recorded",
      receipt: {
        format: "creation-execution-receipt-v1",
        projectId,
        workflowId,
        operation: "chapter",
        version: 8,
        runs,
        coverage: "exact-workflow-attempt",
        billingStatus: "unknown",
      },
      usage: runs.map((run) => ({
        state: "recorded",
        runId: run.runId,
        page: {
          format: "agent-usage-observation-page-v1",
          runId: run.runId,
          projectId,
          observationCount: 1,
          coverage: "partial-or-unknown",
          billingStatus: "unknown",
          items: [
            {
              format: "agent-usage-observation-v1",
              runId: run.runId,
              sessionId: run.execution.sessionId,
              projectId,
              engineKind: "codex",
              cursor: 1,
              measurementScope: "session-total",
              inputAccounting: "unspecified",
              inputTokens: { status: "reported", value: 0 },
              outputTokens: { status: "unreported" },
              cachedTokens: { status: "invalid" },
              costEstimate: {
                source: "engine-reported-estimate",
                amount: { status: "reported", value: 0 },
                currency: { status: "reported", value: "EUR" },
                billingStatus: "unknown",
              },
              source: "engine-reported",
              runClassification: "unknown",
              billingStatus: "unknown",
              recordedAt: requestedAt,
            },
          ],
        },
      })),
    },
    modelEvidence: "unknown",
    qualityState: "unverified",
    billingStatus: "unknown",
    aggregationPolicy: "individual-observations-no-totals",
  });
}
