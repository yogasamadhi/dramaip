import { describe, it, expect } from "vitest";
import { mergeChapterText } from "./text-merge.js";
describe("conservative chapter text merge", () => {
  it("preserves independent user additions and model edits", () => {
    const result = mergeChapterText(
      "开门。\n街道很静。\n离开。",
      "新增观察。\n开门。\n街道很静。\n离开。",
      "开门。\n街道很静。\n转身离开。",
    );
    expect(result.some((item) => item.conflict)).toBe(false);
    expect(result.map((item) => item.content).join("")).toBe(
      "新增观察。\n开门。\n街道很静。\n转身离开。",
    );
  });
  it("requires an explicit choice for competing rewrites", () => {
    const result = mergeChapterText("开门。", "关门。", "敲门。");
    expect(result[0]).toMatchObject({
      base: "开门。",
      current: "关门。",
      candidate: "敲门。",
      conflict: true,
      content: "",
    });
  });
  it("does not guess the identity of repeated paragraphs", () => {
    const result = mergeChapterText(
      "雨声。\n雨声。\n",
      "第一处新输入。\n雨声。\n",
      "雨声。\n第二处修订。\n",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.conflict).toBe(true);
  });
  it("retains current text when the candidate is unchanged", () => {
    expect(mergeChapterText("旧正文", "用户新增", "旧正文")[0]?.content).toBe(
      "用户新增",
    );
  });
});
