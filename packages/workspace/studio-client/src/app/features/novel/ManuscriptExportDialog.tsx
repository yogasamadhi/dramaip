import type { Chapter, Project } from "@dramaip/contracts/product";
import type { ManuscriptPreview } from "@dramaip/contracts/delivery";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  Textarea,
} from "@dramaip/infra-ui-primitives";
import { useEffect, useState } from "react";
import { useQueryClient } from "../../query";
import { message, useStudio } from "../../studio-shared";
import styles from "./ManuscriptExportDialog.module.css";
import { copyText } from "../../copy";

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
      <Dialog.Content
        className={styles.c1}
        aria-label={copyText("app/features/novel/ManuscriptExportDialog.1")}
      >
        <Dialog.Title>
          {copyText("app/features/novel/ManuscriptExportDialog.2")}
        </Dialog.Title>
        <Dialog.Description>
          {copyText("app/features/novel/ManuscriptExportDialog.3")}
        </Dialog.Description>
        <div className={styles.c2}>
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {!preview ? (
            <>
              <fieldset disabled={working} className={styles.c3}>
                <legend className={styles.c4}>
                  {copyText("app/features/novel/ManuscriptExportDialog.4")}
                </legend>
                <p className={styles.c5}>
                  {copyText("app/features/novel/ManuscriptExportDialog.5")}
                </p>
                {chapters.map((chapter) => (
                  <label key={chapter.id} className={styles.c6}>
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
                    {chapter.title}
                    {copyText("app/features/novel/ManuscriptExportDialog.6")}
                    {chapter.version}
                    {chapter.content.trim() ? "" : " · 空正文"}
                  </label>
                ))}
              </fieldset>
              <p className={styles.c5}>
                {project?.title ?? "正在加载…"}
                {copyText("app/features/novel/ManuscriptExportDialog.7")}
                {selected.length}/{chapters.length}
                {copyText("app/features/novel/ManuscriptExportDialog.8")}
              </p>
              <Button
                disabled={working || !selected.length}
                onClick={() => void prepare()}
              >
                {copyText("app/features/novel/ManuscriptExportDialog.9")}
              </Button>
            </>
          ) : (
            <>
              <p className={styles.c7}>
                {preview.manifest.scope === "whole-project"
                  ? "完整稿件"
                  : "所选章节稿件"}{" "}
                · {preview.manifest.chapters.length}
                {copyText("app/features/novel/ManuscriptExportDialog.10")}{" "}
                {preview.manifest.format.toUpperCase()} ·{" "}
                {preview.manifest.byteSize}
                {copyText("app/features/novel/ManuscriptExportDialog.11")}
              </p>
              <ol className={styles.c8}>
                {preview.manifest.chapters.map((item) => (
                  <li key={item.id}>
                    {item.title}
                    {copyText("app/features/novel/ManuscriptExportDialog.6")}
                    {item.version}
                  </li>
                ))}
              </ol>
              <p className={styles.c9}>
                {copyText("app/features/novel/ManuscriptExportDialog.12")}
                {preview.manifest.contentSha256}
              </p>
              <pre
                className={styles.c10}
                aria-label={copyText(
                  "app/features/novel/ManuscriptExportDialog.13",
                )}
              >
                {preview.document.content}
              </pre>
              {preview.sourceState === "stale" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/novel/ManuscriptExportDialog.14")}
                  {preview.sourceIssues.join(" ")}
                </InlineNotice>
              )}
              {preview.status === "awaiting-confirmation" && (
                <fieldset disabled={working} className={styles.c11}>
                  <legend className={styles.c4}>
                    {copyText("app/features/novel/ManuscriptExportDialog.15")}
                  </legend>
                  <label className={styles.c12}>
                    {copyText("app/features/novel/ManuscriptExportDialog.16")}
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
                  <label className={styles.c12}>
                    {copyText("app/features/novel/ManuscriptExportDialog.17")}
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={copyText(
                        "app/features/novel/ManuscriptExportDialog.18",
                      )}
                    />
                  </label>
                  <label className={styles.c13}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    {copyText("app/features/novel/ManuscriptExportDialog.19")}
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
                  {copyText("app/features/novel/ManuscriptExportDialog.20")}
                  {preview.receipt?.savedAt} · {preview.receipt?.byteSize}{" "}
                  {copyText("app/features/novel/ManuscriptExportDialog.21")}
                </InlineNotice>
              )}
              {preview.status === "canceled" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/novel/ManuscriptExportDialog.22")}
                </InlineNotice>
              )}
              {preview.status === "saving" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/novel/ManuscriptExportDialog.23")}
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
                  {copyText("app/features/novel/ManuscriptExportDialog.24")}
                </Button>
              )}
            </>
          )}
        </div>
        <div className={styles.c14}>
          <Button
            variant="secondary"
            disabled={working}
            onClick={props.onClose}
          >
            {copyText("app/features/novel/ManuscriptExportDialog.25")}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
