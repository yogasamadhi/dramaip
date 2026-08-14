import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("Hermes Sidecar isolates sessions and rebuilds ACP runtimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-hermes-sidecar-"));
  const projectRoot = join(directory, "project");
  const sitePackages = join(directory, "site-packages");
  const sessionRoot = join(directory, "sessions");
  const adapterPath = join(directory, "fake-acp.cjs");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(sitePackages, { recursive: true }),
  ]);
  await writeFile(
    adapterPath,
    String.raw`
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const update = (sessionId, value) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: value } });
input.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") return send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 } });
  if (request.method === "session/new") return send({ jsonrpc: "2.0", id: request.id, result: { sessionId: "acp-" + process.pid } });
  if (request.method === "session/prompt") {
    if (request.params.prompt[0].text === "hang") return;
    const sessionId = request.params.sessionId;
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: process.env.DRAMAIP_HERMES_MODEL + ":" + request.params.prompt[0].text } });
    return send({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn", usage: { inputTokens: 2, outputTokens: 1 } } });
  }
  if (request.method === "session/cancel") process.exit(0);
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
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `等待 Hermes Sidecar 消息超时：${JSON.stringify(messages)}`,
    );
  };

  try {
    await import(`./hermes-sidecar.ts?unit=${Date.now()}`);
    send({
      type: "start",
      pythonPath: process.execPath,
      adapterPath,
      projectRoot,
      sitePackages,
      sessionRoot,
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
      text: "model-one:hello",
    });

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
      text: "model-two:again",
    });

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
    expect(String(interrupted.error)).toContain("已中断");
    expect((await run("resumed", "resume")).result).toEqual({
      text: "model-two:resume",
    });

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
      text: "model-two:branch",
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
    expect(existsSync(sessionRoot)).toBe(false);
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
