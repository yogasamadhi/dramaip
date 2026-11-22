import { describe, expect, it } from "vitest";
import { findMentions, mentionCharacters } from "./character-mentions";

describe("character mentions", () => {
  const characters = mentionCharacters(
    [
      {
        id: "a",
        title: "林小雨",
        payload: { 别名: "小雨、雨姐", 角色定位: "主角" },
      },
      { id: "b", title: "小雨", payload: {} },
      { id: "c", title: "陈默", payload: { 身份背景: "退伍军人" } },
    ],
    [
      {
        title: "陈默",
        payload: { 当前状态: "旧伤复发" },
        updatedAt: "2026-01-01",
      },
      {
        title: "陈默",
        payload: { 当前状态: "守住仓库" },
        updatedAt: "2026-02-01",
      },
    ],
  );

  it("reads role, background and the latest state", () => {
    expect(characters[0]).toMatchObject({
      role: "主角",
      aliases: ["小雨", "雨姐"],
    });
    expect(characters[2]).toMatchObject({
      summary: "退伍军人",
      state: "守住仓库",
    });
  });

  it("prefers the longest name and never overlaps", () => {
    expect(findMentions("林小雨看向陈默，小雨笑了。", characters)).toEqual([
      { from: 0, to: 3, id: "a" },
      { from: 5, to: 7, id: "c" },
      { from: 8, to: 10, id: "a" },
    ]);
  });
});
