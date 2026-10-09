import type { Chapter, Project } from "@dramaip/contracts/product";
import type { ManuscriptPreview } from "@dramaip/contracts/delivery";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  Textarea,
} from "@dramaip/ui-shared";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { message, useStudio } from "../../studio-shared";

export function ManuscriptExportDialog(props: {
  projectId: string;
  format: "markdown" | "json";
  previewId?: string;
  onClose(): void;
  onSaved(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [project, setProject] = useState<Project>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ManuscriptPreview>();
  const [format, setFormat] = useState(props.format);
  const [basis, setBasis] = useState<
    "original" | "authorized" | "public-domain"
  >("original");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    setWorking(true);
    void Promise.all([
      client.projects.get(props.projectId),
      client.chapters.list(props.projectId),
      props.previewId
        ? client.manuscripts.get(props.previewId)
        : Promise.resolve(undefined),
    ])
      .then(([p, c, saved]) => {
        if (!alive) return;
        if (saved && saved.manifest.projectId !== props.projectId)
          throw new Error("稿件不属于当前项目。");
        setProject(p);
        setChapters(c.slice().sort((a, b) => a.orderIndex - b.orderIndex));
        setSelected(
          saved
            ? saved.manifest.chapters.map((item) => item.id)
            : c.filter((item) => item.content.trim()).map((item) => item.id),
        );
        setPreview(saved);
        setFormat(saved?.manifest.format ?? props.format);
        setBasis(saved?.rights?.basis ?? "original");
        setNote(saved?.rights?.note ?? "");
        setConfirmed(false);
      })
      .catch((cause) => {
        if (alive) setError(message(cause));
      })
      .finally(() => {
        if (alive) setWorking(false);
      });
    return () => {
      alive = false;
    };
  }, [client, props.projectId, props.previewId, props.format]);

  const prepare = async () => {
    setWorking(true);
    setError(undefined);
    setConfirmed(false);
    try {
      // Refresh actual saved versions; local unsaved editor text is not a source.
      const [p, c] = await Promise.all([
        client.projects.get(props.projectId),
        client.chapters.list(props.projectId),
      ]);
      const chosen = c.filter((item) => selected.includes(item.id));
      if (chosen.length !== selected.length)
        throw new Error("目录已变化，请重新打开并选择范围。");
      const value = await client.manuscripts.preview(
        props.projectId,
        {
          projectVersion: p.version,
          scope:
            chosen.length === c.length ? "whole-project" : "selected-chapters",
          chapters: chosen.map(({ id, version }) => ({ id, version })),
          format,
        },
        crypto.randomUUID(),
      );
      setPreview(value);
      await queryClient.invalidateQueries({
        queryKey: ["novel-cockpit-evidence", props.projectId],
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    if (!preview || !confirmed) return;
    setWorking(true);
    setError(undefined);
    try {
      const value = await client.manuscripts.save(
        preview.id,
        {
          version: preview.version,
          contentSha256: preview.manifest.contentSha256,
          rights: { basis, note, confirmed: true },
        },
        crypto.randomUUID(),
      );
      setPreview(value);
      await queryClient.invalidateQueries({
        queryKey: ["novel-cockpit-evidence", props.projectId],
      });
      if (value.status === "saved") props.onSaved();
      if (value.error) setError(value.error);
    } catch (cause) {
      setError(message(cause));
      // A timeout is not proof of failure. Read the same durable record;
      // never automatically reopen the native save dialog.
      try {
        setPreview(await client.manuscripts.get(preview.id));
      } catch {
        /* Keep the known preview and error. */
      }
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) props.onClose();
      }}
    >
      <Dialog.Content className="max-w-4xl" aria-label="稿件交付预览">
        <Dialog.Title>核验并导出投稿稿件</Dialog.Title>
        <Dialog.Description>
          确认实际保存的章节版本与导出权利。AI
          采用与作者稿均可导出；不要求改编或媒体。权利声明由作者确认，不是系统对授权或投稿录用的保证。
        </Dialog.Description>
        <div className="mt-4 max-h-[65vh] space-y-4 overflow-y-auto">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {!preview ? (
            <>
              <fieldset disabled={working} className="space-y-2">
                <legend className="font-medium">选择稿件范围</legend>
                <p className="text-xs text-muted">
                  仅导出已保存正文。未保存修改、空章和生成候选不会自动进入稿件。
                </p>
                {chapters.map((chapter) => (
                  <label
                    key={chapter.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(chapter.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, chapter.id]
                            : current.filter((id) => id !== chapter.id),
                        )
                      }
                    />
                    {chapter.title} · v{chapter.version}
                    {chapter.content.trim() ? "" : " · 空正文"}
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted">
                {project?.title ?? "正在加载…"} · 已选择 {selected.length}/
                {chapters.length} 章。部分范围不会被标为完整稿件交付。
              </p>
              <Button
                disabled={working || !selected.length}
                onClick={() => void prepare()}
              >
                生成稿件预览
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                {preview.manifest.scope === "whole-project"
                  ? "完整稿件"
                  : "所选章节稿件"}{" "}
                · {preview.manifest.chapters.length} 章 ·{" "}
                {preview.manifest.format.toUpperCase()} ·{" "}
                {preview.manifest.byteSize} 字节
              </p>
              <ol className="list-inside list-decimal text-sm">
                {preview.manifest.chapters.map((item) => (
                  <li key={item.id}>
                    {item.title} · v{item.version}
                  </li>
                ))}
              </ol>
              <p className="break-all text-xs text-muted">
                文件 SHA-256：{preview.manifest.contentSha256}
              </p>
              <pre
                className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line p-3 text-xs"
                aria-label="实际稿件内容"
              >
                {preview.document.content}
              </pre>
              {preview.sourceState === "stale" && (
                <InlineNotice tone="warning">
                  来源已变化；这份稿件不能证明当前版本已交付。
                  {preview.sourceIssues.join(" ")}
                </InlineNotice>
              )}
              {preview.status === "awaiting-confirmation" && (
                <fieldset disabled={working} className="space-y-3">
                  <legend className="font-medium">所选章节的导出权利</legend>
                  <label className="grid gap-1 text-sm">
                    权利依据
                    <Select
                      value={basis}
                      disabled={working}
                      onValueChange={(value) => setBasis(value as typeof basis)}
                      options={[
                        {
                          value: "original",
                          label: "本人原创 / 由本人负责的作者稿",
                        },
                        {
                          value: "authorized",
                          label: "已取得所选范围的导出授权",
                        },
                        {
                          value: "public-domain",
                          label: "已核对公版来源与适用范围",
                        },
                      ]}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    权利范围说明
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="可记录来源、授权范围与限制；不是向云端上传授权文件。"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我确认上述章节版本与范围，并有权导出这份稿件
                  </label>
                  <Button
                    disabled={
                      working || !confirmed || preview.sourceState !== "current"
                    }
                    onClick={() => void save()}
                  >
                    {working ? "正在保存…" : "确认范围与权利并保存稿件"}
                  </Button>
                </fieldset>
              )}
              {preview.status === "saved" && (
                <InlineNotice tone="success">
                  稿件已保存并核验。{preview.receipt?.savedAt} ·{" "}
                  {preview.receipt?.byteSize}{" "}
                  字节。此回执证明当时保存成功，不监控外部文件之后的移动、修改或删除。
                </InlineNotice>
              )}
              {preview.status === "canceled" && (
                <InlineNotice tone="warning">
                  已取消保存，未记录成功交付。
                </InlineNotice>
              )}
              {preview.status === "saving" && (
                <InlineNotice tone="warning">
                  保存结果尚未确定；先核对原保存窗口与文件，不要重复提交。
                </InlineNotice>
              )}
              {preview.status !== "saving" && (
                <Button
                  variant="secondary"
                  disabled={working}
                  onClick={() => {
                    setPreview(undefined);
                    setConfirmed(false);
                  }}
                >
                  重新选择范围与生成预览
                </Button>
              )}
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            disabled={working}
            onClick={props.onClose}
          >
            关闭稿件预览
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
