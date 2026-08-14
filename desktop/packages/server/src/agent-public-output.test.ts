import assert from "node:assert/strict";
import test from "node:test";
import { collectPublicAgentText } from "./agent-public-output";

test("OpenCode 输出只保留公开文本并过滤内部运行记录", () => {
  const answer = "当然可以！下面给你三个适合新手的题材方向。";
  assert.equal(
    collectPublicAgentText({
      info: {
        id: "msg_ffdd26bee0011nPg7sItwtfTjP",
        role: "assistant",
        agent: "build",
        path: "/Users/example/opencode-sessions/session-id",
        modelID: "deepseek-v4-pro",
      },
      parts: [
        { id: "prt_start", type: "step-start" },
        {
          id: "prt_reasoning",
          type: "reasoning",
          text: "The user is asking for creative writing ideas.",
        },
        { id: "prt_text", type: "text", text: answer },
        {
          id: "prt_finish",
          type: "step-finish",
          tokens: { input: 20, output: 40 },
        },
      ],
    }),
    answer,
  );
});

test("Codex 与 LangGraph 消息封装同样只提取正式回答", () => {
  assert.equal(
    collectPublicAgentText({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "这是正式回答。" }],
        },
        { type: "reasoning", text: "不可展示的推理" },
      ],
      usage: { inputTokens: 12, outputTokens: 6 },
    }),
    "这是正式回答。",
  );
  assert.equal(
    collectPublicAgentText({
      messages: [{ type: "assistant", content: "这是 LangGraph 的正式回答。" }],
      metadata: { sessionId: "hidden" },
    }),
    "这是 LangGraph 的正式回答。",
  );
});
