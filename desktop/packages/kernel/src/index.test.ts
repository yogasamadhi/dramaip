import { describe, expect, it } from "vitest";
import { bootKernel, validatePluginGraph } from "./index.js";
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
    replay: () => [],
    registerConsumer: () => () => undefined,
    diagnostics: () => [],
  },
  uow: {
    execute: <T>(work: (transaction: never) => T) => work(undefined as never),
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
    await expect(bootKernel({ profile, plugins, context })).rejects.toThrow(
      "boom",
    );
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
            pluginContext.effect(() => {
              cleaned.push("first");
            }, "first");
            pluginContext.effect(() => {
              cleaned.push("second");
            }, "second");
          },
        },
      ],
      ["system", plugin("system", ["foundation"])],
    ]);
    const kernel = await bootKernel({ profile, plugins, context });
    expect(kernel.diagnostics().effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "foundation", label: "first" }),
        expect.objectContaining({ owner: "foundation", label: "second" }),
      ]),
    );
    await kernel.dispose();
    expect(cleaned).toEqual(["second", "first"]);
  });
});
