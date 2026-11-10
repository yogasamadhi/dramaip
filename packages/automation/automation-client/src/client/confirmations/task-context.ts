import { value } from "../creation/remote.ts";
import { readTaskProviderReview } from "./provider-review.ts";
import {
  fields,
  MismatchError,
  type ChangePreview,
  type CreationWorkflow,
  type ProviderActionPreview,
  type RevisionPreview,
  type Task,
  type TaskRemotes,
} from "./remote.ts";

const KEYS = ["projectId", "taskId", "workflowId", "revisionId"];

/**
 * What a task center link names, as a stable key.
 * @param search - the route's query.
 */
export function taskConfirmationKey(search: string): string {
  const params = new URLSearchParams(search);
  return JSON.stringify(KEYS.map((key) => [key, params.getAll(key)]));
}

function pointer(
  result: Record<string, unknown>,
  key: string,
): string | undefined {
  const target = result[key];
  if (target === undefined) return undefined;
  const id = fields(target).id;
  if (typeof id !== "string" || !id.trim())
    throw new MismatchError("mismatch.previewPointer");
  return id;
}

/**
 * The records a task's result points at, as a stable key.
 * @param result - the task's result.
 */
export function taskResultReferenceKey(result: unknown): string {
  const value = fields(result);
  return JSON.stringify([
    value.creationWorkflowId,
    value.providerActionPreviewId,
    ...["changePreview", "revisionPreview", "providerActionPreview"].map(
      (key) => fields(value[key]).id,
    ),
  ]);
}

interface Chapter {
  id: string;
  projectId: string;
  version: number;
}

/**
 * A task whose result previews are read again from their owners and
 * checked against the task: its creation run, change preview, chapter
 * revision and provider call. A pending revision whose chapter moved on is
 * shown as conflicted.
 * @param remotes - the `automation` and `writing` namespaces.
 * @param task - the task as listed.
 */
export async function readActualTaskResult(
  remotes: TaskRemotes,
  task: Task,
): Promise<Task> {
  if (
    !task.result ||
    typeof task.result !== "object" ||
    Array.isArray(task.result)
  )
    return task;
  const result = fields(task.result);
  if (result.creationWorkflowId !== undefined) {
    if (
      typeof result.creationWorkflowId !== "string" ||
      !result.creationWorkflowId.trim()
    )
      throw new MismatchError("mismatch.runPointer");
    const workflow = await value<CreationWorkflow>(
      remotes.automation.creationGet(result.creationWorkflowId),
    );
    if (
      !task.projectId ||
      workflow.id !== result.creationWorkflowId ||
      workflow.taskId !== task.id ||
      workflow.input.projectId !== task.projectId
    )
      throw new MismatchError("mismatch.runOwner");
  }
  const changeId = pointer(result, "changePreview");
  const revisionId = pointer(result, "revisionPreview");
  const embeddedProviderId = pointer(result, "providerActionPreview");
  const providerId = result.providerActionPreviewId ?? embeddedProviderId;
  if (
    providerId !== undefined &&
    (typeof providerId !== "string" ||
      !providerId.trim() ||
      (embeddedProviderId && embeddedProviderId !== providerId))
  )
    throw new MismatchError("mismatch.providerConflict");
  const [change, revision, provider] = await Promise.all([
    changeId
      ? value<ChangePreview>(remotes.automation.changePreviewsGet(changeId))
      : undefined,
    revisionId
      ? value<RevisionPreview>(remotes.automation.revisionsGet(revisionId))
      : undefined,
    typeof providerId === "string"
      ? readTaskProviderReview(remotes, {
          id: providerId,
          projectId: task.projectId ?? "",
          task,
        })
      : undefined,
  ]);
  if (
    change &&
    (change.id !== changeId ||
      !task.projectId ||
      change.projectId !== task.projectId ||
      (change.taskId && change.taskId !== task.id))
  )
    throw new MismatchError("mismatch.changeOwner");
  let currentRevision: RevisionPreview | undefined = revision;
  if (revision) {
    const chapter = await value<Chapter>(
      remotes.writing.chaptersGet(revision.chapterId),
    );
    if (
      revision.id !== revisionId ||
      !task.projectId ||
      chapter.id !== revision.chapterId ||
      chapter.projectId !== task.projectId
    )
      throw new MismatchError("mismatch.revisionOwner");
    if (
      revision.status === "pending" &&
      chapter.version !== revision.baseVersion
    )
      currentRevision = { ...revision, status: "conflicted" };
  }
  return {
    ...task,
    result: {
      ...result,
      ...(change ? { changePreview: change } : {}),
      ...(currentRevision ? { revisionPreview: currentRevision } : {}),
      ...(provider ? { providerActionPreview: provider } : {}),
    },
  };
}

/** The objects a task center link names, each checked against the others. */
export interface TaskConfirmationContext {
  task: Task | undefined;
  workflow: CreationWorkflow | undefined;
  revision: RevisionPreview | undefined;
}

/**
 * Read the task, creation run or chapter revision a task center link names,
 * and refuse the link when they do not belong to its project or to each
 * other. No reference is ignored.
 * @param remotes - the `automation`, `workspace` and `writing` namespaces.
 * @param projectId - the project the link scopes, if any.
 * @param search - the route's query.
 */
