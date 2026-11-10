// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdaptationStrategyEntry,
  type ToolProps,
} from "../src/client/strategy/AdaptationStrategyTool.tsx";
import { confirmationKey } from "../src/client/strategy/strategy.ts";
import { zh } from "../src/client/locale.ts";

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"production">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const fail = (message: string) =>
  Promise.resolve({ ok: false as const, error: { message } });
const never = () => new Promise<never>(() => {});
const PROJECT = "11111111-1111-4111-8111-111111111111";
const DIAGNOSIS = "22222222-2222-4222-8222-222222222222";
const STRATEGY = "33333333-3333-4333-8333-333333333333";
const WORKFLOW = "44444444-4444-4444-8444-444444444444";
const diagnosis = { id: DIAGNOSIS, version: 2 };

function strategy(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY,
    projectId: PROJECT,
    workflowId: WORKFLOW,
    version: 1,
    stateVersion: 4,
    status: "pending",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    engineKind: "model",
    selectedOptionId: null,
    basis: { diagnosis, chapters: [], omittedChapters: [] },
    content: {
      summary: "改编总述",
      options: [
        {
          id: "suspense",
          title: "独立悬念重排",
          rationale: "理由",
          preserve: ["主线"],
          merge: [],
          remove: [],
          reorder: [],
          restructure: [],
          rhythm: "快",
          findingIds: [],
          risks: [],
          productionRisk: "low",
          productionNotes: "",
        },
      ],
    },
    ...overrides,
  };
}

const workflow = {
  id: WORKFLOW,
  stage: "review",
  input: {
    projectId: PROJECT,
    operation: "adaptation-strategy",
    adaptationStrategyRequest: { diagnosis },
  },
  adaptationStrategyId: STRATEGY,
};

function setup(
  search = "",
  overrides: {
    production?: Record<string, unknown>;
    automation?: Record<string, unknown>;
  } = {},
) {
  const production = {
    adaptationStrategiesSources: vi.fn(() =>
      ok({ projectId: PROJECT, diagnosis }),
    ),
    adaptationStrategiesList: vi.fn(() => ok({ items: [] })),
    adaptationStrategiesGet: vi.fn(() => ok(strategy())),
    adaptationStrategiesAdopt: vi.fn(() =>
      ok(strategy({ status: "adopted", isCurrent: true })),
    ),
    adaptationStrategiesDiscard: vi.fn(() =>
      ok(strategy({ status: "discarded" })),
    ),
    ...overrides.production,
  };
  const automation = { creationGet: vi.fn(never), ...overrides.automation };
  const system = {
    events: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: never }),
      dispose: vi.fn(),
    })),
  };
  const navigate = vi.fn();
  const renderFactorySlot = vi.fn((name: string) => (
    <span data-testid={name} />
  ));
  const props = {
    projectId: PROJECT,
    record: {},
    search,
    reload: vi.fn(),
    navigate,
    t,
    renderFactorySlot,
    production,
    automation,
    system,
  } as unknown as ToolProps;
  render(<AdaptationStrategyEntry {...props} />);
  return { production, automation, navigate, renderFactorySlot };
}

