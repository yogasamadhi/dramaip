import { useEffect, useRef, useState } from "react";
import type { ChapterPreviewRevisionEffort } from "@dramaip/contracts/automation";
import { Button } from "@dramaip/infra-ui-primitives";
import { useStudio, message } from "../studio-shared";
import styles from "./ChapterPreviewRevisionPanel.module.css";
import { copyText } from "../copy";

export function ChapterPreviewRevisionView({
  value,
}: {
  value: ChapterPreviewRevisionEffort;
}) {
  return (
    <div
      className={styles.c1}
      aria-label={copyText("app/features/ChapterPreviewRevisionPanel.1")}
    >
      <p>
        {copyText("app/features/ChapterPreviewRevisionPanel.2")}
        {value.observedContentUpdates}
        {copyText("app/features/ChapterPreviewRevisionPanel.3")}{" "}
        {value.observedRebases}
        {copyText("app/features/ChapterPreviewRevisionPanel.4")}{" "}
        {value.observedContentChangingRebases}
        {copyText("app/features/ChapterPreviewRevisionPanel.5")}
      </p>
      <p>
        {value.status === "committed"
          ? "此原 AI 草稿链正式采用时"
          : "此原 AI 草稿链尚未正式采用"}{" "}
        {copyText("app/features/ChapterPreviewRevisionPanel.6")}
        {value.localRevisionCount === null
          ? "未知（历史不完整）"
          : value.localRevisionCount}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/ChapterPreviewRevisionPanel.7")}
      </p>
      {value.coverage !== "complete" && (
        <p>{copyText("app/features/ChapterPreviewRevisionPanel.8")}</p>
      )}
      <details>
        <summary className={styles.c3}>
          {copyText("app/features/ChapterPreviewRevisionPanel.9")}
        </summary>
        <p className={styles.c4}>
          {copyText("app/features/ChapterPreviewRevisionPanel.10")}
          {value.rootPreviewId}
          {copyText("app/features/ChapterPreviewRevisionPanel.11")}
          {value.previewId} · {value.coverage}
        </p>
        <p className={styles.c4}>
          {copyText("app/features/ChapterPreviewRevisionPanel.12")}
          {value.journalSha256}
        </p>
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
    <section
      className={styles.c5}
      aria-label={copyText("app/features/ChapterPreviewRevisionPanel.13")}
    >
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在核对原修订台账…" : "查看 AI 草稿正文实际修订次数"}
      </Button>
      {error && (
        <p role="alert" className={styles.c6}>
          {error}
          {copyText("app/features/ChapterPreviewRevisionPanel.14")}
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
