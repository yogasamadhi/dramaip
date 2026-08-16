import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";

import { HttpHostService } from "./service.ts";

const authorization = `Basic ${Buffer.from("launch:secret").toString("base64")}`;

test("HTTP host enforces Basic Auth and Origin", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin((pluginContext) => {
    new HttpHostService(pluginContext, {
      username: "launch",
      password: "secret",
      allowedOrigins: ["dramaip://app"],
    });
  });
  await fiber;
  assert.equal(
    (await ctx.http.fetch(new Request("http://127.0.0.1/api/v2/health")))
      .status,
    401,
  );
  assert.equal(
    (
      await ctx.http.fetch(
        new Request("http://127.0.0.1/api/v2/health", {
          headers: { authorization, origin: "https://attacker.example" },
        }),
      )
    ).status,
    403,
  );
  const preflight = await ctx.http.fetch(
    new Request("http://127.0.0.1/api/v2/health", {
      method: "OPTIONS",
      headers: {
        origin: "dramaip://app",
        "access-control-request-method": "GET",
      },
    }),
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "dramaip://app",
  );
  await fiber.dispose();
});

test("route contributions disappear with their Cordis Fiber", async () => {
  const ctx = new Context();
  const hostFiber = ctx.plugin((pluginContext) => {
    new HttpHostService(pluginContext, {
      username: "launch",
      password: "secret",
      allowedOrigins: [],
    });
  });
  await hostFiber;
  const routeFiber = ctx.plugin({
    inject: ["http"],
    apply(pluginContext) {
      pluginContext.http.register({
        id: "test.route",
        pluginId: "test",
        install(app) {
          app.get("/api/v2/test", (context) => context.json({ ok: true }));
        },
      });
    },
  });
  await routeFiber;
  const request = () =>
    new Request("http://127.0.0.1/api/v2/test", { headers: { authorization } });
  assert.equal((await ctx.http.fetch(request())).status, 200);
  await routeFiber.dispose();
  assert.equal((await ctx.http.fetch(request())).status, 404);
  await hostFiber.dispose();
});
