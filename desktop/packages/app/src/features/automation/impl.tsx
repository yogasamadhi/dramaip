import { CreationRunCard } from "../creation-workbench";
import type { Task, TaskWorklistCategory } from "@dramaip/contracts/product";
import { BareButton, Button, StatusBadge } from "@dramaip/ui-shared";
import {
  useInfiniteQuery,
  useMutation,
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
        <StatusBadge tone={statusTone(item)}>
          {item.resultStatus === "pending"
            ? "等待采用"
            : item.resultStatus === "applied"
              ? "已应用"
              : (TASK_STATUS_LABELS[item.status] ?? "未知状态")}
        </StatusBadge>
      </div>
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

      {typeof resultObject(item.result).creationWorkflowId === "string" && (
        <CreationRunCard
          id={String(resultObject(item.result).creationWorkflowId)}
        />
      )}
      {agentRevisionPreview(item.result) ? (
        <AgentRevisionPreviewCard
          preview={agentRevisionPreview(item.result)!}
          projectId={item.projectId}
        />
      ) : null}
      {agentChangePreview(item.result) ? (
        <AgentChangePreviewCard preview={agentChangePreview(item.result)!} />
      ) : null}
      {agentProviderActionPreview(item.result) ? (
        <AgentProviderActionPreviewCard
          preview={agentProviderActionPreview(item.result)!}
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
      {item.result !== undefined && item.resultStatus !== "pending" ? (
        <details className="mt-3 rounded-md bg-surface-muted px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            查看任务结果
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {taskResultText(item.result)}
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
  const projectId =
    new URLSearchParams(location.search).get("projectId") ??
    session.activeProjectId;
  const [category, setCategory] =
    useState<TaskWorklistCategory>("pending-result");
  const [configOpen, setConfigOpen] = useState(false);
  const worklist = useInfiniteQuery({
    queryKey: ["task-worklist", projectId, category],
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
  const items = worklist.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = worklist.data?.pages[0]?.counts ?? {
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
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["task-worklist"] }),
  });

  return (
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="执行与恢复"
        title="任务中心"
        description="先处理待确认结果和异常任务；运行配置仅在新建任务时展开。"
        badge={projectId ? "当前项目" : "全部项目"}
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
      {configOpen ? <AgentTaskConfigPanel /> : null}

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

      {worklist.error ? (
        <p
          className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-strong"
          role="alert"
        >
          {message(worklist.error)}
        </p>
      ) : null}
      <div className="space-y-3" role="tabpanel">
        {items.map((item) => (
          <TaskCard
            key={item.id}
            task={item}
            acknowledging={acknowledge.isPending}
            onAcknowledge={(task) => acknowledge.mutate(task)}
          />
        ))}
        {!worklist.isLoading && !items.length ? (
          <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            此分类暂无任务。
          </p>
        ) : null}
        {worklist.hasNextPage ? (
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
