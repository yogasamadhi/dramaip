import assert from "node:assert/strict";
import test from "node:test";

import { routeIntent } from "./assistant.ts";

test("assistant intent routing keeps general chat usable without a project", () => {
  assert.deepEqual(routeIntent("请接着写这一章"), {
    definition: {
      id: "chapter-continue",
      label: "续写章节",
      category: "chapter",
      write: true,
      requiresProject: true,
      requiresChapter: true,
      simple: true,
    },
    confidence: 0.9,
  });
  const uncertain = routeIntent("聊聊你对这个故事的看法");
  assert.equal(uncertain.definition.id, "general-chat");
  assert.equal(uncertain.definition.requiresProject, false);
  assert.equal(uncertain.definition.write, false);
  assert.equal(uncertain.confidence, 0.35);
});

test("explicit assistant task selection wins over local language routing", () => {
  const routed = routeIntent("帮我看看人物", "consistency");
  assert.equal(routed.definition.id, "consistency");
  assert.equal(routed.confidence, 1);
});
