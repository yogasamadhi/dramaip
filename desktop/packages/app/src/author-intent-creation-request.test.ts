import { expect, test } from "bun:test";
import type { AuthorIntentSourceCatalog } from "@dramaip/contracts/workspace";
import { confirmAuthorIntentCreationRequest } from "./author-intent-creation-request";

const catalog = (count = 2): AuthorIntentSourceCatalog => ({
  projectVersion: 4,
  baseAdoptedId: crypto.randomUUID(),
  chapterAvailable: true,
  scriptAvailable: false,
  items: Array.from({ length: count }, (_, i) => ({
    title: `仅元数据的来源 ${i + 1}`,
    source: {
      kind: "chapter",
      id: crypto.randomUUID(),
      version: i,
      contentHash: "a".repeat(64),
    },
  })),
});
test("AI 意图简报独立确认不补章节或未启用的剧本能力", () => {
  const data = catalog();
  expect(confirmAuthorIntentCreationRequest(data, [])).toEqual({
    request: {
      projectVersion: 4,
      baseAdoptedId: data.baseAdoptedId,
      sources: [],
    },
  });
});
test("AI 意图只绑定明确来源的真实版本和当时正式头，不改目录或原顺序", () => {
  const data = catalog();
  const before = structuredClone(data);
  expect(
    confirmAuthorIntentCreationRequest(data, [data.items[1]!.source.id]),
  ).toEqual({
    request: {
      projectVersion: 4,
      baseAdoptedId: data.baseAdoptedId,
      sources: [data.items[1]!.source],
    },
  });
  expect(data).toEqual(before);
});
test("AI 意图缺失、重复和超限选择必须可读拒绝，不忽略或截断", () => {
  const data = catalog(101);
  for (const ids of [
    [crypto.randomUUID()],
    [data.items[0]!.source.id, data.items[0]!.source.id],
    data.items.map((item) => item.source.id),
  ]) {
    expect(confirmAuthorIntentCreationRequest(data, ids)).toHaveProperty(
      "error",
    );
    expect(confirmAuthorIntentCreationRequest(data, ids)).not.toHaveProperty(
      "request",
    );
  }
  const valid = confirmAuthorIntentCreationRequest(
    data,
    data.items.slice(0, 100).map((item) => item.source.id),
  );
  expect("request" in valid && valid.request.sources.length).toBe(100);
});
test("AI 意图保存实际剧本的文档版本或 null，不伪造 AST 与采用基准", () => {
  const data = catalog(0);
  data.scriptAvailable = true;
  for (const documentVersion of [null, 7]) {
    const source = {
      kind: "script" as const,
      id: crypto.randomUUID(),
      version: 3,
      documentVersion,
      contentHash: "b".repeat(64),
    };
    data.items = [{ title: "已有剧本", source }];
    expect(confirmAuthorIntentCreationRequest(data, [source.id])).toEqual({
      request: {
        projectVersion: 4,
        baseAdoptedId: data.baseAdoptedId,
        sources: [source],
      },
    });
  }
});
