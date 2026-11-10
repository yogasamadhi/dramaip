import { describe, expect, it } from "vitest";
import { storySetupPatch } from "./creation.js";

describe("故事设定写入项目", () => {
  it("把设定字段写入项目，世界观并入梗概，不改项目名称", () => {
    const patch = storySetupPatch({
      题材类型: "都市温情",
      故事梗概: "失业程序员继承旧书店。",
      世界观与规则: "书店的旧书能映出读者的心事。",
      核心钩子: "能读心的旧书店",
      情感内核: "学会求助",
      核心卖点: "治愈",
      目标读者: "年轻上班族",
      文风指南: "温和细腻",
      title: "不应写入",
    });
    expect(patch).toEqual({
      shortDramaType: "都市温情",
      synopsis:
        "失业程序员继承旧书店。\n\n世界观与规则：书店的旧书能映出读者的心事。",
      coreHook: "能读心的旧书店",
      emotionalCore: "学会求助",
      coreSellingPoint: "治愈",
      targetAudience: "年轻上班族",
      styleGuide: "温和细腻",
    });
    expect(patch).not.toHaveProperty("title");
  });

  it("空字段不覆盖已有内容", () => {
    expect(
      storySetupPatch({ 故事梗概: "  ", 核心钩子: ["反转", "复仇"] }),
    ).toEqual({ coreHook: "反转、复仇" });
  });
});
