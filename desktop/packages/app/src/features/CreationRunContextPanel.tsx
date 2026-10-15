import { useEffect, useRef, useState } from "react";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AgentContextSnapshot } from "@dramaip/contracts/agent-context";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../studio-shared";

export function CreationRunContextView({
  runId,
  snapshot,
}: {
  runId: string;
  snapshot: AgentContextSnapshot;
}) {
  return (
    <section aria-label="原阶段上下文快照" className="space-y-2 break-all">
      <p>
        原运行 {runId} · 原快照 {snapshot.id}
      </p>
      <p>
        完整提示估算 {snapshot.estimatedTokens} token / 预算{" "}
        {snapshot.tokenBudget} token；不是实际用量。
      </p>
      <p>
        纳入 {snapshot.entries.filter((entry) => entry.included).length}{" "}
        条表达，未纳入{" "}
        {snapshot.entries.filter((entry) => !entry.included).length} 条。
        这是表达条数，不是全书章节覆盖率；摘要、段落和作者解释不等于全文阅读。
      </p>
      <p className="text-muted">
        原持久输入及排除理由如下；不读取最新正文或换成首次生成的上下文。
        未记录的裁剪不推断，纳入不证明模型已经读取或理解，字节指纹不认证历史真实性或文学质量。
      </p>
      <p>提示 SHA-256 {snapshot.finalPromptSha256}</p>
      <p>表达清单 SHA-256 {snapshot.manifestSha256}</p>
      <ul className="space-y-2">
        {snapshot.entries.map((entry, index) => (
          <li key={index}>
            <p>
              {entry.sourceKind} {entry.sourceId} v{entry.sourceVersion} ·{" "}
              {entry.included ? "已纳入" : "未纳入"}
            </p>
            <p>
              {entry.fieldPath} · {entry.reason} · 估算 {entry.estimatedTokens}{" "}
              token
            </p>
            {entry.included && (
              <details>
                <summary>查看此条原冻结表达</summary>
                <pre className="whitespace-pre-wrap">
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
        <summary>
          查看此阶段完整原提示（可能包含本地私有正文或 AI 草稿）
        </summary>
        <pre className="whitespace-pre-wrap">{snapshot.finalPrompt}</pre>
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
    <section aria-label={`阶段原上下文 ${runId}`} className="space-y-2">
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在读取原阶段上下文…" : "查看此阶段原上下文"}
      </Button>
      {error && (
        <p role="alert">
          {error} 本次读取未成功；不显示旧缓存，不补造已读或覆盖率。
        </p>
      )}
      {value?.scope === scope && (
        <CreationRunContextView runId={runId} snapshot={value.snapshot} />
      )}
    </section>
  );
}
