import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NarrativeSourceBasisSchema } from "@dramaip/contracts/creation";
import { NarrativeSourceCoverage } from "./features/NarrativeSourceCoverage";
import { NarrativeQualitySourceCoverage } from "./features/NarrativeQualitySourceCoverage";

const chapter = crypto.randomUUID(),
  omitted = crypto.randomUUID(),
  empty = crypto.randomUUID();
const declaration = crypto.randomUUID(),
  node = crypto.randomUUID();
const paragraphId = "original-paragraph:/中文 anchor";
const sources = NarrativeSourceBasisSchema.parse({
  kind: "author-selected-narrative-sources",
  projectId: crypto.randomUUID(),
  chapters: [
    {
      id: chapter,
      version: 3,
      representation: "paragraphs",
      paragraphIds: [paragraphId],
      contentHash: "a".repeat(64),
    },
  ],
  summaries: [],
  story: [
    {
      selection: { kind: "declaration", id: declaration, version: 2 },
      record: { kind: "node", id: node, version: 0 },
      sourceFingerprint: "b".repeat(64),
      contentHash: "c".repeat(64),
      sourceChapters: [{ id: chapter, version: 3 }],
      sourceScripts: [],
    },
  ],
  omitted: [
    { id: omitted, version: 4, reason: "not-selected" },
    { id: empty, version: 0, reason: "empty" },
  ],
  references: [
    {
      sourceKind: "chapter",
      sourceId: chapter,
      sourceVersion: 3,
      fieldPath: `/chapters/${chapter}/paragraphs/${encodeURIComponent(paragraphId)}`,
      contentHash: "a".repeat(64),
    },
    {
      sourceKind: "knowledge",
      sourceId: declaration,
      sourceVersion: 2,
      fieldPath: `/narrative-story-index/declarations/${declaration}`,
      contentHash: "c".repeat(64),
    },
  ],
});

test("source coverage renders exact original references and omitted reasons without treating the local confirmed scope as a full book", () => {
  const before = structuredClone(sources);
  const html = renderToStaticMarkup(
    <NarrativeSourceCoverage
      basis={sources}
      chapters={[{ id: chapter, version: 3, title: "原选章" }]}
      label="测试原冻结表达"
    />,
  );
  for (const item of sources.references) {
    expect(html).toContain(item.fieldPath);
    expect(html).toContain(item.contentHash);
  }
  expect(html).toContain(omitted);
  expect(html).toContain(empty);
  expect(html).toContain("明确未选");
  expect(html).toContain("空章");
  expect(html).toContain("本冻结允许范围");
  expect(html).toContain("摘要／片段不是全文阅读");
  expect(html).toContain("不保证模型理解");
  expect(sources).toEqual(before);
});

test("quality source coverage includes the exact frozen interpretation without adding its source chapter to original prose coverage", () => {
  const html = renderToStaticMarkup(
    <NarrativeQualitySourceCoverage
      basis={{
        sourceBasis: sources,
        chapterCoverage: {
          mode: "selection",
          included: [
            {
              id: chapter,
              version: 3,
              title: "唯一已选表达",
              representations: ["paragraphs"],
            },
          ],
          excluded: [],
          totalChapterCount: 12,
          nonEmptyChapterCount: 12,
        },
      }}
    />,
  );
  expect(html).toContain("质量评议原参考内容表达");
  expect(html).toContain("所选原文段落");
  expect(html).toContain("本轮冻结叙事解释 1 条");
  expect(html).toContain(declaration);
  expect(html).toContain(node);
  expect(html).toContain("不增加整章表达覆盖");
  expect(html).not.toContain("完整原文");
  expect(html).not.toContain("12 章已读");
});

test("historical quality sources with no frozen mixed basis stay absent; missing chapter coverage is unknown rather than zero", () => {
  expect(
    renderToStaticMarkup(<NarrativeQualitySourceCoverage basis={{}} />),
  ).toBe("");
  const html = renderToStaticMarkup(
    <NarrativeQualitySourceCoverage basis={{ sourceBasis: sources }} />,
  );
  expect(html).toContain("冻结章节覆盖未提供");
  expect(html).not.toContain("0 章");
  expect(html).toContain(declaration);
});
