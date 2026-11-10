import type { CreationWorkflow } from "@dramaip/contracts/creation";

const ACTIVE = new Set<CreationWorkflow["stage"]>([
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
]);

// Callers must first match the real project, operation, target and current
// formal basis. A newer terminal record can suppress an old failure, but it
// is not an author decision about another still-pending or active workflow.
export function selectUnresolvedCreationWorkflow(
  workflows: readonly CreationWorkflow[],
): CreationWorkflow | undefined {
  const ordered = [...workflows].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
  const unresolved =
    ordered.find((item) => item.stage === "awaiting-review") ??
    ordered.find((item) => ACTIVE.has(item.stage));
  if (unresolved) return unresolved;
  const latest = ordered[0];
  return latest && ["failed", "interrupted"].includes(latest.stage)
    ? latest
    : undefined;
}
