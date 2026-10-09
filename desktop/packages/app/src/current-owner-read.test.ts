import { expect, test } from "bun:test";
import {
  successfulOwnerRead,
  currentOwnerQuery,
  sameFrozenOwnerSnapshot,
  exactNavigationError,
} from "./current-owner-read";

test("本次owner读取没有完成或失败时清除旧缓存，只保留本次实际成功的快照", () => {
  const data = { id: "original", content: "PRIVATE original" },
    good = {
      data,
      status: "success",
      isFetchedAfterMount: true,
      isFetching: false,
    };
  expect(successfulOwnerRead(good)).toBe(data);
  expect(currentOwnerQuery({ ...good, isFetching: true }).data).toBe(data);
  for (const invalid of [
    { status: "pending" },
    { status: "error" },
    { error: new Error("owner unavailable") },
    { isFetchedAfterMount: false },
  ]) {
    const query = { ...good, ...invalid };
    expect(successfulOwnerRead(query)).toBeUndefined();
    expect(currentOwnerQuery(query).data).toBeUndefined();
    expect(query.data).toBe(data);
  }
});

test("原冻结值完整比较保留数组顺序／实际范围，缺值不当相等，不靠JSON成员顺序误拒绝", () => {
  const original = {
    target: { id: "old", version: 2 },
    chapters: [
      { id: "one", version: 1 },
      { id: "two", version: 2 },
    ],
    expectedHead: null,
  };
  expect(
    sameFrozenOwnerSnapshot(original, {
      expectedHead: null,
      chapters: original.chapters,
      target: { version: 2, id: "old" },
    }),
  ).toBe(true);
  for (const other of [
    undefined,
    { ...original, expectedHead: "new" },
    { ...original, target: { ...original.target, version: 3 } },
    { ...original, chapters: [...original.chapters].reverse() },
    { ...original, chapters: original.chapters.slice(0, 1) },
  ])
    expect(sameFrozenOwnerSnapshot(original, other)).toBe(false);
  expect(sameFrozenOwnerSnapshot(undefined, undefined)).toBe(false);
});

test("空白／重复原ID拒绝，不能退回目录最新值，普通目录参数不受影响", () => {
  const keys = [
    "workflowId",
    "reportId",
    "summaryId",
    "summaryWorkflowId",
    "diagnosisId",
    "seasonPlanId",
    "intentId",
    "intentWorkflowId",
  ];
  for (const key of keys)
    for (const value of [
      `${key}=`,
      `${key}=%20`,
      `${key}=old&${key}=old`,
      `${key}=old&${key}=new`,
    ])
      expect(
        exactNavigationError(new URLSearchParams(value), keys),
      ).toBeTruthy();
  expect(
    exactNavigationError(
      new URLSearchParams("reportId=old&workflowId=original&mode=all"),
      keys,
    ),
  ).toBeUndefined();
});
