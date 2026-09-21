import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DRAMAIP_PLUGIN_API_VERSION } from "@dramaip/contracts";
import {
  bootRuntime,
  createFirstPartyPluginRegistry,
  loadProfile,
} from "./index.js";

describe("Plugin API v1 conformance", () => {
  for (const name of ["studio", "server", "safe", "test", "e2e"] as const)
    it(`boots ${name} with its declared capability scope on Node`, async () => {
      const profile = loadProfile(
        resolve(process.cwd(), `profiles/${name}.json`),
      );
      const runtime = await bootRuntime({
        databasePath: ":memory:",
        profile,
        runtimeKind: "node",
        mode: name === "server" ? "server" : "headless",
      });
      try {
        expect(runtime.runtimeInfo.runtimeKind).toBe("node");
        expect(runtime.kernel.diagnostics().plugins).toHaveLength(
          ["safe", "test"].includes(name) ? 3 : 14,
        );
        expect(runtime.kernel.diagnostics().services.length).toBeGreaterThan(0);
        expect(
          runtime.kernel
            .diagnostics()
            .plugins.every((plugin) => plugin.status === "active"),
        ).toBe(true);
      } finally {
        await runtime.stop();
      }
    });
  it("publishes one validated graph and releases every tracked effect", async () => {
    const profile = loadProfile(resolve(process.cwd(), "profiles/studio.json"));
    const registry = createFirstPartyPluginRegistry();
    for (const plugin of registry.values()) {
      expect(plugin.descriptor.pluginApiVersion).toBe(
        DRAMAIP_PLUGIN_API_VERSION,
      );
      expect(plugin.descriptor.runtimeVersion).toMatch(/^\^3\./u);
      expect(plugin.descriptor.kind).toBe("built-in");
    }

    const runtime = await bootRuntime({
      databasePath: ":memory:",
      profile,
      runtimeKind: "node",
      mode: "headless",
    });
    const active = runtime.kernel.diagnostics();
    expect(active.effects.length).toBeGreaterThan(0);
    expect(
      active.routeContributions?.every((route) =>
        Boolean(route.method && route.path && route.operationId),
      ),
    ).toBe(true);
    expect(
      runtime.kernel.ui
        .contributions()
        .every((contribution) =>
          /^[a-f0-9]{64}$/u.test(contribution.metadataHash ?? ""),
        ),
    ).toBe(true);

    await runtime.stop();
    expect(runtime.kernel.diagnostics().effects).toHaveLength(0);
  });
});
