import { createHash } from "node:crypto";
import {
  CreationWorkflowSchema,
  CreationSourceConflictSchema,
  type CreationSourceConflict,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  DiagnosisContentSchema,
  SeasonPlanContentSchema,
  EpisodeScriptContentSchema,
  AdaptationStrategyContentSchema,
} from "@dramaip/contracts/production";
import {
  CreativeFunnelFactSchema,
  canonicalCreativeMetricJSON,
  type CreativeFunnelFact,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeMetricMigration: PluginMigration = {
  id: "automation.0008.creative-metric-receipts",
  pluginId: "automation",
  version: "3.0.0-alpha.4",
  dependsOn: ["automation.0007.creation-workflows"],
  sql: `CREATE TABLE automation_creative_request_receipts (
    workflow_id TEXT PRIMARY KEY REFERENCES automation_creation_workflows(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL
  );
  CREATE TABLE automation_creative_candidate_receipts (
    workflow_id TEXT NOT NULL REFERENCES automation_creation_workflows(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL, content_fingerprint TEXT NOT NULL, value_json TEXT NOT NULL,
    PRIMARY KEY(workflow_id, candidate_id, content_fingerprint)
  );`,
};
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalCreativeMetricJSON(value)).digest("hex");
function descriptor(value: CreationWorkflow) {
  const operation = value.input.operation;
  const metric =
    operation === "chapter"
      ? "novel.chapter"
      : operation === "adaptation-diagnosis"
        ? "adaptation.diagnosis"
        : operation === "adaptation-strategy"
          ? "adaptation.strategy"
          : operation === "season-plan"
            ? "adaptation.season-plan"
            : operation === "episode-script"
              ? "adaptation.script"
              : undefined;
  const target =
    operation === "chapter"
      ? value.input.targetId
      : operation === "episode-script"
        ? value.episodeDevelopmentBasis?.episode.id
        : value.input.projectId;
  if (!metric || !target) return undefined;
  return {
    metric,
    workflowPath: operation === "chapter" ? "novel" : "adaptation",
    targetKey: digest([value.input.projectId, metric, target]),
  } as const;
}
function base(value: CreationWorkflow) {
  const target = descriptor(value);
  return target
    ? {
        ...target,
        eventVersion: 1 as const,
        projectId: value.input.projectId,
        workflowId: value.id,
        workflowVersion: value.version,
        requestedAt: value.createdAt,
        evidenceKind: "rule" as const,
        modelEvidence: "unknown" as const,
      }
    : undefined;
}
function append(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  fact: CreativeFunnelFact,
) {
  const envelope = {
    pluginId: "automation",
    aggregateType: "creation",
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: fact,
  };
  if (fact.kind === "request")
    tx.append({ ...envelope, type: "automation.creative-requested.v1" });
  else if (fact.kind === "candidate-ready")
    tx.append({ ...envelope, type: "automation.creative-candidate-ready.v1" });
  else if (fact.kind === "source-conflict")
    tx.append({ ...envelope, type: "automation.creative-source-conflict.v1" });
  else tx.append({ ...envelope, type: "automation.creative-metric-state.v1" });
}
export function recordCreativeRequest(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
) {
  const common = base(value);
  if (!common) return;
  const prior = tx
    .all<{ value_json: string }>(
      "SELECT value_json FROM automation_creation_workflows WHERE project_id = ? AND id <> ? AND json_extract(value_json, '$.input.operation') = ?",
      value.input.projectId,
      value.id,
      value.input.operation,
    )
    .map((row) =>
      descriptor(CreationWorkflowSchema.parse(JSON.parse(row.value_json))),
    )
    .filter((target) => target?.targetKey === common.targetKey).length;
  const parentWorkflowId = value.rebaseSource?.id ?? value.sourceWorkflowId;
  const fact = CreativeFunnelFactSchema.parse({
    ...common,
    kind: "request",
    targetAttempt: prior + 1,
    requestKind: value.rebaseSource
      ? "rebase"
      : parentWorkflowId
        ? "retry"
        : "new-request",
    ...(parentWorkflowId ? { parentWorkflowId } : {}),
    sourceVersions: value.sources.map(({ id, version }) => ({ id, version })),
  });
  tx.run(
    "INSERT INTO automation_creative_request_receipts VALUES (?, ?)",
    value.id,
    JSON.stringify(fact),
  );
  append(tx, value, fact);
}
export function recordCreativeCandidate(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
) {
  const common = base(value);
  // Historical workflows have no new request fact; do not fabricate a denominator.
  if (
    !common ||
    value.stage !== "awaiting-review" ||
    !value.output ||
    !value.previewId ||
    !tx.get(
      "SELECT workflow_id FROM automation_creative_request_receipts WHERE workflow_id = ?",
      value.id,
    )
  )
    return;
  const operation = value.input.operation;
  const material =
    operation === "chapter"
      ? value.output.content
      : operation === "adaptation-diagnosis"
        ? DiagnosisContentSchema.parse(value.output.items[0]?.data)
        : operation === "adaptation-strategy"
          ? AdaptationStrategyContentSchema.parse(value.output.items[0]?.data)
          : operation === "season-plan"
            ? SeasonPlanContentSchema.parse(value.output.items[0]?.data)
            : EpisodeScriptContentSchema.parse(value.output.items[0]?.data);
  const candidate = {
    id:
      value.diagnosisId ??
      value.adaptationStrategyId ??
      value.seasonPlanId ??
      value.previewId,
    contentFingerprint: digest(material),
    ...(operation === "adaptation-strategy"
      ? {
          selectionOptions: AdaptationStrategyContentSchema.parse(
            material,
          ).options.map((option) => ({
            id: option.id,
            contentFingerprint: digest(option),
          })),
        }
      : {}),
  };
  if (
    tx.get(
      "SELECT workflow_id FROM automation_creative_candidate_receipts WHERE workflow_id = ? AND candidate_id = ? AND content_fingerprint = ?",
      value.id,
      candidate.id,
      candidate.contentFingerprint,
    )
  )
    return;
  const fact = CreativeFunnelFactSchema.parse({
    ...common,
    kind: "candidate-ready",
    candidate,
  });
  tx.run(
    "INSERT INTO automation_creative_candidate_receipts VALUES (?, ?, ?, ?)",
    value.id,
    candidate.id,
    candidate.contentFingerprint,
    JSON.stringify(fact),
  );
  append(tx, value, fact);
}
export function recordCreativeMetricState(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  state: string,
) {
  const common = base(value);
  if (
    !common ||
    !tx.get(
      "SELECT workflow_id FROM automation_creative_request_receipts WHERE workflow_id = ?",
      value.id,
    )
  )
    return;
  const fact = CreativeFunnelFactSchema.parse({
    ...common,
    kind: "state",
    state,
  });
  append(tx, value, fact);
}

