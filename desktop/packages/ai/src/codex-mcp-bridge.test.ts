import { afterEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { startCodexMcpBridge, type CodexMcpBridge } from "./codex-mcp-bridge";

let target: Server | undefined;
let bridge: CodexMcpBridge | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
  if (target?.listening)
    await new Promise<void>((resolve, reject) =>
      target!.close((error) => (error ? reject(error) : resolve())),
    );
  target = undefined;
});

async function startTarget() {
  const authorizations: string[] = [];
  target = createServer((request, response) => {
    authorizations.push(request.headers.authorization ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    target!.once("error", reject);
    target!.listen(0, "127.0.0.1", () => resolve());
  });
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  bridge = await startCodexMcpBridge({
    targetUrl: `http://127.0.0.1:${address.port}/engine/v1/mcp`,
    staticToken: "static-engine-token",
  });
  return authorizations;
}

describe("Codex MCP bridge", () => {
  test("switches run-scoped authorization without restarting Codex", async () => {
    const authorizations = await startTarget();
    const request = () =>
      fetch(bridge!.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bridge!.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    expect((await request()).status).toBe(200);
    bridge!.setGrant({
      token: "run-scoped-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await request()).status).toBe(200);
    bridge!.setGrant(undefined);
    expect((await request()).status).toBe(200);

    expect(authorizations).toEqual([
      "Bearer static-engine-token",
      "Bearer run-scoped-token",
      "Bearer static-engine-token",
    ]);
  });

  test("rejects callers that do not own the private bridge token", async () => {
    const authorizations = await startTarget();
    const response = await fetch(bridge!.baseUrl, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(authorizations).toEqual([]);
  });
});
