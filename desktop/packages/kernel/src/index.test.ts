import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { bootKernel, validatePluginGraph } from "./index.js";
import { defineServiceContract } from "@dramaip/contracts";
import {
  definePlugin,
  provideService,
  requireService,
  optionalService,
  type FirstPartyPlugin,
  type PluginContext,
  type PluginProfile,
} from "@dramaip/plugin-api/internal";

const profile: PluginProfile = {
  name: "test",
  bundles: ["core"],
  plugins: [{ id: "foundation" }, { id: "system" }],
};
function plugin(
  id: string,
  requires: string[] = [],
  apply: (ctx: PluginContext) => unknown = () => undefined,
): FirstPartyPlugin {
  return definePlugin({
    descriptor: {
      id,
      version: "3.0.0-alpha.3",
      requires,
      stability: "internal",
    },
    apply,
  });
}
const context = {
  http: { routeIds: [], register: () => () => undefined },
  domainEvents: {
    publishLive: () => undefined,
    subscribeLive: () => () => undefined,
    subscribeDomain: () => () => undefined,
    replay: () => [],
    registerConsumer: () => () => undefined,
    diagnostics: () => [],
    retryConsumer: () => false,
    dispose: () => undefined,
  },
  uow: {
    execute: <T>(work: (transaction: never) => T) => work(undefined as never),
    onAfterCommit: () => () => undefined,
  },
};
const start = (...plugins: FirstPartyPlugin[]) =>
  bootKernel({
    graphRevision: "test-graph",
    profile,
    plugins: new Map(plugins.map((p) => [p.descriptor.id, p])),
    context,
  });
const contract = defineServiceContract<{ value: number }>({
  id: "foundation.test-service.v1",
  owner: "foundation",
  major: 1,
  capabilities: ["read"],
});

describe("native Cordis kernel", () => {
  it("validates missing and circular product dependencies before loading", () => {
    expect(() =>
      validatePluginGraph(
        new Map([["system", plugin("system", ["foundation"])]]),
        { ...profile, plugins: [{ id: "system" }] },
      ),
    ).toThrow("requires foundation");
    expect(() =>
      validatePluginGraph(
        new Map([
          ["foundation", plugin("foundation", ["system"])],
          ["system", plugin("system", ["foundation"])],
        ]),
        profile,
      ),
    ).toThrow("cycle");
  });
  it("delays a consumer until its asynchronous provider becomes available", async () => {
    let observed = 0;
    const kernel = await start(
      plugin("system", ["foundation"], (ctx) => {
        observed = requireService(ctx, contract).value;
      }),
      plugin("foundation", [], async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ctx.effect(
          () => provideService(ctx, contract, { value: 42 }),
          "service:test",
        );
      }),
    );
    expect(observed).toBe(42);
    expect(kernel.context).toBeInstanceOf(Context);
    expect(kernel.diagnostics().services).toEqual([
      expect.objectContaining({
        id: contract.id,
        owner: "foundation",
        major: 1,
      }),
    ]);
    await kernel.dispose();
  });
  it("unwinds acquisition when an asynchronous plugin fails", async () => {
    const cleaned: string[] = [];
    await expect(
      start(
        plugin("foundation", [], () => () => {
          cleaned.push("foundation");
        }),
        plugin("system", ["foundation"], async (ctx) => {
          ctx.effect(
            () => () => {
              cleaned.push("system");
            },
            "partial-resource",
          );
          await Promise.resolve();
          throw new Error("async activation failed");
        }),
      ),
    ).rejects.toThrow("async activation failed");
    expect(cleaned.sort()).toEqual(["foundation", "system"]);
  });
  it("tracks native effects and waits for explicitly ordered resource cleanup once", async () => {
    const cleaned: string[] = [];
    const kernel = await start(
      plugin("foundation", [], (ctx) => {
        ctx.effect(
          () => async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            cleaned.push("requests drained");
            cleaned.push("database closed");
          },
          "ordered-resources",
        );
      }),
      plugin("system", ["foundation"]),
    );
    expect(kernel.diagnostics().effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "foundation",
          label: "ordered-resources",
          graphRevision: "test-graph",
        }),
      ]),
    );
    await Promise.all([kernel.dispose(), kernel.dispose()]);
    expect(cleaned).toEqual(["requests drained", "database closed"]);
  });
  it("continues native disposal after a cleanup exception", async () => {
    let cleaned = false;
    const kernel = await start(
      plugin("foundation", [], (ctx) => {
        ctx.effect(
          () => () => {
            cleaned = true;
          },
          "good",
        );
        ctx.effect(
          () => () => {
            throw new Error("cleanup failed");
          },
          "bad",
        );
      }),
      plugin("system", ["foundation"]),
    );
    await kernel.dispose();
    expect(cleaned).toBe(true);
  });
  it("rejects duplicate and wrong-owner service providers", async () => {
    await expect(
      start(
        plugin("foundation", [], (ctx) => {
          provideService(ctx, contract, { value: 1 });
          provideService(ctx, contract, { value: 2 });
        }),
        plugin("system", ["foundation"]),
      ),
    ).rejects.toThrow(/duplicate|registered/i);
    await expect(
      start(
        plugin("foundation"),
        plugin("system", ["foundation"], (ctx) => {
          provideService(ctx, contract, { value: 1 });
        }),
      ),
    ).rejects.toThrow("owned by foundation");
  });
  it("fails when a required service is absent or a strict service is requested optionally", async () => {
    await expect(
      start(
        plugin("foundation"),
        plugin("system", ["foundation"], (ctx) => {
          requireService(ctx, contract);
        }),
      ),
    ).rejects.toThrow("required service is unavailable");
    await expect(
      start(
        plugin("foundation", [], (ctx) => {
          optionalService(ctx, contract);
        }),
        plugin("system", ["foundation"]),
      ),
    ).rejects.toThrow("not declared degradable");
  });
  it("rejects a settled pending fiber instead of publishing a partial graph", async () => {
    const pending = definePlugin({
      descriptor: {
        id: "system",
        version: "3.0.0",
        stability: "internal",
        requires: ["foundation"],
      },
      inject: ["missing.service"],
      apply: () => undefined,
    });
    await expect(start(plugin("foundation"), pending)).rejects.toThrow(
      /missing.service/,
    );
  });
  it("rejects missing dependencies in child capabilities", async () => {
    await expect(
      start(
        plugin("foundation", [], (ctx) => {
          ctx.plugin({
            name: "pending-child",
            inject: ["child.missing"],
            apply() {},
          });
        }),
        plugin("system", ["foundation"]),
      ),
    ).rejects.toThrow("child.missing");
  });
  it("withdraws and restarts native service dependents", async () => {
    const ctx = new Context();
    let activated = 0;
    let disposed = 0;
    const consumer = ctx.plugin({
      inject: ["number"],
      apply: () => {
        activated++;
        return () => {
          disposed++;
        };
      },
    });
    await consumer.await();
    expect(activated).toBe(0);
    const release = ctx.provide("number", 1);
    await consumer.await();
    expect(activated).toBe(1);
    await release();
    await consumer.await();
    expect(disposed).toBe(1);
    ctx.provide("number", 2);
    await consumer.await();
    expect(activated).toBe(2);
    await ctx.fiber.dispose();
    expect(disposed).toBe(2);
  });
});
