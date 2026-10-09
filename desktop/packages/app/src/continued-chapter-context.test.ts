import { expect, test } from "bun:test";
import { rememberContinuedChapterContext } from "./continued-chapter-context";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";

const projectId = crypto.randomUUID(),
  sourceChapterId = crypto.randomUUID();
const chapterId = crypto.randomUUID();
const now = "2026-10-04T21:50:00.000Z";
const result = {
  chapter: {
    id: chapterId,
    projectId,
    title: "new empty target",
    orderIndex: 1,
    summary: "",
    content: "",
    version: 0,
    createdAt: now,
    updatedAt: now,
  },
  run: {
    chapterId,
    taskId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    autoCommitWhenReady: false,
  },
};
const request: NarrativeContextRequest = {
  format: "narrative-context-v1",
  chapters: [{ id: sourceChapterId, version: 4, representation: "original" }],
};
const input = { projectId, sourceChapterId, result, request };
const key = `dramaip-novel-context:${projectId}:${chapterId}`;
function local() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("续章只将原明确选择写入实际返回新章，不改原章／其他项目或替换请求版本", () => {
  const storage = local();
  storage.setItem(
    `dramaip-novel-context:${projectId}:${sourceChapterId}`,
    "original draft",
  );
  storage.setItem("another-project-key", "private other choice");
  expect(rememberContinuedChapterContext(storage, input)).toEqual(result);
  expect(storage.getItem(key)).toBe(JSON.stringify(request));
  expect(
    storage.getItem(`dramaip-novel-context:${projectId}:${sourceChapterId}`),
  ).toBe("original draft");
  expect(storage.getItem("another-project-key")).toBe("private other choice");
  expect(JSON.parse(storage.getItem(key)!).chapters[0].version).toBe(4);
  expect(rememberContinuedChapterContext(storage, input)).toEqual(result);
});

test("不同项目／原章当新章／错运行目标／自动采用和损坏实际回执均拒绝，未写草稿", () => {
  for (const other of [
    {
      ...result,
      chapter: { ...result.chapter, projectId: crypto.randomUUID() },
    },
    { ...result, chapter: { ...result.chapter, id: sourceChapterId } },
    { ...result, run: { ...result.run, chapterId: crypto.randomUUID() } },
    { ...result, run: { ...result.run, autoCommitWhenReady: true } },
    { ...result, run: { ...result.run, taskId: "not-a-task" } },
  ]) {
    const storage = local();
    expect(() =>
      rememberContinuedChapterContext(storage, { ...input, result: other }),
    ).toThrow();
    expect(storage.data.size).toBe(0);
  }
});

test("已存在不同／损坏新章选择或存储失败不补空范围、不覆盖或假称保存", () => {
  for (const prior of [
    JSON.stringify({ ...request, chapters: [] }),
    "broken json",
  ]) {
    const storage = local();
    storage.setItem(key, prior);
    expect(() => rememberContinuedChapterContext(storage, input)).toThrow();
    expect(storage.getItem(key)).toBe(prior);
  }
  const absent = local();
  expect(() =>
    rememberContinuedChapterContext({ ...absent, setItem: () => {} }, input),
  ).toThrow();
  expect(absent.data.size).toBe(0);
  expect(() =>
    rememberContinuedChapterContext(
      {
        ...absent,
        setItem: () => {
          throw new Error("quota");
        },
      },
      input,
    ),
  ).toThrow("quota");
  expect(absent.data.size).toBe(0);
});
