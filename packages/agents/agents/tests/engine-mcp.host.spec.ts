import { describe, expect, it } from "vitest";
import { createEngineMcp } from "../src/engine-mcp.ts";

describe("engine MCP boundary", () => {
  it("serves the authenticated, tool-free MCP handshake required by local engines", async () => {
    const http = {
      fetch: createEngineMcp({
        staticTokens: () => ["engine-token"],
        grant: () => undefined,
        callTool: async () => {
          throw new Error("no tool runs on a static token");
        },
        version: "3.0.0-alpha.3",
      }),
    };
    const request = (body: Record<string, unknown>) =>
      http.fetch(
        new Request("http://engine.test/engine/v1/mcp", {
          method: "POST",
          headers: {
            Authorization: "Bearer engine-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );

    const initialized = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(initialized.status).toBe(200);
    await expect(initialized.json()).resolves.toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
      },
    });
    const noSseStream = await http.fetch(
      new Request("http://engine.test/engine/v1/mcp", {
        headers: { Authorization: "Bearer engine-token" },
      }),
    );
    expect(noSseStream.status).toBe(405);
    const staticTools = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(staticTools.status).toBe(200);
    await expect(staticTools.json()).resolves.toMatchObject({
      result: { tools: [] },
    });
    const rejected = await http.fetch(
      new Request("http://engine.test/engine/v1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      }),
    );
    expect(rejected.status).toBe(401);
  });

  it("exposes only curl for a web-read grant and shares the per-run read quota", async () => {
    const calls: Array<{
      runId: string;
      name: string;
      arguments: Record<string, unknown>;
    }> = [];
    const handler = createEngineMcp({
      staticTokens: () => ["engine-token"],
      grant: (authorization) =>
        authorization === "Bearer curl-token" ||
        authorization === "Bearer empty-token"
          ? {
              kind: "grant",
              grantId: authorization,
              runId: "run-1",
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              capabilities:
                authorization === "Bearer curl-token" ? ["web.read"] : [],
            }
          : undefined,
      callTool: async (input) => {
        calls.push(input);
        return {
          title: "公开来源",
          url: input.arguments.url,
          content: "public text",
        };
      },
      version: "test",
    });
    const request = (token: string, method: string, params?: unknown) =>
      handler(
        new Request("http://engine.test/engine/v1/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
    const listed = await request("curl-token", "tools/list");
    const body = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "dramaip_curl",
    ]);
    await expect(
      (await request("empty-token", "tools/list")).json(),
    ).resolves.toMatchObject({ result: { tools: [] } });
    const unauthorized = await request("expired-token", "tools/list");
    expect(unauthorized.status).toBe(401);
    await expect(
      (
        await request("empty-token", "tools/call", {
          name: "dramaip_curl",
          arguments: { url: "https://public.example/" },
        })
      ).json(),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    for (const name of ["dramaip_web_search", "dramaip_read_web_page"]) {
      await expect(
        (
          await request("curl-token", "tools/call", {
            name,
            arguments: { query: "weather", url: "https://public.example/" },
          })
        ).json(),
      ).resolves.toMatchObject({ error: { code: -32602 } });
    }
    expect(calls).toHaveLength(0);
    for (let i = 0; i < 3; i++) {
      await expect(
        (
          await request("curl-token", "tools/call", {
            name: "dramaip_curl",
            arguments: { url: "https://public.example/", maxCharacters: 6000 },
          })
        ).json(),
      ).resolves.toMatchObject({
        result: { structuredContent: { url: "https://public.example/" } },
      });
    }
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      runId: "run-1",
      name: "dramaip_curl",
      arguments: { url: "https://public.example/", maxCharacters: 6000 },
    });
    await expect(
      (
        await request("curl-token", "tools/call", {
          name: "dramaip_curl",
          arguments: { url: "https://public.example/" },
        })
      ).json(),
    ).resolves.toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining("最多允许读取三个") }],
      },
    });
    expect(calls).toHaveLength(3);
  });
});
