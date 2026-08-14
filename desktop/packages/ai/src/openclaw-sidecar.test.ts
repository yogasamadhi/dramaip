import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("OpenClaw Sidecar rotates Gateway generations and cleans state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-openclaw-sidecar-"));
  const stateRoot = join(directory, "state-root");
  const runtimeEntry = join(directory, "fake-gateway.cjs");
  await writeFile(
    runtimeEntry,
    String.raw`
const fs = require("node:fs");
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const config = JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
const model = config.agents.defaults.model.primary;
const prompts = new Map();
const waiting = new Map();
const send = (socket, value) => socket.send(JSON.stringify(value));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request, server) {
    return server.upgrade(request) ? undefined : new Response("upgrade required", { status: 426 });
  },
  websocket: {
    open(socket) {
      send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test" } });
    },
    message(socket, raw) {
      const frame = JSON.parse(String(raw));
      const reply = payload => send(socket, { type: "res", id: frame.id, ok: true, payload });
      if (frame.method === "connect") return reply({ type: "hello-ok", protocol: 4 });
      if (frame.method === "agent") {
        const runId = frame.params.idempotencyKey;
        prompts.set(runId, frame.params.message);
        reply({ status: "accepted", runId });
        if (frame.params.message !== "hang")
          send(socket, { type: "event", event: "agent", payload: { runId, stream: "assistant", data: { delta: model + ":" + frame.params.message } } });
        return;
      }
      if (frame.method === "agent.wait") {
        if (prompts.get(frame.params.runId) === "hang") {
          waiting.set(frame.params.runId, { socket, id: frame.id });
          return;
        }
        return reply({ runId: frame.params.runId, status: "ok" });
      }
      if (frame.method === "chat.abort") {
        reply({ ok: true });
        const pending = waiting.get(frame.params.runId);
        if (pending) {
          waiting.delete(frame.params.runId);
          send(pending.socket, { type: "res", id: pending.id, ok: true, payload: { runId: frame.params.runId, status: "aborted" } });
        }
      }
    },
    close() { server.stop(); },
  },
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
    for (let attempt = 0; attempt < 800; attempt += 1) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `等待 OpenClaw Sidecar 消息超时：${JSON.stringify(messages)}`,
    );
  };

  try {
    await import(`./openclaw-sidecar.ts?unit=${Date.now()}`);
    send({
      type: "start",
      runtimeEntry,
      stateRoot,
      mcp: { url: "http://127.0.0.1:1/internal/mcp", token: "mcp-token" },
      provider: {
        providerKind: "openai",
        model: "model-one",
        secret: "provider-secret",
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

    const run = (requestId: string, prompt: string, id = sessionId) => {
      send({
        type: "request",
        requestId,
        operation: "run",
        payload: {
          engineSessionId: id,
          runId: `${requestId}-run`,
          prompt,
          projectId: "project-1",
        },
      });
      return next(
        (message) =>
          message.type === "response" && message.requestId === requestId,
      );
    };
    expect((await run("first", "hello")).result).toEqual({
      text: "dramaip/model-one:hello",
    });
    const firstGeneration = (await readdir(stateRoot))[0];
    const firstConfig = await readFile(
      join(stateRoot, firstGeneration!, "openclaw.json"),
      "utf8",
    );
    expect(firstConfig).not.toContain("provider-secret");
    expect(firstConfig).not.toContain("mcp-token");

    send({
      type: "configure",
      requestId: "configure",
      provider: {
        providerKind: "openai",
        model: "model-two",
        secret: "next-provider-secret",
      },
    });
    await next(
      (message) =>
        message.type === "configured" && message.requestId === "configure",
    );
    expect((await run("configured", "again")).result).toEqual({
      text: "dramaip/model-two:again",
    });
    expect(await readdir(stateRoot)).toHaveLength(1);

    void run("hanging", "hang");
    await new Promise((resolve) => setTimeout(resolve, 30));
    send({
      type: "request",
      requestId: "interrupt",
      operation: "interrupt",
      payload: { engineSessionId: sessionId },
    });
    await next(
      (message) =>
        message.type === "response" && message.requestId === "interrupt",
    );
    const interrupted = await next(
      (message) =>
        message.type === "response" && message.requestId === "hanging",
    );
    expect(String(interrupted.error)).toContain("运行失败");

    send({
      type: "request",
      requestId: "fork",
      operation: "fork",
      payload: { engineSessionId: sessionId },
    });
    const forked = await next(
      (message) => message.type === "response" && message.requestId === "fork",
    );
    const forkId = String((forked.result as Record<string, unknown>).id);
    expect(forkId).not.toBe(sessionId);
    expect((await run("fork-run", "branch", forkId)).result).toEqual({
      text: "dramaip/model-two:branch",
    });

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
    expect(existsSync(stateRoot)).toBe(false);
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
