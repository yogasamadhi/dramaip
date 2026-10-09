import { expect, test } from "bun:test";
import {
  narrativePlanningDirectory,
  type NarrativePlanningRequest,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import {
  isPlanningRequestCurrent,
  planningDirectoryFingerprint,
  samePlanningRequest,
} from "./narrative-planning-scope";

const chapter = (id: string, orderIndex: number, content: string) =>
  ({
    id,
    version: 0,
    orderIndex,
    content,
    projectId: "694e9b1d-49ad-4eee-9cd0-aad2cd8b95f1",
    title: `章${orderIndex}`,
    summary: "",
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  }) satisfies Chapter;
const first = chapter(
    "c0408c9d-3ae2-40d6-870c-5a8253d9d387",
    1,
    "PRIVATE first",
  ),
  later = chapter("d0c38182-d114-4134-a7a5-ec3fbc7bd78e", 2, "PRIVATE later");
const selected = (): NarrativePlanningRequest => ({
  format: "narrative-planning-v1",
  chapterScope: {
    mode: "selection",
    chapters: [{ id: first.id, version: first.version }],
  },
  context: {
    format: "narrative-context-v1",
    chapters: [
      { id: first.id, version: first.version, representation: "original" },
    ],
  },
});

test("planning fingerprint encodes sorted actual metadata only, including empty entries", async () => {
  const empty = chapter("c3a642d9-22e4-444a-8b78-38c235d91426", 3, " ");
  expect(
    narrativePlanningDirectory([later, empty, first]).map((item) => item.id),
  ).toEqual([first.id, later.id, empty.id]);
  expect(
    JSON.stringify(narrativePlanningDirectory([first, later])),
  ).not.toContain("PRIVATE");
  expect(await planningDirectoryFingerprint([later, first])).toBe(
    await planningDirectoryFingerprint([first, later]),
  );
  expect(await planningDirectoryFingerprint([first, later, empty])).not.toBe(
    await planningDirectoryFingerprint([first, later]),
  );
});

test("explicit no-manuscript works with blank or populated projects and never defaults an absent request", () => {
  const none: NarrativePlanningRequest = {
    format: "narrative-planning-v1",
    chapterScope: { mode: "none", chapters: [] },
    context: { format: "narrative-context-v1", chapters: [] },
  };
  expect(isPlanningRequestCurrent(undefined, [first], undefined)).toBe(false);
  expect(isPlanningRequestCurrent(none, [], undefined)).toBe(true);
  expect(isPlanningRequestCurrent(none, [first], undefined)).toBe(true);
});

test("selected metadata ignores unselected growth but refuses stale, foreign, reordered or empty sources", () => {
  expect(isPlanningRequestCurrent(selected(), [first, later], undefined)).toBe(
    true,
  );
  expect(isPlanningRequestCurrent(selected(), [first], undefined)).toBe(true);
  expect(
    isPlanningRequestCurrent(selected(), [{ ...first, version: 1 }], undefined),
  ).toBe(false);
  expect(isPlanningRequestCurrent(selected(), [later], undefined)).toBe(false);
  expect(
    isPlanningRequestCurrent(
      selected(),
      [{ ...first, content: "" }],
      undefined,
    ),
  ).toBe(false);
  const reversed = selected();
  reversed.chapterScope = {
    mode: "selection",
    chapters: [
      { id: later.id, version: 0 },
      { id: first.id, version: 0 },
    ],
  };
  expect(isPlanningRequestCurrent(reversed, [first, later], undefined)).toBe(
    false,
  );
});

test("full scope binds every nonempty chapter and the exact complete directory fingerprint", async () => {
  const fingerprint = await planningDirectoryFingerprint([first, later]);
  const request = selected();
  request.chapterScope = {
    mode: "full",
    directoryFingerprint: fingerprint,
    chapters: [
      { id: first.id, version: 0 },
      { id: later.id, version: 0 },
    ],
  };
  expect(isPlanningRequestCurrent(request, [first, later], fingerprint)).toBe(
    true,
  );
  expect(
    isPlanningRequestCurrent(request, [first, later], "a".repeat(64)),
  ).toBe(false);
  request.chapterScope.chapters.pop();
  expect(isPlanningRequestCurrent(request, [first, later], fingerprint)).toBe(
    false,
  );
});

test("request identity separates scope, version, actual expression and higher-summary identity", () => {
  const request = selected();
  expect(samePlanningRequest(undefined, undefined)).toBe(false);
  expect(samePlanningRequest(request, structuredClone(request))).toBe(true);
  const changed = selected();
  changed.context.chapters = [
    {
      id: first.id,
      version: 0,
      representation: "paragraphs",
      paragraphIds: ["actual-paragraph"],
    },
  ];
  expect(samePlanningRequest(request, changed)).toBe(false);
  const higher = selected();
  higher.context.summaries = [{ id: later.id, version: 0 }];
  expect(samePlanningRequest(request, higher)).toBe(false);
});
