import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DshRuntimeClient,
  mapDshSessionEvent,
  sanitizeDshDiagnostic,
} from "./dsh-jsonrpc";

const temporaryDirectories: string[] = [];
const clients: DshRuntimeClient[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const fakeRuntime = String.raw`
const readline = require("node:readline");
const fs = require("node:fs");
const mode = process.env.DSH_TEST_MODE || "success";
const marker = process.env.DSH_TEST_MARKER;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    if (mode === "invalid-json") return process.stdout.write("not-json\n");
    send({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "test" } } });
    return;
  }
  if (request.method === "session/prompt") {
    if (mode === "hang") return;
    if (mode === "crash") return process.exit(19);
    const sessionId = request.params.sessionId;
    send({ jsonrpc: "2.0", id: request.id, result: { messageId: "message-1" } });
    notify("session.event", { sessionId, event: { type: "agent/inbox/spliced", data: { inserted: [{ id: "message-1" }] } } });
    notify("session.status", { sessionId, status: "running" });
    notify("session.event", { sessionId, event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "完成" } } } });
    notify("session.event", { sessionId, event: { type: "tool/call", data: { callId: "call-1", name: "mcp__dramaip__read_context", arguments: "{\"chapterId\":\"c1\"}" } } });
    notify("session.event", { sessionId, event: { type: "tool/result", data: { message: { toolCallId: "call-1", content: [{ type: "text", text: "ok" }] } } } });
    notify("session.event", { sessionId, event: { type: "assistant/message", data: { usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, message: { content: [{ type: "text", text: "最终正文" }] } } } });
    notify("session.status", { sessionId, status: "idle" });
    return;
  }
  if (request.method === "shutdown") {
    if (marker) fs.writeFileSync(marker, "shutdown");
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    input.close();
  }
});
`;

async function runtime(mode = "success") {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-dsh-test-"));
  temporaryDirectories.push(directory);
  const marker = join(directory, "shutdown.txt");
  const client = new DshRuntimeClient({
    command: process.execPath,
    args: ["-e", fakeRuntime],
    cwd: directory,
    env: {
      ...process.env,
      DSH_TEST_MODE: mode,
      DSH_TEST_MARKER: marker,
    },
    requestTimeoutMs: 100,
  });
  clients.push(client);
  return { client, marker };
}

describe("DSH JSON-RPC adapter", () => {
  test("follows receipt through idle and normalizes streaming events", async () => {
    const { client } = await runtime();
    await client.start({ cwd: "/controlled", provider: "openai", model: "m" });
    const events: Array<Record<string, unknown>> = [];
    const result = await client.run("session-1", "继续", (event) =>
      events.push(event),
    );
    expect(result).toEqual({ text: "最终正文" });
    expect(events.map((event) => event.type)).toEqual([
      "content.delta",
      "tool",
      "tool",
      "usage",
    ]);
    expect(events[1]).toMatchObject({
      status: "started",
      tool: "mcp__dramaip__read_context",
      arguments: { chapterId: "c1" },
    });
    expect(events[3]).toMatchObject({
      inputTokens: 11,
      outputTokens: 3,
      cachedTokens: 2,
    });
  });

  test("rejects protocol errors, timeouts, and runtime crashes", async () => {
    const invalid = await runtime("invalid-json");
    await expect(
      invalid.client.start({
        cwd: "/controlled",
        provider: "openai",
        model: "m",
      }),
    ).rejects.toThrow("无效 JSON");

    const hanging = await runtime("hang");
    await hanging.client.start({
      cwd: "/controlled",
      provider: "openai",
      model: "m",
    });
    const timeoutMessage = await hanging.client
      .run("session-2", "继续", () => undefined, 30)
      .then(
        () => "",
        (error: Error) => error.message,
      );
    expect(timeoutMessage).toContain("超时");

    const crashing = await runtime("crash");
    await crashing.client.start({
      cwd: "/controlled",
      provider: "openai",
      model: "m",
    });
    const crashMessage = await crashing.client
      .run("session-3", "继续", () => undefined)
      .then(
        () => "",
        (error: Error) => error.message,
      );
    expect(crashMessage).toContain("已退出");
  });

  test("shutdown is graceful and diagnostics redact keys and paths", async () => {
    const { client, marker } = await runtime();
    await client.start({ cwd: "/controlled", provider: "openai", model: "m" });
    await client.close();
    expect(await readFile(marker, "utf8")).toBe("shutdown");
    expect(
      sanitizeDshDiagnostic(
        "Bearer secret-token sk-example123456 /Users/alice/private/project/file.txt",
      ),
    ).toBe("Bearer *** *** [本地路径已隐藏]");
  });

  test("ignores malformed and unrelated event envelopes", () => {
    const names = new Map<string, string>();
    expect(mapDshSessionEvent(42, names)).toEqual([]);
    expect(
      mapDshSessionEvent(
        { type: "assistant/chunk", data: { chunk: { type: "reasoning" } } },
        names,
      ),
    ).toEqual([]);
  });
});
