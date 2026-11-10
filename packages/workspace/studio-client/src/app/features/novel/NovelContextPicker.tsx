import { useState } from "react";
import { useQuery } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
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
import styles from "./NovelContextPicker.module.css";
import { copyText } from "../../copy";

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
  // Chapter writing: an empty selection means the writer picks the default
  // context itself, so the author normally never has to open this.
  const automatic =
    !quality &&
    !props.request.chapters.length &&
    !props.request.summaries?.length &&
    !props.request.story?.length;
  return (
    <details
      className={styles.c1}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.c2}>
        {quality ? (
          <>
            {props.scope?.title}{" "}
            {copyText("app/features/novel/NovelContextPicker.1")}
            {props.request.chapters.length}
            {copyText("app/features/novel/NovelContextPicker.2")}
            {props.request.summaries?.length
              ? ` + ${props.request.summaries.length} 条高层摘要`
              : ""}
            {props.request.story?.length
              ? ` + ${props.request.story.length} 条叙事解释`
              : ""}
          </>
        ) : (
          <>
            {props.includeTarget ? "续写下一章参考的前文：" : "本章参考的前文："}
            {automatic
              ? "自动"
              : `手动选择 ${props.request.chapters.length} 章${
                  props.request.summaries?.length
                    ? ` + ${props.request.summaries.length} 条阶段摘要`
                    : ""
                }${
                  props.request.story?.length
                    ? ` + ${props.request.story.length} 条叙事解释`
                    : ""
                }`}
          </>
        )}
      </summary>
      {quality ? (
        <>
          <p className={styles.c3}>
            只使用本轮确认范围的实际表达；每章须直接选择原文/章节摘要/段落，或由明确高层摘要覆盖。
            {copyText("app/features/novel/NovelContextPicker.3")}
          </p>
          <p className={styles.c4}>
            本轮范围 {previous.length}
            {copyText("app/features/novel/NovelContextPicker.4")}{" "}
            {
              previous.filter(
                (chapter) =>
                  !props.request.chapters.some(
                    (item) => item.id === chapter.id,
                  ),
              ).length
            }{" "}
            {copyText("app/features/novel/NovelContextPicker.5")}
          </p>
        </>
      ) : (
        <p className={styles.c3}>
          {automatic
            ? "自动带入最近几章的原文和更早章节的摘要，一般不用设置。需要时可在下面手动指定，指定后只使用你选的内容。"
            : "当前只使用你手动选择的内容。"}
          {!automatic && (
            <Button
              size="sm"
              variant="secondary"
              disabled={props.disabled}
              onClick={() =>
                props.onChange({ format: "narrative-context-v1", chapters: [] })
              }
            >
              恢复自动
            </Button>
          )}
        </p>
      )}
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
        <section
          aria-label={copyText("app/features/novel/NovelContextPicker.6")}
          className={styles.c5}
        >
          <p className={styles.c6}>
            {copyText("app/features/novel/NovelContextPicker.7")}
            {quality
              ? "摘要全部覆盖章节必须位于本轮确认范围，不能拆掉范围外章节。"
              : "必须全部来自当前目标之前的章节；不会截掉摘要中的后文。"}
            {copyText("app/features/novel/NovelContextPicker.8")}
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
            {copyText("app/features/novel/NovelContextPicker.9")}
          </Button>
          {scopes.error && (
            <p role="alert">
              {copyText("app/features/novel/NovelContextPicker.10")}
              {message(scopes.error)}
            </p>
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
            <p className={styles.c6}>
              {copyText("app/features/novel/NovelContextPicker.11")}
            </p>
          )}
        </section>
      )}
      {!previous.length && (
        <p className={styles.c3}>
          {quality
            ? props.purpose === "production"
              ? "请先明确选择制作范围，不自动补入原文或摘要；不使用正文须另行确认。"
              : props.purpose === "planning"
                ? "请先明确选择规划范围，不自动补入原文或摘要；无正文规划可另行明确确认。"
                : "请先明确选择质量范围，不自动补入原文或摘要。"
            : "这是第一章，还没有前文。"}
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
      aria-label={copyText("app/features/novel/NovelContextPicker.42", {
        p1: props.title,
      })}
      className={styles.c7}
    >
      <legend>
        {props.title}
        {copyText("app/features/novel/NovelContextPicker.12")}
      </legend>
      <Button
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        onClick={() => {
          setRead(true);
          void source.refetch();
        }}
      >
        {copyText("app/features/novel/NovelContextPicker.13")}
      </Button>
      <label className={styles.c8}>
        <input
          type="checkbox"
          aria-label={copyText("app/features/novel/NovelContextPicker.43", {
            p1: props.id,
          })}
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
        {copyText("app/features/novel/NovelContextPicker.14")}
      </label>
      {source.error && <p role="alert">{message(source.error)}</p>}
      {value && (
        <>
          <p className={styles.c9}>{value.content.summary}</p>
          <p className={styles.c10}>
            {copyText("app/features/novel/NovelContextPicker.15")}
            {value.content.coveredChapters.length}
            {copyText("app/features/novel/NovelContextPicker.16")}
            {value.version}
            {props.selected ? `／本轮所选 v${props.selected.version}` : ""}
            {copyText("app/features/novel/NovelContextPicker.17")}{" "}
            {Math.ceil(
              new TextEncoder().encode(value.content.summary).length / 4,
            )}{" "}
            {copyText("app/features/novel/NovelContextPicker.18")}
          </p>
          {value.sourceState === "stale" && (
            <p className={styles.c6}>
              {copyText("app/features/novel/NovelContextPicker.19")}
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
            <summary className={styles.c11}>
              {copyText("app/features/novel/NovelContextPicker.20")}
            </summary>
            {value.content.coveredChapters.map((chapter) => (
              <p key={chapter.id} className={styles.c12}>
                {chapter.id}
                {copyText("app/features/novel/NovelContextPicker.21")}
                {chapter.version}
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
      className={styles.c13}
      disabled={props.disabled}
      aria-label={copyText("app/features/novel/NovelContextPicker.44", {
        p1: chapter.title,
      })}
    >
      <legend>
        {chapter.title}
        {copyText("app/features/novel/NovelContextPicker.22")}
        {chapter.version}
      </legend>
      <NativeSelect
        aria-label={copyText("app/features/novel/NovelContextPicker.45", {
          p1: chapter.title,
        })}
        value={choice}
        className={styles.c14}
        onChange={(event) => change(event.target.value)}
        disabled={!chapter.content.trim() || props.disabled}
      >
        <option value="none">
          {copyText("app/features/novel/NovelContextPicker.23")}
        </option>
        <option value="original">
          {copyText("app/features/novel/NovelContextPicker.24")}{" "}
          {Math.ceil(new TextEncoder().encode(chapter.content).length / 4)}{" "}
          {copyText("app/features/novel/NovelContextPicker.25")}
        </option>
        <option value="paragraphs" disabled={!index}>
          {copyText("app/features/novel/NovelContextPicker.26")}
        </option>
        {index?.summaries.map((summary) => (
          <option key={summary.id} value={`summary:${summary.id}`}>
            {copyText("app/features/novel/NovelContextPicker.27")}
            {summary.text.slice(0, 40)}
          </option>
        ))}
        {selection?.representation === "summary" &&
          !index?.summaries.some(
            (summary) => summary.id === selection.record.id,
          ) && (
            <option value={choice}>
              {copyText("app/features/novel/NovelContextPicker.28")}
            </option>
          )}
      </NativeSelect>
      <Button
        size="sm"
        variant="secondary"
        className={styles.c15}
        onClick={() => {
          setLoad(true);
          void detail.refetch();
        }}
      >
        {copyText("app/features/novel/NovelContextPicker.29")}
      </Button>
      {selection && (
        <p className={styles.c4}>
          {copyText("app/features/novel/NovelContextPicker.30")}
          {selection.version}
          {copyText("app/features/novel/NovelContextPicker.31")}
        </p>
      )}
      {old && (
        <p role="alert" className={styles.c16}>
          {copyText("app/features/novel/NovelContextPicker.32")}
        </p>
      )}
      {detail.error && (
        <p className={styles.c4}>
          {copyText("app/features/novel/NovelContextPicker.33")}
          {message(detail.error)}
          {copyText("app/features/novel/NovelContextPicker.34")}
        </p>
      )}
      {selection?.representation === "summary" &&
        index?.summaries
          .filter((summary) => summary.id === selection.record.id)
          .map((summary) => (
            <p key={summary.id} className={styles.c9}>
              {copyText("app/features/novel/NovelContextPicker.35")}
              {summary.text}
              {copyText("app/features/novel/NovelContextPicker.36")}{" "}
              {Math.ceil(new TextEncoder().encode(summary.text).length / 4)}{" "}
              {copyText("app/features/novel/NovelContextPicker.37")}
              {summary.id}
              {copyText("app/features/novel/NovelContextPicker.38")}
            </p>
          ))}
      {selection?.representation === "paragraphs" && (
        <div className={styles.c17}>
          <p className={styles.c6}>
            {copyText("app/features/novel/NovelContextPicker.39")}
          </p>
          {index?.paragraphs.map((paragraph) => (
            <label key={paragraph.id} className={styles.c18}>
              <input
                type="checkbox"
                aria-label={copyText(
                  "app/features/novel/NovelContextPicker.46",
                  { p1: chapter.title, p2: paragraph.start },
                )}
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
            <p role="alert" className={styles.c19}>
              {copyText("app/features/novel/NovelContextPicker.40")}
            </p>
          )}
        </div>
      )}
      {selection && (
        <Button
          size="sm"
          variant="secondary"
          className={styles.c15}
          onClick={() => props.onChange(undefined)}
        >
          {copyText("app/features/novel/NovelContextPicker.41")}
        </Button>
      )}
    </fieldset>
  );
}
