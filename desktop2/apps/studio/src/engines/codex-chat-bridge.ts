import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CONVERSATIONS = 128;

export interface CodexChatBridgeOptions {
  targetBaseUrl: string;
  apiKey: string;
}

export interface CodexChatBridge {
  baseUrl: string;
  token: string;
  close(): Promise<void>;
}

type Message = Record<string, unknown>;
type Conversation = { messages: Message[] };

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error(
      "Codex Chat Completions 地址必须是无账号密码的 HTTP 或 HTTPS 地址",
    );
  url.search = "";
  url.hash = "";
  return url;
}

function chatEndpoint(baseUrl: string): string {
  const url = normalizedBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/u, "");
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

function inputToMessages(input: unknown, instructions: unknown): Message[] {
  const messages: Message[] = [];
  if (typeof instructions === "string" && instructions.trim())
    messages.push({ role: "system", content: instructions });
  const add = (item: unknown) => {
    if (typeof item === "string")
      messages.push({ role: "user", content: item });
    if (!item || typeof item !== "object") return;
    const value = item as Record<string, unknown>;
    const type = text(value.type);
    if (type === "message" || value.role) {
      const role = text(value.role) || "user";
      messages.push({
        role: role === "developer" ? "system" : role,
        content: contentToChat(value.content),
      });
    } else if (type === "input_text" || type === "output_text") {
      messages.push({
        role: type === "output_text" ? "assistant" : "user",
        content: text(value.text),
      });
    } else if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: text(value.call_id),
        content: JSON.stringify(value.output ?? ""),
      });
    }
  };
  if (typeof input === "string") add(input);
  else if (Array.isArray(input)) input.forEach(add);
  return messages;
}

function toolsToChat(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tool = item as Record<string, unknown>;
    if (text(tool.type) !== "function" || !text(tool.name)) return [];
    return [
      {
        type: "function",
        function: {
          name: text(tool.name),
          description: text(tool.description),
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      },
    ];
  });
  return tools.length ? tools : undefined;
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

function outputMessage(content: string) {
  return {
    type: "message",
    id: `msg_${randomUUID()}`,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: content, annotations: [] }],
  };
}

function outputToolCalls(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const call = item as Record<string, unknown>;
    const fn =
      call.function && typeof call.function === "object"
        ? (call.function as Record<string, unknown>)
        : undefined;
    if (!fn || !text(fn.name)) return [];
    return [
      {
        type: "function_call",
        id: text(call.id) || `fc_${randomUUID()}`,
        call_id: text(call.id) || `call_${randomUUID()}`,
        name: text(fn.name),
        arguments: text(fn.arguments) || "{}",
        status: "completed",
      },
    ];
  });
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

function writeEvent(
  res: ServerResponse,
  type: string,
  payload: Record<string, unknown>,
) {
  res.write(
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`,
  );
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
      JSON.stringify({ error: { message: "仅支持 POST /v1/responses" } }),
    );
    return;
  }
  try {
    const body = await readBody(req);
    const previous = conversations.get(text(body.previous_response_id));
    const messages = [
      ...(previous?.messages ?? []),
      ...inputToMessages(body.input, body.instructions),
    ];
    if (!messages.length) throw new Error("Codex 请求缺少 input");
    const request: Record<string, unknown> = {
      model: text(body.model),
      messages,
      stream: body.stream === true,
    };
    const tools = toolsToChat(body.tools);
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
    const upstream = await fetch(chatEndpoint(options.targetBaseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok)
      throw new Error(`Chat Completions 返回 HTTP ${upstream.status}`);
    const responseId = `resp_bridge_${randomUUID()}`;
    if (body.stream === true) {
      await streamResponse(
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
    const content =
      message && typeof message === "object"
        ? text((message as Record<string, unknown>).content)
        : "";
    const toolCalls =
      message && typeof message === "object"
        ? outputToolCalls((message as Record<string, unknown>).tool_calls)
        : [];
    const output = [...(content ? [outputMessage(content)] : []), ...toolCalls];
    conversations.set(responseId, {
      messages: [
        ...messages,
        {
          role: "assistant",
          content,
          ...(toolCalls.length
            ? { tool_calls: (message as Record<string, unknown>).tool_calls }
            : {}),
        },
      ],
    });
    trim(conversations);
    const response = responseShell(
      responseId,
      text(parsed.model) || text(body.model),
      "completed",
      output,
    );
    if (parsed.usage)
      (response as Record<string, unknown>).usage = parsed.usage;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: "invalid_request_error",
        },
      }),
    );
  }
}

async function streamResponse(
  upstream: Response,
  res: ServerResponse,
  responseId: string,
  model: string,
  messages: Message[],
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
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const records = buffer.split(/\r?\n\r?\n/u);
    buffer = records.pop() ?? "";
    for (const record of records) {
      const data = record
        .split(/\r?\n/u)
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
      const choice = Array.isArray(parsed.choices)
        ? parsed.choices[0]
        : undefined;
      const delta =
        choice && typeof choice === "object"
          ? (choice as Record<string, unknown>).delta
          : undefined;
      const piece =
        delta && typeof delta === "object"
          ? text((delta as Record<string, unknown>).content)
          : "";
      if (!piece) continue;
      if (!content) {
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
      content += piece;
      writeEvent(res, "response.output_text.delta", {
        item_id: "msg_bridge",
        output_index: 0,
        content_index: 0,
        delta: piece,
      });
    }
  }
  const output = content ? [outputMessage(content)] : [];
  const finalResponse = responseShell(responseId, model, "completed", output);
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
  writeEvent(res, "response.output_item.done", {
    output_index: 0,
    item: output[0],
  });
  writeEvent(res, "response.completed", { response: finalResponse });
  res.end();
  conversations.set(responseId, {
    messages: [...messages, { role: "assistant", content }],
  });
  trim(conversations);
}

function trim(conversations: Map<string, Conversation>): void {
  while (conversations.size > MAX_CONVERSATIONS) {
    const first = conversations.keys().next().value;
    if (typeof first === "string") conversations.delete(first);
    else return;
  }
}

export async function startCodexChatBridge(
  options: CodexChatBridgeOptions,
): Promise<CodexChatBridge> {
  normalizedBaseUrl(options.targetBaseUrl);
  if (!options.apiKey.trim())
    throw new Error("Codex Chat Completions 缺少 API 密钥");
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
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Codex 本地适配器启动失败");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    token,
    close: async () => {
      conversations.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
