import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GenerationRecordSchema,
  GenerationCostObservationSchema,
  GenerationCostObservationPageSchema,
} from "@dramaip/contracts/insights";
import {
  configuredEstimateLabel,
  generationCostLabel,
  humanCostPatch,
} from "./generation-cost";
import { GenerationLedgerEntry } from "./features/settings/GenerationLedgerEntry";
import { createGenerationCostsClient } from "../../client/src/generation-costs";

const record = () =>
  GenerationRecordSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    kind: "controlled",
    title: "受控观察",
    status: "completed",
    summary: "本地模拟，非账单",
    currency: "CNY",
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
  });
describe("unverified generation cost boundaries", () => {
  test("history SDK binds the original record, project, pagination and read-only request", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const observation = GenerationCostObservationSchema.parse({
      source: "human-declared",
      measurementScope: "unspecified",
      billingStatus: "unknown",
      amount: { status: "reported", value: 0 },
      unit: { status: "unreported" },
      recordedAt: record().createdAt,
    });
    const page = GenerationCostObservationPageSchema.parse({
      recordId: record().id,
      projectId: record().projectId,
      billingStatus: "unknown",
      observationCount: 2,
      items: [{ sequence: 2, observation }],
      nextCursor: 2,
    });
    let value: unknown = page;
    const sdk = createGenerationCostsClient(
      async <T,>(path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return value as T;
      },
    );
    const controller = new AbortController();
    expect(
      await sdk.list(
        record().id,
        record().projectId,
        undefined,
        1,
        controller.signal,
      ),
    ).toEqual(page);
    expect(calls).toEqual([
      {
        path: `/api/v2/generation-ledger/${record().id}/cost-observations?projectId=${record().projectId}&limit=1`,
        init: { signal: controller.signal },
      },
    ]);
    for (const changed of [
      { ...page, recordId: record().projectId },
      { ...page, projectId: record().id },
      { ...page, items: [{ sequence: 3, observation }] },
      { ...page, nextCursor: 1 },
      { ...page, billingStatus: "settled" },
      {
        ...page,
        items: [
          {
            sequence: 2,
            observation: { ...observation, privateBill: "do not return" },
          },
        ],
      },
    ]) {
      value = changed;
      await expect(
        sdk.list(record().id, record().projectId, undefined, 1),
      ).rejects.toThrow();
    }
    value = {
      ...page,
      items: [{ sequence: 1, observation }],
      nextCursor: undefined,
    };
    expect(
      (await sdk.list(record().id, record().projectId, 2, 1)).items[0]!
        .sequence,
    ).toBe(1);
    value = page;
    await expect(
      sdk.list(record().id, record().projectId, 2, 1),
    ).rejects.toThrow();
    const count = calls.length;
    await expect(sdk.list(record().id, "")).rejects.toThrow();
    await expect(
      sdk.list(record().id, record().projectId, 0),
    ).rejects.toThrow();
    await expect(
      sdk.list(record().id, record().projectId, undefined, 101),
    ).rejects.toThrow();
    expect(calls).toHaveLength(count);
  });
  test("legacy and missing values never inherit a currency, create zero or claim settlement", () => {
    expect(generationCostLabel(record())).toContain(
      "金额未知 · 单位未知 · 结算状态未知",
    );
    expect(generationCostLabel({ ...record(), actualCost: 0.001 })).toContain(
      "旧记录未认证 · 0.001 · 单位未知",
    );
    expect(configuredEstimateLabel(undefined, undefined)).toBe(
      "配置单次估价 金额未知 · 单位未知（非结算）",
    );
    expect(configuredEstimateLabel(0, " USD ")).toBe(
      "配置单次估价 0 · USD（非结算）",
    );
  });
  test("quotes, explicit zero and invalid/unreported observations remain separate", () => {
    for (const source of [
      "configured-unit-estimate",
      "human-declared",
      "legacy-unverified",
    ] as const) {
      const parsed = GenerationRecordSchema.parse({
        ...record(),
        costObservation: {
          source,
          measurementScope:
            source === "configured-unit-estimate"
              ? "configured-unit"
              : "unspecified",
          billingStatus: "unknown",
          amount: { status: "reported", value: 0.001 },
          unit: { status: "unreported" },
          recordedAt: record().createdAt,
        },
        costObservationCount: 2,
      });
      const html = renderToStaticMarkup(
        <GenerationLedgerEntry record={parsed} save={async () => undefined} />,
      );
      expect(html).toContain("0.001");
      expect(html).toContain("单位未知");
      expect(html).toContain("结算状态未知");
      expect(html).toContain("不合计");
      expect(html).not.toContain("实际成本");
      expect(html).not.toContain("· 0.00 ·");
    }
    expect(() =>
      GenerationRecordSchema.parse({
        ...record(),
        costObservation: { source: "human-declared", billingStatus: "settled" },
      }),
    ).toThrow();
  });
  test("manual patch preserves explicit zero and decimals but refuses coercion and underflow", () => {
    expect(humanCostPatch("", "", "note")).toEqual({ costNote: "note" });
    expect(humanCostPatch("0", "", "")).toEqual({
      actualCost: 0,
      costNote: "",
    });
    expect(humanCostPatch("0.001", " USD ", "")).toEqual({
      actualCost: 0.001,
      currency: "USD",
      costNote: "",
    });
    for (const amount of [
      "false",
      "null",
      "[]",
      "0x10",
      "-1",
      "Infinity",
      "NaN",
      "1e-1000",
    ])
      expect(() => humanCostPatch(amount, "", "")).toThrow();
    expect(() => humanCostPatch("0", "1234567890123", "")).toThrow();
  });
});
