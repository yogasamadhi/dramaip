import { Agent } from "../../../vendor/pi/packages/agent/src/agent.ts";
import { McpClient } from "../../../vendor/pi/packages/mcp/src/client.ts";
import { StreamableHttpTransport } from "../../../vendor/pi/packages/mcp/src/transports/streamable-http.ts";
import { normalizeMcpInputSchema } from "../../../vendor/pi/packages/mcp/src/input-schema.ts";
import { toLlmContent } from "../../../vendor/pi/packages/mcp/src/protocol/content.ts";
import type { Tool as McpToolDefinition } from "../../../vendor/pi/packages/mcp/src/protocol/types.ts";
import { contentText } from "../../../vendor/pi/packages/ai/src/utils/text.ts";
import { SessionManager } from "../../../vendor/pi/packages/coding-agent/src/core/session-manager.ts";
import { convertToLlm } from "../../../vendor/pi/packages/coding-agent/src/core/messages.ts";
import {
  compact as compactPiSession,
  prepareCompaction,
  DEFAULT_COMPACTION_SETTINGS,
} from "../../../vendor/pi/packages/coding-agent/src/core/compaction/compaction.ts";
import { publicWebFailureMessage } from "../../../packages/contracts/src/knowledge.ts";
import type {
  AgentEvent,
  AgentTool,
  StreamFn,
} from "../../../vendor/pi/packages/agent/src/types.ts";
import {
  builtinModels,
  getBuiltinModelDataGeneratedAt,
} from "../../../vendor/pi/packages/ai/src/providers/all.ts";
import { createProvider } from "../../../vendor/pi/packages/ai/src/models.ts";
import { envApiKeyAuth } from "../../../vendor/pi/packages/ai/src/auth/helpers.ts";
import { openAICompletionsApi } from "../../../vendor/pi/packages/ai/src/api/openai-completions.lazy.ts";
import { PI_AI_VERSION } from "../../../vendor/pi/packages/ai/src/utils/version.ts";
import defaultModels from "../../../build/pi-default-models.json" with { type: "json" };
import { normalizeContext } from "../../../vendor/pi/packages/ai/src/utils/transcript.ts";
import type {
  PiTextProvider,
  PiTextRequest,
  PiTextResponse,
  PiCompactionResult,
} from "../../../packages/ai/src/pi-text-runtime.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "../../../vendor/pi/packages/ai/src/types.ts";

const models = builtinModels();
const customProviderId = "dramaip-openai-compatible";
models.setProvider(
  createProvider({
    id: customProviderId,
    auth: { apiKey: envApiKeyAuth("Custom provider API key", []) },
    models: [],
    api: openAICompletionsApi(),
  }),
);

/** Pi owns provider metadata, model catalog values, and recommendation defaults. */
export function getPiProviderCatalog() {
  return {
    release: `Pi ${PI_AI_VERSION}`,
    updatedAt: new Date(getBuiltinModelDataGeneratedAt()!)
      .toISOString()
      .slice(0, 10),
    providers: models
      .getProviders()
      .filter(
        (provider) => provider.auth.apiKey && provider.getModels().length > 0,
      )
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        protocol: "Pi",
        baseUrl: provider.baseUrl ?? provider.getModels()[0]?.baseUrl,
        sourceUrl:
          "https://github.com/earendil-works/pi/tree/v1.5.0/packages/ai",
        models: provider
          .getModels()
          .map((model) => ({
            id: model.id,
            label: model.name,
            baseUrl: model.baseUrl,
            recommended:
              model.id ===
              (defaultModels as Record<string, string>)[provider.id],
          }))
          .sort(
            (a, b) =>
              Number(b.recommended) - Number(a.recommended) ||
              a.label.localeCompare(b.label, undefined, { numeric: true }),
          ),
      })),
  };
}

export type PiProviderConfiguration = PiTextProvider;

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
  compact(): Promise<PiCompactionResult>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

type PiSessionOptions = {
  sessionId: string;
  provider: PiProviderConfiguration;
  mcp: { url: string; token: string };
};

