import type { StudioClient } from "@dramaip/client";
import type { Task } from "@dramaip/contracts/product";
import { readProviderActionReview } from "./provider-action-review";

const keys = ["projectId", "taskId", "workflowId", "revisionId"];
export function taskConfirmationKey(search: string): string {
  const params = new URLSearchParams(search);
  return JSON.stringify(keys.map((key) => [key, params.getAll(key)]));
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function pointer(
  result: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = result[key];
  if (value === undefined) return undefined;
  const id = object(value).id;
  if (typeof id !== "string" || !id.trim())
    throw new Error("任务预览引用未核全；未改读其他候选。");
  return id;
}
type TaskReader = Pick<
  StudioClient,
  | "tasks"
  | "creation"
  | "revisions"
  | "changePreviews"
  | "providerActionPreviews"
  | "chapters"
  | "projects"
>;

export function taskResultReferenceKey(value: unknown): string {
  const result = object(value);
  return JSON.stringify([
    result.creationWorkflowId,
    result.providerActionPreviewId,
    ...["changePreview", "revisionPreview", "providerActionPreview"].map(
      (key) => object(result[key]).id,
    ),
  ]);
}

export async function readActualTaskResult(
  client: TaskReader,
  task: Task,
): Promise<Task> {
  if (
    !task.result ||
    typeof task.result !== "object" ||
    Array.isArray(task.result)
  )
    return task;
  const result = object(task.result);
  if (result.creationWorkflowId !== undefined) {
    if (
      typeof result.creationWorkflowId !== "string" ||
      !result.creationWorkflowId.trim()
    )
      throw new Error("实际任务的运行引用未核全。");
    const workflow = await client.creation.get(result.creationWorkflowId);
    if (
      !task.projectId ||
      workflow.id !== result.creationWorkflowId ||
      workflow.taskId !== task.id ||
      workflow.input.projectId !== task.projectId
    )
      throw new Error("实际任务与创作运行的身份、项目或绑定不符。");
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
    throw new Error("实际任务的厂商引用相互冲突；未打开其他调用。");
  const [change, revision, provider] = await Promise.all([
    changeId ? client.changePreviews.get(changeId) : undefined,
    revisionId ? client.revisions.get(revisionId) : undefined,
    typeof providerId === "string"
      ? readProviderActionReview(client, {
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
    throw new Error("变更候选的实际项目或任务归属不符。");
  let currentRevision = revision;
  if (revision) {
    const chapter = await client.chapters.get(revision.chapterId);
    if (
      revision.id !== revisionId ||
      !task.projectId ||
      chapter.id !== revision.chapterId ||
      chapter.projectId !== task.projectId
    )
      throw new Error("修订候选的实际章节或项目归属不符。");
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

export async function readTaskConfirmationContext(
  client: TaskReader,
  projectId: string | undefined,
  search: string,
) {
  const params = new URLSearchParams(search);
  for (const key of keys) {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length && !values[0]?.trim()))
      throw new Error(
        "指定任务、运行、修订或项目引用重复／为空；未忽略任何绑定。",
      );
  }
  const taskId = params.get("taskId");
  const workflowId = params.get("workflowId");
  const revisionId = params.get("revisionId");
  if (workflowId && revisionId)
    throw new Error(
      "运行与旧修订的混合链接无法核对同一实际对象；未忽略任何引用。",
    );
  if (projectId) {
    const project = await client.projects.get(projectId);
    if (project.id !== projectId)
      throw new Error("指定任务项目的实际身份不符。");
  }
  const [task, workflow, revision] = await Promise.all([
    taskId
      ? client.tasks
          .list()
          .then((items) => items.find((item) => item.id === taskId))
      : undefined,
    workflowId ? client.creation.get(workflowId) : undefined,
    revisionId ? client.revisions.get(revisionId) : undefined,
  ]);
  if (
    taskId &&
    (!task || task.id !== taskId || (projectId && task.projectId !== projectId))
  )
    throw new Error("对应任务不存在或不属于指定项目；未打开其他任务。");
  if (
    workflowId &&
    (!workflow ||
      workflow.id !== workflowId ||
      (projectId && workflow.input.projectId !== projectId) ||
      (task &&
        (workflow.taskId !== task.id ||
          workflow.input.projectId !== task.projectId ||
          (object(task.result).creationWorkflowId !== undefined &&
            object(task.result).creationWorkflowId !== workflowId))))
  )
    throw new Error("指定创作运行与实际项目／任务绑定不符；未打开候选。");
  if (revision) {
    const chapter = await client.chapters.get(revision.chapterId);
    if (
      revision.id !== revisionId ||
      chapter.id !== revision.chapterId ||
      (projectId && chapter.projectId !== projectId) ||
      (task &&
        (task.projectId !== chapter.projectId ||
          pointer(object(task.result), "revisionPreview") !== revision.id))
    )
      throw new Error("指定修订与实际项目／任务绑定不符；未打开候选。");
    if (
      revision.status === "pending" &&
      chapter.version !== revision.baseVersion
    )
      return {
        task,
        workflow,
        revision: { ...revision, status: "conflicted" as const },
      };
  }
  return {
    task: task ? await readActualTaskResult(client, task) : undefined,
    workflow,
    revision,
  };
}
