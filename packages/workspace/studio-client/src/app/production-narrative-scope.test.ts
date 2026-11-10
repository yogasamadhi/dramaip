import { expect, test } from "vitest";
import type { ProductionNarrativeRequest } from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import {
  isProductionNarrativeRequestCurrent,
  sameProductionNarrativeRequest,
} from "./production-narrative-scope";
import { planningDirectoryFingerprint } from "./narrative-planning-scope";
const first = {
  id: "c0408c9d-3ae2-40d6-870c-5a8253d9d387",
  projectId: "694e9b1d-49ad-4eee-9cd0-aad2cd8b95f1",
  version: 0,
  orderIndex: 1,
  title: "第一章",
  content: "PRIVATE actual text",
  summary: "",
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
} satisfies Chapter;
const fourth = {
  ...first,
  id: "d0c38182-d114-4134-a7a5-ec3fbc7bd78e",
  orderIndex: 4,
  title: "第四章",
};
const selection = (): ProductionNarrativeRequest => ({
  format: "production-narrative-v1",
  chapterScope: {
    mode: "selection",
    chapters: [
      { id: first.id, version: 0 },
      { id: fourth.id, version: 0 },
    ],
  },
  context: {
    format: "narrative-context-v1",
    chapters: [
      { id: first.id, version: 0, representation: "original" },
      {
        id: fourth.id,
        version: 0,
        representation: "paragraphs",
        paragraphIds: ["actual-paragraph"],
      },
    ],
  },
});
test("制作none不依赖目录，缺少／损坏协议不能退为无正文", () => {
  const none: ProductionNarrativeRequest = {
    format: "production-narrative-v1",
    chapterScope: { mode: "none", chapters: [] },
    context: { format: "narrative-context-v1", chapters: [] },
  };
  expect(isProductionNarrativeRequestCurrent(none, [], undefined)).toBe(true);
  expect(isProductionNarrativeRequestCurrent(none, [first], undefined)).toBe(
    true,
  );
  expect(
    isProductionNarrativeRequestCurrent(undefined, [first], undefined),
  ).toBe(false);
  expect(
    isProductionNarrativeRequestCurrent(
      { ...none, context: selection().context },
      [first],
      undefined,
    ),
  ).toBe(false);
});
test("制作局部绑定有序非空实际版本，不因未选增长换源", () => {
  expect(
    isProductionNarrativeRequestCurrent(
      selection(),
      [fourth, first],
      undefined,
    ),
  ).toBe(true);
  for (const chapters of [
    [first],
    [{ ...first, version: 1 }, fourth],
    [{ ...first, content: " " }, fourth],
  ])
    expect(
      isProductionNarrativeRequestCurrent(selection(), chapters, undefined),
    ).toBe(false);
  const reversed = selection();
  reversed.chapterScope.chapters.reverse();
  expect(
    isProductionNarrativeRequestCurrent(reversed, [first, fourth], undefined),
  ).toBe(false);
});
test("制作full绑定全部非空和空章目录指纹；比较保留表达、段落次序、摘要身份", async () => {
  const request = selection(),
    fingerprint = await planningDirectoryFingerprint([first, fourth]);
  request.chapterScope = {
    mode: "full",
    chapters: request.chapterScope.chapters,
    directoryFingerprint: fingerprint,
  };
  expect(
    isProductionNarrativeRequestCurrent(request, [first, fourth], fingerprint),
  ).toBe(true);
  expect(
    isProductionNarrativeRequestCurrent(
      request,
      [first, fourth],
      "a".repeat(64),
    ),
  ).toBe(false);
  const omitted = structuredClone(request);
  omitted.chapterScope.chapters.pop();
  expect(
    isProductionNarrativeRequestCurrent(omitted, [first, fourth], fingerprint),
  ).toBe(false);
  expect(sameProductionNarrativeRequest(undefined, undefined)).toBe(false);
  expect(
    sameProductionNarrativeRequest(request, structuredClone(request)),
  ).toBe(true);
  for (const change of [
    (value: ProductionNarrativeRequest) => {
      value.context.chapters[1] = {
        id: fourth.id,
        version: 0,
        representation: "original",
      };
    },
    (value: ProductionNarrativeRequest) => {
      value.context.summaries = [{ id: fourth.id, version: 1 }];
    },
    (value: ProductionNarrativeRequest) => {
      value.chapterScope.chapters[0]!.version = 1;
    },
  ]) {
    const changed = structuredClone(request);
    change(changed);
    expect(sameProductionNarrativeRequest(request, changed)).toBe(false);
  }
});
