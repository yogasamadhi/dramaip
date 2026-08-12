export const DRAMAIP_OPENCODE_PROVIDER_ID = "dramaip-agent";

export type OpenCodeProviderAdapter =
  "openai" | "openai-compatible" | "anthropic" | "google";

export type OpenCodeRuntimeProvider = {
  providerId: string;
  runtimeProviderId: string;
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: OpenCodeProviderAdapter;
  model: string;
  baseUrl?: string;
  environmentName:
    "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
  secret: string;
};

type OpenCodeMcp = { url: string; token: string } | undefined;

/**
 * 将 DramaIP 当前启用的模型注册成 OpenCode 的隔离服务商。
 * 不能把 DeepSeek 等 OpenAI 兼容接口挂到内置 `openai` 名下，否则 OpenCode
 * 会用 OpenAI 自带模型目录校验，导致真实可用的第三方模型被判定为不存在。
 */
export function createSandboxedOpenCodeConfig(
  mcp: OpenCodeMcp,
  agentProvider: OpenCodeRuntimeProvider | undefined,
): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    snapshot: false,
    formatter: false,
    lsp: false,
    permission: {
      bash: "deny",
      edit: "deny",
      read: "deny",
      glob: "deny",
      grep: "deny",
      list: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny",
      task: "deny",
      lsp: "deny",
      skill: "deny",
      question: "deny",
    },
    agent: {
      build: {
        mode: "primary",
        steps: 8,
        prompt:
          "你是 DramaIP 中文创作助手。只能使用获准的 DramaIP MCP 只读工具；禁止写文件、执行命令、读取任意本地路径、浏览网络或声称已提交修订。只返回正式分析、结构化结果和待确认建议，不得输出隐藏思维链。",
      },
    },
    ...(agentProvider
      ? {
          model: `${agentProvider.runtimeProviderId}/${agentProvider.model}`,
          enabled_providers: [agentProvider.runtimeProviderId],
          provider: {
            [agentProvider.runtimeProviderId]: {
              id: agentProvider.runtimeProviderId,
              name: "DramaIP 智能模型",
              env: [agentProvider.environmentName],
              npm: providerPackage(agentProvider.providerAdapter),
              models: {
                [agentProvider.model]: {
                  id: agentProvider.model,
                  name: agentProvider.model,
                  attachment: false,
                  reasoning: false,
                  temperature: true,
                  tool_call: true,
                  limit: { context: 128_000, output: 16_000 },
                  cost: { input: 0, output: 0 },
                  options: {},
                },
              },
              options: agentProvider.baseUrl
                ? { baseURL: agentProvider.baseUrl }
                : {},
            },
          },
        }
      : {}),
    ...(mcp
      ? {
          mcp: {
            dramaip: {
              type: "remote",
              url: mcp.url,
              headers: { Authorization: `Bearer ${mcp.token}` },
              oauth: false,
            },
          },
        }
      : {}),
  };
}

function providerPackage(adapter: OpenCodeProviderAdapter): string {
  if (adapter === "anthropic") return "@ai-sdk/anthropic";
  if (adapter === "google") return "@ai-sdk/google";
  if (adapter === "openai") return "@ai-sdk/openai";
  return "@ai-sdk/openai-compatible";
}
