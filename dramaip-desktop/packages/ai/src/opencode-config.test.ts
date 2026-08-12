import { expect, test } from "bun:test";
import {
  createSandboxedOpenCodeConfig,
  DRAMAIP_OPENCODE_PROVIDER_ID,
  type OpenCodeRuntimeProvider,
} from "./opencode-config";

function provider(
  adapter: OpenCodeRuntimeProvider["providerAdapter"] = "openai-compatible",
): OpenCodeRuntimeProvider {
  return {
    providerId: "database-provider-id",
    runtimeProviderId: DRAMAIP_OPENCODE_PROVIDER_ID,
    providerKind: adapter === "anthropic" ? "anthropic" : "openai",
    providerAdapter: adapter,
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    environmentName: "OPENAI_API_KEY",
    secret: "不得进入配置的测试密钥",
  };
}

test("OpenAI 兼容模型使用隔离服务商注册，不借用 OpenAI 模型目录", () => {
  const config = createSandboxedOpenCodeConfig(undefined, provider());
  expect(config.model).toBe("dramaip-agent/deepseek-v4-pro");
  const runtime = (config.provider as Record<string, Record<string, unknown>>)[
    DRAMAIP_OPENCODE_PROVIDER_ID
  ];
  expect(runtime.npm).toBe("@ai-sdk/openai-compatible");
  expect(runtime.models).toHaveProperty("deepseek-v4-pro");
  expect(runtime.options).toEqual({ baseURL: "https://api.deepseek.com" });
  expect(JSON.stringify(config)).not.toContain("不得进入配置的测试密钥");
});

test("原生协议服务商使用对应 AI SDK 适配器", () => {
  for (const [adapter, npm] of [
    ["openai", "@ai-sdk/openai"],
    ["anthropic", "@ai-sdk/anthropic"],
    ["google", "@ai-sdk/google"],
  ] as const) {
    const config = createSandboxedOpenCodeConfig(undefined, provider(adapter));
    const runtime = (
      config.provider as Record<string, Record<string, unknown>>
    )[DRAMAIP_OPENCODE_PROVIDER_ID];
    expect(runtime.npm).toBe(npm);
  }
});
