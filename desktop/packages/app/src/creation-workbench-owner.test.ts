import { expect, test } from "vitest";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import {
  creationWorkbenchScopeKey,
  matchesCreationWorkbenchWorkflow,
  readCreationWorkbenchWorkflow,
  matchesCreationWorkbenchPreview,
  type CreationWorkbenchScope,
  type CreationWorkbenchPreviewRead,
} from "./creation-workbench-owner";

const workflow = {
  id: "original-run",
  taskId: "original-task",
  previewId: "original-preview",
  input: {
    projectId: "project",
    operation: "script-revision",
    targetId: "script",
    sourceIds: ["chapter-one", "chapter-four"],
    baseVersion: 0,
    engineKind: "langgraph",
  },
} as CreationWorkflow;
const scope = { ...workflow.input, workflowId: workflow.id };
const read = { status: "success", isFetchedAfterMount: true };
const preview: CreationWorkbenchPreviewRead = {
  id: workflow.previewId!,
  projectId: workflow.input.projectId,
  taskId: workflow.taskId,
  engineKind: "langgraph",
  taskType: "creation.script-revision",
  rationale: "original candidate identity fixture",
  status: "pending",
  contentHash: "frozen-preview-content",
  createdAt: "2026-10-04T20:00:00.000Z",
  targets: [
    {
      kind: "creation",
      id: workflow.id,
      baseVersion: 0,
      patch: { workflowId: workflow.id },
    },
  ],
};

test("明确制作请求须原basis绑定；旧历史不补造，新请求不静默丢失", () => {
  const request = {
    format: "production-narrative-v1",
    chapterScope: { mode: "none", chapters: [] },
    context: { format: "narrative-context-v1", chapters: [] },
  };
  const input = {
    ...workflow.input,
    sourceIds: [],
    productionNarrativeRequest: request,
  };
  const value = {
    ...workflow,
    input,
    productionNarrativeBasis: { request },
  } as unknown as CreationWorkflow;
  const wanted = {
    ...input,
    workflowId: workflow.id,
  } as CreationWorkbenchScope & { workflowId: string };
  expect(matchesCreationWorkbenchWorkflow(value, wanted)).toBe(true);
  expect(
    matchesCreationWorkbenchWorkflow(
      { ...value, productionNarrativeBasis: undefined },
      wanted,
    ),
  ).toBe(false);
  expect(
    matchesCreationWorkbenchWorkflow(
      { ...workflow, productionNarrativeBasis: value.productionNarrativeBasis },
      scope,
    ),
  ).toBe(false);
  const other = {
    ...value.productionNarrativeBasis!,
    request: {
      ...value.productionNarrativeBasis!.request,
      chapterScope: {
        mode: "selection" as const,
        chapters: [{ id: "actual-other", version: 0 }],
      },
    },
  };
  expect(
    matchesCreationWorkbenchWorkflow(
      { ...value, productionNarrativeBasis: other },
      wanted,
    ),
  ).toBe(false);
  expect(creationWorkbenchScopeKey(wanted)).not.toBe(
    creationWorkbenchScopeKey(scope),
  );
});

test("共享原运行须本次成功读取及精确身份，后台poll保留实际旧快照但错误／首读缓存不可见", () => {
  expect(
    readCreationWorkbenchWorkflow({ ...read, data: workflow }, scope),
  ).toBe(workflow);
  expect(
    readCreationWorkbenchWorkflow(
      { ...read, data: workflow, isFetching: true } as typeof read & {
        data: CreationWorkflow;
      },
      scope,
    ),
  ).toBe(workflow);
  for (const invalid of [
    { status: "error" },
    { status: "pending" },
    { isFetchedAfterMount: false },
    { error: new Error("original owner unavailable") },
  ])
    expect(
      readCreationWorkbenchWorkflow(
        { ...read, data: workflow, ...invalid },
        scope,
      ),
    ).toBeUndefined();
  for (const other of [
    { workflowId: "later-run" },
    { projectId: "foreign" },
    { operation: "episode" as const },
    { targetId: "different-script" },
    { sourceIds: [...scope.sourceIds].reverse() },
    { reviewPackageId: "another-review" },
    { feedbackClusterId: "other-feedback" },
    { language: "different" },
  ])
    expect(
      matchesCreationWorkbenchWorkflow(workflow, { ...scope, ...other }),
    ).toBe(false);
  // A current script version is not the identity of the old candidate. This
  // leaves the actual existing three-way merge available, without auto-adoption.
  expect(
    matchesCreationWorkbenchWorkflow(workflow, {
      ...scope,
      baseVersion: 9,
    } as typeof scope),
  ).toBe(true);
});

