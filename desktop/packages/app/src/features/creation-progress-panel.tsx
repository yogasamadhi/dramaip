import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { useStudio } from "../studio-shared";
import { creationElapsed, creationStreamPreview } from "./creation-progress";

const stages: Record<string, { title: string; waiting: string; step: number }> =
  {
    preparing: {
      title: "准备创作资料",
      waiting: "正在整理本章、创作要求和已采用资料",
      step: 0,
    },
    generating: {
      title: "生成正文与方案",
      waiting: "正在等待模型返回内容",
      step: 1,
    },
    checking: {
      title: "检查候选",
      waiting: "正在核对创作要求、情节与资料一致性，等待检查结果",
      step: 2,
    },
    revising: {
      title: "修订候选",
      waiting: "正在根据检查意见修改，等待修订内容",
      step: 2,
    },
    rechecking: {
      title: "复检候选",
      waiting: "正在检查修订结果，等待复检结论",
      step: 2,
    },
  };

export function CreationProgress({ value }: { value: CreationWorkflow }) {
  const client = useStudio();
  const active = stages[value.stage];
  const [now, setNow] = useState(Date.now);
  const [live, setLive] = useState<{ content: string; at: string }>();
  const [activity, setActivity] = useState<{ content: string; at: string }>();
  const previewRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const items = useQuery({
    queryKey: ["creation-run-items", value.runId],
    queryFn: () => client.agentSessions.listItems(value.runId!),
    enabled: Boolean(value.runId),
    refetchInterval: active ? 2000 : false,
  });
  useEffect(() => {
    if (!active && value.runId) void items.refetch();
  }, [Boolean(active), value.runId]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [Boolean(active)]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (!event.payload || typeof event.payload !== "object") return;
        const payload = event.payload as Record<string, unknown>;
        if (payload.runId !== value.runId || !value.runId) return;
        if (
          event.type === "agents.assistant-item-delta.v1" &&
          typeof payload.content === "string"
        )
          setLive({
            content: payload.content,
            at: String(payload.occurredAt ?? event.occurredAt),
          });
        if (
          event.type.startsWith("agents.assistant-item-") &&
          payload.type === "stage" &&
          typeof payload.content === "string"
        )
          setActivity({
            content: payload.content,
            at: String(payload.occurredAt ?? event.occurredAt),
          });
      }),
    [client, value.runId],
  );
  const saved = items.data?.find((item) => item.type === "message");
  const raw =
    live && (!saved || live.at >= saved.updatedAt)
      ? live.content
      : (saved?.content ?? "");
  const savedActivity = items.data
    ?.filter((item) => item.type === "stage")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestActivity =
    activity && (!savedActivity || activity.at >= savedActivity.updatedAt)
      ? activity.content
      : savedActivity?.content;
  const checking = value.stage === "checking" || value.stage === "rechecking";
  const text =
    (!active ? value.output?.content : "") ||
    creationStreamPreview(raw, checking) ||
    (!active ? creationStreamPreview(raw, true) : "");
  useEffect(() => {
    if (follow.current && previewRef.current)
      previewRef.current.scrollTop = previewRef.current.scrollHeight;
  }, [text]);
  if (!active && !text) return null;
  return (
    <section
      aria-label="AI 执行实时反馈"
      className="space-y-3 rounded-lg border border-line bg-surface-raised p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <strong role="status">{active?.title ?? "本次已返回内容"}</strong>
        <span className="text-muted" aria-label="创作已用时间">
          已用{" "}
          {creationElapsed(
            value.createdAt,
            active ? now : Date.parse(value.updatedAt),
          )}
        </span>
      </div>
      {active && (
        <ol
          aria-label="创作步骤"
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
        >
          {["准备资料", "生成候选", "检查与修订", "等待审阅"].map(
            (label, index) => (
              <li
                key={label}
                aria-current={index === active.step ? "step" : undefined}
                className={
                  index === active.step ? "font-semibold text-brand" : ""
                }
              >
                {index < active.step ? "✓ " : `${index + 1}. `}
                {label}
              </li>
            ),
          )}
        </ol>
      )}
      {active && (
        <p className="text-sm leading-6 text-muted" role="status">
          {raw
            ? checking
              ? "检查结果正在返回"
              : "内容正在返回，可实时查看下方预览"
            : active.waiting}
        </p>
      )}
      {latestActivity && (
        <p className="text-xs text-muted" role="status">
          {latestActivity}
        </p>
      )}
      {text && (
        <>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {active
                ? checking
                  ? "实时检查反馈"
                  : "实时内容预览"
                : "生成片段（未采用）"}
            </span>
            <span>已返回 {text.length} 字</span>
          </div>
          <div
            ref={previewRef}
            role="region"
            aria-label="AI 实时返回内容"
            tabIndex={0}
            onScroll={(event) => {
              const node = event.currentTarget;
              follow.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            }}
            className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface p-3 text-sm leading-7"
          >
            {text}
          </div>
          <p className="text-xs text-muted">
            {active
              ? "完成检查后会生成候选，供你审阅采用。"
              : "本次未完成，已返回的片段保留供查看。"}
          </p>
        </>
      )}
      {active && !raw && value.stage !== "preparing" && (
        <p className="text-xs text-muted">
          模型响应较慢时，等待时间会持续更新，也可以停止生成。
        </p>
      )}
      {items.error && (
        <p className="text-xs text-muted">
          实时内容暂时无法读取，正在重连，任务状态会继续更新。
        </p>
      )}
    </section>
  );
}
