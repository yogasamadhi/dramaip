import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";
import { NativeScreenplayPreview } from "./NativeScreenplayPreview";
import {
  ScreenplayImportBindingSchema,
  screenplayImportStorageKey,
  readScreenplayImportSession,
  type ScreenplayImportBinding,
} from "../../screenplay-import-session";

type Session = Awaited<ReturnType<typeof readScreenplayImportSession>>;

export function ScreenplayImportPanel(props: {
  projectId: string;
  episodeId: string;
  onImported(): void;
}) {
  const client = useStudio();
  const imported = useRef(props.onImported);
  imported.current = props.onImported;
  const key = screenplayImportStorageKey(props.projectId, props.episodeId);
  const [binding, setBinding] = useState<ScreenplayImportBinding>();
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [rights, setRights] = useState(false);
  const [loss, setLoss] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const resetConsent = () => {
    setRights(false);
    setLoss(false);
  };
  const remember = (value: ScreenplayImportBinding) => {
    window.localStorage.setItem(key, JSON.stringify(value));
    setBinding(value);
  };
  const show = (value: Session) => {
    if (!mounted.current) return;
    setSession(value);
    setUnknown(false);
    if (value.preview.status === "committed") imported.current();
  };
  useEffect(() => {
    let active = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const saved = ScreenplayImportBindingSchema.parse(JSON.parse(raw));
      if (
        saved.projectId !== props.projectId ||
        saved.episodeId !== props.episodeId
      )
        throw new Error("恢复的导入目标不属于本项目／分集。");
      setBinding(saved);
      setUnknown(true);
      setBusy(true);
      void readScreenplayImportSession(client, saved)
        .then((value) => {
          if (active) show(value);
        })
        .catch((cause) => {
          if (active)
            setError(
              `导入状态尚未核验：${message(cause)}。只恢复同一预览，不重复提交。`,
            );
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } catch (cause) {
      setError(message(cause));
      setUnknown(true);
    }
    return () => {
      active = false;
    };
    // Identity is keyed by project/episode; checked consent deliberately never restores.
  }, [client, key, props.projectId, props.episodeId]);
  const choose = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    resetConsent();
    try {
      const files = await client.host.pickFiles({
        multiple: false,
        extensions: ["fountain", "fdx"],
      });
      const file = files?.[0];
      if (!file) return;
      const sources = await client.episodeDevelopments.sources(props.projectId);
      const episodes =
        sources.direct?.episodes.filter(
          (item) => item.id === props.episodeId,
        ) ?? [];
      if (
        sources.projectId !== props.projectId ||
        sources.direct?.project.id !== props.projectId ||
        episodes.length !== 1
      )
        throw new Error("当前实际分集尚未核全；未创建导入预览。");
      const target = {
        projectVersion: sources.direct.project.version,
        episodeVersion: episodes[0]!.version,
      };
      const preview = await client.screenplayImports.preview({
        projectId: props.projectId,
        parentId: props.episodeId,
        title:
          file.displayName
            .replace(/\.(fountain|fdx)$/iu, "")
            .trim()
            .slice(0, 240) || "导入原剧本",
        grantId: file.grantId,
        target,
      });
      const next = ScreenplayImportBindingSchema.parse({
        previewId: preview.previewId,
        projectId: props.projectId,
        episodeId: props.episodeId,
        etag: preview.etag,
        target,
      });
      remember(next);
      show(await readScreenplayImportSession(client, next));
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const verify = async () => {
    if (!binding) return;
    setBusy(true);
    setError(undefined);
    resetConsent();
    try {
      show(await readScreenplayImportSession(client, binding));
    } catch (cause) {
      setUnknown(true);
      setError(`同一预览尚未核验：${message(cause)}；不会重新提交或换稿。`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const mutate = async (action: "commit" | "discard") => {
    if (
      !binding ||
      unknown ||
      (action === "commit" && (!rights || !loss || !session?.canCommit))
    )
      return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // Persist the exact recovery handle before any potentially ambiguous write.
      remember(binding);
      const current = await readScreenplayImportSession(client, binding);
      if (action === "commit" && !current.canCommit)
        throw new Error("原目标已变或预览已使用；未重新导入。请核验同一预览。");
      if (action === "commit")
        await client.screenplayImports.commit(binding.previewId, binding.etag, {
          rightsDeclared: true,
          lossReportReviewed: true,
        });
      else
        await client.screenplayImports.discard(binding.previewId, binding.etag);
      show(await readScreenplayImportSession(client, binding));
      setNotice(
        action === "commit"
          ? "已核验同一预览的提交回执。请手动选择实际原稿，再确认本轮单集基准；不会自动生成或采用。"
          : "预览已取消，没有导入或覆盖原稿。",
      );
    } catch (cause) {
      setUnknown(true);
      setError(
        `提交／取消结果可能尚未核验：${message(cause)}。正在只读查询同一预览，不重试写入。`,
      );
      try {
        const recovered = await readScreenplayImportSession(client, binding);
        show(recovered);
        setError(
          recovered.preview.status === "committed" ? undefined : message(cause),
        );
        if (recovered.preview.status === "committed")
          setNotice(
            "回复异常后已按同一预览回执确认原稿提交；没有重复导入。请手动选择原稿并确认单集基准。",
          );
      } catch (readError) {
        setError(
          `结果仍未核验：${message(readError)}。保留原预览身份，只使用“恢复同一导入预览”，不换稿或重复提交。`,
        );
      }
    } finally {
      resetConsent();
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => {
    window.localStorage.removeItem(key);
    setBinding(undefined);
    setSession(undefined);
    setError(undefined);
    setNotice(undefined);
    setUnknown(false);
    resetConsent();
  };
  const preview = session?.preview;
  return (
    <section
      aria-label="原生剧本导入"
      className="space-y-3 rounded-lg border border-line p-4 text-sm"
    >
      <h3 className="font-medium">导入本集原稿 · 原生剧本文件</h3>
      <p className="text-muted">
        仅支持
        Fountain／FDX。预览和明确提交分开；不会覆盖原稿、自动选择故事来源、生成候选或创建小说／诊断／季纲。PDF／OCR
        尚不支持。
      </p>
      {!binding && !unknown && (
        <Button disabled={busy} onClick={() => void choose()}>
          {busy ? "正在读取文件…" : "选择原生剧本文件"}
        </Button>
      )}
      {binding && (
        <p className="break-all text-muted">
          同一预览 {binding.previewId} · 本集 {binding.episodeId} · 项目 v
          {binding.target.projectVersion} / 分集 v
          {binding.target.episodeVersion}
          ；恢复仅保存身份与版本，不保存正文／文件授权或勾选状态。
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.status === "pending"
              ? "原稿导入预览 · 尚未提交"
              : preview.status === "committed"
                ? "原稿已提交 · 不重复导入"
                : "原稿导入预览已取消"}{" "}
            · {preview.sourceName} · {preview.sourceFormat.toUpperCase()} ·{" "}
            {preview.blocks.length} 个稳定块
          </p>
          <NativeScreenplayPreview
            blocks={preview.blocks}
            lossReport={preview.lossReport}
          />
          {preview.status === "pending" && (
            <>
              {!session?.targetCurrent && (
                <p className="text-danger-strong">
                  确认的项目／实际分集版本已变化，不能按旧预览提交；可取消后重新选择文件。
                </p>
              )}
              {session?.targetCurrent && !session.canCommit && (
                <p className="text-danger-strong">
                  预览没有有效动作／对白，或格式与稳定块尚不可用；空稿和排版占位不能作为故事原稿。
                </p>
              )}
              <label className="block">
                <input
                  type="checkbox"
                  checked={rights}
                  disabled={busy || unknown || !session?.canCommit}
                  onChange={(event) => setRights(event.target.checked)}
                />{" "}
                我确认有权将此稿件导入本项目（声明不等于授权证明）。
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={loss}
                  disabled={busy || unknown || !session?.canCommit}
                  onChange={(event) => setLoss(event.target.checked)}
                />{" "}
                我已核对完整剧本块及格式损失，接受本次转换。
              </label>
            </>
          )}
          {preview.status === "committed" && (
            <p className="break-all">
              {preview.receipt
                ? `实际回执：原稿 ${preview.receipt.scriptId} v${preview.receipt.scriptVersion} · 文档 ${preview.receipt.documentId} v${preview.receipt.documentVersion} · ${preview.receipt.committedAt}`
                : "历史导入缺少精确回执，无法猜测原稿身份；不要自动重导。"}
              {preview.receipt && !session?.receiptCurrent
                ? "；原稿已变化、删除或不再属于当前目录，本回执仅保留历史。"
                : "；请手动选择原稿并重新确认单集基准。"}{" "}
              来源使用权与损失确认是作者声明，不是完整授权／发行核验。
            </p>
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
            恢复同一导入预览
          </Button>
          {preview?.status === "pending" && (
            <>
              <Button
                disabled={
                  busy || unknown || !session?.canCommit || !rights || !loss
                }
                onClick={() => void mutate("commit")}
              >
                明确提交本集原稿
              </Button>
              <Button
                variant="ghost"
                disabled={busy || unknown}
                onClick={() => void mutate("discard")}
              >
                取消原稿导入预览
              </Button>
            </>
          )}
          {preview && preview.status !== "pending" && (
            <Button variant="ghost" disabled={busy || unknown} onClick={close}>
              关闭导入记录
            </Button>
          )}
        </div>
      )}
      {busy && <p role="status">正在核验或处理同一导入预览…</p>}
      {unknown && (
        <p className="text-danger-strong">
          导入结果尚未核验，禁止重复提交或换文件。保留原预览身份，恢复时不继承勾选状态。
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-danger-strong">
          {error}
        </p>
      )}
      {notice && <p className="text-brand">{notice}</p>}
    </section>
  );
}
