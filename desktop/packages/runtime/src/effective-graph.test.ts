import { describe, expect, it } from "vitest";
import { EffectiveGraphBuilder } from "./effective-graph.js";

const input = {
  profile: "test",
  bundles: ["core"],
  plugins: [{ id: "foundation", version: "1.0.0", config: { b: 2, a: 1 } }],
  extensions: [],
  apiVersion: "2",
  pluginApiVersion: "1",
  mode: "headless",
  capabilities: { desktopHost: false },
};

describe("Effective Graph Builder", () => {
  it("produces a canonical revision independent of object key order", () => {
    const left = new EffectiveGraphBuilder(input);
    const right = new EffectiveGraphBuilder({
      ...input,
      plugins: [{ id: "foundation", version: "1.0.0", config: { a: 1, b: 2 } }],
    });
    expect(left.revision).toBe(right.revision);
    expect(left.revision).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("never publishes a failed staged graph and always disposes it", async () => {
    const builder = new EffectiveGraphBuilder(input);
    const events: string[] = [];
    await expect(
      builder.build({
        migrationPreflight: () => {
          events.push("migration");
        },
        stage: () => ({ revision: builder.revision }),
        activate: () => {
          events.push("activate");
        },
        validate: () => {
          throw new Error("invalid contribution graph");
        },
        publish: () => {
          events.push("publish");
        },
        dispose: () => {
          events.push("dispose");
        },
      }),
    ).rejects.toThrow("invalid contribution graph");
    expect(events).toEqual(["migration", "activate", "dispose"]);
    expect(builder.diagnostics().status).toBe("failed");
  });
});
