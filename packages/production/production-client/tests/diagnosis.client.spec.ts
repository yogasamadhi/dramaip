import { expect, test } from "vitest";
import {
  confirmDiagnosisRequest,
  originalDiagnosisCandidate,
  originalDiagnosisWorkflow,
  parseDiagnosisRequest,
  readDiagnosisDraft,
  type Diagnosis,
  type DiagnosisCatalog,
  type Workflow,
} from "../src/client/diagnosis/diagnosis.ts";
import { parseNarrativeContext } from "../src/client/tools/parse.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ONE = "22222222-2222-4222-8222-222222222222";
const TWO = "33333333-3333-4333-8333-333333333333";
const INTENT = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);
const target = {
  format: "short-drama",
  episodeCount: 12,
  durationSeconds: 90,
} as const;
const chapter = (id: string, orderIndex: number) => ({
  id,
  version: 1,
  title: `第${orderIndex + 1}章`,
  orderIndex,
  contentHash: HASH,
  characters: 100,
});
const catalog: DiagnosisCatalog = {
  projectId: PROJECT,
  chapters: [chapter(ONE, 0), chapter(TWO, 1)],
  inventoryFingerprint: HASH,
  authorIntent: { id: INTENT, version: 2 },
};
const request = {
  scope: "selected-chapters",
  chapters: [{ id: ONE, version: 1 }],
  inventoryFingerprint: HASH,
  authorIntent: { id: INTENT, version: 2 },
  rightsDeclared: true,
  target,
} as const;

test("确认来源按目录顺序冻结作者意图、权利与目标", () => {
  expect(
    confirmDiagnosisRequest(catalog, {
      scope: "selected-chapters",
      selected: [ONE],
      rights: true,
      target,
    }),
  ).toEqual({ request });
  expect(
    confirmDiagnosisRequest(
      { ...catalog, adoptedDiagnosisId: TWO },
      { scope: "whole-book", selected: [TWO, ONE], rights: true, target },
    ),
  ).toEqual({
    request: {
      ...request,
      scope: "whole-book",
      chapters: [
        { id: ONE, version: 1 },
        { id: TWO, version: 1 },
      ],
      baseAdoptedId: TWO,
    },
  });
});

test("缺作者意图、权利、章节、有效目标或全书未全选时拒绝", () => {
  const choice = {
    scope: "selected-chapters" as const,
    selected: [ONE],
    rights: true,
    target,
  };
  const { authorIntent: _, ...noIntent } = catalog;
  expect(confirmDiagnosisRequest(noIntent, choice)).toEqual({
    error: "intent",
  });
  for (const other of [
    { ...choice, rights: false },
    { ...choice, selected: [] },
    { ...choice, target: { ...target, episodeCount: 0 } },
    { ...choice, target: { ...target, durationSeconds: 1801 } },
    { ...choice, target: { ...target, episodeCount: 1.5 } },
  ])
    expect(confirmDiagnosisRequest(catalog, other)).toEqual({
      error: "invalid",
    });
  expect(
    confirmDiagnosisRequest(catalog, { ...choice, scope: "whole-book" }),
  ).toEqual({ error: "whole-book" });
});

test("本机草稿只恢复严格合法请求", () => {
  expect(readDiagnosisDraft(JSON.stringify(request))).toEqual(request);
  for (const raw of [
    null,
    "{",
    JSON.stringify({ ...request, extra: 1 }),
    JSON.stringify({ ...request, rightsDeclared: false }),
    JSON.stringify({ ...request, inventoryFingerprint: "x" }),
    JSON.stringify({ ...request, authorIntent: { id: INTENT, version: 0 } }),
    JSON.stringify({ ...request, chapters: [{ id: "not-uuid", version: 1 }] }),
    JSON.stringify({ ...request, baseAdoptedId: "not-uuid" }),
    JSON.stringify({ ...request, context: { format: "other", chapters: [] } }),
  ])
    expect(readDiagnosisDraft(raw)).toBeUndefined();
  const context = {
    format: "narrative-context-v1",
    chapters: [{ id: ONE, version: 1, representation: "original" }],
  };
  expect(parseDiagnosisRequest({ ...request, context })).toEqual({
    ...request,
    context,
  });
});

