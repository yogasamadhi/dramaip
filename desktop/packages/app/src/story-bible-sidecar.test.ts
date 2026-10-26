import { expect, test } from "vitest";
import { buildStoryBibleSidecar } from "./story-bible-sidecar";

const entity = (
  id: string,
  domain: string,
  title: string,
  payload: Record<string, unknown>,
) => ({
  id,
  domain,
  projectId: "project",
  title,
  payload,
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("Story Bible 侧栏按编辑上下文聚合权威事实、草案与 stale", () => {
  const context = {
    kind: "chapter" as const,
    id: "chapter",
    title: "雨夜敲门",
    content: "林晚打开旧照片，陆沉出现在门外。",
    version: 2,
  };
  const model = buildStoryBibleSidecar({
    context,
    records: [
      entity("linwan", "characters", "林晚", { 人物目标: "查清真相" }),
      entity("event", "story-events", "旧照片线索", {
        关联章节: "雨夜敲门",
        事件描述: "照片日期异常",
      }),
      entity("other", "foreshadowings", "无关伏笔", { 关联章节: "别章" }),
      entity("lock", "visual-assets", "雨夜门口", {
        锁定状态: "已锁定",
        关联章节: "雨夜敲门",
      }),
      entity("unlocked", "visual-assets", "未定服装", {
        锁定状态: "草案",
        关联章节: "雨夜敲门",
      }),
    ],
    changeSets: [
      {
        id: "draft",
        projectId: "project",
        chapterId: "chapter",
        sourceVersion: 2,
        status: "draft",
        summary: "提取人物秘密",
        conflictNotes: [],
        preview: {
          title: "章节记忆",
          fields: [{ key: "重要事件", value: "旧照片" }],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    staleMarks: [
      {
        id: "stale",
        projectId: "project",
        chapterId: "chapter",
        reason: "正文已更新",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  expect(model.items.map((item) => item.title)).toContain("林晚");
  expect(model.items.map((item) => item.title)).toContain("旧照片线索");
  expect(model.items.map((item) => item.title)).toContain("雨夜门口");
  expect(model.items.map((item) => item.title)).not.toContain("无关伏笔");
  expect(model.items.map((item) => item.title)).not.toContain("未定服装");
  expect(
    model.items.find((item) => item.id === "change-set:draft")?.state,
  ).toBe("suggested");
  expect(model.staleMarks[0]?.reason).toBe("正文已更新");
});

test("Story Bible 侧栏支持剧本内容关联和无数据空态", () => {
  const model = buildStoryBibleSidecar({
    context: {
      kind: "script",
      id: "script",
      title: "第一集剧本",
      content: "林晚在雨夜门口发现旧照片。",
      version: 1,
    },
    records: [
      entity("linwan", "characters", "林晚", { 人物目标: "查清真相" }),
      entity("foreshadowing", "foreshadowings", "旧照片", {
        状态: "已埋设",
        伏笔说明: "照片背面有日期",
      }),
    ],
    changeSets: [],
    staleMarks: [],
  });
  expect(model.items.map((item) => item.title)).toEqual(["林晚", "旧照片"]);
  expect(model.relevantChangeSets).toEqual([]);
  expect(model.staleMarks).toEqual([]);
});
