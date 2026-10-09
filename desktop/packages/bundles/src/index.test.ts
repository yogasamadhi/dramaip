import { readFileSync } from "node:fs";
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

describe("M4 coherent native configuration reads", () => {
  it("reads each original patch file once and derives native patches and preflight from the same exact bytes", () => {
    const counts = new Map<string, number>();
    const graph = resolveEffectiveGraph(
      parseProfileDefinition('{"name":"safe","bundles":["core"]}'),
      undefined,
      (path) => {
        const count = (counts.get(path.href) ?? 0) + 1;
        counts.set(path.href, count);
        if (path.href.endsWith("/profiles/safe/cordis.patch.yml"))
          return count === 1
            ? "[]\n"
            : "- id: system\n  config: { changedBetweenReads: true }\n";
        return readFileSync(path, "utf8");
      },
    );
    expect(counts.size).toBe(3);
    expect([...counts.values()]).toEqual([1, 1, 1]);
    const actual = applyEntryPatches(
      [],
      graph.assembly.patches,
      () => undefined,
    );
    const flatten = (
      values: import("@deepseek-ai/cordis-plugin-loader").EntryOptions[],
    ): import("@deepseek-ai/cordis-plugin-loader").EntryOptions[] =>
      values.flatMap((value) =>
        value.group ? flatten(value.config) : [value],
      );
    expect(
      flatten(actual).map((value) => ({
        id: value.id,
        config: value.config ?? {},
      })),
    ).toEqual(graph.plugins);
  });
});
