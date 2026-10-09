import { useEffect, useRef, useState } from "react";
import type {
  AgentUsageNumber,
  AgentUsageObservationPage,
} from "@dramaip/contracts";
import { Button } from "@dramaip/ui-shared";
import { message, useStudio } from "../studio-shared";

const scopes = {
  "response-increment": "单响应报告（增量）",
  "run-total": "运行累计报告",
  "session-total": "会话累计报告（不是本次运行用量）",
  unspecified: "计量口径未指定",
};
const token = (value: AgentUsageNumber) =>
  value.status === "reported"
    ? value.value.toLocaleString("zh-CN")
    : value.status === "invalid"
      ? "报告值无效"
      : "未报告";
export function AgentUsageObservationView({
  pages,
}: {
  pages: readonly AgentUsageObservationPage[];
}) {
  const current = pages[0]!;
  return (
    <div className="space-y-2 text-xs leading-5" aria-label="引擎用量观测">
      <p className="break-all text-muted">
        原运行 {current.runId} · 当前读取时共 {current.observationCount} 条观测
      </p>
      <p className="break-all text-muted">
        发生时范围：
        {current.projectId
          ? `项目 ${current.projectId}`
          : "未绑定项目的全局运行"}
        ；对话后来绑定项目不会改写旧报告归属。
      </p>
      {!current.observationCount && (
        <p>没有已保存的报告，用量未知；不等于零。</p>
      )}
      {pages
        .flatMap((page) => page.items)
        .map((item) => (
          <div
            key={item.cursor}
            className="space-y-1 rounded-md border border-line p-2"
          >
            <p>
              {scopes[item.measurementScope]} · 游标 {item.cursor}
            </p>
            <p>
              输入 {token(item.inputTokens)} · 输出 {token(item.outputTokens)} ·
              缓存读取 {token(item.cachedTokens)}
            </p>
            <p>
              {item.costEstimate
                ? `引擎报告费用估值：${item.costEstimate.amount.status === "reported" ? item.costEstimate.amount.value : item.costEstimate.amount.status === "invalid" ? "报告值无效" : "金额未报告"} · ${item.costEstimate.currency.status === "reported" ? item.costEstimate.currency.value : item.costEstimate.currency.status === "invalid" ? "币种报告无效" : "币种未报告"}；不是报价、账单或结算，不按 Token／当前单价补算或合计。`
                : "本条没有已记录的费用估值；不补造历史金额或币种，结算未知。"}
            </p>
            <p className="text-muted">
              输入口径：
              {item.inputAccounting === "includes-cache"
                ? "包含缓存"
                : item.inputAccounting === "excludes-cache"
                  ? "不包含缓存"
                  : "缓存包含关系未指定"}{" "}
              · 保存时间 {item.recordedAt}
            </p>
          </div>
        ))}
      <p className="text-muted">
        仅为引擎自行报告，覆盖可能不完整，未合计为本次运行总量。运行来源分类未知，费用与结算未知；不是实际付费、提效或文学质量证明。
      </p>
    </div>
  );
}

export function AgentUsagePanel(props: {
  runId: string;
  projectId?: string;
  expectedSessionId?: string;
  expectedEngineKind?: "pi" | "codex" | "langgraph";
}) {
  const client = useStudio();
  const [pages, setPages] = useState<AgentUsageObservationPage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const scope = `${props.projectId ?? "global"}:${props.runId}:${props.expectedSessionId ?? ""}:${props.expectedEngineKind ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    setPages([]);
    setError(undefined);
    setPending(false);
    return () => request.current?.abort();
  }, [scope]);
  const load = async (cursor?: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const page = await client.agentUsage.list(
        props.runId,
        props.projectId,
        cursor,
        25,
        controller.signal,
      );
      if (controller.signal.aborted || currentScope.current !== scope) return;
      if (
        page.items.some(
          (item) =>
            (props.expectedSessionId !== undefined &&
              item.sessionId !== props.expectedSessionId) ||
            (props.expectedEngineKind !== undefined &&
              item.engineKind !== props.expectedEngineKind),
        )
      ) {
        setError("用量会话或引擎不属于原阶段；未显示外来报告。");
        return;
      }
      if (
        cursor !== undefined &&
        (pages.at(-1)?.nextCursor !== cursor ||
          page.items.some((item) =>
            pages.some((old) =>
              old.items.some((saved) => saved.cursor === item.cursor),
            ),
          ))
      ) {
        setError("原分页身份已变化，请明确重新读取该运行。");
        return;
      }
      setPages(cursor === undefined ? [page] : [...pages, page]);
    } catch (cause) {
      if (!controller.signal.aborted && currentScope.current === scope)
        setError(message(cause));
    } finally {
      if (!controller.signal.aborted && currentScope.current === scope)
        setPending(false);
    }
  };
  return (
    <section className="space-y-2" aria-label="运行用量只读记录">
      <Button disabled={pending} onClick={() => void load()}>
        {pending
          ? "正在读取用量报告…"
          : pages.length
            ? "重新读取原运行用量报告"
            : "查看原运行用量报告"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger-strong">
          {error} 上次记录仅作历史查看，不自动换运行或重试。
        </p>
      )}
      {pages.length > 0 &&
        pages[0]!.runId === props.runId &&
        pages[0]!.projectId === props.projectId && (
          <AgentUsageObservationView pages={pages} />
        )}
      {pages.at(-1)?.nextCursor !== undefined && (
        <Button
          disabled={pending}
          onClick={() => void load(pages.at(-1)!.nextCursor)}
        >
          读取更早用量观测
        </Button>
      )}
    </section>
  );
}
