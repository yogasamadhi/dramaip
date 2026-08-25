import type { AgentEngineKind } from "@dramaip/contracts/product";
import { BareButton } from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
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
import { AgentTaskConfigPanel } from "../agents/impl";
import {
  AgentChangePreviewCard,
  AgentProviderActionPreviewCard,
  AgentRevisionPreviewCard,
} from "../studio-widgets";
export function TaskPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const projectId = new URLSearchParams(location.search).get("projectId");
  const [retryEngine, setRetryEngine] = useState<AgentEngineKind>("pi");
  const { data: items = [], error } = useQuery({
    queryKey: ["tasks"],
    queryFn: client.tasks.list,
  });
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("task.") ||
          event.type.startsWith("agent_session.") ||
          event.type.startsWith("agent_item.")
        )
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }),
    [client, queryClient],
  );
  const cancel = useMutation({
    mutationFn: (id: string) => client.tasks.cancel(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      client.tasks.retry(id, { engineKind: retryEngine }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const visibleItems = projectId
    ? items.filter((item) => item.projectId === projectId)
    : items;
  return (
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="执行与恢复"
        title="任务中心"
        description="统一查看生成、分析和交付任务的当前阶段、失败原因与恢复入口。"
        badge="实时阶段"
      />
      <AgentTaskConfigPanel />
      <label className="studio-card flex max-w-md flex-col gap-1 p-4 text-sm text-muted">
        {projectId && (
          <p className="mt-1 text-sm text-muted">正在显示当前项目的任务。</p>
        )}
        重试使用的智能引擎
        <select
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          value={retryEngine}
          onChange={(event) =>
            setRetryEngine(event.target.value as AgentEngineKind)
          }
        >
          <option value="pi">Pi（默认内嵌）</option>
          <option value="codex">Codex</option>
          <option value="grok">Grok Build</option>
          <option value="langgraph">LangGraph.js</option>
        </select>
      </label>
      {error && <p className="mt-4 text-sm text-red-600">{message(error)}</p>}
      <div className="space-y-3">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex justify-between">
              <span>{item.title}</span>
              <span className="text-sm text-muted">
                {TASK_STATUS_LABELS[item.status] ?? "未知状态"}
              </span>
            </div>
            {item.stage ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                {item.stage}
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted">
                {item.status === "running" ? "任务正在执行" : "旧任务记录"}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              {item.conversationId && (
                <BareButton
                  className="mr-auto rounded-md border border-brand px-2 py-1 text-xs text-brand"
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
              )}
              {["queued", "running", "interrupted"].includes(item.status) && (
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(item.id)}
                >
                  取消
                </BareButton>
              )}
              {["failed", "canceled", "interrupted"].includes(item.status) &&
                [
                  "agent.chapter_diagnostic",
                  "agent.chapter_revision",
                  "feedback.revision",
                ].includes(item.kind) && (
                  <BareButton
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(item.id)}
                  >
                    重试
                  </BareButton>
                )}
            </div>
            {item.error && (
              <p className="mt-2 text-xs text-red-600">
                {message(new Error(item.error))}
              </p>
            )}
            {agentRevisionPreview(item.result) && (
              <AgentRevisionPreviewCard
                preview={agentRevisionPreview(item.result)!}
                projectId={item.projectId}
              />
            )}
            {agentChangePreview(item.result) && (
              <AgentChangePreviewCard
                preview={agentChangePreview(item.result)!}
              />
            )}
            {agentProviderActionPreview(item.result) && (
              <AgentProviderActionPreviewCard
                preview={agentProviderActionPreview(item.result)!}
              />
            )}
            {item.result !== undefined && (
              <details className="mt-3 rounded-lg bg-surface-muted p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted">
                  查看任务结果
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {taskResultText(item.result)}
                </p>
              </details>
            )}
          </div>
        ))}
        {!items.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            暂无任务。
          </p>
        )}
      </div>
    </section>
  );
}
