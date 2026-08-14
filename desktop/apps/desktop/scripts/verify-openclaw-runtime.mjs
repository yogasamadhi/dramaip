import { execFileSync, spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, connect } from "node:net";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const runtimeRoot = resolve(
  process.env.DRAMAIP_OPENCLAW_RUNTIME_ROOT || join(desktop, "build/openclaw"),
);
const manifest = JSON.parse(
  await readFile(join(runtimeRoot, "runtime-manifest.json"), "utf8"),
);
if (
  manifest.engine !== "openclaw" ||
  manifest.version !== "2026.7.1" ||
  manifest.pnpmVersion !== "11.2.2" ||
  manifest.nodeVersion !== "24.18.0"
)
  throw new Error("OpenClaw Runtime 清单版本无效");
const entry = join(runtimeRoot, manifest.entry);
const require = createRequire(import.meta.url);
const electron =
  process.env.DRAMAIP_OPENCLAW_ELECTRON_EXECUTABLE || require("electron");
const nodeVersion = execFileSync(electron, ["-p", "process.versions.node"], {
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
}).trim();
if (nodeVersion !== "24.18.0")
  throw new Error(
    `OpenClaw Gateway 必须使用 Electron 内置 Node 24.18.0，实际为 ${nodeVersion}`,
  );

const directory = await mkdtemp(join(tmpdir(), "dramaip-openclaw-verify-"));
const state = join(directory, "state");
const workspace = join(directory, "workspace");
const configPath = join(directory, "openclaw.json");
await Promise.all([mkdir(state), mkdir(workspace)]);
const expectedText = "真实 OpenClaw Runtime 已完成";
const mcpToken = "runtime-openclaw-mcp-token";
const providerToken = "runtime-openclaw-provider-token";
const gatewayToken = "runtime-openclaw-gateway-token";
let mcpAuthorized = false;
let llmCalled = false;

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("无法取得 OpenClaw 本机测试端口"));
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

