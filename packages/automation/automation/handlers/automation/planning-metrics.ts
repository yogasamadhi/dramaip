import { createHash } from "node:crypto";
import {
  NarrativePlanningOperationSchema,
  CreationSourceConflictSchema,
  type CreationSourceConflict,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  CreativePlanningFunnelFactSchema,
  creativePlanningMaterial,
  canonicalCreativeMetricJSON,
  type CreativePlanningFunnelFact,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
export const planningMetricMigration: PluginMigration = {
  id: "automation.0010.planning-metric-receipts",
  pluginId: "automation",
  version: "3.0.0-alpha.4",
  dependsOn: ["automation.0009.creative-continuation-receipts"],
  sql: `CREATE TABLE automation_planning_request_receipts (
 workflow_id TEXT PRIMARY KEY REFERENCES automation_creation_workflows(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 operation TEXT NOT NULL,target_key TEXT NOT NULL,root_workflow_id TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json))
 ); CREATE INDEX automation_planning_request_target ON automation_planning_request_receipts(project_id,operation,target_key);
 CREATE TABLE automation_planning_candidate_receipts (
 workflow_id TEXT NOT NULL REFERENCES automation_creation_workflows(id) ON DELETE CASCADE,
 candidate_id TEXT NOT NULL,content_fingerprint TEXT NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 PRIMARY KEY(workflow_id,candidate_id,content_fingerprint)
 );`,
};
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalCreativeMetricJSON(value)).digest("hex");
function operation(value: CreationWorkflow) {
  const parsed = NarrativePlanningOperationSchema.safeParse(
    value.input.operation,
  );
  return parsed.success &&
    value.narrativePlanningBasis?.operation === parsed.data &&
    value.narrativePlanningBasis.projectId === value.input.projectId
    ? parsed.data
    : undefined;
}
function request(tx: UnitOfWorkTransaction, id: string) {
  const row = tx.get<{
    project_id: string;
    operation: string;
    target_key: string;
    root_workflow_id: string;
    value_json: string;
  }>(
    "SELECT * FROM automation_planning_request_receipts WHERE workflow_id=?",
    id,
  );
  if (!row) return undefined;
  const fact = CreativePlanningFunnelFactSchema.parse(
    JSON.parse(row.value_json),
  );
  if (
    fact.kind !== "request" ||
    fact.workflowId !== id ||
    fact.projectId !== row.project_id ||
    fact.operation !== row.operation ||
    fact.targetKey !== row.target_key ||
    fact.rootWorkflowId !== row.root_workflow_id ||
    fact.targetKey !==
      digest([
        fact.projectId,
        fact.operation,
        "independent-planning-request-v1",
        fact.rootWorkflowId,
      ])
  )
    throw new Error("The owned original planning receipt is invalid.");
  return fact;
}
function base(
  value: CreationWorkflow,
  rootWorkflowId: string,
  targetKey: string,
) {
  const op = operation(value);
  return op
    ? {
        eventVersion: 1 as const,
        projectId: value.input.projectId,
        workflowId: value.id,
        workflowVersion: value.version,
        operation: op,
        rootWorkflowId,
        targetKey,
        requestedAt: value.createdAt,
        evidenceKind: "rule" as const,
        modelEvidence: "unknown" as const,
      }
    : undefined;
}
function ownedBase(tx: UnitOfWorkTransaction, value: CreationWorkflow) {
  const original = request(tx, value.id);
  const common = original
    ? base(value, original.rootWorkflowId, original.targetKey)
    : undefined;
  if (!common || !original) return undefined;
  if (
    original.projectId !== common.projectId ||
    original.operation !== common.operation ||
    original.requestedAt !== common.requestedAt
  )
    throw new Error(
      "A planning workflow cannot replace its original owned request scope.",
    );
  return common;
}
function append(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  fact: CreativePlanningFunnelFact,
) {
  const envelope = {
    pluginId: "automation",
    aggregateType: "creation",
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: fact,
  };
  if (fact.kind === "request")
    tx.append({ ...envelope, type: "automation.planning-requested.v1" });
  else if (fact.kind === "candidate-ready")
    tx.append({ ...envelope, type: "automation.planning-candidate-ready.v1" });
  else if (fact.kind === "source-conflict")
    tx.append({ ...envelope, type: "automation.planning-source-conflict.v1" });
  else tx.append({ ...envelope, type: "automation.planning-metric-state.v1" });
}
export function recordPlanningRequest(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
) {
  const op = operation(value);
  if (!op) return;
  const parentId = value.rebaseSource?.id ?? value.sourceWorkflowId;
  const parent = parentId ? request(tx, parentId) : undefined;
  // An unrecorded historical parent is not a newly observed original request.
  if (
    parentId &&
    (!parent ||
      parent.projectId !== value.input.projectId ||
      parent.operation !== op)
  )
    return;
  const rootWorkflowId = parent?.rootWorkflowId ?? value.id;
  const targetKey =
    parent?.targetKey ??
    digest([
      value.input.projectId,
      op,
      "independent-planning-request-v1",
      value.id,
    ]);
  const prior =
    tx.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM automation_planning_request_receipts WHERE project_id=? AND operation=? AND target_key=?",
      value.input.projectId,
      op,
      targetKey,
    )?.total ?? 0;
  const fact = CreativePlanningFunnelFactSchema.parse({
    ...base(value, rootWorkflowId, targetKey),
    kind: "request",
    targetAttempt: prior + 1,
    requestKind: value.rebaseSource
      ? "rebase"
      : parentId
        ? "retry"
        : "new-request",
    ...(parentId ? { parentWorkflowId: parentId } : {}),
    sourceVersions: planningSourceVersions(value),
  });
  tx.run(
    "INSERT INTO automation_planning_request_receipts VALUES (?,?,?,?,?,?)",
    value.id,
    value.input.projectId,
    op,
    targetKey,
    rootWorkflowId,
    JSON.stringify(fact),
  );
  append(tx, value, fact);
}
export function recordPlanningCandidate(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
) {
  const common = ownedBase(tx, value);
  if (
    !common ||
    value.stage !== "awaiting-review" ||
    !value.output ||
    !value.previewId
  )
    return;
  const candidate = {
    id: value.previewId,
    contentFingerprint: digest(creativePlanningMaterial(value.output.items)),
  };
  if (
    tx.get(
      "SELECT workflow_id FROM automation_planning_candidate_receipts WHERE workflow_id=? AND candidate_id=? AND content_fingerprint=?",
      value.id,
      candidate.id,
      candidate.contentFingerprint,
    )
  )
    return;
  const fact = CreativePlanningFunnelFactSchema.parse({
    ...common,
    kind: "candidate-ready",
    candidate,
  });
  tx.run(
    "INSERT INTO automation_planning_candidate_receipts VALUES (?,?,?,?)",
    value.id,
    candidate.id,
    candidate.contentFingerprint,
    JSON.stringify(fact),
  );
  append(tx, value, fact);
}
export function recordPlanningMetricState(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  state: string,
) {
  const common = ownedBase(tx, value);
  if (!common) return;
  append(
    tx,
    value,
    CreativePlanningFunnelFactSchema.parse({ ...common, kind: "state", state }),
  );
}

