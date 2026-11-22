import { describe, expect, it } from "vitest";
import {
  chapterNumber,
  openingFixInstruction,
  parseOpeningIssues,
} from "./opening-check";

describe("opening check report", () => {
  it("reads chapter numbers", () => {
    expect(chapterNumber("3")).toBe(3);
    expect(chapterNumber("十二")).toBe(12);
    expect(chapterNumber("二十")).toBe(20);
    expect(chapterNumber("一百零三")).toBe(103);
    expect(chapterNumber("某")).toBeUndefined();
  });

  it("parses numbered problems with quote and suggestion", () => {
    const issues = parseOpeningIssues(
      [
        "开篇节奏偏慢，主角目标出现太晚。",
        "",
        "1. 【第一章】前三段没有冲突",
        "原文：「清晨的阳光洒在窗台上，林小雨伸了个懒腰。」",
        "建议：直接从停电那一刻开场，",
        "让危机先出现。",
        "2. **【第3章】章末没有钩子**",
        "- **原文**：“她关上了门。”",
        "- **建议**：结尾加入门外的敲门声。",
        "3. 【第2章】只有问题没有建议",
        "原文：「略」",
      ].join("\n"),
    );
    expect(issues).toEqual([
      {
        chapter: 1,
        summary: "前三段没有冲突",
        quote: "清晨的阳光洒在窗台上，林小雨伸了个懒腰。",
        suggestion: "直接从停电那一刻开场，\n让危机先出现。",
      },
      {
        chapter: 3,
        summary: "章末没有钩子",
        quote: "她关上了门。",
        suggestion: "结尾加入门外的敲门声。",
      },
    ]);
    expect(openingFixInstruction(issues[0]!)).toBe(
      "只修改以下问题：前三段没有冲突。直接从停电那一刻开场，\n让危机先出现。\n原文：「清晨的阳光洒在窗台上，林小雨伸了个懒腰。」\n其余内容保持不变。",
    );
  });
});
