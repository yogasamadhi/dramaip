import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, NativeSelect } from "@dramaip/ui-shared";
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
      aria-label="来源锚定叙事索引"
      className="mt-3 min-w-0 space-y-2 rounded border border-line p-3 text-xs"
    >
      <h4 className="font-semibold">人物／事件、因果关系与认知声明</h4>
      <p className="text-muted">
        这是来源锚定的作者解释目录，不是模型语义认证。候选、过期与撤回历史保留；旧手工图仍单独维护，不自动升级。章节／卷／故事弧归属沿当前目录核对，不把声明数量当作全书质量或阅读覆盖。
      </p>
      {props.onChange && (
        <p className="text-muted">
          只有勾选的当前正式声明才进入本轮输入：声明文本、实际端点名称／版本和来源身份；不附带冻结引文、原文或端点摘要。原章、段落、中间资料和声明自身的禁止策略均继承。每条声明的全部来源须在本轮允许范围；不扩大原文／摘要覆盖。
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
        读取人物／因果／认知来源目录
      </Button>
      {query.error && (
        <p role="alert">
          叙事索引未完整核对：{message(query.error)}；旧缓存不作为本次选择依据。
        </p>
      )}
      {(read || props.selected?.length) && !query.data && !query.error && (
        <p className="text-muted">正在读取当前 owner 目录，未计为已检查。</p>
      )}
      {query.data && (
        <>
          <NarrativeStoryHierarchyView directory={directory} />
          <div className="flex flex-wrap gap-2">
            <label>
              目录关联筛选（只改变展示）{" "}
              <NativeSelect
                aria-label="叙事目录层级筛选"
                className="max-w-full w-auto"
                value={currentFilter.groupKey}
                onChange={(event) =>
                  setFilter({ ...currentFilter, groupKey: event.target.value })
                }
              >
                <option value="">全部原声明（含无章节的剧本来源）</option>
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
                      原筛选层级当前未核对，请明确切回全部
                    </option>
                  )}
              </NativeSelect>
            </label>
            <label>
              结构展示{" "}
              <NativeSelect
                aria-label="叙事索引结构展示"
                className="w-auto"
                value={currentFilter.view}
                onChange={(event) =>
                  setFilter({
                    ...currentFilter,
                    view: event.target.value as StoryIndexView,
                  })
                }
              >
                <option value="all">全部声明</option>
                <option value="nodes">人物／事件等节点</option>
                <option value="relationship">关系与因果方向</option>
                <option value="cognition">认知声明（按人工顺序）</option>
              </NativeSelect>
            </label>
          </div>
          <p className="text-muted">
            层级筛选只查找至少一个当前版本来源的目录关联，不表示整条跨章关系局限在此范围；每条的全部原来源仍显示，不改变本轮已选声明或允许章节。
          </p>
          {currentFilter.groupKey &&
            directory.groups.get(currentFilter.groupKey)?.state !==
              "current" && (
              <p role="alert">
                原筛选层级已失效或不可核对，未换成另一个卷／故事弧。请明确切回全部或选择当前层级。
              </p>
            )}
          {hiddenSelections.length > 0 && (
            <p role="alert">
              当前展示筛选外仍有 {hiddenSelections.length}{" "}
              个原选择，未自动移除或替换；切回全部可逐项审阅。本轮输入仍按全部实际来源核对。
            </p>
          )}
          <p className="break-all text-muted">
            当前目录指纹 {query.data.fingerprint} · 本范围 {entries.length}{" "}
            条声明；不是原著覆盖率。
          </p>
          <NarrativeEventTimelineView entries={entries} directory={directory} />
          <NarrativeStoryStructureView
            entries={entries}
            directory={directory}
          />
          <div className="max-h-96 space-y-2 overflow-y-auto">
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
                  className="min-w-0 rounded border border-line p-2"
                >
                  <p className="font-medium">
                    {entry.title} · {entry.classification} · v
                    {entry.selection.version}
                  </p>
                  <p className="text-muted">
                    {entry.status === "adopted"
                      ? "已明确采用"
                      : entry.status === "pending"
                        ? "候选，未采用"
                        : "已放弃"}{" "}
                    · 原来源
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
                  <p className="whitespace-pre-wrap break-words">
                    {entry.statement}
                  </p>
                  {entry.endpoints.length > 0 && (
                    <p className="break-words text-muted">
                      实际端点：
                      {entry.endpoints
                        .map(
                          (node) =>
                            `${node.title} v${node.version}（${node.id}）`,
                        )
                        .join("；")}
                    </p>
                  )}
                  {entry.storyOrder !== undefined && (
                    <p className="text-muted">
                      认知声明顺序 {entry.storyOrder} · 状态{" "}
                      {entry.knowledgeState}
                      ；这是人工声明顺序，不冒充正文时间线。
                    </p>
                  )}
                  <p className="text-muted">
                    {entry.interpretation === "author-inferred"
                      ? "作者推断，不升级为原文事实"
                      : entry.interpretation === "source-stated"
                        ? "作者声明原文有陈述，仍未语义认证"
                        : "作者声明，不是原文语义证明"}{" "}
                    · 来源 {entry.sourceChapters.length} 章／
                    {entry.sourceScripts.length} 份剧本
                  </p>
                  <NarrativeStoryOriginView
                    entry={entry}
                    directory={directory}
                  />
                  <details>
                    <summary className="cursor-pointer">
                      精确来源与采用身份
                    </summary>
                    <p className="break-all">
                      原声明 {entry.selection.id} v{entry.selection.version} ·{" "}
                      {entry.sourceFingerprint}
                    </p>
                    {entry.record && (
                      <p className="break-all">
                        实际 {entry.record.kind} {entry.record.id} v
                        {entry.record.version}
                      </p>
                    )}
                    {entry.sourceChapters.map((ref) => (
                      <p key={ref.id} className="break-all">
                        章节 {ref.id} v{ref.version}
                      </p>
                    ))}
                    {entry.sourceScripts.map((ref) => (
                      <p key={ref.id} className="break-all">
                        剧本 {ref.id} v{ref.version}
                      </p>
                    ))}
                  </details>
                  {props.onChange && (
                    <label className="mt-2 block">
                      <input
                        type="checkbox"
                        aria-label={`纳入叙事声明 ${entry.selection.id}`}
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
                      纳入本轮解释（不附带原文）
                    </label>
                  )}
                  {old && (
                    <p role="alert">
                      原选择 v{selection.version} 已失效，未自动改为 v
                      {entry.selection.version}；请移除后重新选择。
                    </p>
                  )}
                  {reasons.map((reason) => (
                    <p key={reason} role="alert" className="text-muted">
                      {reason}
                    </p>
                  ))}
                </article>
              );
            })}
          </div>
          {!entries.length && (
            <p className="text-muted">
              本范围没有来源锚定声明；不据此认定没有故事内容或旧手工图。
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
          <div
            key={`${selection.kind}:${selection.id}`}
            className="rounded border border-line p-2"
          >
            <p role="alert" className="break-all">
              原所选 {selection.kind} {selection.id} v{selection.version}{" "}
              当前未核对；未切换最近声明。
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
              移除此原选择
            </Button>
          </div>
        ))}
    </section>
  );
}
