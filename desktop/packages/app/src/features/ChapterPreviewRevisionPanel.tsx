import { useEffect, useRef, useState } from "react";
import type { ChapterPreviewRevisionEffort } from "@dramaip/contracts/automation";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../studio-shared";

export function ChapterPreviewRevisionView({
  value,
}: {
  value: ChapterPreviewRevisionEffort;
}) {
  return (
    <div className="space-y-1 text-xs leading-5" aria-label="实际候选修订记录">
      <p>
        已记录正文修改 {value.observedContentUpdates} 次 · 显式合并{" "}
        {value.observedRebases} 次 （其中正文变化{" "}
        {value.observedContentChangingRebases} 次）
      </p>
      <p>
        {value.status === "committed"
          ? "此原 AI 草稿链正式采用时"
          : "此原 AI 草稿链尚未正式采用"}{" "}
        · 局部正文修订次数：
        {value.localRevisionCount === null
          ? "未知（历史不完整）"
          : value.localRevisionCount}
      </p>
      <p className="text-muted">
        仅本单章 AI 草稿链已保存的实际正文变化；相同内容重复保存不计数。
        不包含模型修订阶段、其他尝试、未保存编辑或编辑工作量，不证明文学质量。
      </p>
      {value.coverage !== "complete" && (
        <p>
          旧记录缺失的历史不补零；上述次数只是已记录观察，不是完整修订总量。
        </p>
      )}
      <details>
        <summary className="cursor-pointer">原记录范围</summary>
        <p className="break-all">
          根预览 {value.rootPreviewId} · 当前预览 {value.previewId} ·{" "}
          {value.coverage}
        </p>
        <p className="break-all">台账 SHA256 {value.journalSha256}</p>
      </details>
    </div>
  );
}
export function ChapterPreviewRevisionPanel({
  projectId,
  previewId,
  taskId,
}: {
  projectId: string;
  previewId: string;
  taskId?: string;
}) {
  const client = useStudio(),
    scope = `${projectId}:${previewId}:${taskId ?? ""}`;
  const current = useRef(scope),
    request = useRef<AbortController | undefined>(undefined);
  current.current = scope;
  const [value, setValue] = useState<ChapterPreviewRevisionEffort>(),
    [error, setError] = useState<string>();
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
    setPending(true);
    setValue(undefined);
    setError(undefined);
    try {
      const preview = await client.changePreviews.get(previewId);
      if (controller.signal.aborted) return;
      if (
        preview.id !== previewId ||
        preview.projectId !== projectId ||
        (taskId !== undefined && preview.taskId !== taskId)
      )
        throw new Error("原 AI 草稿归属不一致，不读取其他预览。");
      const result = await client.previewRevisionEffort.read(
        preview,
        controller.signal,
      );
      if (!controller.signal.aborted && current.current === scope)
        setValue(result);
    } catch (cause) {
      if (!controller.signal.aborted && current.current === scope)
        setError(message(cause));
    } finally {
      if (!controller.signal.aborted && current.current === scope)
        setPending(false);
    }
  };
  return (
    <section className="mt-2 space-y-2" aria-label="候选正文实际修订台账">
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在核对原修订台账…" : "查看候选正文实际修订次数"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger-strong">
          {error} 不显示旧缓存或推定零修订。
        </p>
      )}
      {value &&
        value.previewId === previewId &&
        value.projectId === projectId && (
          <ChapterPreviewRevisionView value={value} />
        )}
    </section>
  );
}
