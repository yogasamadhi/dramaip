import assert from "node:assert/strict";
import test from "node:test";
import { routeAssistantIntent } from "./assistant-intent";

test("快捷任务不经过分类且缺章节时只追问", () => {
  assert.deepEqual(
    routeAssistantIntent({
      message: "开始吧",
      explicitTaskType: "polish_chapter",
      hasProject: true,
      hasChapter: false,
    }),
    {
      kind: "clarify",
      confidence: 1,
      source: "shortcut",
      explanation: "请先打开或选择一个章节。",
      clarification: "请先打开或选择一个章节。",
    },
  );
});

test("明确自然语言确定性路由为受控创作任务", () => {
  const route = routeAssistantIntent({
    message: "把这章润色一下，减少重复表达",
    hasProject: true,
    hasChapter: true,
  });
  assert.equal(route.kind, "task");
  assert.equal(route.taskType, "polish_chapter");
  assert.equal(route.source, "deterministic");
});

test("低置信度自由文本安全降级为只读聊天", () => {
  const route = routeAssistantIntent({
    message: "你觉得这个人物可爱吗",
    hasProject: false,
    hasChapter: false,
  });
  assert.equal(route.kind, "chat");
  assert.equal(route.taskType, "chat_project");
  assert.equal(route.source, "fallback");
});
