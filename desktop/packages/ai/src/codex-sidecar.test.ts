import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("Codex Sidecar 切换运行授权时保留首轮尚未持久化的线程", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-codex-sidecar-"));
  const runtimeEntry = join(directory, "fake-codex.cjs");
  const rpcLog = join(directory, "rpc.log");
  const tokenLog = join(directory, "mcp-tokens.log");
  await writeFile(
    runtimeEntry,
    String.raw`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const home = process.env.CODEX_HOME;
const persistedPath = path.join(home, "fake-threads.json");
const logPath = path.join(path.dirname(home), "rpc.log");
const tokenLogPath = path.join(path.dirname(home), "mcp-tokens.log");
fs.appendFileSync(tokenLogPath, String(process.env.DRAMAIP_MCP_TOKEN || "missing") + "\n");
let persisted = new Set();
try { persisted = new Set(JSON.parse(fs.readFileSync(persistedPath, "utf8"))); } catch {}
const loaded = new Set();
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const result = (id, value) => send({ id, result: value });
const error = (id, message) => send({ id, error: { code: -32600, message } });
const notify = (method, params) => send({ method, params });
input.on("line", line => {
  const request = JSON.parse(line);
  fs.appendFileSync(logPath, request.method + "\n");
  if (request.method === "initialize") return result(request.id, {});
  if (request.method === "account/read") {
    return result(request.id, { account: { type: "chatgpt", email: "test@example.com" } });
  }
  if (request.method === "thread/start") {
    const id = "thread-persisted";
    loaded.add(id);
    return result(request.id, { thread: { id } });
  }
  if (request.method === "thread/resume") {
    const id = request.params.threadId;
    if (!persisted.has(id)) return error(request.id, "thread not found: " + id);
    loaded.add(id);
    return result(request.id, { thread: { id } });
  }
  if (request.method === "turn/start") {
    const threadId = request.params.threadId;
    if (!loaded.has(threadId)) return error(request.id, "thread not found: " + threadId);
    const turnId = "turn-after-restart";
    persisted.add(threadId);
    fs.writeFileSync(persistedPath, JSON.stringify([...persisted]));
    result(request.id, { turn: { id: turnId } });
    setImmediate(() => {
      notify("turn/started", { threadId, turn: { id: turnId } });
      notify("item/agentMessage/delta", { threadId, delta: "resumed:hello" });
      notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
    });
    return;
  }
  if (request.method === "config/mcpServer/reload") return result(request.id, {});
  if (request.method === "thread/delete") return result(request.id, {});
  if (request.method === "account/logout") return result(request.id, {});
  error(request.id, "unsupported: " + request.method);
});
`,
  );
  await chmod(runtimeEntry, 0o755);

  const messages: PortMessage[] = [];
  let listener: ((event: { data: unknown }) => void) | undefined;
  const fakePort = {
    testHarness: true as const,
    postMessage(message: unknown) {
      messages.push(message as PortMessage);
    },
    on(_event: "message", callback: (event: { data: unknown }) => void) {
      listener = callback;
    },
  };
  const processWithPort = process as NodeJS.Process & {
    parentPort?: typeof fakePort;
  };
  const parentPortDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "parentPort",
  );
  const originalExit = process.exit;
  Object.defineProperty(process, "parentPort", {
    configurable: true,
    value: fakePort,
  });
  Object.defineProperty(process, "exit", {
    configurable: true,
    value: () => undefined,
  });

  const send = (message: unknown) => listener?.({ data: message });
  const next = async (predicate: (message: PortMessage) => boolean) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`等待 Codex Sidecar 消息超时：${JSON.stringify(messages)}`);
  };

  try {
    await import(`./codex-sidecar.ts?unit=${Date.now()}`);
    expect(listener).toBeDefined();
    send({
      type: "start",
      binaryPath: runtimeEntry,
      codexHome: join(directory, "codex-home"),
      sessionRoot: join(directory, "sessions"),
      mcp: { url: "http://127.0.0.1:1/internal/mcp", token: "token" },
    });
    await next((message) => message.type === "ready");

    send({
      type: "request",
      requestId: "restart",
      operation: "login",
      payload: {
        mode: "custom_provider",
        apiKey: "test-key",
        providerId: "provider-deepseek",
        providerName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      },
    });
    await next(
      (message) =>
        message.type === "response" && message.requestId === "restart",
    );

    send({
      type: "request",
      requestId: "auth",
      operation: "authStatus",
      payload: {},
    });
    const auth = await next(
      (message) => message.type === "response" && message.requestId === "auth",
    );
    expect(
      (auth.result as Record<string, unknown> | undefined)?.provider,
    ).toMatchObject({ id: "provider-deepseek", name: "DeepSeek" });

    send({
      type: "request",
      requestId: "create",
      operation: "createSession",
      payload: {},
    });
    const created = await next(
      (message) =>
        message.type === "response" && message.requestId === "create",
    );
    const sessionId = String(
      (created.result as Record<string, unknown> | undefined)?.id ?? "",
    );
    expect(sessionId).toBe("thread-persisted");

    send({
      type: "request",
      requestId: "run",
      operation: "run",
      payload: {
        engineSessionId: sessionId,
        runId: "run-after-restart",
        prompt: "hello",
        capabilityGrant: {
          endpoint: "http://127.0.0.1:1/internal/mcp",
          token: "run-scoped-web-grant",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
    const run = await next(
      (message) => message.type === "response" && message.requestId === "run",
    );
    expect(run.error).toBeUndefined();
    expect((run.result as Record<string, unknown>).content).toBe(
      "resumed:hello",
    );

    const methods = (await readFile(rpcLog, "utf8")).trim().split("\n");
    const reloadIndex = methods.lastIndexOf("config/mcpServer/reload");
    const turnIndex = methods.lastIndexOf("turn/start");
    expect(reloadIndex).toBeGreaterThan(-1);
    expect(turnIndex).toBeGreaterThan(reloadIndex);
    expect(methods.slice(reloadIndex, turnIndex)).not.toContain("initialize");
    expect(methods.slice(reloadIndex, turnIndex)).not.toContain(
      "thread/resume",
    );
    const mcpTokens = (await readFile(tokenLog, "utf8")).trim().split("\n");
    expect(mcpTokens).toHaveLength(2);
    expect(mcpTokens.every((token) => token !== "run-scoped-web-grant")).toBe(
      true,
    );

    send({ type: "stop" });
    await next((message) => message.type === "stopped");
  } finally {
    Object.defineProperty(process, "exit", {
      configurable: true,
      value: originalExit,
    });
    if (parentPortDescriptor)
      Object.defineProperty(process, "parentPort", parentPortDescriptor);
    else delete processWithPort.parentPort;
    await rm(directory, { recursive: true, force: true });
  }
});
