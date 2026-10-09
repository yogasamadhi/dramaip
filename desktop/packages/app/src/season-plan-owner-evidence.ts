import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { SeasonPlan } from "@dramaip/contracts/production";
import { sameFrozenOwnerSnapshot } from "./current-owner-read";

const immutableBasis = (value: SeasonPlan) => {
  const { baseAdoptedId: _head, ...basis } = value.basis;
  return basis;
};

// A human reorder creates its own record and can legitimately change the
// adopted head CAS without creating a new model workflow. Verify its actual
// owner lineage, not the workflow's mutable current candidate pointer.
export async function verifySeasonPlanOwnerLineage(
  value: SeasonPlan,
  workflow: CreationWorkflow,
  read: (id: string) => Promise<SeasonPlan>,
): Promise<void> {
  if (
    workflow.id !== value.workflowId ||
    workflow.input.projectId !== value.projectId ||
    workflow.input.operation !== "season-plan"
  )
    throw new Error("原季纲工作流归属无法核对。");
  const seen = new Set([value.id]);
  let current = value;
  while (current.origin === "human-reorder") {
    const id = current.sourcePlanId;
    if (!id || seen.has(id))
      throw new Error("人工季纲重排的原记录链无法核对。");
    seen.add(id);
    const parent = await read(id);
    if (
      parent.id !== id ||
      parent.projectId !== value.projectId ||
      parent.workflowId !== value.workflowId ||
      parent.sourceSnapshotId !== value.sourceSnapshotId ||
      !sameFrozenOwnerSnapshot(immutableBasis(parent), immutableBasis(current))
    )
      throw new Error("人工季纲重排的原来源归属或冻结内容不符。");
    current = parent;
  }
  if (
    current.origin !== "model" ||
    current.sourceSnapshotId !== workflow.sourceSnapshotId ||
    !sameFrozenOwnerSnapshot(current.basis, workflow.seasonPlanBasis)
  )
    throw new Error("原模型季纲的完整冻结来源无法核对。");
}
