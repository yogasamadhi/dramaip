import { expect, test } from "bun:test";
import {
  clearAuthorIntentDraft,
  emptyAuthorIntentEdit,
  readAuthorIntentDraft,
  saveAuthorIntentDraft,
  type AuthorIntentDraftStorage,
} from "./author-intent-draft";
const first = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const head = "33333333-3333-4333-8333-333333333333";
function memory() {
  const values = new Map<string, string>();
  const storage: AuthorIntentDraftStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { values, store: () => storage };
}
test("作者意图部分编辑按项目本地恢复，保留原项目／采用基准及未完成的约束文本", () => {
  const { store } = memory();
  const edit = {
    ...emptyAuthorIntentEdit(7),
    baseAdoptedId: head,
    sourceKind: "legacy-project" as const,
  };
  edit.fields.themeStatement = "PRIVATE 未写完的主题";
  edit.fields.mustKeep = "保留一\n\n尚未填完：";
  const saved = saveAuthorIntentDraft(first, edit, null, store);
  expect(saved.error).toBeUndefined();
  const loaded = readAuthorIntentDraft(first, store);
  expect(loaded.record).toMatchObject({
    schemaVersion: 1,
    projectId: first,
    ...edit,
  });
  expect(loaded.raw).toBe(saved.raw!);
  expect(readAuthorIntentDraft(other, store)).toEqual({ raw: null });
  expect(loaded.record).not.toHaveProperty("confirmed");
  expect(loaded.record).not.toHaveProperty("isCurrent");
});
test("两个项目编辑与明确清空独立，清空不删除普通偏好或其他作品", () => {
  const { values, store } = memory();
  values.set("ordinary-user-preference", "keep");
  const a = saveAuthorIntentDraft(first, emptyAuthorIntentEdit(1), null, store);
  const b = saveAuthorIntentDraft(other, emptyAuthorIntentEdit(4), null, store);
  expect(clearAuthorIntentDraft(first, a.raw!, store)).toEqual({
    cleared: true,
  });
  expect(readAuthorIntentDraft(first, store)).toEqual({ raw: null });
  expect(readAuthorIntentDraft(other, store).raw).toBe(b.raw!);
  expect(values.get("ordinary-user-preference")).toBe("keep");
});
test("未知版本、跨项目和无效草稿不自动删除，错误信息不泄漏输入", () => {
  const { values, store } = memory();
  const saved = saveAuthorIntentDraft(
    first,
    emptyAuthorIntentEdit(1),
    null,
    store,
  );
  const key = [...values.keys()][0]!;
  for (const raw of [
    "PRIVATE corrupt JSON",
    JSON.stringify({ ...JSON.parse(saved.raw!), schemaVersion: 2 }),
    JSON.stringify({ ...JSON.parse(saved.raw!), projectId: other }),
    JSON.stringify({ ...JSON.parse(saved.raw!), confirmed: true }),
  ]) {
    values.set(key, raw);
    const loaded = readAuthorIntentDraft(first, store);
    expect(loaded.error).toBeDefined();
    expect(loaded.error).not.toContain("PRIVATE");
    expect(values.get(key)).toBe(raw);
    expect(clearAuthorIntentDraft(first, loaded.raw, store)).toEqual({
      cleared: true,
    });
  }
});
test("旧窗口编辑和清空不能覆盖另一个窗口已保存的草稿", () => {
  const { store } = memory();
  const firstRead = readAuthorIntentDraft(first, store);
  const edit = emptyAuthorIntentEdit(1);
  edit.fields.themeStatement = "新窗口";
  const saved = saveAuthorIntentDraft(first, edit, firstRead.raw, store);
  expect(
    saveAuthorIntentDraft(first, emptyAuthorIntentEdit(0), firstRead.raw, store)
      .error,
  ).toContain("其他窗口");
  expect(clearAuthorIntentDraft(first, firstRead.raw, store).cleared).toBe(
    false,
  );
  expect(readAuthorIntentDraft(first, store).raw).toBe(saved.raw!);
});
test("存储或配额失败如实提示，不冒充已持久保存，也不外露异常内容", () => {
  const store = () => {
    throw new Error("PRIVATE credential-like exception");
  };
  expect(readAuthorIntentDraft(first, store).error).not.toContain("PRIVATE");
  expect(
    saveAuthorIntentDraft(first, emptyAuthorIntentEdit(0), null, store).error,
  ).toContain("不能保证重启恢复");
  expect(clearAuthorIntentDraft(first, null, store).cleared).toBe(false);
  const { store: memoryStore } = memory();
  const edit = emptyAuthorIntentEdit(0);
  edit.fields.themeStatement = "a".repeat(40001);
  expect(
    saveAuthorIntentDraft(first, edit, null, memoryStore).error,
  ).toBeDefined();
  expect(readAuthorIntentDraft(first, memoryStore)).toEqual({ raw: null });
});
