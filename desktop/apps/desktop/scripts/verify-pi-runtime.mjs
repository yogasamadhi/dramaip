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
  manifest.version !== "0.84.2" ||
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
        ? {
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
              content: [{ type: "text", text: "只读上下文" }],
            })
          : undefined;
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
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${providerToken}`) {
    response.writeHead(401).end();
    return;
  }
  const body = await requestBody(request);
  exposedToolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool.function?.name).filter(Boolean)
    : [];
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
  if (llmCalls === 1) {
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
      `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } })}\n\n`,
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
try {
  const runtime = await import(pathToFileURL(runtimeEntry).href);
  if (typeof runtime.createPiSession !== "function")
    throw new Error("Pi Runtime 缺少 createPiSession 导出");
  session = await runtime.createPiSession({
    sessionId: "dramaip-pi-runtime-verifier",
    provider: {
      providerKind: "openai",
      model: "dramaip-pi-test",
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
  if (!events.some((event) => event.type === "usage"))
    throw new Error("Pi Runtime 未产生用量事件");
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
} finally {
  await session?.close();
  await Promise.all([close(mcpServer), close(llmServer)]);
}

process.stdout.write("Pi 0.84.2 Runtime 与只读工具边界验证通过\n");

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
