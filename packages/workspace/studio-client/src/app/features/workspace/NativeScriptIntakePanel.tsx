import { useEffect, useRef, useState } from "react";
import type { ProjectInput } from "@dramaip/contracts/product";
import {
  ScreenplayIntakeCommitSchema,
  type ScreenplayIntakePreview,
} from "@dramaip/contracts/production";
import { Button } from "@dramaip/infra-ui-primitives";
import { useStudio, message } from "../../studio-shared";
import {
  readNativeScriptIntake,
  readNativeScriptIntakeRecovery,
  NativeScriptIntakeBindingSchema,
  type NativeScriptIntakeBinding,
} from "../../native-script-intake";
import { NativeScreenplayPreview } from "../production/NativeScreenplayPreview";
import styles from "./NativeScriptIntakePanel.module.css";
import { copyText } from "../../copy";

type Session = Awaited<ReturnType<typeof readNativeScriptIntake>>;
export function NativeScriptIntakePanel(props: {
  binding?: NativeScriptIntakeBinding;
  projectInput?: ProjectInput;
  disabled?: boolean;
  onChange(binding: NativeScriptIntakeBinding | undefined): void;
  onBusy(busy: boolean): void;
  onOpen(receipt: NonNullable<ScreenplayIntakePreview["receipt"]>): void;
}) {
  const client = useStudio();
  const [binding, setBinding] = useState(props.binding);
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(Boolean(props.binding));
  const [missingPreviewId, setMissingPreviewId] = useState<string>();
  const [rights, setRights] = useState(false),
    [loss, setLoss] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const callbacks = useRef(props);
  callbacks.current = props;
  const initial = useRef(props.binding);
  const mounted = useRef(true);
  const resetConsent = () => {
    setRights(false);
    setLoss(false);
  };
  const remember = (next: NativeScriptIntakeBinding) => {
    if (!mounted.current) return;
    const parsed = NativeScriptIntakeBindingSchema.parse(next);
    // The caller durably saves identity before any ambiguous write.
    callbacks.current.onChange(parsed);
    setBinding(parsed);
  };
  const working = (value: boolean) => {
    if (!mounted.current) return;
    setBusy(value);
    callbacks.current.onBusy(value);
  };
  const show = (next: Session) => {
    if (!mounted.current) return;
    setSession(next);
    setUnknown(false);
    setMissingPreviewId(undefined);
  };
  const showRecovery = (
    result: Awaited<ReturnType<typeof readNativeScriptIntakeRecovery>>,
  ) => {
    if (!mounted.current) return;
    if (result.kind === "verified") show(result.session);
    else {
      setSession(undefined);
      setUnknown(true);
      setMissingPreviewId(result.previewId);
      setNotice(
        "已只读核验同一身份，当前未找到服务端预览；本地没有创建键。可明确解除本地绑定，不表示已取消服务器操作或删除内容。",
      );
    }
  };
  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (initial.current) {
      working(true);
      void readNativeScriptIntakeRecovery(client, initial.current)
        .then((next) => {
          if (active) showRecovery(next);
        })
        .catch((cause) => {
          if (active)
            setError(
              `同一创建前预览尚未核验：${message(cause)}；不会重建或重复导入。`,
            );
        })
        .finally(() => {
          if (active) working(false);
        });
    }
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [client]);
  const choose = async () => {
    working(true);
    resetConsent();
    setError(undefined);
    setNotice(undefined);
    setMissingPreviewId(undefined);
    let next: NativeScriptIntakeBinding | undefined;
    try {
      const file = (
        await client.host.pickFiles({
          multiple: false,
          extensions: ["fountain", "fdx", "json"],
        })
      )?.[0];
      if (!file || !mounted.current) return;
      next = { previewId: crypto.randomUUID() };
      remember(next);
      setUnknown(true);
      await client.screenplayIntakes.preview({
        previewId: next.previewId,
        grantId: file.grantId,
      });
      const result = await readNativeScriptIntake(client, next);
      remember({ ...next, etag: result.preview.etag });
      show(result);
    } catch (cause) {
      setError(`预览结果尚未核验：${message(cause)}；不会创建项目。`);
      if (next)
        try {
          const result = await readNativeScriptIntakeRecovery(client, next);
          showRecovery(result);
          if (result.kind === "verified") {
            remember({ ...next, etag: result.session.preview.etag });
            setNotice(
              "文件回复异常后已恢复同一预览；尚未创建项目，请重新核对声明。",
            );
          }
        } catch {
          setUnknown(true);
        }
    } finally {
      working(false);
    }
  };
  const verify = async () => {
    if (!binding) return;
    working(true);
    resetConsent();
    setError(undefined);
    setNotice(undefined);
    setMissingPreviewId(undefined);
    try {
      const result = await readNativeScriptIntakeRecovery(client, binding);
      showRecovery(result);
      if (result.kind === "verified")
        remember({ ...binding, etag: result.session.preview.etag });
    } catch (cause) {
      setUnknown(true);
      setError(`只读恢复尚未核验：${message(cause)}；不会重试写入或换项目。`);
    } finally {
      working(false);
    }
  };
  const releaseMissing = async () => {
    if (
      !binding ||
      binding.requestKey ||
      missingPreviewId !== binding.previewId
    )
      return;
    working(true);
    resetConsent();
    setError(undefined);
    setNotice(undefined);
    setMissingPreviewId(undefined);
    try {
      // Re-read at the explicit action boundary. A late preview wins over stale 'missing' UI evidence.
      const result = await readNativeScriptIntakeRecovery(client, binding);
      if (!mounted.current) return;
      if (result.kind === "verified") {
        remember({ ...binding, etag: result.session.preview.etag });
        show(result.session);
        setNotice(
          "同一预览现已存在，保留原绑定；请重新核对内容和声明，不另建预览。",
        );
        return;
      }
      callbacks.current.onChange(undefined);
      setBinding(undefined);
      setSession(undefined);
      setUnknown(false);
      setNotice(
        "已明确解除尚无创建键的本地预览绑定；没有删除服务端预览、项目或原稿，也未取消未知服务器操作。可以另选文件。",
      );
    } catch (cause) {
      setUnknown(true);
      setError(
        `解除前只读核验失败：${message(cause)}；保留同一绑定，不换文件或创建项目。`,
      );
    } finally {
      working(false);
    }
  };
  const write = async (action: "create" | "resume" | "discard") => {
    if (
      !binding ||
      unknown ||
      !session ||
      (action === "create" &&
        (!session.canCreate || !rights || !loss || !props.projectInput)) ||
      (action === "resume" && !session.canResume)
    )
      return;
    working(true);
    setError(undefined);
    setNotice(undefined);
    setMissingPreviewId(undefined);
    const next = {
      ...binding,
      ...(action !== "discard"
        ? { requestKey: binding.requestKey ?? crypto.randomUUID() }
        : {}),
    };
    try {
      remember(next);
      const before = await readNativeScriptIntake(client, next);
      if (action === "discard")
        await client.screenplayIntakes.discard(
          next.previewId,
          before.preview.etag,
        );
      else {
        const request =
          action === "resume"
            ? before.preview.request
            : ScreenplayIntakeCommitSchema.parse({
                previewId: next.previewId,
                project: props.projectInput!,
                confirmation: {
                  rightsDeclared: true as const,
                  lossReportReviewed: true as const,
                },
              });
        if (
          !request ||
          (action === "create" ? !before.canCreate : !before.canResume)
        )
          throw new Error("同一预览已变化；未开始另一创建。");
        await client.screenplayIntakes.commit(
          next.previewId,
          before.preview.etag,
          next.requestKey!,
          request,
        );
      }
      const result = await readNativeScriptIntake(client, next);
      show(result);
      if (mounted.current && action !== "discard" && result.canOpen)
        callbacks.current.onOpen(result.preview.receipt!);
      else
        setNotice(
          action === "discard"
            ? "原生文件预览已撤销，没有创建项目或原稿。"
            : "同一次初始化尚未完成；请核对保存状态后明确继续。",
        );
    } catch (cause) {
      setUnknown(true);
      setError(
        `创建／初始化／取消结果尚未核验：${message(cause)}。只读核验同一预览，不自动重试写入。`,
      );
      try {
        const result = await readNativeScriptIntake(client, next);
        show(result);
        if (result.canOpen) {
          setError(undefined);
          setNotice(
            "回复异常后已核验同一实际项目／原稿回执，没有重复创建；请明确打开原稿。",
          );
        }
      } catch (readError) {
        setError(
          `结果仍未核验：${message(readError)}。保留同一预览及创建键，不换文件或重复创建项目。`,
        );
      }
    } finally {
      resetConsent();
      working(false);
    }
  };
  const preview = session?.preview;
  return (
    <section
      aria-label={copyText("app/features/workspace/NativeScriptIntakePanel.1")}
      className={styles.c1}
    >
      <h3 className={styles.c2}>
        {copyText("app/features/workspace/NativeScriptIntakePanel.2")}
      </h3>
      <p className={styles.c3}>
        {copyText("app/features/workspace/NativeScriptIntakePanel.3")}
      </p>
      {!props.projectInput && (!preview || preview.status === "pending") && (
        <p className={styles.c4}>
          {copyText("app/features/workspace/NativeScriptIntakePanel.4")}
        </p>
      )}
      {!binding && (
        <Button
          variant="secondary"
          disabled={busy || props.disabled}
          onClick={() => void choose()}
        >
          {copyText("app/features/workspace/NativeScriptIntakePanel.5")}
        </Button>
      )}
      {binding && (
        <p className={styles.c5}>
          {copyText("app/features/workspace/NativeScriptIntakePanel.6")}
          {binding.previewId}
          {copyText("app/features/workspace/NativeScriptIntakePanel.7")}
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.status === "pending"
              ? "创建前原稿预览 · 尚未创建项目"
              : preview.status === "discarded"
                ? "创建前原稿预览已取消"
                : preview.status === "committed"
                  ? "原稿已导入实际项目 · 不重复创建"
                  : "已明确开始同一次创建 · 初始化尚未完成"}{" "}
            · {preview.sourceName} · {preview.sourceFormat.toUpperCase()} ·{" "}
            {preview.episodes
              ? `${preview.episodes.length} 集 · ${preview.episodes.reduce((count, episode) => count + episode.blocks.length, 0)} 个逐集稳定块`
              : `${preview.blocks.length} 个稳定块`}
          </p>
          <NativeScreenplayPreview
            blocks={preview.blocks}
            lossReport={preview.lossReport}
            showBlocks={!preview.episodes}
          />
          {preview.episodes && (
            <section
              aria-label={copyText(
                "app/features/workspace/NativeScriptIntakePanel.8",
              )}
              className={styles.c6}
            >
              <p>
                {preview.sourceTitle}
                {copyText("app/features/workspace/NativeScriptIntakePanel.9")}
              </p>
              {preview.episodes.map((episode, index) => (
                <article
                  key={episode.id}
                  aria-label={copyText(
                    "app/features/workspace/NativeScriptIntakePanel.40",
                    { p1: index + 1 },
                  )}
                  className={styles.c7}
                >
                  <h4>
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.10",
                    )}
                    {index + 1}
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.11",
                    )}
                    {episode.episodeNumber}
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.12",
                    )}{" "}
                    {episode.title}
                  </h4>
                  <p className={styles.c5}>
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.13",
                    )}
                    {episode.id} · {episode.blocks.length}
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.14",
                    )}{" "}
                    {episode.scenes.length}
                    {copyText(
                      "app/features/workspace/NativeScriptIntakePanel.15",
                    )}
                  </p>
                  <details
                    aria-label={copyText(
                      "app/features/workspace/NativeScriptIntakePanel.16",
                    )}
                  >
                    <summary>
                      {episode.contentSource === "episode-content"
                        ? "分集原文（逐字保留）"
                        : "由场景正文拼接的读取表达（不是原文件逐字正文）"}
                    </summary>
                    <pre className={styles.c8}>{episode.content}</pre>
                  </details>
                  <NativeScreenplayPreview
                    blocks={episode.blocks}
                    lossReport={episode.lossReport}
                  />
                  <details
                    aria-label={copyText(
                      "app/features/workspace/NativeScriptIntakePanel.17",
                    )}
                  >
                    <summary>
                      {copyText(
                        "app/features/workspace/NativeScriptIntakePanel.18",
                      )}
                    </summary>
                    <div className={styles.c9}>
                      {episode.scenes.map((scene, sourceIndex) => (
                        <pre key={sourceIndex} className={styles.c10}>
                          {JSON.stringify(scene, null, 2)}
                        </pre>
                      ))}
                    </div>
                  </details>
                </article>
              ))}
            </section>
          )}
          {preview.status === "pending" && (
            <>
              {!session?.canCreate && (
                <p className={styles.c11}>
                  {copyText(
                    "app/features/workspace/NativeScriptIntakePanel.19",
                  )}
                </p>
              )}
              <label className={styles.c12}>
                <input
                  type="checkbox"
                  checked={rights}
                  disabled={busy || unknown || !session?.canCreate}
                  onChange={(event) => setRights(event.target.checked)}
                />{" "}
                {copyText("app/features/workspace/NativeScriptIntakePanel.20")}
              </label>
              <label className={styles.c12}>
                <input
                  type="checkbox"
                  checked={loss}
                  disabled={busy || unknown || !session?.canCreate}
                  onChange={(event) => setLoss(event.target.checked)}
                />{" "}
                {copyText("app/features/workspace/NativeScriptIntakePanel.21")}
              </label>
              <p className={styles.c3}>
                {copyText("app/features/workspace/NativeScriptIntakePanel.22")}
              </p>
            </>
          )}
          {preview.request && (
            <p className={styles.c3}>
              {copyText("app/features/workspace/NativeScriptIntakePanel.23")}
              {preview.request.project.title}
              {copyText("app/features/workspace/NativeScriptIntakePanel.24")}
            </p>
          )}
          {preview.receipt && (
            <p className={styles.c13}>
              {copyText("app/features/workspace/NativeScriptIntakePanel.25")}
              {preview.receipt.projectId}
              {copyText("app/features/workspace/NativeScriptIntakePanel.26")}
              {preview.receipt.projectVersion}
              {copyText(
                "app/features/workspace/NativeScriptIntakePanel.27",
              )}{" "}
              {preview.receipt.episodeId}
              {copyText("app/features/workspace/NativeScriptIntakePanel.26")}
              {preview.receipt.episodeVersion}
              {copyText("app/features/workspace/NativeScriptIntakePanel.28")}
              {preview.receipt.scriptId}
              {copyText("app/features/workspace/NativeScriptIntakePanel.26")}
              {preview.receipt.scriptVersion}
              {copyText("app/features/workspace/NativeScriptIntakePanel.29")}
              {preview.receipt.documentId}
              {copyText("app/features/workspace/NativeScriptIntakePanel.26")}
              {preview.receipt.documentVersion}；
              {preview.sourceState === "current"
                ? "实际对象版本已核对"
                : "仅保留历史／对象已变化，不能自动覆盖或重建"}
              {copyText("app/features/workspace/NativeScriptIntakePanel.30")}
            </p>
          )}
          {preview.receipt?.episodes && (
            <details
              aria-label={copyText(
                "app/features/workspace/NativeScriptIntakePanel.31",
              )}
              className={styles.c14}
            >
              <summary>
                {copyText("app/features/workspace/NativeScriptIntakePanel.32")}
              </summary>
              <div className={styles.c9}>
                {preview.receipt.episodes.map((entry) => (
                  <pre key={entry.previewEpisodeId} className={styles.c15}>
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {binding && (
        <div className={styles.c16}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void verify()}
          >
            {copyText("app/features/workspace/NativeScriptIntakePanel.33")}
          </Button>
          {missingPreviewId === binding.previewId && !binding.requestKey && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void releaseMissing()}
            >
              {copyText("app/features/workspace/NativeScriptIntakePanel.34")}
            </Button>
          )}
          {preview?.status === "pending" && (
            <>
              <Button
                disabled={
                  busy ||
                  unknown ||
                  !session?.canCreate ||
                  !rights ||
                  !loss ||
                  !props.projectInput
                }
                onClick={() => void write("create")}
              >
                {copyText("app/features/workspace/NativeScriptIntakePanel.35")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || unknown}
                onClick={() => void write("discard")}
              >
                {copyText("app/features/workspace/NativeScriptIntakePanel.36")}
              </Button>
            </>
          )}
          {session?.canResume && (
            <Button
              disabled={busy || unknown}
              onClick={() => void write("resume")}
            >
              {copyText("app/features/workspace/NativeScriptIntakePanel.37")}
            </Button>
          )}
          {session?.canOpen && (
            <Button
              disabled={busy || unknown}
              onClick={() => callbacks.current.onOpen(preview!.receipt!)}
            >
              {copyText("app/features/workspace/NativeScriptIntakePanel.38")}
            </Button>
          )}
          {preview?.status === "discarded" && (
            <Button
              variant="ghost"
              disabled={busy || unknown}
              onClick={() => {
                callbacks.current.onChange(undefined);
                setBinding(undefined);
                setSession(undefined);
                setMissingPreviewId(undefined);
                setError(undefined);
                setNotice(undefined);
              }}
            >
              {copyText("app/features/workspace/NativeScriptIntakePanel.39")}
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.c17}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.c11}>
          {error}
        </p>
      )}
    </section>
  );
}
