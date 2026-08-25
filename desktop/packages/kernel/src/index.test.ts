import { describe, expect, it } from "vitest";
import { bootKernel, validatePluginGraph } from "./index.js";
import { defineServiceContract } from "@dramaip/contracts";
import {
  defineFirstPartyPlugin,
  type FirstPartyPlugin,
  type PluginProfile,
} from "@dramaip/plugin-api/internal";

const profile: PluginProfile = {
  name: "test",
  bundles: ["core"],
  plugins: [{ id: "foundation" }, { id: "system" }],
};

function plugin(id: string, requires: string[] = []): FirstPartyPlugin {
  return defineFirstPartyPlugin({
    descriptor: {
      id,
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires,
      stability: "internal",
    },
    activate: () => undefined,
  });
}

const context = {
  http: { routeIds: [], register: () => () => undefined },
  events: {
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

describe("first-party kernel", () => {
  it("orders dependencies before dependents", () => {
    const plugins = new Map([
      ["system", plugin("system", ["foundation"])],
      ["foundation", plugin("foundation")],
    ]);
    expect(validatePluginGraph(plugins, profile)).toEqual([
      "foundation",
      "system",
    ]);
  });

  it("reports missing profile dependencies", () => {
    const plugins = new Map([["system", plugin("system", ["foundation"])]]);
    expect(() =>
      validatePluginGraph(plugins, {
        name: "test",
        bundles: ["core"],
        plugins: [{ id: "system" }],
      }),
    ).toThrow("requires foundation");
  });

  it("cleans active plugins in reverse order after activation failure", async () => {
    const cleaned: string[] = [];
    const plugins = new Map<string, FirstPartyPlugin>([
      [
        "foundation",
        {
          ...plugin("foundation"),
          activate: () => () => {
            cleaned.push("foundation");
          },
        },
      ],
      [
        "system",
        {
          ...plugin("system", ["foundation"]),
          activate: () => {
            throw new Error("boom");
          },
        },
      ],
    ]);
    await expect(
      bootKernel({
        graphRevision: "test-graph",
        profile,
        plugins,
        context,
      }),
    ).rejects.toThrow("boom");
    expect(cleaned).toEqual(["foundation"]);
  });

  it("tracks effects by owner and disposes them in reverse registration order", async () => {
    const cleaned: string[] = [];
    const plugins = new Map<string, FirstPartyPlugin>([
      [
        "foundation",
        {
          ...plugin("foundation"),
          activate: (pluginContext) => {
            pluginContext.effect("first", () => () => {
              cleaned.push("first");
            });
            pluginContext.effect("second", () => () => {
              cleaned.push("second");
            });
          },
        },
      ],
      ["system", plugin("system", ["foundation"])],
    ]);
    const kernel = await bootKernel({
      graphRevision: "test-graph",
      profile,
      plugins,
      context,
    });
    expect(kernel.diagnostics().effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "foundation", label: "first" }),
        expect.objectContaining({ owner: "foundation", label: "second" }),
      ]),
    );
    await kernel.dispose();
    expect(cleaned).toEqual(["second", "first"]);
  });

  it("provides and requires an owner-scoped, major-versioned service", async () => {
    const contract = defineServiceContract<{ value: number }>({
      id: "foundation.test-service.v1",
      owner: "foundation",
      major: 1,
      capabilities: ["read"],
    });
    let observed = 0;
    const plugins = new Map<string, FirstPartyPlugin>([
      [
        "foundation",
        {
          ...plugin("foundation"),
          activate: (pluginContext) => {
            pluginContext.effect("service:test", () =>
              pluginContext.services.provide(contract, { value: 42 }),
            );
          },
        },
      ],
      [
        "system",
        {
          ...plugin("system", ["foundation"]),
          activate: (pluginContext) => {
            observed = pluginContext.services.require(contract).value;
          },
        },
      ],
    ]);
    const kernel = await bootKernel({
      graphRevision: "test-graph",
      profile,
      plugins,
      context,
    });

    expect(observed).toBe(42);
    expect(kernel.diagnostics().services).toEqual([
      expect.objectContaining({
        id: "foundation.test-service.v1",
        owner: "foundation",
        major: 1,
        capabilities: ["read"],
      }),
    ]);
    await kernel.dispose();
  });

  it("fails activation when a required service is unavailable", async () => {
    const contract = defineServiceContract<{ value: number }>({
      id: "foundation.required-test.v1",
      owner: "foundation",
      major: 1,
    });
    const plugins = new Map<string, FirstPartyPlugin>([
      ["foundation", plugin("foundation")],
      [
        "system",
        {
          ...plugin("system", ["foundation"]),
          activate: (pluginContext) => {
            pluginContext.services.require(contract);
          },
        },
      ],
    ]);

    await expect(
      bootKernel({
        graphRevision: "test-graph",
        profile,
        plugins,
        context,
      }),
    ).rejects.toThrow("required service is unavailable");
  });

  it("allows optional lookup only for a degradable contract", async () => {
    const contract = defineServiceContract<{ value: number }>({
      id: "foundation.strict-test.v1",
      owner: "foundation",
      major: 1,
    });
    const plugins = new Map<string, FirstPartyPlugin>([
      [
        "foundation",
        {
          ...plugin("foundation"),
          activate: (pluginContext) => {
            pluginContext.services.optional(contract);
          },
        },
      ],
      ["system", plugin("system", ["foundation"])],
    ]);

    await expect(
      bootKernel({
        graphRevision: "test-graph",
        profile,
        plugins,
        context,
      }),
    ).rejects.toThrow("service contract is not declared degradable");
  });
});
