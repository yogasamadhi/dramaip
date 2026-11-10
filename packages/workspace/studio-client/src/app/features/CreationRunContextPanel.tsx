import { useEffect, useRef, useState } from "react";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AgentContextSnapshot } from "@dramaip/contracts/agent-context";
import { Button } from "@dramaip/infra-ui-primitives";
import { useStudio, message } from "../studio-shared";
import styles from "./CreationRunContextPanel.module.css";
import { copyText } from "../copy";

export function CreationRunContextView({
  runId,
  snapshot,
}: {
  runId: string;
  snapshot: AgentContextSnapshot;
}) {
  return (
    <section
      aria-label={copyText("app/features/CreationRunContextPanel.1")}
      className={styles.c1}
    >
      <p>
        {copyText("app/features/CreationRunContextPanel.2")}
        {runId}
        {copyText("app/features/CreationRunContextPanel.3")}
        {snapshot.id}
      </p>
      <p>
        {copyText("app/features/CreationRunContextPanel.4")}
        {snapshot.estimatedTokens}
        {copyText("app/features/CreationRunContextPanel.5")}{" "}
        {snapshot.tokenBudget}
        {copyText("app/features/CreationRunContextPanel.6")}
      </p>
      <p>
        {copyText("app/features/CreationRunContextPanel.7")}
        {snapshot.entries.filter((entry) => entry.included).length}{" "}
        {copyText("app/features/CreationRunContextPanel.8")}{" "}
        {snapshot.entries.filter((entry) => !entry.included).length}
        {copyText("app/features/CreationRunContextPanel.9")}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/CreationRunContextPanel.10")}
      </p>
      <p>
        {copyText("app/features/CreationRunContextPanel.11")}
        {snapshot.finalPromptSha256}
      </p>
      <p>
        {copyText("app/features/CreationRunContextPanel.12")}
        {snapshot.manifestSha256}
      </p>
      <ul className={styles.c3}>
        {snapshot.entries.map((entry, index) => (
          <li key={index}>
            <p>
              {entry.sourceKind} {entry.sourceId}
              {copyText("app/features/CreationRunContextPanel.13")}
              {entry.sourceVersion} · {entry.included ? "已纳入" : "未纳入"}
            </p>
            <p>
              {entry.fieldPath} · {entry.reason}
              {copyText("app/features/CreationRunContextPanel.14")}
              {entry.estimatedTokens}{" "}
              {copyText("app/features/CreationRunContextPanel.15")}
            </p>
            {entry.included && (
              <details>
                <summary>
                  {copyText("app/features/CreationRunContextPanel.16")}
                </summary>
                <pre className={styles.c4}>
                  {typeof entry.value === "string"
                    ? entry.value
                    : JSON.stringify(entry.value, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <details>
        <summary>{copyText("app/features/CreationRunContextPanel.17")}</summary>
        <pre className={styles.c4}>{snapshot.finalPrompt}</pre>
      </details>
    </section>
  );
}

export function CreationRunContextPanel({
  workflow,
  runId,
}: {
  workflow: CreationWorkflow;
  runId: string;
}) {
  const client = useStudio();
  const scope = `${workflow.input.projectId}:${workflow.id}:${workflow.version}:${runId}:${workflow.runIds.join(",")}`;
  const current = useRef(scope);
  current.current = scope;
  const request = useRef<AbortController | undefined>(undefined);
  const [value, setValue] = useState<{
    scope: string;
    snapshot: AgentContextSnapshot;
  }>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setValue(undefined);
    setError(undefined);
    setPending(false);
    return () => request.current?.abort();
  }, [scope]);
  const read = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setValue(undefined);
    setError(undefined);
    setPending(true);
    try {
      const snapshot = await client.creationExecution.readContext(
        workflow,
        runId,
        controller.signal,
      );
      if (!controller.signal.aborted && current.current === scope)
        setValue({ scope, snapshot });
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
      aria-label={copyText("app/features/CreationRunContextPanel.19", {
        p1: runId,
      })}
      className={styles.c3}
    >
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在读取原阶段上下文…" : "查看此阶段原上下文"}
      </Button>
      {error && (
        <p role="alert">
          {error}
          {copyText("app/features/CreationRunContextPanel.18")}
        </p>
      )}
      {value?.scope === scope && (
        <CreationRunContextView runId={runId} snapshot={value.snapshot} />
      )}
    </section>
  );
}
