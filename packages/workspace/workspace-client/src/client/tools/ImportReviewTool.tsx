import clsx from "clsx";
import { useEffect, useState } from "react";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type { ImportExtractionsListResult } from "@dramaip/workspace-workspace/types";
import { useConfirm } from "./confirm.tsx";
import type { ToolProps } from "./PersonalTheaterTool.tsx";
import { messageOf, value } from "./remote.ts";
import css from "./Tools.module.css";

type ChangeSet = ImportExtractionsListResult[number];
type Candidate = ChangeSet["candidates"][number];

/** The draft candidates of every change set, all selected by default. */
const draftIds = (changeSets: ImportExtractionsListResult) =>
  changeSets.flatMap((set) =>
    set.candidates
      .filter((candidate) => candidate.status === "draft")
      .map((candidate) => candidate.id),
  );

/**
 * Review the AI drafts an import extracted: each candidate keeps its source
 * chapter, text range and confidence, and can be edited, rejected, reviewed
 * again or adopted with the others selected in one transaction, which can be
 * undone. With `extractionId` in the route's query only that change set is
 * shown, and no other stands in for it while it is missing.
 */
export function ImportReviewTool(props: ToolProps) {
  const { projectId, workspace, t } = props;
  const requested =
    new URLSearchParams(props.search).get("extractionId") ?? undefined;
  const confirm = useConfirm({
    title: t("review.confirm.title"),
    cancel: t("review.confirm.cancel"),
    close: t("review.confirm.close"),
    accept: t("review.confirm.accept"),
  });
  const [changeSets, setChangeSets] = useState<ImportExtractionsListResult>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({ title: "", summary: "" });
  const [notice, setNotice] = useState<string>();
  const [workingId, setWorkingId] = useState<string>();
  useEffect(() => {
    let live = true;
    void value(workspace.importExtractionsList(projectId)).then(
      (next) => {
        if (!live) return;
        setChangeSets(next);
        const drafts = draftIds(next);
        setSelected((current) =>
          drafts.some((id) => current.has(id)) ? current : new Set(drafts),
        );
      },
      (cause: unknown) => live && setNotice(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [workspace, projectId, revision]);
  const refresh = async () => {
    setRevision((current) => current + 1);
    await props.reload();
  };
  /** Run one write on a change set or candidate; its failure is the notice. */
  const write = async (id: string, run: () => Promise<string>) => {
    setWorkingId(id);
    try {
      setNotice(await run());
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorkingId(undefined);
      await refresh();
    }
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startEdit = (candidate: Candidate) => {
    setEditingId(candidate.id);
    setDraft({ title: candidate.title, summary: candidate.summary });
  };
  const saveEdit = (changeSetId: string, candidateId: string) =>
    write(candidateId, async () => {
      await value(
        workspace.importExtractionsUpdateCandidate(
          changeSetId,
          candidateId,
          draft,
          undefined,
          undefined,
        ),
      );
      setEditingId(undefined);
      return t("review.edited");
    });
  const setStatus = (
    changeSetId: string,
    candidateId: string,
    status: "draft" | "rejected",
  ) =>
    write(candidateId, async () => {
      await value(
        workspace.importExtractionsUpdateCandidate(
          changeSetId,
          candidateId,
          { status },
          undefined,
          undefined,
        ),
      );
      return t(status === "rejected" ? "review.rejected" : "review.restored");
    });
  const adopt = async (changeSet: ChangeSet) => {
    const ids = changeSet.candidates
      .filter(
        (candidate) =>
          candidate.status === "draft" && selected.has(candidate.id),
      )
      .map((candidate) => candidate.id);
    if (!ids.length) return setNotice(t("review.adopt.none"));
    if (!(await confirm.ask(t("review.adopt.confirm", { count: ids.length }))))
      return;
    await write(changeSet.id, async () => {
      await value(
        workspace.importExtractionsAdopt(
          changeSet.id,
          { candidateIds: ids },
          undefined,
          undefined,
        ),
      );
      return t("review.adopted");
    });
  };
  const undo = async (changeSet: ChangeSet) => {
    if (!(await confirm.ask(t("review.undo.confirm")))) return;
    await write(changeSet.id, async () => {
      const result = await value(
        workspace.importExtractionsUndo(changeSet.id, undefined, undefined),
      );
      return t(
        result.status === "stale" ? "review.undone.stale" : "review.undone",
      );
    });
  };
  const status = (key: ChangeSet["status"] | Candidate["status"]) =>
    t(`review.status.${key}`);
  if (!changeSets) return notice ? <p role="alert">{notice}</p> : null;
  if (!changeSets.length)
    return (
      <div className={css.empty}>
        <p className={css.name}>{t("review.empty.title")}</p>
        <p className={css.muted}>{t("review.empty.description")}</p>
        <div>
          <a className={css.link} href={`#/projects/${projectId}/tools/import`}>
            {t("review.empty.import")}
          </a>
        </div>
      </div>
    );
  return (
    <section className={css.panel}>
      <div className={css.head}>
        <div>
          <p className={css.muted}>{t("review.eyebrow")}</p>
          <h2 className={css.title}>{t("review.title")}</h2>
          <p className={css.muted}>{t("review.description")}</p>
        </div>
        <span className={css.badge}>{t("review.all")}</span>
      </div>
      {notice && <p className={css.notice}>{notice}</p>}
      {requested && !changeSets.some((item) => item.id === requested) && (
        <p role="status" className={css.muted}>
          {t("review.requested.missing")}
        </p>
      )}
      {changeSets
        .filter((item) => !requested || item.id === requested)
        .map((changeSet) => {
          const drafts = changeSet.candidates.filter(
            (candidate) => candidate.status === "draft",
          ).length;
          return (
            <article
              key={changeSet.id}
              data-extraction-id={changeSet.id}
              className={css.box}
            >
              <div className={css.head}>
                <div>
                  <p className={css.name}>{changeSet.sourceTitle}</p>
                  <p className={clsx(css.muted, css.small)}>
                    {changeSet.summary}
                  </p>
                  <p className={clsx(css.muted, css.small)}>
                    {t("review.set.state", {
                      status: status(changeSet.status),
                      count: drafts,
                    })}
                  </p>
                </div>
                <div className={css.row}>
                  {drafts > 0 &&
                    (changeSet.status === "draft" ||
                      changeSet.status === "applied") && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={workingId === changeSet.id}
                        onClick={() => void adopt(changeSet)}
                      >
                        {t("review.adopt")}
                      </Button>
                    )}
                  {(changeSet.status === "applied" ||
                    changeSet.status === "stale") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={workingId === changeSet.id}
                      onClick={() => void undo(changeSet)}
                    >
                      {t("review.undo")}
                    </Button>
                  )}
                </div>
              </div>
              {changeSet.errorMessage && (
                <p className={clsx(css.notice, css.warning)}>
                  {changeSet.errorMessage}
                </p>
              )}
              {changeSet.candidates.map((candidate) => {
                const editing = editingId === candidate.id;
                const busy = workingId === candidate.id;
                return (
                  <div key={candidate.id} className={css.candidate}>
                    {candidate.status === "draft" && (
                      <input
                        type="checkbox"
                        aria-label={t("review.choose", {
                          title: candidate.title,
                        })}
                        checked={selected.has(candidate.id)}
                        onChange={() => toggle(candidate.id)}
                      />
                    )}
                    <div className={css.grow}>
                      <div className={css.row}>
                        <span className={css.badge}>
                          {t(`review.type.${candidate.type}`)}
                        </span>
                        <span className={clsx(css.muted, css.small)}>
                          {t("review.candidate.state", {
                            status: status(candidate.status),
                            confidence: Math.round(candidate.confidence * 100),
                          })}
                        </span>
                      </div>
                      {editing ? (
                        <div className={css.list}>
                          <Input
                            aria-label={t("review.edit.title")}
                            value={draft.title}
                            onChange={(event) =>
                              setDraft({ ...draft, title: event.target.value })
                            }
                          />
                          <textarea
                            aria-label={t("review.edit.summary")}
                            className={css.select}
                            value={draft.summary}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                summary: event.target.value,
                              })
                            }
                          />
                        </div>
                      ) : (
                        <>
                          <p className={css.name}>{candidate.title}</p>
                          <p className={css.muted}>{candidate.summary}</p>
                        </>
                      )}
                      {candidate.sourceRefs.map((ref) => (
                        <blockquote
                          key={`${ref.sourceKey}-${ref.start}`}
                          className={clsx(css.quote, css.small)}
                        >
                          {t("review.source", {
                            chapter: ref.chapterTitle,
                            start: ref.start,
                            end: ref.end,
                            excerpt: ref.excerpt || t("review.source.empty"),
                          })}
                        </blockquote>
                      ))}
                      {candidate.conflictNote && (
                        <p className={clsx(css.warning, css.small)}>
                          {candidate.conflictNote}
                        </p>
                      )}
                    </div>
                    {candidate.status !== "adopted" && (
                      <div className={css.row}>
                        {editing ? (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void saveEdit(changeSet.id, candidate.id)
                              }
                            >
                              {t("review.edit.save")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(undefined)}
                            >
                              {t("review.edit.cancel")}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(candidate)}
                          >
                            {t("review.edit")}
                          </Button>
                        )}
                        {candidate.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void setStatus(
                                changeSet.id,
                                candidate.id,
                                "rejected",
                              )
                            }
                          >
                            {t("review.reject")}
                          </Button>
                        )}
                        {(candidate.status === "rejected" ||
                          candidate.status === "conflict") && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void setStatus(
                                changeSet.id,
                                candidate.id,
                                "draft",
                              )
                            }
                          >
                            {t("review.restore")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </article>
          );
        })}
      {confirm.dialog}
    </section>
  );
}
