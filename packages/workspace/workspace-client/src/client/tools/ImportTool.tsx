import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type { SourceImportsPreviewResult } from "@dramaip/workspace-workspace/types";
import type { ToolProps } from "./PersonalTheaterTool.tsx";
import { messageOf, statusOf, value } from "./remote.ts";
import {
  checkSourceImportRecovery,
  clearSourceImportAttempt,
  freezeSourceImportAttempt,
  isSourceImportAttempt,
  persistSourceImportAttempt,
  readSourceImportAttempt,
  SourceImportError,
  type SourceImportAttempt,
  type SourceImportPreview,
} from "./source-import.ts";
import css from "./Tools.module.css";

type Duplicates = SourceImportsPreviewResult["duplicates"];
type Chapter = SourceImportPreview["chapters"][number];

const EXTENSIONS = ["txt", "md", "markdown", "docx", "epub", "json"];
const NO_DUPLICATES: Duplicates = { chapters: [], episodes: [] };

/** The stored attempt of a project, when it is a whole one of that project. */
const validAttempt = (stored: unknown, projectId: string) =>
  isSourceImportAttempt(stored) && stored.input.projectId === projectId
    ? stored
    : undefined;

/** Characters of a chapter, without whitespace. */
const wordCount = (content: string) => [...content.replace(/\s/g, "")].length;

/**
 * Import a novel manuscript or a script into one project: pick a file the
 * author holds the rights to, preview and edit its chapters, and commit it
 * appended to the project. The confirmed input and its replay key are frozen
 * on this machine before they are sent, so an unknown answer is recovered as
 * the same import rather than sent again under another key or another file.
 */
