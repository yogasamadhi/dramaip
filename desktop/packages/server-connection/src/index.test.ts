import { describe, expect, it } from "vitest";
import { ServerConnectionManager } from "./index.js";

const runtime = {
  runtimeId: "c6af6a4e-8ff9-43ff-8257-4d0a9d6d9741",
  runtimeGeneration: 1,
  graphRevision: "a".repeat(64),
  startedAt: "2026-08-23T00:00:00.000Z",
  runtimeVersion: "3.0.0-alpha.3",
  apiVersion: "2",
  pluginApiVersion: "1",
  runtimeKind: "node",
  mode: "headless",
  profile: "safe",
  bundles: ["core"],
  plugins: [],
  capabilities: {},
  capabilityDescriptors: {},
  engineStatus: {},
  uiContributions: [],
};

describe("ServerConnectionManager", () => {
  it("discovers, authenticates and negotiates a compatible runtime", async () => {
    const requests: Request[] = [];
    const manager = new ServerConnectionManager({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/health"))
          return Response.json({ healthy: true, apiVersion: "2" });
        return Response.json(runtime);
      },
    });
    const connection = await manager.attach({
      baseUrl: "http://127.0.0.1:8787",
      accessToken: "a".repeat(32),
      source: "attached",
    });
    expect(manager.state).toBe("ready");
    expect(connection.runtime.runtimeId).toBe(runtime.runtimeId);
    expect(requests.at(-1)?.headers.get("Authorization")).toBe(
      `Bearer ${"a".repeat(32)}`,
    );
  });

  it("does not accept incompatible API versions", async () => {
    const manager = new ServerConnectionManager({
      fetch: async (input) => {
        const url = String(input);
        return Response.json(
          url.endsWith("/health")
            ? { healthy: true, apiVersion: "3" }
            : runtime,
        );
      },
    });
    await expect(
      manager.attach({
        baseUrl: "http://127.0.0.1:8787",
        accessToken: "a".repeat(32),
        source: "attached",
      }),
    ).rejects.toThrow("incompatible");
    expect(manager.state).toBe("incompatible");
  });

  it("never retries a mutation but retries one safe GET after reconnect", async () => {
    let getAttempts = 0;
    let mutationAttempts = 0;
    const manager = new ServerConnectionManager({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/health"))
          return Response.json({ healthy: true, apiVersion: "2" });
        if (request.url.endsWith("/api/v2/runtime"))
          return Response.json(runtime);
        if (request.method === "POST") {
          mutationAttempts += 1;
          throw new Error("connection closed after commit");
        }
        getAttempts += 1;
        if (getAttempts === 1) throw new Error("temporary disconnect");
        return Response.json({ ok: true });
      },
    });
    await manager.attach({
      baseUrl: "http://127.0.0.1:8787",
      accessToken: "a".repeat(32),
      source: "attached",
    });
    const transport = manager.createTransport();
    expect(
      await (
        await transport.fetch("http://127.0.0.1:8787/api/v2/example")
      ).json(),
    ).toEqual({ ok: true });
    await expect(
      transport.fetch("http://127.0.0.1:8787/api/v2/example", {
        method: "POST",
      }),
    ).rejects.toThrow("connection closed after commit");
    expect(mutationAttempts).toBe(1);
  });
});
