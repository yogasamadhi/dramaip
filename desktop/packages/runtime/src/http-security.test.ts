import { describe, expect, it } from "vitest";
import { createRuntimeHttp, redactDiagnostics } from "@dramaip/http";

const events = {
  publishLive: () => undefined,
  subscribeLive: () => () => undefined,
  subscribeDomain: () => () => undefined,
  replay: () => [],
  registerConsumer: () => () => undefined,
  diagnostics: () => [],
  retryConsumer: () => false,
  dispose: () => undefined,
};

describe("Runtime HTTP diagnostics security", () => {
  it("recursively removes secrets, prompts, bearer values, and absolute paths", () => {
    expect(
      redactDiagnostics({
        accessToken: "top-secret",
        nested: {
          prompt: "private manuscript",
          databasePath: "/Users/person/DramaIP/dramaip.db",
          message: "failed with Bearer abc.def and apiKey=unsafe",
        },
      }),
    ).toEqual({
      accessToken: "[REDACTED]",
      nested: {
        prompt: "[REDACTED]",
        databasePath: "[REDACTED]",
        message: "failed with Bearer [REDACTED] and apiKey=[REDACTED]",
      },
    });
  });

  it("preserves a valid caller trace id and returns only redacted diagnostics", async () => {
    const traceId = "b3a471ae-8e7c-4b99-86d0-bd36dbc52791";
    const runtime = createRuntimeHttp({
      accessToken: "runtime-access-token-that-is-long-enough",
      allowedOrigins: [],
      events,
      version: "test",
      runtimeInfo: async () => ({}) as never,
      onDiagnostics: async () => ({
        healthy: true,
        credential: "credential-value",
        engine: { prompt: "never disclose this" },
      }),
    });
    const response = await runtime.fetch(
      new Request("http://runtime.test/api/v2/system/diagnostics", {
        headers: {
          Authorization: "Bearer runtime-access-token-that-is-long-enough",
          "X-Trace-Id": traceId,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trace-Id")).toBe(traceId);
    expect(await response.json()).toEqual({
      traceId,
      healthy: true,
      credential: "[REDACTED]",
      engine: { prompt: "[REDACTED]" },
    });
  });
});
