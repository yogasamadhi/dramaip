import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "../../query";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import {
  NarrativeIndexCatalogSchema,
  NarrativeIndexDetailSchema,
  type StoryDeclarationInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";
import styles from "./NovelAssertionSources.module.css";
import { copyText } from "../../copy";

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
      aria-label={copyText("app/features/creative/NovelAssertionSources.1")}
      className={styles.c1}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) submit(sources);
      }}
    >
      {(catalog.isError || detail.isError) && (
        <p role="alert">
          {copyText("app/features/creative/NovelAssertionSources.2")}
          {message(catalog.error ?? detail.error)}
          {copyText("app/features/creative/NovelAssertionSources.3")}
        </p>
      )}
      <fieldset
        disabled={busy || catalog.isError || !projectId || catalog.isFetching}
        className={styles.c2}
      >
        <label className={styles.c3}>
          {copyText("app/features/creative/NovelAssertionSources.4")}
          <NativeSelect
            aria-label={copyText(
              "app/features/creative/NovelAssertionSources.4",
            )}
            className={styles.c4}
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setParagraphs([]);
              setFacts([]);
            }}
          >
            <option value="">
              {copyText("app/features/creative/NovelAssertionSources.5")}
            </option>
            {page?.chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
                {copyText("app/features/creative/NovelAssertionSources.6")}
                {chapter.version}
              </option>
            ))}
          </NativeSelect>
        </label>
        {source && !detail.isFetching && (
          <div
            aria-label={copyText(
              "app/features/creative/NovelAssertionSources.7",
            )}
            className={styles.c5}
          >
            <p className={styles.c6}>
              {copyText("app/features/creative/NovelAssertionSources.8")}
              {source.chapter.version}
              {copyText("app/features/creative/NovelAssertionSources.9")}
            </p>
            {source.index.paragraphs.map((paragraph, index) => (
              <label key={paragraph.id} className={styles.c7}>
                <input
                  type="checkbox"
                  aria-label={copyText(
                    "app/features/creative/NovelAssertionSources.12",
                    { p1: index + 1 },
                  )}
                  checked={paragraphs.includes(paragraph.id)}
                  onChange={(event) =>
                    setParagraphs(
                      toggle(paragraphs, paragraph.id, event.target.checked),
                    )
                  }
                />{" "}
                {copyText("app/features/creative/NovelAssertionSources.10")}
                {paragraph.start}–{paragraph.end}
                <span className={styles.c8}>
                  {source.chapter.content.slice(paragraph.start, paragraph.end)}
                </span>
              </label>
            ))}
            {source.index.facts.map((fact) => (
              <label key={fact.id} className={styles.c7}>
                <input
                  type="checkbox"
                  aria-label={copyText(
                    "app/features/creative/NovelAssertionSources.13",
                    { p1: fact.title },
                  )}
                  checked={facts.includes(fact.id)}
                  onChange={(event) =>
                    setFacts(toggle(facts, fact.id, event.target.checked))
                  }
                />{" "}
                {fact.title}
                {copyText("app/features/creative/NovelAssertionSources.6")}
                {fact.version}
                <span className={styles.c9}>{fact.text}</span>
              </label>
            ))}
          </div>
        )}
        {content}
        <BareButton type="submit" className={styles.c10} disabled={!valid}>
          {copyText("app/features/creative/NovelAssertionSources.11")}
        </BareButton>
      </fieldset>
    </form>
  );
}
