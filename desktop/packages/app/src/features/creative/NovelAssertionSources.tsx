import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BareButton, NativeSelect } from "@dramaip/ui-shared";
import {
  NarrativeIndexCatalogSchema,
  NarrativeIndexDetailSchema,
  type StoryDeclarationInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";

/** Reads actual novel evidence without creating an unnecessary intermediate node. */
export function NovelAssertionSources({
  projectId,
  busy,
  content,
  canSubmit,
  submit,
}: {
  projectId: string;
  busy: boolean;
  content: ReactNode;
  canSubmit: boolean;
  submit(sources: StoryDeclarationInput["sources"]): void;
}) {
  const client = useStudio();
  const [chapterId, setChapterId] = useState(""),
    [paragraphs, setParagraphs] = useState<string[]>([]),
    [facts, setFacts] = useState<string[]>([]);
  const catalog = useQuery({
    queryKey: ["story-assertion", projectId, "novel-sources"],
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const value = NarrativeIndexCatalogSchema.parse(
        await client.narrativeIndex.catalog(projectId),
      );
      if (
        value.projectId !== projectId ||
        new Set(value.chapters.map((chapter) => chapter.id)).size !==
          value.chapters.length
      )
        throw new Error("实际小说目录归属无法核对。");
      return value;
    },
  });
  const detail = useQuery({
    queryKey: ["story-assertion", projectId, "novel-source", chapterId],
    enabled: Boolean(projectId && chapterId),
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const index = NarrativeIndexDetailSchema.parse(
          await client.narrativeIndex.chapter(projectId, chapterId),
        ),
        chapter = await client.chapters.get(chapterId);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(chapter.content)),
      );
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (
        index.projectId !== projectId ||
        index.chapter.id !== chapterId ||
        chapter.id !== chapterId ||
        chapter.projectId !== projectId ||
        index.chapter.version !== chapter.version ||
        index.chapter.contentHash !== hash
      )
        throw new Error("实际小说正文与索引版本无法核对，不使用旧缓存。");
      return { index, chapter };
    },
  });
  const page = catalog.isError ? undefined : catalog.data,
    source = detail.isError ? undefined : detail.data;
  useEffect(() => {
    setParagraphs([]);
    setFacts([]);
  }, [
    chapterId,
    source?.index.fingerprint,
    source?.chapter.version,
    detail.isError,
  ]);
  const sources: StoryDeclarationInput["sources"] = source
    ? [
        ...(paragraphs.length
          ? [
              {
                kind: "paragraphs" as const,
                chapterId,
                chapterVersion: source.chapter.version,
                chapterContentHash: source.index.chapter.contentHash,
                paragraphIds: source.index.paragraphs
                  .filter((paragraph) => paragraphs.includes(paragraph.id))
                  .map((paragraph) => paragraph.id),
              },
            ]
          : []),
        ...source.index.facts
          .filter((fact) => facts.includes(fact.id))
          .map((fact) => ({
            kind: "adopted-fact" as const,
            chapterId,
            chapterVersion: source.chapter.version,
            chapterContentHash: source.index.chapter.contentHash,
            recordId: fact.id,
            recordVersion: fact.version,
            workflowId: fact.sourceWorkflowId,
          })),
      ]
    : [];
  const valid = Boolean(
    !busy &&
    canSubmit &&
    page &&
    source &&
    !catalog.isFetching &&
    !detail.isFetching &&
    sources.length &&
    source.index.paragraphs.filter((paragraph) =>
      paragraphs.includes(paragraph.id),
    ).length === paragraphs.length &&
    source.index.facts.filter((fact) => facts.includes(fact.id)).length ===
      facts.length &&
    page.chapters.some(
      (chapter) =>
        chapter.id === chapterId && chapter.version === source.chapter.version,
    ),
  );
  const toggle = (values: string[], id: string, selected: boolean) =>
    selected ? [...values, id] : values.filter((value) => value !== id);
  return (
    <form
      aria-label="关系认知小说来源表单"
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) submit(sources);
      }}
    >
      {(catalog.isError || detail.isError) && (
        <p role="alert">
          小说来源读取失败：{message(catalog.error ?? detail.error)}
          ；旧缓存不作为依据。
        </p>
      )}
      <fieldset
        disabled={busy || catalog.isError || !projectId || catalog.isFetching}
        className="space-y-3"
      >
        <label className="block text-sm">
          关系认知原章节
          <NativeSelect
            aria-label="关系认知原章节"
            className="mt-1 w-full"
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setParagraphs([]);
              setFacts([]);
            }}
          >
            <option value="">明确选择章节，不默认选中</option>
            {page?.chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title} · v{chapter.version}
              </option>
            ))}
          </NativeSelect>
        </label>
        {source && !detail.isFetching && (
          <div aria-label="关系认知实际小说来源" className="space-y-2">
            <p className="text-xs text-muted">
              原章 v{source.chapter.version}；实际段落与采用资料均不默认选择。
            </p>
            {source.index.paragraphs.map((paragraph, index) => (
              <label
                key={paragraph.id}
                className="block rounded-lg border border-line p-2 text-sm"
              >
                <input
                  type="checkbox"
                  aria-label={`关系认知选择实际段落 ${index + 1}`}
                  checked={paragraphs.includes(paragraph.id)}
                  onChange={(event) =>
                    setParagraphs(
                      toggle(paragraphs, paragraph.id, event.target.checked),
                    )
                  }
                />{" "}
                字符 {paragraph.start}–{paragraph.end}
                <span className="mt-1 block whitespace-pre-wrap text-xs">
                  {source.chapter.content.slice(paragraph.start, paragraph.end)}
                </span>
              </label>
            ))}
            {source.index.facts.map((fact) => (
              <label
                key={fact.id}
                className="block rounded-lg border border-line p-2 text-sm"
              >
                <input
                  type="checkbox"
                  aria-label={`关系认知选择精确采用资料 ${fact.title}`}
                  checked={facts.includes(fact.id)}
                  onChange={(event) =>
                    setFacts(toggle(facts, fact.id, event.target.checked))
                  }
                />{" "}
                {fact.title} · v{fact.version}
                <span className="mt-1 block text-xs">{fact.text}</span>
              </label>
            ))}
          </div>
        )}
        {content}
        <BareButton
          type="submit"
          className="rounded-lg border border-line p-2 text-sm disabled:opacity-50"
          disabled={!valid}
        >
          仅保存关系认知来源候选
        </BareButton>
      </fieldset>
    </form>
  );
}
