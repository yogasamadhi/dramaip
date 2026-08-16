import assert from "node:assert/strict";
import test from "node:test";

import { paragraphChoices, paragraphDiff } from "./ui.tsx";

test("paragraph diff preserves stable segments and exposes selective candidates", () => {
  const choices = paragraphChoices(
    "第一段\n\n旧第二段\n\n第三段",
    "第一段\n\n新第二段",
  );
  assert.deepEqual(choices, [
    {
      index: 0,
      current: "第一段",
      candidate: "第一段",
      changed: false,
    },
    {
      index: 1,
      current: "旧第二段",
      candidate: "新第二段",
      changed: true,
    },
    { index: 2, current: "第三段", candidate: undefined, changed: true },
  ]);
  assert.deepEqual(
    paragraphDiff("第一段\n\n旧第二段", "第一段\n\n新第二段").map(
      (item) => item.kind,
    ),
    ["same", "removed", "added"],
  );
});
