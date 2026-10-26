import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type { WritingVolumeAssignmentInput } from "@dramaip/contracts/writing";
const id = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-06T00:00:00.000Z";
const volume = {
  id: id(2),
  projectId: id(1),
  title: "实际卷",
  outline: "规划",
  version: 0,
  orderIndex: 0,
  createdAt: at,
  updatedAt: at,
};
const input: WritingVolumeAssignmentInput = {
  chapters: [
    { chapterId: id(3), version: 4, volumeId: id(2) },
    { chapterId: id(4), version: 2, volumeId: null },
  ],
  volumes: [{ id: id(2), version: 0 }],
};
const receipt = {
  id: id(5),
  projectId: id(1),
  input,
  committedAt: at,
  chapters: input.chapters.map((item) => ({
    ...item,
    version: item.version + 1,
  })),
};
function client(reply: unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id(1),
    runtimeGeneration: 1,
    fetch: async (request, init) => {
      calls.push(new Request(request, init));
      return reply instanceof Response ? reply : Response.json(reply);
    },
    openEventStream: async () => new Response(),
  }).writingVolumes;
  return { sdk, calls };
}
test("卷 SDK 原键创建和完整明确批量归属，不逐章调用或替换原版本", async () => {
  const created = client(volume);
  expect(
    await created.sdk.create(
      id(1),
      { title: "实际卷", outline: "规划" },
      "original-volume-key",
    ),
  ).toEqual(volume);
  expect(created.calls[0]!.headers.get("Idempotency-Key")).toBe(
    "original-volume-key",
  );
  const assigned = client(receipt);
  expect(
    await assigned.sdk.assign(id(1), input, "original-membership-key"),
  ).toEqual(receipt);
  expect(assigned.calls).toHaveLength(1);
  expect(
    assigned.calls[0]!.url.endsWith(`/projects/${id(1)}/volume-memberships`),
  ).toBe(true);
  expect(JSON.parse(await assigned.calls[0]!.text())).toEqual(input);
});
test("卷 SDK 拒绝异项目、错误原输入、错误结果版本和创建回执", async () => {
  for (const raw of [
    { ...receipt, projectId: id(9) },
    {
      ...receipt,
      input: {
        ...input,
        chapters: [{ ...input.chapters[0]!, version: 8 }, input.chapters[1]!],
      },
    },
    {
      ...receipt,
      chapters: [
        { ...receipt.chapters[0]!, version: 99 },
        receipt.chapters[1]!,
      ],
    },
  ])
    await expect(
      client(raw).sdk.assign(id(1), input, "original-membership-key"),
    ).rejects.toThrow();
  for (const raw of [
    { ...volume, projectId: id(9) },
    { ...volume, version: 1 },
    { ...volume, title: "不是原输入" },
  ])
    await expect(
      client(raw).sdk.create(
        id(1),
        { title: "实际卷", outline: "规划" },
        "original-volume-key",
      ),
    ).rejects.toThrow();
});
test("卷 SDK 读取验证分页和归属，拒绝不完整或失败响应", async () => {
  const current = client({ items: [volume], nextCursor: "0" });
  expect((await current.sdk.list(id(1), { limit: 1 })).items).toEqual([volume]);
  expect(current.calls[0]!.url.endsWith("/volumes?limit=1")).toBe(true);
  for (const raw of [
    { items: [{ ...volume, projectId: id(9) }] },
    { items: [volume, volume] },
    { items: [volume], nextCursor: "wrong" },
  ])
    await expect(client(raw).sdk.list(id(1))).rejects.toThrow();
  const unavailable = client(
    Response.json(
      { status: 503, code: "UNAVAILABLE", title: "当前读取失败" },
      { status: 503 },
    ),
  );
  await expect(unavailable.sdk.list(id(1))).rejects.toThrow();
  expect(unavailable.calls).toHaveLength(1);
});
test("卷 SDK 不发送无效原键或重复章节，也不猜缺失卷版本", async () => {
  const { sdk, calls } = client(receipt);
  await expect(
    sdk.assign(
      id(1),
      { ...input, chapters: [input.chapters[0]!, input.chapters[0]!] },
      "original-membership-key",
    ),
  ).rejects.toThrow();
  await expect(
    sdk.assign(id(1), { ...input, volumes: [] }, "original-membership-key"),
  ).rejects.toThrow();
  await expect(sdk.assign(id(1), input, " ")).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
