import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const require = createRequire(import.meta.url);
const electronExecutable =
  process.env.DRAMAIP_DSH_ELECTRON_EXECUTABLE || require("electron");
const electronNodeVersion = execFileSync(
  electronExecutable,
  ["-p", "process.versions.node"],
  {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  },
).trim();
if (electronNodeVersion !== "24.18.0")
  throw new Error(
    `DSH Runtime 必须使用 Electron 内置 Node 24.18.0，实际为 ${electronNodeVersion}`,
  );
const runtimeRoot = resolve(
  process.env.DRAMAIP_DSH_RUNTIME_ROOT || join(desktop, "build/dsh"),
);
const configRoot = resolve(
  process.env.DRAMAIP_DSH_CONFIG_ROOT || join(desktop, "dsh-config"),
);
const entry = join(
  runtimeRoot,
  "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js",
);
const config = join(configRoot, "openai.cordis.yml");
const expectedText = "真实 DSH Runtime 已完成";
const mcpToken = "runtime-verification-token";
let mcpAuthorized = false;
let llmCalled = false;

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("无法取得本机测试端口"));
      resolvePromise(address.port);
    });
  });
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

const mcpServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${mcpToken}`) {
    response.writeHead(401).end();
    return;
  }
  mcpAuthorized = true;
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end();
    return;
  }
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
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
        : body.method === "tools/call"
          ? { content: [{ type: "text", text: "只读上下文" }] }
          : {};
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
});

const llmServer = createServer(async (request, response) => {
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== "Bearer verification-key") {
    response.writeHead(401).end();
    return;
  }
  await requestBody(request);
  llmCalled = true;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "close",
  });
  const common = {
    id: "chatcmpl-dramaip-dsh-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "dramaip-dsh-test",
  };
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: expectedText }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});

const forbiddenPlugins = [
  "dsh-bash",
  "dsh-fs-local",
  "dsh-tool-web",
  "dsh-skill",
  "dsh-subagent",
  "dsh-workflow",
  "dsh-session-persistence",
];
for (const name of ["openai", "anthropic", "google"]) {
  const source = await readFile(join(configRoot, `${name}.cordis.yml`), "utf8");
  for (const forbidden of forbiddenPlugins)
    if (source.includes(`name: '@deepseek-ai/${forbidden}`))
      throw new Error(`DSH 受控配置意外挂载了本地插件：${forbidden}`);
}

const [mcpPort, llmPort] = await Promise.all([
  listen(mcpServer),
  listen(llmServer),
]);
const child = spawn(electronExecutable, [entry, config], {
  cwd: desktop,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    DRAMAIP_DSH_API_KEY: "verification-key",
    DRAMAIP_DSH_MODEL: "dramaip-dsh-test",
    DRAMAIP_DSH_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
    DRAMAIP_MCP_URL: `http://127.0.0.1:${mcpPort}`,
    DRAMAIP_MCP_TOKEN: mcpToken,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
let buffer = "";
let stderr = "";
const frames = [];
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) if (line.trim()) frames.push(JSON.parse(line));
});
child.stderr.on("data", (chunk) => (stderr += chunk));
const send = (id, method, params = {}) =>
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = frames.find(predicate);
    if (found) return found;
    if (child.exitCode !== null)
      throw new Error(`DSH Runtime 提前退出：${stderr.slice(-2_000)}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`等待 DSH ${label} 超时：${stderr.slice(-2_000)}`);
};

try {
  send(1, "initialize", {
    cwd: desktop,
    provider: "openai",
    model: "dramaip-dsh-test",
  });
  await waitFor((frame) => frame.id === 1 && frame.result, "initialize");
  send(2, "session/prompt", {
    sessionId: "runtime-verification",
    contentBlocks: [{ type: "text", text: "请返回验证文本" }],
  });
  const receipt = await waitFor(
    (frame) => frame.id === 2 && typeof frame.result?.messageId === "string",
    "prompt receipt",
  );
  await waitFor(
    (frame) =>
      frame.method === "session.event" &&
      frame.params?.event?.type === "agent/inbox/spliced" &&
      frame.params.event.data.inserted.some(
        (message) => message.id === receipt.result.messageId,
      ),
    "inbox receipt",
  );
  await waitFor(
    (frame) =>
      frame.method === "session.status" && frame.params?.status === "idle",
    "idle",
  );
  const finalText = frames
    .filter(
      (frame) =>
        frame.method === "session.event" &&
        frame.params?.event?.type === "assistant/message",
    )
    .at(-1)
    ?.params.event.data.message.content.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (finalText !== expectedText || !llmCalled || !mcpAuthorized)
    throw new Error("DSH Runtime、模型桩或只读 MCP 未完成端到端验证");
  send(3, "shutdown");
  await waitFor((frame) => frame.id === 3 && frame.result, "shutdown");
  child.stdin.end();
  process.stdout.write("DSH 真实 Runtime、受控配置和只读 MCP 验证通过\n");
} finally {
  child.kill("SIGTERM");
  await Promise.all([
    new Promise((resolvePromise) => mcpServer.close(resolvePromise)),
    new Promise((resolvePromise) => llmServer.close(resolvePromise)),
  ]);
}
