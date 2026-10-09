import { describe, expect, test } from "bun:test";
import {
  NarrativePlanningOperationSchema,
  NarrativePlanningRequestSchema,
  type NarrativePlanningRequest,
} from "@dramaip/contracts/creation";

const first = { id: "d2c7aedc-8f64-4cc9-9089-8ea901392d7b", version: 2 };
const later = { id: "fd83fd2d-383c-4f7c-a08d-aa95aa433530", version: 4 };
const request = () =>
  ({
    format: "narrative-planning-v1",
    chapterScope: { mode: "selection", chapters: [first, later] },
    context: {
      format: "narrative-context-v1",
      chapters: [
        { ...first, representation: "original" },
        {
          ...later,
          representation: "paragraphs",
          paragraphIds: ["actual-p-1"],
        },
      ],
    },
  }) satisfies NarrativePlanningRequest;

describe("explicit narrative planning request contract", () => {
  test("five planning operations are independent of chapter generation", () => {
    expect(NarrativePlanningOperationSchema.options).toEqual([
      "characters",
      "book-outline",
      "chapter-outline",
      "story-arc",
      "knowledge-plan",
    ]);
    expect(NarrativePlanningOperationSchema.safeParse("chapter").success).toBe(
      false,
    );
    expect(
      NarrativePlanningOperationSchema.safeParse("creator-content").success,
    ).toBe(false);
  });

  test("blank planning explicitly has no manuscript and no fabricated target", () => {
    const value = {
      format: "narrative-planning-v1",
      chapterScope: { mode: "none", chapters: [] },
      context: { format: "narrative-context-v1", chapters: [] },
    } satisfies NarrativePlanningRequest;
    expect(NarrativePlanningRequestSchema.parse(value)).toEqual(value);
    expect(
      NarrativePlanningRequestSchema.safeParse({ ...value, targetId: first.id })
        .success,
    ).toBe(false);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...value,
        context: request().context,
      }).success,
    ).toBe(false);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...value,
        context: { ...value.context, summaries: [first] },
      }).success,
    ).toBe(false);
  });

  test("scope and actual representations are separate and preserve exact version IDs", () => {
    expect(NarrativePlanningRequestSchema.parse(request())).toEqual(request());
    const value = request();
    value.context.chapters[1]!.version--;
    expect(NarrativePlanningRequestSchema.safeParse(value).success).toBe(false);
    const outside = request();
    outside.chapterScope.chapters = [first];
    expect(NarrativePlanningRequestSchema.safeParse(outside).success).toBe(
      false,
    );
  });

  test("full scope requires a directory fingerprint; selection cannot pretend to be full", () => {
    const value = request();
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...value,
        chapterScope: { ...value.chapterScope, mode: "full" },
      }).success,
    ).toBe(false);
    const full = {
      ...value,
      chapterScope: {
        ...value.chapterScope,
        mode: "full",
        directoryFingerprint: "a".repeat(64),
      },
    } satisfies NarrativePlanningRequest;
    expect(NarrativePlanningRequestSchema.parse(full)).toEqual(full);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...full,
        chapterScope: { ...full.chapterScope, mode: "selection" },
      }).success,
    ).toBe(false);
  });

  test("empty selection, duplicate scope and repeated paragraph IDs are rejected", () => {
    const value = request();
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...value,
        chapterScope: { mode: "selection", chapters: [] },
      }).success,
    ).toBe(false);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...value,
        chapterScope: { mode: "selection", chapters: [first, first] },
      }).success,
    ).toBe(false);
    const duplicate = request();
    const paragraphs = duplicate.context.chapters[1]!;
    if (paragraphs.representation !== "paragraphs")
      throw new Error("Test fixture must select actual paragraph IDs.");
    paragraphs.paragraphIds = ["actual-p-1", "actual-p-1"];
    expect(NarrativePlanningRequestSchema.safeParse(duplicate).success).toBe(
      false,
    );
  });

  test("client text, guessed offsets and adoption claims cannot be supplied as sources", () => {
    for (const extra of [
      { content: "untrusted author text" },
      { start: 0, end: 10 },
      { adopted: true },
    ]) {
      const value = request();
      const chapters = [
        { ...value.context.chapters[0], ...extra },
        value.context.chapters[1],
      ];
      expect(
        NarrativePlanningRequestSchema.safeParse({
          ...value,
          context: { ...value.context, chapters },
        }).success,
      ).toBe(false);
    }
  });

  test("summary IDs are only a selection; author code must still read actual owner coverage", () => {
    const value = request();
    const selected = {
      ...value,
      context: { ...value.context, chapters: [], summaries: [first] },
    };
    expect(NarrativePlanningRequestSchema.parse(selected)).toEqual(selected);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...selected,
        context: { ...selected.context, summaries: [first, first] },
      }).success,
    ).toBe(false);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        ...selected,
        context: {
          ...selected.context,
          summaries: [{ ...first, coveredChapters: [later] }],
        },
      }).success,
    ).toBe(false);
  });
});
