import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { useLocation, useNavigate } from "../../router";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { StoryCausalNodeKindSchema } from "@dramaip/contracts";
import {
  NarrativeIndexCatalogSchema,
  NarrativeIndexDetailSchema,
  StoryDeclarationInputSchema,
  type StoryDeclarationInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";
import { ScreenplayDeclarationComposer } from "./ScreenplayDeclarationComposer";
import { StorySourceLifecycleReview } from "./StorySourceLifecycleReview";
import {
  emptyEventTimelineDraft,
  eventTimelineInput,
  StoryEventTimelineFields,
  StoryEventTimelineText,
} from "./StoryEventTimeline";
import styles from "./StoryDeclarationPanel.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

const field = styles.c1;
const button = styles.c2;

/** Local exact-source candidate review; never calls a model or commits manuscript text. */
export function StoryDeclarationPanel({
  projectId = "",
}: {
  projectId?: string;
}) {
  const client = useStudio(),
    cache = useQueryClient(),
    location = useLocation(),
    navigate = useNavigate();
  const declarationId =
    new URLSearchParams(location.search).get("storyDeclarationId") ?? "";
  const [open, setOpen] = useState(Boolean(declarationId)),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>();
  const [sourceMode, setSourceMode] = useState<"novel" | "screenplay">("novel");
  const [chapterId, setChapterId] = useState(""),
    [paragraphs, setParagraphs] = useState<string[]>([]),
    [facts, setFacts] = useState<string[]>([]);
  const [title, setTitle] = useState(""),
    [statement, setStatement] = useState(""),
    [kind, setKind] = useState<StoryDeclarationInput["kind"]>("event");
  const [eventTime, setEventTime] = useState(emptyEventTimelineDraft);
  const [sourceReviewed, setSourceReviewed] = useState(false),
    [interpretationReviewed, setInterpretationReviewed] = useState(false);
  const view = `${projectId}:${declarationId}`,
    active = useRef(view);
  const requests = useRef(new Map<string, string>());
  const requestKey = (action: string, input: unknown) => {
    const identity = JSON.stringify({ projectId, action, input });
    let key = requests.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      requests.current.set(identity, key);
    }
    return key;
  };
  const finishRequest = (action: string, input: unknown) =>
    requests.current.delete(JSON.stringify({ projectId, action, input }));
  active.current = view;
  useEffect(() => {
    setBusy(false);
    setNotice(undefined);
  }, [view]);
  useEffect(
    () => () => {
      active.current = "unmounted";
    },
    [],
  );
  const catalogQuery = useQuery({
    queryKey: ["story-declaration", projectId, "sources"],
    enabled: Boolean(projectId && open && sourceMode === "novel"),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const catalog = NarrativeIndexCatalogSchema.parse(
        await client.narrativeIndex.catalog(projectId),
      );
      if (
        catalog.projectId !== projectId ||
        new Set(catalog.chapters.map((chapter) => chapter.id)).size !==
          catalog.chapters.length
      )
        throw new Error("实际章节索引归属无法核对。");
      return catalog;
    },
  });
  const detailQuery = useQuery({
    queryKey: ["story-declaration", projectId, "chapter", chapterId],
    enabled: Boolean(projectId && open && chapterId && sourceMode === "novel"),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const detail = NarrativeIndexDetailSchema.parse(
          await client.narrativeIndex.chapter(projectId, chapterId),
        ),
        chapter = await client.chapters.get(chapterId);
      const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(chapter.content)),
        ),
        hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      if (
        detail.projectId !== projectId ||
        detail.chapter.id !== chapterId ||
        chapter.projectId !== projectId ||
        chapter.id !== chapterId ||
        chapter.version !== detail.chapter.version ||
        hash !== detail.chapter.contentHash
      )
        throw new Error(
          "原章节与实际索引版本无法核对，请重读来源；未换成新正文。",
        );
      return { detail, chapter };
    },
  });
  const originalQuery = useQuery({
    queryKey: ["story-declaration", projectId, "original", declarationId],
    enabled: Boolean(projectId && declarationId),
    staleTime: 0,
    retry: false,
    queryFn: () => client.storyDeclarations.get(projectId, declarationId),
  });
  const historyQuery = useQuery({
    queryKey: ["story-declaration", projectId, "history"],
    enabled: Boolean(projectId && open),
    staleTime: 0,
    retry: false,
    queryFn: () => client.storyDeclarations.list(projectId, { limit: 20 }),
  });
  const catalog = catalogQuery.isError ? undefined : catalogQuery.data,
    source = detailQuery.isError ? undefined : detailQuery.data,
    original = originalQuery.isError ? undefined : originalQuery.data;
  useEffect(() => {
    setParagraphs([]);
    setFacts([]);
  }, [
    chapterId,
    source?.detail.chapter.version,
    source?.detail.fingerprint,
    detailQuery.isError,
  ]);
  useEffect(() => {
    setSourceReviewed(false);
    setInterpretationReviewed(false);
  }, [declarationId, original?.etag, originalQuery.isError]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          (event.type.startsWith("knowledge.") ||
            event.type.startsWith("production.") ||
            event.type.startsWith("writing.")) &&
          event.payload &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          "projectId" in event.payload &&
          event.payload.projectId === projectId
        ) {
          void cache.invalidateQueries({
            queryKey: ["story-declaration", projectId],
          });
          void cache.invalidateQueries({
            queryKey: ["story-intelligence", projectId],
          });
        }
      }),
    [client, projectId, cache],
  );
  const bind = (id: string) => {
    const next = new URLSearchParams(location.search);
    next.set("projectId", projectId);
    if (id) next.set("storyDeclarationId", id);
    else next.delete("storyDeclarationId");
    navigate(
      { pathname: location.pathname, search: `?${next}` },
      { replace: true },
    );
  };
  const draft = source
    ? StoryDeclarationInputSchema.safeParse({
        kind,
        title,
        statement,
        ...eventTimelineInput(kind, eventTime),
        sources: [
          ...(paragraphs.length
            ? [
                {
                  kind: "paragraphs",
                  chapterId,
                  chapterVersion: source.detail.chapter.version,
                  chapterContentHash: source.detail.chapter.contentHash,
                  paragraphIds: source.detail.paragraphs
                    .filter((paragraph) => paragraphs.includes(paragraph.id))
                    .map((paragraph) => paragraph.id),
                },
              ]
            : []),
          ...source.detail.facts
            .filter((fact) => facts.includes(fact.id))
            .map((fact) => ({
              kind: "adopted-fact",
              chapterId,
              chapterVersion: source.detail.chapter.version,
              chapterContentHash: source.detail.chapter.contentHash,
              recordId: fact.id,
              recordVersion: fact.version,
              workflowId: fact.sourceWorkflowId,
            })),
        ],
      })
    : undefined;
  const actualChapter = catalog?.chapters.find(
    (chapter) => chapter.id === chapterId,
  );
  const canCreate = Boolean(
    projectId &&
    catalog &&
    source &&
    !busy &&
    !catalogQuery.isFetching &&
    !detailQuery.isFetching &&
    actualChapter?.version === source.detail.chapter.version &&
    actualChapter.contentHash === source.detail.chapter.contentHash &&
    draft?.success &&
    paragraphs.every((id) =>
      source.detail.paragraphs.some((paragraph) => paragraph.id === id),
    ) &&
    facts.every((id) => source.detail.facts.some((fact) => fact.id === id)),
  );
  const canReview = Boolean(
    original &&
    original.status === "pending" &&
    original.sourceStatus.state === "current" &&
    !originalQuery.isFetching &&
    !busy,
  );
  const act = async (work: () => Promise<void>) => {
    const started = view;
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
    } catch (cause) {
      if (active.current === started) setNotice(message(cause));
    } finally {
      if (active.current === started) setBusy(false);
    }
  };
  const toggle = (ids: string[], id: string, checked: boolean) =>
    checked ? [...ids, id] : ids.filter((value) => value !== id);
  const save = (input: StoryDeclarationInput) => {
    void act(async () => {
      const result = await client.storyDeclarations.create(
        projectId,
        input,
        requestKey("create", input),
      );
      finishRequest("create", input);
      if (active.current !== view) return;
      setTitle("");
      setStatement("");
      setEventTime(emptyEventTimelineDraft());
      setParagraphs([]);
      setFacts([]);
      setBusy(false);
      bind(result.id);
      await cache.invalidateQueries({
        queryKey: ["story-declaration", projectId],
      });
    });
  };
  return (
    <details
      aria-label={copyText("app/features/creative/StoryDeclarationPanel.1")}
      data-project-id={projectId}
      open={open || Boolean(declarationId)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={styles.c3}
    >
      <summary className={styles.c4}>
        {copyText("app/features/creative/StoryDeclarationPanel.2")}
      </summary>
      <p className={styles.c5}>
        {copyText("app/features/creative/StoryDeclarationPanel.3")}
      </p>
      {!projectId && (
        <p className={styles.c6}>
          {copyText("app/features/creative/StoryDeclarationPanel.4")}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.c6}>
          {notice}
        </p>
      )}
      <label className={styles.c7}>
        {copyText("app/features/creative/StoryDeclarationPanel.5")}
        <NativeSelect
          aria-label={copyText("app/features/creative/StoryDeclarationPanel.5")}
          value={sourceMode}
          disabled={busy}
          onChange={(event) => {
            setSourceMode(
              event.target.value === "screenplay" ? "screenplay" : "novel",
            );
            setChapterId("");
            setParagraphs([]);
            setFacts([]);
          }}
        >
          <option value="novel">
            {copyText("app/features/creative/StoryDeclarationPanel.6")}
          </option>
          <option value="screenplay">
            {copyText("app/features/creative/StoryDeclarationPanel.7")}
          </option>
        </NativeSelect>
      </label>
      <BareButton
        className={clsx(button, styles.c8)}
        disabled={!projectId || busy}
        onClick={() => {
          void cache.invalidateQueries({
            queryKey: ["story-declaration", projectId],
          });
        }}
      >
        {copyText("app/features/creative/StoryDeclarationPanel.8")}
      </BareButton>
      {sourceMode === "novel" &&
        (catalogQuery.isError || detailQuery.isError) && (
          <p role="alert" className={styles.c6}>
            {copyText("app/features/creative/StoryDeclarationPanel.9")}
            {message(catalogQuery.error ?? detailQuery.error)}
            {copyText("app/features/creative/StoryDeclarationPanel.10")}
          </p>
        )}
      {sourceMode === "screenplay" && (open || Boolean(declarationId)) ? (
        <ScreenplayDeclarationComposer
          key={view}
          projectId={projectId}
          busy={busy}
          save={save}
        />
      ) : sourceMode === "novel" ? (
        <form
          aria-label={copyText(
            "app/features/creative/StoryDeclarationPanel.11",
          )}
          className={styles.c9}
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || !draft?.success) return;
            save(draft.data);
          }}
        >
          <fieldset
            disabled={
              !projectId ||
              busy ||
              catalogQuery.isFetching ||
              catalogQuery.isError
            }
            className={styles.c10}
          >
            <label className={styles.c11}>
              {copyText("app/features/creative/StoryDeclarationPanel.12")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryDeclarationPanel.12",
                )}
                value={chapterId}
                onChange={(event) => {
                  setChapterId(event.target.value);
                  setParagraphs([]);
                  setFacts([]);
                }}
              >
                <option value="">
                  {copyText("app/features/creative/StoryDeclarationPanel.13")}
                </option>
                {catalog?.chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                    {copyText("app/features/creative/StoryDeclarationPanel.14")}
                    {chapter.version}
                    {chapter.hasContent ? "" : " · 空正文"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {source && !detailQuery.isFetching && (
              <div
                aria-label={copyText(
                  "app/features/creative/StoryDeclarationPanel.15",
                )}
                className={styles.c12}
              >
                <p className={styles.c13}>
                  {copyText("app/features/creative/StoryDeclarationPanel.16")}
                  {source.detail.chapter.version}
                  {copyText("app/features/creative/StoryDeclarationPanel.17")}
                </p>
                {source.detail.paragraphs.map((paragraph, index) => (
                  <label key={paragraph.id} className={styles.c14}>
                    <input
                      type="checkbox"
                      aria-label={copyText(
                        "app/features/creative/StoryDeclarationPanel.44",
                        { p1: index + 1 },
                      )}
                      checked={paragraphs.includes(paragraph.id)}
                      onChange={(event) =>
                        setParagraphs(
                          toggle(
                            paragraphs,
                            paragraph.id,
                            event.target.checked,
                          ),
                        )
                      }
                    />{" "}
                    {copyText("app/features/creative/StoryDeclarationPanel.18")}
                    {index + 1}
                    {copyText("app/features/creative/StoryDeclarationPanel.19")}
                    {paragraph.start}–{paragraph.end}
                    <span className={styles.c15}>
                      {source.chapter.content.slice(
                        paragraph.start,
                        paragraph.end,
                      )}
                    </span>
                  </label>
                ))}
                {source.detail.facts.map((fact) => (
                  <label key={fact.id} className={styles.c14}>
                    <input
                      type="checkbox"
                      aria-label={copyText(
                        "app/features/creative/StoryDeclarationPanel.45",
                        { p1: fact.title },
                      )}
                      checked={facts.includes(fact.id)}
                      onChange={(event) =>
                        setFacts(toggle(facts, fact.id, event.target.checked))
                      }
                    />{" "}
                    {fact.title}
                    {copyText("app/features/creative/StoryDeclarationPanel.14")}
                    {fact.version}
                    <span className={styles.c16}>
                      {copyText(
                        "app/features/creative/StoryDeclarationPanel.20",
                      )}
                      {fact.text}
                      {copyText(
                        "app/features/creative/StoryDeclarationPanel.21",
                      )}
                      {fact.evidence.quote}
                      {copyText(
                        "app/features/creative/StoryDeclarationPanel.22",
                      )}
                      {fact.sourceWorkflowId}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <label className={styles.c11}>
              {copyText("app/features/creative/StoryDeclarationPanel.23")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryDeclarationPanel.23",
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
            <label className={styles.c11}>
              {copyText("app/features/creative/StoryDeclarationPanel.24")}
              <input
                className={field}
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className={styles.c11}>
              {copyText("app/features/creative/StoryDeclarationPanel.25")}
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
            <BareButton type="submit" className={button} disabled={!canCreate}>
              {copyText("app/features/creative/StoryDeclarationPanel.26")}
            </BareButton>
          </fieldset>
        </form>
      ) : null}
      {declarationId && (
        <section
          aria-label={copyText(
            "app/features/creative/StoryDeclarationPanel.27",
          )}
          className={styles.c3}
        >
          {originalQuery.isError ? (
            <p role="alert">
              {copyText("app/features/creative/StoryDeclarationPanel.28")}
              {message(originalQuery.error)}
              {copyText("app/features/creative/StoryDeclarationPanel.29")}
            </p>
          ) : !original ? (
            <p>{copyText("app/features/creative/StoryDeclarationPanel.30")}</p>
          ) : (
            <>
              <p className={styles.c17}>
                {original.input.title} · {original.status}
                {copyText(
                  "app/features/creative/StoryDeclarationPanel.31",
                )}{" "}
                {original.sourceStatus.state}
                {copyText("app/features/creative/StoryDeclarationPanel.14")}
                {original.version}
              </p>
              <p className={styles.c18}>
                {copyText("app/features/creative/StoryDeclarationPanel.20")}
                {original.input.statement}
              </p>
              {original.input.eventTimeline && (
                <StoryEventTimelineText value={original.input.eventTimeline} />
              )}
              <StorySourceLifecycleReview
                key={`node:${projectId}:${original.id}`}
                kind="node"
                original={original}
                disabled={busy || originalQuery.isFetching}
                openOriginal={(id) => {
                  const search = new URLSearchParams(location.search);
                  search.set("storyDeclarationId", id);
                  navigate(`${location.pathname}?${search}`);
                }}
              />
              <p className={styles.c19}>
                {copyText("app/features/creative/StoryDeclarationPanel.32")}
                {original.id}
                {copyText("app/features/creative/StoryDeclarationPanel.33")}
                {original.basis.fingerprint}
              </p>
              {original.sourceStatus.reasons.map((reason) => (
                <p key={reason} role="alert" className={styles.c20}>
                  {reason}
                </p>
              ))}
              {original.basis.sources.map((basis, index) => (
                <div key={index} className={styles.c21}>
                  <p className={styles.c22}>
                    {basis.selection.kind} ·{" "}
                    {basis.selection.kind === "screenplay-blocks"
                      ? `原剧本 ${basis.selection.scriptId} v${basis.selection.scriptVersion} · 原文档 ${basis.selection.documentId} v${basis.selection.documentVersion}`
                      : `原章节 ${basis.selection.chapterId} · v${basis.selection.chapterVersion}`}
                    {basis.selection.kind === "adopted-fact"
                      ? ` · 原资料 ${basis.selection.recordId} · 原运行 ${basis.selection.workflowId}`
                      : ""}
                  </p>
                  <p className={styles.c23}>
                    {copyText("app/features/creative/StoryDeclarationPanel.34")}
                    {basis.text}
                  </p>
                  <p className={styles.c23}>
                    {copyText("app/features/creative/StoryDeclarationPanel.35")}
                    {basis.quote}
                  </p>
                  <p className={styles.c24}>
                    {copyText("app/features/creative/StoryDeclarationPanel.36")}
                    {basis.anchors
                      .map((anchor) =>
                        "blockId" in anchor
                          ? `实际块 ${anchor.blockId} · 顺序 ${anchor.blockIndex + 1} · ${anchor.blockType}${anchor.sourceLocation ? ` · 保存的位置标注 ${anchor.sourceLocation.line}:${anchor.sourceLocation.column ?? "列未标"}` : " · 未保存位置标注"}`
                          : `${anchor.start}–${anchor.end} [${anchor.paragraphIds.join(", ")}]`,
                      )
                      .join("；")}
                  </p>
                </div>
              ))}
              <fieldset disabled={!canReview} className={styles.c25}>
                <label className={styles.c26}>
                  <input
                    type="checkbox"
                    checked={sourceReviewed}
                    onChange={(event) =>
                      setSourceReviewed(event.target.checked)
                    }
                  />{" "}
                  {original.input.sources.some(
                    (source) => source.kind === "screenplay-blocks",
                  )
                    ? "我已核对原剧本记录／文档版本、所选实际块和保存的位置标注"
                    : "我已核对原章节版本、所选来源和实际引文位置"}
                </label>
                <label className={styles.c26}>
                  <input
                    type="checkbox"
                    checked={interpretationReviewed}
                    onChange={(event) =>
                      setInterpretationReviewed(event.target.checked)
                    }
                  />{" "}
                  {copyText("app/features/creative/StoryDeclarationPanel.37")}
                </label>
                <BareButton
                  className={button}
                  disabled={
                    !canReview || !sourceReviewed || !interpretationReviewed
                  }
                  onClick={() => {
                    if (
                      !original ||
                      !canReview ||
                      !sourceReviewed ||
                      !interpretationReviewed
                    )
                      return;
                    void act(async () => {
                      await client.storyDeclarations.adopt(
                        projectId,
                        original,
                        {
                          sourceFingerprint: original.basis.fingerprint,
                          confirmedSourceReview: true,
                          confirmedInterpretationReview: true,
                        },
                        requestKey("adopt", {
                          id: original.id,
                          etag: original.etag,
                          fingerprint: original.basis.fingerprint,
                        }),
                      );
                      finishRequest("adopt", {
                        id: original.id,
                        etag: original.etag,
                        fingerprint: original.basis.fingerprint,
                      });
                      await cache.invalidateQueries({
                        queryKey: ["story-declaration", projectId],
                      });
                      await cache.invalidateQueries({
                        queryKey: ["story-intelligence", projectId],
                      });
                      if (active.current === view)
                        setNotice(
                          "原声明已显式采用为独立节点，未改动原文；新快照仍需单独创建。",
                        );
                    });
                  }}
                >
                  {copyText("app/features/creative/StoryDeclarationPanel.38")}
                </BareButton>
              </fieldset>
              <BareButton
                className={clsx(button, styles.c8)}
                disabled={
                  busy ||
                  originalQuery.isFetching ||
                  original.status !== "pending"
                }
                onClick={() => {
                  if (original.status !== "pending") return;
                  void act(async () => {
                    await client.storyDeclarations.discard(
                      projectId,
                      original,
                      requestKey("discard", {
                        id: original.id,
                        etag: original.etag,
                      }),
                    );
                    finishRequest("discard", {
                      id: original.id,
                      etag: original.etag,
                    });
                    await cache.invalidateQueries({
                      queryKey: ["story-declaration", projectId],
                    });
                  });
                }}
              >
                {copyText("app/features/creative/StoryDeclarationPanel.39")}
              </BareButton>
            </>
          )}
        </section>
      )}
      {historyQuery.isError ? (
        <p role="alert" className={styles.c8}>
          {copyText("app/features/creative/StoryDeclarationPanel.40")}
          {message(historyQuery.error)}
        </p>
      ) : (
        historyQuery.data && (
          <div
            aria-label={copyText(
              "app/features/creative/StoryDeclarationPanel.41",
            )}
            className={styles.c25}
          >
            <p>{copyText("app/features/creative/StoryDeclarationPanel.42")}</p>
            {historyQuery.data.items.map((item) => (
              <BareButton
                key={item.id}
                className={button}
                disabled={busy || historyQuery.isFetching}
                onClick={() => bind(item.id)}
              >
                {item.title} · {item.status} · {item.sourceStatus.state}
              </BareButton>
            ))}
            {historyQuery.data.nextCursor && (
              <p className={styles.c13}>
                {copyText("app/features/creative/StoryDeclarationPanel.43")}
              </p>
            )}
          </div>
        )
      )}
    </details>
  );
}
