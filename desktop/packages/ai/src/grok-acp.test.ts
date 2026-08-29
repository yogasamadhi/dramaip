import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  GROK_READ_ONLY_AGENT_PROFILE,
  GrokAcpClient,
  isGrokReadOnlyToolset,
  mapGrokSessionUpdate,
  sanitizeGrokDiagnostic,
} from "./grok-acp";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Grok ACP protocol adapter", () => {
  test("maps streamed text, tool calls, completion and usage", () => {
    const toolNames = new Map<string, string>();
    expect(
      mapGrokSessionUpdate(
        {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
          _meta: { usage: { inputTokens: 12, outputTokens: 4 } },
        },
        toolNames,
      ),
    ).toEqual([
      { type: "content.delta", delta: "hello" },
      { type: "usage", inputTokens: 12, outputTokens: 4, cachedTokens: 0 },
    ]);
    expect(
      mapGrokSessionUpdate(
        {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            title: "dramaip_web_search",
            rawInput: { projectId: "p1" },
          },
        },
        toolNames,
      ),
    ).toEqual([
      {
        type: "tool",
        status: "started",
        tool: "dramaip_web_search",
        server: "dramaip",
        itemId: "call-1",
        arguments: { projectId: "p1" },
      },
    ]);
    expect(
      mapGrokSessionUpdate(
        {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            rawOutput: { rows: 1 },
          },
        },
        toolNames,
      ),
    ).toEqual([
      {
        type: "tool",
        status: "completed",
        tool: "dramaip_web_search",
        server: "dramaip",
        itemId: "call-1",
        result: { rows: 1 },
      },
    ]);
  });

  test("keeps the profile fail-closed and removes credentials from diagnostics", () => {
    expect(GROK_READ_ONLY_AGENT_PROFILE.tools).toEqual([
      "search_tool",
      "use_tool",
    ]);
    expect(GROK_READ_ONLY_AGENT_PROFILE.disallowedTools).toEqual(["Agent"]);
    expect(GROK_READ_ONLY_AGENT_PROFILE.mcpInheritance).toBe("none");
    expect(GROK_READ_ONLY_AGENT_PROFILE.discoverSkills).toBe(false);
    expect(isGrokReadOnlyToolset(["search_tool", "use_tool"])).toBe(true);
    expect(
      isGrokReadOnlyToolset(["search_tool", "use_tool", "read_file"]),
    ).toBe(false);
    expect(isGrokReadOnlyToolset(undefined)).toBe(false);
    expect(
      sanitizeGrokDiagnostic(
        "Bearer mcp-token /Users/alice/project/file.txt sk-secret-value",
        ["mcp-token", "sk-secret-value"],
      ),
    ).not.toContain("mcp-token");
    expect(
      sanitizeGrokDiagnostic(
        "Bearer mcp-token /Users/alice/project/file.txt sk-secret-value",
        ["mcp-token", "sk-secret-value"],
      ),
    ).toContain("[本地路径已隐藏]");
  });

  test("runs an ACP session and rejects reverse local-capability RPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dramaip-grok-acp-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "reverse-rpc.txt");
    const grantMarker = join(directory, "run-grant.txt");
    const server = join(directory, "fake-grok.mjs");
    await writeFile(
      server,
      `import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const marker = ${JSON.stringify(marker)};
const grantMarker = ${JSON.stringify(grantMarker)};
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === 99) {
    appendFileSync(marker, message.error?.code === -32601 ? "rejected" : "allowed");
    continue;
  }
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [], _meta: { tools: ["search_tool", "use_tool"] } } } });
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
  }
  if (message.method === "session/load") {
    appendFileSync(grantMarker, JSON.stringify(message.params));
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: message.params.sessionId } });
  }
  if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [], _meta: { tools: [] } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [], _meta: { tools: ["search_tool", "use_tool"] } } } });
    send({ jsonrpc: "2.0", method: "x.ai/session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } });
    send({ jsonrpc: "2.0", id: 99, method: "fs/readTextFile", params: {} });
    send({ jsonrpc: "2.0", id: message.id, result: { usage: { inputTokens: 1, outputTokens: 2 } } });
  }
}`,
      "utf8",
    );
    const client = new GrokAcpClient({
      binaryPath: process.execPath,
      cwd: directory,
      grokHome: directory,
      env: { ...process.env, NODE_OPTIONS: "", FAKE_GROK_SCRIPT: server },
      mcp: { url: "http://127.0.0.1/mcp", token: "mcp-token" },
      model: "dramaip",
    });
    // Node is used as a tiny deterministic ACP fixture; argv[1] is the
    // normal Node script path, so execute the fixture through a wrapper.
    const wrapper = join(directory, "grok-wrapper.sh");
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$FAKE_GROK_SCRIPT"\n`,
      "utf8",
    );
    await chmod(wrapper, 0o755);
    (
      client as unknown as { options: { binaryPath: string } }
    ).options.binaryPath = wrapper;
    await client.start();
    expect(await client.rebindSessionMcp("s1", "run-grant-token")).toBe("s1");
    const grantRequest = await readFile(grantMarker, "utf8");
    expect(grantRequest).toContain("Bearer run-grant-token");
    expect(grantRequest).not.toContain("Bearer mcp-token");
    const events: Record<string, unknown>[] = [];
    await client.run("hello", (event) => events.push(event));
    expect(events).toEqual([
      { type: "content.delta", delta: "ok" },
      { type: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 0 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await readFile(marker, "utf8")).toBe("rejected");
    await client.close();
  });
});
