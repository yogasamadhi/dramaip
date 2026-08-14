import { expect, test } from "bun:test";
import {
  buildSegmentedTextDiff,
  changedBlockIds,
  selectedText,
} from "./segmented-text-diff";

test("段落差异支持逐段采用并保留未选原文", () => {
  const before = "第一段不变。\n\n第二段旧内容。\n\n第四段保留。";
  const after =
    "第一段不变。\n\n第二段新内容。\n\n第三段新增。\n\n第四段保留。";
  const blocks = buildSegmentedTextDiff(before, after);
  const changed = changedBlockIds(blocks);
  expect(changed.length).toBe(2);

  const onlyFirst = new Set([changed[0]!]);
  expect(selectedText(blocks, onlyFirst)).toBe(
    "第一段不变。\n\n第二段新内容。\n\n第四段保留。",
  );
  expect(selectedText(blocks, new Set(changed))).toBe(after);
});

test("相同正文不创建差异块", () => {
  expect(buildSegmentedTextDiff("同一段", "同一段")).toEqual([]);
});
