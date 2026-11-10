import { useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { clsx } from "clsx";
import css from "./Context.module.css";
import { messageOf, useOwnerRead, value } from "./read.ts";
import {
  narrativeStoryDirectory,
  narrativeStoryScopeReasons,
  narrativeStoryVisibleEntries,
  sameNarrativeStorySelection,
  storyGroupKey,
  storyGroupLabel,
  type StoryIndexView,
} from "./story.ts";
import {
  EventTimelineView,
  StoryHierarchyView,
  StoryOriginView,
  StoryStructureView,
} from "./StoryHierarchy.tsx";
import type {
  Chapter,
  KnowledgeRemote,
  NarrativeStoryIndexEntry,
  NarrativeStorySelection,
} from "./types.ts";

type T = TranslateNS<"narrative">;
const VIEWS: StoryIndexView[] = ["all", "nodes", "relationship", "cognition"];
const sameIdentity = (
  left: NarrativeStorySelection,
  right: NarrativeStorySelection,
) => left.kind === right.kind && left.id === right.id;

export type StorySourcesProps = {
  t: T;
  knowledge: KnowledgeRemote;
  projectId: string;
  chapterId?: string | undefined;
} & (
  | {
      chapters: readonly Chapter[];
      selected: readonly NarrativeStorySelection[];
      disabled: boolean;
      onChange(value: NarrativeStorySelection[]): void;
    }
  | { chapters?: never; selected?: never; disabled?: never; onChange?: never }
);

/**
 * The source-anchored narrative index of a project: its directory, timeline
 * and structure views and, when `onChange` is given, the declarations a run
 * is explicitly given. A catalog whose project or identities do not check
 * out is not shown.
 */
export function StorySources(props: StorySourcesProps) {
  const { t } = props;
  const [read, setRead] = useState(false);
  const [filter, setFilter] = useState({
    projectId: props.projectId,
    groupKey: "",
    view: "all" as StoryIndexView,
  });
  const polling = read || Boolean(props.selected?.length);
  const query = useOwnerRead(
    polling ? `story:${props.projectId}` : undefined,
    async () => {
      const index = await value(
        props.knowledge.narrativeStoryIndexCatalog(props.projectId),
      );
      if (
        index.projectId !== props.projectId ||
        index.entries.some((entry) => entry.projectId !== props.projectId) ||
        new Set(
          index.entries.map(
            (entry) => `${entry.selection.kind}:${entry.selection.id}`,
          ),
        ).size !== index.entries.length
      )
        throw new Error(t("sources.mismatch"));
      return index;
    },
    5000,
  );
  const directory = narrativeStoryDirectory(query.data?.hierarchy);
  const current =
    filter.projectId === props.projectId
      ? filter
      : {
          projectId: props.projectId,
          groupKey: "",
          view: "all" as StoryIndexView,
        };
  const entries = narrativeStoryVisibleEntries(
    query.data?.entries ?? [],
    directory,
    { ...current, chapterId: props.chapterId },
  );
  const listed = (selection: NarrativeStorySelection) =>
    query.data?.entries.some((entry) =>
      sameIdentity(entry.selection, selection),
    );
  const hidden =
    props.selected?.filter(
      (selection) =>
        listed(selection) &&
        !entries.some((entry) => sameIdentity(entry.selection, selection)),
    ) ?? [];
  return (
    <section aria-label={t("sources.label")} className={css.sources}>
      <h4 className={css.strong}>{t("sources.title")}</h4>
      <p className={css.muted}>{t("sources.note")}</p>
      {props.onChange && (
        <p className={css.muted}>{t("sources.note.select")}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => {
          setRead(true);
          if (polling) void query.refetch();
        }}
      >
        {t("sources.read")}
      </Button>
      {query.error !== undefined && (
        <p role="alert">
          {t("sources.failed", { message: messageOf(query.error) })}
        </p>
      )}
      {polling && !query.data && query.error === undefined && (
        <p className={css.muted}>{t("sources.loading")}</p>
      )}
      {query.data && (
        <>
          <StoryHierarchyView t={t} directory={directory} />
          <div className={css.filters}>
            <label>
              {t("sources.filter")}{" "}
              <select
                aria-label={t("sources.filter.label")}
                className={css.select}
                value={current.groupKey}
                onChange={(event) =>
                  setFilter({ ...current, groupKey: event.target.value })
                }
              >
                <option value="">{t("sources.filter.all")}</option>
                {directory.available?.groups.map((group) => (
                  <option
                    key={storyGroupKey(group)}
                    value={storyGroupKey(group)}
                    disabled={group.state !== "current"}
                  >
                    {group.state !== "current"
                      ? t("sources.filter.unverified", {
                          label: storyGroupLabel(t, group),
                        })
                      : storyGroupLabel(t, group)}
                  </option>
                ))}
                {current.groupKey &&
                  !directory.groups.has(current.groupKey) && (
                    <option value={current.groupKey}>
                      {t("sources.filter.lost")}
                    </option>
                  )}
              </select>
            </label>
            <label>
              {t("sources.view")}{" "}
              <select
                aria-label={t("sources.view.label")}
                className={css.select}
                value={current.view}
                onChange={(event) =>
                  setFilter({
                    ...current,
                    view: event.target.value as StoryIndexView,
                  })
                }
              >
                {VIEWS.map((view) => (
                  <option key={view} value={view}>
                    {t(`sources.view.${view}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={css.muted}>{t("sources.filter.note")}</p>
          {current.groupKey &&
            directory.groups.get(current.groupKey)?.state !== "current" && (
              <p role="alert">{t("sources.filter.stale")}</p>
            )}
          {hidden.length > 0 && (
            <p role="alert">{t("sources.hidden", { count: hidden.length })}</p>
          )}
          <p className={clsx(css.muted, css.breakAll)}>
            {t("sources.fingerprint", {
              fingerprint: query.data.fingerprint,
              count: entries.length,
            })}
          </p>
          <EventTimelineView t={t} entries={entries} directory={directory} />
          <StoryStructureView t={t} entries={entries} directory={directory} />
          <div className={clsx(css.scrollTall, css.stack)}>
            {entries.map((entry) => (
              <StoryEntry
                key={`${entry.selection.kind}:${entry.selection.id}`}
                {...props}
                entry={entry}
                directory={directory}
                fetching={query.fetching}
              />
            ))}
          </div>
          {!entries.length && <p className={css.muted}>{t("sources.empty")}</p>}
        </>
      )}
      {props.selected
        ?.filter((selection) => !listed(selection))
        .map((selection) => (
          <div key={`${selection.kind}:${selection.id}`} className={css.box}>
            <p role="alert" className={css.breakAll}>
              {t("sources.missing", {
                kind: selection.kind,
                id: selection.id,
                version: selection.version,
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() =>
                props.onChange?.(
                  (props.selected ?? []).filter(
                    (item) => !sameNarrativeStorySelection(item, selection),
                  ),
                )
              }
            >
              {t("sources.remove")}
            </Button>
          </div>
        ))}
    </section>
  );
}

function StoryEntry(
  props: StorySourcesProps & {
    entry: NarrativeStoryIndexEntry;
    directory: ReturnType<typeof narrativeStoryDirectory>;
    fetching: boolean;
  },
) {
  const { t, entry } = props;
  const selection = props.selected?.find((item) =>
    sameIdentity(item, entry.selection),
  );
  const reasons = props.chapters
    ? narrativeStoryScopeReasons(t, entry, props.projectId, props.chapters)
    : entry.eligibility.reasons;
  const old =
    selection && !sameNarrativeStorySelection(selection, entry.selection);
  const retirement =
    entry.retirement === "withdrawn" || entry.retirement === "replaced"
      ? t(`sources.retirement.${entry.retirement}`)
      : entry.eligibility.state === "eligible"
        ? t("sources.retirement.eligible")
        : t("sources.retirement.ineligible");
  return (
    <article data-story-index-id={entry.selection.id} className={css.box}>
      <p className={css.strong}>
        {t("sources.entry", {
          title: entry.title,
          classification: entry.classification,
          version: entry.selection.version,
        })}
      </p>
      <p className={css.muted}>
        {t("sources.entry.state", {
          status: t(`sources.status.${entry.status}`),
          source: t(`sources.source.${entry.sourceState}`),
          retirement,
        })}
      </p>
      <p className={css.pre}>{entry.statement}</p>
      {entry.endpoints.length > 0 && (
        <p className={clsx(css.muted, css.breakWords)}>
          {t("sources.endpoints", {
            list: entry.endpoints
              .map((node) =>
                t("story.endpoint", {
                  title: node.title,
                  version: node.version,
                  id: node.id,
                }),
              )
              .join(t("story.separator")),
          })}
        </p>
      )}
      {entry.storyOrder !== undefined && (
        <p className={css.muted}>
          {t("sources.order", {
            order: entry.storyOrder,
            state: entry.knowledgeState
              ? t(`story.knowledge.${entry.knowledgeState}`)
              : t("story.knowledge.missing"),
          })}
        </p>
      )}
      <p className={css.muted}>
        {t("sources.counts", {
          interpretation: t(`sources.interpretation.${entry.interpretation}`),
          chapters: entry.sourceChapters.length,
          scripts: entry.sourceScripts.length,
        })}
      </p>
      <StoryOriginView t={t} entry={entry} directory={props.directory} />
      <details>
        <summary className={css.clickable}>{t("sources.exact")}</summary>
        <p className={css.breakAll}>
          {t("sources.exact.selection", {
            id: entry.selection.id,
            version: entry.selection.version,
            fingerprint: entry.sourceFingerprint,
          })}
        </p>
        {entry.record && (
          <p className={css.breakAll}>
            {t("sources.exact.record", {
              kind: entry.record.kind,
              id: entry.record.id,
              version: entry.record.version,
            })}
          </p>
        )}
        {entry.sourceChapters.map((ref) => (
          <p key={ref.id} className={css.breakAll}>
            {t("sources.exact.chapter", { id: ref.id, version: ref.version })}
          </p>
        ))}
        {entry.sourceScripts.map((ref) => (
          <p key={ref.id} className={css.breakAll}>
            {t("sources.exact.script", { id: ref.id, version: ref.version })}
          </p>
        ))}
      </details>
      {props.onChange && (
        <label className={css.check}>
          <input
            type="checkbox"
            aria-label={t("sources.include.label", { id: entry.selection.id })}
            checked={Boolean(selection)}
            disabled={
              props.disabled ||
              (!selection &&
                (props.fetching ||
                  reasons.length > 0 ||
                  (props.selected?.length ?? 0) >= 200))
            }
            onChange={(event) =>
              props.onChange?.(
                event.target.checked
                  ? [...(props.selected ?? []), entry.selection]
                  : (props.selected ?? []).filter(
                      (item) => !sameIdentity(item, entry.selection),
                    ),
              )
            }
          />{" "}
          {t("sources.include")}
        </label>
      )}
      {old && (
        <p role="alert">
          {t("sources.old", {
            old: selection.version,
            current: entry.selection.version,
          })}
        </p>
      )}
      {reasons.map((reason) => (
        <p key={reason} role="alert" className={css.muted}>
          {reason}
        </p>
      ))}
    </article>
  );
}
