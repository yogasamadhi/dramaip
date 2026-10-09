import type { NarrativeStoryIndexEntry } from "@dramaip/contracts/knowledge";
import {
  narrativeStoryConnection,
  narrativeStoryOrigins,
  storyGroupKey,
  storyGroupLabel,
  type StoryDirectory,
} from "../../narrative-story-hierarchy";
import { StoryEventTimelineText } from "./StoryEventTimeline";

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
      aria-label="来源事件时间线"
      className="min-w-0 rounded border border-line"
    >
      <p className="p-2 text-muted">
        仅按原事件声明的故事时间标注排列，不从章节／剧本块目录、人物认知顺序或因果边推断时间。相同顺序只并列；未标注事件保留，不补时间，不代表全书完整事件覆盖。候选／失效／撤回历史不作为当前正式输入。
      </p>
      <div role="row" className="sr-only">
        <span role="columnheader">原事件与状态</span>
        <span role="columnheader">作者时间标注</span>
        <span role="columnheader">完整原来源</span>
      </div>
      <div role="rowgroup" className="max-h-96 overflow-y-auto">
        {ordered.map((entry) => (
          <article
            role="row"
            key={entry.selection.id}
            data-story-timeline-id={entry.selection.id}
            className="min-w-0 space-y-2 border-t border-line p-2"
          >
            <div role="cell" className="break-all">
              {entry.title} · 原声明 {entry.selection.id} v
              {entry.selection.version} ·{" "}
              {entry.eligibility.state === "eligible"
                ? "当前正式采用（不是语义认证）"
                : "候选／失效／历史，不作当前正式输入"}
            </div>
            <div role="cell">
              {entry.eventTimeline ? (
                <StoryEventTimelineText value={entry.eventTimeline} />
              ) : (
                <p>时间未标注，不推断先后</p>
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
        当前章节／卷／故事弧归属未完整核对，不沿旧缓存分组，不认定为空范围；原声明与原冻结来源保留。
      </p>
    );
  const hierarchy = directory.available;
  return (
    <details className="min-w-0 rounded border border-line p-2" open>
      <summary className="cursor-pointer font-medium">
        当前全书／卷／显式故事弧目录
      </summary>
      <p className="text-muted">
        这是当前目录归属，不是原声明冻结时的归属或模型阅读覆盖。未绑定／失效故事弧保留原身份，不猜测起止章号。
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {hierarchy.groups.map((group) => (
          <details
            key={storyGroupKey(group)}
            data-story-group={storyGroupKey(group)}
          >
            <summary className="cursor-pointer break-words">
              {storyGroupLabel(group)} ·{" "}
              {group.state === "current"
                ? "当前目录"
                : group.state === "stale"
                  ? "原范围失效"
                  : "未绑定实际章节"}{" "}
              · {group.chapterIds.length} 个目录引用（不是阅读覆盖）
            </summary>
            {group.reasons.map((reason) => (
              <p role="alert" key={reason}>
                {reason}
              </p>
            ))}
            <ul className="pl-3">
              {group.chapterIds.map((id) => {
                const chapter = directory.chapters.get(id);
                return (
                  <li key={id} className="break-all">
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
              <p className="text-muted">
                没有实际章节绑定，不推断不存在故事内容。
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
    <div className="space-y-1">
      {narrativeStoryOrigins(entry, directory).map(
        ({ source, chapter, state, groups }) => (
          <p key={source.id} className="break-all">
            原章节 {chapter?.title ?? source.id} v{source.version}（{source.id}
            ） ·{" "}
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
        <p key={source.id} className="break-all">
          原剧本 {source.id} v{source.version}；不强制转换为小说章节或全书归属。
        </p>
      ))}
      {!entry.sourceChapters.length && !entry.sourceScripts.length && (
        <p>原来源未核全，不推断全书覆盖。</p>
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
      aria-label="来源关系与认知结构表"
      className="min-w-0 rounded border border-line"
    >
      <p className="p-2 text-muted">
        方向来自作者声明；人工认知顺序不是正文时间线或已认证的因果结论。各行保留全部跨章／跨卷来源。
      </p>
      <div role="row" className="sr-only">
        <span role="columnheader">原声明与状态</span>
        <span role="columnheader">关系方向／认知主体与对象</span>
        <span role="columnheader">完整原来源与当前目录关联</span>
      </div>
      <div role="rowgroup" className="max-h-96 overflow-y-auto">
        {structured.map((entry) => (
          <article
            role="row"
            key={`${entry.selection.kind}:${entry.selection.id}`}
            data-story-structure-id={entry.selection.id}
            className="min-w-0 space-y-2 border-t border-line p-2"
          >
            <div role="cell" className="min-w-0 break-all">
              <p className="font-medium">原声明与状态</p>
              {entry.title} v{entry.selection.version}
              <br />
              {entry.selection.id}
              <br />
              {entry.eligibility.state === "eligible"
                ? "当前正式采用（不是语义认证）"
                : "候选／失效／历史，不作当前正式输入"}
            </div>
            <div
              role="cell"
              data-story-structured-connection
              className="min-w-0 break-all"
            >
              <p className="font-medium">关系方向／认知主体与对象</p>
              {narrativeStoryConnection(entry)}
            </div>
            <div role="cell" data-story-structured-origins className="min-w-0">
              <p className="font-medium">完整原来源与当前目录关联</p>
              <NarrativeStoryOriginView entry={entry} directory={directory} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
