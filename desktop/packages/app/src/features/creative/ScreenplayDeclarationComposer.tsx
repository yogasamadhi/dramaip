import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BareButton } from "@dramaip/ui-shared";
import { StoryCausalNodeKindSchema } from "@dramaip/contracts";
import {
  StoryDeclarationInputSchema,
  StoryDeclarationSourceSchema,
  type StoryDeclarationInput,
} from "@dramaip/contracts/knowledge";
import { useStudio, message } from "../../studio-shared";
import {
  emptyEventTimelineDraft,
  eventTimelineInput,
  StoryEventTimelineFields,
} from "./StoryEventTimeline";

const field =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const button =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";

/** Optional saved-script path; no novel, initializing GET, generated IDs or implicit source choice. */
export function ScreenplayDeclarationComposer({
  projectId,
  busy,
  save,
  sourceOnly,
}: {
  projectId: string;
  busy: boolean;
} & (
  | { save(input: StoryDeclarationInput): void; sourceOnly?: never }
  | {
      save?: never;
      sourceOnly: {
        content: ReactNode;
        canSubmit: boolean;
        submit(sources: StoryDeclarationInput["sources"]): void;
      };
    }
)) {
  const client = useStudio();
  const [cursor, setCursor] = useState<string>(),
    [scriptId, setScriptId] = useState("");
  const [blockIds, setBlockIds] = useState<string[]>([]),
    [title, setTitle] = useState(""),
    [statement, setStatement] = useState("");
  const [kind, setKind] = useState<StoryDeclarationInput["kind"]>("event");
  const [eventTime, setEventTime] = useState(emptyEventTimelineDraft);
  const catalog = useQuery({
    queryKey: ["story-declaration", projectId, "script-sources", cursor],
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 0,
    queryFn: () =>
      client.screenplaySources.list(projectId, { cursor, limit: 20 }),
  });
  const detail = useQuery({
    queryKey: ["story-declaration", projectId, "script-source", scriptId],
    enabled: Boolean(projectId && scriptId),
    retry: false,
    staleTime: 0,
    queryFn: () => client.screenplaySources.get(projectId, scriptId),
  });
  const page = catalog.isError ? undefined : catalog.data,
    snapshot = detail.isError ? undefined : detail.data;
  const source =
    snapshot?.source.state === "available" ? snapshot.source : undefined;
  useEffect(() => {
    setBlockIds([]);
  }, [scriptId, source?.contentHash, snapshot?.scriptVersion, detail.isError]);
  const selected =
    source?.document.blocks.filter((block) => blockIds.includes(block.id)) ??
    [];
  const draft =
    snapshot && source
      ? StoryDeclarationInputSchema.safeParse({
          kind,
          title,
          statement,
          ...eventTimelineInput(kind, eventTime),
          sources: [
            {
              kind: "screenplay-blocks",
              scriptId,
              scriptVersion: snapshot.scriptVersion,
              documentId: source.document.id,
              documentVersion: source.document.version,
              documentContentHash: source.contentHash,
              blockIds: selected.map((block) => block.id),
            },
          ],
        })
      : undefined;
  const catalogIdentity = page?.items.find(
    (item) => item.scriptId === scriptId,
  );
  const selectedSource =
    snapshot && source
      ? StoryDeclarationSourceSchema.safeParse({
          kind: "screenplay-blocks",
          scriptId,
          scriptVersion: snapshot.scriptVersion,
          documentId: source.document.id,
          documentVersion: source.document.version,
          documentContentHash: source.contentHash,
          blockIds: selected.map((block) => block.id),
        })
      : undefined;
  const canCreate = Boolean(
    !busy &&
    !catalog.isFetching &&
    !detail.isFetching &&
    page &&
    source &&
    snapshot &&
    catalogIdentity?.state === "available" &&
    catalogIdentity.scriptVersion === snapshot.scriptVersion &&
    (sourceOnly
      ? selectedSource?.success && sourceOnly.canSubmit
      : draft?.success) &&
    blockIds.length === selected.length &&
    selected.every((block) => "text" in block && block.text.trim()),
  );
  const changePage = (next?: string) => {
    setCursor(next);
    setScriptId("");
    setBlockIds([]);
  };
  return (
    <form
      aria-label={sourceOnly ? "关系认知剧本来源表单" : "正式剧本来源候选表单"}
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate) return;
        if (sourceOnly && selectedSource?.success)
          sourceOnly.submit([selectedSource.data]);
        else if (draft?.success) save?.(draft.data);
      }}
    >
      <p className="text-xs text-muted">
        直接剧本是独立来源，不要求小说。只读已保存块；原稿缺失、重复 ID
        或损坏时不自动初始化或重解析。每个页内候选明确选择一个实际剧本。
      </p>
      {(catalog.isError || detail.isError) && (
        <p role="alert">
          剧本来源读取失败：{message(catalog.error ?? detail.error)}
          ；旧缓存不作为当前依据。
        </p>
      )}
      {snapshot?.source.state === "unavailable" && (
        <p role="alert">
          原已保存剧本来源不可用：{snapshot.source.reason}；未重新生成文档或块
          ID。
        </p>
      )}
      <fieldset
        disabled={!projectId || busy || catalog.isFetching || catalog.isError}
        className="space-y-3"
      >
        <label className="block text-sm">
          声明原剧本
          <select
            aria-label="声明原剧本"
            className={field}
            value={scriptId}
            onChange={(event) => {
              setScriptId(event.target.value);
              setBlockIds([]);
            }}
          >
            <option value="">明确选择已保存剧本，不默认选中</option>
            {page?.items.map((item) => (
              <option key={item.scriptId} value={item.scriptId}>
                {item.title} · v{item.scriptVersion}
                {item.state === "unavailable" ? " · 来源不可用" : ""}
              </option>
            ))}
          </select>
        </label>
        {(cursor || page?.nextCursor) && (
          <div className="flex gap-2">
            {cursor && (
              <BareButton className={button} onClick={() => changePage()}>
                回到剧本目录首页
              </BareButton>
            )}
            {page?.nextCursor && (
              <BareButton
                className={button}
                onClick={() => changePage(page.nextCursor)}
              >
                下一页实际剧本
              </BareButton>
            )}
          </div>
        )}
        {source && !detail.isFetching && (
          <div aria-label="可选实际剧本块" className="space-y-2">
            <p className="text-xs text-muted">
              原记录 v{snapshot?.scriptVersion} · 原文档 {source.document.id} v
              {source.document.version} · {source.document.sourceFormat}
              ；不默认选择任何块。位置标注仅为原已保存字段，不证明编辑后的文件行号。
            </p>
            {source.document.blocks.map((block, index) =>
              "text" in block && block.text.trim() ? (
                <label
                  key={block.id}
                  className="block rounded-lg border border-line p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    aria-label={`选择实际剧本块 ${index + 1}`}
                    checked={blockIds.includes(block.id)}
                    onChange={(event) =>
                      setBlockIds(
                        event.target.checked
                          ? [...blockIds, block.id]
                          : blockIds.filter((id) => id !== block.id),
                      )
                    }
                  />{" "}
                  块 {index + 1} · {block.type}
                  {block.sourceLocation
                    ? ` · 保存的位置标注 ${block.sourceLocation.line}:${block.sourceLocation.column ?? "列未标"}`
                    : " · 未保存位置标注"}
                  <span className="mt-1 block whitespace-pre-wrap text-xs">
                    {block.text}
                  </span>
                </label>
              ) : null,
            )}
            <p className="text-xs text-muted">
              损失报告：{JSON.stringify(source.document.lossReport)}
            </p>
          </div>
        )}
        {sourceOnly ? (
          sourceOnly.content
        ) : (
          <>
            <label className="block text-sm">
              正式声明类型
              <select
                aria-label="正式声明类型"
                className={field}
                value={kind}
                onChange={(event) =>
                  setKind(StoryCausalNodeKindSchema.parse(event.target.value))
                }
              >
                {StoryCausalNodeKindSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              正式声明名称
              <input
                className={field}
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              作者声明解释
              <textarea
                className={field}
                maxLength={4000}
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
              />
            </label>
            {kind === "event" && (
              <StoryEventTimelineFields
                value={eventTime}
                onChange={setEventTime}
              />
            )}
          </>
        )}
        <BareButton type="submit" className={button} disabled={!canCreate}>
          {sourceOnly ? "仅保存关系认知来源候选" : "仅保存正式来源候选"}
        </BareButton>
      </fieldset>
    </form>
  );
}
