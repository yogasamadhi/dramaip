import { expect, test } from "vitest";
import {
  readVolumeRequest,
  writeVolumeRequest,
  type WritingVolumeRequest,
} from "./writing-volume-request";
const id = () => crypto.randomUUID();
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("明确卷请求持久保存原键和整批版本，重启读取不生成新键或提交", () => {
  const projectId = id(),
    store = memory();
  const request: WritingVolumeRequest = {
    kind: "assign",
    projectId,
    key: id(),
    confirmedAt: new Date().toISOString(),
    input: {
      chapters: [{ chapterId: id(), version: 8, volumeId: null }],
      volumes: [],
    },
  };
  const raw = writeVolumeRequest(projectId, request, null, () => store);
  expect(readVolumeRequest(projectId, () => store)).toEqual({ raw, request });
  expect(() =>
    writeVolumeRequest(projectId, { ...request, key: id() }, null, () => store),
  ).toThrow();
  expect(readVolumeRequest(projectId, () => store).request).toEqual(request);
  writeVolumeRequest(projectId, null, raw, () => store);
  expect(readVolumeRequest(projectId, () => store)).toEqual({ raw: null });
});
test("卷原请求错误项目、损坏存储和不可用存储保持原记录，禁止静默覆盖", () => {
  const projectId = id(),
    store = memory(),
    key = `dramaip-volume-request:v1:${projectId}`;
  const raw = JSON.stringify({
    kind: "create",
    projectId: id(),
    key: id(),
    confirmedAt: new Date().toISOString(),
    input: { title: "PRIVATE 原本地规划" },
  });
  store.setItem(key, raw);
  const restored = readVolumeRequest(projectId, () => store);
  expect(restored.request).toBeUndefined();
  expect(restored.error).toBeDefined();
  expect(restored.error).not.toContain("PRIVATE");
  expect(store.getItem(key)).toBe(raw);
  expect(() =>
    writeVolumeRequest(projectId, null, null, () => store),
  ).toThrow();
  expect(
    readVolumeRequest(projectId, () => {
      throw new Error("PRIVATE storage unavailable");
    }).error,
  ).not.toContain("PRIVATE");
});
