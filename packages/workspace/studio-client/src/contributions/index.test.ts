import { describe, expect, it } from "vitest";
import { validateBuiltinUiContributions } from "./index.js";

const trusted = {
  "workspace.route.home": {
    pluginId: "workspace",
    kind: "route" as const,
    metadata: {},
    metadataHash: "a".repeat(64),
  },
};

describe("built-in UI contribution trust", () => {
  it("enables only an exact manifest match", () => {
    expect(
      validateBuiltinUiContributions(
        [
          {
            id: "workspace.route.home",
            pluginId: "workspace",
            kind: "route",
            metadata: {},
            metadataHash: "a".repeat(64),
          },
        ],
        trusted,
      ).enabled,
    ).toHaveLength(1);
  });

  it("diagnoses unknown and metadata-tampered contributions without enabling them", () => {
    const result = validateBuiltinUiContributions(
      [
        {
          id: "unknown.route",
          pluginId: "workspace",
          kind: "route",
          metadata: {},
          metadataHash: "a".repeat(64),
        },
        {
          id: "workspace.route.home",
          pluginId: "workspace",
          kind: "route",
          metadata: { path: "/tampered" },
          metadataHash: "b".repeat(64),
        },
      ],
      trusted,
    );

    expect(result.enabled).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      { contributionId: "unknown.route", code: "UNKNOWN_CONTRIBUTION" },
      {
        contributionId: "workspace.route.home",
        code: "METADATA_HASH_MISMATCH",
      },
    ]);
  });
});