const workbench = (renderFactorySlot: ReturnType<typeof vi.fn>) =>
  renderFactorySlot.mock.calls
    .filter(([name]) => name === "automation.creation-workbench")
    .at(-1)?.[1] as Record<string, unknown> | undefined;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the adaptation strategy tool", () => {
  it("confirms the adopted diagnosis as the frozen request and keeps it", async () => {
    const { renderFactorySlot, navigate } = setup();
    const confirm = await screen.findByRole("button", {
      name: zh["strategy.basis.confirm"],
    });
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
    expect(workbench(renderFactorySlot)?.["startDisabled"]).toBe(true);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        workbench(renderFactorySlot)?.["adaptationStrategyRequest"],
      ).toEqual({ diagnosis }),
    );
    expect(workbench(renderFactorySlot)?.["startDisabled"]).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}/tools/adaptation-strategy`,
    );
    expect(
      JSON.parse(window.localStorage.getItem(confirmationKey(PROJECT))!),
    ).toEqual({
      format: "strategy-source-confirmation-v1",
      projectId: PROJECT,
      request: { diagnosis },
    });
  });

  it("refuses repeated link ids without reading the owner", async () => {
    const { production } = setup(
      `workflowId=${WORKFLOW}&workflowId=${WORKFLOW}`,
    );
    expect(await screen.findByText(zh["strategy.navigation"])).toBeTruthy();
    expect(production.adaptationStrategiesSources).not.toHaveBeenCalled();
    expect(production.adaptationStrategiesGet).not.toHaveBeenCalled();
  });

  it("restores an exact run and adopts the chosen option behind a dialog", async () => {
    const { production } = setup(
      `workflowId=${WORKFLOW}&strategyId=${STRATEGY}`,
      { automation: { creationGet: vi.fn(() => ok(workflow)) } },
    );
    const radio = await screen.findByLabelText(
      t("strategy.option.choose", { title: "独立悬念重排" }),
    );
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole("button", { name: zh["strategy.adopt"] }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(zh["strategy.adopt.title"])).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["strategy.adopt.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.adaptationStrategiesAdopt).toHaveBeenCalledWith(
        STRATEGY,
        { confirmed: true, optionId: "suspense" },
        '"4"',
        expect.any(String),
      ),
    );
  });

  it("does not adopt without a chosen option or when cancelled", async () => {
    const { production } = setup(
      `workflowId=${WORKFLOW}&strategyId=${STRATEGY}`,
      { automation: { creationGet: vi.fn(() => ok(workflow)) } },
    );
    const adopt = await screen.findByRole("button", {
      name: zh["strategy.adopt"],
    });
    expect(adopt.hasAttribute("disabled")).toBe(true);
    fireEvent.click(
      screen.getByLabelText(
        t("strategy.option.choose", { title: "独立悬念重排" }),
      ),
    );
    fireEvent.click(adopt);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText(zh["strategy.cancel"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(production.adaptationStrategiesAdopt).not.toHaveBeenCalled();
  });

  it("does not fall back to the latest strategy when the run differs", async () => {
    const { renderFactorySlot } = setup(
      `workflowId=${WORKFLOW}&strategyId=${STRATEGY}`,
      {
        automation: {
          creationGet: vi.fn(() =>
            ok({ ...workflow, adaptationStrategyId: "other" }),
          ),
        },
      },
    );
    expect(
      await screen.findByText(t("strategy.workflow.missing", { message: "" })),
    ).toBeTruthy();
    expect(workbench(renderFactorySlot)).toBeUndefined();
    expect(screen.queryByText("改编总述")).toBeNull();
  });

  it("hides the candidate and the workbench when the run read fails", async () => {
    const { renderFactorySlot } = setup(
      `workflowId=${WORKFLOW}&strategyId=${STRATEGY}`,
      { automation: { creationGet: vi.fn(() => fail("断网")) } },
    );
    expect(
      await screen.findByText(
        t("strategy.workflow.missing", { message: "断网" }),
      ),
    ).toBeTruthy();
    expect(workbench(renderFactorySlot)).toBeUndefined();
    expect(screen.queryByText("改编总述")).toBeNull();
  });

  it("links a strategy-only link to its original run without switching", async () => {
    setup(`strategyId=${STRATEGY}`);
    const link = await screen.findByText(zh["strategy.open"]);
    expect(link.getAttribute("href")).toBe(
      `#/projects/${PROJECT}/tools/adaptation-strategy?workflowId=${WORKFLOW}&strategyId=${STRATEGY}`,
    );
  });

  it("shows a strategy of another project as a mismatch, not its content", async () => {
    setup(`strategyId=${STRATEGY}`, {
      production: {
        adaptationStrategiesGet: vi.fn(() =>
          ok(strategy({ projectId: "other" })),
        ),
      },
    });
    expect(await screen.findByText(zh["strategy.mismatch"])).toBeTruthy();
    expect(screen.queryByText("改编总述")).toBeNull();
  });

  it("discards behind its own dialog with the read state version", async () => {
    const { production } = setup(`strategyId=${STRATEGY}`);
    fireEvent.click(
      await screen.findByRole("button", { name: zh["strategy.discard"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["strategy.discard.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.adaptationStrategiesDiscard).toHaveBeenCalledWith(
        STRATEGY,
        {},
        '"4"',
        expect.any(String),
      ),
    );
  });
});
