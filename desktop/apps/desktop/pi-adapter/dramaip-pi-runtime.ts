import { Agent } from "../../../vendor/pi/packages/agent/src/agent.ts";
import type {
  AgentEvent,
  AgentTool,
  StreamFn,
} from "../../../vendor/pi/packages/agent/src/types.ts";
import { streamSimple as streamAnthropic } from "../../../vendor/pi/packages/ai/src/api/anthropic-messages.ts";
import { streamSimple as streamGoogle } from "../../../vendor/pi/packages/ai/src/api/google-generative-ai.ts";
import { streamSimple as streamOpenAI } from "../../../vendor/pi/packages/ai/src/api/openai-completions.ts";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "../../../vendor/pi/packages/ai/src/types.ts";

type PiModel =
  | Model<"openai-completions">
  | Model<"anthropic-messages">
  | Model<"google-generative-ai">;

export type PiProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};

export type PiRuntimeEvent =
  | { type: "activity"; activity: "thinking" }
  | { type: "content.delta"; delta: string }
  | {
      type: "tool";
      status: "started" | "completed" | "failed";
      tool: string;
      itemId: string;
      arguments?: unknown;
      result?: unknown;
      error?: string;
    }
  | {
      type: "usage";
      measurementScope: "response-increment";
      inputAccounting: "excludes-cache";
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
    };

export type PiSession = {
  run(
    prompt: string,
    onEvent: (event: PiRuntimeEvent) => void,
  ): Promise<{ text: string }>;
  steer(prompt: string): Promise<void>;
  compact(): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

type PiSessionOptions = {
  sessionId: string;
  provider: PiProviderConfiguration;
  mcp: { url: string; token: string };
};

type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpResponse = {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};

const SYSTEM_PROMPT = [
  "你是尽意 DramaIP 智能助手中的 Pi 引擎。",
  "你只能调用当前会话提供的 DramaIP 只读工具来读取项目上下文。",
  "不要尝试访问 shell、文件系统、本地目录、浏览器或外部网络；这些能力没有授权，也没有提供。",
  "回答应直接、准确，并清楚区分工具返回的事实与推断。",
].join("\n");

export async function createPiSession(
  options: PiSessionOptions,
): Promise<PiSession> {
  const mcp = new DramaIpMcpClient(options.mcp);
  const tools = await mcp.initialize();
  const model = createModel(options.provider);
  const streamFn = createStreamFunction(options.provider);
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: tools.map((tool) => mcpTool(tool, mcp)),
      thinkingLevel: "off",
    },
    sessionId: options.sessionId,
    streamFn,
    toolExecution: "parallel",
  });

  let activeEventSink: ((event: PiRuntimeEvent) => void) | undefined;
  let text = "";
  let lastAssistant: AssistantMessage | undefined;
  const unsubscribe = agent.subscribe((event) => {
    if (!activeEventSink) return;
    projectAgentEvent(event, activeEventSink, (delta) => {
      text += delta;
    });
    if (event.type === "message_end" && event.message.role === "assistant") {
      lastAssistant = event.message;
    }
  });

  return {
    async run(prompt, onEvent) {
      if (!prompt.trim()) throw new Error("Pi 运行提示词为空");
      if (activeEventSink) throw new Error("Pi 会话正在执行另一项任务");
      activeEventSink = onEvent;
      text = "";
      lastAssistant = undefined;
      try {
        await agent.prompt(prompt);
        const assistant =
          lastAssistant ?? findLastAssistant(agent.state.messages);
        if (!assistant) throw new Error("Pi 未返回助手消息");
        if (
          assistant.stopReason === "error" ||
          assistant.stopReason === "aborted"
        ) {
          throw new Error(assistant.errorMessage || "Pi 模型调用未完成");
        }
        if (assistant.stopReason === "length")
          throw new Error(
            "模型输出达到长度上限，未返回完整结果，请缩小创作范围后重试。",
          );
        const finalText = text.trim() ? text : assistantText(assistant);
        if (!finalText.trim()) throw new Error("Pi 未返回有效内容");
        return { text: finalText };
      } finally {
        activeEventSink = undefined;
      }
    },
    async abort() {
      agent.abort();
      await agent.waitForIdle();
    },
    async steer(prompt) {
      if (!prompt.trim()) throw new Error("Pi 引导消息为空");
      agent.steer({ role: "user", content: prompt, timestamp: Date.now() });
    },
    async compact() {
      if (activeEventSink)
        agent.steer({
          role: "user",
          content: "请在不遗漏已授权上下文的前提下压缩当前对话后继续。",
          timestamp: Date.now(),
        });
    },
    async close() {
      agent.abort();
      await agent.waitForIdle().catch(() => undefined);
      unsubscribe();
    },
  };
}

