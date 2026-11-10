import { describe, expect, it } from "vitest";
import { DRAMAIP_PLUGIN_API_VERSION } from "@dramaip/contracts";
import { bootWebComposition } from "@dramaip/test-web-composition";
import manifests from "@dramaip/compat-runtime/plugin-manifests" with { type: "json" };
import type { FirstPartyPlugin } from "@dramaip/plugin-api/internal";

/** The generated manifests; Cordis loads each implementation from its entry. */
function firstPartyPlugins(): FirstPartyPlugin[] {
  return manifests.map(
    (manifest) =>
      ({
        ...manifest,
        entry: new URL(
          `../../../../plugins/${manifest.id}/src/index.ts`,
          import.meta.url,
        ).href,
      }) as unknown as FirstPartyPlugin,
  );
}

describe("Plugin API v1 conformance", () => {
  it("boots every business plugin in the web Profile composition", async () => {
    const runtime = await bootWebComposition({
      databasePath: ":memory:",
      plugins: firstPartyPlugins(),
    });
    try {
      const diagnostics = runtime.diagnostics();
      expect(diagnostics.profile).toBe("server");
      expect(diagnostics.plugins).toHaveLength(14);
      expect(
        diagnostics.plugins.every((plugin) => plugin.status === "active"),
      ).toBe(true);
      expect(diagnostics.services.length).toBeGreaterThan(0);
    } finally {
      await runtime.dispose();
    }
  });
  it("publishes one validated graph and releases every tracked effect", async () => {
    const plugins = firstPartyPlugins();
    for (const plugin of plugins) {
      expect(plugin.descriptor.pluginApiVersion).toBe(
        DRAMAIP_PLUGIN_API_VERSION,
      );
      expect(plugin.descriptor.runtimeVersion).toMatch(/^\^3\./u);
      expect(plugin.descriptor.kind).toBe("built-in");
    }

    const runtime = await bootWebComposition({
      databasePath: ":memory:",
      plugins,
    });
    const active = runtime.diagnostics();
    expect(active.effects.length).toBeGreaterThan(0);
    expect(
      active.routeContributions?.every((route) =>
        Boolean(route.method && route.path && route.operationId),
      ),
    ).toBe(true);
    expect(
      runtime.ui
        .contributions()
        .every((contribution) =>
          /^[a-f0-9]{64}$/u.test(contribution.metadataHash ?? ""),
        ),
    ).toBe(true);

    const diagnostics = runtime.diagnostics;
    await runtime.dispose();
    expect(diagnostics().effects).toHaveLength(0);
  });
});
