import { z } from "zod";
import {
  NarrativeContextRequestSchema,
  type NarrativeContextRequest,
} from "./narrative-context.js";

export const NarrativeScopeChapterSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const NarrativeChapterScopeSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("none"),
      chapters: z.array(NarrativeScopeChapterSchema).max(0),
    })
    .strict(),
  z
    .object({
      mode: z.literal("selection"),
      chapters: z.array(NarrativeScopeChapterSchema).min(1).max(2000),
    })
    .strict(),
  z
    .object({
      mode: z.literal("full"),
      chapters: z.array(NarrativeScopeChapterSchema).min(1).max(2000),
      directoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
]);
export type NarrativeChapterScope = z.infer<typeof NarrativeChapterScopeSchema>;

/** Shared input validation only; IDs and a fingerprint never prove an owner read. */
export function refineNarrativeSourceScope(
  request: {
    chapterScope: NarrativeChapterScope;
    context: NarrativeContextRequest;
  },
  check: z.RefinementCtx,
): void {
  const scope = request.chapterScope;
  if (
    new Set(scope.chapters.map((item) => item.id)).size !==
    scope.chapters.length
  )
    check.addIssue({
      code: "custom",
      path: ["chapterScope", "chapters"],
      message: "明确来源范围不能重复章节。",
    });
  if (
    scope.mode === "none" &&
    (request.context.chapters.length ||
      request.context.summaries?.length ||
      request.context.story?.length)
  )
    check.addIssue({
      code: "custom",
      path: ["context"],
      message:
        "不使用正文时不能附加原文、段落、摘要或来源锚定叙事声明；请另行明确范围。",
    });
  for (const [index, selected] of request.context.chapters.entries()) {
    const allowed = scope.chapters.find((item) => item.id === selected.id);
    if (!allowed || allowed.version !== selected.version)
      check.addIssue({
        code: "custom",
        path: ["context", "chapters", index],
        message: "来源表达须属于本轮明确章节范围及同一版本。",
      });
  }
}

export const NarrativeSourceScopeFields = {
  chapterScope: NarrativeChapterScopeSchema,
  context: NarrativeContextRequestSchema,
};
