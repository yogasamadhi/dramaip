import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProductionRecordBaselineObservationsSchema,
  type ProductionRecordBaselineObservations,
} from "@dramaip/contracts/production";
import { ProductionRecordBaselines } from "./ProductionRecordBaselines";

const id = "91000000-0000-4000-8000-000000000004";
const value: ProductionRecordBaselineObservations = {
  format: "production-record-baseline-observations-v1",
  records: [
    {
      id,
      stableId: "shot-1",
      kind: "shots",
      frozenVersion: 0,
      frozen: {
        contentHash: "a".repeat(64),
        parentId: id,
        orderIndex: 0,
        capturedResult: { id, version: 1 },
      },
      current: {
        contentHash: "a".repeat(64),
        parentId: id,
        orderIndex: 0,
        version: 0,
      },
      state: "unchanged",
      changes: [],
    },
  ],
};
test("actual baseline view distinguishes absent protocol and unrecorded author history from complete observation", () => {
  expect(renderToStaticMarkup(<ProductionRecordBaselines />)).toContain(
    "未提供实际字段基准明细",
  );
  const unrecorded = renderToStaticMarkup(
    <ProductionRecordBaselines
      value={{
        ...value,
        records: [{ ...value.records[0]!, frozen: null, state: "unrecorded" }],
      }}
    />,
  );
  expect(unrecorded).toContain("历史未记录实际字段基准");
  expect(unrecorded).not.toContain("原实际字段指纹：");
  const html = renderToStaticMarkup(
    <ProductionRecordBaselines value={value} />,
  );
  expect(html).toContain("1 个字段基准一致");
  expect(html).toContain("基准保存于正式结果");
  expect(html).toContain("不执行冲突合并");
  expect(html).toContain("指纹一致不是语义安全");
});
test("actual baseline view labels changed, corrupt and missing distinctly and reveals only schema metadata", () => {
  for (const [state, label] of [
    ["baseline-invalid", "原基准身份"],
    ["record-missing", "记录缺失"],
    ["record-invalid", "当前实际记录身份"],
  ] as const) {
    const item = {
      ...value.records[0]!,
      state,
      current: null,
      ...(state === "baseline-invalid" ? { frozen: null } : {}),
    };
    expect(
      renderToStaticMarkup(
        <ProductionRecordBaselines value={{ ...value, records: [item] }} />,
      ),
    ).toContain(label);
  }
  const changed = {
    ...value.records[0]!,
    state: "changed" as const,
    current: { ...value.records[0]!.current!, contentHash: "b".repeat(64) },
    changes: [
      {
        field: "payload" as const,
        beforeHash: "c".repeat(64),
        afterHash: "d".repeat(64),
      },
    ],
  };
  expect(
    ProductionRecordBaselineObservationsSchema.safeParse({
      ...value,
      records: [changed],
    }).success,
  ).toBe(true);
  const html = renderToStaticMarkup(
    <ProductionRecordBaselines value={{ ...value, records: [changed] }} />,
  );
  expect(html).toContain("完整保存字段变化");
  expect(html).not.toContain("payload");
  expect(html).not.toContain("<button");
});
test("strict baseline contract rejects forged unchanged, duplicate IDs and leaked raw fields", () => {
  for (const item of [
    {
      ...value.records[0]!,
      current: { ...value.records[0]!.current!, contentHash: "b".repeat(64) },
    },
    { ...value.records[0]!, payload: { private: "正文" } },
    {
      ...value.records[0]!,
      state: "unrecorded",
      frozen: value.records[0]!.frozen,
    },
  ])
    expect(
      ProductionRecordBaselineObservationsSchema.safeParse({
        ...value,
        records: [item],
      }).success,
    ).toBe(false);
  expect(
    ProductionRecordBaselineObservationsSchema.safeParse({
      ...value,
      records: [value.records[0], value.records[0]],
    }).success,
  ).toBe(false);
});
