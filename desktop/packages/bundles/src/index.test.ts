import { applyEntryPatches } from "@deepseek-ai/cordis-plugin-include";
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

describe("DSH patch semantics", () => {
  it("indexes inserted children and replaces config without custom deep merge", () => {
    const patches = [
      {
        insert: [
          {
            id: "bundle",
            name: "cordis:group",
            group: true,
            config: [
              { id: "plugin", name: "example", config: { keep: 1, old: true } },
            ],
          },
        ],
      },
      { id: "plugin", config: { next: 2 } },
    ];
    const before = structuredClone(patches);
    const entries = applyEntryPatches([], patches, () => undefined);
    expect(entries[0]!.config[0].config).toEqual({ next: 2 });
    expect(patches[0]!.insert![0]!.config[0]!.config).toEqual({ next: 2 });
    expect(
      applyEntryPatches([], [before[0]!], () => undefined)[0]!.config[0].config,
    ).toEqual({ keep: 1, old: true });
  });
});
