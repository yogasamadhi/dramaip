import { Schema } from "effect";

export const MODEL_PROVIDER_CATALOG_RELEASE = "3.0.0-alpha.3";
export const MODEL_PROVIDER_CATALOG_UPDATED_AT = "2026-08-11";

export const ModelProviderPresetId = Schema.Literals([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "kimi",
  "minimax",
  "mistral",
  "xai",
  "openrouter",
]);
export type ModelProviderPresetId =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "mistral"
  | "xai"
  | "openrouter";

export const ModelProviderProtocol = Schema.Literals([
  "OpenAI 兼容文本",
  "Anthropic",
  "Google Gemini",
]);
export type ModelProviderProtocol =
  "OpenAI 兼容文本" | "Anthropic" | "Google Gemini";

export interface ModelProviderCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly recommended?: boolean;
  readonly preview?: boolean;
}

export interface ModelProviderPreset {
  readonly id: ModelProviderPresetId;
  readonly name: string;
  readonly protocol: ModelProviderProtocol;
  /** 省略时由对应官方 SDK 使用其内置固定地址。 */
  readonly baseUrl?: string;
  readonly apiKeyUrl: string;
  readonly sourceUrl: string;
  readonly models: readonly ModelProviderCatalogModel[];
}

/**
 * 随桌面版本发布的人工核验目录。这里仅列稳定或仍受官方支持的常用文本模型；
 * 连接测试返回的账户可用模型会与本目录合并，不会覆盖用户已经保存的模型。
 */
export const MODEL_PROVIDER_CATALOG: readonly ModelProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    sourceUrl: "https://developers.openai.com/api/docs/models",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", recommended: true },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "Anthropic",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    sourceUrl:
      "https://platform.claude.com/docs/en/about-claude/models/overview",
    models: [
      { id: "claude-fable-5", label: "Claude Fable 5" },
      { id: "claude-opus-5", label: "Claude Opus 5", recommended: true },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    protocol: "Google Gemini",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", recommended: true },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
      {
        id: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro（预览）",
        preview: true,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    sourceUrl: "https://api-docs.deepseek.com/updates/",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", recommended: true },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ],
  },
  {
    id: "kimi",
    name: "Kimi",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    sourceUrl: "https://platform.kimi.ai/docs/models",
    models: [
      { id: "kimi-k3", label: "Kimi K3", recommended: true },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
      { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code 高速版" },
      { id: "kimi-k2.6", label: "Kimi K2.6" },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKeyUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    sourceUrl: "https://platform.minimaxi.com/docs/api-reference/api-overview",
    models: [
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", recommended: true },
      { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 高速版" },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
      { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 高速版" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    sourceUrl: "https://docs.mistral.ai/models",
    models: [
      {
        id: "mistral-medium-latest",
        label: "Mistral Medium 最新版",
        recommended: true,
      },
      { id: "mistral-small-latest", label: "Mistral Small 最新版" },
      { id: "magistral-medium-latest", label: "Magistral Medium 最新版" },
      { id: "codestral-latest", label: "Codestral 最新版" },
    ],
  },
  {
    id: "xai",
    name: "xAI Grok",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://api.x.ai/v1",
    apiKeyUrl: "https://console.x.ai/",
    sourceUrl:
      "https://docs.x.ai/developers/rest-api-reference/inference/models",
    models: [
      { id: "grok-latest", label: "Grok 最新版", recommended: true },
      { id: "grok-4.3-latest", label: "Grok 4.3 最新版" },
      { id: "grok-420-reasoning", label: "Grok 4.20 推理版" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "OpenAI 兼容文本",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    sourceUrl: "https://openrouter.ai/docs/guides/overview/models",
    models: [
      {
        id: "~openai/gpt-latest",
        label: "OpenAI 最新旗舰模型（自动）",
        recommended: true,
      },
      { id: "anthropic/claude-fable-5", label: "Claude Fable 5" },
      { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
  },
] as const;

export function modelProviderPreset(
  id: string,
): ModelProviderPreset | undefined {
  return MODEL_PROVIDER_CATALOG.find((provider) => provider.id === id);
}

export function recommendedProviderModel(
  provider: ModelProviderPreset,
): string {
  return (
    provider.models.find((model) => model.recommended)?.id ??
    provider.models[0]?.id ??
    ""
  );
}
