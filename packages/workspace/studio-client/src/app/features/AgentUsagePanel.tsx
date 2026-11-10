import { useEffect, useRef, useState } from "react";
import type {
  AgentUsageNumber,
  AgentUsageObservationPage,
} from "@dramaip/contracts";
import { Button } from "@dramaip/infra-ui-primitives";
import { message, useStudio } from "../studio-shared";
import styles from "./AgentUsagePanel.module.css";
import { copyText } from "../copy";

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
    <div
      className={styles.c1}
      aria-label={copyText("app/features/AgentUsagePanel.1")}
    >
      <p className={styles.c2}>
        {copyText("app/features/AgentUsagePanel.2")}
        {current.runId}
        {copyText("app/features/AgentUsagePanel.3")}
        {current.observationCount}
        {copyText("app/features/AgentUsagePanel.4")}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/AgentUsagePanel.5")}
        {current.projectId
          ? `项目 ${current.projectId}`
          : "未绑定项目的全局运行"}
        {copyText("app/features/AgentUsagePanel.6")}
      </p>
      {!current.observationCount && (
        <p>{copyText("app/features/AgentUsagePanel.7")}</p>
      )}
      {pages
        .flatMap((page) => page.items)
        .map((item) => (
          <div key={item.cursor} className={styles.c3}>
            <p>
              {scopes[item.measurementScope]}
              {copyText("app/features/AgentUsagePanel.8")}
              {item.cursor}
            </p>
            <p>
              {copyText("app/features/AgentUsagePanel.9")}
              {token(item.inputTokens)}
              {copyText("app/features/AgentUsagePanel.10")}
              {token(item.outputTokens)}
              {copyText("app/features/AgentUsagePanel.11")}
              {token(item.cachedTokens)}
            </p>
            <p>
              {item.costEstimate
                ? `引擎报告费用估值：${item.costEstimate.amount.status === "reported" ? item.costEstimate.amount.value : item.costEstimate.amount.status === "invalid" ? "报告值无效" : "金额未报告"} · ${item.costEstimate.currency.status === "reported" ? item.costEstimate.currency.value : item.costEstimate.currency.status === "invalid" ? "币种报告无效" : "币种未报告"}；不是报价、账单或结算，不按 Token／当前单价补算或合计。`
                : "本条没有已记录的费用估值；不补造历史金额或币种，结算未知。"}
            </p>
            <p className={styles.c4}>
              {copyText("app/features/AgentUsagePanel.12")}
              {item.inputAccounting === "includes-cache"
                ? "包含缓存"
                : item.inputAccounting === "excludes-cache"
                  ? "不包含缓存"
                  : "缓存包含关系未指定"}{" "}
              {copyText("app/features/AgentUsagePanel.13")}
              {item.recordedAt}
            </p>
          </div>
        ))}
      <p className={styles.c4}>{copyText("app/features/AgentUsagePanel.14")}</p>
    </div>
  );
}

export function AgentUsagePanel(props: {
  runId: string;
  projectId?: string;
  expectedSessionId?: string;
  expectedEngineKind?: "pi";
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
    <section
      className={styles.c5}
      aria-label={copyText("app/features/AgentUsagePanel.15")}
    >
      <Button disabled={pending} onClick={() => void load()}>
        {pending
          ? "正在读取用量报告…"
          : pages.length
            ? "重新读取原运行用量报告"
            : "查看原运行用量报告"}
      </Button>
      {error && (
        <p role="alert" className={styles.c6}>
          {error}
          {copyText("app/features/AgentUsagePanel.16")}
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
          {copyText("app/features/AgentUsagePanel.17")}
        </Button>
      )}
    </section>
  );
}
