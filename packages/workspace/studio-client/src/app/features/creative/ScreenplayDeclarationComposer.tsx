import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "../../query";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
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
import styles from "./ScreenplayDeclarationComposer.module.css";
import { copyText } from "../../copy";

const field = styles.c1;
const button = styles.c2;

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
      aria-label={sourceOnly ? "关系认知剧本来源表单" : "正式剧本来源草稿表单"}
      className={styles.c3}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate) return;
        if (sourceOnly && selectedSource?.success)
          sourceOnly.submit([selectedSource.data]);
        else if (draft?.success) save?.(draft.data);
      }}
    >
      <p className={styles.c4}>
        {copyText("app/features/creative/ScreenplayDeclarationComposer.1")}
      </p>
      {(catalog.isError || detail.isError) && (
        <p role="alert">
          {copyText("app/features/creative/ScreenplayDeclarationComposer.2")}
          {message(catalog.error ?? detail.error)}
          {copyText("app/features/creative/ScreenplayDeclarationComposer.3")}
        </p>
      )}
      {snapshot?.source.state === "unavailable" && (
        <p role="alert">
          {copyText("app/features/creative/ScreenplayDeclarationComposer.4")}
          {snapshot.source.reason}
          {copyText("app/features/creative/ScreenplayDeclarationComposer.5")}
        </p>
      )}
      <fieldset
        disabled={!projectId || busy || catalog.isFetching || catalog.isError}
        className={styles.c5}
      >
        <label className={styles.c6}>
          {copyText("app/features/creative/ScreenplayDeclarationComposer.6")}
          <NativeSelect
            aria-label={copyText(
              "app/features/creative/ScreenplayDeclarationComposer.6",
            )}
            value={scriptId}
            onChange={(event) => {
              setScriptId(event.target.value);
              setBlockIds([]);
            }}
          >
            <option value="">
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.7",
              )}
            </option>
            {page?.items.map((item) => (
              <option key={item.scriptId} value={item.scriptId}>
                {item.title}
                {copyText(
                  "app/features/creative/ScreenplayDeclarationComposer.8",
                )}
                {item.scriptVersion}
                {item.state === "unavailable" ? " · 来源不可用" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
        {(cursor || page?.nextCursor) && (
          <div className={styles.c7}>
            {cursor && (
              <BareButton className={button} onClick={() => changePage()}>
                {copyText(
                  "app/features/creative/ScreenplayDeclarationComposer.9",
                )}
              </BareButton>
            )}
            {page?.nextCursor && (
              <BareButton
                className={button}
                onClick={() => changePage(page.nextCursor)}
              >
                {copyText(
                  "app/features/creative/ScreenplayDeclarationComposer.10",
                )}
              </BareButton>
            )}
          </div>
        )}
        {source && !detail.isFetching && (
          <div
            aria-label={copyText(
              "app/features/creative/ScreenplayDeclarationComposer.11",
            )}
            className={styles.c8}
          >
            <p className={styles.c4}>
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.12",
              )}
              {snapshot?.scriptVersion}
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.13",
              )}
              {source.document.id}
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.14",
              )}
              {source.document.version} · {source.document.sourceFormat}
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.15",
              )}
            </p>
            {source.document.blocks.map((block, index) =>
              "text" in block && block.text.trim() ? (
                <label key={block.id} className={styles.c9}>
                  <input
                    type="checkbox"
                    aria-label={copyText(
                      "app/features/creative/ScreenplayDeclarationComposer.21",
                      { p1: index + 1 },
                    )}
                    checked={blockIds.includes(block.id)}
                    onChange={(event) =>
                      setBlockIds(
                        event.target.checked
                          ? [...blockIds, block.id]
                          : blockIds.filter((id) => id !== block.id),
                      )
                    }
                  />{" "}
                  {copyText(
                    "app/features/creative/ScreenplayDeclarationComposer.16",
                  )}
                  {index + 1} · {block.type}
                  {block.sourceLocation
                    ? ` · 保存的位置标注 ${block.sourceLocation.line}:${block.sourceLocation.column ?? "列未标"}`
                    : " · 未保存位置标注"}
                  <span className={styles.c10}>{block.text}</span>
                </label>
              ) : null,
            )}
            <p className={styles.c4}>
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.17",
              )}
              {JSON.stringify(source.document.lossReport)}
            </p>
          </div>
        )}
        {sourceOnly ? (
          sourceOnly.content
        ) : (
          <>
            <label className={styles.c6}>
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.18",
              )}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/ScreenplayDeclarationComposer.18",
                )}
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
              </NativeSelect>
            </label>
            <label className={styles.c6}>
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.19",
              )}
              <input
                className={field}
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className={styles.c6}>
              {copyText(
                "app/features/creative/ScreenplayDeclarationComposer.20",
              )}
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
          {sourceOnly ? "仅保存关系认知来源候选" : "仅保存正式来源草稿"}
        </BareButton>
      </fieldset>
    </form>
  );
}
