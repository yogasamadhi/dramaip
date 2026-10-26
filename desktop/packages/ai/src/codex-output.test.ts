import { expect, test } from "vitest";
import { normalizeCodexOutput } from "./codex-output";

test("Codex 通用聊天保留自然文本", () => {
  expect(
    normalizeCodexOutput("Codex 已恢复", {
      turnId: "turn-one",
      status: "completed",
    }),
  ).toEqual({
    summary: "Codex 已恢复",
    content: "Codex 已恢复",
    engineMetadata: {
      codex: { turnId: "turn-one", status: "completed" },
    },
  });
});

test("Codex 受控任务解析统一 JSON 封装", () => {
  expect(
    normalizeCodexOutput(
      '```json\n{"summary":"完成","content":"正文","data":{"items":[1]}}\n```',
      { status: "completed" },
    ),
  ).toEqual({
    summary: "完成",
    content: "正文",
    data: { items: [1] },
    engineMetadata: { codex: { status: "completed" } },
  });
});
