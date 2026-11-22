import { describe, expect, it } from "vitest";
import type { WritingResource } from "@dramaip/contracts/writing";
import { chapterKeyPoints, chapterOutlineFor } from "./chapter-plan.js";

const outline = (title: string, payload: Record<string, unknown>) =>
  ({ id: title, title, payload, version: 1 }) as unknown as WritingResource;

describe("章节与章节大纲的对应", () => {
  const outlines = [
    outline("全书", { 大纲层级: "全书", 内容: "全书" }),
    outline("第二章 夜访", { 大纲层级: "章节", 排序: 2, 内容: "夜访旧书店" }),
    outline("第一章 接手", { 大纲层级: "章节", 排序: 1, 内容: "接手书店" }),
  ];

  it("按排序找到这一章的大纲", () => {
    expect(chapterOutlineFor(outlines, 1)?.title).toBe("第二章 夜访");
    expect(chapterOutlineFor(outlines, 2)).toBeUndefined();
  });

  it("章节自己没写大纲时，用章节大纲作为本章要点", () => {
    const text = chapterKeyPoints(
      { title: "第二章", hook: "门铃在午夜响起" },
      chapterOutlineFor(outlines, 1),
    );
    expect(text).toContain("本章大纲（第二章 夜访）：夜访旧书店");
    expect(text).toContain("开篇钩子：门铃在午夜响起");
    expect(chapterKeyPoints({ title: "空" }, undefined)).toBe("");
  });
});
