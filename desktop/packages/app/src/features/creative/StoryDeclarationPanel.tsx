import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { BareButton } from "@dramaip/ui-shared";
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

const field =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const button =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";

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
      aria-label="正式来源声明工作台"
      data-project-id={projectId}
      open={open || Boolean(declarationId)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-4 rounded-lg border border-line p-3"
    >
      <summary className="cursor-pointer text-sm">
        从实际原文或精确采用资料创建声明
      </summary>
      <p className="mt-3 text-sm text-muted">
        小说和直接剧本都是可选的独立来源。这里只锚定来源身份，作者仍需审阅解释；不会证明语义正确、改写正文或自动调用模型。
      </p>
      {!projectId && (
        <p className="mt-3 text-sm">
          先选择实际项目。没有小说章节时仍可使用下面的人工声明，不要求先写小说。
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      <label className="mt-3 block text-sm">
        声明来源类型
        <select
          aria-label="声明来源类型"
          className={field}
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
          <option value="novel">小说实际段落／精确采用资料</option>
          <option value="screenplay">直接剧本已保存块（不要求小说）</option>
        </select>
      </label>
      <BareButton
        className={`${button} mt-3`}
        disabled={!projectId || busy}
        onClick={() => {
          void cache.invalidateQueries({
            queryKey: ["story-declaration", projectId],
          });
        }}
      >
        重读实际来源与原声明
      </BareButton>
      {sourceMode === "novel" &&
        (catalogQuery.isError || detailQuery.isError) && (
          <p role="alert" className="mt-3 text-sm">
            来源读取失败：{message(catalogQuery.error ?? detailQuery.error)}
            ；旧缓存不作为当前依据。
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
          aria-label="正式来源候选表单"
          className="mt-3 space-y-3"
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
            className="space-y-3"
          >
            <label className="block text-sm">
              声明原章节
              <select
                aria-label="声明原章节"
                className={field}
                value={chapterId}
                onChange={(event) => {
                  setChapterId(event.target.value);
                  setParagraphs([]);
                  setFacts([]);
                }}
              >
                <option value="">明确选择章节，不默认选中</option>
                {catalog?.chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title} · v{chapter.version}
                    {chapter.hasContent ? "" : " · 空正文"}
                  </option>
                ))}
              </select>
            </label>
            {source && !detailQuery.isFetching && (
              <div aria-label="可选精确声明来源" className="space-y-2">
                <p className="text-xs text-muted">
                  实际版本 v{source.detail.chapter.version} ·
                  段落均不默认选择；已采用資料也只是原工作流解释。
                </p>
                {source.detail.paragraphs.map((paragraph, index) => (
                  <label
                    key={paragraph.id}
                    className="block rounded-lg border border-line p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择实际段落 ${index + 1}`}
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
                    段落 {index + 1} · 字符 {paragraph.start}–{paragraph.end}
                    <span className="mt-1 block whitespace-pre-wrap text-xs">
                      {source.chapter.content.slice(
                        paragraph.start,
                        paragraph.end,
                      )}
                    </span>
                  </label>
                ))}
                {source.detail.facts.map((fact) => (
                  <label
                    key={fact.id}
                    className="block rounded-lg border border-line p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择精确采用资料 ${fact.title}`}
                      checked={facts.includes(fact.id)}
                      onChange={(event) =>
                        setFacts(toggle(facts, fact.id, event.target.checked))
                      }
                    />{" "}
                    {fact.title} · v{fact.version}
                    <span className="mt-1 block text-xs">
                      解释：{fact.text}；原文引文：{fact.evidence.quote}
                      ；原采用运行：{fact.sourceWorkflowId}
                    </span>
                  </label>
                ))}
              </div>
            )}
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
            <BareButton type="submit" className={button} disabled={!canCreate}>
              仅保存正式来源候选
            </BareButton>
          </fieldset>
        </form>
      ) : null}
      {declarationId && (
        <section
          aria-label="原正式来源声明审阅"
          className="mt-4 rounded-lg border border-line p-3"
        >
          {originalQuery.isError ? (
            <p role="alert">
              原声明读取失败：{message(originalQuery.error)}
              ；不替换为本项目最新声明，也不允许采用旧缓存。
            </p>
          ) : !original ? (
            <p>正在读取原声明 ID…</p>
          ) : (
            <>
              <p className="text-sm">
                {original.input.title} · {original.status} · 来源{" "}
                {original.sourceStatus.state} · v{original.version}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                解释：{original.input.statement}
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
              <p className="mt-2 break-all text-xs text-muted">
                原声明 ID：{original.id}；冻结指纹：{original.basis.fingerprint}
              </p>
              {original.sourceStatus.reasons.map((reason) => (
                <p key={reason} role="alert" className="mt-2 text-sm">
                  {reason}
                </p>
              ))}
              {original.basis.sources.map((basis, index) => (
                <div
                  key={index}
                  className="mt-3 rounded-lg border border-line p-2 text-xs"
                >
                  <p className="break-all">
                    {basis.selection.kind} ·{" "}
                    {basis.selection.kind === "screenplay-blocks"
                      ? `原剧本 ${basis.selection.scriptId} v${basis.selection.scriptVersion} · 原文档 ${basis.selection.documentId} v${basis.selection.documentVersion}`
                      : `原章节 ${basis.selection.chapterId} · v${basis.selection.chapterVersion}`}
                    {basis.selection.kind === "adopted-fact"
                      ? ` · 原资料 ${basis.selection.recordId} · 原运行 ${basis.selection.workflowId}`
                      : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    冻结来源：{basis.text}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    原文引文：{basis.quote}
                  </p>
                  <p className="mt-1 break-all">
                    实际位置：
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
              <fieldset
                disabled={!canReview}
                className="mt-3 space-y-2 text-sm"
              >
                <label className="block">
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
                <label className="block">
                  <input
                    type="checkbox"
                    checked={interpretationReviewed}
                    onChange={(event) =>
                      setInterpretationReviewed(event.target.checked)
                    }
                  />{" "}
                  我已审阅声明解释；引文存在不等于解释正确
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
                  明确采用该原声明
                </BareButton>
              </fieldset>
              <BareButton
                className={`${button} mt-3`}
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
                放弃该原候选
              </BareButton>
            </>
          )}
        </section>
      )}
      {historyQuery.isError ? (
        <p role="alert" className="mt-3">
          声明历史读取失败，未展示旧缓存：{message(historyQuery.error)}
        </p>
      ) : (
        historyQuery.data && (
          <div aria-label="正式来源声明历史" className="mt-3 space-y-2 text-sm">
            <p>原声明历史（最近 20 项；不会自动选最新）</p>
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
              <p className="text-xs text-muted">
                还有历史，当前只列最近 20 项；仍可用原声明链接恢复。
              </p>
            )}
          </div>
        )
      )}
    </details>
  );
}
