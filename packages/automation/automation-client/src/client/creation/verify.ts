import { manifestJSON, sha256Hex } from "./owner.ts";
import {
  value,
  type AgentsRemote,
  type AutomationRemote,
  type ChangePreview,
  type CreationExecutionReceipt,
  type CreationWorkflow,
  type PreviewRevisionEffort,
} from "./remote.ts";

/** The workflow fields an execution read is checked against. */
export type OriginalWorkflow = Pick<
  CreationWorkflow,
  "id" | "version" | "input" | "runIds" | "sourceWorkflowId"
>;

type Run = CreationExecutionReceipt["runs"][number];

/** One entry of a run's frozen context manifest. */
export interface ContextEntry {
  sourceKind: string;
  sourceId: string;
  sourceVersion: number | string;
  fieldPath: string;
  reason: string;
  estimatedTokens: number;
  included: boolean;
  value?: unknown;
}

/** The context a run was given, frozen when it started. */
export interface ContextSnapshot {
  id: string;
  projectId?: string;
  destination: unknown;
  tokenBudget: number;
  estimatedTokens: number;
  entries: ContextEntry[];
  finalPrompt: string;
  finalPromptSha256: string;
  manifestSha256: string;
}

/** A read whose answer does not belong to what was asked; the copy key says why. */
export class VerifyError extends Error {
  constructor(readonly problem: VerifyProblem) {
    super(problem);
  }
}

/** Why a read's answer was refused. */
export type VerifyProblem =
  | "execution.foreign"
  | "context.foreignRun"
  | "context.unrecorded"
  | "context.foreign"
  | "context.digest"
  | "context.moved"
  | "effort.foreignPreview"
  | "effort.single"
  | "effort.foreign"
  | "effort.digest";

const sameRuns = (
  receipt: CreationExecutionReceipt,
  runIds: readonly string[],
) =>
  JSON.stringify(receipt.runs.map((run: Run) => run.runId)) ===
  JSON.stringify(runIds);

/**
 * Read the stage runs of exactly this workflow version, in its run order.
 * @param automation - the `automation` Remote namespace.
 * @param workflow - the original workflow.
 */
export async function readExecution(
  automation: AutomationRemote,
  workflow: OriginalWorkflow,
): Promise<CreationExecutionReceipt> {
  const receipt = await value<CreationExecutionReceipt>(
    automation.creationExecution(workflow.id, {
      projectId: workflow.input.projectId,
    }),
  );
  if (
    receipt.workflowId !== workflow.id ||
    receipt.projectId !== workflow.input.projectId ||
    receipt.operation !== workflow.input.operation ||
    receipt.version !== workflow.version ||
    receipt.sourceWorkflowId !== workflow.sourceWorkflowId ||
    !sameRuns(receipt, workflow.runIds) ||
    receipt.runs.some(
      (run: Run) =>
        run.state === "recorded" &&
        run.execution.engineKind !== workflow.input.engineKind,
    )
  )
    throw new VerifyError("execution.foreign");
  return receipt;
}

/**
 * Read the context one stage run was given: the snapshot its run records,
 * whose bytes match their recorded digests, while the run still binds it.
 * @param remotes - the `automation` and `agents` Remote namespaces.
 * @param workflow - the original workflow.
 * @param runId - one of its runs.
 */
export async function readRunContext(
  remotes: { automation: AutomationRemote; agents: AgentsRemote },
  workflow: OriginalWorkflow,
  runId: string,
): Promise<ContextSnapshot> {
  if (!workflow.runIds.includes(runId))
    throw new VerifyError("context.foreignRun");
  const receipt = await readExecution(remotes.automation, workflow);
  const run = receipt.runs.find((item: Run) => item.runId === runId);
  if (run?.state !== "recorded" || !run.execution.contextSnapshotId)
    throw new VerifyError("context.unrecorded");
  const snapshot = await value<ContextSnapshot>(
    remotes.agents.contextGetRunSnapshot(runId),
  );
  if (
    snapshot.id !== run.execution.contextSnapshotId ||
    snapshot.projectId !== workflow.input.projectId
  )
    throw new VerifyError("context.foreign");
  if (
    (await sha256Hex(snapshot.finalPrompt)) !== snapshot.finalPromptSha256 ||
    (await sha256Hex(
      manifestJSON({
        projectId: snapshot.projectId,
        destination: snapshot.destination,
        tokenBudget: snapshot.tokenBudget,
        entries: snapshot.entries,
      }),
    )) !== snapshot.manifestSha256
  )
    throw new VerifyError("context.digest");
  const observed = await readExecution(remotes.automation, workflow);
  const current = observed.runs.find((item: Run) => item.runId === runId);
  if (
    current?.state !== "recorded" ||
    current.phase !== run.phase ||
    current.execution.contextSnapshotId !== snapshot.id
  )
    throw new VerifyError("context.moved");
  return snapshot;
}

/**
 * Read the saved text revisions of one chapter draft, checked against the
 * draft's identity and the digest of its current text.
 * @param automation - the `automation` Remote namespace.
 * @param original - the draft's project, preview and task.
 */
export async function readRevisionEffort(
  automation: AutomationRemote,
  original: {
    projectId: string;
    previewId: string;
    taskId?: string | undefined;
  },
): Promise<PreviewRevisionEffort> {
  const preview = await value<ChangePreview>(
    automation.changePreviewsGet(original.previewId),
  );
  if (
    preview.id !== original.previewId ||
    preview.projectId !== original.projectId ||
    (original.taskId !== undefined && preview.taskId !== original.taskId)
  )
    throw new VerifyError("effort.foreignPreview");
  const chapter = preview.targets.length === 1 ? preview.targets[0] : undefined;
  if (chapter?.kind !== "chapter") throw new VerifyError("effort.single");
  const result = await value<PreviewRevisionEffort>(
    automation.changePreviewsRevisionEffort(preview.id, {
      projectId: preview.projectId,
      contentHash: preview.contentHash,
    }),
  );
  if (
    result.previewId !== preview.id ||
    result.projectId !== preview.projectId ||
    result.chapterId !== chapter.id ||
    result.taskId !== preview.taskId ||
    result.contentHash !== preview.contentHash ||
    result.status !== preview.status
  )
    throw new VerifyError("effort.foreign");
  const content = chapter.patch.content;
  if (
    typeof content !== "string" ||
    result.candidateSha256 !== (await sha256Hex(content))
  )
    throw new VerifyError("effort.digest");
  return result;
}
