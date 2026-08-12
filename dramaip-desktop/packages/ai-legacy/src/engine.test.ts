import { expect, test } from "bun:test";
import { createLangGraphModel } from "./engine";

test("OpenAI 兼容服务商使用聊天补全适配器", () => {
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

test("OpenAI 兼容服务商必须配置服务地址", () => {
  expect(() =>
    createLangGraphModel({
      providerKind: "openai",
      providerAdapter: "openai-compatible",
      model: "deepseek-v4-pro",
      secret: "测试密钥",
    }),
  ).toThrow("OpenAI 兼容服务商缺少服务地址");
});