const SYSTEM_PROMPT = [
  "你是尽意 DramaIP 智能助手中的 Pi 引擎。",
  "你只能调用当前会话提供的 DramaIP 工具；读取项目和访问公开网络均以本轮工具授权为准。",
  "禁止绕过工具直接访问 shell、文件系统、本地目录、浏览器或外部网络；这些能力没有授权，也没有提供。",
  "回答应直接、准确，并清楚区分工具返回的事实与推断。",
].join("\n");

/** Stream one tool-free model response through Pi's existing provider adapters. */
export async function streamPiText(
  request: PiTextRequest,
): Promise<PiTextResponse> {
  if (request.signal?.aborted) throw new Error("任务已取消");
  const response = await createStreamFunction(request.provider)(
    createModel(request.provider),
    normalizeContext({
      systemPrompt: request.system,
      messages: [
        { role: "user", content: request.prompt, timestamp: Date.now() },
      ],
    }),
    {
      signal: request.signal,
      ...(request.maxOutputTokens
        ? { maxTokens: request.maxOutputTokens }
        : {}),
    },
  );
  for await (const event of response) {
    if (event.type === "text_delta") request.onTextDelta?.(event.delta);
  }
  const message = await response.result();
  if (request.signal?.aborted || message.stopReason === "aborted")
    throw new Error("任务已取消");
  if (message.stopReason === "error")
    throw new Error(message.errorMessage || "Pi 模型调用未完成");
  if (message.stopReason !== "stop")
    throw new Error("Pi 模型未返回完整文本结果");
  return {
    text: contentText(message.content, ""),
    usage: {
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      cachedTokens: message.usage.cacheRead,
      inputAccounting: "excludes-cache",
    },
  };
}

export async function createPiSession(
  options: PiSessionOptions,
): Promise<PiSession> {
  const model = createModel(options.provider);
  const streamFn = createStreamFunction(options.provider);
  const mcp = new McpClient({
    name: "dramaip-pi",
    version: PI_AI_VERSION,
    protocolVersion: "2025-06-18",
  });
  let tools: McpToolDefinition[];
  try {
    await mcp.connect(
      new StreamableHttpTransport({
        url: options.mcp.url,
        headers: { Authorization: `Bearer ${options.mcp.token}` },
        openGetStream: false,
      }),
    );
    tools = await mcp.listTools();
  } catch (cause) {
    await mcp.close();
    throw cause;
  }
  const history = SessionManager.inMemory(process.cwd(), {
    id: options.sessionId,
  });
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: tools.map((tool) => mcpTool(tool, mcp)),
      thinkingLevel: "off",
    },
    sessionId: options.sessionId,
    streamFn,
    convertToLlm,
    toolExecution: "parallel",
  });
  for (const message of agent.state.messages)
    if (message.role === "system") history.appendMessage(message);

  let activeEventSink: ((event: PiRuntimeEvent) => void) | undefined;
  let text = "";
  let lastAssistant: AssistantMessage | undefined;
  let compacting: Promise<PiCompactionResult> | undefined;
  let compactionController: AbortController | undefined;
  const unsubscribe = agent.subscribe((event) => {
    if (
      event.type === "message_end" &&
      (event.message.role === "user" ||
        event.message.role === "assistant" ||
        event.message.role === "toolResult" ||
        event.message.role === "system")
    )
      history.appendMessage(event.message);
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
      if (activeEventSink || compacting)
        throw new Error("Pi 会话正在执行另一项任务");
      activeEventSink = onEvent;
      text = "";
      lastAssistant = undefined;
      try {
        await agent.prompt(prompt);
        const assistant =
          lastAssistant ??
          agent.state.messages.findLast(
            (message): message is AssistantMessage =>
              message.role === "assistant",
          );
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
        const finalText = text.trim()
          ? text
          : contentText(assistant.content, "");
        if (!finalText.trim()) throw new Error("Pi 未返回有效内容");
        return { text: finalText };
      } finally {
        activeEventSink = undefined;
      }
    },
    async abort() {
      compactionController?.abort();
      agent.abort();
      await agent.waitForIdle();
      await compacting?.catch(() => undefined);
    },
    async steer(prompt) {
      if (!prompt.trim()) throw new Error("Pi 引导消息为空");
      agent.steer({ role: "user", content: prompt, timestamp: Date.now() });
    },
    async compact() {
      if (activeEventSink || compacting)
        throw new Error("请等待当前任务完成后再压缩上下文");
      const preparation = prepareCompaction(
        history.getBranch(),
        DEFAULT_COMPACTION_SETTINGS,
      );
      if (!preparation) return { compacted: false };
      const controller = new AbortController();
      compactionController = controller;
      compacting = (async () => {
        const result = await compactPiSession(
          preparation,
          model,
          options.provider.secret,
          undefined,
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          "off",
          streamFn,
          undefined,
          undefined,
          undefined,
          options.sessionId,
        );
        if (controller.signal.aborted) throw new Error("上下文压缩已取消");
        history.appendCompaction(
          result.summary,
          result.firstKeptEntryId,
          result.tokensBefore,
          result.details,
          false,
          result.usage,
        );
        agent.state.messages = history.buildSessionContext().messages;
        return {
          compacted: true,
          tokensBefore: result.tokensBefore,
          ...(result.usage
            ? {
                usage: {
                  inputTokens: result.usage.input,
                  outputTokens: result.usage.output,
                  cachedTokens: result.usage.cacheRead,
                  inputAccounting: "excludes-cache" as const,
                },
              }
            : {}),
        };
      })();
      try {
        return await compacting;
      } finally {
        compacting = undefined;
        compactionController = undefined;
      }
    },
    async close() {
      compactionController?.abort();
      agent.abort();
      await agent.waitForIdle().catch(() => undefined);
      await compacting?.catch(() => undefined);
      unsubscribe();
      await mcp.close();
    },
  };
}

