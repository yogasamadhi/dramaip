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
  readonly orders: {
    readonly base: readonly string[];
    readonly main: readonly string[];
    readonly branch: readonly string[];
  };
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

/** IDs participating in an inversion, not positions shifted by an insertion
 * or deletion. O(n): a preceding larger or following smaller base rank. */
function movedIds(
  base: readonly string[],
  side: readonly string[],
): Set<string> {
  const rank = new Map(base.map((id, index) => [id, index]));
  const common = side.filter((id) => rank.has(id));
  const moved = new Set<string>();
  let largest = -1;
  for (const id of common) {
    const value = rank.get(id)!;
    if (largest > value) moved.add(id);
    largest = Math.max(largest, value);
  }
  let smallest = Number.POSITIVE_INFINITY;
  for (const id of [...common].reverse()) {
    const value = rank.get(id)!;
    if (smallest < value) moved.add(id);
    smallest = Math.min(smallest, value);
  }
  return moved;
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
  for (const values of [base, main, branch])
    if (new Set(values.map((value) => value.id)).size !== values.length)
      throw new Error("duplicate stable merge identity");
  const baseById = new Map(base.map((value) => [value.id, value]));
  const mainById = new Map(main.map((value) => [value.id, value]));
  const branchById = new Map(branch.map((value) => [value.id, value]));
  const orderedIds = [
    ...new Set([
      ...main.map((value) => value.id),
      ...branch.map((value) => value.id),
      ...base.map((value) => value.id),
    ]),
  ];
  const orders = {
    base: base.map((value) => value.id),
    main: main.map((value) => value.id),
    branch: branch.map((value) => value.id),
  };
  const mainMoves = movedIds(orders.base, orders.main);
  const branchMoves = movedIds(orders.base, orders.branch);

  const units = orderedIds.map((unitId): MergeUnit<T> => {
    const baseValue = baseById.get(unitId);
    const mainValue = mainById.get(unitId);
    const branchValue = branchById.get(unitId);
    const mainChanged = !equal(baseValue, mainValue);
    const branchChanged = !equal(baseValue, branchValue);
    const valuesAgree = equal(mainValue, branchValue);
    const mainMoved = mainMoves.has(unitId);
    const branchMoved = branchMoves.has(unitId);
    const conflict =
      (mainChanged && branchChanged && !valuesAgree) ||
      (baseValue !== undefined &&
        ((!mainValue && branchMoved) || (!branchValue && mainMoved)));
    let kind: MergeChangeKind = "unchanged";
    if (conflict) kind = "conflict";
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
      conflict,
      defaultChoice:
        branchChanged && !mainChanged ? ("branch" as const) : ("main" as const),
    };
  });
  return {
    units,
    unresolvedUnitIds: units
      .filter((unit) => unit.conflict)
      .map((unit) => unit.unitId),
    orders,
  };
}

function selectedValues<T extends { readonly id: string }>(
  plan: ThreeWayMergePlan<T>,
  selections: MergeSelections,
): Map<string, T> {
  const identities = new Set(plan.units.map((unit) => unit.unitId));
  for (const [id, choice] of Object.entries(selections))
    if (!identities.has(id) || (choice !== "main" && choice !== "branch"))
      throw new Error("invalid merge selection");
  return new Map(
    plan.units.flatMap((unit) => {
      const choice = selections[unit.unitId] ?? unit.defaultChoice;
      const value = choice === "branch" ? unit.branch : unit.main;
      return value ? [[unit.unitId, value] as const] : [];
    }),
  );
}

export interface MergeOrder {
  readonly proposed: readonly string[];
  readonly conflict: boolean;
  readonly reason?:
    "divergent-order" | "ambiguous-insertion" | "missing-position";
}

/** Preserve a one-sided/identical common order; insert opposite-only blocks
 * only into an unambiguous stable gap. Divergent reorderings or competing gap
 * insertions require an explicit complete order, never a guessed append. */
export function inspectThreeWayMergeOrder<T extends { readonly id: string }>(
  plan: ThreeWayMergePlan<T>,
  selections: MergeSelections = {},
): MergeOrder {
  const selected = selectedValues(plan, selections);
  const main = plan.orders.main.filter((id) => selected.has(id));
  const branch = plan.orders.branch.filter((id) => selected.has(id));
  const mainSet = new Set(main);
  const branchSet = new Set(branch);
  const common = new Set(main.filter((id) => branchSet.has(id)));
  const baseSet = new Set(plan.orders.base);
  const mainCommon = main.filter((id) => common.has(id));
  const branchCommon = branch.filter((id) => common.has(id));
  const baseCommon = plan.orders.base.filter((id) => common.has(id));
  const mainOld = mainCommon.filter((id) => baseSet.has(id));
  const branchOld = branchCommon.filter((id) => baseSet.has(id));
  const mainMoved = !equal(mainOld, baseCommon);
  const branchMoved = !equal(branchOld, baseCommon);
  const fallback = [...main, ...branch.filter((id) => !mainSet.has(id))];
  if (
    !equal(mainCommon, branchCommon) &&
    ((mainMoved && branchMoved) || [...common].some((id) => !baseSet.has(id)))
  )
    return { proposed: fallback, conflict: true, reason: "divergent-order" };
  const primary = branchMoved && !mainMoved ? branch : main;
  const secondary = primary === main ? branch : main;
  if (!primary.length) return { proposed: secondary, conflict: false };
  const primarySet = new Set(primary);
  const rank = new Map(primary.map((id, index) => [id, index]));
  const runs: Array<{ index: number; ids: string[] }> = [];
  let before: string | undefined;
  for (let index = 0; index < secondary.length;) {
    const id = secondary[index]!;
    if (primarySet.has(id)) {
      before = id;
      index++;
      continue;
    }
    const ids: string[] = [];
    while (index < secondary.length && !primarySet.has(secondary[index]!))
      ids.push(secondary[index++]!);
    const after = secondary[index];
    const start = before ? rank.get(before)! + 1 : 0;
    const end = after ? rank.get(after)! : primary.length;
    if (!before && !after)
      return { proposed: fallback, conflict: true, reason: "missing-position" };
    if (start !== end)
      return {
        proposed: fallback,
        conflict: true,
        reason: "ambiguous-insertion",
      };
    runs.push({ index: start, ids });
  }
  const insertions = new Map(runs.map((run) => [run.index, run.ids]));
  const proposed = primary
    .flatMap((id, index) => [...(insertions.get(index) ?? []), id])
    .concat(insertions.get(primary.length) ?? []);
  return { proposed, conflict: false };
}

export function resolveThreeWayMerge<T extends { readonly id: string }>(
  plan: ThreeWayMergePlan<T>,
  selections: MergeSelections,
  explicitOrder?: readonly string[],
): readonly T[] {
  const unresolved = plan.unresolvedUnitIds.filter(
    (unitId) => selections[unitId] === undefined,
  );
  if (unresolved.length)
    throw new Error(`unresolved merge conflicts: ${unresolved.join(",")}`);
  const selected = selectedValues(plan, selections);
  const inspected = inspectThreeWayMergeOrder(plan, selections);
  if (!explicitOrder && inspected.conflict)
    throw new Error(`unresolved merge order: ${inspected.reason}`);
  const order = explicitOrder ?? inspected.proposed;
  if (
    order.length !== selected.size ||
    new Set(order).size !== order.length ||
    order.some((id) => !selected.has(id))
  )
    throw new Error(
      "merge order must exactly cover selected stable identities",
    );
  return order.map((id) => selected.get(id)!);
}
