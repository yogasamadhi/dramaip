import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("Pi Sidecar isolates sessions and rebuilds embedded runtimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-pi-sidecar-"));
  const sessionRoot = join(directory, "sessions");
  const runtimeModule = join(directory, "fake-pi-runtime.mjs");
  await writeFile(
    runtimeModule,
    String.raw`
export async function createPiSession(options) {
  let rejectActive;
  return {
    run(prompt, onEvent) {
      if (prompt === "hang") {
        return new Promise((_resolve, reject) => { rejectActive = reject; });
      }
      const text = options.provider.model + ":" + prompt;
      onEvent({ type: "content.delta", delta: text });
      onEvent({ type: "usage", inputTokens: 2, outputTokens: 1, cachedTokens: 0 });
      return Promise.resolve({ text });
    },
    async abort() {
      rejectActive?.(new Error("Pi 运行已中断"));
      rejectActive = undefined;
    },
    async close() {
      rejectActive?.(new Error("Pi 运行已中断"));
      rejectActive = undefined;
    },
  };
}
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
    throw new Error(`等待 Pi Sidecar 消息超时：${JSON.stringify(messages)}`);
  };

  try {
    await import(`./pi-sidecar.ts?unit=${Date.now()}`);
    send({
      type: "start",
      runtimeModule,
      sessionRoot,
      mcp: { url: "http://127.0.0.1:1/internal/mcp", token: "mcp-token" },
      provider: {
        providerKind: "openai",
        model: "model-one",
        secret: "provider-secret",
      },
    });
    const ready = await next((message) => message.type === "ready");
    expect(ready.version).toBe("0.84.2");

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
