import { describe, expect, it } from "vitest";
import { createThreeWayMergePlan, resolveThreeWayMerge } from "./draft-merge";

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
});
