import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
const projectId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const item = {
  id,
  projectId,
  kind: "image",
  providerId: "30000000-0000-4000-8000-000000000001",
  status: "pending",
  estimatedCost: 0,
  currency: "CNY",
  createdAt: "2026-10-06T00:00:00.000Z",
};
function fixture(reply: unknown, status = 200) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json(reply, { status });
    },
    openEventStream: async () => new Response(),
  });
  return { sdk, calls };
}
test("M1费用SDK只读精确项目与完整游标、真实零、不读取参数或执行调用", async () => {
  const f = fixture({ projectId, items: [item], nextCursor: id });
  expect(
    (await f.sdk.providerActionPreviews.summaries(projectId, id, 1)).items[0]!
      .estimatedCost,
  ).toBe(0);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.method).toBe("GET");
  expect(new URL(f.calls[0]!.url).pathname).toBe(
    `/api/v2/projects/${projectId}/provider-action-preview-summaries`,
  );
  expect(new URL(f.calls[0]!.url).searchParams.get("cursor")).toBe(id);
  expect(new URL(f.calls[0]!.url).searchParams.get("limit")).toBe("1");
});
test("M1费用SDK拒绝错项目、重复身份、错误游标与私有正文扩展", async () => {
  const foreign = "10000000-0000-4000-8000-000000000002";
  for (const reply of [
    { projectId: foreign, items: [item] },
    { projectId, items: [{ ...item, projectId: foreign }] },
    { projectId, items: [item, item] },
    { projectId, items: [item], nextCursor: foreign },
    { projectId, items: [{ ...item, parameters: { prompt: "PRIVATE" } }] },
  ])
    await expect(
      fixture(reply).sdk.providerActionPreviews.summaries(projectId),
    ).rejects.toThrow();
  await expect(
    fixture(
      { status: 503, title: "owner unavailable" },
      503,
    ).sdk.providerActionPreviews.summaries(projectId),
  ).rejects.toThrow();
});
