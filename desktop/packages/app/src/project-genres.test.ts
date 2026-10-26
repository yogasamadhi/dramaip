import { describe, expect, test } from "vitest";
import { PROJECT_GENRE_CHOICES, PROJECT_GENRE_GROUPS } from "./project-genres";

describe("项目题材目录", () => {
  test("覆盖产品规范、故事预设和常见创作方向且没有重复项", () => {
    const requiredGenres = [
      "女频复仇",
      "真假千金",
      "重生逆袭",
      "霸总追妻",
      "先婚后爱",
      "豪门恩怨",
      "赘婿打脸",
      "战神归来",
      "悬疑反转",
      "古装权谋",
      "玄学直播",
      "甜宠爽文",
      "团宠",
      "末世囤货",
      "异兽升级",
      "科幻未来",
      "武侠江湖",
    ] as const;

    expect(PROJECT_GENRE_GROUPS).toHaveLength(8);
    expect(PROJECT_GENRE_CHOICES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(PROJECT_GENRE_CHOICES).size).toBe(
      PROJECT_GENRE_CHOICES.length,
    );
    for (const genre of requiredGenres) {
      expect(PROJECT_GENRE_CHOICES).toContain(genre);
    }
  });
});
