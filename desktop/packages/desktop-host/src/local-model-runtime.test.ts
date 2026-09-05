import { describe, expect, it } from "bun:test";
import { discoverLocalModelRuntime } from "./index.js";

describe("local model runtime discovery", () => {
  it("discovers Ollama only through its fixed loopback APIs", async () => {
    const requested: string[] = [];
    const runtime = await discoverLocalModelRuntime(
      "ollama",
      true,
      async (input, init) => {
        const url = String(input);
        requested.push(url);
        expect(init?.redirect).toBe("manual");
        if (url.endsWith("/api/version"))
          return Response.json({ version: "0.12.0" });
        return Response.json({
          models: [{ name: "qwen3:8b", size: 8_000, digest: "sha256:test" }],
        });
      },
    );

    expect(requested).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/version",
    ]);
    expect(runtime).toMatchObject({
      kind: "ollama",
      endpointRef: "local-model-runtime:ollama",
      state: "active",
      version: "0.12.0",
      models: [{ id: "qwen3:8b", sizeBytes: 8_000 }],
    });
    expect(JSON.stringify(runtime)).not.toContain("11434");
  });

  it("accepts the LM Studio v1 model shape and rejects redirects", async () => {
    const runtime = await discoverLocalModelRuntime(
      "lm_studio",
      false,
      async (input) => {
        if (String(input).endsWith("/api/v0/models"))
          return new Response("not found", { status: 404 });
        return Response.json({ data: [{ id: "local/qwen", name: "Qwen" }] });
      },
    );
    expect(runtime).toMatchObject({
      state: "inactive",
      models: [{ id: "local/qwen", displayName: "Qwen" }],
    });

    const redirected = await discoverLocalModelRuntime(
      "ollama",
      false,
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.invalid/models" },
        }),
    );
    expect(redirected).toMatchObject({
      state: "unavailable",
      models: [],
    });
  });
});
