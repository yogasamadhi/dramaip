import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_CONTINUATION_EVENTS,
  CreativeContinuationFactSchema,
  CreativeContinuationRecordSchema,
  CreativeContinuationSummarySchema,
  CreativeContinuationGlobalSchema,
  CreativeOutcomeRecordSchema,
  type CreativeContinuationGlobal,
  type CreativeContinuationSummary,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeContinuationMigration: PluginMigration = {
  id: "insights.0004.creative-continuation",
  pluginId: "insights",
  version: "3.0.0-alpha.3",
  dependsOn: ["insights.0003.creative-funnel"],
  sql: `CREATE TABLE insights_creative_continuation_events (
    event_id TEXT PRIMARY KEY, source_cursor INTEGER NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL, value_json TEXT NOT NULL
  ); CREATE INDEX insights_creative_continuation_project ON insights_creative_continuation_events(project_id, source_cursor);`,
};
export function projectCreativeContinuation(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
) {
  const fact = CreativeContinuationFactSchema.parse(event.payload);
  if (
    event.type !== CREATIVE_CONTINUATION_EVENTS[fact.kind] ||
    event.pluginId !== "automation" ||
    event.aggregateType !== "creation" ||
    event.aggregateId !== fact.workflowId ||
    event.aggregateVersion !== fact.workflowVersion
  )
    throw new Error(
      "Continuation owner and committed workflow envelope do not match.",
    );
  const record = CreativeContinuationRecordSchema.parse({
    fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const existing = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_creative_continuation_events WHERE event_id = ? OR source_cursor = ?",
    event.eventId,
    event.cursor,
  );
  if (existing) {
    if (existing.value_json !== JSON.stringify(record))
      throw new Error(
        "A committed continuation fact cannot be replaced on replay.",
      );
    return;
  }
  const previous = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_continuation_events WHERE project_id = ? AND workflow_id = ? ORDER BY source_cursor",
      fact.projectId,
      fact.workflowId,
    )
    .map((row) =>
      CreativeContinuationRecordSchema.parse(JSON.parse(row.value_json)),
    );
  if (fact.kind === "started") {
    const request = previous.find((item) => item.fact.kind === "request");
    if (
      !request ||
      request.cursor >= event.cursor ||
      previous.some((item) => item.fact.kind === "started") ||
      request.fact.operation !== fact.operation ||
      request.fact.requestedAt !== fact.requestedAt ||
      JSON.stringify(request.fact.basis) !== JSON.stringify(fact.basis)
    )
      throw new Error(
        "Continuation startup requires its exact previously committed request once.",
      );
  } else if (previous.length)
    throw new Error("A workflow has one immutable continuation request.");
  tx.run(
    "INSERT INTO insights_creative_continuation_events VALUES (?, ?, ?, ?, ?)",
    event.eventId,
    event.cursor,
    fact.projectId,
    fact.workflowId,
    JSON.stringify(record),
  );
}
const DAYS = 7 * 86400000;
export function measureCreativeContinuation(
  tx: UnitOfWorkTransaction,
  projectId: string,
  asOf: string,
): CreativeContinuationSummary {
  const facts = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_continuation_events WHERE project_id = ? ORDER BY source_cursor",
      projectId,
    )
    .map((row) =>
      CreativeContinuationRecordSchema.parse(JSON.parse(row.value_json)),
    );
  const outcomes = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM insights_creative_outcome_events WHERE project_id = ? ORDER BY source_cursor",
      projectId,
    )
    .map((row) =>
      CreativeOutcomeRecordSchema.parse(JSON.parse(row.value_json)),
    );
  const now = Date.parse(asOf);
  const observations = (["novel", "adaptation"] as const).map((path) => {
    const adopts = outcomes.filter(
      (item) =>
        item.kind ===
        (path === "novel"
          ? "novel.chapter-adopted"
          : "adaptation.script-adopted"),
    );
    const baseline = adopts.find(
      (item) =>
        item.continuationTarget &&
        (path === "novel" || item.continuationTarget.position === 0),
    );
    const requests = facts.filter(
      (item) =>
        item.fact.kind === "request" && item.fact.basis.workflowPath === path,
    );
    const linked = requests.flatMap((request) => {
      const { source, target } = request.fact.basis;
      const owner = adopts.find(
        (item) =>
          item.cursor < request.cursor &&
          item.objectId === source.id &&
          item.formalVersions[0]?.version === source.version &&
          item.continuationTarget?.targetKey === source.targetKey &&
          item.continuationTarget.position === source.position,
      );
      if (
        !baseline ||
        !owner ||
        source.targetKey !== baseline.continuationTarget!.targetKey ||
        source.position !== baseline.continuationTarget!.position ||
        target.position !== source.position + 1
      )
        return [];
      const started = facts.find(
        (item) =>
          item.fact.kind === "started" &&
          item.fact.workflowId === request.fact.workflowId,
      );
      return [{ request, owner, started }];
    });
    const starts = linked
      .filter((item) => item.started)
      .sort((a, b) => a.started!.cursor - b.started!.cursor);
    const first = starts[0]?.started;
    const at = baseline ? Date.parse(baseline.occurredAt) : 0;
    const deadline = at + DAYS;
    const inconsistent =
      baseline &&
      (at > now ||
        linked.some(({ request, owner, started }) => {
          const requested = Date.parse(request.fact.requestedAt);
          const committed = Date.parse(request.occurredAt);
          return (
            requested < Date.parse(owner.occurredAt) ||
            committed < requested ||
            requested > now ||
            committed > now ||
            (started &&
              (Date.parse(started.occurredAt) < committed ||
                Date.parse(started.occurredAt) > now))
          );
        }));
    const withinWindow = Boolean(
      first &&
      Date.parse(first.occurredAt) >= at &&
      Date.parse(first.occurredAt) <= deadline &&
      !inconsistent,
    );
    const nextTargets = new Set(
      adopts
        .filter((item) =>
          starts.some(
            ({ started }) =>
              item.workflowId === started!.fact.workflowId &&
              item.cursor > started!.cursor &&
              item.continuationTarget?.targetKey ===
                started!.fact.basis.target.targetKey &&
              item.continuationTarget.position ===
                started!.fact.basis.target.position,
          ),
        )
        .map((item) => item.continuationTarget!.targetKey),
    );
    const startedFact = first?.fact;
    return {
      workflowPath: path,
      modelEvidence: "unknown" as const,
      state: !baseline
        ? ("unobserved" as const)
        : inconsistent
          ? ("clock-inconsistent" as const)
          : now < deadline
            ? ("pending" as const)
            : withinWindow
              ? ("continued" as const)
              : ("not-started" as const),
      baseline: baseline
        ? {
            eventId: baseline.eventId,
            objectId: baseline.objectId,
            version: baseline.formalVersions[0]!.version,
            ...baseline.continuationTarget!,
            adoptedAt: baseline.occurredAt,
            deadline: new Date(deadline).toISOString(),
          }
        : null,
      firstStarted:
        first && startedFact?.kind === "started"
          ? {
              workflowId: startedFact.workflowId,
              runId: startedFact.runId,
              sessionId: startedFact.sessionId,
              targetKey: startedFact.basis.target.targetKey,
              startedAt: first.occurredAt,
              withinWindow,
            }
          : null,
      recordedRequests: requests.length,
      successfulStarts: starts.length,
      nextAdoptedTargets: nextTargets.size,
      unlinkedRequests: requests.length - linked.length,
    };
  });
  return CreativeContinuationSummarySchema.parse({
    unit: "first-recorded-eligible-result-per-project-path",
    windowDays: 7,
    ratePolicy: "matured-projects-only-not-public-quality",
    observations,
  });
}
export function measureGlobalContinuation(
  tx: UnitOfWorkTransaction,
  asOf: string,
  projection: CreativeContinuationGlobal["projection"],
): CreativeContinuationGlobal {
  const ids = tx.all<{ project_id: string }>(
    "SELECT project_id FROM insights_creative_outcome_events UNION SELECT project_id FROM insights_creative_continuation_events",
  );
  const observations = ids.flatMap(
    (item) =>
      measureCreativeContinuation(tx, item.project_id, asOf).observations,
  );
  const measures = (["novel", "adaptation"] as const).map((path) => {
    const items = observations.filter((item) => item.workflowPath === path);
    const count = (state: (typeof items)[number]["state"]) =>
      items.filter((item) => item.state === state).length;
    const continuedProjects = count("continued");
    const closedWithoutStart = count("not-started");
    const maturedProjects = continuedProjects + closedWithoutStart;
    return {
      workflowPath: path,
      modelEvidence: "unknown" as const,
      eligibleProjects: items.filter((item) => item.baseline).length,
      maturedProjects,
      continuedProjects,
      closedWithoutStart,
      pendingProjects: count("pending"),
      clockUnknownProjects: count("clock-inconsistent"),
      unobservedBaselineProjects: count("unobserved"),
      observedEarlyContinuations: items.filter(
        (item) => item.state === "pending" && item.firstStarted?.withinWindow,
      ).length,
      continuationRatio: maturedProjects
        ? continuedProjects / maturedProjects
        : null,
    };
  });
  return CreativeContinuationGlobalSchema.parse({
    scope: "all-local-recorded-projects",
    asOf,
    projection,
    windowDays: 7,
    ratePolicy: "matured-projects-only-not-public-quality",
    measures,
  });
}
