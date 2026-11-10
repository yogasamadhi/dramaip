import { useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { clsx } from "clsx";
import css from "./Context.module.css";
import { messageOf, useOwnerRead, value } from "./read.ts";
import { StorySources } from "./StorySources.tsx";
import type {
  Chapter,
  ContextChapterSelection,
  KnowledgeRemote,
  NarrativeContextRequest,
} from "./types.ts";

type T = TranslateNS<"narrative">;
const tokens = (text: string) =>
  Math.ceil(new TextEncoder().encode(text).length / 4);

/** What a caller gives the narrative context picker. */
export type ContextPickerProps = {
  /** Offer the target chapter itself (a continuation), not only prior text. */
  includeTarget?: boolean | undefined;
  /** A production read keeps polling and trusts only a settled current read. */
  purpose?: "planning" | "production" | undefined;
  chapters: readonly Chapter[];
  request: NarrativeContextRequest;
  disabled: boolean;
  onChange(request: NarrativeContextRequest): void;
} & (
  | { target: Chapter; scope?: undefined }
  | { target?: undefined; scope: { projectId: string; title: string } }
);

/** The Remote namespace a picker reads, injected by its registration. */
export interface ContextPickerRemotes {
  knowledge: KnowledgeRemote;
}

/** Full props of a picker as its registration renders it. */
export type ContextPickerViewProps = ContextPickerProps &
  ContextPickerRemotes & { t: T };

/**
 * The prior text, higher summaries and narrative declarations a creation run
 * is explicitly given: nothing is included unless chosen, and a stale or
 * unverifiable choice is shown, never swapped for the nearest current one.
 */
export function ContextPicker(props: ContextPickerViewProps) {
  const { t, request } = props;
  const [open, setOpen] = useState(false);
  const [readHigher, setReadHigher] = useState(false);
  const projectId = props.scope?.projectId ?? props.target!.projectId;
  const quality = Boolean(props.scope);
  const currentOnly = props.purpose === "production";
  const scopesEnabled =
    open && (readHigher || Boolean(request.summaries?.length));
  const scopes = useOwnerRead(
    scopesEnabled ? `scopes:${projectId}` : undefined,
    async () => {
      const read = await value(
        props.knowledge.narrativeSummariesScopes(projectId),
      );
      if (currentOnly && read.projectId !== projectId)
        throw new Error(t("picker.higher.mismatch"));
      return read;
    },
    currentOnly ? 5000 : undefined,
  );
  const previous = props.chapters
    .filter((chapter) =>
      quality
        ? true
        : props.includeTarget
          ? chapter.orderIndex <= props.target!.orderIndex
          : chapter.orderIndex < props.target!.orderIndex,
    )
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const higher = new Map<string, { id: string; title: string }>();
  for (const scope of scopes.data?.scopes ?? [])
    if (scope.head)
      higher.set(scope.head.id, { id: scope.head.id, title: scope.title });
  for (const summary of request.summaries ?? [])
    if (!higher.has(summary.id))
      higher.set(summary.id, {
        id: summary.id,
        title: t("picker.higher.previous"),
      });
  const title =
    props.scope?.title ??
    (props.includeTarget ? t("picker.title.next") : t("picker.title.prior"));
  const unselected = previous.filter(
    (chapter) => !request.chapters.some((item) => item.id === chapter.id),
  ).length;
  return (
    <details
      className={css.picker}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={css.strongSummary}>
        {t("picker.summary", { title, count: request.chapters.length })}
        {request.summaries?.length
          ? t("picker.summary.summaries", { count: request.summaries.length })
          : ""}
        {request.story?.length
          ? t("picker.summary.story", { count: request.story.length })
          : ""}
      </summary>
      <p className={clsx(css.muted, css.gap)}>
        {quality
          ? t("picker.note.quality")
          : props.includeTarget
            ? t("picker.note.next")
            : t("picker.note.prior")}
        {t("picker.note")}
      </p>
      <p className={clsx(css.muted, css.gapTight)}>
        {t("picker.budget", {
          scope: quality ? t("picker.scope.quality") : t("picker.scope.prior"),
          total: previous.length,
          unselected,
        })}
      </p>
      {open &&
        previous.map((chapter) => (
          <ContextChapter
            key={chapter.id}
            t={t}
            knowledge={props.knowledge}
            chapter={chapter}
            selection={request.chapters.find((item) => item.id === chapter.id)}
            disabled={props.disabled}
            currentOnly={currentOnly}
            onChange={(selection) =>
              props.onChange({
                ...request,
                chapters: previous.flatMap((item) =>
                  item.id === chapter.id
                    ? selection
                      ? [selection]
                      : []
                    : request.chapters.filter((value) => value.id === item.id),
                ),
              })
            }
          />
        ))}
      {open && (
        <section
          aria-label={t("picker.higher.label")}
          className={clsx(css.stack, css.gapWide)}
        >
          <p className={css.muted}>
            {t("picker.higher.note")}
            {quality
              ? t("picker.higher.note.quality")
              : t("picker.higher.note.prior")}
            {t("picker.higher.note.inherit")}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={props.disabled}
            onClick={() => {
              setReadHigher(true);
              if (scopesEnabled) void scopes.refetch();
            }}
          >
            {t("picker.higher.read")}
          </Button>
          {scopes.error !== undefined && (
            <p role="alert">
              {t("picker.higher.failed", { message: messageOf(scopes.error) })}
            </p>
          )}
          {scopes.data?.unavailable.map((reason) => (
            <p role="alert" key={reason}>
              {reason}
            </p>
          ))}
          {(readHigher || Boolean(request.summaries?.length)) &&
            [...higher.values()].map((item) => (
              <HigherContextSource
                key={item.id}
                t={t}
                knowledge={props.knowledge}
                id={item.id}
                title={item.title}
                projectId={projectId}
                previous={previous}
                disabled={props.disabled}
                currentOnly={currentOnly}
                selected={request.summaries?.find(
                  (source) => source.id === item.id,
                )}
                onChange={(chosen) => {
                  const rest = (request.summaries ?? []).filter(
                    (source) => source.id !== item.id,
                  );
                  props.onChange({
                    ...request,
                    summaries: chosen ? [...rest, chosen] : rest,
                  });
                }}
              />
            ))}
          {readHigher && scopes.data && !higher.size && (
            <p className={css.muted}>{t("picker.higher.none")}</p>
          )}
        </section>
      )}
      {!previous.length && (
        <p className={clsx(css.muted, css.gap)}>
          {quality
            ? t(`picker.empty.${props.purpose ?? "quality"}`)
            : t("picker.empty.prior")}
        </p>
      )}
      {open && (
        <StorySources
          key={projectId}
          t={t}
          knowledge={props.knowledge}
          projectId={projectId}
          chapters={previous}
          selected={request.story ?? []}
          disabled={props.disabled}
          onChange={(story) => props.onChange({ ...request, story })}
        />
      )}
    </details>
  );
}

function HigherContextSource(props: {
  t: T;
  knowledge: KnowledgeRemote;
  id: string;
  title: string;
  projectId: string;
  previous: readonly Chapter[];
  disabled: boolean;
  currentOnly: boolean;
  selected: { id: string; version: number } | undefined;
  onChange(value: { id: string; version: number } | undefined): void;
}) {
  const { t } = props;
  const [read, setRead] = useState(false);
  const enabled = read || Boolean(props.selected);
  const source = useOwnerRead(
    enabled ? `summary:${props.projectId}:${props.id}` : undefined,
    async () => {
      const summary = await value(
        props.knowledge.narrativeSummariesGet(props.projectId, props.id),
      );
      if (
        props.currentOnly &&
        (summary.projectId !== props.projectId || summary.id !== props.id)
      )
        throw new Error(t("higher.mismatch"));
      return summary;
    },
    props.currentOnly ? 5000 : undefined,
  );
  const summary = source.data;
  const prior = summary?.content.coveredChapters.every((chapter) =>
    props.previous.some(
      (item) =>
        item.id === chapter.id &&
        item.version === chapter.version &&
        item.content.trim(),
    ),
  );
  const eligible =
    (!props.currentOnly || !source.fetching) &&
    summary?.contextEligibility.state === "eligible" &&
    prior &&
    (!props.selected || props.selected.version === summary.version);
  return (
    <fieldset
      aria-label={t("higher.label", { title: props.title })}
      className={css.box}
    >
      <legend>{t("higher.legend", { title: props.title })}</legend>
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => {
          setRead(true);
          if (enabled) void source.refetch();
        }}
      >
        {t("higher.read")}
      </Button>
      <label className={clsx(css.check, css.gap)}>
        <input
          type="checkbox"
          aria-label={t("higher.include.label", { id: props.id })}
          checked={Boolean(props.selected)}
          disabled={props.disabled || (!props.selected && !eligible)}
          onChange={(event) =>
            props.onChange(
              event.target.checked && summary
                ? { id: summary.id, version: summary.version }
                : undefined,
            )
          }
        />{" "}
        {t("higher.include")}
      </label>
      {source.error !== undefined && (
        <p role="alert">{messageOf(source.error)}</p>
      )}
      {summary && (
        <>
          <p className={clsx(css.pre, css.muted, css.gapTight)}>
            {summary.content.summary}
          </p>
          <p className={clsx(css.breakAll, css.muted, css.gapTight)}>
            {t("higher.meta", {
              count: summary.content.coveredChapters.length,
              version: summary.version,
              selected: props.selected
                ? t("higher.meta.selected", { version: props.selected.version })
                : "",
              tokens: tokens(summary.content.summary),
            })}
          </p>
          {summary.sourceState === "stale" && (
            <p className={css.muted}>{t("higher.stale")}</p>
          )}
          {!eligible && (
            <p role="alert">
              {!prior ? t("higher.notPrior") : t("higher.notEligible")}
            </p>
          )}
          {summary.contextEligibility.reasons.map((reason) => (
            <p role="alert" key={reason}>
              {reason}
            </p>
          ))}
          <details>
            <summary className={css.clickable}>{t("higher.chapters")}</summary>
            {summary.content.coveredChapters.map((chapter) => (
              <p key={chapter.id} className={css.breakAll}>
                {t("higher.chapter", {
                  id: chapter.id,
                  version: chapter.version,
                })}
              </p>
            ))}
          </details>
        </>
      )}
    </fieldset>
  );
}