function createStreamFunction(
  configuration: PiProviderConfiguration,
): StreamFn {
  const stream: StreamFn = (
    model,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    const requestOptions: SimpleStreamOptions = {
      ...options,
      apiKey: configuration.secret,
    };
    if (
      configuration.providerKind === "openai" &&
      /^deepseek-v4-/i.test(model.id) &&
      !options?.reasoning
    ) {
      // Pi's local "off" setting alone does not disable DeepSeek V4's default
      // thinking mode: https://api-docs.deepseek.com/guides/thinking_mode/
      requestOptions.onPayload = async (payload, selectedModel) => {
        const prepared =
          (await options?.onPayload?.(payload, selectedModel)) ?? payload;
        return {
          ...(prepared as Record<string, unknown>),
          thinking: { type: "disabled" },
        };
      };
    }
    if (configuration.providerKind === "anthropic") {
      return streamAnthropic(
        model as Model<"anthropic-messages">,
        context,
        requestOptions,
      );
    }
    if (configuration.providerKind === "google") {
      return streamGoogle(
        model as Model<"google-generative-ai">,
        context,
        requestOptions,
      );
    }
    return streamOpenAI(
      model as Model<"openai-completions">,
      context,
      requestOptions,
    );
  };
  return stream;
}

function createModel(configuration: PiProviderConfiguration): PiModel {
  const baseUrl =
    configuration.baseUrl?.trim() ||
    (configuration.providerKind === "anthropic"
      ? "https://api.anthropic.com"
      : configuration.providerKind === "google"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.openai.com/v1");
  const common = {
    id: configuration.model,
    name: configuration.model,
    provider: configuration.providerKind,
    baseUrl,
    reasoning: false,
    input: ["text"] as Array<"text" | "image">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
  if (configuration.providerKind === "anthropic")
    return { ...common, api: "anthropic-messages" };
  if (configuration.providerKind === "google")
    return { ...common, api: "google-generative-ai" };
  return {
    ...common,
    api: "openai-completions",
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
    },
  };
}

function projectAgentEvent(
  event: AgentEvent,
  onEvent: (event: PiRuntimeEvent) => void,
  onText: (delta: string) => void,
): void {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "thinking_delta"
  ) {
    // Forward liveness, never the model's private reasoning text.
    onEvent({ type: "activity", activity: "thinking" });
    return;
  }
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    const delta = event.assistantMessageEvent.delta;
    onText(delta);
    onEvent({ type: "content.delta", delta });
    return;
  }
  if (event.type === "tool_execution_start") {
    onEvent({
      type: "tool",
      status: "started",
      tool: event.toolName,
      itemId: event.toolCallId,
      arguments: event.args,
    });
    return;
  }
  if (event.type === "tool_execution_end") {
    onEvent({
      type: "tool",
      status: event.isError ? "failed" : "completed",
      tool: event.toolName,
      itemId: event.toolCallId,
      ...(event.isError
        ? { error: "DramaIP 工具调用失败" }
        : { result: event.result }),
    });
    return;
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    onEvent({
      type: "usage",
      measurementScope: "response-increment",
      inputAccounting: "excludes-cache",
      inputTokens: event.message.usage.input,
      outputTokens: event.message.usage.output,
      cachedTokens: event.message.usage.cacheRead,
    });
  }
}

function mcpTool(tool: McpToolDefinition, client: DramaIpMcpClient): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description || `调用 DramaIP 只读工具 ${tool.name}`,
    parameters: (tool.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    }) as AgentTool["parameters"],
    async execute(_toolCallId, params, signal) {
      const result = await client.callTool(tool.name, params, signal);
      return {
        content: [{ type: "text", text: mcpText(result) }],
        details: result,
      };
    },
  };
}

class DramaIpMcpClient {
  private sequence = 0;
  private readonly options: { url: string; token: string };

  constructor(options: { url: string; token: string }) {
    this.options = options;
  }

  async initialize(): Promise<McpToolDefinition[]> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "dramaip-pi", version: "0.84.2" },
    });
    await this.notify("notifications/initialized", {});
    const response = await this.request("tools/list", {});
    const tools = response.tools;
    if (!Array.isArray(tools)) throw new Error("DramaIP MCP 未返回工具列表");
    return tools.filter(isMcpToolDefinition);
  }

  async callTool(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await this.request(
      "tools/call",
      { name, arguments: args },
      signal,
    );
    if (result.isError === true) {
      throw new Error(mcpText(result) || `DramaIP 工具 ${name} 调用失败`);
    }
    return result;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const id = ++this.sequence;
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal,
    });
    if (!response.ok)
      throw new Error(`DramaIP MCP 请求失败（${response.status}）`);
    const payload = (await response.json()) as McpResponse;
    if (payload.error)
      throw new Error(payload.error.message || "DramaIP MCP 请求失败");
    return payload.result ?? {};
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    if (!response.ok)
      throw new Error(`DramaIP MCP 初始化失败（${response.status}）`);
  }
}

function findLastAssistant(
  messages: readonly unknown[],
): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index];
    if (isAssistantMessage(value)) return value;
  }
  return undefined;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { role?: unknown }).role === "assistant"
  );
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter(
      (item): item is { type: "text"; text: string } => item.type === "text",
    )
    .map((item) => item.text)
    .join("");
}

function isMcpToolDefinition(value: unknown): value is McpToolDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function mcpText(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (result.structuredContent !== undefined)
    return JSON.stringify(result.structuredContent);
  return JSON.stringify(result);
}
