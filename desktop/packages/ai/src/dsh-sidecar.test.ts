import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("DSH Sidecar owns isolated session runtimes and lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-dsh-sidecar-"));
  const configDirectory = join(directory, "config");
  const runtimeEntry = join(directory, "fake-runtime.cjs");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "openai.cordis.yml"), "[]\n");
  await writeFile(
    runtimeEntry,
    String.raw`
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
input.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    send({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "test" } } });
    return;
  }
  if (request.method === "session/prompt") {
    const sessionId = request.params.sessionId;
    const text = request.params.contentBlocks[0].text;
    const stableId = "receipt-" + request.id;
    send({ jsonrpc: "2.0", id: request.id, result: { messageId: stableId } });
    notify("session.event", { sessionId, event: { type: "agent/inbox/spliced", data: { inserted: [{ id: stableId }] } } });
    notify("session.status", { sessionId, status: "running" });
    if (text === "hang") return;
    notify("session.event", { sessionId, event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "sidecar:" + text }] } } } });
    notify("session.status", { sessionId, status: "idle" });
    return;
  }
  if (request.method === "shutdown") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    input.close();
  }
});
`,
  );

  const messages: PortMessage[] = [];
  let listener: ((event: { data: unknown }) => void) | undefined;
  const fakePort = {
    postMessage(message: unknown) {
      messages.push(message as PortMessage);
    },
    on(_event: "message", callback: (event: { data: unknown }) => void) {
      listener = callback;
    },
  };
  const processWithPort = process as NodeJS.Process & {
    parentPort?: typeof fakePort;
    exit: (code?: number) => never;
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
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`等待 DSH Sidecar 消息超时：${JSON.stringify(messages)}`);
  };

  try {
    await import(`./dsh-sidecar.ts?unit=${Date.now()}`);
    expect(listener).toBeDefined();
    send({
      type: "start",
      runtimeEntry,
      configDirectory,
      sessionRoot: join(directory, "sessions"),
      mcp: { url: "http://127.0.0.1:1/internal/mcp", token: "token" },
      provider: {
        providerKind: "openai",
        model: "test-model",
        secret: "secret-never-logged",
      },
    });
    await next((message) => message.type === "ready");

    send({
      type: "request",
      requestId: "create",
      operation: "createSession",
      payload: { title: "测试", projectId: "project-1" },
    });
    const created = await next(
      (message) =>
        message.type === "response" && message.requestId === "create",
    );
    const sessionId = String(
      (created.result as Record<string, unknown> | undefined)?.id ?? "",
    );
    expect(sessionId).not.toBe("");

    send({
      type: "request",
      requestId: "run",
      operation: "run",
      payload: {
        engineSessionId: sessionId,
        runId: "run-1",
        prompt: "hello",
        projectId: "project-1",
      },
    });
    const run = await next(
      (message) => message.type === "response" && message.requestId === "run",
    );
    expect(run.result).toEqual({ text: "sidecar:hello" });

    send({
      type: "request",
      requestId: "hanging-run",
      operation: "run",
      payload: {
        engineSessionId: sessionId,
        runId: "run-2",
        prompt: "hang",
        projectId: "project-1",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    send({
      type: "request",
      requestId: "interrupt",
      operation: "interrupt",
      payload: { engineSessionId: sessionId, runId: "run-2" },
    });
    await next(
      (message) =>
        message.type === "response" && message.requestId === "interrupt",
    );
    const interrupted = await next(
      (message) =>
        message.type === "response" && message.requestId === "hanging-run",
    );
    expect(String(interrupted.error)).toContain("已退出");

    send({
      type: "request",
      requestId: "resumed-run",
      operation: "run",
      payload: {
        engineSessionId: sessionId,
        runId: "run-3",
        prompt: "resume",
        projectId: "project-1",
      },
    });
    const resumed = await next(
      (message) =>
        message.type === "response" && message.requestId === "resumed-run",
    );
    expect(resumed.result).toEqual({ text: "sidecar:resume" });

    send({
      type: "request",
      requestId: "fork",
      operation: "fork",
      payload: { engineSessionId: sessionId },
    });
    const forked = await next(
      (message) => message.type === "response" && message.requestId === "fork",
    );
    expect((forked.result as Record<string, unknown>).id).not.toBe(sessionId);

    send({
      type: "request",
      requestId: "dispose",
      operation: "dispose",
      payload: { engineSessionId: sessionId },
    });
    await next(
      (message) =>
        message.type === "response" && message.requestId === "dispose",
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
