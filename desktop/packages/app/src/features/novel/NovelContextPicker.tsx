import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, NativeSelect } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";
import type { Chapter } from "@dramaip/contracts/writing";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";
import type { NarrativeSummary } from "@dramaip/contracts/knowledge";
import {
  NarrativeIndexDetailSchema,
  NarrativeSummarySchema,
  NarrativeSummaryScopesSchema,
} from "@dramaip/contracts/knowledge";
import { currentOwnerQuery } from "../../current-owner-read";
import { NarrativeStorySources } from "../creative/NarrativeStorySources";

export function NovelContextPicker(
  props: {
    includeTarget?: boolean;
    purpose?: "planning" | "production";
    chapters: Chapter[];
    request: NarrativeContextRequest;
    disabled: boolean;
    onChange(request: NarrativeContextRequest): void;
  } & (
    | { target: Chapter; scope?: never }
    | { target?: never; scope: { projectId: string; title: string } }
  ),
) {
  const client = useStudio();
  const [open, setOpen] = useState(false);
  const [readHigher, setReadHigher] = useState(false);
  const projectId = props.scope?.projectId ?? props.target!.projectId;
  const quality = Boolean(props.scope);
  const currentOnly = props.purpose === "production";
  const scopesQuery = useQuery({
    queryKey: ["novel-context-summary-scopes", projectId],
    queryFn: async () => {
      const value = await client.narrativeSummaries.scopes(projectId);
      if (!currentOnly) return value;
      const parsed = NarrativeSummaryScopesSchema.parse(value);
      if (parsed.projectId !== projectId)
        throw new Error("实际摘要目录项目无法核对。");
      return parsed;
    },
    enabled: open && (readHigher || Boolean(props.request.summaries?.length)),
    staleTime: 0,
    refetchOnMount: "always",
    retry: currentOnly ? false : undefined,
    refetchInterval: currentOnly ? 5000 : false,
  });
  const scopes = currentOnly ? currentOwnerQuery(scopesQuery) : scopesQuery;
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
  for (const summary of props.request.summaries ?? [])
    if (!higher.has(summary.id))
      higher.set(summary.id, { id: summary.id, title: "先前所选冻结范围" });
  return (
    <details
      className="rounded border border-line p-2 text-xs"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        {props.scope?.title ??
          (props.includeTarget ? "下一章来源范围" : "本轮前文来源")}{" "}
        · 明确选择 {props.request.chapters.length} 章
        {props.request.summaries?.length
          ? ` + ${props.request.summaries.length} 条高层摘要`
          : ""}
        {props.request.story?.length
          ? ` + ${props.request.story.length} 条叙事解释`
          : ""}
      </summary>
      <p className="mt-2 text-muted">
        {quality
          ? "只使用本轮确认范围的实际表达；每章须直接选择原文/章节摘要/段落，或由明确高层摘要覆盖。"
          : props.includeTarget
            ? "续章默认只承接当前章完整原文；可在启动前明确改选摘要、段落或其他前文。"
            : "本章原文会冻结。"}
        未选前文不自动纳入，不取固定前几章或旧摘要；摘要不是原文或语义保证。原章节禁止外发时，摘要与片段同样不能发送。
      </p>
      <p className="mt-1 text-muted">
        {quality ? "本轮范围" : "当前前文"} {previous.length} 章，未选{" "}
        {
          previous.filter(
            (chapter) =>
              !props.request.chapters.some((item) => item.id === chapter.id),
          ).length
        }{" "}
        章没有直接表达；高层摘要的实际覆盖另行列明，不重复计算。这里只是预算估算，生成时还会核对实际冻结结果；不静默裁剪。
      </p>
      {open &&
        previous.map((chapter) => (
          <ContextChapter
            key={chapter.id}
            chapter={chapter}
            selection={props.request.chapters.find(
              (item) => item.id === chapter.id,
            )}
            disabled={props.disabled}
            currentOnly={currentOnly}
            onChange={(selection) =>
              props.onChange({
                ...props.request,
                chapters: previous.flatMap((item) =>
                  item.id === chapter.id
                    ? selection
                      ? [selection]
                      : []
                    : props.request.chapters.filter(
                        (value) => value.id === item.id,
                      ),
                ),
              })
            }
            read={() => client.narrativeIndex.chapter(projectId, chapter.id)}
          />
        ))}
      {open && (
        <section aria-label="小说高层摘要来源" className="mt-3 space-y-2">
          <p className="text-muted">
            可明确选择已采用的卷／故事弧／全书冻结范围摘要，并搭配所选原文或段落。
            {quality
              ? "摘要全部覆盖章节必须位于本轮确认范围，不能拆掉范围外章节。"
              : "必须全部来自当前目标之前的章节；不会截掉摘要中的后文。"}
            新增目录不扩大旧摘要范围，源变化或采用换头须重新选择；完整原文和中间摘要的禁止外发均继承。
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.disabled}
            onClick={() => {
              setReadHigher(true);
              void scopes.refetch();
            }}
          >
            读取卷／故事弧／全书采用头
          </Button>
          {scopes.error && (
            <p role="alert">高层摘要未核全：{message(scopes.error)}</p>
          )}
          {scopes.data?.unavailable.map((reason) => (
            <p role="alert" key={reason}>
              {reason}
            </p>
          ))}
          {(readHigher || props.request.summaries?.length) &&
            [...higher.values()].map((item) => (
              <HigherContextSource
                key={item.id}
                id={item.id}
                title={item.title}
                projectId={projectId}
                previous={previous}
                disabled={props.disabled}
                currentOnly={currentOnly}
                selected={props.request.summaries?.find(
                  (source) => source.id === item.id,
                )}
                onChange={(value) =>
                  props.onChange({
                    ...props.request,
                    summaries: value
                      ? [
                          ...(props.request.summaries ?? []).filter(
                            (source) => source.id !== item.id,
                          ),
                          value,
                        ]
                      : (props.request.summaries ?? []).filter(
                          (source) => source.id !== item.id,
                        ),
                  })
                }
              />
            ))}
          {readHigher && scopes.data && !higher.size && (
            <p className="text-muted">
              没有实际采用摘要；生成候选和目录节点不升级为来源。
            </p>
          )}
        </section>
      )}
      {!previous.length && (
        <p className="mt-2 text-muted">
          {quality
            ? props.purpose === "production"
              ? "请先明确选择制作范围，不自动补入原文或摘要；不使用正文须另行确认。"
              : props.purpose === "planning"
                ? "请先明确选择规划范围，不自动补入原文或摘要；无正文规划可另行明确确认。"
                : "请先明确选择质量范围，不自动补入原文或摘要。"
            : "当前章节之前没有正文目录，不制造前文占位。"}
        </p>
      )}
      {open && (
        <NarrativeStorySources
          key={projectId}
          projectId={projectId}
          chapters={previous}
          selected={props.request.story ?? []}
          disabled={props.disabled}
          onChange={(story) => props.onChange({ ...props.request, story })}
        />
      )}
    </details>
  );
}
function HigherContextSource(props: {
  id: string;
  title: string;
  projectId: string;
  previous: Chapter[];
  disabled: boolean;
  currentOnly?: boolean;
  selected?: { id: string; version: number };
  onChange(value: { id: string; version: number } | undefined): void;
}) {
  const client = useStudio();
  const [read, setRead] = useState(false);
  const sourceQuery = useQuery({
    queryKey: ["novel-context-higher-summary", props.projectId, props.id],
    queryFn: async () => {
      const value = await client.narrativeSummaries.get(
        props.projectId,
        props.id,
      );
      if (!props.currentOnly) return value;
      const parsed = NarrativeSummarySchema.parse(value);
      if (parsed.projectId !== props.projectId || parsed.id !== props.id)
        throw new Error("实际摘要项目或身份无法核对。");
      return parsed;
    },
    enabled: read || Boolean(props.selected),
    staleTime: 0,
    refetchOnMount: "always",
    retry: props.currentOnly ? false : undefined,
    refetchInterval: props.currentOnly ? 5000 : false,
  });
  const source = props.currentOnly
    ? currentOwnerQuery(sourceQuery)
    : sourceQuery;
  const value: NarrativeSummary | undefined = source.data;
  const prior = value?.content.coveredChapters.every((chapter) =>
    props.previous.some(
      (item) =>
        item.id === chapter.id &&
        item.version === chapter.version &&
        item.content.trim(),
    ),
  );
  const eligible =
    (!props.currentOnly || !source.isFetching) &&
    value?.contextEligibility.state === "eligible" &&
    prior &&
    (!props.selected || props.selected.version === value.version);
  return (
    <fieldset
      aria-label={`高层摘要来源 ${props.title}`}
      className="min-w-0 rounded border border-line p-2"
    >
      <legend>{props.title} · 采用范围快照</legend>
      <Button
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        onClick={() => {
          setRead(true);
          void source.refetch();
        }}
      >
        读取此摘要的冻结范围
      </Button>
      <label className="mt-2 block">
        <input
          type="checkbox"
          aria-label={`纳入高层摘要 ${props.id}`}
          checked={Boolean(props.selected)}
          disabled={props.disabled || (!props.selected && !eligible)}
          onChange={(event) =>
            props.onChange(
              event.target.checked && value
                ? { id: value.id, version: value.version }
                : undefined,
            )
          }
        />{" "}
        纳入本轮摘要（不自动纳入原文）
      </label>
      {source.error && <p role="alert">{message(source.error)}</p>}
      {value && (
        <>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted">
            {value.content.summary}
          </p>
          <p className="mt-1 break-all text-muted">
            冻结 {value.content.coveredChapters.length} 章；摘要 v
            {value.version}
            {props.selected ? `／本轮所选 v${props.selected.version}` : ""}
            ；文字估算{" "}
            {Math.ceil(
              new TextEncoder().encode(value.content.summary).length / 4,
            )}{" "}
            token；实际冻结还含引用标识，usage／费用未知。
          </p>
          {value.sourceState === "stale" && (
            <p className="text-muted">
              当前完整范围已变化；这里只可使用原冻结范围，不声称覆盖当前整卷或全书。
            </p>
          )}
          {!eligible && (
            <p role="alert">
              {!prior
                ? "含当前章、后文或旧版本，不能拆掉部分摘要使用。"
                : "不是当前来源有效的所选采用头，请清除并重新明确选择。"}
            </p>
          )}
          {value.contextEligibility.reasons.map((reason) => (
            <p role="alert" key={reason}>
              {reason}
            </p>
          ))}
          <details>
            <summary className="cursor-pointer">此摘要的实际章节版本</summary>
            {value.content.coveredChapters.map((chapter) => (
              <p key={chapter.id} className="break-all">
                {chapter.id} v{chapter.version}
              </p>
            ))}
          </details>
        </>
      )}
    </fieldset>
  );
}
function ContextChapter(props: {
  chapter: Chapter;
  selection?: NarrativeContextRequest["chapters"][number];
  disabled: boolean;
  currentOnly?: boolean;
  onChange(
    value: NarrativeContextRequest["chapters"][number] | undefined,
  ): void;
  read(): ReturnType<ReturnType<typeof useStudio>["narrativeIndex"]["chapter"]>;
}) {
  const { chapter, selection } = props;
  const [load, setLoad] = useState(false);
  const detailQuery = useQuery({
    queryKey: [
      "novel-context-detail",
      chapter.projectId,
      chapter.id,
      chapter.version,
    ],
    queryFn: async () => {
      const value = await props.read();
      if (!props.currentOnly) return value;
      const parsed = NarrativeIndexDetailSchema.parse(value);
      if (
        parsed.projectId !== chapter.projectId ||
        parsed.chapter.id !== chapter.id ||
        parsed.chapter.version !== chapter.version
      )
        throw new Error("实际章节索引项目、身份或版本无法核对。");
      return parsed;
    },
    enabled: load || (selection && selection.representation !== "original"),
    staleTime: 0,
    refetchOnMount: "always",
    retry: props.currentOnly ? false : undefined,
    refetchInterval: props.currentOnly ? 5000 : false,
  });
  const detail = props.currentOnly
    ? currentOwnerQuery(detailQuery)
    : detailQuery;
  const index =
    detail.data?.chapter.version === chapter.version &&
    (!props.currentOnly || !detail.isFetching)
      ? detail.data
      : undefined;
  const choice = !selection
    ? "none"
    : selection.representation === "summary"
      ? `summary:${selection.record.id}`
      : selection.representation;
  const change = (value: string) => {
    const ref = { id: chapter.id, version: chapter.version };
    if (value === "none") props.onChange(undefined);
    else if (value === "original")
      props.onChange({ ...ref, representation: "original" });
    else if (value === "paragraphs")
      props.onChange({
        ...ref,
        representation: "paragraphs",
        paragraphIds: [],
      });
    else {
      const record = index?.summaries.find(
        (summary) => `summary:${summary.id}` === value,
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
      className="mt-2 min-w-0 rounded border border-line p-2"
      disabled={props.disabled}
      aria-label={`前文来源 ${chapter.title}`}
    >
      <legend>
        {chapter.title} · 当前正文版本 {chapter.version}
      </legend>
      <NativeSelect
        aria-label={`前文表达 ${chapter.title}`}
        value={choice}
        className="w-full h-8 text-sm"
        onChange={(event) => change(event.target.value)}
        disabled={!chapter.content.trim() || props.disabled}
      >
        <option value="none">不纳入本轮</option>
        <option value="original">
          完整原文 · 估算{" "}
          {Math.ceil(new TextEncoder().encode(chapter.content).length / 4)}{" "}
          token
        </option>
        <option value="paragraphs" disabled={!index}>
          明确原文段落（不代表整章）
        </option>
        {index?.summaries.map((summary) => (
          <option key={summary.id} value={`summary:${summary.id}`}>
            已采用摘要 · {summary.text.slice(0, 40)}
          </option>
        ))}
        {selection?.representation === "summary" &&
          !index?.summaries.some(
            (summary) => summary.id === selection.record.id,
          ) && <option value={choice}>先前所选摘要 · 当前未核验</option>}
      </NativeSelect>
      <Button
        size="sm"
        variant="secondary"
        className="mt-1"
        onClick={() => {
          setLoad(true);
          void detail.refetch();
        }}
      >
        读取此章摘要和段落
      </Button>
      {selection && (
        <p className="mt-1 text-muted">
          本轮所选正文版本 {selection.version}；不会自动换成新版本。
        </p>
      )}
      {old && (
        <p role="alert" className="mt-1 text-danger-strong">
          选择已失效，请清除后明确重新选择。
        </p>
      )}
      {detail.error && (
        <p className="mt-1 text-muted">
          来源索引未核全：{message(detail.error)}
          。仍可明确选择完整原文，不使用未知摘要。
        </p>
      )}
      {selection?.representation === "summary" &&
        index?.summaries
          .filter((summary) => summary.id === selection.record.id)
          .map((summary) => (
            <p
              key={summary.id}
              className="mt-1 whitespace-pre-wrap break-words text-muted"
            >
              派生摘要：{summary.text} · 估算{" "}
              {Math.ceil(new TextEncoder().encode(summary.text).length / 4)}{" "}
              token；采用记录 {summary.id}，不是文学质量保证。
            </p>
          ))}
      {selection?.representation === "paragraphs" && (
        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
          <p className="text-muted">
            明确勾选实际段落；偏移按此版本 UTF-16，结束位置不含在内。
          </p>
          {index?.paragraphs.map((paragraph) => (
            <label key={paragraph.id} className="block break-words">
              <input
                type="checkbox"
                aria-label={`上下文段落 ${chapter.title} ${paragraph.start}`}
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
              [{paragraph.start}, {paragraph.end}) ·{" "}
              {chapter.content.slice(paragraph.start, paragraph.end)}
            </label>
          ))}
          {!selection.paragraphIds.length && (
            <p role="alert" className="text-danger-strong">
              至少明确选择一个原文段落后才能生成。
            </p>
          )}
        </div>
      )}
      {selection && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1"
          onClick={() => props.onChange(undefined)}
        >
          清除此章来源选择
        </Button>
      )}
    </fieldset>
  );
}
