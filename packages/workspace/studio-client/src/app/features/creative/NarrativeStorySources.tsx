import { useState } from "react";
import { useQuery } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import type { Chapter } from "@dramaip/contracts/writing";
import {
  NarrativeStoryIndexSchema,
  type NarrativeStorySelection,
} from "@dramaip/contracts/knowledge";
import { useStudio, message } from "../../studio-shared";
import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
} from "../../current-owner-read";
import {
  narrativeStoryScopeReasons,
  sameNarrativeStorySelection,
} from "../../narrative-story-scope";
import {
  narrativeStoryDirectory,
  narrativeStoryVisibleEntries,
  storyGroupKey,
  storyGroupLabel,
  type StoryIndexView,
} from "../../narrative-story-hierarchy";
import {
  NarrativeStoryHierarchyView,
  NarrativeStoryOriginView,
  NarrativeStoryStructureView,
  NarrativeEventTimelineView,
} from "./NarrativeStoryHierarchy";
import styles from "./NarrativeStorySources.module.css";
import { copyText } from "../../copy";

type Props = { projectId: string; chapterId?: string } & (
  | {
      chapters: readonly Chapter[];
      selected: readonly NarrativeStorySelection[];
      disabled: boolean;
      onChange(value: NarrativeStorySelection[]): void;
    }
  | { chapters?: never; selected?: never; disabled?: never; onChange?: never }
);
export function NarrativeStorySources(props: Props) {
  const client = useStudio();
  const [read, setRead] = useState(false);
  const [filter, setFilter] = useState({
    projectId: props.projectId,
    groupKey: "",
    view: "all" as StoryIndexView,
  });
  const query = currentOwnerQuery(
    useQuery({
      queryKey: ["narrative-story-index", props.projectId],
      queryFn: async () => {
        const value = NarrativeStoryIndexSchema.parse(
          await client.narrativeStoryIndex.catalog(props.projectId),
        );
        if (
          value.projectId !== props.projectId ||
          value.entries.some((entry) => entry.projectId !== props.projectId) ||
          new Set(
            value.entries.map(
              (entry) => `${entry.selection.kind}:${entry.selection.id}`,
            ),
          ).size !== value.entries.length
        )
          throw new Error("叙事索引项目或身份不符，未显示其他项目或重复声明。");
        return value;
      },
      enabled: read || Boolean(props.selected?.length),
      ...CURRENT_OWNER_READ_OPTIONS,
      refetchInterval: read || props.selected?.length ? 5000 : false,
    }),
  );
  const directory = narrativeStoryDirectory(query.data?.hierarchy);
  const currentFilter =
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
    { ...currentFilter, chapterId: props.chapterId },
  );
  const hiddenSelections =
    props.selected?.filter(
      (selection) =>
        query.data?.entries.some(
          (entry) =>
            entry.selection.kind === selection.kind &&
            entry.selection.id === selection.id,
        ) &&
        !entries.some(
          (entry) =>
            entry.selection.kind === selection.kind &&
            entry.selection.id === selection.id,
        ),
    ) ?? [];
  return (
    <section
      aria-label={copyText("app/features/creative/NarrativeStorySources.1")}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/creative/NarrativeStorySources.2")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/creative/NarrativeStorySources.3")}
      </p>
      {props.onChange && (
        <p className={styles.c3}>
          {copyText("app/features/creative/NarrativeStorySources.4")}
        </p>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        onClick={() => {
          setRead(true);
          void query.refetch();
        }}
      >
        {copyText("app/features/creative/NarrativeStorySources.5")}
      </Button>
      {query.error && (
        <p role="alert">
          {copyText("app/features/creative/NarrativeStorySources.6")}
          {message(query.error)}
          {copyText("app/features/creative/NarrativeStorySources.7")}
        </p>
      )}
      {(read || props.selected?.length) && !query.data && !query.error && (
        <p className={styles.c3}>
          {copyText("app/features/creative/NarrativeStorySources.8")}
        </p>
      )}
      {query.data && (
        <>
          <NarrativeStoryHierarchyView directory={directory} />
          <div className={styles.c4}>
            <label>
              {copyText("app/features/creative/NarrativeStorySources.9")}{" "}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/NarrativeStorySources.10",
                )}
                className={styles.c5}
                value={currentFilter.groupKey}
                onChange={(event) =>
                  setFilter({ ...currentFilter, groupKey: event.target.value })
                }
              >
                <option value="">
                  {copyText("app/features/creative/NarrativeStorySources.11")}
                </option>
                {directory.available?.groups.map((group) => (
                  <option
                    key={storyGroupKey(group)}
                    value={storyGroupKey(group)}
                    disabled={group.state !== "current"}
                  >
                    {storyGroupLabel(group)}
                    {group.state !== "current"
                      ? "（原范围未核全，不猜测匹配）"
                      : ""}
                  </option>
                ))}
                {currentFilter.groupKey &&
                  !directory.groups.has(currentFilter.groupKey) && (
                    <option value={currentFilter.groupKey}>
                      {copyText(
                        "app/features/creative/NarrativeStorySources.12",
                      )}
                    </option>
                  )}
              </NativeSelect>
            </label>
            <label>
              {copyText("app/features/creative/NarrativeStorySources.13")}{" "}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/NarrativeStorySources.14",
                )}
                className={styles.c6}
                value={currentFilter.view}
                onChange={(event) =>
                  setFilter({
                    ...currentFilter,
                    view: event.target.value as StoryIndexView,
                  })
                }
              >
                <option value="all">
                  {copyText("app/features/creative/NarrativeStorySources.15")}
                </option>
                <option value="nodes">
                  {copyText("app/features/creative/NarrativeStorySources.16")}
                </option>
                <option value="relationship">
                  {copyText("app/features/creative/NarrativeStorySources.17")}
                </option>
                <option value="cognition">
                  {copyText("app/features/creative/NarrativeStorySources.18")}
                </option>
              </NativeSelect>
            </label>
          </div>
          <p className={styles.c3}>
            {copyText("app/features/creative/NarrativeStorySources.19")}
          </p>
          {currentFilter.groupKey &&
            directory.groups.get(currentFilter.groupKey)?.state !==
              "current" && (
              <p role="alert">
                {copyText("app/features/creative/NarrativeStorySources.20")}
              </p>
            )}
          {hiddenSelections.length > 0 && (
            <p role="alert">
              {copyText("app/features/creative/NarrativeStorySources.21")}
              {hiddenSelections.length}{" "}
              {copyText("app/features/creative/NarrativeStorySources.22")}
            </p>
          )}
          <p className={styles.c7}>
            {copyText("app/features/creative/NarrativeStorySources.23")}
            {query.data.fingerprint}
            {copyText("app/features/creative/NarrativeStorySources.24")}
            {entries.length}{" "}
            {copyText("app/features/creative/NarrativeStorySources.25")}
          </p>
          <NarrativeEventTimelineView entries={entries} directory={directory} />
          <NarrativeStoryStructureView
            entries={entries}
            directory={directory}
          />
          <div className={styles.c8}>
            {entries.map((entry) => {
              const selection = props.selected?.find(
                (item) =>
                  item.kind === entry.selection.kind &&
                  item.id === entry.selection.id,
              );
              const reasons = props.chapters
                ? narrativeStoryScopeReasons(
                    entry,
                    props.projectId,
                    props.chapters,
                  )
                : entry.eligibility.reasons;
              const old =
                selection &&
                !sameNarrativeStorySelection(selection, entry.selection);
              return (
                <article
                  key={`${entry.selection.kind}:${entry.selection.id}`}
                  data-story-index-id={entry.selection.id}
                  className={styles.c9}
                >
                  <p className={styles.c10}>
                    {entry.title} · {entry.classification}
                    {copyText("app/features/creative/NarrativeStorySources.26")}
                    {entry.selection.version}
                  </p>
                  <p className={styles.c3}>
                    {entry.status === "adopted"
                      ? "已明确采用"
                      : entry.status === "pending"
                        ? "AI 草稿，未采用"
                        : "已放弃"}{" "}
                    {copyText("app/features/creative/NarrativeStorySources.27")}
                    {entry.sourceState === "current"
                      ? "当前可核对"
                      : entry.sourceState === "stale"
                        ? "已失效"
                        : "不可核对"}{" "}
                    ·{" "}
                    {entry.retirement === "withdrawn"
                      ? "已撤回"
                      : entry.retirement === "replaced"
                        ? "已被替换，保留原声明"
                        : entry.eligibility.state === "eligible"
                          ? "实际采用绑定有效（不是语义通过）"
                          : "不能作为当前正式上下文"}
                  </p>
                  <p className={styles.c11}>{entry.statement}</p>
                  {entry.endpoints.length > 0 && (
                    <p className={styles.c12}>
                      {copyText(
                        "app/features/creative/NarrativeStorySources.28",
                      )}
                      {entry.endpoints
                        .map(
                          (node) =>
                            `${node.title} v${node.version}（${node.id}）`,
                        )
                        .join("；")}
                    </p>
                  )}
                  {entry.storyOrder !== undefined && (
                    <p className={styles.c3}>
                      {copyText(
                        "app/features/creative/NarrativeStorySources.29",
                      )}
                      {entry.storyOrder}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.30",
                      )}{" "}
                      {entry.knowledgeState}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.31",
                      )}
                    </p>
                  )}
                  <p className={styles.c3}>
                    {entry.interpretation === "author-inferred"
                      ? "作者推断，不升级为原文事实"
                      : entry.interpretation === "source-stated"
                        ? "作者声明原文有陈述，仍未语义认证"
                        : "作者声明，不是原文语义证明"}{" "}
                    {copyText("app/features/creative/NarrativeStorySources.32")}
                    {entry.sourceChapters.length}
                    {copyText("app/features/creative/NarrativeStorySources.33")}
                    {entry.sourceScripts.length}
                    {copyText("app/features/creative/NarrativeStorySources.34")}
                  </p>
                  <NarrativeStoryOriginView
                    entry={entry}
                    directory={directory}
                  />
                  <details>
                    <summary className={styles.c13}>
                      {copyText(
                        "app/features/creative/NarrativeStorySources.35",
                      )}
                    </summary>
                    <p className={styles.c14}>
                      {copyText(
                        "app/features/creative/NarrativeStorySources.36",
                      )}
                      {entry.selection.id}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.37",
                      )}
                      {entry.selection.version} · {entry.sourceFingerprint}
                    </p>
                    {entry.record && (
                      <p className={styles.c14}>
                        {copyText(
                          "app/features/creative/NarrativeStorySources.38",
                        )}
                        {entry.record.kind} {entry.record.id}
                        {copyText(
                          "app/features/creative/NarrativeStorySources.37",
                        )}
                        {entry.record.version}
                      </p>
                    )}
                    {entry.sourceChapters.map((ref) => (
                      <p key={ref.id} className={styles.c14}>
                        {copyText(
                          "app/features/creative/NarrativeStorySources.39",
                        )}
                        {ref.id}
                        {copyText(
                          "app/features/creative/NarrativeStorySources.37",
                        )}
                        {ref.version}
                      </p>
                    ))}
                    {entry.sourceScripts.map((ref) => (
                      <p key={ref.id} className={styles.c14}>
                        {copyText(
                          "app/features/creative/NarrativeStorySources.40",
                        )}
                        {ref.id}
                        {copyText(
                          "app/features/creative/NarrativeStorySources.37",
                        )}
                        {ref.version}
                      </p>
                    ))}
                  </details>
                  {props.onChange && (
                    <label className={styles.c15}>
                      <input
                        type="checkbox"
                        aria-label={copyText(
                          "app/features/creative/NarrativeStorySources.49",
                          { p1: entry.selection.id },
                        )}
                        checked={Boolean(selection)}
                        disabled={
                          props.disabled ||
                          (!selection &&
                            (query.isFetching ||
                              reasons.length > 0 ||
                              (props.selected?.length ?? 0) >= 200))
                        }
                        onChange={(event) =>
                          props.onChange?.(
                            event.target.checked
                              ? [...(props.selected ?? []), entry.selection]
                              : (props.selected ?? []).filter(
                                  (item) =>
                                    !(
                                      item.kind === entry.selection.kind &&
                                      item.id === entry.selection.id
                                    ),
                                ),
                          )
                        }
                      />{" "}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.41",
                      )}
                    </label>
                  )}
                  {old && (
                    <p role="alert">
                      {copyText(
                        "app/features/creative/NarrativeStorySources.42",
                      )}
                      {selection.version}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.43",
                      )}
                      {entry.selection.version}
                      {copyText(
                        "app/features/creative/NarrativeStorySources.44",
                      )}
                    </p>
                  )}
                  {reasons.map((reason) => (
                    <p key={reason} role="alert" className={styles.c3}>
                      {reason}
                    </p>
                  ))}
                </article>
              );
            })}
          </div>
          {!entries.length && (
            <p className={styles.c3}>
              {copyText("app/features/creative/NarrativeStorySources.45")}
            </p>
          )}
        </>
      )}
      {props.selected
        ?.filter(
          (selection) =>
            !query.data?.entries.some(
              (entry) =>
                entry.selection.kind === selection.kind &&
                entry.selection.id === selection.id,
            ),
        )
        .map((selection) => (
          <div key={`${selection.kind}:${selection.id}`} className={styles.c16}>
            <p role="alert" className={styles.c14}>
              {copyText("app/features/creative/NarrativeStorySources.46")}
              {selection.kind} {selection.id}
              {copyText("app/features/creative/NarrativeStorySources.37")}
              {selection.version}{" "}
              {copyText("app/features/creative/NarrativeStorySources.47")}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={props.disabled}
              onClick={() =>
                props.onChange?.(
                  (props.selected ?? []).filter(
                    (item) => !sameNarrativeStorySelection(item, selection),
                  ),
                )
              }
            >
              {copyText("app/features/creative/NarrativeStorySources.48")}
            </Button>
          </div>
        ))}
    </section>
  );
}