/** Bind to the original owned candidate receipt, not edited Preview contents. */
export function recordCreativeSourceConflict(
  tx: UnitOfWorkTransaction,
  value: CreationWorkflow,
  evidence: CreationSourceConflict,
) {
  const common = base(value);
  const parsed = CreationSourceConflictSchema.safeParse(evidence);
  if (
    !common ||
    !parsed.success ||
    value.stage !== "awaiting-review" ||
    parsed.data.projectId !== value.input.projectId ||
    parsed.data.workflowId !== value.id ||
    !tx.get(
      "SELECT workflow_id FROM automation_creative_request_receipts WHERE workflow_id = ?",
      value.id,
    )
  )
    return;
  // Missing legacy bindings never become fresh observations of the old run.
  // Explicit novel representations can refer to adopted summaries instead of
  // exposing every covered chapter in generic sources. Their original frozen
  // chapter identities remain authoritative; omitted/current directory entries
  // are never a substitute for those bindings.
  const selectedChapters =
    value.input.operation === "chapter" && value.narrativeContextBasis
      ? [
          ...value.narrativeContextBasis.chapters,
          ...(value.narrativeContextBasis.summaries ?? []).flatMap(
            (summary) => summary.chapters,
          ),
        ]
      : [];
  if (
    !parsed.data.changes.every(
      (change) =>
        (change.sourceKind === "author_intent" &&
          value.authorIntent?.state === "adopted" &&
          value.authorIntent.id === change.frozen.id &&
          value.authorIntent.version === change.frozen.version) ||
        (change.sourceKind === "chapter" &&
          selectedChapters.some(
            (chapter) =>
              chapter.id === change.frozen.id &&
              chapter.version === change.frozen.version,
          )) ||
        value.sources.some((source) => {
          const kind =
            source.kind === "author-intent"
              ? "author_intent"
              : ["characters", "outlines", "story-arcs"].includes(source.kind)
                ? "writing_resource"
                : source.kind;
          return (
            kind === change.sourceKind &&
            source.id === change.frozen.id &&
            source.version === change.frozen.version
          );
        }),
    )
  )
    return;
  const candidateId =
    value.diagnosisId ??
    value.adaptationStrategyId ??
    value.seasonPlanId ??
    value.previewId;
  if (!candidateId) return;
  const receipts = tx.all<{ value_json: string }>(
    "SELECT value_json FROM automation_creative_candidate_receipts WHERE workflow_id = ? AND candidate_id = ?",
    value.id,
    candidateId,
  );
  if (receipts.length !== 1) return;
  const candidate = CreativeFunnelFactSchema.parse(
    JSON.parse(receipts[0]!.value_json),
  );
  if (
    candidate.kind !== "candidate-ready" ||
    candidate.projectId !== common.projectId ||
    candidate.workflowId !== common.workflowId ||
    candidate.metric !== common.metric ||
    candidate.targetKey !== common.targetKey ||
    candidate.requestedAt !== common.requestedAt ||
    candidate.workflowVersion >= value.version
  )
    return;
  append(
    tx,
    value,
    CreativeFunnelFactSchema.parse({
      ...common,
      kind: "source-conflict",
      candidate: candidate.candidate,
      sourceConflict: parsed.data,
    }),
  );
}
