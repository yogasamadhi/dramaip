import { expect, test } from "vitest";
import {
  originalSeasonWorkflow,
  readSeasonDraft,
  seasonPlanLineageError,
  seasonPlanRequest,
  type SeasonPlan,
  type Workflow,
} from "../src/client/season/season.ts";

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
  } as unknown as SeasonPlan,
  reordered = {
    ...root,
    id: "human-reordered",
    origin: "human-reorder",
    sourcePlanId: root.id,
    basis: { ...basis, baseAdoptedId: root.id },
  } as unknown as SeasonPlan,
  run = {
    id: root.workflowId,
    input: {
      projectId: root.projectId,
      operation: "season-plan",
      seasonPlanRequest: { diagnosis: basis.diagnosis },
    },
    sourceSnapshotId: root.sourceSnapshotId,
    seasonPlanBasis: basis,
    seasonPlanId: "newer-adopted-human",
  } as unknown as Workflow;

test("人工季纲有实际独立来源链，完整原冻结值一致；新头／模型指针不否定真实历史", async () => {
  const calls: string[] = [];
  expect(
    await seasonPlanLineageError(root, run, async () => {
      throw new Error("not needed");
    }),
  ).toBeUndefined();
  expect(
    await seasonPlanLineageError(reordered, run, async (id) => {
      calls.push(id);
      return root;
    }),
  ).toBeUndefined();
  const second = {
    ...reordered,
    id: "second-human",
    sourcePlanId: reordered.id,
  };
  expect(
    await seasonPlanLineageError(second, run, async (id) =>
      id === reordered.id ? reordered : root,
    ),
  ).toBeUndefined();
  expect(calls).toEqual([root.id]);
});

test("人工季纲原owner不可用、替代身份、外项目／错误原run或正文范围／来源链循环全部拒绝", async () => {
  for (const [parent, reason] of [
    [{ ...root, id: "substituted" }, "parent"],
    [{ ...root, projectId: "foreign" }, "parent"],
    [{ ...root, workflowId: "other-run" }, "parent"],
    [{ ...root, sourceSnapshotId: "new" }, "parent"],
    [
      {
        ...root,
        basis: {
          ...root.basis,
          chapters: [{ ...root.basis.chapters[0]!, version: 4 }],
        },
      },
      "parent",
    ],
    [{ ...reordered, id: root.id, sourcePlanId: reordered.id }, "chain"],
  ] as const)
    expect(
      await seasonPlanLineageError(
        reordered,
        run,
        async () => parent as SeasonPlan,
      ),
    ).toBe(reason);
  await expect(
    seasonPlanLineageError(reordered, run, async () => {
      throw new Error("owner offline");
    }),
  ).rejects.toThrow("owner offline");
  for (const [other, reason] of [
    [{ ...run, id: "wrong" }, "workflow"],
    [{ ...run, sourceSnapshotId: "other" }, "model"],
    [{ ...run, input: { ...run.input, projectId: "foreign" } }, "workflow"],
    [
      {
        ...run,
        seasonPlanBasis: {
          ...run.seasonPlanBasis!,
          baseAdoptedId: "changed-original",
        },
      },
      "model",
    ],
  ] as const)
    expect(
      await seasonPlanLineageError(
        reordered,
        other as Workflow,
        async () => root,
      ),
    ).toBe(reason);
  expect(reordered.basis.baseAdoptedId).toBe(root.id);
});

const DIAGNOSIS = "11111111-1111-4111-8111-111111111111";
const STRATEGY = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";

test("季纲基准只由采用诊断、独立策略与原采用头组成", () => {
  const diagnosis = { id: DIAGNOSIS, version: 2, strategyId: "one" };
  const strategy = { id: STRATEGY, version: 1, optionId: "reorder" };
  expect(seasonPlanRequest({ projectId: "p" })).toBeUndefined();
  expect(seasonPlanRequest({ projectId: "p", diagnosis })).toEqual({
    diagnosis,
  });
  expect(
    seasonPlanRequest({
      projectId: "p",
      diagnosis,
      strategy,
      strategyPath: "independent",
      adoptedPlanId: PLAN,
    }),
  ).toEqual({ diagnosis, strategy, baseAdoptedId: PLAN });
  const saved = { diagnosis, strategy, baseAdoptedId: PLAN };
  expect(readSeasonDraft(JSON.stringify(saved))).toEqual(saved);
  for (const raw of [
    null,
    "{",
    JSON.stringify({ ...saved, extra: 1 }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, version: 0 } }),
    JSON.stringify({ ...saved, diagnosis: { ...diagnosis, strategyId: " " } }),
    JSON.stringify({ ...saved, strategy: { ...strategy, extra: 1 } }),
    JSON.stringify({ ...saved, baseAdoptedId: "not-uuid" }),
  ])
    expect(readSeasonDraft(raw)).toBeUndefined();
});

test("原运行须是本项目季纲运行并带冻结请求", () => {
  const scope = { projectId: "project", workflowId: "original-run" };
  expect(originalSeasonWorkflow(run, scope)).toBe(run);
  expect(
    originalSeasonWorkflow(run, { ...scope, projectId: "other" }),
  ).toBeUndefined();
  expect(
    originalSeasonWorkflow(
      { ...run, input: { ...run.input, operation: "adaptation-diagnosis" } },
      scope,
    ),
  ).toBeUndefined();
});
