import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CONVERSATIONS = 128;

export type CodexChatBridgeOptions = {
  targetBaseUrl: string;
  apiKey: string;
};

export type CodexChatBridge = {
  baseUrl: string;
  token: string;
  close(): Promise<void>;
};

type ChatMessage = Record<string, unknown>;
type Conversation = { messages: ChatMessage[] };

type FunctionCall = {
  id: string;
  name: string;
  arguments: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error(
      "Codex Chat Completions 服务地址必须是无账号密码的 HTTP 或 HTTPS 地址",
    );
  url.search = "";
  url.hash = "";
  return url;
}

function chatEndpoint(baseUrl: string): string {
  const url = normalizedBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/chat/completions`;
  return url.toString();
}

function contentToChat(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return text(value);
  return value.flatMap((part): unknown[] => {
    if (typeof part === "string") return [{ type: "text", text: part }];
    if (!part || typeof part !== "object") return [];
    const item = part as Record<string, unknown>;
    const type = text(item.type).toLowerCase();
    if (["input_text", "output_text", "text"].includes(type))
      return [{ type: "text", text: text(item.text) }];
    if (["input_image", "image_url"].includes(type)) {
      const imageUrl =
        typeof item.image_url === "string"
          ? item.image_url
          : item.image_url && typeof item.image_url === "object"
            ? text((item.image_url as Record<string, unknown>).url)
            : "";
      return imageUrl
        ? [{ type: "image_url", image_url: { url: imageUrl } }]
        : [];
    }
    return [];
  });
}

function responsesItemToMessages(item: unknown): ChatMessage[] {
  if (typeof item === "string") return [{ role: "user", content: item }];
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  const type = text(value.type);
  if (type === "input_text" || type === "output_text")
    return [{ role: "user", content: text(value.text) }];
  if (type === "message" || value.role) {
    const role = text(value.role) || "user";
    const content = contentToChat(value.content);
    return [{ role: role === "developer" ? "system" : role, content }];
  }
  if (type === "function_call_output") {
    const callId = text(value.call_id);
    if (!callId) return [];
    return [
      {
        role: "tool",
        tool_call_id: callId,
        content: outputText(value.output),
      },
    ];
  }
  if (type === "function_call") {
    const callId = text(value.call_id) || text(value.id);
    const name = text(value.name);
    if (!callId || !name) return [];
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name, arguments: text(value.arguments) },
          },
        ],
      },
    ];
  }
  return [];
}

export function responsesInputToChatMessages(
  input: unknown,
  instructions?: unknown,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (typeof instructions === "string" && instructions.trim())
    messages.push({ role: "system", content: instructions });
  else if (Array.isArray(instructions))
    for (const item of instructions)
      messages.push(...responsesItemToMessages(item));
  if (typeof input === "string")
    messages.push({ role: "user", content: input });
  else if (Array.isArray(input))
    for (const item of input) messages.push(...responsesItemToMessages(item));
  return messages;
}

export function responsesToolsToChatTools(
  input: unknown,
): unknown[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const tools = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (text(value.type) !== "function" || !text(value.name)) return [];
    return [
      {
        type: "function",
        function: {
          name: text(value.name),
          ...(text(value.description)
            ? { description: text(value.description) }
            : {}),
          parameters:
            value.parameters && typeof value.parameters === "object"
              ? value.parameters
              : { type: "object", properties: {} },
          ...(typeof value.strict === "boolean"
            ? { strict: value.strict }
            : {}),
        },
      },
    ];
  });
  return tools.length ? tools : undefined;
}

function responsesFormatToChatFormat(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const format = (value as Record<string, unknown>).format;
  if (!format || typeof format !== "object") return undefined;
  const typed = format as Record<string, unknown>;
  if (text(typed.type) === "json_schema") return { type: "json_object" };
  if (text(typed.type) === "text") return undefined;
  return undefined;
}

function responsesBodyToChat(
  body: Record<string, unknown>,
  messages: ChatMessage[],
) {
  const request: Record<string, unknown> = {
    model: text(body.model),
    messages,
    stream: body.stream === true,
  };
  const tools = responsesToolsToChatTools(body.tools);
  if (tools) request.tools = tools;
  for (const key of [
    "temperature",
    "top_p",
    "tool_choice",
    "parallel_tool_calls",
  ])
    if (body[key] !== undefined) request[key] = body[key];
  if (body.max_output_tokens !== undefined)
    request.max_tokens = body.max_output_tokens;
  const responseFormat = responsesFormatToChatFormat(body.text);
  if (responseFormat) request.response_format = responseFormat;
  return request;
}

function responseShell(
  id: string,
  model: string,
  status: string,
  output: unknown[] = [],
) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status,
    output,
  };
}

function outputMessage(id: string, content: string) {
  return {
    type: "message",
    id,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: content, annotations: [] }],
  };
}

function functionOutput(call: FunctionCall) {
  return {
    type: "function_call",
    id: call.id.startsWith("fc_")
      ? call.id
      : `fc_${call.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`,
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
    status: "completed",
  };
}

function usageFromChat(usage: unknown): Record<string, unknown> | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as Record<string, unknown>;
  const input = Number(value.prompt_tokens ?? 0);
  const output = Number(value.completion_tokens ?? 0);
  const total = Number(value.total_tokens ?? input + output);
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    total_tokens: Number.isFinite(total) ? total : 0,
  };
}

function writeEvent(
  res: ServerResponse,
  type: string,
  payload: Record<string, unknown>,
) {
  res.write(
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`,
  );
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Codex 请求超过安全大小限制");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Codex 请求格式无效");
  return parsed as Record<string, unknown>;
}

