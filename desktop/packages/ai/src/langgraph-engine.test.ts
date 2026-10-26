import { describe, expect, test } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildLangGraphWorkflow,
  createLangGraphModel,
  parseLangGraphOutput,
  langGraphReportedUsage,
} from "./langgraph-engine";

describe("LangGraph.js stable baseline", () => {
  test("uses raw provider fields instead of SDK-synthesized zero, with explicit native cache accounting", () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: 0, reasoningTokens: undefined },
    };
    expect(
      langGraphReportedUsage({ ...usage, raw: { prompt_tokens: 0 } }, "openai"),
    ).toEqual({
      inputTokens: 0,
      outputTokens: undefined,
      cachedTokens: undefined,
      inputAccounting: "includes-cache",
    });
    expect(
      langGraphReportedUsage(
        {
          ...usage,
          raw: {
            input_tokens: 10,
            output_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
        "openai",
      ),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cachedTokens: 0,
      inputAccounting: "includes-cache",
    });
    expect(
      langGraphReportedUsage(
        { ...usage, raw: { input_tokens: 7, output_tokens: 9 } },
        "anthropic",
      ),
    ).toEqual({
      inputTokens: 7,
      outputTokens: 9,
      cachedTokens: undefined,
      inputAccounting: "excludes-cache",
    });
    expect(
      langGraphReportedUsage(
        { ...usage, raw: { promptTokenCount: 4, candidatesTokenCount: 7 } },
        "google",
      ),
    ).toEqual({
      inputTokens: 4,
      outputTokens: undefined,
      cachedTokens: undefined,
      inputAccounting: "includes-cache",
    });
    expect(
      langGraphReportedUsage(
        {
          ...usage,
          raw: {
            promptTokenCount: 4,
            candidatesTokenCount: 7,
            thoughtsTokenCount: 0,
            cachedContentTokenCount: 0,
          },
        },
        "google",
      ),
    ).toEqual({
      inputTokens: 4,
      outputTokens: 7,
      cachedTokens: 0,
      inputAccounting: "includes-cache",
    });
  });
  test("retains the explicit report of an empty completed response before rejecting its content", async () => {
    const reports: unknown[] = [];
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 0,
                  noCache: 0,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 0, text: 0, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const graph = buildLangGraphWorkflow(
      {
        providerKind: "openai",
        providerAdapter: "openai",
        model: "mock",
        secret: "not-a-key",
      },
      { responseMode: "structured", onUsage: (usage) => reports.push(usage) },
      undefined,
      model,
    );
    await expect(
      graph.invoke(
        { prompt: "empty response", retryCount: 0 },
        { recursionLimit: 8 },
      ),
    ).rejects.toThrow("没有返回内容");
    expect(reports).toEqual([
      {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: undefined,
        inputAccounting: "includes-cache",
      },
    ]);
  });
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
      text: '{"summary":"已完成","content":"正式正文","data":{"score":88}}',
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
    expect(() => parseLangGraphOutput("{}")).toThrow("模型输出缺少可展示内容");
  });

  test("preserves the complete creation envelope instead of reducing it to prose", () => {
    const candidate = {
      title: "人物方案",
      content: "人物动机说明",
      brief: "作者审阅任务书",
      items: [
        {
          ref: "hero",
          kind: "characters",
          title: "小禾",
          data: { 角色定位: "学徒" },
        },
      ],
    };
    const output = parseLangGraphOutput(JSON.stringify(candidate));
    expect(output.content).toBe(candidate.content);
    expect(JSON.parse(output.text!)).toEqual(candidate);
    expect(
      parseLangGraphOutput(JSON.stringify(candidate), "text").text,
    ).toBeUndefined();
  });

  test("accepts an issues-only check envelope and keeps evidence and severity intact", () => {
    for (const issues of [
      [],
      [
        {
          severity: "warning",
          source: "model",
          message: "时间矛盾",
          evidence: "昨天",
          location: "第二段",
          suggestion: "核对时间",
        },
      ],
    ]) {
      const check = { issues };
      const output = parseLangGraphOutput(JSON.stringify(check));
      expect(output.summary).toBe("已返回结构化结果");
      expect(JSON.parse(output.text!)).toEqual(check);
    }
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
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      inputAccounting: "includes-cache" | "excludes-cache" | "unspecified";
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
      {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: undefined,
        inputAccounting: "includes-cache",
      },
      {
        inputTokens: 20,
        outputTokens: 10,
        cachedTokens: undefined,
        inputAccounting: "includes-cache",
      },
    ]);
    expect(state.output).toEqual({
      summary: "已修复",
      content: "合法结果",
      text: '{"summary":"已修复","content":"合法结果","data":{"ok":true}}',
      data: { ok: true },
    });
  });
});
