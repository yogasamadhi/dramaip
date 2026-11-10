import { describe, expect, it } from "vitest";
import { resolveBuiltinContributionSet } from "./index";
import { BUILTIN_UI_MANIFEST } from "./builtin-manifest.generated";

describe("Renderer built-in contribution registry", () => {
  it("accepts an exact build-manifest match", () => {
    const expected = BUILTIN_UI_MANIFEST["workspace.route.home"];
    const result = resolveBuiltinContributionSet([
      {
        id: "workspace.route.home",
        pluginId: expected.pluginId,
        kind: expected.kind,
        metadata: expected.metadata,
        metadataHash: expected.metadataHash,
      },
    ]);

    expect(result.enabled).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("never enables an unknown Runtime contribution", () => {
    const result = resolveBuiltinContributionSet([
      {
        id: "untrusted.route.injected",
        pluginId: "workspace",
        kind: "route",
        metadata: { path: "/untrusted" },
        metadataHash: "a".repeat(64),
      },
    ]);

    expect(result.enabled).toHaveLength(0);
    expect(result.diagnostics[0]?.code).toBe("UNKNOWN_CONTRIBUTION");
  });
});