function responseError(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    writeEvent(res, "response.failed", {
      response: {
        id: `resp_${randomUUID()}`,
        object: "response",
        status: "failed",
        error: { message },
      },
    });
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({ error: { message, type: "invalid_request_error" } }),
  );
}

function targetHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "text/event-stream, application/json",
    "user-agent": "DramaIP-Codex-Chat-Bridge/1.0",
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CodexChatBridgeOptions,
  conversations: Map<string, Conversation>,
): Promise<void> {
  if (
    req.method !== "POST" ||
    !["/v1/responses", "/responses"].includes(req.url ?? "")
  ) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "Codex Chat Bridge 仅支持 POST /v1/responses" },
      }),
    );
    return;
  }
  try {
    const body = await readBody(req);
    const previousId = text(body.previous_response_id);
    const previous = previousId ? conversations.get(previousId) : undefined;
    const currentMessages = responsesInputToChatMessages(
      body.input,
      body.instructions,
    );
    const messages = [...(previous?.messages ?? []), ...currentMessages];
    if (!messages.length) throw new Error("Codex 请求缺少 input");
    const chatBody = responsesBodyToChat(body, messages);
    const upstream = await fetch(chatEndpoint(options.targetBaseUrl), {
      method: "POST",
      headers: targetHeaders(options.apiKey),
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const raw = await upstream.text();
      throw new Error(
        `Chat Completions 服务返回 HTTP ${upstream.status}${raw ? `：${raw.slice(0, 500)}` : ""}`,
      );
    }
    const responseId = `resp_bridge_${randomUUID()}`;
    if (body.stream === true) {
      await streamChatResponse(
        upstream,
        res,
        responseId,
        text(body.model),
        messages,
        conversations,
      );
      return;
    }
    const parsed = (await upstream.json()) as Record<string, unknown>;
    const choice = Array.isArray(parsed.choices)
      ? parsed.choices[0]
      : undefined;
    const message =
      choice && typeof choice === "object"
        ? (choice as Record<string, unknown>).message
        : undefined;
    const chatMessage =
      message && typeof message === "object"
        ? (message as Record<string, unknown>)
        : {};
    const content = text(chatMessage.content);
    const calls = Array.isArray(chatMessage.tool_calls)
      ? chatMessage.tool_calls.flatMap((item): FunctionCall[] => {
          if (!item || typeof item !== "object") return [];
          const call = item as Record<string, unknown>;
          const fn =
            call.function && typeof call.function === "object"
              ? (call.function as Record<string, unknown>)
              : {};
          return text(call.id) && text(fn.name)
            ? [
                {
                  id: text(call.id),
                  name: text(fn.name),
                  arguments: text(fn.arguments),
                },
              ]
            : [];
        })
      : [];
    const output = calls.length
      ? calls.map(functionOutput)
      : content
        ? [outputMessage(`msg_${randomUUID()}`, content)]
        : [];
    conversations.set(responseId, {
      messages: [
        ...messages,
        {
          role: "assistant",
          content: content || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        },
      ],
    });
    trimConversations(conversations);
    const response = responseShell(
      responseId,
      text(parsed.model) || text(body.model),
      "completed",
      output,
    );
    const usage = usageFromChat(parsed.usage);
    if (usage) (response as Record<string, unknown>).usage = usage;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (error) {
    responseError(
      res,
      502,
      error instanceof Error ? error.message : "Chat Completions 转换失败",
    );
  }
}

function trimConversations(conversations: Map<string, Conversation>): void {
  while (conversations.size > MAX_CONVERSATIONS) {
    const first = conversations.keys().next().value;
    if (typeof first !== "string") return;
    conversations.delete(first);
  }
}

async function streamChatResponse(
  upstream: Response,
  res: ServerResponse,
  responseId: string,
  model: string,
  messages: ChatMessage[],
  conversations: Map<string, Conversation>,
): Promise<void> {
  if (!upstream.body) throw new Error("Chat Completions 服务没有返回响应流");
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  const response = responseShell(responseId, model, "in_progress");
  writeEvent(res, "response.created", { response });
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = "";
  let content = "";
  let messageStarted = false;
  let responseUsage: Record<string, unknown> | undefined;
  const calls = new Map<number, FunctionCall>();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const records = buffer.split(/\r?\n\r?\n/);
    buffer = records.pop() ?? "";
    for (const record of records) {
      const data = record
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!data || data === "[DONE]") continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      responseUsage = usageFromChat(parsed.usage) ?? responseUsage;
      const choice = Array.isArray(parsed.choices)
        ? parsed.choices[0]
        : undefined;
      const delta =
        choice && typeof choice === "object"
          ? (choice as Record<string, unknown>).delta
          : undefined;
      if (!delta || typeof delta !== "object") continue;
      const deltaValue = delta as Record<string, unknown>;
      const deltaContent = text(deltaValue.content);
      if (deltaContent) {
        if (!messageStarted) {
          messageStarted = true;
          writeEvent(res, "response.output_item.added", {
            output_index: 0,
            item: {
              type: "message",
              id: "msg_bridge",
              role: "assistant",
              status: "in_progress",
              content: [],
            },
          });
          writeEvent(res, "response.content_part.added", {
            item_id: "msg_bridge",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
        }
        content += deltaContent;
        writeEvent(res, "response.output_text.delta", {
          item_id: "msg_bridge",
          output_index: 0,
          content_index: 0,
          delta: deltaContent,
        });
      }
      if (Array.isArray(deltaValue.tool_calls))
        for (const raw of deltaValue.tool_calls) {
          if (!raw || typeof raw !== "object") continue;
          const tool = raw as Record<string, unknown>;
          const index = Number(tool.index ?? 0);
          const previous = calls.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          const fn =
            tool.function && typeof tool.function === "object"
              ? (tool.function as Record<string, unknown>)
              : {};
          const call = {
            id: text(tool.id) || previous.id,
            name: text(fn.name) || previous.name,
            arguments: previous.arguments + text(fn.arguments),
          };
          calls.set(index, call);
        }
    }
  }
  const output = calls.size
    ? [...calls.values()].map(functionOutput)
    : content
      ? [outputMessage("msg_bridge", content)]
      : [];
  const finalResponse = responseShell(responseId, model, "completed", output);
  if (responseUsage)
    (finalResponse as Record<string, unknown>).usage = responseUsage;
  if (content) {
    writeEvent(res, "response.output_text.done", {
      item_id: "msg_bridge",
      output_index: 0,
      content_index: 0,
      text: content,
    });
    writeEvent(res, "response.content_part.done", {
      item_id: "msg_bridge",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: content, annotations: [] },
    });
  }
  for (const [index, item] of output.entries())
    writeEvent(res, "response.output_item.done", {
      output_index: index,
      item,
    });
  writeEvent(res, "response.completed", { response: finalResponse });
  res.end();
  conversations.set(responseId, {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: content || null,
        ...(calls.size
          ? {
              tool_calls: [...calls.values()].map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      },
    ],
  });
  trimConversations(conversations);
}

export async function startCodexChatBridge(
  options: CodexChatBridgeOptions,
): Promise<CodexChatBridge> {
  normalizedBaseUrl(options.targetBaseUrl);
  if (!options.apiKey.trim())
    throw new Error("Codex Chat Completions 适配器缺少服务商 API 密钥");
  const token = randomBytes(24).toString("base64url");
  const conversations = new Map<string, Conversation>();
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "Codex 本地适配器授权失败" } }),
      );
      return;
    }
    void handleRequest(req, res, options, conversations);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Codex 本地适配器启动失败");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    token,
    close: async () => {
      conversations.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
