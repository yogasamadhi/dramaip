import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HermesAcpClient,
  mapHermesSessionUpdate,
  sanitizeHermesDiagnostic,
} from "./hermes-acp";

const directories: string[] = [];
const clients: HermesAcpClient[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const fakeAcp = String.raw`
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const update = (sessionId, value) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: value } });
input.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") return send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 } });
  if (request.method === "session/new") return send({ jsonrpc: "2.0", id: request.id, result: { sessionId: "acp-session" } });
  if (request.method === "session/prompt") {
    if (request.params.prompt[0].text === "hang") return;
    const id = request.params.sessionId;
    update(id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hermes " } });
    update(id, { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "read_context", rawInput: { chapterId: "c1" } });
    update(id, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "read_context", status: "completed", rawOutput: { ok: true } });
    update(id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "完成" } });
    return send({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn", usage: { inputTokens: 9, outputTokens: 4, cachedReadTokens: 2 } } });
  }
  if (request.method === "session/cancel") process.exit(0);
});
`;

async function client(): Promise<HermesAcpClient> {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-hermes-acp-"));
  directories.push(directory);
  const entry = join(directory, "fake-acp.cjs");
  await writeFile(entry, fakeAcp);
  const result = new HermesAcpClient({
    pythonPath: process.execPath,
    adapterPath: entry,
    projectRoot: directory,
    cwd: directory,
    env: { ...process.env },
    mcp: { url: "http://127.0.0.1:1/internal/mcp", token: "mcp-token" },
    requestTimeoutMs: 200,
  });
  clients.push(result);
  return result;
}

describe("Hermes ACP adapter", () => {
  test("redacts arbitrary in-memory credentials from diagnostics", () => {
    expect(
      sanitizeHermesDiagnostic("credential=provider-secret-value", [
        "provider-secret-value",
      ]),
    ).toBe("credential=***");
  });

  test("initializes ACP and normalizes text, tools, and usage", async () => {
    const runtime = await client();
    await runtime.start();
    const events: Array<Record<string, unknown>> = [];
    await expect(
      runtime.run("continue", (event) => events.push(event)),
    ).resolves.toEqual({ text: "Hermes 完成" });
    expect(events.map((event) => event.type)).toEqual([
      "content.delta",
      "tool",
      "tool",
      "content.delta",
      "usage",
    ]);
    expect(events[1]).toMatchObject({
      status: "started",
      tool: "read_context",
      server: "dramaip",
    });
    expect(events.at(-1)).toMatchObject({
      inputTokens: 9,
      outputTokens: 4,
      cachedTokens: 2,
    });
  });

  test("cancel closes the child and rejects an active prompt without waiting for timeout", async () => {
    const runtime = await client();
    await runtime.start();
    const pending = runtime
      .run("hang", () => undefined)
      .then(
        () => "",
        (error: Error) => error.message,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runtime.close();
    expect(await pending).toContain("已中断");
  });

  test("redacts credentials and ignores malformed updates", () => {
    expect(
      sanitizeHermesDiagnostic(
        "Bearer secret-token sk-example123456 /Users/alice/private/file.txt",
      ),
    ).toBe("Bearer *** *** [本地路径已隐藏]");
    expect(
      mapHermesSessionUpdate({ update: { sessionUpdate: "other" } }),
    ).toEqual([]);
  });
});
