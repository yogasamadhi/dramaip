import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeDeliveryCoverageSchema,
  measureCreativeDeliveryCoverage,
} from "@dramaip/contracts/insights";
import { creativeDeliveryLedgerFixture } from "../../../tests/fixtures/creative-delivery-ledger";
import { CreativeDeliveryCoverageView } from "./features/insights/CreativeDeliveryCoverage";
const dataset = () => creativeDeliveryLedgerFixture(crypto.randomUUID());

test("adopted-version delivery coverage links exact earlier owner versions, not independent counts or duplicate formats", () => {
  const f = dataset(),
    value = measureCreativeDeliveryCoverage(f.projectId, f),
    [novel, adaptation] = value.groups;
  expect(novel).toMatchObject({
    adoptedVersions: 3,
    deliveredVersions: 2,
    notSavedVersions: 1,
    ratio: { numerator: 2, denominator: 3 },
  });
  expect(novel!.savedVersionsWithoutEarlierAdoption).toHaveLength(1);
  expect(
    novel!.items
      .filter((r) => r.firstSaved)
      .every((r) => r.savedUnits === 1 && r.firstSaved!.cursor === 3),
  ).toBe(true);
  expect(
    novel!.items.find((r) => r.formalVersion.version === 2)?.firstSaved,
  ).toBeNull();
  expect(adaptation).toMatchObject({
    adoptedVersions: 1,
    deliveredVersions: 1,
    ratio: { numerator: 1, denominator: 1 },
  });
  expect(adaptation!.items[0]!.savedUnits).toBe(1);
  expect(value.qualityState).toBe("unverified");
  expect(value.modelEvidence).toBe("unknown");
  expect(JSON.stringify(value)).not.toMatch(
    /prompt|content|provider|path|price|fileName|title/u,
  );
});
test("delivery does not backfill a save before adoption or infer adoption from its existence; empty history is not zero coverage", () => {
  const f = dataset(),
    first = f.records.find((r) => r.cursor === 1)!,
    saved = f.records.find((r) => r.cursor === 3)!;
  first.cursor = 40;
  f.records.sort((a, b) => b.cursor - a.cursor);
  const value = measureCreativeDeliveryCoverage(f.projectId, f);
  // A later duplicate save at cursor 4 is also earlier than this first adoption.
  expect(value.groups[0]!.deliveredVersions).toBe(1);
  expect(value.groups[0]!.savedVersionsWithoutEarlierAdoption).toHaveLength(2);
  expect(saved.formalVersions).toHaveLength(2);
  const empty = dataset();
  empty.records.length = 0;
  empty.counts.forEach((c) => (c.total = 0));
  const zero = measureCreativeDeliveryCoverage(empty.projectId, empty);
  expect(
    zero.groups.every((g) => g.ratio === null && g.items.length === 0),
  ).toBe(true);
});
test("delivery requires complete ordered project pages and exact unique unit denominators, never truncated or changing history", () => {
  for (const mutate of [
    (f: ReturnType<typeof dataset>) => {
      f.pages[0]!.projectId = crypto.randomUUID();
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[0]!.projectId = crypto.randomUUID();
    },
    (f: ReturnType<typeof dataset>) => {
      f.records.reverse();
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[1]!.eventId = f.records[0]!.eventId;
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[1]!.cursor = f.records[0]!.cursor;
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[0]!.cursor = 51;
    },
    (f: ReturnType<typeof dataset>) => {
      f.pages[0] = { ...f.pages[0]!, nextCursor: 1 } as (typeof f.pages)[0];
    },
    (f: ReturnType<typeof dataset>) => {
      f.records.pop();
    },
    (f: ReturnType<typeof dataset>) => {
      f.counts[0]!.total++;
    },
    (f: ReturnType<typeof dataset>) => {
      f.counts.pop();
    },
    (f: ReturnType<typeof dataset>) => {
      f.counts[1]!.kind = f.counts[0]!.kind;
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[0]!.unitKey = f.records.find(
        (r) => r.kind === "novel.chapter-adopted",
      )!.unitKey;
    },
    (f: ReturnType<typeof dataset>) => {
      f.records[0]!.unitKey = "f".repeat(64);
    },
  ]) {
    const f = dataset();
    mutate(f);
    expect(() => measureCreativeDeliveryCoverage(f.projectId, f)).toThrow();
  }
  const f = dataset();
  expect(() =>
    measureCreativeDeliveryCoverage(f.projectId, {
      ...f,
      projection: { ...f.projection, state: "catching-up" },
    }),
  ).toThrow();
  const pages = [
    { projectId: f.projectId, items: f.records.slice(0, 3), nextCursor: 7 },
    { projectId: f.projectId, items: f.records.slice(3) },
  ];
  expect(measureCreativeDeliveryCoverage(f.projectId, { ...f, pages })).toEqual(
    measureCreativeDeliveryCoverage(f.projectId, f),
  );
  expect(() =>
    measureCreativeDeliveryCoverage(f.projectId, {
      ...f,
      pages: [{ ...pages[0]!, nextCursor: 6 }, pages[1]!],
    }),
  ).toThrow();
});
test("delivery output contract rejects false arithmetic, quality upgrades and replaced/missing first-save identities", () => {
  const f = dataset(),
    original = measureCreativeDeliveryCoverage(f.projectId, f);
  for (const mutate of [
    (v: typeof original) => {
      v.groups[0]!.deliveredVersions++;
    },
    (v: typeof original) => {
      v.groups[0]!.ratio!.numerator++;
    },
    (v: typeof original) => {
      v.groups[0]!.items.push(v.groups[0]!.items[0]!);
    },
    (v: typeof original) => {
      const r = v.groups[1]!.items[0]!;
      r.firstSaved!.cursor = r.adoption.cursor;
    },
    (v: typeof original) => {
      v.groups[1]!.items[0]!.savedUnits = 0;
    },
    (v: typeof original) => {
      Object.assign(v, { qualityState: "passed" });
    },
    (v: typeof original) => {
      Object.assign(v.groups[0], { content: "PRIVATE" });
    },
  ]) {
    const v = structuredClone(original);
    mutate(v);
    expect(CreativeDeliveryCoverageSchema.safeParse(v).success).toBe(false);
  }
});
test("delivery view keeps novel/adaptation units, unknown history and exact version scope separate from quality", () => {
  const f = dataset(),
    markup = renderToStaticMarkup(
      <CreativeDeliveryCoverageView
        value={measureCreativeDeliveryCoverage(f.projectId, f)}
      />,
    );
  expect(markup).toContain("小说章节版本 → 已保存稿件");
  expect(markup).toContain("改编剧本版本 → 已保存内部试制包");
  expect(markup).toContain("2/3");
  expect(markup).toContain("1/1");
  expect(markup).toContain("缺此前采用");
  expect(markup).toContain("重复保存、换格式不增加");
  expect(markup).toContain("不是当前有效性");
});