function ContextChapter(props: {
  t: T;
  knowledge: KnowledgeRemote;
  chapter: Chapter;
  selection: ContextChapterSelection | undefined;
  disabled: boolean;
  currentOnly: boolean;
  onChange(value: ContextChapterSelection | undefined): void;
}) {
  const { t, chapter, selection } = props;
  const [load, setLoad] = useState(false);
  const enabled =
    load || Boolean(selection && selection.representation !== "original");
  const detail = useOwnerRead(
    enabled
      ? `detail:${chapter.projectId}:${chapter.id}:${chapter.version}`
      : undefined,
    async () => {
      const read = await value(
        props.knowledge.narrativeIndexChapter(chapter.projectId, chapter.id),
      );
      if (
        props.currentOnly &&
        (read.projectId !== chapter.projectId ||
          read.chapter.id !== chapter.id ||
          read.chapter.version !== chapter.version)
      )
        throw new Error(t("chapter.mismatch"));
      return read;
    },
    props.currentOnly ? 5000 : undefined,
  );
  const index =
    detail.data?.chapter.version === chapter.version &&
    (!props.currentOnly || !detail.fetching)
      ? detail.data
      : undefined;
  const choice = !selection
    ? "none"
    : selection.representation === "summary"
      ? `summary:${selection.record.id}`
      : selection.representation;
  const change = (next: string) => {
    const ref = { id: chapter.id, version: chapter.version };
    if (next === "none") props.onChange(undefined);
    else if (next === "original")
      props.onChange({ ...ref, representation: "original" });
    else if (next === "paragraphs")
      props.onChange({
        ...ref,
        representation: "paragraphs",
        paragraphIds: [],
      });
    else {
      const record = index?.summaries.find(
        (summary) => `summary:${summary.id}` === next,
      );
      if (record)
        props.onChange({
          ...ref,
          representation: "summary",
          record: { id: record.id, version: record.version },
        });
    }
  };
  const old =
    selection &&
    (selection.version !== chapter.version ||
      (selection.representation === "summary" &&
        index &&
        !index.summaries.some(
          (summary) =>
            summary.id === selection.record.id &&
            summary.version === selection.record.version,
        )));
  return (
    <fieldset
      className={clsx(css.box, css.gap)}
      disabled={props.disabled}
      aria-label={t("chapter.label", { title: chapter.title })}
    >
      <legend>
        {t("chapter.legend", {
          title: chapter.title,
          version: chapter.version,
        })}
      </legend>
      <select
        aria-label={t("chapter.select", { title: chapter.title })}
        value={choice}
        className={clsx(css.select, css.wide)}
        onChange={(event) => change(event.target.value)}
        disabled={!chapter.content.trim() || props.disabled}
      >
        <option value="none">{t("chapter.none")}</option>
        <option value="original">
          {t("chapter.original", { tokens: tokens(chapter.content) })}
        </option>
        <option value="paragraphs" disabled={!index}>
          {t("chapter.paragraphs")}
        </option>
        {index?.summaries.map((summary) => (
          <option key={summary.id} value={`summary:${summary.id}`}>
            {t("chapter.summary", { text: summary.text.slice(0, 40) })}
          </option>
        ))}
        {selection?.representation === "summary" &&
          !index?.summaries.some(
            (summary) => summary.id === selection.record.id,
          ) && <option value={choice}>{t("chapter.summary.previous")}</option>}
      </select>
      <Button
        size="sm"
        variant="outline"
        className={css.gapTight}
        onClick={() => {
          setLoad(true);
          if (enabled) void detail.refetch();
        }}
      >
        {t("chapter.read")}
      </Button>
      {selection && (
        <p className={clsx(css.muted, css.gapTight)}>
          {t("chapter.version", { version: selection.version })}
        </p>
      )}
      {old && (
        <p role="alert" className={clsx(css.danger, css.gapTight)}>
          {t("chapter.old")}
        </p>
      )}
      {detail.error !== undefined && (
        <p className={clsx(css.muted, css.gapTight)}>
          {t("chapter.failed", { message: messageOf(detail.error) })}
        </p>
      )}
      {selection?.representation === "summary" &&
        index?.summaries
          .filter((summary) => summary.id === selection.record.id)
          .map((summary) => (
            <p
              key={summary.id}
              className={clsx(css.pre, css.muted, css.gapTight)}
            >
              {t("chapter.summary.text", {
                text: summary.text,
                tokens: tokens(summary.text),
                id: summary.id,
              })}
            </p>
          ))}
      {selection?.representation === "paragraphs" && (
        <div className={clsx(css.scrollShort, css.stack, css.gap)}>
          <p className={css.muted}>{t("chapter.paragraphs.note")}</p>
          {index?.paragraphs.map((paragraph) => (
            <label
              key={paragraph.id}
              className={clsx(css.check, css.breakWords)}
            >
              <input
                type="checkbox"
                aria-label={t("chapter.paragraph.label", {
                  title: chapter.title,
                  start: paragraph.start,
                })}
                checked={selection.paragraphIds.includes(paragraph.id)}
                onChange={(event) => {
                  const ids = new Set(selection.paragraphIds);
                  if (event.target.checked) ids.add(paragraph.id);
                  else ids.delete(paragraph.id);
                  props.onChange({
                    ...selection,
                    paragraphIds: index.paragraphs
                      .filter((item) => ids.has(item.id))
                      .map((item) => item.id),
                  });
                }}
              />{" "}
              {t("chapter.paragraph", {
                start: paragraph.start,
                end: paragraph.end,
                text: chapter.content.slice(paragraph.start, paragraph.end),
              })}
            </label>
          ))}
          {!selection.paragraphIds.length && (
            <p role="alert" className={css.danger}>
              {t("chapter.paragraphs.required")}
            </p>
          )}
        </div>
      )}
      {selection && (
        <Button
          size="sm"
          variant="outline"
          className={css.gapTight}
          onClick={() => props.onChange(undefined)}
        >
          {t("chapter.clear")}
        </Button>
      )}
    </fieldset>
  );
}
