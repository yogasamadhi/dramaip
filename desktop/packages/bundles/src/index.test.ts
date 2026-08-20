import { describe, expect, it } from "vitest";
import {
  BundleProfileError,
  parseProfileDefinition,
  resolveEffectiveGraph,
} from "./index.js";

describe("bundle profiles", () => {
  it("expands profile bundles into a deterministic plugin graph", () => {
    const graph = resolveEffectiveGraph(
      parseProfileDefinition(
        '{"name":"studio","bundles":["analytics-suite","writing-suite"]}',
      ),
    );
    expect(graph.bundles).toEqual(["core", "analytics-suite", "writing-suite"]);
    expect(graph.plugins.map((entry) => entry.id)).toEqual([
      "foundation",
      "system",
      "workspace",
      "insights",
      "writing",
      "knowledge",
      "creative-quality",
    ]);
  });

  it("rejects direct plugin selections", () => {
    expect(() =>
      parseProfileDefinition('{"name":"safe","plugins":[{"id":"foundation"}]}'),
    ).toThrow(BundleProfileError);
  });
});
