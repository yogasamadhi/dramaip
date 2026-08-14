import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(
  process.env.DRAMAIP_HERMES_RUNTIME_ROOT || join(desktop, "build/hermes"),
);
const manifest = JSON.parse(
  await readFile(join(root, "runtime-manifest.json"), "utf8"),
);
if (
  manifest.engine !== "hermes" ||
  manifest.version !== "0.20.1" ||
  manifest.pythonVersion !== "3.11.15" ||
  manifest.pythonStandaloneRelease !== "20260807" ||
  manifest.uvVersion !== "0.9.28"
)
  throw new Error("Hermes Runtime 清单版本无效");
const python = join(root, manifest.entries.python);
const adapter = join(root, manifest.entries.adapter);
const project = join(root, manifest.entries.project);
const sitePackages = join(root, manifest.entries.sitePackages);
for (const path of [python, adapter, project, sitePackages])
  if (!existsSync(path)) throw new Error(`Hermes Runtime 缺少入口：${path}`);

const version = execFileSync(
  python,
  ["-c", "import platform; print(platform.python_version())"],
  {
    encoding: "utf8",
  },
).trim();
if (version !== "3.11.15")
  throw new Error(`Hermes Runtime Python 必须为 3.11.15，实际为 ${version}`);
const adapterSource = await readFile(adapter, "utf8");
for (const required of [
  'enabled_toolsets=["dramaip-runtime"]',
  'state.agent.enabled_toolsets = ["dramaip-runtime", "mcp-dramaip"]',
  "session_db=None",
  "skip_memory=True",
  "checkpoints_enabled=False",
])
  if (!adapterSource.includes(required))
    throw new Error(`Hermes 安全适配器缺少约束：${required}`);
if (adapterSource.includes('enabled_toolsets=["hermes-acp"]'))
  throw new Error("Hermes 安全适配器禁止注册 hermes-acp 工具集");

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("无法取得 Hermes 本机测试端口"));
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

const expectedText = "真实 Hermes Runtime 已完成";
const mcpToken = "runtime-hermes-mcp-token";
const providerToken = "runtime-hermes-provider-token";
let mcpAuthorized = false;
let llmCalled = false;
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
const llmServer = createServer(async (request, response) => {
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
    id: "chatcmpl-dramaip-hermes-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "dramaip-hermes-test",
  };
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: expectedText }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});

const verifyDirectory = await mkdtemp(join(tmpdir(), "dramaip-hermes-verify-"));
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
  throw new Error("Hermes MCP 未拒绝错误 Bearer Token");
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
  throw new Error("Hermes MCP 未拒绝越权工具");
const environment = {
  ...process.env,
  PYTHONPATH: [project, sitePackages].join(delimiter),
  PYTHONNOUSERSITE: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  HERMES_DISABLE_LAZY_INSTALLS: "1",
  HERMES_ACP_SKIP_CONFIGURED_MCP: "1",
  HERMES_HOME: join(verifyDirectory, "home"),
  DRAMAIP_HERMES_PROVIDER: "openai",
  DRAMAIP_HERMES_MODEL: "dramaip-hermes-test",
  DRAMAIP_HERMES_API_KEY: providerToken,
  DRAMAIP_HERMES_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
  DRAMAIP_MCP_URL: `http://127.0.0.1:${mcpPort}`,
  DRAMAIP_MCP_TOKEN: mcpToken,
};
execFileSync(
  python,
  ["-c", "import acp, run_agent, tools.mcp_tool; print('hermes-runtime-ok')"],
  { encoding: "utf8", env: environment },
);
const child = spawn(python, [adapter], {
  cwd: verifyDirectory,
  env: environment,
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
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const found = frames.find(predicate);
    if (found) return found;
    if (child.exitCode !== null)
      throw new Error(`Hermes Runtime 提前退出：${stderr.slice(-2_000)}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`等待 Hermes ${label} 超时：${stderr.slice(-2_000)}`);
};

try {
  send(1, "initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "dramaip-runtime-verifier", version: "1" },
  });
  await waitFor((frame) => frame.id === 1 && frame.result, "initialize");
  send(2, "session/new", {
    cwd: verifyDirectory,
    mcpServers: [
      {
        name: "dramaip",
        type: "http",
        url: `http://127.0.0.1:${mcpPort}`,
        headers: [{ name: "Authorization", value: `Bearer ${mcpToken}` }],
      },
    ],
  });
  const session = await waitFor(
    (frame) => frame.id === 2 && typeof frame.result?.sessionId === "string",
    "session/new",
  );
  send(3, "session/prompt", {
    sessionId: session.result.sessionId,
    prompt: [{ type: "text", text: "请返回验证文本" }],
  });
  await waitFor((frame) => frame.id === 3 && frame.result, "session/prompt");
  const finalText = frames
    .filter(
      (frame) =>
        frame.method === "session/update" &&
        frame.params?.sessionId === session.result.sessionId &&
        frame.params?.update?.sessionUpdate === "agent_message_chunk" &&
        frame.params.update.content?.type === "text",
    )
    .map((frame) => frame.params.update.content.text)
    .join("");
  if (finalText !== expectedText || !llmCalled || !mcpAuthorized)
    throw new Error("Hermes Runtime、模型桩或只读 MCP 未完成端到端验证");
  const files = await readdir(verifyDirectory, { recursive: true });
  for (const path of files) {
    const content = await readFile(join(verifyDirectory, path)).catch(
      () => null,
    );
    if (
      content &&
      (content.includes(providerToken) || content.includes(mcpToken))
    )
      throw new Error("Hermes 受控临时目录写入了明文凭据");
  }
  child.stdin.end();
  process.stdout.write(
    "Hermes 内置 Python、真实 ACP、模型桩和只读 MCP 验证通过\n",
  );
} finally {
  child.kill("SIGTERM");
  await Promise.all([
    new Promise((resolvePromise) => mcpServer.close(resolvePromise)),
    new Promise((resolvePromise) => llmServer.close(resolvePromise)),
  ]);
  await rm(verifyDirectory, { recursive: true, force: true });
}