export function ImportTool(props: ToolProps) {
  const { projectId, workspace, system, t } = props;
  const [stored, setStored] = useState<unknown>(() =>
    readSourceImportAttempt(projectId),
  );
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const frozen = stored !== undefined;
  const attempt = validAttempt(stored, projectId);
  const [open, setOpen] = useState(true);
  const [importId, setImportId] = useState(attempt?.importId);
  const [preview, setPreview] = useState(attempt?.input.preview);
  const [duplicates, setDuplicates] = useState<Duplicates>(NO_DUPLICATES);
  const [selected, setSelected] = useState(0);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const refusal = (cause: unknown) =>
    cause instanceof SourceImportError
      ? t(`import.refused.${cause.refusal}`)
      : messageOf(cause);

  useEffect(() => {
    const next = readSourceImportAttempt(projectId);
    storedRef.current = next;
    setStored(next);
    const valid = validAttempt(next, projectId);
    setImportId(valid?.importId);
    setPreview(valid?.input.preview);
    setRightsConfirmed(false);
    setSelected(0);
    setNotice(
      next !== undefined && !valid ? t("import.frozen.broken") : undefined,
    );
    if (!valid) return;
    setOpen(true);
    let live = true;
    void value(
      workspace.sourceImportsGetCommit(valid.importId, {
        projectId,
        requestKey: valid.requestKey,
      }),
    ).then(
      (saved) => {
        if (!live) return;
        try {
          checkSourceImportRecovery(valid, saved);
          setNotice(
            t(
              saved.state === "committed"
                ? "import.frozen.committed"
                : "import.frozen.pending",
            ),
          );
        } catch (cause) {
          setNotice(refusal(cause));
        }
      },
      (cause: unknown) =>
        live &&
        setNotice(t("import.frozen.unverified", { message: messageOf(cause) })),
    );
    return () => {
      live = false;
    };
  }, [workspace, projectId]);

  const total =
    (preview?.chapters.length ?? 0) + (preview?.episodes.length ?? 0);
  const reset = async () => {
    if (storedRef.current !== undefined)
      return setNotice(t("import.frozen.keep"));
    if (importId)
      // The temporary preview may already have expired or been committed.
      await value(
        workspace.sourceImportsDiscard(importId, undefined, undefined),
      ).catch(() => undefined);
    setImportId(undefined);
    setPreview(undefined);
    setDuplicates(NO_DUPLICATES);
    setSelected(0);
    setRightsConfirmed(false);
  };
  const close = () => {
    if (storedRef.current === undefined) void reset();
    setOpen(false);
  };
  const choose = async () => {
    if (storedRef.current !== undefined)
      return setNotice(t("import.frozen.noReplace"));
    setWorking(true);
    setNotice(undefined);
    try {
      const files = await value(
        system.pickFiles({ multiple: false, extensions: EXTENSIONS }),
      );
      const file = files?.[0];
      if (!file) return;
      if (importId)
        await value(
          workspace.sourceImportsDiscard(importId, undefined, undefined),
        );
      const result = await value(
        workspace.sourceImportsPreview(
          { projectId, capabilityToken: file.grantId },
          undefined,
          undefined,
        ),
      );
      setImportId(result.importId);
      setPreview(result.preview);
      setDuplicates(result.duplicates);
      setSelected(0);
      setRightsConfirmed(false);
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };
  /** Change the editable preview's chapters; a frozen one stays as sent. */
  const editChapters = (edit: (chapters: Chapter[]) => Chapter[]) => {
    if (storedRef.current !== undefined || !preview) return;
    setPreview({ ...preview, chapters: edit(preview.chapters) });
  };
  const updateChapter = (patch: Partial<Pick<Chapter, "title" | "content">>) =>
    editChapters((chapters) =>
      chapters.map((chapter, index) =>
        index === selected
          ? {
              ...chapter,
              ...patch,
              wordCount: wordCount(patch.content ?? chapter.content),
            }
          : chapter,
      ),
    );
  const addChapter = () =>
    editChapters((chapters) => {
      setSelected(chapters.length);
      return [
        ...chapters,
        {
          key: `manual-${crypto.randomUUID()}`,
          title: t("import.chapter.new", { index: chapters.length + 1 }),
          content: "",
          orderIndex: chapters.length,
          wordCount: 0,
        },
      ];
    });
  const removeChapter = () =>
    editChapters((chapters) => {
      if (chapters.length <= 1) return chapters;
      setSelected(Math.max(0, selected - 1));
      return chapters
        .filter((_, index) => index !== selected)
        .map((chapter, index) => ({ ...chapter, orderIndex: index }));
    });
  const commit = async () => {
    if (!importId || !preview) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const original = storedRef.current as SourceImportAttempt | undefined;
      const next = freezeSourceImportAttempt(
        importId,
        {
          projectId,
          strategy: "append",
          rightsConfirmed,
          destructiveConfirmed: false,
          preview,
        },
        original,
      );
      persistSourceImportAttempt(next);
      storedRef.current = next;
      setStored(next);
      let saved;
      if (original)
        try {
          saved = await value(
            workspace.sourceImportsGetCommit(next.importId, {
              projectId,
              requestKey: next.requestKey,
            }),
          );
          checkSourceImportRecovery(next, saved);
        } catch (cause) {
          if (statusOf(cause) !== 404) throw cause;
        }
      const result =
        saved?.state === "committed" && saved.result
          ? saved.result
          : await value(
              workspace.sourceImportsCommit(
                next.importId,
                next.input,
                undefined,
                next.requestKey,
              ),
            );
      clearSourceImportAttempt(projectId);
      storedRef.current = undefined;
      setStored(undefined);
      setNotice(
        t("import.done", {
          chapters: result.createdChapters,
          scripts: result.createdScripts,
          scenes: result.createdScenes,
        }),
      );
      setImportId(undefined);
      setPreview(undefined);
      void props.reload().then(() => {
        // The author may have opened another tool while the import ran;
        // only then is the suggested review left unopened.
        if (window.location.hash === `#/projects/${projectId}/tools/import`)
          props.navigate(`/projects/${projectId}/tools/review`);
      });
    } catch (cause) {
      setNotice(refusal(cause));
    } finally {
      setWorking(false);
    }
  };
  const chapter = preview?.chapters[selected];
  const canCommit = Boolean(
    importId &&
    preview &&
    total > 0 &&
    (frozen ? attempt : rightsConfirmed) &&
    !working,
  );
  const locked = frozen || working;
  return (
    <section className={css.panel}>
      <div className={css.head}>
        <div>
          <h2 className={css.heading}>{t("import.title")}</h2>
          <p className={css.muted}>{t("import.description")}</p>
        </div>
        <Button
          variant="outline"
          disabled={working}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {t(open ? "import.collapse" : "import.open")}
        </Button>
      </div>
      {open && (
        <div className={css.list}>
          {attempt && (
            <p
              role="status"
              data-source-import-id={attempt.importId}
              className={css.warning}
            >
              {t("import.frozen.identity", {
                importId: attempt.importId,
                projectId: attempt.input.projectId,
              })}
            </p>
          )}
          {!preview ? (
            <div className={css.empty}>
              <p className={css.name}>{t("import.pick.title")}</p>
              <p className={clsx(css.muted, css.small)}>
                {t("import.pick.boundary")}
              </p>
              <div>
                <Button
                  variant="primary"
                  disabled={working || frozen}
                  onClick={() => void choose()}
                >
                  {t(working ? "import.pick.working" : "import.pick")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={clsx(css.notice, css.row)}>
                <span className={css.name}>{preview.fileName}</span>
                <span className={css.badge}>
                  {t(`import.source.${preview.sourceType}`)}
                </span>
                <span className={clsx(css.muted, css.small)}>
                  {preview.contentKind === "script"
                    ? t("import.found.script", {
                        episodes: preview.episodes.length,
                        scenes: preview.episodes.reduce(
                          (count, episode) => count + episode.scenes.length,
                          0,
                        ),
                        chars: preview.charCount.toLocaleString("zh-CN"),
                      })
                    : t(
                        preview.contentKind === "novel"
                          ? "import.found.novel"
                          : "import.found.draft",
                        {
                          count: preview.chapters.length,
                          chars: preview.charCount.toLocaleString("zh-CN"),
                        },
                      )}
                </span>
                <span className={css.grow} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={working || frozen}
                  onClick={() => void choose()}
                >
                  {t("import.repick")}
                </Button>
              </div>
              {preview.warnings.map((warning) => (
                <p key={warning} className={clsx(css.notice, css.warning)}>
                  {/[A-Za-z]{3,}/.test(warning)
                    ? t("import.warning.format")
                    : warning}
                </p>
              ))}
              {(duplicates.chapters.length > 0 ||
                duplicates.episodes.length > 0) && (
                <p className={clsx(css.notice, css.warning)}>
                  {t("import.duplicates", {
                    list: [
                      duplicates.chapters.length
                        ? t("import.duplicates.chapters", {
                            count: duplicates.chapters.length,
                          })
                        : "",
                      duplicates.episodes.length
                        ? t("import.duplicates.episodes", {
                            count: duplicates.episodes.length,
                          })
                        : "",
                    ]
                      .filter(Boolean)
                      .join("；"),
                  })}
                </p>
              )}
              {preview.contentKind === "script" ? (
                <div className={clsx(css.box, css.scroll)}>
                  {preview.episodes.map((episode) => (
                    <article key={episode.key} className={css.item}>
                      <p className={css.name}>
                        {t("import.episode", {
                          number: episode.episodeNumber,
                          title: episode.title,
                        })}
                      </p>
                      <p className={clsx(css.muted, css.small)}>
                        {t("import.episode.size", {
                          scenes: episode.scenes.length,
                          chars: episode.content.length.toLocaleString("zh-CN"),
                        })}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={css.chapters}>
                  <div className={clsx(css.box, css.scroll)}>
                    {preview.chapters.map((item, index) => (
                      <button
                        key={item.key}
                        type="button"
                        className={clsx(
                          css.chapter,
                          index === selected && css.chapterActive,
                        )}
                        onClick={() => setSelected(index)}
                      >
                        <span className={css.truncate}>{item.title}</span>
                        <span className={css.small}>
                          {t("import.chapter.words", {
                            count: item.wordCount.toLocaleString("zh-CN"),
                          })}
                        </span>
                      </button>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={locked}
                      onClick={addChapter}
                    >
                      {t("import.chapter.add")}
                    </Button>
                  </div>
                  {chapter && (
                    <div className={css.box}>
                      <div className={css.row}>
                        <div className={css.grow}>
                          <Input
                            aria-label={t("import.chapter.title")}
                            disabled={locked}
                            value={chapter.title}
                            onChange={(event) =>
                              updateChapter({ title: event.target.value })
                            }
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className={css.danger}
                          disabled={preview.chapters.length <= 1 || locked}
                          onClick={removeChapter}
                        >
                          {t("import.chapter.remove")}
                        </Button>
                      </div>
                      <textarea
                        aria-label={t("import.chapter.content")}
                        className={clsx(css.select, css.editor)}
                        disabled={locked}
                        value={chapter.content}
                        onChange={(event) =>
                          updateChapter({ content: event.target.value })
                        }
                      />
                      <p className={clsx(css.muted, css.small)}>
                        {t("import.chapter.hint")}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className={css.box}>
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    disabled={locked}
                    onChange={(event) =>
                      setRightsConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    {t(frozen ? "import.rights.frozen" : "import.rights")}
                  </span>
                </label>
                <p>
                  {t("import.strategy")}
                  <span className={css.name}>
                    {t("import.strategy.append")}
                  </span>
                </p>
                <p className={clsx(css.muted, css.small)}>
                  {t("import.receipt")}
                </p>
              </div>
              <div className={clsx(css.row, css.end)}>
                <Button variant="ghost" onClick={close}>
                  {t("import.cancel")}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canCommit}
                  onClick={() => void commit()}
                >
                  {t(
                    working
                      ? "import.commit.working"
                      : frozen
                        ? "import.commit.resume"
                        : "import.commit",
                  )}
                </Button>
              </div>
            </>
          )}
          {notice && (
            <p role="status" className={css.notice}>
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
