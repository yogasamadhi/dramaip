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
import { SeasonPlanEntry } from "../src/client/season/SeasonPlanTool.tsx";
import { seasonDraftKey } from "../src/client/season/season.ts";
import type { ToolProps } from "../src/client/strategy/AdaptationStrategyTool.tsx";
import { zh } from "../src/client/locale.ts";

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"production">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const never = () => new Promise<never>(() => {});
const PROJECT = "11111111-1111-4111-8111-111111111111";
const DIAGNOSIS = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const WORKFLOW = "44444444-4444-4444-8444-444444444444";
const CHAPTER = "55555555-5555-4555-8555-555555555555";
const diagnosis = { id: DIAGNOSIS, version: 2, strategyId: "one" };
const basis = {
  scope: "selected-chapters",
  chapters: [{ id: CHAPTER, version: 1, title: "第一章" }],
  omittedChapters: [],
  target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
  diagnosis,
  authorIntent: { id: DIAGNOSIS, version: 1 },
};
const episode = (id: string, title: string) => ({
  id,
  title,
  logline: `${title}梗概`,
  goal: "目标",
  mainConflict: "冲突",
  turningPoint: "转折",
  endingHook: "钩子",
  characterProgress: [],
  plantedForeshadowing: [],
  paidOffForeshadowing: [],
  estimatedScenes: 3,
  estimatedCharacters: 2,
  productionRisk: "low",
  productionNotes: "",
  sourceChapters: [],
});

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN,
    projectId: PROJECT,
    workflowId: WORKFLOW,
    version: 1,
    stateVersion: 5,
    status: "pending",
    origin: "model",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    sourceSnapshotId: "snapshot",
    basis,
    coverage: [
      {
        chapterId: CHAPTER,
        chapterVersion: 1,
        episodeIds: ["e1"],
        disposition: "used",
      },
    ],
    content: {
      theme: "原谅",
      mainConflict: "主冲突",
      emotionalPromise: "温暖",
      risks: [],
      episodes: [episode("e1", "第一集"), episode("e2", "第二集")],
    },
    ...overrides,
  };
}

const workflow = {
  id: WORKFLOW,
  input: {
    projectId: PROJECT,
    operation: "season-plan",
    seasonPlanRequest: { diagnosis },
  },
  sourceSnapshotId: "snapshot",
  seasonPlanBasis: basis,
  seasonPlanId: PLAN,
};

function setup(
  search = "",
  overrides: {
    production?: Record<string, unknown>;
    automation?: Record<string, unknown>;
  } = {},
) {
  const production = {
    seasonPlansSources: vi.fn(() => ok({ projectId: PROJECT, diagnosis })),
    seasonPlansList: vi.fn(() => ok({ items: [] })),
    seasonPlansGet: vi.fn(() => ok(plan())),
    seasonPlansAdopt: vi.fn(() => ok(plan({ status: "adopted" }))),
    seasonPlansDiscard: vi.fn(() => ok(plan({ status: "discarded" }))),
    seasonPlansReorder: vi.fn(() =>
      ok(plan({ id: "reordered", origin: "human-reorder" })),
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
    writing: {},
    system,
  } as unknown as ToolProps;
  render(<SeasonPlanEntry {...props} />);
  return { production, navigate, renderFactorySlot };
}

const workbench = (renderFactorySlot: ReturnType<typeof vi.fn>) =>
  renderFactorySlot.mock.calls
    .filter(([name]) => name === "automation.creation-workbench")
    .at(-1)?.[1] as Record<string, unknown> | undefined;

const exact = `workflowId=${WORKFLOW}&seasonPlanId=${PLAN}`;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the season plan tool", () => {
  it("confirms the adopted diagnosis as the frozen basis", async () => {
    const { renderFactorySlot, navigate } = setup();
    const confirm = await screen.findByRole("button", {
      name: zh["season.basis.confirm"],
    });
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(workbench(renderFactorySlot)?.["seasonPlanRequest"]).toEqual({
        diagnosis,
      }),
    );
    expect(
      JSON.parse(window.localStorage.getItem(seasonDraftKey(PROJECT))!),
    ).toEqual({ diagnosis });
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}/tools/season-plan`,
    );
  });

  it("opens a history version by its exact run", async () => {
    const { navigate } = setup("", {
      production: { seasonPlansList: vi.fn(() => ok({ items: [plan()] })) },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("season.history.item", {
          version: 1,
          origin: zh["season.origin.model"],
          status: zh["season.status.pending"],
        }),
      }),
    );
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}/tools/season-plan?seasonPlanId=${PLAN}&workflowId=${WORKFLOW}`,
    );
  });

  it("saves a reorder as a new draft and blocks adopting the unsaved order", async () => {
    const { production, navigate } = setup(exact, {
      automation: { creationGet: vi.fn(() => ok(workflow)) },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("season.episode.up.label", { id: "e2" }),
      }),
    );
    expect(screen.getByText(zh["season.reorder.unsaved"])).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: zh["season.adopt"] })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: zh["season.reorder"] }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(zh["season.reorder.title"])).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["season.reorder.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.seasonPlansReorder).toHaveBeenCalledWith(
        PLAN,
        { episodeIds: ["e2", "e1"], confirmed: true },
        '"5"',
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/projects/${PROJECT}/tools/season-plan?workflowId=${WORKFLOW}&seasonPlanId=reordered`,
      ),
    );
  });

  it("adopts the exact plan behind a dialog", async () => {
    const { production } = setup(exact, {
      automation: { creationGet: vi.fn(() => ok(workflow)) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: zh["season.adopt"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: zh["season.adopt.accept"] }),
    );
    await waitFor(() =>
      expect(production.seasonPlansAdopt).toHaveBeenCalledWith(
        PLAN,
        { confirmed: true },
        '"5"',
        expect.any(String),
      ),
    );
  });

  it("hides a plan whose lineage does not reach its run's model plan", async () => {
    const { renderFactorySlot } = setup(exact, {
      automation: {
        creationGet: vi.fn(() => ok({ ...workflow, sourceSnapshotId: "new" })),
      },
    });
    expect(await screen.findByText(zh["season.lineage.model"])).toBeTruthy();
    expect(screen.getByText(zh["season.navigation"])).toBeTruthy();
    expect(screen.queryByText(zh["season.reorder"])).toBeNull();
    expect(workbench(renderFactorySlot)).toBeUndefined();
  });

  it("shows coverage from the owner and the next step once adopted", async () => {
    setup("", {
      production: {
        seasonPlansList: vi.fn(() =>
          ok({ items: [plan({ status: "adopted", isCurrent: true })] }),
        ),
        seasonPlansGet: vi.fn(() =>
          ok(plan({ status: "adopted", isCurrent: true })),
        ),
      },
    });
    const coverage = await screen.findByLabelText(zh["season.sources.label"]);
    expect(coverage.textContent).toContain(
      t("season.sources.item", {
        title: "第一章",
        version: 1,
        disposition: "第一集",
      }),
    );
    expect(screen.getByText(zh["season.next"]).getAttribute("href")).toBe(
      `#/projects/${PROJECT}/tools/episode-development`,
    );
  });
});
