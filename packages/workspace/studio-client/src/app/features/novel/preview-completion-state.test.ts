import { describe, expect, test } from "vitest";
import {
  completedPreviewUiState,
  recommendedNovelActions,
} from "./NovelChapterWorkspace";

describe("章节首稿完成后的交互状态", () => {
  test("字数越界时立即解锁三种处理按钮", () => {
    expect(completedPreviewUiState(true, true)).toEqual({
      mode: "length-decision",
      busy: false,
    });
  });

  test("字数合格的空章和已有正文都进入可操作候选预览", () => {
    expect(completedPreviewUiState(true, false)).toEqual({
      mode: "candidate-review",
      busy: false,
    });
    expect(completedPreviewUiState(false, true)).toEqual({
      mode: "candidate-review",
      busy: false,
    });
  });

  test("空章、已有正文和选择文字各自只突出当前最需要的动作", () => {
    expect(
      recommendedNovelActions({ hasContent: false, hasSelection: false }),
    ).toEqual(["generate_chapter"]);
    expect(
      recommendedNovelActions({ hasContent: true, hasSelection: false }),
    ).toEqual(["continue_chapter", "rewrite_chapter", "polish_chapter"]);
    expect(
      recommendedNovelActions({ hasContent: true, hasSelection: true }),
    ).toEqual(["polish_chapter"]);
  });
});