export async function readTaskConfirmationContext(
  remotes: TaskRemotes,
  projectId: string | undefined,
  search: string,
): Promise<TaskConfirmationContext> {
  const params = new URLSearchParams(search);
  for (const key of KEYS) {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length && !values[0]?.trim()))
      throw new MismatchError("mismatch.linkRepeated");
  }
  const taskId = params.get("taskId");
  const workflowId = params.get("workflowId");
  const revisionId = params.get("revisionId");
  if (workflowId && revisionId) throw new MismatchError("mismatch.linkMixed");
  if (projectId) {
    const project = await value<{ id: string }>(
      remotes.workspace.projectsGet(projectId),
    );
    if (project.id !== projectId)
      throw new MismatchError("mismatch.linkProject");
  }
  const [task, workflow, revision] = await Promise.all([
    taskId
      ? value<Task[]>(remotes.automation.tasksList()).then((items) =>
          items.find((item) => item.id === taskId),
        )
      : undefined,
    workflowId
      ? value<CreationWorkflow>(remotes.automation.creationGet(workflowId))
      : undefined,
    revisionId
      ? value<RevisionPreview>(remotes.automation.revisionsGet(revisionId))
      : undefined,
  ]);
  if (
    taskId &&
    (!task || task.id !== taskId || (projectId && task.projectId !== projectId))
  )
    throw new MismatchError("mismatch.linkTask");
  const taskResult = fields(task?.result);
  if (
    workflowId &&
    (!workflow ||
      workflow.id !== workflowId ||
      (projectId && workflow.input.projectId !== projectId) ||
      (task &&
        (workflow.taskId !== task.id ||
          workflow.input.projectId !== task.projectId ||
          (taskResult.creationWorkflowId !== undefined &&
            taskResult.creationWorkflowId !== workflowId))))
  )
    throw new MismatchError("mismatch.linkRun");
  if (revision) {
    const chapter = await value<Chapter>(
      remotes.writing.chaptersGet(revision.chapterId),
    );
    if (
      revision.id !== revisionId ||
      chapter.id !== revision.chapterId ||
      (projectId && chapter.projectId !== projectId) ||
      (task &&
        (task.projectId !== chapter.projectId ||
          pointer(taskResult, "revisionPreview") !== revision.id))
    )
      throw new MismatchError("mismatch.linkRevision");
    if (
      revision.status === "pending" &&
      chapter.version !== revision.baseVersion
    )
      return {
        task,
        workflow,
        revision: { ...revision, status: "conflicted" },
      };
  }
  return {
    task: task ? await readActualTaskResult(remotes, task) : undefined,
    workflow,
    revision,
  };
}

const PREVIEW_STATES = ["pending", "committed", "discarded", "conflicted"];
const PROVIDER_STATES = ["pending", "executed", "discarded", "expired"];
const PROVIDER_KINDS = ["image", "audio", "video", "remote_render"];

const strings = (record: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => typeof record[key] === "string");

/**
 * The previews a checked task result carries, each only when it has the
 * shape of its kind.
 * @param task - a task read by {@link readActualTaskResult}.
 */
export function taskPreviews(task: Task | undefined): {
  revision: RevisionPreview | undefined;
  change: ChangePreview | undefined;
  provider: ProviderActionPreview | undefined;
} {
  const result = fields(task?.result);
  const revision = fields(result.revisionPreview);
  const change = fields(result.changePreview);
  const provider = fields(result.providerActionPreview);
  return {
    revision:
      strings(revision, [
        "id",
        "chapterId",
        "proposedContent",
        "rationale",
        "createdAt",
      ]) &&
      typeof revision.baseVersion === "number" &&
      PREVIEW_STATES.includes(String(revision.status))
        ? (revision as unknown as RevisionPreview)
        : undefined,
    change:
      strings(change, [
        "id",
        "projectId",
        "rationale",
        "contentHash",
        "createdAt",
      ]) &&
      Array.isArray(change.targets) &&
      PREVIEW_STATES.includes(String(change.status))
        ? (change as unknown as ChangePreview)
        : undefined,
    provider:
      strings(provider, ["id", "projectId", "providerId", "createdAt"]) &&
      PROVIDER_KINDS.includes(String(provider.kind)) &&
      PROVIDER_STATES.includes(String(provider.status)) &&
      fields(provider.parameters) === provider.parameters
        ? (provider as unknown as ProviderActionPreview)
        : undefined,
  };
}

const RESULT_TEXT_KEYS = [
  "summary",
  "suggestedAction",
  "nextSteps",
  "text",
  "content",
  "output",
  "message",
  "result",
  "parts",
];

/**
 * The first text a task result carries, looked for by the keys a result
 * usually names it with, then anywhere five levels deep.
 * @param result - the task's result.
 */
export function taskResultText(result: unknown): string | undefined {
  const seen = new Set<unknown>();
  const find = (current: unknown, depth: number): string | undefined => {
    if (typeof current === "string" && current.trim()) return current.trim();
    if (
      !current ||
      typeof current !== "object" ||
      depth > 5 ||
      seen.has(current)
    )
      return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = find(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = current as Record<string, unknown>;
    for (const key of RESULT_TEXT_KEYS) {
      const found = find(record[key], depth + 1);
      if (found) return found;
    }
    for (const nested of Object.values(record)) {
      const found = find(nested, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return find(result, 0);
}