const mcpServer = createHttpServer(async (request, response) => {
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
        : body.method === "tools/call" && body.params?.name === "get_context"
          ? { content: [{ type: "text", text: "只读上下文" }] }
          : undefined;
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      ...(result
        ? { result }
        : {
            error: {
              code: -32601,
              message: "DramaIP 只读权限拒绝此工具",
            },
          }),
    }),
  );
});
const llmServer = createHttpServer(async (request, response) => {
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${providerToken}`) {
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
    id: "chatcmpl-dramaip-openclaw-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "runtime-verification",
  };
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: expectedText }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});
const [mcpPort, llmPort] = await Promise.all([
  listen(mcpServer),
  listen(llmServer),
]);
const rejectedToken = await fetch(`http://127.0.0.1:${mcpPort}`, {
  method: "POST",
  headers: {
    Authorization: "Bearer wrong-token",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
if (rejectedToken.status !== 401)
  throw new Error("OpenClaw MCP 未拒绝错误 Bearer Token");
const rejectedTool = await fetch(`http://127.0.0.1:${mcpPort}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${mcpToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "write_file", arguments: {} },
  }),
});
if (!(await rejectedTool.json()).error)
  throw new Error("OpenClaw MCP 未拒绝越权工具");
await writeFile(
  configPath,
  `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token" } },
    models: {
      mode: "replace",
      pricing: { enabled: false },
      providers: {
        dramaip: {
          baseUrl: `http://127.0.0.1:${llmPort}/v1`,
          apiKey: {
            source: "env",
            provider: "default",
            id: "DRAMAIP_OPENCLAW_API_KEY",
          },
          api: "openai-completions",
          models: [
            {
              id: "runtime-verification",
              name: "runtime-verification",
              api: "openai-completions",
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        workspace,
        model: { primary: "dramaip/runtime-verification", fallbacks: [] },
        models: { "dramaip/runtime-verification": {} },
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
          url: `http://127.0.0.1:${mcpPort}`,
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
  })}\n`,
  { mode: 0o600 },
);
const environment = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  OPENCLAW_LOG_LEVEL: "warn",
  DRAMAIP_OPENCLAW_API_KEY: providerToken,
  DRAMAIP_MCP_TOKEN: mcpToken,
};
execFileSync(electron, [entry, "config", "validate", "--json"], {
  encoding: "utf8",
  env: environment,
});

const port = await new Promise((resolvePromise, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string")
      return reject(new Error("无法分配 OpenClaw 验证端口"));
    server.close((error) =>
      error ? reject(error) : resolvePromise(address.port),
    );
  });
});
const child = spawn(
  electron,
  [entry, "gateway", "run", "--bind", "loopback", "--port", String(port)],
  { cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"] },
);
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (value) => (stderr += value));
try {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`OpenClaw Gateway 提前退出：${stderr.slice(-2_000)}`);
    const ready = await new Promise((resolvePromise) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => resolvePromise(false));
    });
    if (ready) break;
    if (attempt === 199) throw new Error("OpenClaw Gateway 启动超时");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [];
  socket.addEventListener("message", (event) =>
    frames.push(JSON.parse(String(event.data))),
  );
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("OpenClaw Gateway WebSocket 连接超时")),
      2_000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("OpenClaw Gateway WebSocket 连接失败"));
    });
  });
  const waitForFrame = async (predicate, label, attempts = 800) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const found = frames.find(predicate);
      if (found) return found;
      if (child.exitCode !== null)
        throw new Error(`OpenClaw Gateway 提前退出：${stderr.slice(-2_000)}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    throw new Error(`等待 OpenClaw ${label} 超时：${stderr.slice(-2_000)}`);
  };
  await waitForFrame(
    (frame) => frame.type === "event" && frame.event === "connect.challenge",
    "connect challenge",
  );
  let sequence = 0;
  const request = async (method, params, attempts) => {
    const id = `runtime-${++sequence}`;
    socket.send(JSON.stringify({ type: "req", id, method, params }));
    const response = await waitForFrame(
      (frame) => frame.type === "res" && frame.id === id,
      method,
      attempts,
    );
    if (response.ok === false)
      throw new Error(
        `OpenClaw ${method} 失败：${response.error?.message ?? "unknown"}`,
      );
    return response.payload;
  };
  await request("connect", {
    minProtocol: 4,
    maxProtocol: 4,
    client: {
      id: "cli",
      displayName: "DramaIP Runtime Verifier",
      version: "1",
      platform: process.platform,
      mode: "cli",
      instanceId: `dramaip-verify-${process.pid}`,
    },
    caps: ["tool-events"],
    role: "operator",
    scopes: ["operator.write"],
    auth: { token: gatewayToken },
  });
  const runId = "runtime-openclaw-run";
  const accepted = await request("agent", {
    message: "请返回验证文本",
    agentId: "main",
    sessionKey: "agent:main:runtime-verification",
    deliver: false,
    timeout: 20,
    cleanupBundleMcpOnRunEnd: true,
    idempotencyKey: runId,
  });
  if (!["accepted", "in_flight"].includes(accepted?.status))
    throw new Error("OpenClaw Gateway 未接收真实验证运行");
  const final = await request(
    "agent.wait",
    { runId, timeoutMs: 20_000 },
    1_000,
  );
  if (final?.status !== "ok" || !llmCalled || !mcpAuthorized)
    throw new Error("OpenClaw Gateway、模型桩或只读 MCP 未完成端到端验证");
  const assistantText = frames
    .filter(
      (frame) =>
        frame.type === "event" &&
        frame.event === "agent" &&
        frame.payload?.runId === runId &&
        frame.payload?.stream === "assistant",
    )
    .map((frame) => frame.payload.data?.delta ?? frame.payload.data?.text ?? "")
    .join("");
  if (!assistantText.includes(expectedText))
    throw new Error("OpenClaw Gateway 未流式返回预期文本");
  socket.close(1000, "verification complete");
  child.kill("SIGTERM");
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("OpenClaw Gateway 未在期限内退出"));
    }, 8_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
  const files = await readdir(directory, { recursive: true });
  for (const path of files) {
    const content = await readFile(join(directory, path)).catch(() => null);
    if (
      content &&
      (content.includes(providerToken) ||
        content.includes(mcpToken) ||
        content.includes(gatewayToken))
    )
      throw new Error(`OpenClaw 受控临时目录写入了明文凭据：${path}`);
  }
  process.stdout.write(
    "OpenClaw 打包 Gateway、真实 v4 RPC、模型桩和只读 MCP 验证通过\n",
  );
} finally {
  child.kill("SIGKILL");
  await Promise.all([
    new Promise((resolvePromise) => mcpServer.close(resolvePromise)),
    new Promise((resolvePromise) => llmServer.close(resolvePromise)),
  ]);
  await rm(directory, { recursive: true, force: true });
}
