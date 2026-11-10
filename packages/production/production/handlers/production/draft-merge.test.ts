import { describe, expect, it } from "vitest";
import {
  createThreeWayMergePlan,
  inspectThreeWayMergeOrder,
  resolveThreeWayMerge,
} from "./draft-merge";

interface Block {
  readonly id: string;
  readonly text: string;
}

describe("stable-id screenplay merge", () => {
  it("automatically carries independent main and branch edits", () => {
    const base: Block[] = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ];
    const plan = createThreeWayMergePlan(
      base,
      [base[0]!, { id: "b", text: "main B" }],
      [{ id: "a", text: "branch A" }, base[1]!],
    );
    expect(plan.unresolvedUnitIds).toEqual([]);
    expect(resolveThreeWayMerge(plan, {})).toEqual([
      { id: "a", text: "branch A" },
      { id: "b", text: "main B" },
    ]);
  });

  it("blocks commit until a divergent unit is selected", () => {
    const base = [{ id: "a", text: "base" }];
    const plan = createThreeWayMergePlan(
      base,
      [{ id: "a", text: "main" }],
      [{ id: "a", text: "branch" }],
    );
    expect(plan.unresolvedUnitIds).toEqual(["a"]);
    expect(() => resolveThreeWayMerge(plan, {})).toThrow(
      "unresolved merge conflicts: a",
    );
    expect(resolveThreeWayMerge(plan, { a: "branch" })).toEqual([
      { id: "a", text: "branch" },
    ]);
  });

  it("treats delete-versus-modify as a conflict", () => {
    const base = [{ id: "a", text: "base" }];
    const plan = createThreeWayMergePlan(
      base,
      [],
      [{ id: "a", text: "changed" }],
    );
    expect(plan.units[0]).toMatchObject({ kind: "conflict", conflict: true });
    expect(resolveThreeWayMerge(plan, { a: "main" })).toEqual([]);
  });
  it("preserves a branch-only reorder while independently retaining main text edits", () => {
    const base = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ];
    const main = [base[0]!, { ...base[1]!, text: "main B" }, base[2]!];
    const branch = [base[1]!, base[0]!, base[2]!];
    const plan = createThreeWayMergePlan(base, main, branch);
    expect(plan.unresolvedUnitIds).toEqual([]);
    expect(resolveThreeWayMerge(plan, {})).toEqual([
      { id: "b", text: "main B" },
      base[0],
      base[2],
    ]);
    expect(base.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });
  it("inserts branch-only blocks at their stable gap instead of appending them and does not call shifted blocks moved", () => {
    const base = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ];
    const added = { id: "x", text: "actual new block" };
    const plan = createThreeWayMergePlan(base, base, [
      base[0]!,
      added,
      base[1]!,
      base[2]!,
    ]);
    expect(resolveThreeWayMerge(plan, {})).toEqual([
      base[0],
      added,
      base[1],
      base[2],
    ]);
    expect(plan.units.find((v) => v.unitId === "b")?.kind).toBe("unchanged");
    expect(plan.units.find((v) => v.unitId === "c")?.kind).toBe("unchanged");
  });
  it("refuses to guess between simultaneous new blocks in the same stable gap", () => {
    const base = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ];
    const plan = createThreeWayMergePlan(
      base,
      [base[0]!, { id: "x", text: "main new" }, base[1]!],
      [base[0]!, { id: "y", text: "branch new" }, base[1]!],
    );
    expect(() => resolveThreeWayMerge(plan, {})).toThrow("order");
  });
  it("refuses duplicate stable identities instead of silently overwriting Map entries", () => {
    const base = [{ id: "a", text: "A" }];
    for (const sides of [
      [base.concat(base), base, base],
      [base, base.concat(base), base],
      [base, base, base.concat(base)],
    ] as const)
      expect(() => createThreeWayMergePlan(...sides)).toThrow("duplicate");
  });
  it("requires an exact full order for divergent reorderings and keeps independent text edits", () => {
    const base = ["a", "b", "c"].map((id) => ({ id, text: id }));
    const plan = createThreeWayMergePlan(
      base,
      [base[1]!, { ...base[0]!, text: "main a" }, base[2]!],
      [base[0]!, { ...base[2]!, text: "branch c" }, base[1]!],
    );
    expect(inspectThreeWayMergeOrder(plan)).toMatchObject({
      conflict: true,
      reason: "divergent-order",
    });
    expect(resolveThreeWayMerge(plan, {}, ["c", "b", "a"])).toEqual([
      { id: "c", text: "branch c" },
      base[1],
      { id: "a", text: "main a" },
    ]);
    for (const order of [
      ["a", "b"],
      ["a", "a", "c"],
      ["a", "b", "foreign"],
      [],
    ])
      expect(() => resolveThreeWayMerge(plan, {}, order)).toThrow(
        "exactly cover",
      );
    expect(() =>
      resolveThreeWayMerge(plan, { foreign: "main" }, ["c", "b", "a"]),
    ).toThrow("selection");
  });
  it("preserves identical reorders and separate stable-gap additions symmetrically", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => ({ id, text: id })) as [
      Block,
      Block,
      Block,
    ];
    const x = { id: "x", text: "x" },
      y = { id: "y", text: "y" };
    for (const sides of [
      [
        [a, x, b, c],
        [a, b, y, c],
      ],
      [
        [a, b, y, c],
        [a, x, b, c],
      ],
    ] as const)
      expect(
        resolveThreeWayMerge(
          createThreeWayMergePlan([a, b, c], sides[0], sides[1]),
          {},
        ),
      ).toEqual([a, x, b, y, c]);
    expect(
      resolveThreeWayMerge(
        createThreeWayMergePlan([a, b, c], [c, a, b], [c, a, b]),
        {},
      ),
    ).toEqual([c, a, b]);
    expect(
      resolveThreeWayMerge(createThreeWayMergePlan([], [], [x, y]), {}),
    ).toEqual([x, y]);
  });
  it("never invents positions across reversed anchors or disconnected new blocks", () => {
    const a = { id: "a", text: "a" },
      b = { id: "b", text: "b" };
    const x = { id: "x", text: "x" },
      y = { id: "y", text: "y" };
    expect(
      inspectThreeWayMergeOrder(
        createThreeWayMergePlan([a, b], [b, a], [a, x, b]),
      ).conflict,
    ).toBe(true);
    const disconnected = createThreeWayMergePlan([], [x], [y]);
    expect(inspectThreeWayMergeOrder(disconnected)).toMatchObject({
      conflict: true,
      reason: "missing-position",
    });
    expect(resolveThreeWayMerge(disconnected, {}, [y.id, x.id])).toEqual([
      y,
      x,
    ]);
  });
  it("requires a content decision for deletion versus movement, not an index shift", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => ({ id, text: id })) as [
      Block,
      Block,
      Block,
    ];
    const plan = createThreeWayMergePlan([a, b, c], [b, c], [b, a, c]);
    expect(plan.unresolvedUnitIds).toEqual([a.id]);
    expect(resolveThreeWayMerge(plan, { a: "branch" })).toEqual([b, a, c]);
    expect(resolveThreeWayMerge(plan, { a: "main" })).toEqual([b, c]);
    expect(
      createThreeWayMergePlan([a, b, c], [b, c], [a, b, c]).unresolvedUnitIds,
    ).toEqual([]);
  });
  it("handles a large reversed stable list without mutation or index-shift heuristics", () => {
    const base = Array.from({ length: 10000 }, (_, index) => ({
      id: `block-${index}`,
      text: `正文 ${index}`,
    }));
    const branch = [...base].reverse();
    expect(
      resolveThreeWayMerge(createThreeWayMergePlan(base, base, branch), {}),
    ).toEqual(branch);
    expect(base[0]?.id).toBe("block-0");
  });
});
