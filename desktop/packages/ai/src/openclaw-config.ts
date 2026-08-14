export type OpenClawProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};

export function restrictedOpenClawConfiguration(
  mcp: { url: string },
  configuration: OpenClawProviderConfiguration,
  model: string,
  workspace: string,
): Record<string, unknown> {
  const api =
    configuration.providerKind === "anthropic"
      ? "anthropic-messages"
      : configuration.providerKind === "google"
        ? "google-generative-ai"
        : "openai-completions";
  const baseUrl =
    configuration.baseUrl ??
    (configuration.providerKind === "anthropic"
      ? "https://api.anthropic.com"
      : configuration.providerKind === "google"
        ? "https://generativelanguage.googleapis.com"
        : "https://api.openai.com/v1");
  return {
    gateway: {
      mode: "local",
      bind: "loopback",
      auth: { mode: "token" },
    },
    models: {
      mode: "replace",
      pricing: { enabled: false },
      providers: {
        dramaip: {
          baseUrl,
          apiKey: {
            source: "env",
            provider: "default",
            id: "DRAMAIP_OPENCLAW_API_KEY",
          },
          api,
          models: [{ id: model, name: model, api }],
        },
      },
    },
    agents: {
      defaults: {
        workspace,
        model: { primary: `dramaip/${model}`, fallbacks: [] },
        models: { [`dramaip/${model}`]: {} },
        sandbox: { mode: "off" },
      },
    },
    tools: {
      allow: ["bundle-mcp", "dramaip__*"],
      deny: [
        "group:runtime",
        "group:fs",
        "group:sessions",
        "group:memory",
        "group:web",
        "group:ui",
        "group:automation",
        "group:messaging",
        "group:nodes",
        "group:agents",
        "group:media",
        "skill_workshop",
      ],
      elevated: { enabled: false },
    },
    mcp: {
      sessionIdleTtlMs: 0,
      servers: {
        dramaip: {
          url: mcp.url,
          transport: "streamable-http",
          headers: { Authorization: "Bearer ${DRAMAIP_MCP_TOKEN}" },
        },
      },
    },
    plugins: { enabled: false, allow: [], deny: [] },
    skills: { allowBundled: [], load: { extraDirs: [], watch: false } },
    cron: { enabled: false },
    commands: { restart: false },
    channels: {},
  };
}
