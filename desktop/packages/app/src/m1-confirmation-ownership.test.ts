import { expect, test } from "vitest";
import type { Project, Task } from "@dramaip/contracts/product";
import type { PilotPackageRecord } from "@dramaip/contracts/delivery";
import type { ProviderActionPreviewSummary } from "@dramaip/contracts/automation";
import {
  deriveConfirmations,
  loadConfirmations,
  type ConfirmationClient,
} from "./pending-confirmations";
import { readProjectProviderReview } from "./provider-action-review";

const projectId = "10000000-0000-4000-8000-000000000001";
const previewId = "20000000-0000-4000-8000-000000000001";
const time = "2026-10-06T00:00:00.000Z";
const project = { id: projectId, title: "M1作品" } as Project;
const fee: ProviderActionPreviewSummary = {
  id: previewId,
  projectId,
  providerId: "30000000-0000-4000-8000-000000000001",
  kind: "image",
  estimatedCost: 0,
  currency: "CNY",
  status: "pending",
  createdAt: time,
};
const base = {
  projects: [project],
  tasks: [],
  workflows: [],
  storyBible: [],
  imports: [],
  manuscripts: [],
};
const client = (
  patch: Partial<ConfirmationClient> = {},
): ConfirmationClient => ({
  projects: { list: async () => [project] },
  tasks: { list: async () => [] },
  creation: { list: async () => ({ items: [] }) },
  storyBible: { list: async () => [] },
  importExtractions: { list: async () => [] },
  manuscripts: { list: async () => ({ items: [] }) },
  revisions: { list: async () => ({ items: [] }) },
  authorIntents: { list: async () => ({ items: [] }) },
  providerActionPreviews: {
    summaries: async () => ({ projectId, items: [fee] }),
  },
  pilotPackages: { list: async () => ({ items: [] }) },
  ...patch,
});

test("M1费用待确认使用owner状态、独立无任务预览、真实零与未知币种，旧任务不重复计数", () => {
  const oldTask: Task = {
    id: "original-task",
    projectId,
    title: "旧任务",
    resultStatus: "pending",
    status: "succeeded",
    kind: "controlled-fixture",
    progress: 100,
    attentionStatus: "open",
    createdAt: time,
    result: {
      providerActionPreview: {
        id: fee.id,
        status: "pending",
        estimatedCost: 99,
        parameters: { prompt: "PRIVATE STALE" },
      },
    },
    updatedAt: time,
  };
  const items = deriveConfirmations({
    ...base,
    tasks: [oldTask],
    providerActions: [fee],
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    kind: "provider-action",
    category: "waiting",
    objectId: fee.id,
  });
  expect(items[0]!.detail).toContain("0.0000 CNY");
  expect(items[0]!.to).toContain(`providerActionPreviewId=${fee.id}`);
  expect(JSON.stringify(items)).not.toContain("PRIVATE STALE");
  expect(
    deriveConfirmations({
      ...base,
      providerActions: [{ ...fee, currency: undefined }],
    })[0],
  ).toMatchObject({ category: "attention" });
  for (const status of ["executed", "discarded", "expired"] as const)
    expect(
      deriveConfirmations({
        ...base,
        tasks: [oldTask],
        providerActions: [{ ...fee, status }],
      }),
    ).toEqual([]);
});

test("M1内部试制包确认返回原包／原分集，来源失败和保存中分开，历史保存不重新索取授权", () => {
  const pack = {
    id: "original-package",
    status: "awaiting-confirmation",
    sourceState: "current",
    updatedAt: time,
    manifest: {
      projectId,
      episodeId: "original-episode",
      adopted: { storyboard: { id: "original-board", version: 3 } },
    },
  } as PilotPackageRecord;
  const item = deriveConfirmations({ ...base, pilotPackages: [pack] })[0]!;
  expect(item).toMatchObject({ kind: "pilot-package", category: "waiting" });
  expect(item.to).toContain("episodeId=original-episode");
  expect(item.to).toContain("pilotPackageId=original-package");
  expect(item.detail).toContain("不等于授权证明");
  expect(
    deriveConfirmations({
      ...base,
      pilotPackages: [{ ...pack, sourceState: "stale" }],
    })[0],
  ).toMatchObject({ category: "attention" });
  expect(
    deriveConfirmations({
      ...base,
      pilotPackages: [{ ...pack, status: "saving" }],
    })[0],
  ).toMatchObject({ category: "running" });
  for (const status of ["saved", "canceled"] as const)
    expect(
      deriveConfirmations({ ...base, pilotPackages: [{ ...pack, status }] }),
    ).toEqual([]);
});

test("M1费用完整扫描拒绝重复、错项目、循环游标和正文，不把读取失败当空成功", async () => {
  const next = { ...fee, id: "20000000-0000-4000-8000-000000000002" };
  const calls: Array<string | undefined> = [];
  const complete = await loadConfirmations(
    client({
      providerActionPreviews: {
        summaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? { projectId, items: [next] }
            : { projectId, items: [fee], nextCursor: fee.id };
        },
      },
    }),
  );
  expect(calls).toEqual([undefined, fee.id]);
  expect(
    complete.items.filter((item) => item.kind === "provider-action"),
  ).toHaveLength(2);
  for (const page of [
    { projectId, items: [fee], nextCursor: fee.id },
    { projectId: "10000000-0000-4000-8000-000000000002", items: [fee] },
    { projectId, items: [{ ...fee, parameters: { prompt: "PRIVATE PAGE" } }] },
    { projectId, items: [fee], nextCursor: next.id },
  ]) {
    const rejected = await loadConfirmations(
      client({ providerActionPreviews: { summaries: async () => page } }),
    );
    expect(
      rejected.items.filter((item) => item.kind === "provider-action"),
    ).toEqual([]);
    expect(rejected.unavailable).toContainEqual({
      source: "费用与外部调用确认",
      projectId,
    });
  }
  const legacy = await loadConfirmations(
    client({ providerActionPreviews: undefined, pilotPackages: undefined }),
  );
  expect(legacy.unavailable).toContainEqual({
    source: "费用与外部调用确认",
    projectId,
  });
  expect(legacy.unavailable).toContainEqual({
    source: "内部试制包权利确认",
    projectId,
  });
});

test("M1独立费用原对象读取必须匹配实际项目和预览，没有任务不伪造任务，失败不写入", async () => {
  const preview = { ...fee, parameters: { prompt: "ACTUAL PRIVATE" } };
  const reader = {
    projects: { get: async () => project },
    providerActionPreviews: { get: async () => preview },
  };
  expect(
    await readProjectProviderReview(
      reader as Parameters<typeof readProjectProviderReview>[0],
      { id: fee.id, projectId },
    ),
  ).toEqual(preview);
  for (const patch of [
    { id: "20000000-0000-4000-8000-000000000002" },
    { projectId: "10000000-0000-4000-8000-000000000002" },
  ]) {
    const bad = {
      ...reader,
      providerActionPreviews: { get: async () => ({ ...preview, ...patch }) },
    };
    await expect(
      readProjectProviderReview(
        bad as Parameters<typeof readProjectProviderReview>[0],
        { id: fee.id, projectId },
      ),
    ).rejects.toThrow("归属不符");
  }
  const missing = {
    ...reader,
    projects: {
      get: async () => {
        throw new Error("owner unavailable");
      },
    },
  };
  await expect(
    readProjectProviderReview(
      missing as Parameters<typeof readProjectProviderReview>[0],
      { id: fee.id, projectId },
    ),
  ).rejects.toThrow("owner unavailable");
});
