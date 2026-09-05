export type MergeChangeKind =
  "unchanged" | "added" | "deleted" | "modified" | "moved" | "conflict";

export interface MergeUnit<T extends { readonly id: string }> {
  readonly unitId: string;
  readonly kind: MergeChangeKind;
  readonly base?: T;
  readonly main?: T;
  readonly branch?: T;
  readonly conflict: boolean;
  readonly defaultChoice: "main" | "branch";
}

export interface ThreeWayMergePlan<T extends { readonly id: string }> {
  readonly units: readonly MergeUnit<T>[];
  readonly unresolvedUnitIds: readonly string[];
}

export type MergeSelections = Readonly<Record<string, "main" | "branch">>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/**
 * Deterministic stable-id three-way merge. It never mutates an input and never
 * guesses when both main and branch changed the same unit differently.
 */
export function createThreeWayMergePlan<T extends { readonly id: string }>(
  base: readonly T[],
  main: readonly T[],
  branch: readonly T[],
): ThreeWayMergePlan<T> {
  const baseById = new Map(base.map((value) => [value.id, value]));
  const mainById = new Map(main.map((value) => [value.id, value]));
  const branchById = new Map(branch.map((value) => [value.id, value]));
  const orderedIds = [
    ...main.map((value) => value.id),
    ...branch.map((value) => value.id),
    ...base.map((value) => value.id),
  ].filter((id, index, values) => values.indexOf(id) === index);
  const baseIndex = new Map(base.map((value, index) => [value.id, index]));
  const mainIndex = new Map(main.map((value, index) => [value.id, index]));
  const branchIndex = new Map(branch.map((value, index) => [value.id, index]));

  const units = orderedIds.map((unitId): MergeUnit<T> => {
    const baseValue = baseById.get(unitId);
    const mainValue = mainById.get(unitId);
    const branchValue = branchById.get(unitId);
    const mainChanged = !equal(baseValue, mainValue);
    const branchChanged = !equal(baseValue, branchValue);
    const valuesAgree = equal(mainValue, branchValue);
    const mainMoved =
      mainValue !== undefined &&
      baseIndex.get(unitId) !== mainIndex.get(unitId);
    const branchMoved =
      branchValue !== undefined &&
      baseIndex.get(unitId) !== branchIndex.get(unitId);
    const incompatibleMove =
      mainMoved &&
      branchMoved &&
      mainIndex.get(unitId) !== branchIndex.get(unitId);
    const conflict = mainChanged && branchChanged && !valuesAgree;
    let kind: MergeChangeKind = "unchanged";
    if (conflict || incompatibleMove) kind = "conflict";
    else if (!baseValue && (mainValue || branchValue)) kind = "added";
    else if (baseValue && !mainValue && !branchValue) kind = "deleted";
    else if (mainMoved || branchMoved) kind = "moved";
    else if (mainChanged || branchChanged)
      kind = mainValue || branchValue ? "modified" : "deleted";
    return {
      unitId,
      kind,
      ...(baseValue ? { base: baseValue } : {}),
      ...(mainValue ? { main: mainValue } : {}),
      ...(branchValue ? { branch: branchValue } : {}),
      conflict: conflict || incompatibleMove,
      defaultChoice:
        branchChanged && !mainChanged ? ("branch" as const) : ("main" as const),
    };
  });
  return {
    units,
    unresolvedUnitIds: units
      .filter((unit) => unit.conflict)
      .map((unit) => unit.unitId),
  };
}

export function resolveThreeWayMerge<T extends { readonly id: string }>(
  plan: ThreeWayMergePlan<T>,
  selections: MergeSelections,
): readonly T[] {
  const unresolved = plan.unresolvedUnitIds.filter(
    (unitId) => selections[unitId] === undefined,
  );
  if (unresolved.length)
    throw new Error(`unresolved merge conflicts: ${unresolved.join(",")}`);
  return plan.units.flatMap((unit) => {
    const choice = selections[unit.unitId] ?? unit.defaultChoice;
    const value = choice === "branch" ? unit.branch : unit.main;
    return value ? [value] : [];
  });
}
