import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeDeliveryWindowSchema,
  measureCreativeDeliveryWindow,
  measureCreativeDeliveryCoverage,
} from "@dramaip/contracts/insights";
import { creativeDeliveryLedgerFixture } from "../../../tests/fixtures/creative-delivery-ledger";
import { CreativeDeliveryWindowView } from "./features/insights/CreativeDeliveryCoverage";
const asOf = "2026-10-07T00:01:00.000Z";
function dataset() {
  const f = creativeDeliveryLedgerFixture(crypto.randomUUID());
  return measureCreativeDeliveryCoverage(f.projectId, f);
}

test("seven-day delivery preserves separate version units, first-save clocks and pending denominator without a weekly conversion rate", () => {
  const coverage = dataset(),
    value = measureCreativeDeliveryWindow(coverage, asOf);
  expect(value.coverage).toEqual(coverage);
  expect(value.groups[0]).toMatchObject({
    adoptedInWindow: 3,
    deliveredInWindow: 2,
    measuredVersions: 2,
    pendingVersions: 1,
    clockInconsistentVersions: 0,
    duration: {
      minimumMs: 1000,
      maximumMs: 2000,
      mean: { numerator: "3000", denominator: 2 },
    },
  });
  expect(value.groups[1]).toMatchObject({
    adoptedInWindow: 1,
    deliveredInWindow: 1,
    measuredVersions: 1,
    duration: { mean: { numerator: "1000", denominator: 1 } },
  });
  expect(value.window).toEqual({
    kind: "rolling-seven-days",
    from: "2026-09-30T00:01:00.000Z",
    to: asOf,
  });
  expect(value.qualityState).toBe("unverified");
  expect(value.modelEvidence).toBe("unknown");
});
test("window includes its exact endpoints; later duplicate save cannot refresh first delivery, and old adoptions remain separate from this-week deliveries", () => {
  const coverage = dataset(),
    first = measureCreativeDeliveryWindow(coverage, "2026-10-14T00:00:03.000Z");
  expect(first.groups[0]).toMatchObject({
    adoptedInWindow: 1,
    deliveredInWindow: 2,
  });
  const beyond = measureCreativeDeliveryWindow(
    coverage,
    "2026-10-14T00:00:03.001Z",
  );
  expect(beyond.groups[0]).toMatchObject({
    adoptedInWindow: 1,
    deliveredInWindow: 0,
  });
  expect(beyond.groups[1]!.deliveredInWindow).toBe(1);
  expect(beyond.groups[0]!.measuredVersions).toBe(2);
  const exactEnd = measureCreativeDeliveryWindow(
    coverage,
    "2026-10-07T00:00:08.000Z",
  );
  expect(exactEnd.groups[1]!.deliveredInWindow).toBe(1);
});
test("future evidence, reversed owner clock and mismatched Host receipt clocks stay unknown, not zero or a later chosen good save", () => {
  const future = measureCreativeDeliveryWindow(
    dataset(),
    "2026-10-07T00:00:02.999Z",
  );
  expect(future.groups[0]).toMatchObject({
    adoptedInWindow: 2,
    deliveredInWindow: 0,
    measuredVersions: 0,
    clockInconsistentVersions: 3,
    duration: null,
  });
  expect(
    future.groups[0]!.items.every(
      (r) => r.adoptionToSavedMs === null && r.deliveredInWindow === null,
    ),
  ).toBe(true);
  for (const [field, time, reason] of [
    ["owner", "2026-10-07T00:00:00.000Z", "owner-clock-reversed"],
    ["host", "2026-10-07T00:00:00.000Z", "receipt-before-adoption"],
    ["host", "2026-10-07T00:00:09.000Z", "receipt-after-owner-event"],
    ["host", "2026-10-07T00:00:03.0001Z", "unsupported-clock-precision"],
  ] as const) {
    const coverage = dataset(),
      r = coverage.groups[0]!.items.find((r) => r.firstSaved)!;
    if (field === "owner") r.firstSaved!.occurredAt = time;
    else r.firstSaved!.receipt.savedAt = time;
    const row = measureCreativeDeliveryWindow(
      coverage,
      asOf,
    ).groups[0]!.items.find((v) => v.adoptionEventId === r.adoption.eventId)!;
    expect(row).toMatchObject({
      clockState: "clock-inconsistent",
      reason,
      adoptionToSavedMs: null,
      deliveredInWindow: null,
    });
  }
});
test("measured zero is not unknown; no adopted history has null duration rather than a fabricated denominator", () => {
  const coverage = dataset(),
    r = coverage.groups[1]!.items[0]!;
  r.firstSaved!.receipt.savedAt = r.adoption.occurredAt;
  expect(
    measureCreativeDeliveryWindow(coverage, asOf).groups[1]!.duration,
  ).toEqual({
    minimumMs: 0,
    maximumMs: 0,
    mean: { numerator: "0", denominator: 1 },
  });
  const empty = creativeDeliveryLedgerFixture(crypto.randomUUID());
  empty.records.length = 0;
  empty.counts.forEach((c) => (c.total = 0));
  expect(
    measureCreativeDeliveryWindow(
      measureCreativeDeliveryCoverage(empty.projectId, empty),
      asOf,
    ).groups.every((g) => g.duration === null && g.items.length === 0),
  ).toBe(true);
});
test("long historical duration sums use exact BigInt, not an unsafe floating-point aggregate", () => {
  const coverage = dataset(),
    base = coverage.groups[0]!.items.find((r) => r.firstSaved)!;
  coverage.groups[0]!.items = Array.from({ length: 31 }, (_, i) => ({
    ...structuredClone(base),
    formalVersion: { ...base.formalVersion, id: crypto.randomUUID() },
    adoption: {
      ...base.adoption,
      eventId: crypto.randomUUID(),
      cursor: i + 1,
      occurredAt: "0001-01-01T00:00:00.000Z",
    },
    firstSaved: {
      ...structuredClone(base.firstSaved!),
      cursor: 32,
      occurredAt: "9998-01-01T00:00:00.000Z",
      receipt: {
        ...base.firstSaved!.receipt,
        savedAt: "9998-01-01T00:00:00.000Z",
      },
    },
  }));
  Object.assign(coverage.groups[0], {
    adoptedVersions: 31,
    deliveredVersions: 31,
    notSavedVersions: 0,
    ratio: { numerator: 31, denominator: 31 },
    savedVersionsWithoutEarlierAdoption: [],
  });
  const measured = measureCreativeDeliveryWindow(
      coverage,
      "9999-01-01T00:00:00.000Z",
    ),
    elapsed =
      Date.parse("9998-01-01T00:00:00.000Z") -
      Date.parse("0001-01-01T00:00:00.000Z");
  expect(measured.groups[0]!.duration!.mean).toEqual({
    numerator: (BigInt(elapsed) * 31n).toString(),
    denominator: 31,
  });
  expect(
    BigInt(measured.groups[0]!.duration!.mean.numerator) >
      BigInt(Number.MAX_SAFE_INTEGER),
  ).toBe(true);
});
test("time output rejects tampered windows, means, counts, private fields and quality upgrades; view states its history scope", () => {
  const original = measureCreativeDeliveryWindow(dataset(), asOf);
  for (const mutate of [
    (v: typeof original) => {
      v.groups[0]!.deliveredInWindow++;
    },
    (v: typeof original) => {
      v.groups[0]!.duration!.mean.numerator = "0";
    },
    (v: typeof original) => {
      v.window.from = asOf;
    },
    (v: typeof original) => {
      v.groups[0]!.items[0]!.adoptionToSavedMs = 0;
    },
    (v: typeof original) => {
      Object.assign(v, { qualityState: "passed" });
    },
    (v: typeof original) => {
      Object.assign(v.groups[0], { body: "PRIVATE" });
    },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    expect(CreativeDeliveryWindowSchema.safeParse(value).success).toBe(false);
  }
  expect(() =>
    measureCreativeDeliveryWindow(dataset(), "2026-10-07T00:01:00.0001Z"),
  ).toThrow();
  const markup = renderToStaticMarkup(
    <CreativeDeliveryWindowView value={original} />,
  );
  expect(markup).toContain("3000/2");
  expect(markup).toContain("不能相除为本周转化率");
  expect(markup).toContain("不是模型生成速度");
  expect(markup).toContain("不补零");
});
