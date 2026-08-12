import { describe, expect, test } from "bun:test";
import { completedPreviewUiState } from "./NovelChapterWorkspace";

describe("章节首稿完成后的交互状态", () => {
  test("字数越界时立即解锁三种处理按钮", () => {
    expect(completedPreviewUiState(true, true)).toEqual({
      mode: "length-decision",
      busy: false,
    });
  });

  test("字数合格的空章继续自动提交，已有正文进入可操作差异预览", () => {
    expect(completedPreviewUiState(true, false)).toEqual({
      mode: "auto-commit",
      busy: true,
    });
    expect(completedPreviewUiState(false, true)).toEqual({
      mode: "diff",
      busy: false,
    });
  });
});
