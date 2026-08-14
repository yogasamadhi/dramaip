import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mapOpenClawAgentEvent,
  OpenClawGatewayClient,
  sanitizeOpenClawDiagnostic,
} from "./openclaw-gateway";
import { restrictedOpenClawConfiguration } from "./openclaw-config";

const directories: string[] = [];
const clients: OpenClawGatewayClient[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const fakeGateway = String.raw`
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const send = (socket, value) => socket.send(JSON.stringify(value));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request, server) {
    return server.upgrade(request) ? undefined : new Response("upgrade required", { status: 426 });
  },
  websocket: {
    open(socket) {
      send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
    },
    message(socket, raw) {
      const frame = JSON.parse(String(raw));
      const reply = payload => send(socket, { type: "res", id: frame.id, ok: true, payload });
      if (frame.method === "connect") return reply({ type: "hello-ok", protocol: 4 });
      if (frame.method === "agent") {
        reply({ status: "accepted", runId: frame.params.idempotencyKey });
        send(socket, { type: "event", event: "agent", payload: { runId: frame.params.idempotencyKey, stream: "assistant", data: { delta: "Open" } } });
        send(socket, { type: "event", event: "agent", payload: { runId: frame.params.idempotencyKey, stream: "tool", data: { phase: "start", name: "dramaip__read_context", toolCallId: "t1", args: {} } } });
        send(socket, { type: "event", event: "agent", payload: { runId: frame.params.idempotencyKey, stream: "tool", data: { phase: "result", name: "dramaip__read_context", toolCallId: "t1", result: { ok: true } } } });
        send(socket, { type: "event", event: "agent", payload: { runId: frame.params.idempotencyKey, stream: "assistant", data: { delta: "Claw", usage: { inputTokens: 8, outputTokens: 2, cacheReadTokens: 1 } } } });
        return;
      }
      if (frame.method === "agent.wait") return reply({ runId: frame.params.runId, status: "ok" });
      if (frame.method === "chat.abort") return reply({ ok: true });
    },
    close() { server.stop(); },
  },
});
`;

async function gateway(port: number): Promise<OpenClawGatewayClient> {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-openclaw-gateway-"));
  directories.push(directory);
  const entry = join(directory, "fake-gateway.cjs");
  await writeFile(entry, fakeGateway);
  const client = new OpenClawGatewayClient({
    command: process.execPath,
    entryPath: entry,
    cwd: directory,
    stateDirectory: directory,
    configPath: join(directory, "openclaw.json"),
    port,
    token: "gateway-token",
    env: { ...process.env },
    startupTimeoutMs: 2_000,
  });
  clients.push(client);
  return client;
}

describe("OpenClaw Gateway v4 adapter", () => {
  test("redacts arbitrary in-memory credentials from diagnostics", () => {
    expect(
      sanitizeOpenClawDiagnostic("credential=provider-secret-value", [
        "provider-secret-value",
      ]),
    ).toBe("credential=***");
  });

  test("uses direct Gateway RPC and normalizes streaming/tool/usage events", async () => {
    const client = await gateway(46_321);
    await client.start();
    const events: Array<Record<string, unknown>> = [];
    await expect(
      client.run(
        { runId: "run-1", sessionKey: "agent:main:test", prompt: "go" },
        (event) => events.push(event),
      ),
    ).resolves.toEqual({ text: "OpenClaw" });
    expect(events.map((event) => event.type)).toEqual([
      "content.delta",
      "tool",
      "tool",
      "content.delta",
      "usage",
    ]);
    expect(events[1]).toMatchObject({
      tool: "dramaip__read_context",
      status: "started",
    });
  });

  test("restricted config has one model, no fallback, plugins, or native tools", () => {
    const config = restrictedOpenClawConfiguration(
      { url: "http://127.0.0.1:9/internal/mcp" },
      {
        providerKind: "anthropic",
        model: "claude-test",
        secret: "provider-secret-not-written",
      },
      "claude-test",
      "/controlled/workspace",
    );
    const text = JSON.stringify(config);
    expect(text).toContain('"api":"anthropic-messages"');
    expect(text).toContain('"fallbacks":[]');
    expect(text).toContain('"allow":["bundle-mcp","dramaip__*"]');
    expect(text).toContain('"plugins":{"enabled":false');
    expect(text).toContain(
      '"apiKey":{"source":"env","provider":"default","id":"DRAMAIP_OPENCLAW_API_KEY"}',
    );
    expect(text).toContain('"Authorization":"Bearer ${DRAMAIP_MCP_TOKEN}"');
    expect(text).not.toContain("provider-secret-not-written");
    expect(text).not.toContain("not-written");
    for (const nativeTool of [
      "exec",
      "read",
      "write",
      "browser",
      "sessions_spawn",
    ])
      expect(text).not.toContain(`"${nativeTool}"`);
  });

  test("maps lifecycle usage and redacts diagnostics", () => {
    expect(
      mapOpenClawAgentEvent({
        stream: "lifecycle",
        data: { usage: { promptTokens: 3, completionTokens: 2 } },
      }),
    ).toEqual([
      { type: "usage", inputTokens: 3, outputTokens: 2, cachedTokens: 0 },
    ]);
    expect(
      sanitizeOpenClawDiagnostic(
        "Bearer token sk-example123456 /Users/alice/private/file.txt",
      ),
    ).toBe("Bearer *** *** [本地路径已隐藏]");
  });
});
