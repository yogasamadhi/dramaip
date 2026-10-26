import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioClient } from "@dramaip/client";
import {
  CreationMergeSchema,
  CreationRebaseRequestSchema,
  type CreationMerge,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { ScriptMergeOrderReview } from "./features/ScriptMergeOrderReview";
import {
  completeScriptMergeOrder,
  moveScriptMergeBlock,
  readScriptMerge,
  selectedScriptMergeIds,
} from "./script-merge-order";
import {
  clearExactScriptMergeRequest,
  freezeScriptMergeRequest,
  parseScriptMergeRequest,
  resendScriptMerge,
  scriptMergeStorageKey,
  verifyScriptMergeReceipt,
} from "./script-merge-recovery";

const id = (index: number) =>
  `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const projectId = id(1),
  workflowId = id(2),
  targetId = id(3),
  [a, b, x, y] = [id(4), id(5), id(6), id(7)] as [
    string,
    string,
    string,
    string,
  ];
const basis = {
  format: "stable-screenplay-merge-v1" as const,
  projectId,
  workflowId,
  baseBlocksHash: "a".repeat(64),
  candidateHash: "b".repeat(64),
  contextHash: "d".repeat(64),
  target: {
    scriptId: targetId,
    version: 2,
    documentId: id(8),
    documentVersion: 1,
    blocksHash: "c".repeat(64),
  },
};
const merge: CreationMerge = {
  currentVersion: 2,
  basis,
  units: [
    {
      id: a,
      current: "当前 A",
      candidate: "候选 A",
      conflict: true,
      choice: "main",
      kind: "conflict",
      currentPresent: true,
      candidatePresent: true,
    },
    {
      id: b,
      current: "保留正文 B",
      candidate: "保留正文 B",
      conflict: false,
      choice: "main",
      kind: "unchanged",
      currentPresent: true,
      candidatePresent: true,
    },
    {
      id: x,
      current: "仅当前新增",
      candidate: "删除此块",
      conflict: false,
      choice: "main",
      kind: "added",
      currentPresent: true,
      candidatePresent: false,
    },
    {
      id: y,
      current: "已删除",
      candidate: "仅候选新增",
      conflict: false,
      choice: "branch",
      kind: "added",
      currentPresent: false,
      candidatePresent: true,
    },
  ],
  blockOrder: {
    format: "stable-block-order-v1",
    base: [a, b],
    current: [a, x, b],
    candidate: [a, y, b],
    proposed: [a, x, b, y],
    conflict: true,
    reason: "ambiguous-insertion",
  },
};
const input = {
  baseVersion: 2,
  choices: { [a]: "branch" as const },
  basis,
  blockOrder: [a, x, y, b],
};
const request = freezeScriptMergeRequest(
  projectId,
  targetId,
  workflowId,
  input,
  id(9),
);
const receipt: CreationWorkflow = {
  id: id(10),
  taskId: id(11),
  input: {
    projectId,
    targetId,
    operation: "script-revision",
    engineKind: "codex",
    instruction: "原修订",
    sourceIds: [],
    baseVersion: 2,
  },
  sourceWorkflowId: workflowId,
  rebaseSource: { id: workflowId, ...request.input },
  stage: "rechecking",
  version: 0,
  runIds: [],
  contextSnapshotIds: [],
  referenceVersions: [],
  sources: [],
  contextEntries: [],
  preparedPrompt: "冻结提示",
  issues: [],
  createdAt: "2026-10-03T09:00:00.000Z",
  updatedAt: "2026-10-03T09:00:00.000Z",
};

test("new merge identity, order, presence and conflict metadata are complete; historical data is not upgraded", () => {
  expect(readScriptMerge(merge, projectId, workflowId, targetId)).toEqual(
    merge,
  );
  for (const fields of [
    [id(12), workflowId, targetId],
    [projectId, id(12), targetId],
    [projectId, workflowId, id(12)],
  ] as const)
    expect(() => readScriptMerge(merge, ...fields)).toThrow("不属于");
  for (const broken of [
    { ...merge, basis: undefined },
    { ...merge, blockOrder: undefined },
    { ...merge, currentVersion: 1 },
    {
      ...merge,
      units: merge.units.map((v) => ({ ...v, currentPresent: undefined })),
    },
    { ...merge, units: [...merge.units, merge.units[0]] },
    { ...merge, blockOrder: { ...merge.blockOrder!, current: [a, a, b] } },
    {
      ...merge,
      blockOrder: { ...merge.blockOrder!, proposed: [a, b, id(99)] },
    },
    { ...merge, blockOrder: { ...merge.blockOrder!, reason: undefined } },
  ])
    expect(CreationMergeSchema.safeParse(broken).success).toBe(false);
  const historical = CreationMergeSchema.parse({
    currentVersion: 2,
    units: [],
  });
  expect(historical.basis).toBeUndefined();
  expect(historical.blockOrder).toBeUndefined();
});
test("author choices determine exact retained identities separately from visible order drafts", () => {
  expect(selectedScriptMergeIds(merge, {})).toEqual([a, b, x, y]);
  expect(selectedScriptMergeIds(merge, { [x]: "branch", [y]: "main" })).toEqual(
    [a, b],
  );
  const start = completeScriptMergeOrder([a, b, a, id(99)], [a, b, x, y]);
  expect(start).toEqual([a, b, x, y]);
  expect(moveScriptMergeBlock(start, y, -1)).toEqual([a, b, y, x]);
  expect(start).toEqual([a, b, x, y]);
  expect(moveScriptMergeBlock(start, a, -1)).toEqual(start);
  expect(moveScriptMergeBlock(start, id(99), 1)).toEqual(start);
});
test("full order review displays both additions and unresolved positions without implying semantic approval", () => {
  const markup = renderToStaticMarkup(
    <ScriptMergeOrderReview
      merge={merge}
      choices={{ [a]: "branch" }}
      confirmed={false}
      busy={false}
      onOrder={() => {}}
      onConfirm={() => {}}
    />,
  );
  for (const text of [
    "排序存在冲突",
    "仅当前新增",
    "仅候选新增",
    "候选 A",
    "保留正文 B",
    "不代表语义安全",
    "原基准",
    "排序起点不是采用决定",
    "上移合并块 4",
  ])
    expect(markup).toContain(text);
  expect(markup).not.toContain('checked=""');
  const legacy = renderToStaticMarkup(
    <ScriptMergeOrderReview
      merge={{ currentVersion: 2, units: [] }}
      choices={{}}
      confirmed={false}
      busy={false}
      onOrder={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(legacy).toContain("历史比较未提供块顺序协议");
  expect(legacy).not.toContain("checkbox");
});
test("manual order requires a real basis and unique IDs; legacy requests remain unchanged", () => {
  expect(
    CreationRebaseRequestSchema.parse({ baseVersion: 2, choices: {} }),
  ).toEqual({ baseVersion: 2, choices: {} });
  expect(
    CreationRebaseRequestSchema.safeParse({
      baseVersion: 2,
      choices: {},
      blockOrder: [a, b],
    }).success,
  ).toBe(false);
  expect(
    CreationRebaseRequestSchema.safeParse({ ...input, blockOrder: [a, a] })
      .success,
  ).toBe(false);
  expect(
    CreationRebaseRequestSchema.safeParse({ ...input, consent: true }).success,
  ).toBe(false);
});
test("pending recovery persists only original body-free identity and refuses malformed or mismatched scope", () => {
  const raw = JSON.stringify(request);
  expect(parseScriptMergeRequest(raw, projectId, targetId)).toEqual(request);
  expect(parseScriptMergeRequest(null, projectId, targetId)).toBeUndefined();
  for (const value of [
    "invalid",
    JSON.stringify({ ...request, path: "/private" }),
    JSON.stringify({ ...request, approved: true }),
    JSON.stringify({ ...request, input: { ...input, basis: undefined } }),
  ])
    expect(() => parseScriptMergeRequest(value, projectId, targetId)).toThrow();
  expect(() => parseScriptMergeRequest(raw, id(99), targetId)).toThrow();
  expect(() =>
    freezeScriptMergeRequest(projectId, id(99), workflowId, input),
  ).toThrow();
  expect(raw).not.toContain("正文");
  expect(raw).not.toContain("confirmed");
});
test("resend uses the exact original request/key and accepts only the matching real receipt", async () => {
  const calls: unknown[] = [];
  const client = {
    rebase: async (...args: unknown[]) => {
      calls.push(args);
      return receipt;
    },
  } as unknown as StudioClient["creation"];
  expect(await resendScriptMerge(client, request)).toEqual(receipt);
  expect(calls).toEqual([[workflowId, request.input, request.key]]);
  for (const altered of [
    { ...receipt, input: { ...receipt.input, baseVersion: 99 } },
    { ...receipt, sourceWorkflowId: id(99) },
    { ...receipt, input: { ...receipt.input, targetId: id(99) } },
    {
      ...receipt,
      rebaseSource: { ...receipt.rebaseSource!, blockOrder: [a, y, x, b] },
    },
    {
      ...receipt,
      rebaseSource: {
        ...receipt.rebaseSource!,
        basis: { ...basis, candidateHash: "d".repeat(64) },
      },
    },
  ])
    expect(() => verifyScriptMergeReceipt(altered, request)).toThrow("回执");
});
test("unknown response failures keep the original request and cannot clear a replacement request", async () => {
  const store = new Map([
    [scriptMergeStorageKey(projectId, targetId), JSON.stringify(request)],
  ]);
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  const client = {
    rebase: async () => {
      throw new Error("受控回复丢失");
    },
  } as unknown as StudioClient["creation"];
  await expect(resendScriptMerge(client, request)).rejects.toThrow(
    "受控回复丢失",
  );
  expect(
    parseScriptMergeRequest(
      storage.getItem(scriptMergeStorageKey(projectId, targetId)),
      projectId,
      targetId,
    ),
  ).toEqual(request);
  const replacement = freezeScriptMergeRequest(
    projectId,
    targetId,
    workflowId,
    input,
    id(20),
  );
  store.set(
    scriptMergeStorageKey(projectId, targetId),
    JSON.stringify(replacement),
  );
  expect(clearExactScriptMergeRequest(storage, request)).toBe(false);
  expect(clearExactScriptMergeRequest(storage, replacement)).toBe(true);
  expect(store.size).toBe(0);
});
