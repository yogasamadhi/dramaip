import type { NarrativeStoryIndexEntry } from "@dramaip/contracts/knowledge";
import {
  narrativeStoryConnection,
  narrativeStoryOrigins,
  storyGroupKey,
  storyGroupLabel,
  type StoryDirectory,
} from "../../narrative-story-hierarchy";
import { StoryEventTimelineText } from "./StoryEventTimeline";
import styles from "./NarrativeStoryHierarchy.module.css";
import { copyText } from "../../copy";

export function NarrativeEventTimelineView({
  entries,
  directory,
}: {
  entries: readonly NarrativeStoryIndexEntry[];
  directory: StoryDirectory;
}) {
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
      aria-label={copyText("app/features/creative/NarrativeStoryHierarchy.1")}
      className={styles.c1}
    >
      <p className={styles.c2}>
        {copyText("app/features/creative/NarrativeStoryHierarchy.2")}
      </p>
      <div role="row" className={styles.c3}>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.3")}
        </span>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.4")}
        </span>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.5")}
        </span>
      </div>
      <div role="rowgroup" className={styles.c4}>
        {ordered.map((entry) => (
          <article
            role="row"
            key={entry.selection.id}
            data-story-timeline-id={entry.selection.id}
            className={styles.c5}
          >
            <div role="cell" className={styles.c6}>
              {entry.title}
              {copyText("app/features/creative/NarrativeStoryHierarchy.6")}
              {entry.selection.id}
              {copyText("app/features/creative/NarrativeStoryHierarchy.7")}
              {entry.selection.version} ·{" "}
              {entry.eligibility.state === "eligible"
                ? "当前正式采用（不是语义认证）"
                : "AI 草稿／失效／历史，不作当前正式输入"}
            </div>
            <div role="cell">
              {entry.eventTimeline ? (
                <StoryEventTimelineText value={entry.eventTimeline} />
              ) : (
                <p>
                  {copyText("app/features/creative/NarrativeStoryHierarchy.8")}
                </p>
              )}
            </div>
            <div role="cell">
              <NarrativeStoryOriginView entry={entry} directory={directory} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function NarrativeStoryHierarchyView({
  directory,
}: {
  directory: StoryDirectory;
}) {
  if (!directory.available)
    return (
      <p role="alert">
        {copyText("app/features/creative/NarrativeStoryHierarchy.9")}
      </p>
    );
  const hierarchy = directory.available;
  return (
    <details className={styles.c7} open>
      <summary className={styles.c8}>
        {copyText("app/features/creative/NarrativeStoryHierarchy.10")}
      </summary>
      <p className={styles.c9}>
        {copyText("app/features/creative/NarrativeStoryHierarchy.11")}
      </p>
      <div className={styles.c10}>
        {hierarchy.groups.map((group) => (
          <details
            key={storyGroupKey(group)}
            data-story-group={storyGroupKey(group)}
          >
            <summary className={styles.c11}>
              {storyGroupLabel(group)} ·{" "}
              {group.state === "current"
                ? "当前目录"
                : group.state === "stale"
                  ? "原范围失效"
                  : "未绑定实际章节"}{" "}
              · {group.chapterIds.length}
              {copyText("app/features/creative/NarrativeStoryHierarchy.12")}
            </summary>
            {group.reasons.map((reason) => (
              <p role="alert" key={reason}>
                {reason}
              </p>
            ))}
            <ul className={styles.c12}>
              {group.chapterIds.map((id) => {
                const chapter = directory.chapters.get(id);
                return (
                  <li key={id} className={styles.c6}>
                    {chapter
                      ? `${chapter.title} · 当前目录 v${chapter.version}`
                      : "当前章节缺失"}{" "}
                    · {id}
                    {group.state !== "current" && "；旧弧不绑定此当前版本"}
                  </li>
                );
              })}
            </ul>
            {!group.chapterIds.length && (
              <p className={styles.c9}>
                {copyText("app/features/creative/NarrativeStoryHierarchy.13")}
              </p>
            )}
          </details>
        ))}
      </div>
    </details>
  );
}

export function NarrativeStoryOriginView({
  entry,
  directory,
}: {
  entry: NarrativeStoryIndexEntry;
  directory: StoryDirectory;
}) {
  return (
    <div className={styles.c13}>
      {narrativeStoryOrigins(entry, directory).map(
        ({ source, chapter, state, groups }) => (
          <p key={source.id} className={styles.c6}>
            {copyText("app/features/creative/NarrativeStoryHierarchy.14")}
            {chapter?.title ?? source.id}
            {copyText("app/features/creative/NarrativeStoryHierarchy.7")}
            {source.version}（{source.id}） ·{" "}
            {state === "current"
              ? `当前目录关联：${groups.map(storyGroupLabel).join("；") || "未归属卷／故事弧"}`
              : state === "stale"
                ? `当前目录已为 v${chapter!.version}，未把旧源重绑当前卷／故事弧`
                : state === "missing"
                  ? "当前目录缺失，保留原来源"
                  : "当前层级不可核对，保留原来源"}
          </p>
        ),
      )}
      {entry.sourceScripts.map((source) => (
        <p key={source.id} className={styles.c6}>
          {copyText("app/features/creative/NarrativeStoryHierarchy.15")}
          {source.id}
          {copyText("app/features/creative/NarrativeStoryHierarchy.7")}
          {source.version}
          {copyText("app/features/creative/NarrativeStoryHierarchy.16")}
        </p>
      ))}
      {!entry.sourceChapters.length && !entry.sourceScripts.length && (
        <p>{copyText("app/features/creative/NarrativeStoryHierarchy.17")}</p>
      )}
    </div>
  );
}

export function NarrativeStoryStructureView({
  entries,
  directory,
}: {
  entries: readonly NarrativeStoryIndexEntry[];
  directory: StoryDirectory;
}) {
  const structured = entries.filter(
    (entry) =>
      entry.selection.kind === "assertion" &&
      ["relationship", "cognition"].includes(entry.classification),
  );
  if (!structured.length) return null;
  return (
    <section
      role="table"
      aria-label={copyText("app/features/creative/NarrativeStoryHierarchy.18")}
      className={styles.c1}
    >
      <p className={styles.c2}>
        {copyText("app/features/creative/NarrativeStoryHierarchy.19")}
      </p>
      <div role="row" className={styles.c3}>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.20")}
        </span>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.21")}
        </span>
        <span role="columnheader">
          {copyText("app/features/creative/NarrativeStoryHierarchy.22")}
        </span>
      </div>
      <div role="rowgroup" className={styles.c4}>
        {structured.map((entry) => (
          <article
            role="row"
            key={`${entry.selection.kind}:${entry.selection.id}`}
            data-story-structure-id={entry.selection.id}
            className={styles.c5}
          >
            <div role="cell" className={styles.c14}>
              <p className={styles.c15}>
                {copyText("app/features/creative/NarrativeStoryHierarchy.20")}
              </p>
              {entry.title}
              {copyText("app/features/creative/NarrativeStoryHierarchy.7")}
              {entry.selection.version}
              <br />
              {entry.selection.id}
              <br />
              {entry.eligibility.state === "eligible"
                ? "当前正式采用（不是语义认证）"
                : "AI 草稿／失效／历史，不作当前正式输入"}
            </div>
            <div
              role="cell"
              data-story-structured-connection
              className={styles.c14}
            >
              <p className={styles.c15}>
                {copyText("app/features/creative/NarrativeStoryHierarchy.21")}
              </p>
              {narrativeStoryConnection(entry)}
            </div>
            <div
              role="cell"
              data-story-structured-origins
              className={styles.c16}
            >
              <p className={styles.c15}>
                {copyText("app/features/creative/NarrativeStoryHierarchy.22")}
              </p>
              <NarrativeStoryOriginView entry={entry} directory={directory} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