test("叙事上下文拒绝重复、空段落与多余字段", () => {
  const base = { format: "narrative-context-v1", chapters: [] };
  expect(parseNarrativeContext(base)).toEqual(base);
  const paragraphs = {
    id: ONE,
    version: 1,
    representation: "paragraphs",
    paragraphIds: ["p1", "p2"],
  };
  expect(
    parseNarrativeContext({ ...base, chapters: [paragraphs] }),
  ).toBeDefined();
  expect(
    parseNarrativeContext({
      ...base,
      chapters: [
        {
          id: ONE,
          version: 1,
          representation: "summary",
          record: { id: TWO, version: 3 },
        },
      ],
      summaries: [{ id: TWO, version: 1 }],
      story: [{ id: TWO, version: 1, kind: "assertion" }],
    }),
  ).toBeDefined();
  for (const other of [
    { ...base, chapters: [paragraphs, paragraphs] },
    { ...base, chapters: [{ ...paragraphs, paragraphIds: [] }] },
    { ...base, chapters: [{ ...paragraphs, paragraphIds: ["p", "p"] }] },
    { ...base, chapters: [{ ...paragraphs, paragraphIds: [""] }] },
    { ...base, chapters: [{ ...paragraphs, extra: true }] },
    { ...base, chapters: [{ id: ONE, version: 1, representation: "other" }] },
    {
      ...base,
      summaries: [
        { id: TWO, version: 1 },
        { id: TWO, version: 2 },
      ],
    },
    {
      ...base,
      story: [
        { id: TWO, version: 1, kind: "assertion" },
        { id: TWO, version: 2, kind: "assertion" },
      ],
    },
    { ...base, story: [{ id: TWO, version: 1, kind: "other" }] },
    { ...base, extra: 1 },
  ])
    expect(parseNarrativeContext(other)).toBeUndefined();
});

const workflow = {
  id: "run",
  input: {
    projectId: PROJECT,
    operation: "adaptation-diagnosis",
    diagnosisRequest: request,
  },
  diagnosisId: "diagnosis",
  diagnosisBasis: { scope: "selected-chapters", target },
} as unknown as Workflow;
const diagnosis = {
  id: "diagnosis",
  projectId: PROJECT,
  workflowId: "run",
  basis: { target, scope: "selected-chapters" },
} as unknown as Diagnosis;

test("原运行须是本项目诊断运行并带冻结请求", () => {
  const scope = { projectId: PROJECT, workflowId: "run" };
  expect(originalDiagnosisWorkflow(workflow, scope)).toBe(workflow);
  expect(
    originalDiagnosisWorkflow(workflow, { ...scope, projectId: "other" }),
  ).toBeUndefined();
  expect(
    originalDiagnosisWorkflow(
      { ...workflow, input: { ...workflow.input, operation: "season-plan" } },
      scope,
    ),
  ).toBeUndefined();
  const { diagnosisRequest: _, ...bare } = workflow.input;
  expect(
    originalDiagnosisWorkflow({ ...workflow, input: bare }, scope),
  ).toBeUndefined();
});

test("候选须是原运行产出且冻结来源相同（成员顺序不算变化）", () => {
  const scope = { projectId: PROJECT, diagnosisId: "diagnosis" };
  expect(originalDiagnosisCandidate(diagnosis, scope)).toBe(diagnosis);
  expect(
    originalDiagnosisCandidate(
      diagnosis,
      { ...scope, workflowId: "run" },
      workflow,
    ),
  ).toBe(diagnosis);
  for (const [other, run] of [
    [{ ...diagnosis, projectId: "other" }, workflow],
    [{ ...diagnosis, id: "other" }, workflow],
    [{ ...diagnosis, workflowId: "other" }, workflow],
    [diagnosis, { ...workflow, diagnosisId: "other" }],
    [
      diagnosis,
      {
        ...workflow,
        diagnosisBasis: {
          ...workflow.diagnosisBasis,
          target: { ...target, episodeCount: 13 },
        },
      },
    ],
    [diagnosis, undefined],
  ] as const)
    expect(
      originalDiagnosisCandidate(
        other as Diagnosis,
        { ...scope, workflowId: "run" },
        run as Workflow | undefined,
      ),
    ).toBeUndefined();
});
