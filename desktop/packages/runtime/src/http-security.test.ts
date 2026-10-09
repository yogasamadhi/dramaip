import { describe, expect, it } from "vitest";
import { createRuntimeHttp, redactDiagnostics } from "@dramaip/http";
import { createRoute } from "@hono/zod-openapi";
import { defineRouteContribution } from "@dramaip/plugin-api/internal";
import { z } from "zod";

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
  it("applies the current allowed origin and trace to cached mutation replies without replaying the owner", async () => {
    const accessToken = "runtime-access-token-that-is-long-enough";
    const origins = ["dramaip://app", "http://localhost:5177"];
    const runtime = createRuntimeHttp({
      accessToken,
      allowedOrigins: origins,
      events,
      version: "test",
      runtimeInfo: async () => ({}) as never,
      onDiagnostics: async () => ({}),
    });
    let calls = 0;
    runtime.registry.register(
      defineRouteContribution({
        id: "test:origin-replay",
        pluginId: "test",
        method: "post",
        path: "/api/v2/test/origin-replay",
        operationId: "test.originReplay",
        policy: { idempotency: "required", concurrency: "optional" },
        declaration: createRoute({
          method: "post",
          path: "/api/v2/test/origin-replay",
          responses: {
            200: {
              description: "Original mutation receipt",
              content: {
                "application/json": {
                  schema: z.object({ accepted: z.literal(true) }),
                },
              },
            },
          },
        }),
        handler: () => {
          calls++;
          return Response.json({ accepted: true });
        },
      }),
    );
    runtime.registry.publish();
    for (const firstOrigin of [undefined, origins[0]]) {
      const key = crypto.randomUUID();
      for (const origin of [firstOrigin, ...origins]) {
        const traceId = crypto.randomUUID();
        const response = await runtime.fetch(
          new Request("http://runtime.test/api/v2/test/origin-replay", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Idempotency-Key": key,
              "X-Trace-Id": traceId,
              ...(origin ? { Origin: origin } : {}),
            },
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ accepted: true });
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
          origin ?? null,
        );
        expect(response.headers.get("X-Trace-Id")).toBe(traceId);
      }
    }
    expect(calls).toBe(2);
  });
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
