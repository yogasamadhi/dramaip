import { CreationRunCard } from "../creation-workbench";
import type { Task, TaskWorklistCategory } from "@dramaip/contracts/product";
import { BareButton, Button, StatusBadge } from "@dramaip/ui-shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, Clock3, History, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  TASK_STATUS_LABELS,
  WorkspaceIntro,
  agentChangePreview,
  agentProviderActionPreview,
  agentRevisionPreview,
  message,
  taskResultText,
  useStudio,
} from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import { providerReviewStatusLabel } from "../../provider-action-review";
import { isLegacyQualityTask } from "../../legacy-quality-history";
import {
  taskConfirmationKey,
  taskResultReferenceKey,
  readTaskConfirmationContext,
  readActualTaskResult,
} from "../../task-confirmation-context";
import { AgentTaskConfigPanel } from "../agents/impl";
import {
  AgentChangePreviewCard,
  AgentProviderActionPreviewCard,
  AgentRevisionPreviewCard,
} from "../studio-widgets";

const CATEGORIES: ReadonlyArray<{
  id: TaskWorklistCategory;
  label: string;
  countKey: "pendingResult" | "running" | "attention" | "history";
  icon: typeof Clock3;
}> = [
  {
    id: "pending-result",
    label: "待确认",
    countKey: "pendingResult",
    icon: CheckCheck,
  },
  { id: "running", label: "进行中", countKey: "running", icon: Clock3 },
  {
    id: "attention",
    label: "需要处理",
    countKey: "attention",
    icon: AlertTriangle,
  },
  { id: "history", label: "历史", countKey: "history", icon: History },
];

function resultObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceRoute(task: Task): string {
  if (isLegacyQualityTask(task.kind))
    return `/create${task.projectId ? `?projectId=${encodeURIComponent(task.projectId)}` : ""}`;
  const result = resultObject(task.result);
  const project = task.projectId
    ? `projectId=${encodeURIComponent(task.projectId)}`
    : "";
  const separator = project ? "&" : "";
  if (/image|video|tts|media/iu.test(task.kind)) {
    const shotId =
      typeof result.shotId === "string" ? result.shotId : undefined;
    return `/produce?${project}${separator}stage=${task.kind === "video-generation" ? "video-generation" : "assets"}${shotId ? `&shotId=${encodeURIComponent(shotId)}` : ""}`;
  }
  if (/feedback|review|delivery/iu.test(task.kind)) return `/review?${project}`;
  if (/chapter|writing|analysis/iu.test(task.kind) && task.projectId)
    return `/projects/${encodeURIComponent(task.projectId)}`;
  return task.projectId
    ? `/projects/${encodeURIComponent(task.projectId)}/tools/cockpit`
    : "/";
}

function statusTone(
  task: Task,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (task.status === "failed" || task.status === "interrupted")
    return "danger";
  if (task.status === "running" || task.status === "queued") return "info";
  if (task.resultStatus === "pending") return "warning";
  if (task.status === "succeeded") return "success";
  return "neutral";
}

