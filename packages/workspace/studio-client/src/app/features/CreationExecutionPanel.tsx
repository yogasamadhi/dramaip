import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  CreationExecutionReceipt,
  CreationWorkflow,
} from "@dramaip/contracts/creation";
import { Button } from "@dramaip/infra-ui-primitives";
import { useStudio, message } from "../studio-shared";
import { AgentUsagePanel } from "./AgentUsagePanel";
import { CreationRunContextPanel } from "./CreationRunContextPanel";
import { ChapterPreviewRevisionPanel } from "./ChapterPreviewRevisionPanel";
import styles from "./CreationExecutionPanel.module.css";
import { copyText } from "../copy";

const labels = {
  generating: "生成",
  checking: "检查",
  revising: "局部修订",
  rechecking: "复检",
};
export function CreationExecutionView({
  receipt,
  renderUsage,
  renderContext,
}: {
  receipt: CreationExecutionReceipt;
  renderUsage?: (runId: string) => ReactNode;
  renderContext?: (runId: string) => ReactNode;
}) {
  return (
    <div
      className={styles.c1}
      aria-label={copyText("app/features/CreationExecutionPanel.1")}
    >
      <p className={styles.c2}>
        {copyText("app/features/CreationExecutionPanel.2")}
        {receipt.workflowId}
        {copyText("app/features/CreationExecutionPanel.3")}
        {receipt.version} · {receipt.operation}
      </p>
      <p className={styles.c3}>
        {copyText("app/features/CreationExecutionPanel.4")}
        {receipt.sourceWorkflowId
          ? ` 前次原工作流：${receipt.sourceWorkflowId}，其用量未并入。`
          : ""}
        {copyText("app/features/CreationExecutionPanel.5")}
      </p>
      {!receipt.runs.length && (
        <p>{copyText("app/features/CreationExecutionPanel.6")}</p>
      )}
      {receipt.runs.map((run, index) => (
        <section key={run.runId} className={styles.c4}>
          <p className={styles.c2}>
            {index + 1}.{" "}
            {run.state === "recorded" ? labels[run.phase] : "阶段未知"}
            {copyText("app/features/CreationExecutionPanel.7")} {run.runId}
          </p>
          {run.state === "missing" ? (
            <p>{copyText("app/features/CreationExecutionPanel.8")}</p>
          ) : (
            <>
              <p>
                {copyText("app/features/CreationExecutionPanel.9")}
                {run.execution.engineKind}
                {copyText("app/features/CreationExecutionPanel.10")}{" "}
                {run.execution.status}
              </p>
              <p>
                {copyText("app/features/CreationExecutionPanel.11")}
                {run.execution.model.status === "recorded"
                  ? `${run.execution.model.modelId}${run.execution.model.providerId ? ` · Provider ${run.execution.model.providerId}` : ""}${run.execution.model.profileId ? ` · Profile ${run.execution.model.profileId}` : ""}`
                  : run.execution.model.status === "invalid"
                    ? "原记录无效"
                    : "未记录，不读当前默认模型补造"}
              </p>
              <p>
                {copyText("app/features/CreationExecutionPanel.12")}
                {run.execution.timing.status === "measured"
                  ? `${run.execution.timing.startedAt} → ${run.execution.timing.completedAt} · ${run.execution.timing.durationMs} ms`
                  : run.execution.timing.status === "in-progress"
                    ? `${run.execution.timing.startedAt}开始；未记录终止时间，不推算最终耗时`
                    : run.execution.timing.status === "invalid"
                      ? "原时间无效／倒置，不补零"
                      : "未完整记录，耗时未知"}
              </p>
              {renderUsage?.(run.runId)}
              {renderContext?.(run.runId)}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
export function CreationExecutionPanel({
  workflow,
}: {
  workflow: CreationWorkflow;
}) {
  const client = useStudio();
  const [receipt, setReceipt] = useState<CreationExecutionReceipt>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const scope = `${workflow.input.projectId}:${workflow.id}:${workflow.version}:${workflow.runIds.join(",")}`;
  const current = useRef(scope);
  const request = useRef<AbortController | undefined>(undefined);
  current.current = scope;
  useEffect(() => {
    setReceipt(undefined);
    setError(undefined);
    setPending(false);
    return () => request.current?.abort();
  }, [scope]);
  const read = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    setReceipt(undefined);
    try {
      const value = await client.creationExecution.read(
        workflow,
        controller.signal,
      );
      if (!controller.signal.aborted && current.current === scope)
        setReceipt(value);
    } catch (cause) {
      if (!controller.signal.aborted && current.current === scope)
        setError(message(cause));
    } finally {
      if (!controller.signal.aborted && current.current === scope)
        setPending(false);
    }
  };
  return (
    <section
      className={styles.c5}
      aria-label={copyText("app/features/CreationExecutionPanel.13")}
    >
      {workflow.input.operation === "chapter" && workflow.previewId && (
        <ChapterPreviewRevisionPanel
          projectId={workflow.input.projectId}
          previewId={workflow.previewId}
          taskId={workflow.taskId}
        />
      )}
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在核对原阶段记录…" : "查看全部创作阶段执行记录"}
      </Button>
      {error && (
        <p role="alert" className={styles.c6}>
          {error}
          {copyText("app/features/CreationExecutionPanel.14")}
        </p>
      )}
      {receipt &&
        receipt.workflowId === workflow.id &&
        receipt.projectId === workflow.input.projectId &&
        receipt.version === workflow.version &&
        JSON.stringify(receipt.runs.map((run) => run.runId)) ===
          JSON.stringify(workflow.runIds) && (
          <CreationExecutionView
            receipt={receipt}
            renderUsage={(runId) => (
              <AgentUsagePanel
                key={`${workflow.input.projectId}:${runId}`}
                runId={runId}
                projectId={workflow.input.projectId}
              />
            )}
            renderContext={(runId) => (
              <CreationRunContextPanel
                key={`${workflow.input.projectId}:${runId}`}
                workflow={workflow}
                runId={runId}
              />
            )}
          />
        )}
    </section>
  );
}
