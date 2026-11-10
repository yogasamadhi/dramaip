// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { humanCostPatch } from "../src/client/generation-cost.ts";
import {
  GenerationLedgerSection,
  type GenerationLedgerSectionProps,
} from "../src/client/GenerationLedgerSection.tsx";
import { zh } from "../src/client/locale.ts";

afterEach(cleanup);

/** The Chinese copy, interpolated as the locale runtime does. */
const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/gu, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"insights">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "compat/problem", message },
  });

const PROJECT = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const RECORD = "00000000-0000-4000-8000-000000000001";

const record = (extra: Record<string, unknown> = {}) => ({
  id: RECORD,
  projectId: PROJECT,
  kind: "controlled",
  title: "受控观察",
  status: "completed",
  summary: "本地模拟，非账单",
  currency: "CNY",
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
  ...extra,
});

function bench(records: ReturnType<typeof record>[]) {
  const insights = {
    generationList: vi.fn((projectId: string) =>
      ok(records.filter((entry) => entry.projectId === projectId)),
    ),
    generationUpdate: vi.fn(() => ok(records[0])),
    generationCostObservations: vi.fn(() =>
      ok({
        recordId: RECORD,
        projectId: PROJECT,
        billingStatus: "unknown",
        observationCount: 1,
        items: [
          {
            sequence: 1,
            observation: {
              source: "human-declared",
              measurementScope: "unspecified",
              billingStatus: "unknown",
              amount: { status: "reported", value: 0 },
              unit: { status: "unreported" },
              recordedAt: "2026-10-04T00:00:00.000Z",
            },
          },
        ],
      }),
    ),
  };
  const workspace = {
    projectsList: vi.fn(() =>
      ok([
        { id: PROJECT, title: "原项目" },
        { id: OTHER, title: "另一个项目" },
      ]),
    ),
  };
  const props = {
    insights,
    workspace,
    t,
    close: () => undefined,
  } as unknown as GenerationLedgerSectionProps;
  render(<GenerationLedgerSection {...props} />);
  return { insights };
}

const choose = async (projectId: string) => {
  await screen.findByRole("option", { name: "原项目" });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: projectId },
  });
};

describe("generation ledger settings section", () => {
  it("keeps every observation unverified and separate, never a total", async () => {
    for (const source of [
      "configured-unit-estimate",
      "human-declared",
      "legacy-unverified",
    ] as const) {
      bench([
        record({
          costObservation: {
            source,
            measurementScope:
              source === "configured-unit-estimate"
                ? "configured-unit"
                : "unspecified",
            billingStatus: "unknown",
            amount: { status: "reported", value: 0.001 },
            unit: { status: "unreported" },
            recordedAt: "2026-10-04T00:00:00.000Z",
          },
          costObservationCount: 2,
        }),
      ]);
      await choose(PROJECT);
      const entry = await screen.findByRole("article");
      expect(entry.textContent).toContain("0.001 · 单位未知 · 结算状态未知");
      expect(entry.textContent).toContain("不合计");
      expect(entry.textContent).not.toContain("实际成本");
      cleanup();
    }
  });

  it("reads a legacy amount as unverified with an unknown unit", async () => {
    bench([record({ actualCost: 0.001 })]);
    await choose(PROJECT);
    expect((await screen.findByRole("article")).textContent).toContain(
      "旧记录未认证 · 0.001 · 单位未知 · 结算状态未知",
    );
  });

  it("shows no record of another project after the choice changes", async () => {
    const { insights } = bench([record()]);
    await choose(PROJECT);
    await screen.findByRole("article");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: OTHER },
    });
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
    expect(await screen.findByText(zh["ledger.empty"])).toBeTruthy();
    expect(insights.generationList).toHaveBeenLastCalledWith(OTHER);
  });

  it("declares an explicit zero and reads the observations read-only", async () => {
    const { insights } = bench([record()]);
    await choose(PROJECT);
    fireEvent.click(
      await screen.findByRole("button", { name: "补录费用声明" }),
    );
    fireEvent.change(screen.getByLabelText("声明金额"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存未认证声明" }));
    await screen.findByText("已保存手工声明；尚未认证结算凭证。");
    expect(insights.generationUpdate).toHaveBeenCalledWith(
      RECORD,
      { actualCost: 0, costNote: "" },
      undefined,
      expect.any(String),
    );
    fireEvent.click(screen.getByRole("button", { name: "只读费用观察" }));
    expect(
      await screen.findByText(
        "观察 1 · 手工声明（未认证） · 0 · 单位未知 · 结算状态未知 · 本地记录时间 2026-10-04T00:00:00.000Z",
      ),
    ).toBeTruthy();
  });

  it("shows no cached figures when an observation read fails", async () => {
    const { insights } = bench([record()]);
    insights.generationCostObservations.mockImplementation(
      () => failed("受控只读失败") as never,
    );
    await choose(PROJECT);
    fireEvent.click(
      await screen.findByRole("button", { name: "只读费用观察" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "未继续展示缓存费用",
    );
    expect(screen.queryByText(/^观察 1 ·/u)).toBeNull();
  });
});

describe("manual cost declaration", () => {
  it("keeps an explicit zero and decimals but refuses coercion and underflow", () => {
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
      expect(humanCostPatch(amount, "", "")).toEqual({
        refused: "ledger.declare.amountInvalid",
      });
    expect(humanCostPatch("0", "1234567890123", "")).toEqual({
      refused: "ledger.declare.tooLong",
    });
  });
});