function createStreamFunction(
  configuration: PiProviderConfiguration,
): StreamFn {
  const stream: StreamFn = (
    model,
    context: TranscriptContext,
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
    return models.streamSimple(
      model,
      { messages: context.messages },
      requestOptions,
    );
  };
  return stream;
}

function createModel(configuration: PiProviderConfiguration): Model<Api> {
  if (configuration.piProviderId) {
    const model = models.getModel(
      configuration.piProviderId,
      configuration.model,
    );
    if (!model)
      throw new Error(
        `Pi 模型目录未找到 ${configuration.piProviderId}/${configuration.model}`,
      );
    if (!configuration.baseUrl)
      throw new Error("Pi 服务商缺少已授权的服务地址");
    return { ...model, baseUrl: configuration.baseUrl };
  }
  // The custom endpoint form explicitly selects one of Pi's supported wire APIs.
  const id = configuration.providerKind;
  const api =
    id === "anthropic"
      ? "anthropic-messages"
      : id === "google"
        ? "google-generative-ai"
        : "openai-completions";
  const template =
    models.getModels(id).find((model) => model.api === api) ??
    models.getModels(id)[0];
  if (!template) throw new Error(`Pi 缺少自定义服务协议 ${api}`);
  return {
    ...template,
    api,
    provider: id === "openai" ? customProviderId : id,
    id: configuration.model,
    name: configuration.model,
    baseUrl: configuration.baseUrl?.trim() || template.baseUrl,
    reasoning: false,
    ...(api === "openai-completions"
      ? {
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsStore: false,
          },
        }
      : {}),
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
        ? {
            error:
              event.toolName === "dramaip_curl"
                ? publicWebFailureMessage(
                    contentText(toLlmContent(event.result)),
                  )
                : "DramaIP 工具调用失败",
          }
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

function mcpTool(tool: McpToolDefinition, client: McpClient): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description || `调用 DramaIP 只读工具 ${tool.name}`,
    parameters: normalizeMcpInputSchema(
      tool.inputSchema,
    ) as AgentTool["parameters"],
    async execute(_toolCallId, params, signal) {
      // Pi has validated the model arguments against this tool's object schema.
      const result = await client.callTool(
        tool.name,
        params as Record<string, unknown>,
        { signal },
      );
      if (result.isError)
        throw new Error(
          contentText(toLlmContent(result)) ||
            `DramaIP 工具 ${tool.name} 调用失败`,
        );
      return {
        content: toLlmContent(result),
        details: result,
      };
    },
  };
}
