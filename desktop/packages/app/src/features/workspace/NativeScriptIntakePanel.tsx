import { useEffect, useRef, useState } from "react";
import type { ProjectInput } from "@dramaip/contracts/product";
import {
  ScreenplayIntakeCommitSchema,
  type ScreenplayIntakePreview,
} from "@dramaip/contracts/production";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";
import {
  readNativeScriptIntake,
  readNativeScriptIntakeRecovery,
  NativeScriptIntakeBindingSchema,
  type NativeScriptIntakeBinding,
} from "../../native-script-intake";
import { NativeScreenplayPreview } from "../production/NativeScreenplayPreview";

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
      aria-label="创建前原生剧本导入"
      className="mt-4 space-y-3 rounded-xl border border-line bg-surface-raised p-4 text-sm"
    >
      <h3 className="font-medium">
        创建前导入剧本文件 · Fountain／FDX／结构化 JSON
      </h3>
      <p className="text-muted">
        先看完整稳定块与格式损失，再明确确认使用权和单季剧本目标。预览／取消不创建项目；原稿不覆盖，不创建小说、诊断、季纲或媒体。PDF／OCR
        尚不支持。
      </p>
      {!props.projectInput && (!preview || preview.status === "pending") && (
        <p className="text-warning">
          项目名称或目标设置尚不合法；请先修正，再明确创建。草稿和原预览保留，不换创建键。
        </p>
      )}
      {!binding && (
        <Button
          variant="secondary"
          disabled={busy || props.disabled}
          onClick={() => void choose()}
        >
          选择原生剧本文件
        </Button>
      )}
      {binding && (
        <p className="break-all text-muted">
          同一创建前预览 {binding.previewId}
          ；恢复仅存身份／版本／创建键，无文件路径、grant、正文或勾选声明。
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
            <section aria-label="全部结构化分集原稿" className="space-y-3">
              <p>
                {preview.sourceTitle} ·
                按文件顺序核对全部分集，分集号不替代文件顺序。原场景资料不等于已采用分镜。
              </p>
              {preview.episodes.map((episode, index) => (
                <article
                  key={episode.id}
                  aria-label={`文件分集 ${index + 1}`}
                  className="space-y-2 rounded border border-line p-3"
                >
                  <h4>
                    文件位置 {index + 1} · 第 {episode.episodeNumber} 集 ·{" "}
                    {episode.title}
                  </h4>
                  <p className="break-all text-muted">
                    来源身份 {episode.id} · {episode.blocks.length} 个稳定块 ·{" "}
                    {episode.scenes.length} 个原场景
                  </p>
                  <details aria-label="分集读取表达">
                    <summary>
                      {episode.contentSource === "episode-content"
                        ? "分集原文（逐字保留）"
                        : "由场景正文拼接的读取表达（不是原文件逐字正文）"}
                    </summary>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                      {episode.content}
                    </pre>
                  </details>
                  <NativeScreenplayPreview
                    blocks={episode.blocks}
                    lossReport={episode.lossReport}
                  />
                  <details aria-label="全部原场景资料">
                    <summary>
                      核对全部原场景属性（只导入实际场景，不推演或正式采用分镜）
                    </summary>
                    <div className="max-h-96 overflow-auto">
                      {episode.scenes.map((scene, sourceIndex) => (
                        <pre
                          key={sourceIndex}
                          className="whitespace-pre-wrap break-all border-b border-line py-2"
                        >
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
                <p className="text-danger-strong">
                  预览无有效动作／对白，或稳定块无效，不能创建故事原稿。
                </p>
              )}
              <label className="block">
                <input
                  type="checkbox"
                  checked={rights}
                  disabled={busy || unknown || !session?.canCreate}
                  onChange={(event) => setRights(event.target.checked)}
                />{" "}
                我确认有权将此原稿导入新项目（声明不等于授权证明）。
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={loss}
                  disabled={busy || unknown || !session?.canCreate}
                  onChange={(event) => setLoss(event.target.checked)}
                />{" "}
                我已核对完整原稿块及格式损失，接受本次转换。
              </label>
              <p className="text-muted">
                仅支持已明确选择的“开发剧本 ·
                单季短剧”；首次创建使用当前已填写简报。断线恢复只读，不继承两个勾选。
              </p>
            </>
          )}
          {preview.request && (
            <p className="text-muted">
              已确认目标：{preview.request.project.title} ·
              已有剧本单季开发；继续初始化沿用这份冻结输入，不使用后来修改的表单，也不另建项目。
            </p>
          )}
          {preview.receipt && (
            <p className="break-all">
              实际回执：项目 {preview.receipt.projectId} v
              {preview.receipt.projectVersion} · 分集{" "}
              {preview.receipt.episodeId} v{preview.receipt.episodeVersion} ·
              原稿 {preview.receipt.scriptId} v{preview.receipt.scriptVersion} ·
              AST {preview.receipt.documentId} v
              {preview.receipt.documentVersion}；
              {preview.sourceState === "current"
                ? "实际对象版本已核对"
                : "仅保留历史／对象已变化，不能自动覆盖或重建"}
              。原稿导入不等于正式大纲／剧本采用、完整授权或文学质量通过。
            </p>
          )}
          {preview.receipt?.episodes && (
            <details
              aria-label="全部实际分集初始化回执"
              className="rounded border border-line p-3"
            >
              <summary>
                全部分集／原稿／AST／原场景回执（打开原稿使用文件中首个分集）
              </summary>
              <div className="max-h-96 overflow-auto">
                {preview.receipt.episodes.map((entry) => (
                  <pre
                    key={entry.previewEpisodeId}
                    className="whitespace-pre-wrap break-all py-2"
                  >
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {binding && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void verify()}
          >
            只读恢复同一创建前预览
          </Button>
          {missingPreviewId === binding.previewId && !binding.requestKey && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void releaseMissing()}
            >
              明确解除未开始创建的预览绑定
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
                确认原生预览并创建剧本项目
              </Button>
              <Button
                variant="ghost"
                disabled={busy || unknown}
                onClick={() => void write("discard")}
              >
                取消创建前原生预览
              </Button>
            </>
          )}
          {session?.canResume && (
            <Button
              disabled={busy || unknown}
              onClick={() => void write("resume")}
            >
              明确继续同一次原生初始化
            </Button>
          )}
          {session?.canOpen && (
            <Button
              disabled={busy || unknown}
              onClick={() => callbacks.current.onOpen(preview!.receipt!)}
            >
              打开实际导入原稿
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
              清除已取消的原生预览
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-brand">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-strong">
          {error}
        </p>
      )}
    </section>
  );
}