function planningSourceVersions(value: CreationWorkflow) {
  const versions = new Map<string, number>();
  for (const source of [
    ...value.sources,
    ...(value.narrativePlanningBasis?.request.chapterScope.chapters ?? []),
  ]) {
    if (versions.has(source.id) && versions.get(source.id) !== source.version)
      throw new Error("Original planning source versions disagree.");
    versions.set(source.id, source.version);
  }
  return [...versions].map(([id, version]) => ({ id, version }));
}

/** Only original owner-observed metadata, never a generic rejection or the
 * current directory. This fact shares the real rejection state transaction. */
export function recordPlanningSourceConflict(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  evidence: CreationSourceConflict,
) {
  const common = ownedBase(tx, value),
    original = request(tx, value.id);
  const parsed = CreationSourceConflictSchema.safeParse(evidence);
  if (
    !common ||
    !original ||
    !parsed.success ||
    value.stage !== "awaiting-review" ||
    !value.previewId ||
    !value.output ||
    parsed.data.projectId !== value.input.projectId ||
    parsed.data.workflowId !== value.id
  )
    return;
  const selected =
    value.narrativePlanningBasis?.request.chapterScope.chapters ?? [];
  if (
    !parsed.data.changes.every(
      (change) =>
        original.sourceVersions.some(
          (source) =>
            source.id === change.frozen.id &&
            source.version === change.frozen.version,
        ) &&
        ((change.sourceKind === "chapter" &&
          selected.some(
            (source) =>
              source.id === change.frozen.id &&
              source.version === change.frozen.version,
          )) ||
          (change.sourceKind === "author_intent" &&
            value.authorIntent?.state === "adopted" &&
            value.authorIntent.id === change.frozen.id &&
            value.authorIntent.version === change.frozen.version) ||
          value.sources.some(
            (source) =>
              (source.kind === "author-intent"
                ? "author_intent"
                : ["characters", "outlines", "story-arcs"].includes(source.kind)
                  ? "writing_resource"
                  : source.kind) === change.sourceKind &&
              source.id === change.frozen.id &&
              source.version === change.frozen.version,
          )),
    )
  )
    return;
  const rows = tx.all<{ value_json: string }>(
    "SELECT value_json FROM automation_planning_candidate_receipts WHERE workflow_id=? AND candidate_id=?",
    value.id,
    value.previewId,
  );
  if (rows.length !== 1) return;
  const candidate = CreativePlanningFunnelFactSchema.parse(
    JSON.parse(rows[0]!.value_json),
  );
  if (
    candidate.kind !== "candidate-ready" ||
    candidate.projectId !== common.projectId ||
    candidate.workflowId !== common.workflowId ||
    candidate.operation !== common.operation ||
    candidate.targetKey !== common.targetKey ||
    candidate.rootWorkflowId !== common.rootWorkflowId ||
    candidate.requestedAt !== common.requestedAt ||
    candidate.workflowVersion >= value.version ||
    candidate.candidate.contentFingerprint !==
      digest(creativePlanningMaterial(value.output.items))
  )
    return;
  append(
    tx,
    value,
    CreativePlanningFunnelFactSchema.parse({
      ...common,
      kind: "source-conflict",
      candidate: candidate.candidate,
      sourceConflict: parsed.data,
    }),
  );
}
