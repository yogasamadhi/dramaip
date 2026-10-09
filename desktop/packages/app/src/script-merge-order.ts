import {
  CreationMergeSchema,
  type CreationMerge,
} from "@dramaip/contracts/creation";

export function readScriptMerge(
  value: unknown,
  projectId: string,
  workflowId: string,
  targetId: string,
): CreationMerge {
  const merge = CreationMergeSchema.parse(value);
  if (
    merge.basis &&
    (merge.basis.projectId !== projectId ||
      merge.basis.workflowId !== workflowId ||
      merge.basis.target.scriptId !== targetId)
  )
    throw new Error("比较不属于当前项目、原候选或实际剧本，不能采用其他回复。");
  return merge;
}

export function selectedScriptMergeIds(
  merge: CreationMerge,
  choices: Record<string, "main" | "branch">,
): string[] {
  return merge.units
    .filter((unit) => {
      const choice = choices[unit.id] ?? unit.choice;
      return (
        (choice === "main" ? unit.currentPresent : unit.candidatePresent) !==
        false
      );
    })
    .map((unit) => unit.id);
}

/** A visible sorting starting point only, never an automatically approved
 * position for an opposite-side-only block. Author confirmation is separate. */
export function completeScriptMergeOrder(
  order: readonly string[],
  selected: readonly string[],
): string[] {
  const wanted = new Set(selected);
  return [...new Set([...order.filter((id) => wanted.has(id)), ...selected])];
}

export function moveScriptMergeBlock(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const next = [...order];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