test("九种明确冻结请求均逐值比较，不跨请求选最近运行，缺历史basis不补造", () => {
  for (const key of [
    "authorIntentRequest",
    "diagnosisRequest",
    "adaptationStrategyRequest",
    "seasonPlanRequest",
    "episodeDevelopmentRequest",
    "qualityReviewRequest",
    "narrativeContextRequest",
    "narrativePlanningRequest",
    "narrativeSummaryRequest",
  ] as const) {
    // This pure comparator does not certify these minimal values as API
    // requests. The workbench separately parses the actual owner contract.
    const request = {
      target: { id: "source", version: 2 },
      included: ["one", "four"],
      head: null,
    };
    const value = {
      ...workflow,
      input: { ...workflow.input, [key]: request },
    } as unknown as CreationWorkflow;
    const wanted = {
      ...scope,
      [key]: {
        head: null,
        included: request.included,
        target: { version: 2, id: "source" },
      },
    } as CreationWorkbenchScope & { workflowId: string };
    expect(matchesCreationWorkbenchWorkflow(value, wanted)).toBe(true);
    expect(
      matchesCreationWorkbenchWorkflow(value, {
        ...wanted,
        [key]: { ...request, target: { id: "source", version: 3 } },
      }),
    ).toBe(false);
    expect(
      matchesCreationWorkbenchWorkflow(value, {
        ...wanted,
        [key]: { ...request, included: [...request.included].reverse() },
      }),
    ).toBe(false);
  }
  const request = { target: { id: "chapter", version: 2 } };
  const quality = {
    ...workflow,
    input: { ...workflow.input, qualityReviewRequest: request },
    narrativeQualityBasis: { request },
  } as unknown as CreationWorkflow;
  expect(matchesCreationWorkbenchWorkflow(quality, scope)).toBe(true);
  expect(
    matchesCreationWorkbenchWorkflow(
      {
        ...quality,
        narrativeQualityBasis: {
          ...quality.narrativeQualityBasis!,
          request: { ...request, target: { ...request.target, version: 3 } },
        },
      } as unknown as CreationWorkflow,
      scope,
    ),
  ).toBe(false);
});

test("草稿与候选作用域分开：版本变更保留合并，来源／完整请求／顺序变化隔离选择，成员顺序不误变", () => {
  const source = {
    ...scope,
    narrativeContextRequest: {
      chapters: ["one", "four"],
      format: "example-only",
    },
  } as unknown as CreationWorkbenchScope;
  const original = creationWorkbenchScopeKey(source);
  expect(
    creationWorkbenchScopeKey({ ...source, baseVersion: 9 } as typeof source),
  ).toBe(original);
  expect(
    creationWorkbenchScopeKey({
      ...source,
      narrativeContextRequest: {
        format: "example-only",
        chapters: ["one", "four"],
      },
    } as unknown as CreationWorkbenchScope),
  ).toBe(original);
  for (const other of [
    { projectId: "foreign" },
    { targetId: "later" },
    { sourceIds: [...scope.sourceIds].reverse() },
    { language: "new" },
    { narrativePlanningRequired: true },
    {
      narrativeContextRequest: {
        format: "example-only",
        chapters: ["four", "one"],
      },
    },
  ])
    expect(
      creationWorkbenchScopeKey({
        ...source,
        ...other,
      } as CreationWorkbenchScope),
    ).not.toBe(original);
});

test("原预览须原ID／项目／任务／单一实际目标，真实章合并的新CAS不冒充另一运行", () => {
  expect(matchesCreationWorkbenchPreview(preview, workflow)).toBe(true);
  const invalidPreviews: (CreationWorkbenchPreviewRead | undefined)[] = [
    undefined,
    { ...preview, id: "later" },
    { ...preview, projectId: "foreign" },
    { ...preview, taskId: "another-task" },
    { ...preview, engineKind: "pi" as const },
    { ...preview, taskType: "creation.episode" },
    { ...preview, targets: [] },
    { ...preview, targets: [{ ...preview.targets[0]!, patch: null }] },
    {
      ...preview,
      targets: [{ ...preview.targets[0]!, patch: "not-an-object" }],
    },
    { ...preview, targets: [...preview.targets, ...preview.targets] },
    { ...preview, targets: [{ ...preview.targets[0]!, id: "wrong-run" }] },
    {
      ...preview,
      targets: [{ ...preview.targets[0]!, patch: { workflowId: "wrong-run" } }],
    },
  ];
  for (const invalid of invalidPreviews)
    expect(matchesCreationWorkbenchPreview(invalid, workflow)).toBe(false);
  const chapter = {
    ...workflow,
    input: {
      ...workflow.input,
      operation: "chapter" as const,
      targetId: "chapter",
    },
  };
  const merged: CreationWorkbenchPreviewRead = {
    ...preview,
    taskType: "creation.chapter",
    targets: [
      {
        kind: "chapter" as const,
        id: "chapter",
        baseVersion: 9,
        patch: { content: "actual merged draft" },
        displayDiff: { creationWorkflowId: workflow.id },
      },
    ],
  };
  expect(matchesCreationWorkbenchPreview(merged, chapter)).toBe(true);
  for (const patch of [null, "broken", [], { content: false }])
    expect(
      matchesCreationWorkbenchPreview(
        { ...merged, targets: [{ ...merged.targets[0]!, patch }] },
        chapter,
      ),
    ).toBe(false);
  expect(
    matchesCreationWorkbenchPreview(
      {
        ...merged,
        targets: [
          {
            ...merged.targets[0]!,
            displayDiff: { creationWorkflowId: "foreign" },
          },
        ],
      },
      chapter,
    ),
  ).toBe(false);
  expect(matchesCreationWorkbenchPreview(preview, undefined)).toBe(false);
});
