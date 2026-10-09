import { describe, expect, it } from "vitest";
import {
  captureProductionRecordBaseline,
  inspectProductionRecordBaselines,
  type BaselineRecordRow,
} from "./record-baselines.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const parentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const result = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", version: 1 };
const binding = { id, kind: "shots" as const, stableId: "shot-1", version: 0 };
const row: BaselineRecordRow = {
  id,
  kind: "shots",
  project_id: projectId,
  version: 0,
  parent_id: parentId,
  title: "作者记录",
  order_index: 0,
  payload_json: JSON.stringify({
    stableId: "shot-1",
    镜头描述: "原实际内容，不是模型重建",
    私有备注: { nested: ["保留", 0, false, null] },
  }),
};
const capture = (actual = row) =>
  captureProductionRecordBaseline({ row: actual, binding, projectId, result });
const inspect = (baselines: unknown, rows = [row]) =>
  inspectProductionRecordBaselines({
    projectId,
    bindings: [binding],
    baselines,
    rows,
  }).records[0]!;

describe("immutable actual production-record baselines", () => {
  it("captures the complete actual row without mutating inputs or exposing prose in observations", () => {
    const baseline = capture();
    expect(baseline.fields.payload).toEqual(JSON.parse(row.payload_json));
    expect(baseline.capturedResult).toEqual(result);
    expect(inspect([baseline]).state).toBe("unchanged");
    expect(JSON.stringify(inspect([baseline]))).not.toContain("原实际内容");
    expect(JSON.stringify(inspect([baseline]))).not.toContain("私有备注");
    baseline.fields.payload["镜头描述"] = "改变副本";
    expect(row.payload_json).toContain("原实际内容");
    expect(inspect([baseline]).state).toBe("baseline-invalid");
  });
  it("ignores JSON object key order but preserves arrays, false, zero, null and missing fields", () => {
    const baseline = capture();
    const reordered = {
      ...row,
      payload_json:
        '{"私有备注":{"nested":["保留",0,false,null]},"镜头描述":"原实际内容，不是模型重建","stableId":"shot-1"}',
    };
    expect(inspect([baseline], [reordered]).state).toBe("unchanged");
    for (const nested of [
      ["保留", false, 0, null],
      ["保留", 0, false],
      ["保留", 0, false, ""],
    ]) {
      const changed = {
        ...row,
        payload_json: JSON.stringify({
          ...JSON.parse(row.payload_json),
          私有备注: { nested },
        }),
      };
      expect(
        inspect([baseline], [changed]).changes.map((item) => item.field),
      ).toEqual(["payload"]);
    }
  });
  it("compares every actual field and versions without guessing a conflict choice", () => {
    const report = inspect(
      [capture()],
      [
        {
          ...row,
          title: "新标题",
          parent_id: result.id,
          order_index: 1,
          version: 1,
          payload_json: JSON.stringify({ stableId: binding.stableId, 时长: 0 }),
        },
      ],
    );
    expect(report.state).toBe("changed");
    expect(report.changes.map((item) => item.field)).toEqual([
      "title",
      "parentId",
      "orderIndex",
      "payload",
    ]);
    expect(inspect([capture()], [{ ...row, version: 1 }]).changes).toEqual([]);
    expect(inspect([capture()], [{ ...row, version: 1 }]).state).toBe(
      "changed",
    );
  });
  it("keeps unrecorded history, corrupt baselines and missing/invalid actual rows distinct", () => {
    expect(inspect(undefined).state).toBe("unrecorded");
    expect(inspect([]).state).toBe("unrecorded");
    expect(inspect({}).state).toBe("baseline-invalid");
    expect(inspect([capture(), capture()]).state).toBe("baseline-invalid");
    expect(inspect([{ ...capture(), version: 1 }]).state).toBe(
      "baseline-invalid",
    );
    expect(inspect([capture()], []).state).toBe("record-missing");
    expect(inspect([capture()], [{ ...row, payload_json: "{" }]).state).toBe(
      "record-invalid",
    );
    expect(
      inspect([capture()], [{ ...row, project_id: result.id }]).state,
    ).toBe("record-invalid");
    expect(inspect([capture()], [row, row]).state).toBe("record-invalid");
  });
  it("refuses wrong bindings, foreign extras, incomplete/unserializable rows and overly deep JSON", () => {
    expect(() => capture({ ...row, version: 1 })).toThrow();
    expect(() =>
      capture({ ...row, payload_json: '{"stableId":"different"}' }),
    ).toThrow();
    expect(() =>
      capture({ ...row, payload_json: '{"stableId":"shot-1","number":1e999}' }),
    ).toThrow();
    expect(inspect([{ ...capture(), id: result.id }]).state).toBe(
      "baseline-invalid",
    );
    let deep: unknown = "值";
    for (let i = 0; i < 101; i++) deep = { deep };
    expect(() =>
      capture({
        ...row,
        payload_json: JSON.stringify({ stableId: binding.stableId, deep }),
      }),
    ).toThrow();
    const special = {
      ...row,
      payload_json:
        '{"stableId":"shot-1","__proto__":{"secret":"不能丢失"},"constructor":0,"prototype":false}',
    };
    // If validation cannot retain dangerous own keys safely, reject rather
    // than hash a normalized record and claim complete original fields.
    try {
      const saved = capture(special);
      expect(Object.keys(saved.fields.payload).sort()).toEqual(
        ["__proto__", "constructor", "prototype", "stableId"].sort(),
      );
    } catch (error) {
      expect(String(error)).toContain("无法完整保留");
    }
  });
});
