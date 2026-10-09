import { createHash } from "node:crypto";
import {
  ChangePreviewSchema,
  type ChangePreview,
} from "@dramaip/contracts/automation";
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";
import {
  CreativeFunnelFactSchema,
  NovelRevisionFactSchema,
  canonicalCreativeMetricJSON,
  type NovelRevisionFact,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  chapterCandidate,
  readCandidateRevisionEffort,
} from "./preview-revisions.js";
export const previewRevisionEventMigration: PluginMigration = {
  id: "automation.0012.preview-revision-event-baselines",
  pluginId: "automation",
  version: "3.0.0-alpha.4",
  dependsOn: ["automation.0011.preview-revision-journal"],
  sql: `CREATE TABLE automation_preview_revision_event_baselines (
    preview_id TEXT PRIMARY KEY REFERENCES automation_change_previews(id) ON DELETE CASCADE,
    coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial'))
  );`,
};
const fingerprint = (content: string) =>
  createHash("sha256")
    .update(canonicalCreativeMetricJSON(content))
    .digest("hex");
export function recordCandidateRevisionEvent(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
  kind: NovelRevisionFact["kind"],
  sequence: number,
  before?: ChangePreview,
) {
  const chapter = chapterCandidate(value);
  if (!chapter) return;
  const diff = value.targets[0]!.displayDiff;
  const workflowId =
    diff && typeof diff === "object" && "creationWorkflowId" in diff
      ? diff.creationWorkflowId
      : undefined;
  if (typeof workflowId !== "string") return;
  const row = tx.get<{ value_json: string }>(
    "SELECT value_json FROM automation_creation_workflows WHERE id=?",
    workflowId,
  );
  const request = tx.get<{ value_json: string }>(
    "SELECT value_json FROM automation_creative_request_receipts WHERE workflow_id=?",
    workflowId,
  );
  if (!row || !request) return;
  const workflow = CreationWorkflowSchema.parse(JSON.parse(row.value_json)),
    original = CreativeFunnelFactSchema.parse(JSON.parse(request.value_json));
  if (
    workflow.input.operation !== "chapter" ||
    workflow.input.projectId !== value.projectId ||
    workflow.input.targetId !== chapter.chapterId ||
    workflow.taskId !== value.taskId ||
    original.kind !== "request" ||
    original.metric !== "novel.chapter" ||
    original.workflowId !== workflowId ||
    original.projectId !== value.projectId
  )
    throw new Error("The original revision request scope is invalid.");
  const load = (id: string) => {
    const r = tx.get<{
      id: string;
      project_id: string;
      task_id: string | null;
      status: string;
      targets_json: string;
      content_hash: string;
      rationale: string;
      created_at: string;
    }>("SELECT * FROM automation_change_previews WHERE id=?", id);
    return r
      ? ChangePreviewSchema.parse({
          id: r.id,
          projectId: r.project_id,
          ...(r.task_id ? { taskId: r.task_id } : {}),
          status: r.status,
          targets: JSON.parse(r.targets_json),
          contentHash: r.content_hash,
          rationale: r.rationale,
          createdAt: r.created_at,
        })
      : undefined;
  };
  const effort = readCandidateRevisionEffort(tx, value, load)!;
  const prior = tx.get<{ coverage: NovelRevisionFact["coverage"] }>(
    "SELECT coverage FROM automation_preview_revision_event_baselines WHERE preview_id=?",
    value.id,
  );
  const source =
    before &&
    tx.get<{ coverage: NovelRevisionFact["coverage"] }>(
      "SELECT coverage FROM automation_preview_revision_event_baselines WHERE preview_id=?",
      before.id,
    );
  const coverage =
    prior?.coverage ??
    ((kind === "initial" &&
      !workflow.rebaseSource &&
      !workflow.recordMergeSource) ||
    (kind === "rebase" && source?.coverage === "complete")
      ? "complete"
      : "partial");
  if (!prior)
    tx.run(
      "INSERT INTO automation_preview_revision_event_baselines VALUES (?,?)",
      value.id,
      coverage,
    );
  const originalChapter = before && chapterCandidate(before);
  const fact = NovelRevisionFactSchema.parse({
    eventVersion: 1,
    projectId: value.projectId,
    workflowId,
    workflowVersion: workflow.version,
    targetKey: original.targetKey,
    chapterId: chapter.chapterId,
    previewId: value.id,
    rootPreviewId: effort.rootPreviewId,
    sequence,
    kind,
    coverage: effort.coverage === "complete" ? coverage : "partial",
    afterFingerprint: fingerprint(chapter.content),
    ...(originalChapter
      ? { beforeFingerprint: fingerprint(originalChapter.content) }
      : {}),
    ...(kind === "rebase" && before ? { sourcePreviewId: before.id } : {}),
    evidenceKind: "rule",
    qualityState: "unverified",
  });
  tx.append({
    type: "automation.chapter-candidate-revision-recorded.v1",
    pluginId: "automation",
    aggregateType: "change-preview",
    aggregateId: value.id,
    aggregateVersion: sequence,
    payload: JSON.parse(JSON.stringify(fact)),
  });
}
