import { expect, test } from "bun:test";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { SeasonPlan } from "@dramaip/contracts/production";
import { verifySeasonPlanOwnerLineage } from "./season-plan-owner-evidence";

const basis = {
    diagnosis: { id: "diagnosis", version: 2, strategyId: "one" },
    chapters: [{ id: "chapter", version: 3 }],
    baseAdoptedId: "old-head",
  },
  root = {
    id: "model-root",
    projectId: "project",
    workflowId: "original-run",
    sourceSnapshotId: "original-snapshot",
    origin: "model",
    basis,
  } as SeasonPlan,
  reordered = {
    ...root,
    id: "human-reordered",
    origin: "human-reorder",
    sourcePlanId: root.id,
    basis: { ...basis, baseAdoptedId: root.id },
  } as SeasonPlan,
  run = {
    id: root.workflowId,
    input: { projectId: root.projectId, operation: "season-plan" },
    sourceSnapshotId: root.sourceSnapshotId,
    seasonPlanBasis: basis,
    seasonPlanId: "newer-adopted-human",
  } as CreationWorkflow;

test("人工季纲有实际独立来源链，完整原冻结值一致；新头／模型指针不否定真实历史", async () => {
  const calls: string[] = [];
  await verifySeasonPlanOwnerLineage(root, run, async () => {
    throw new Error("not needed");
  });
  await verifySeasonPlanOwnerLineage(reordered, run, async (id) => {
    calls.push(id);
    return root;
  });
  const second = {
    ...reordered,
    id: "second-human",
    sourcePlanId: reordered.id,
  };
  await verifySeasonPlanOwnerLineage(second, run, async (id) =>
    id === reordered.id ? reordered : root,
  );
  expect(calls).toEqual([root.id]);
});

test("人工季纲原owner不可用、替代身份、外项目／错误原run或正文范围／来源链循环全部拒绝", async () => {
  for (const parent of [
    { ...root, id: "substituted" },
    { ...root, projectId: "foreign" },
    { ...root, workflowId: "other-run" },
    { ...root, sourceSnapshotId: "new" },
    {
      ...root,
      basis: {
        ...root.basis,
        chapters: [{ ...root.basis.chapters[0]!, version: 4 }],
      },
    },
    { ...reordered, id: root.id, sourcePlanId: reordered.id },
  ])
    await expect(
      verifySeasonPlanOwnerLineage(reordered, run, async () => parent),
    ).rejects.toThrow();
  await expect(
    verifySeasonPlanOwnerLineage(reordered, run, async () => {
      throw new Error("owner offline");
    }),
  ).rejects.toThrow();
  for (const other of [
    { ...run, id: "wrong" },
    { ...run, sourceSnapshotId: "other" },
    { ...run, input: { ...run.input, projectId: "foreign" } },
    {
      ...run,
      seasonPlanBasis: {
        ...run.seasonPlanBasis!,
        baseAdoptedId: "changed-original",
      },
    },
  ])
    await expect(
      verifySeasonPlanOwnerLineage(reordered, other, async () => root),
    ).rejects.toThrow();
  expect(reordered.basis.baseAdoptedId).toBe(root.id);
});
