import { expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PortMessage = Record<string, unknown> & { type: string };

test("LangGraph sidecar persists resumable state without credentials and exposes explicit unsupported operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-langgraph-sidecar-"));
  const sessionRoot = join(directory, "sessions");
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
  const bunDescriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    "bun",
  );
  const electronDescriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    "electron",
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
  Object.defineProperty(process.versions, "electron", {
    configurable: true,
    value: "test-electron",
  });
  delete (process.versions as Record<string, string | undefined>).bun;

  const send = (message: unknown) => listener?.({ data: message });
  const next = async (predicate: (message: PortMessage) => boolean) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `等待 LangGraph Sidecar 消息超时：${JSON.stringify(messages)}`,
    );
  };

  try {
    // Re-evaluate the sidecar module so it observes the mocked parent port.
    vi.resetModules();
    await import("./langgraph-sidecar.ts");
    send({
      type: "start",
      sessionRoot,
      provider: {
        providerKind: "openai",
        providerAdapter: "openai-compatible",
        model: "deepseek-chat",
        baseUrl: "https://model.example.test/v1",
        secret: "must-never-reach-disk",
      },
    });
    await next((message) => message.type === "ready");

    send({
      type: "request",
      requestId: "create",
      operation: "createSession",
      payload: {
        title: "LangGraph 会话",
        projectId: "project-1",
        model: { modelId: "deepseek-reasoner" },
      },
    });
    const created = await next(
      (message) =>
        message.type === "response" && message.requestId === "create",
    );
    const sessionId = String(
      (created.result as Record<string, unknown> | undefined)?.id ?? "",
    );
    expect(sessionId).not.toBe("");
    const snapshot = await readFile(
      join(sessionRoot, `${sessionId}.json`),
      "utf8",
    );
    expect(snapshot).toContain("deepseek-reasoner");
    expect(snapshot).not.toContain("must-never-reach-disk");
    expect(snapshot).not.toContain("credential");
    expect(snapshot).not.toContain("capability");

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

    send({
      type: "request",
      requestId: "resume",
      operation: "resume",
      payload: { engineSessionId: forkId },
    });
    const resumed = await next(
      (message) =>
        message.type === "response" && message.requestId === "resume",
    );
    expect(resumed.result).toEqual({ id: forkId });

    await writeFile(
      join(sessionRoot, "run-results", "completed-run.json"),
      JSON.stringify({ summary: "完成", content: "已恢复结果" }),
    );
    send({
      type: "request",
      requestId: "recover",
      operation: "recoverRun",
      payload: { runId: "completed-run", afterCursor: 4 },
    });
    const recovered = await next(
      (message) =>
        message.type === "response" && message.requestId === "recover",
    );
    expect(recovered.result).toEqual({
      disposition: "completed",
      result: { summary: "完成", content: "已恢复结果" },
      finalCursor: 5,
    });

    for (const operation of ["steer", "compact"]) {
      send({
        type: "request",
        requestId: operation,
        operation,
        payload: { engineSessionId: sessionId },
      });
      const unsupported = await next(
        (message) =>
          message.type === "response" && message.requestId === operation,
      );
      expect(String(unsupported.error)).toContain("UnsupportedOperation");
    }

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
    if (bunDescriptor)
      Object.defineProperty(process.versions, "bun", bunDescriptor);
    else delete (process.versions as Record<string, string | undefined>).bun;
    if (electronDescriptor)
      Object.defineProperty(process.versions, "electron", electronDescriptor);
    else
      delete (process.versions as Record<string, string | undefined>).electron;
    await rm(directory, { recursive: true, force: true });
  }
});
