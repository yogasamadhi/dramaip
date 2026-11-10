import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(
  process.env.DRAMAIP_PI_RUNTIME_ROOT || join(desktop, "build/pi"),
);
const manifest = JSON.parse(
  await readFile(join(root, "runtime-manifest.json"), "utf8"),
);
if (
  manifest.engine !== "pi" ||
  manifest.version !== "1.5.0" ||
  manifest.node !== ">=22.19.0" ||
  !/^[a-f0-9]{64}$/.test(manifest.runtimeSha256 ?? "")
)
  throw new Error("Pi Runtime 清单无效");
const runtimeEntry = join(root, manifest.entry);
if (!existsSync(runtimeEntry)) throw new Error("Pi Runtime 缺少入口");

const expectedText = "真实 Pi Runtime 已完成";
const mcpToken = "runtime-pi-mcp-token";
const providerToken = "runtime-pi-provider-token";
let mcpAuthorized = false;
let mcpToolCalled = false;
let llmCalls = 0;
let exposedToolNames = [];
let nativeMinimaxCalled = false;
let lastModelRequest;
let rejectCompaction = false;
let onCompactionStarted;

const mcpServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${mcpToken}`) {
    response.writeHead(401).end();
    return;
  }
  mcpAuthorized = true;
  const body = await requestBody(request);
  if (body.method === "notifications/initialized") {
    response.writeHead(202).end();
    return;
  }
  const result =
    body.method === "initialize"
      ? {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "dramaip-read-only-test", version: "1" },
        }
      : body.method === "tools/list"
        ? body.params?.cursor !== "context-tools"
          ? { tools: [], nextCursor: "context-tools" }
          : {
              tools: [
                {
                  name: "get_context",
                  description: "读取受控上下文",
                  inputSchema: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                  },
                },
              ],
            }
        : body.method === "tools/call" && body.params?.name === "get_context"
          ? ((mcpToolCalled = true),
            {
              content: [
                {
                  type: "resource",
                  resource: { uri: "context://test", text: "只读上下文" },
                },
              ],
            })
          : undefined;
  if (body.method === "tools/call" && result) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`,
    );
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      ...(result
        ? { result }
        : { error: { code: -32601, message: "DramaIP 只读权限拒绝此工具" } }),
    }),
  );
});