function TaskCard(props: {
  task: Task;
  onAcknowledge(task: Task): void;
  acknowledging: boolean;
}) {
  const item = props.task;
  const legacyQuality = isLegacyQualityTask(item.kind);
  const client = useStudio();
  const actual = useQuery({
    queryKey: [
      "task-actual-result",
      item.id,
      item.projectId,
      item.updatedAt,
      taskResultReferenceKey(item.result),
    ],
    queryFn: () => readActualTaskResult(client, item),
    refetchInterval: 1500,
    retry: false,
  });
  const result =
    !actual.error && (!legacyQuality || actual.isFetchedAfterMount)
      ? actual.data?.result
      : undefined;
  const provider = agentProviderActionPreview(result);
  const oldResult = resultObject(item.result);
  const hasProviderReference =
    oldResult.providerActionPreviewId !== undefined ||
    oldResult.providerActionPreview !== undefined;
  return (
    <article
      className="rounded-lg border border-line bg-surface px-4 py-3"
      data-task-id={item.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{item.title}</h3>
          <p className="mt-1 text-xs text-muted">
            {new Date(item.updatedAt).toLocaleString("zh-CN")} · {item.kind}
          </p>
        </div>
        <StatusBadge tone={legacyQuality ? "warning" : statusTone(item)}>
          {legacyQuality
            ? "历史记录 · 质量未认证"
            : actual.error
              ? "结果未核全"
              : provider
                ? providerReviewStatusLabel(provider.status)
                : hasProviderReference
                  ? "正在核对实际调用"
                  : item.resultStatus === "pending"
                    ? "等待审阅采用"
                    : item.resultStatus === "applied"
                      ? "已应用"
                      : (TASK_STATUS_LABELS[item.status] ?? "未知状态")}
        </StatusBadge>
      </div>
      {legacyQuality && (
        <p className="mt-3 text-sm text-muted">
          原运行状态与结果仅保留历史事实；固定／数量评分不代表当前质量通过、实际模型评议或问题已修复。
        </p>
      )}
      {item.stage ? (
        <div className="mt-3" aria-label={`当前阶段：${item.stage}`}>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            <span>{item.stage}</span>
            <span>{Math.round(item.progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{
                width: `${Math.min(100, Math.max(0, item.progress * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {item.error ? (
        <p
          className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong"
          role="alert"
        >
          {message(new Error(item.error))}
        </p>
      ) : null}

      {actual.error && (
        <p role="alert" className="mt-3 text-sm text-danger-strong">
          {message(actual.error)}
        </p>
      )}
      {!actual.error && !actual.data && item.result !== undefined && (
        <p role="status">正在核对实际任务结果…</p>
      )}
      {typeof resultObject(result).creationWorkflowId === "string" && (
        <CreationRunCard
          id={String(resultObject(result).creationWorkflowId)}
          projectId={item.projectId}
          taskId={item.id}
        />
      )}
      {agentRevisionPreview(result) ? (
        <AgentRevisionPreviewCard
          preview={agentRevisionPreview(result)!}
          projectId={item.projectId}
        />
      ) : null}
      {agentChangePreview(result) ? (
        <AgentChangePreviewCard preview={agentChangePreview(result)!} />
      ) : null}
      {agentProviderActionPreview(result) ? (
        <AgentProviderActionPreviewCard
          preview={agentProviderActionPreview(result)!}
          task={actual.data!}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.conversationId ? (
          <BareButton
            className="text-sm font-medium text-brand-strong hover:underline"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("dramaip:open-assistant-conversation", {
                  detail: { conversationId: item.conversationId },
                }),
              )
            }
          >
            打开对应对话
          </BareButton>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link to={sourceRoute(item)}>返回原操作</Link>
        </Button>
        {(item.status === "failed" || item.status === "interrupted") &&
        item.attentionStatus === "open" ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={props.acknowledging}
            onClick={() => props.onAcknowledge(item)}
          >
            标记为已处理
          </Button>
        ) : null}
      </div>
      {result !== undefined && item.resultStatus !== "pending" ? (
        <details className="mt-3 rounded-md bg-surface-muted px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            {legacyQuality ? "查看原任务结果（质量未认证）" : "查看任务结果"}
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {taskResultText(result)}
          </p>
        </details>
      ) : null}
    </article>
  );
}

export function TaskPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const session = useStudioSession();
  const params = new URLSearchParams(location.search);
  const projectId =
    params.get("projectId") ??
    (params.get("scope") === "all" ? undefined : session.activeProjectId);
  const requestedTaskId = params.get("taskId");
  const hasRequestedObject = ["taskId", "workflowId", "revisionId"].some(
    (key) => params.has(key),
  );
  const hasRequestedContext = hasRequestedObject || params.has("projectId");
  const selectedContext = useQuery({
    queryKey: [
      "confirmation-context",
      projectId,
      taskConfirmationKey(location.search),
    ],
    enabled: hasRequestedContext,
    queryFn: () =>
      readTaskConfirmationContext(client, projectId, location.search),
    retry: false,
    refetchInterval: 1500,
  });
  const renderWorklist =
    !hasRequestedContext ||
    Boolean(selectedContext.data && !selectedContext.error);
  const [category, setCategory] =
    useState<TaskWorklistCategory>("pending-result");
  const [configOpen, setConfigOpen] = useState(false);
  const worklist = useInfiniteQuery({
    queryKey: ["task-worklist", projectId, category],
    enabled: renderWorklist,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.tasks.worklist({
        category,
        ...(projectId ? { projectId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = renderWorklist
    ? (worklist.data?.pages.flatMap((page) => page.items) ?? [])
    : [];
  const counts = (renderWorklist
    ? worklist.data?.pages[0]?.counts
    : undefined) ?? {
    pendingResult: 0,
    running: 0,
    attention: 0,
    history: 0,
  };

  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("task.") ||
          event.type.startsWith("automation.") ||
          event.type.startsWith("agent_session.") ||
          event.type.startsWith("agent_item.")
        )
          void queryClient.invalidateQueries({ queryKey: ["task-worklist"] });
      }),
    [client, queryClient],
  );

  const acknowledge = useMutation({
    mutationFn: (task: Task) =>
      client.tasks.setAttention(task.id, "acknowledged"),
    onSuccess: async () => {
      await Promise.all(
        ["task-worklist", "tasks", "confirmation-context"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });

  return (
    <section className="space-y-5">
      <WorkspaceIntro
        title="任务中心"
        description="先处理待确认结果和异常任务；运行配置仅在新建任务时展开。"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {projectId ? "正在显示当前项目的任务。" : "正在显示全部项目的任务。"}
        </p>
        <Button
          variant={configOpen ? "secondary" : "primary"}
          size="sm"
          onClick={() => setConfigOpen((value) => !value)}
        >
          <Plus aria-hidden="true" className="size-4" />
          {configOpen ? "收起任务配置" : "新建任务"}
        </Button>
      </div>
      {configOpen && renderWorklist ? <AgentTaskConfigPanel /> : null}
      {(hasRequestedObject || Boolean(selectedContext.error)) && (
        <section
          aria-label="对应待确认对象"
          className="space-y-3 rounded-lg border border-brand p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">对应待确认对象</h2>
            <Button size="sm" variant="ghost" asChild>
              <Link
                to={
                  projectId
                    ? `/pending?projectId=${encodeURIComponent(projectId)}`
                    : "/pending"
                }
              >
                返回待确认中心
              </Link>
            </Button>
          </div>
          {selectedContext.error || !selectedContext.data ? (
            <p role={selectedContext.error ? "alert" : "status"}>
              {selectedContext.error
                ? message(selectedContext.error)
                : "正在核对实际项目、任务及 AI 草稿绑定…"}
            </p>
          ) : selectedContext.data.revision ? (
            <AgentRevisionPreviewCard
              preview={selectedContext.data.revision}
              projectId={projectId}
            />
          ) : selectedContext.data.workflow ? (
            <CreationRunCard
              id={selectedContext.data.workflow.id}
              projectId={selectedContext.data.workflow.input.projectId}
              taskId={selectedContext.data.task?.id}
            />
          ) : selectedContext.data.task ? (
            <TaskCard
              task={selectedContext.data.task}
              acknowledging={acknowledge.isPending}
              onAcknowledge={(task) => acknowledge.mutate(task)}
            />
          ) : (
            <p className="text-sm text-muted">
              实际项目已核对；请选择具体任务。
            </p>
          )}
        </section>
      )}

      <div
        className="grid grid-cols-2 gap-2 rounded-lg bg-surface-muted p-1 sm:grid-cols-4"
        role="tablist"
        aria-label="任务分类"
      >
        {CATEGORIES.map((item) => {
          const Icon = item.icon;
          const active = category === item.id;
          return (
            <BareButton
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium ${active ? "bg-surface-raised text-ink shadow-control" : "text-muted hover:text-ink"}`}
              onClick={() => setCategory(item.id)}
            >
              <Icon aria-hidden="true" className="size-4" />
              {item.label}
              <span className="rounded-full bg-canvas px-2 py-0.5 text-xs">
                {counts[item.countKey]}
              </span>
            </BareButton>
          );
        })}
      </div>

      {renderWorklist && worklist.error ? (
        <p
          className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-strong"
          role="alert"
        >
          {message(worklist.error)}
        </p>
      ) : null}
      <div className="space-y-3" role="tabpanel">
        {items
          .filter((item) => item.id !== requestedTaskId)
          .map((item) => (
            <TaskCard
              key={item.id}
              task={item}
              acknowledging={acknowledge.isPending}
              onAcknowledge={(task) => acknowledge.mutate(task)}
            />
          ))}
        {renderWorklist &&
        !worklist.error &&
        !worklist.isLoading &&
        !items.length ? (
          <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            此分类暂无任务。
          </p>
        ) : null}
        {renderWorklist && worklist.hasNextPage ? (
          <Button
            className="mx-auto flex"
            variant="secondary"
            loading={worklist.isFetchingNextPage}
            onClick={() => void worklist.fetchNextPage()}
          >
            加载更多
          </Button>
        ) : null}
      </div>
    </section>
  );
}
