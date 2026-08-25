import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildLangGraphWorkflow,
  createLangGraphModel,
  parseLangGraphOutput,
} from "./langgraph-engine";

describe("LangGraph.js stable baseline", () => {
  test("creates the pinned OpenAI-compatible model adapter", () => {
    const model = createLangGraphModel({
      providerKind: "openai",
      providerAdapter: "openai-compatible",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com",
      secret: "测试密钥",
    });
    const runtime = model as unknown as { modelId: string; provider: string };
    expect(runtime.modelId).toBe("deepseek-v4-pro");
    expect(runtime.provider).toBe("dramaip-langgraph.chat");
  });

  test("requires a base URL for OpenAI-compatible providers", () => {
    expect(() =>
      createLangGraphModel({
        providerKind: "openai",
        providerAdapter: "openai-compatible",
        model: "deepseek-v4-pro",
        secret: "测试密钥",
      }),
    ).toThrow("OpenAI 兼容服务商缺少服务地址");
  });

  test("creates adapters for all four supported provider modes", () => {
    const models = [
      createLangGraphModel({
        providerKind: "openai",
        providerAdapter: "openai",
        model: "gpt-5",
        secret: "not-persisted",
      }),
      createLangGraphModel({
        providerKind: "openai",
        providerAdapter: "openai-compatible",
        model: "deepseek-chat",
        baseUrl: "https://model.example.test/v1",
        secret: "not-persisted",
      }),
      createLangGraphModel({
        providerKind: "anthropic",
        providerAdapter: "anthropic",
        model: "claude-test",
        secret: "not-persisted",
      }),
      createLangGraphModel({
        providerKind: "google",
        providerAdapter: "google",
        model: "gemini-test",
        secret: "not-persisted",
      }),
    ];

    expect(models.map((model) => model.provider)).toEqual([
      "openai.responses",
      "dramaip-langgraph.chat",
      "anthropic.messages",
      "google.generative-ai",
    ]);
  });

  test("text mode accepts natural language without a JSON repair", () => {
    const content = "你好！我可以协助梳理故事结构。";
    expect(parseLangGraphOutput(content, "text")).toEqual({
      summary: content,
      content,
    });
  });

  test("structured mode extracts fenced JSON and preserves data", () => {
    expect(
      parseLangGraphOutput(`说明文字

\`\`\`json
{"summary":"已完成","content":"正式正文","data":{"score":88}}
\`\`\``),
    ).toEqual({
      summary: "已完成",
      content: "正式正文",
      data: { score: 88 },
    });
  });

  test("structured mode rejects malformed and scalar output", () => {
    expect(() => parseLangGraphOutput("未封装正文")).toThrow(
      "模型输出无法解析为 JSON",
    );
    expect(() => parseLangGraphOutput('"JSON 字符串"')).toThrow(
      "模型输出必须是 JSON 对象",
    );
  });

  test("repairs structured output once, suppresses repair deltas and reports both usages", async () => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        const text =
          calls === 1
            ? "这不是结构化结果"
            : '{"summary":"已修复","content":"合法结果","data":{"ok":true}}';
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: `text-${calls}` },
              { type: "text-delta", id: `text-${calls}`, delta: text },
              { type: "text-end", id: `text-${calls}` },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: {
                    total: calls * 10,
                    noCache: calls * 10,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: {
                    total: calls * 5,
                    text: calls * 5,
                    reasoning: undefined,
                  },
                },
              },
            ],
          }),
        };
      },
    });
    const deltas: string[] = [];
    const usages: Array<{
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
    }> = [];
    const graph = buildLangGraphWorkflow(
      {
        providerKind: "openai",
        providerAdapter: "openai",
        model: "mock",
        secret: "not-persisted",
      },
      {
        responseMode: "structured",
        onTextDelta: (delta) => deltas.push(delta),
        onUsage: (usage) => usages.push(usage),
      },
      undefined,
      model,
    );

    const state = await graph.invoke(
      { prompt: "返回结构化结果", retryCount: 0 },
      { recursionLimit: 8 },
    );

    expect(calls).toBe(2);
    expect(deltas).toEqual(["这不是结构化结果"]);
    expect(usages).toEqual([
      { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
      { inputTokens: 20, outputTokens: 10, cachedTokens: 0 },
    ]);
    expect(state.output).toEqual({
      summary: "已修复",
      content: "合法结果",
      data: { ok: true },
    });
  });
});
