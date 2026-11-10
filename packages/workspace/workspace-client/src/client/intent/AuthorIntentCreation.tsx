import { useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/writing-writing-client/client/contract";
import { clsx } from "clsx";
import type { ToolProps } from "../tools/PersonalTheaterTool.tsx";
import { useOwnerRead, type OwnerRead } from "../tools/owner-read.ts";
import { messageOf, value } from "../tools/remote.ts";
import css from "./Intent.module.css";
import {
  ambiguousNavigation,
  confirmAuthorIntentCreationRequest,
  sameAuthorIntentCreationSource,
  type AuthorIntentCreationRequest,
  type NarrativeContextRequest,
} from "./request.ts";
import type { AuthorIntentsSourcesResult } from "@dramaip/workspace-workspace/types";

const EMPTY_CONTEXT: NarrativeContextRequest = {
  format: "narrative-context-v1",
  chapters: [],
};

/** The reads the AI proposal shares with the rest of the tool. */
export interface CreationReads {
  catalog: OwnerRead<AuthorIntentsSourcesResult>;
}

/** The catalog of sources an AI author intent run may be given. */
export function useIntentSources(props: ToolProps) {
  return useOwnerRead(`sources:${props.projectId}`, () =>
    value(props.workspace.authorIntentsSources(props.projectId)),
  );
}

/**
 * Propose an author intent with AI: the author explicitly chooses the
 * chapters or scripts it reads (or none, for the project brief alone) and,
 * optionally, the exact expressions of those chapters; the run freezes that
 * request, and its draft is compared and adopted in the tool's version list.
 * A restored run always shows its own frozen request.
 */
export function AuthorIntentCreation(props: ToolProps & CreationReads) {
  const { t, projectId, catalog } = props;
  const params = new URLSearchParams(props.search);
  const navigationError = ambiguousNavigation(params, [
    "intentWorkflowId",
    "intentId",
  ]);
  const workflowId = params.get("intentWorkflowId") ?? undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [expressions, setExpressions] = useState<NarrativeContextRequest>();
  const [confirmed, setConfirmed] = useState<AuthorIntentCreationRequest>();
  const [notice, setNotice] = useState<string>();
  const recovered = useOwnerRead(
    workflowId && !navigationError ? `workflow:${workflowId}` : undefined,
    () => value(props.automation.creationGet(workflowId!)),
    1500,
  );
  const original =
    !navigationError &&
    recovered.data &&
    recovered.data.id === workflowId &&
    recovered.data.input.projectId === projectId &&
    recovered.data.input.operation === "author-intent" &&
    recovered.data.input.authorIntentRequest
      ? recovered.data
      : undefined;
  // An exact restored workflow always displays its own frozen request, never
  // the selection left in this component by another run on the same project.
  const request = navigationError
    ? undefined
    : workflowId
      ? original?.input.authorIntentRequest
      : confirmed;
  const path = (search: URLSearchParams) =>
    `/projects/${projectId}/tools/author-intent?${search}`;
  const openWorkflow = (id: string) => {
    const search = new URLSearchParams(props.search);
    search.set("intentWorkflowId", id);
    props.navigate(path(search));
  };
  const available = catalog.data;
  const allowedChapters =
    available?.items
      .filter(
        (item) =>
          item.source.kind === "chapter" && selected.includes(item.source.id),
      )
      .map((item) => item.source) ?? [];
  const directory = useOwnerRead(
    expressions && available?.chapterAvailable && allowedChapters.length
      ? `directory:${JSON.stringify(allowedChapters)}`
      : undefined,
    async () => {
      const rows = await value(props.writing.chaptersList(projectId));
      if (
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => row.projectId !== projectId)
      )
        throw new Error(t("intent.ai.directory.owner"));
      const chosen = rows.filter((row) =>
        allowedChapters.some((source) => source.id === row.id),
      );
      if (
        chosen.length !== allowedChapters.length ||
        allowedChapters.some(
          (source) =>
            !chosen.some(
              (row) => row.id === source.id && row.version === source.version,
            ),
        )
      )
        throw new Error(t("intent.ai.directory.version"));
      return chosen.sort(
        (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
      );
    },
  );
  const mixedReady =
    !expressions ||
    Boolean(
      allowedChapters.length &&
      directory.data &&
      directory.error === undefined &&
      (expressions.chapters.length || expressions.summaries?.length),
    );
  const stale =
    request &&
    original?.stage !== "applied" &&
    original?.stage !== "discarded" &&
    available &&
    (request.projectVersion !== available.projectVersion ||
      request.baseAdoptedId !== available.baseAdoptedId ||
      request.sources.some(
        (source) =>
          !available.items.some((item) =>
            sameAuthorIntentCreationSource(item.source, source),
          ),
      ));
  const confirm = () => {
    const result = confirmAuthorIntentCreationRequest(
      catalog.data!,
      selected,
      expressions,
    );
    if ("error" in result) {
      setNotice(t(`intent.ai.error.${result.error}`));
      return;
    }
    setConfirmed(result.request);
    const search = new URLSearchParams(props.search);
    search.delete("intentWorkflowId");
    props.navigate(path(search));
    setNotice(t("intent.ai.confirmed"));
  };
  return (
    <section aria-label={t("intent.ai.label")} className={css.card}>
      <h3 className={css.heading}>{t("intent.ai.title")}</h3>
      <p className={css.muted}>{t("intent.ai.description")}</p>
      {catalog.loading && <p role="status">{t("intent.ai.loading")}</p>}
      {navigationError && <p role="alert">{t("intent.navigation")}</p>}
      {catalog.error !== undefined && (
        <p role="alert">
          {t("intent.ai.failed", { message: messageOf(catalog.error) })}
        </p>
      )}
      {workflowId && !original && !navigationError && (
        <p role={recovered.loading ? "status" : "alert"}>
          {recovered.loading
            ? t("intent.ai.workflow.loading")
            : t("intent.ai.workflow.missing")}
        </p>
      )}
      {available && (
        <>
          <p className={clsx(css.muted, css.small)}>
            {t("intent.ai.project", {
              version: available.projectVersion,
              base: available.baseAdoptedId
                ? t("intent.ai.base")
                : t("intent.ai.base.none"),
            })}
          </p>
          {!available.chapterAvailable && (
            <p className={clsx(css.muted, css.small)}>
              {t("intent.ai.chapters.off")}
            </p>
          )}
          {!available.scriptAvailable && (
            <p className={clsx(css.muted, css.small)}>
              {t("intent.ai.scripts.off")}
            </p>
          )}
          <div className={css.sources} aria-label={t("intent.ai.sources")}>
            {available.items.map(({ source, title }) => (
              <label key={source.id} className={css.option}>
                <input
                  type="checkbox"
                  aria-label={t("intent.ai.source.label", { title })}
                  checked={selected.includes(source.id)}
                  onChange={(event) => {
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, source.id]
                        : old.filter((id) => id !== source.id),
                    );
                    setConfirmed(undefined);
                    setExpressions((old) => (old ? EMPTY_CONTEXT : undefined));
                  }}
                />
                <span>
                  {source.kind === "chapter"
                    ? t("intent.ai.source.chapter", {
                        title,
                        version: source.version,
                      })
                    : t("intent.ai.source.script", {
                        title,
                        version: source.version,
                        document:
                          source.documentVersion === null
                            ? t("intent.ai.source.document.none")
                            : t("intent.ai.source.document", {
                                version: source.documentVersion,
                              }),
                      })}
                </span>
              </label>
            ))}
          </div>
          <section
            aria-label={t("intent.ai.expressions")}
            className={css.expressions}
          >
            <label className={css.option}>
              <input
                type="checkbox"
                aria-label={t("intent.ai.expressions.toggle")}
                checked={Boolean(expressions)}
                disabled={
                  !available.chapterAvailable || catalog.error !== undefined
                }
                onChange={(event) => {
                  setExpressions(
                    event.target.checked ? EMPTY_CONTEXT : undefined,
                  );
                  setConfirmed(undefined);
                }}
              />
              {t("intent.ai.expressions.text")}
            </label>
            <p className={css.muted}>{t("intent.ai.expressions.note")}</p>
            {expressions && !allowedChapters.length && (
              <p role="status">{t("intent.ai.expressions.scope")}</p>
            )}
            {expressions && directory.loading && (
              <p role="status">{t("intent.ai.expressions.loading")}</p>
            )}
            {expressions && directory.error !== undefined && (
              <p role="alert">
                {t("intent.ai.expressions.failed", {
                  message: messageOf(directory.error),
                })}
              </p>
            )}
            {expressions &&
              directory.data &&
              props.renderFactorySlot("writing.context-picker", {
                scope: {
                  projectId,
                  title: t("intent.ai.expressions.title"),
                },
                purpose: "production",
                chapters: directory.data,
                request: expressions,
                disabled: directory.error !== undefined,
                onChange: (next) => {
                  setExpressions(next);
                  setConfirmed(undefined);
                },
              })}
          </section>
          <div className={css.actions}>
            <Button
              variant="outline"
              disabled={
                catalog.error !== undefined ||
                Boolean(workflowId && !original) ||
                !mixedReady
              }
              onClick={confirm}
            >
              {t("intent.ai.confirm")}
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await catalog.refetch();
                setNotice(t("intent.ai.reread.notice"));
              }}
            >
              {t("intent.ai.reread")}
            </Button>
          </div>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {request && (
        <p className={clsx(css.muted, css.small)}>
          {t("intent.ai.frozen", {
            version: request.projectVersion,
            scope: request.context
              ? t("intent.ai.frozen.context")
              : t("intent.ai.frozen.complete"),
            count: request.sources.length,
            base: request.baseAdoptedId
              ? t("intent.ai.frozen.base")
              : t("intent.ai.frozen.base.none"),
          })}
        </p>
      )}
      {stale && <p role="alert">{t("intent.ai.stale")}</p>}
      {request &&
        (!workflowId || original) &&
        props.renderFactorySlot("automation.creation-workbench", {
          projectId,
          operation: "author-intent",
          workflowId,
          authorIntentRequest: request,
          externalReview: true,
          onStarted: (workflow) => openWorkflow(workflow.id),
          defaultInstruction: t("intent.ai.instruction"),
          renderCandidate: (workflow) => (
            <div className={css.stack}>
              <p>{t("intent.ai.candidate.note")}</p>
              {workflow.authorIntentId ? (
                <a
                  className={css.link}
                  href={`#${path(
                    new URLSearchParams({
                      intentId: workflow.authorIntentId,
                      intentWorkflowId: workflow.id,
                    }),
                  )}`}
                >
                  {t("intent.ai.candidate.open")}
                </a>
              ) : (
                <p role="alert">{t("intent.ai.candidate.missing")}</p>
              )}
            </div>
          ),
        })}
    </section>
  );
}
