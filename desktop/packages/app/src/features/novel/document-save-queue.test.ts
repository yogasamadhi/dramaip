import { expect, test } from "vitest";
import {
  DocumentSaveQueue,
  responseMatchesCurrentDraft,
} from "./document-save-queue";

test("同一文档的保存严格串行，后续保存读取前一次提交结果后执行", async () => {
  const queue = new DocumentSaveQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = queue.enqueue("chapter-1", async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
    return 1;
  });
  const second = queue.enqueue("chapter-1", async () => {
    order.push("second:start");
    return 2;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual(["first:start"]);
  releaseFirst();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(order).toEqual(["first:start", "first:end", "second:start"]);
});

test("旧保存响应不能把更新内容或另一个章节标成已保存", () => {
  const snapshot = {
    documentId: "chapter-1",
    revision: 3,
    title: "第一章",
    content: "旧输入",
  };
  expect(
    responseMatchesCurrentDraft({
      snapshot,
      activeDocumentId: "chapter-1",
      currentRevision: 4,
      currentTitle: "第一章",
      currentContent: "旧输入和新输入",
    }),
  ).toBe(false);
  expect(
    responseMatchesCurrentDraft({
      snapshot,
      activeDocumentId: "chapter-2",
      currentRevision: 3,
      currentTitle: "第一章",
      currentContent: "旧输入",
    }),
  ).toBe(false);
});
