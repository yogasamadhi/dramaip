import { describe, expect, it } from "vitest";
import { ServerConnectionManager } from "./index.js";

const runtime = {
  runtimeId: "c6af6a4e-8ff9-43ff-8257-4d0a9d6d9741",
  runtimeVersion: "3.0.0-alpha.3",
  apiVersion: "2",
  pluginApiVersion: "1",
  runtimeKind: "node",
  mode: "headless",
  profile: "safe",
  bundles: ["core"],
  plugins: [],
  capabilities: {},
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
    expect(manager.state).toBe("degraded");
  });
});
