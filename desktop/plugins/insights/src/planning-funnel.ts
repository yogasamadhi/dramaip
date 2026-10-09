import { createHash } from "node:crypto";
import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_PLANNING_FUNNEL_EVENTS,
  CreativePlanningFunnelRecordSchema,
  CreativePlanningFunnelFactSchema,
  canonicalCreativeMetricJSON,
  measureCreativePlanningFunnelRecords,
} from "@dramaip/contracts/insights";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";
import { readCreativePlanningAdoptions } from "./planning-adoptions.js";
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalCreativeMetricJSON(value)).digest("hex");
function readPlanningFunnel(tx: UnitOfWorkTransaction, projectId: string) {
  return tx
    .all<{
      event_id: string;
      source_cursor: number;
      project_id: string;
      workflow_id: string;
      value_json: string;
    }>(
      "SELECT * FROM insights_creative_planning_funnel WHERE project_id=? ORDER BY source_cursor",
      projectId,
    )
    .map((row) => {
      const record = CreativePlanningFunnelRecordSchema.parse(
        JSON.parse(row.value_json),
      );
      if (
        record.fact.projectId !== projectId ||
        row.project_id !== projectId ||
        record.fact.workflowId !== row.workflow_id ||
        record.eventId !== row.event_id ||
        record.cursor !== row.source_cursor ||
        record.fact.targetKey !==
          digest([
            projectId,
            record.fact.operation,
            "independent-planning-request-v1",
            record.fact.rootWorkflowId,
          ])
      )
        throw new Error(
          "Original planning funnel scope, envelope and root cannot be replaced in storage.",
        );
      return record;
    });
}
export function projectCreativePlanningFunnel(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
) {
  const fact = CreativePlanningFunnelFactSchema.parse(event.payload);
  const expected =
    fact.kind === "request"
      ? CREATIVE_PLANNING_FUNNEL_EVENTS.request
      : fact.kind === "candidate-ready"
        ? CREATIVE_PLANNING_FUNNEL_EVENTS.candidate
        : fact.kind === "source-conflict"
          ? CREATIVE_PLANNING_FUNNEL_EVENTS.sourceConflict
          : CREATIVE_PLANNING_FUNNEL_EVENTS.state;
  if (
    event.type !== expected ||
    event.pluginId !== "automation" ||
    event.aggregateType !== "creation" ||
    event.aggregateId !== fact.workflowId ||
    event.aggregateVersion !== fact.workflowVersion ||
    fact.targetKey !==
      digest([
        fact.projectId,
        fact.operation,
        "independent-planning-request-v1",
        fact.rootWorkflowId,
      ])
  )
    throw new Error(
      "Planning funnel facts must match their actual owned request, root and envelope.",
    );
  const record = CreativePlanningFunnelRecordSchema.parse({
    fact,
    eventId: event.eventId,
    cursor: event.cursor,
    occurredAt: event.occurredAt,
  });
  const existing = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_creative_planning_funnel WHERE event_id=? OR source_cursor=?",
    event.eventId,
    event.cursor,
  );
  if (existing) {
    if (existing.value_json !== JSON.stringify(record))
      throw new Error(
        "An observed planning funnel fact cannot change on replay.",
      );
    return;
  }
  const prior = readPlanningFunnel(tx, fact.projectId);
  if (fact.kind === "request") {
    if (
      prior.some(
        (item) =>
          item.fact.kind === "request" &&
          item.fact.workflowId === fact.workflowId,
      )
    )
      throw new Error(
        "A planning workflow has one immutable original request.",
      );
    const previous = prior.filter(
      (item) =>
        item.fact.kind === "request" && item.fact.targetKey === fact.targetKey,
    );
    if (fact.targetAttempt !== previous.length + 1)
      throw new Error(
        "Planning retries cannot reset or invent request attempts.",
      );
    if (fact.requestKind !== "new-request") {
      const parent = prior.find(
        (item) =>
          item.fact.kind === "request" &&
          item.fact.workflowId === fact.parentWorkflowId,
      );
      if (
        !parent ||
        parent.cursor >= event.cursor ||
        parent.fact.operation !== fact.operation ||
        parent.fact.rootWorkflowId !== fact.rootWorkflowId ||
        parent.fact.targetKey !== fact.targetKey
      )
        throw new Error(
          "A planning retry requires its exact actually recorded prior request.",
        );
    }
  } else {
    const request = prior.find(
      (item) =>
        item.fact.kind === "request" &&
        item.fact.workflowId === fact.workflowId,
    );
    if (
      !request ||
      request.cursor >= event.cursor ||
      request.fact.operation !== fact.operation ||
      request.fact.rootWorkflowId !== fact.rootWorkflowId ||
      request.fact.targetKey !== fact.targetKey ||
      request.fact.requestedAt !== fact.requestedAt ||
      request.fact.workflowVersion >= fact.workflowVersion
    )
      throw new Error(
        "Planning candidates and states require their original committed request, never legacy backfill.",
      );
    if (
      fact.kind === "candidate-ready" &&
      prior.some(
        (item) =>
          item.fact.kind === "candidate-ready" &&
          item.fact.workflowId === fact.workflowId,
      )
    )
      throw new Error(
        "A planning workflow has one actual immutable first review candidate; replacement requires a new request.",
      );
    if (fact.kind === "source-conflict") {
      const candidate = prior.find(
        (item) =>
          item.fact.kind === "candidate-ready" &&
          item.fact.workflowId === fact.workflowId,
      );
      const rejected = prior.some(
        (item) =>
          item.fact.kind === "state" &&
          item.fact.state === "adoption-rejected" &&
          item.fact.workflowId === fact.workflowId &&
          item.fact.workflowVersion === fact.workflowVersion &&
          item.cursor < event.cursor &&
          candidate &&
          item.cursor > candidate.cursor,
      );
      if (
        request.fact.kind !== "request" ||
        !candidate ||
        candidate.fact.kind !== "candidate-ready" ||
        !rejected ||
        candidate.fact.workflowVersion >= fact.workflowVersion ||
        candidate.fact.operation !== fact.operation ||
        canonicalCreativeMetricJSON(candidate.fact.candidate) !==
          canonicalCreativeMetricJSON(fact.candidate) ||
        !fact.sourceConflict.changes.every(
          (change) =>
            request.fact.kind === "request" &&
            request.fact.sourceVersions.some(
              (source) =>
                source.id === change.frozen.id &&
                source.version === change.frozen.version,
            ),
        )
      )
        throw new Error(
          "Planning conflicts require the exact original source bindings, candidate and committed rejection version, never inferred 409s.",
        );
    }
  }
  tx.run(
    "INSERT INTO insights_creative_planning_funnel VALUES (?,?,?,?,?)",
    event.eventId,
    event.cursor,
    fact.projectId,
    fact.workflowId,
    JSON.stringify(record),
  );
}
export function measureCreativePlanningFunnel(
  tx: UnitOfWorkTransaction,
  projectId: string,
) {
  const facts = readPlanningFunnel(tx, projectId);
  const batches = readCreativePlanningAdoptions(tx, projectId);
  return measureCreativePlanningFunnelRecords(facts, batches);
}
