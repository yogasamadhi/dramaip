import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { clsx } from "clsx";
import css from "./Context.module.css";
import {
  narrativeStoryConnection,
  narrativeStoryOrigins,
  storyGroupKey,
  storyGroupLabel,
  type StoryDirectory,
} from "./story.ts";
import type { NarrativeStoryIndexEntry } from "./types.ts";

type T = TranslateNS<"narrative">;
interface EntriesProps {
  t: T;
  entries: readonly NarrativeStoryIndexEntry[];
  directory: StoryDirectory;
}

const eligibility = (t: T, entry: NarrativeStoryIndexEntry) =>
  entry.eligibility.state === "eligible"
    ? t("story.eligible")
    : t("story.ineligible");

/** The event declarations in their author-annotated story time order. */
export function EventTimelineView({ t, entries, directory }: EntriesProps) {
  const events = entries.filter(
    (entry) =>
      entry.selection.kind === "declaration" &&
      entry.classification === "event",
  );
  if (!events.length) return null;
  // Sorting is presentation only. Ties are retained, never interpreted as simultaneity.
  const ordered = [...events].sort((a, b) => {
    if (!a.eventTimeline)
      return b.eventTimeline ? 1 : a.selection.id.localeCompare(b.selection.id);
    if (!b.eventTimeline) return -1;
    return (
      a.eventTimeline.storyOrder - b.eventTimeline.storyOrder ||
      a.selection.id.localeCompare(b.selection.id)
    );
  });
  return (
    <section
      role="table"
      aria-label={t("timeline.label")}
      className={css.table}
    >
      <p className={clsx(css.muted, css.pad)}>{t("timeline.note")}</p>
      <div role="row" className={css.srOnly}>
        <span role="columnheader">{t("timeline.column.event")}</span>
        <span role="columnheader">{t("timeline.column.time")}</span>
        <span role="columnheader">{t("timeline.column.origin")}</span>
      </div>
      <div role="rowgroup" className={css.scrollTall}>
        {ordered.map((entry) => (
          <article
            role="row"
            key={entry.selection.id}
            data-story-timeline-id={entry.selection.id}
            className={css.row}
          >
            <div role="cell" className={css.breakAll}>
              {t("timeline.entry", {
                title: entry.title,
                id: entry.selection.id,
                version: entry.selection.version,
                state: eligibility(t, entry),
              })}
            </div>
            <div role="cell">
              <p className={css.pre}>
                {entry.eventTimeline
                  ? t("timeline.text", {
                      order: entry.eventTimeline.storyOrder,
                      label: entry.eventTimeline.timeLabel,
                      interpretation: t(
                        `timeline.interpretation.${entry.eventTimeline.interpretation}`,
                      ),
                    })
                  : t("timeline.none")}
              </p>
            </div>
            <div role="cell">
              <StoryOriginView t={t} entry={entry} directory={directory} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** The current book, volume and story arc directory. */
export function StoryHierarchyView({
  t,
  directory,
}: {
  t: T;
  directory: StoryDirectory;
}) {
  if (!directory.available)
    return <p role="alert">{t("hierarchy.unavailable")}</p>;
  return (
    <details className={css.box} open>
      <summary className={css.strongSummary}>{t("hierarchy.title")}</summary>
      <p className={css.muted}>{t("hierarchy.note")}</p>
      <div className={clsx(css.scrollShort, css.stackTight)}>
        {directory.available.groups.map((group) => (
          <details
            key={storyGroupKey(group)}
            data-story-group={storyGroupKey(group)}
          >
            <summary className={clsx(css.clickable, css.breakWords)}>
              {t("hierarchy.group", {
                label: storyGroupLabel(t, group),
                state: t(`hierarchy.state.${group.state}`),
                count: group.chapterIds.length,
              })}
            </summary>
            {group.reasons.map((reason) => (
              <p role="alert" key={reason}>
                {reason}
              </p>
            ))}
            <ul className={css.list}>
              {group.chapterIds.map((id) => {
                const chapter = directory.chapters.get(id);
                const text = chapter
                  ? t("hierarchy.chapter", {
                      title: chapter.title,
                      version: chapter.version,
                      id,
                    })
                  : t("hierarchy.chapter.missing", { id });
                return (
                  <li key={id} className={css.breakAll}>
                    {group.state !== "current"
                      ? t("hierarchy.chapter.oldArc", { chapter: text })
                      : text}
                  </li>
                );
              })}
            </ul>
            {!group.chapterIds.length && (
              <p className={css.muted}>{t("hierarchy.empty")}</p>
            )}
          </details>
        ))}
      </div>
    </details>
  );
}

/** Every original source of one declaration and its current directory links. */
export function StoryOriginView({
  t,
  entry,
  directory,
}: {
  t: T;
  entry: NarrativeStoryIndexEntry;
  directory: StoryDirectory;
}) {
  return (
    <div className={css.stackTight}>
      {narrativeStoryOrigins(entry, directory).map(
        ({ source, chapter, state, groups }) => (
          <p key={source.id} className={css.breakAll}>
            {t("origin.chapter", {
              title: chapter?.title ?? source.id,
              version: source.version,
              id: source.id,
              state:
                state === "current"
                  ? t("origin.current", {
                      groups:
                        groups
                          .map((group) => storyGroupLabel(t, group))
                          .join(t("story.separator")) || t("origin.ungrouped"),
                    })
                  : state === "stale"
                    ? t("origin.stale", { version: chapter!.version })
                    : t(`origin.${state}`),
            })}
          </p>
        ),
      )}
      {entry.sourceScripts.map((source) => (
        <p key={source.id} className={css.breakAll}>
          {t("origin.script", { id: source.id, version: source.version })}
        </p>
      ))}
      {!entry.sourceChapters.length && !entry.sourceScripts.length && (
        <p>{t("origin.none")}</p>
      )}
    </div>
  );
}

/** The relationship and cognition assertions with their directions. */
export function StoryStructureView({ t, entries, directory }: EntriesProps) {
  const structured = entries.filter(
    (entry) =>
      entry.selection.kind === "assertion" &&
      (entry.classification === "relationship" ||
        entry.classification === "cognition"),
  );
  if (!structured.length) return null;
  return (
    <section
      role="table"
      aria-label={t("structure.label")}
      className={css.table}
    >
      <p className={clsx(css.muted, css.pad)}>{t("structure.note")}</p>
      <div role="row" className={css.srOnly}>
        <span role="columnheader">{t("structure.column.entry")}</span>
        <span role="columnheader">{t("structure.column.connection")}</span>
        <span role="columnheader">{t("structure.column.origin")}</span>
      </div>
      <div role="rowgroup" className={css.scrollTall}>
        {structured.map((entry) => (
          <article
            role="row"
            key={`${entry.selection.kind}:${entry.selection.id}`}
            data-story-structure-id={entry.selection.id}
            className={css.row}
          >
            <div role="cell" className={css.breakAll}>
              <p className={css.strong}>{t("structure.column.entry")}</p>
              <p>
                {t("structure.entry", {
                  title: entry.title,
                  version: entry.selection.version,
                })}
              </p>
              <p>{entry.selection.id}</p>
              <p>{eligibility(t, entry)}</p>
            </div>
            <div
              role="cell"
              data-story-structured-connection
              className={css.breakAll}
            >
              <p className={css.strong}>{t("structure.column.connection")}</p>
              {narrativeStoryConnection(t, entry)}
            </div>
            <div role="cell" data-story-structured-origins className={css.cell}>
              <p className={css.strong}>{t("structure.column.origin")}</p>
              <StoryOriginView t={t} entry={entry} directory={directory} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