const llmServer = createServer(async (request, response) => {
  if (
    new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith(
      "/v1/messages",
    )
  ) {
    const body = await requestBody(request);
    if (
      request.headers["x-api-key"] !== providerToken ||
      body.model !== "MiniMax-M2.7" ||
      body.tools?.length
    ) {
      response.writeHead(400).end();
      return;
    }
    nativeMinimaxCalled = true;
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      {
        type: "message_start",
        message: {
          id: "native-pi",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 7,
            output_tokens: 0,
            cache_read_input_tokens: 2,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "MiniMax native" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ])
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    response.end();
    return;
  }
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${providerToken}`) {
    response.writeHead(401).end();
    return;
  }
  const body = await requestBody(request);
  lastModelRequest = body;
  if (
    body.model !== "deepseek-v4-flash" ||
    body.thinking?.type !== "disabled"
  ) {
    response.writeHead(400).end(
      JSON.stringify({
        error: {
          message:
            "Pi must explicitly disable DeepSeek V4 thinking when configured off",
        },
      }),
    );
    return;
  }
  exposedToolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool.function?.name).filter(Boolean)
    : [];
  if (rejectCompaction && !exposedToolNames.length) {
    rejectCompaction = false;
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          error: { message: "compaction authentication failed" },
        }),
      );
    return;
  }
  llmCalls += 1;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    connection: "close",
  });
  const common = {
    id: "chatcmpl-dramaip-pi-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "dramaip-pi-test",
  };
  if (onCompactionStarted && !exposedToolNames.length) {
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "partial-summary-must-not-replace-history" }, finish_reason: null }] })}\n\n`,
    );
    const started = onCompactionStarted;
    onCompactionStarted = undefined;
    started();
    return;
  }
  if (
    body.messages?.some(
      (message) => message.role === "user" && message.content === "cancel",
    )
  ) {
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "取消测试" }, finish_reason: null }] })}\n\n`,
    );
    return;
  }
  if (llmCalls === 1) {
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "private-analysis-must-not-be-forwarded" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-context", type: "function", function: { name: "get_context", arguments: "{}" } }] }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`,
    );
  } else {
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: expectedText }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12, ...(llmCalls === 3 ? { prompt_tokens_details: { cached_tokens: 2 } } : {}) } })}\n\n`,
    );
  }
  response.end("data: [DONE]\n\n");
});

const [mcpPort, llmPort] = await Promise.all([
  listen(mcpServer),
  listen(llmServer),
]);
const events = [];
let session;
let compactionSession;
try {
  const runtime = await import(pathToFileURL(runtimeEntry).href);
  if (typeof runtime.createPiSession !== "function")
    throw new Error("Pi Runtime 缺少 createPiSession 导出");
  session = await runtime.createPiSession({
    sessionId: "dramaip-pi-runtime-verifier",
    provider: {
      providerKind: "openai",
      model: "deepseek-v4-flash",
      baseUrl: `http://127.0.0.1:${llmPort}/v1`,
      secret: providerToken,
    },
    mcp: { url: `http://127.0.0.1:${mcpPort}`, token: mcpToken },
  });
  const result = await session.run("hello", (event) => events.push(event));
  if (result.text !== expectedText)
    throw new Error(`Pi Runtime 输出不匹配：${result.text}`);
  if (!events.some((event) => event.type === "content.delta"))
    throw new Error("Pi Runtime 未产生文本增量事件");
  if (
    !events.some(
      (event) => event.type === "activity" && event.activity === "thinking",
    )
  )
    throw new Error("Pi Runtime 未产生模型分析状态");
  if (JSON.stringify(events).includes("private-analysis-must-not-be-forwarded"))
    throw new Error("Pi Runtime 泄漏了原始分析文本");
  if (!events.some((event) => event.type === "usage"))
    throw new Error("Pi Runtime 未产生用量事件");
  const usageEvents = events.filter((event) => event.type === "usage");
  if (
    usageEvents.length !== 2 ||
    usageEvents.some(
      (event, index) =>
        event.measurementScope !== "response-increment" ||
        event.inputAccounting !== "excludes-cache" ||
        event.inputTokens !== 7 ||
        event.outputTokens !== [3, 5][index],
    )
  )
    throw new Error("Pi Runtime 未逐响应保留引擎用量及缓存计量口径");
  if (
    !events.some(
      (event) => event.type === "tool" && event.status === "completed",
    )
  )
    throw new Error("Pi Runtime 未产生工具完成事件");
  if (!mcpAuthorized || !mcpToolCalled || llmCalls !== 2)
    throw new Error("Pi Runtime 未完成 MCP 或模型调用");
  if (JSON.stringify(exposedToolNames) !== JSON.stringify(["get_context"]))
    throw new Error(`Pi 暴露了非受控工具：${JSON.stringify(exposedToolNames)}`);
  if (typeof runtime.streamPiText !== "function")
    throw new Error("Pi Runtime 缺少 streamPiText 导出");
  const textProvider = {
    providerKind: "openai",
    model: "deepseek-v4-flash",
    baseUrl: `http://127.0.0.1:${llmPort}/v1`,
    secret: providerToken,
  };
  const deltas = [];
  const textResult = await runtime.streamPiText({
    provider: textProvider,
    system: "仅返回文本",
    prompt: "hello",
    onTextDelta: (delta) => deltas.push(delta),
  });
  if (textResult.text !== expectedText || deltas.join("") !== expectedText)
    throw new Error("Pi 文本接口未保留流式回复");
  if (
    textResult.usage.inputTokens !== 5 ||
    textResult.usage.outputTokens !== 5 ||
    textResult.usage.cachedTokens !== 2 ||
    textResult.usage.inputAccounting !== "excludes-cache"
  )
    throw new Error("Pi 文本接口未保留原生缓存用量口径");
  if (exposedToolNames.length !== 0 || llmCalls !== 3)
    throw new Error("Pi 文本接口必须仅调用模型，不得暴露 Agent 工具");
  const controller = new AbortController();
  let cancelled = false;
  try {
    await runtime.streamPiText({
      provider: textProvider,
      system: "仅返回文本",
      prompt: "cancel",
      signal: controller.signal,
      onTextDelta: () => controller.abort(),
    });
  } catch (error) {
    cancelled =
      controller.signal.aborted && String(error).includes("任务已取消");
  }
  if (!cancelled) throw new Error("Pi 文本接口未中断正在生成的模型请求");
  let rejected = false;
  try {
    await runtime.streamPiText({
      provider: { ...textProvider, secret: "invalid-token" },
      system: "仅返回文本",
      prompt: "hello",
    });
  } catch (error) {
    rejected = /401/.test(String(error));
  }
  if (!rejected) throw new Error("Pi 文本接口未传播认证失败");
  const catalog = runtime.getPiProviderCatalog();
  if (
    catalog.release !== "Pi 1.5.0" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(catalog.updatedAt) ||
    catalog.updatedAt <= "2026-08-11"
  )
    throw new Error("Pi 原生模型目录版本或日期不正确");
  if (
    catalog.providers.length < 30 ||
    catalog.providers.reduce(
      (count, provider) => count + provider.models.length,
      0,
    ) < 1000
  )
    throw new Error("Pi 原生服务商目录不完整");
  const minimax = catalog.providers.find(
    (provider) => provider.id === "minimax",
  );
  if (
    minimax?.baseUrl !== "https://api.minimax.io/anthropic" ||
    !minimax.models.some(
      (model) => model.id === "MiniMax-M2.7" && model.recommended,
    )
  )
    throw new Error("MiniMax 未使用 Pi 服务商端点和默认模型");
  const native = await runtime.streamPiText({
    provider: {
      ...textProvider,
      piProviderId: "minimax",
      model: "MiniMax-M2.7",
      baseUrl: `http://127.0.0.1:${llmPort}/anthropic`,
    },
    system: "仅返回文本",
    prompt: "hello",
  });
  if (
    !nativeMinimaxCalled ||
    native.text !== "MiniMax native" ||
    native.usage.inputTokens !== 7 ||
    native.usage.cachedTokens !== 2
  )
    throw new Error("Pi 原生服务商请求未按 MiniMax 模块选择 Anthropic 协议");
  compactionSession = await runtime.createPiSession({
    sessionId: "dramaip-native-compaction-verifier",
    provider: textProvider,
    mcp: { url: `http://127.0.0.1:${mcpPort}`, token: mcpToken },
  });
  const emptyCompaction = await compactionSession.compact();
  if (emptyCompaction.compacted !== false)
    throw new Error("空会话不应调用模型进行压缩");
  const oldTurn = "old-history-only ".repeat(400);
  await compactionSession.run(oldTurn, () => {});
  for (let index = 0; index < 12; index++)
    await compactionSession.run(
      `turn-${index} ${"retained-history ".repeat(700)}`,
      () => {},
    );
  await compactionSession.run("keep-recent-turn", () => {});
  rejectCompaction = true;
  let compactionFailed = false;
  try {
    await compactionSession.compact();
  } catch {
    compactionFailed = true;
  }
  if (!compactionFailed) throw new Error("Pi 压缩未传播模型失败");
  await compactionSession.run("after-failed-compaction", () => {});
  if (!JSON.stringify(lastModelRequest.messages).includes(oldTurn))
    throw new Error("失败的压缩改写了原会话上下文");
  const compactionStarted = new Promise((resolve) => {
    onCompactionStarted = resolve;
  });
  const cancelledCompaction = compactionSession.compact().then(
    () => false,
    () => true,
  );
  await compactionStarted;
  let concurrentRejected = false;
  try {
    await compactionSession.run("must-not-enter-compaction", () => {});
  } catch {
    concurrentRejected = true;
  }
  if (!concurrentRejected) throw new Error("压缩期间接受了并发对话");
  await compactionSession.abort();
  if (!(await cancelledCompaction)) throw new Error("Pi 未中断正在执行的压缩");
  await compactionSession.run("after-cancelled-compaction", () => {});
  const afterCancelled = JSON.stringify(lastModelRequest.messages);
  if (
    !afterCancelled.includes(oldTurn) ||
    afterCancelled.includes("partial-summary-must-not-replace-history")
  )
    throw new Error("中断的压缩替换了原会话上下文");
  const compaction = await compactionSession.compact();
  if (
    !compaction.compacted ||
    !compaction.usage ||
    compaction.usage.inputAccounting !== "excludes-cache"
  )
    throw new Error("Pi 原生压缩未执行或丢失原运行用量");
  await compactionSession.run("continue-after-compaction", () => {});
  const compactedContext = JSON.stringify(lastModelRequest.messages);
  if (
    compactedContext.includes(oldTurn) ||
    !compactedContext.includes("keep-recent-turn") ||
    !compactedContext.includes("<summary>")
  )
    throw new Error("Pi 原生压缩未替换旧历史或遗漏最近对话");
  if (
    !exposedToolNames.includes("get_context") ||
    !compactedContext.includes("DramaIP")
  )
    throw new Error("Pi 压缩后丢失系统提示或受控工具");
} finally {
  await compactionSession?.close();
  await session?.close();
  await Promise.all([close(mcpServer), close(llmServer)]);
}

process.stdout.write("Pi 1.5.0 Runtime 与只读工具边界验证通过\n");

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("无法取得 Pi 本机测试端口"));
      resolvePromise(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function requestBody(request) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.once("error", reject);
    request.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}
