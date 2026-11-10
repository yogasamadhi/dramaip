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
import { AdaptationDiagnosisEntry } from "../src/client/diagnosis/AdaptationDiagnosisTool.tsx";
import { diagnosisDraftKey } from "../src/client/diagnosis/diagnosis.ts";
import type { ToolProps } from "../src/client/strategy/AdaptationStrategyTool.tsx";
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
const CHAPTER = "22222222-2222-4222-8222-222222222222";
const INTENT = "33333333-3333-4333-8333-333333333333";
const DIAGNOSIS = "44444444-4444-4444-8444-444444444444";
const WORKFLOW = "55555555-5555-4555-8555-555555555555";
const HASH = "a".repeat(64);
const target = {
  format: "short-drama",
  episodeCount: 12,
  durationSeconds: 90,
} as const;
const request = {
  scope: "selected-chapters",
  chapters: [{ id: CHAPTER, version: 1 }],
  inventoryFingerprint: HASH,
  authorIntent: { id: INTENT, version: 2 },
  rightsDeclared: true,
  target,
};
const source = {
  id: CHAPTER,
  version: 1,
  title: "第一章",
  orderIndex: 0,
  contentHash: HASH,
  characters: 1200,
};
const basis = {
  scope: "selected-chapters",
  chapters: [source],
  omittedChapters: [],
  rightsDeclared: true,
  target,
};

function diagnosis(overrides: Record<string, unknown> = {}) {
  return {
    id: DIAGNOSIS,
    projectId: PROJECT,
    workflowId: WORKFLOW,
    version: 1,
    stateVersion: 3,
    status: "pending",
    title: "诊断标题",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    authorIntent: { id: INTENT, version: 2 },
    basis,
    content: {
      summary: "诊断总述",
      theme: "原谅",
      emotionalPromise: "温暖",
      mainLine: "主线",
      sellingPoints: ["卖点"],
      characterArcs: ["弧"],
      relationships: ["关系"],
      findings: [
        {
          kind: "hook",
          claim: "开场钩子",
          evidence: [
            {
              chapterId: CHAPTER,
              chapterVersion: 1,
              quote: "原文引句",
            },
          ],
          suggestion: "保留",
        },
      ],
      strategies: [
        {
          id: "faithful",
          title: "忠实人物弧",
          rationale: "理由",
          preserve: [],
          merge: [],
          remove: [],
          reorder: [],
          restructure: [],
          rhythm: "稳",
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
  input: {
    projectId: PROJECT,
    operation: "adaptation-diagnosis",
    diagnosisRequest: request,
  },
  diagnosisId: DIAGNOSIS,
  diagnosisBasis: basis,
};

function setup(
  search = "",
  overrides: {
    production?: Record<string, unknown>;
    automation?: Record<string, unknown>;
  } = {},
) {
  const production = {
    diagnosesSources: vi.fn(() =>
      ok({
        projectId: PROJECT,
        chapters: [source],
        inventoryFingerprint: HASH,
        authorIntent: { id: INTENT, version: 2 },
      }),
    ),
    diagnosesList: vi.fn(() => ok({ items: [] })),
    diagnosesGet: vi.fn(() => ok(diagnosis())),
    diagnosesAdopt: vi.fn(() => ok(diagnosis({ status: "adopted" }))),
    diagnosesDiscard: vi.fn(() => ok(diagnosis({ status: "discarded" }))),
    ...overrides.production,
  };
  const automation = { creationGet: vi.fn(never), ...overrides.automation };
  const writing = { chaptersList: vi.fn(() => ok([])) };
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
    writing,
    system,
  } as unknown as ToolProps;
  render(<AdaptationDiagnosisEntry {...props} />);
  return { production, navigate, renderFactorySlot };
}

const workbench = (renderFactorySlot: ReturnType<typeof vi.fn>) =>
  renderFactorySlot.mock.calls
    .filter(([name]) => name === "automation.creation-workbench")
    .at(-1)?.[1] as Record<string, unknown> | undefined;

const exact = `workflowId=${WORKFLOW}&diagnosisId=${DIAGNOSIS}`;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the adaptation diagnosis tool", () => {
  it("confirms the chosen chapters, rights and target as the frozen request", async () => {
    const { renderFactorySlot, navigate } = setup();
    fireEvent.click(
      await screen.findByLabelText(
        t("diagnosis.source.label", { title: "第一章" }),
      ),
    );
    fireEvent.click(screen.getByLabelText(zh["diagnosis.rights.label"]));
    fireEvent.click(
      screen.getByRole("button", { name: zh["diagnosis.confirm"] }),
    );
    await waitFor(() =>
      expect(workbench(renderFactorySlot)?.["diagnosisRequest"]).toEqual(
        request,
      ),
    );
    expect(
      JSON.parse(window.localStorage.getItem(diagnosisDraftKey(PROJECT))!),
    ).toEqual(request);
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}/tools/adaptation-diagnosis`,
    );
  });

  it("refuses a scope without the rights declaration", async () => {
    const { renderFactorySlot } = setup();
    fireEvent.click(
      await screen.findByLabelText(
        t("diagnosis.source.label", { title: "第一章" }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh["diagnosis.confirm"] }),
    );
    expect(await screen.findByText(zh["diagnosis.error.invalid"])).toBeTruthy();
    expect(workbench(renderFactorySlot)?.["diagnosisRequest"]).toBeUndefined();
  });

  it("restores a saved scope and flags a changed chapter list", async () => {
    window.localStorage.setItem(
      diagnosisDraftKey(PROJECT),
      JSON.stringify({ ...request, inventoryFingerprint: "b".repeat(64) }),
    );
    setup();
    expect(
      await screen.findByText(zh["diagnosis.inventory.changed"]),
    ).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          t("diagnosis.source.label", { title: "第一章" }),
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("adopts the exact candidate behind a dialog without choosing an old strategy", async () => {
    const { production } = setup(exact, {
      automation: { creationGet: vi.fn(() => ok(workflow)) },
    });
    expect(
      await screen.findByLabelText(
        t("diagnosis.candidate.label", { version: 1 }),
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: zh["diagnosis.adopt"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["diagnosis.adopt.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.diagnosesAdopt).toHaveBeenCalledWith(
        DIAGNOSIS,
        { confirmed: true },
        '"3"',
        expect.any(String),
      ),
    );
  });

  it("adopts an old in-diagnosis strategy only when chosen", async () => {
    const { production } = setup(exact, {
      automation: { creationGet: vi.fn(() => ok(workflow)) },
    });
    const legacy = await screen.findByRole("button", {
      name: zh["diagnosis.legacy.adopt"],
    });
    expect(legacy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(
      screen.getByLabelText(
        t("diagnosis.legacy.option", { title: "忠实人物弧" }),
      ),
    );
    fireEvent.click(legacy);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["diagnosis.legacy.adopt.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.diagnosesAdopt).toHaveBeenCalledWith(
        DIAGNOSIS,
        { confirmed: true, strategyId: "faithful" },
        '"3"',
        expect.any(String),
      ),
    );
  });

  it("does not show a candidate whose frozen basis differs from its run", async () => {
    const { renderFactorySlot } = setup(exact, {
      automation: {
        creationGet: vi.fn(() =>
          ok({
            ...workflow,
            diagnosisBasis: {
              ...basis,
              target: { ...target, episodeCount: 6 },
            },
          }),
        ),
      },
    });
    expect(await screen.findByText(zh["diagnosis.navigation"])).toBeTruthy();
    expect(screen.queryByText("诊断总述")).toBeNull();
    expect(workbench(renderFactorySlot)).toBeUndefined();
  });

  it("hides the workbench when the run cannot be read", async () => {
    const { renderFactorySlot } = setup(exact, {
      automation: { creationGet: vi.fn(() => fail("断网")) },
    });
    expect(await screen.findByText(zh["diagnosis.navigation"])).toBeTruthy();
    expect(workbench(renderFactorySlot)).toBeUndefined();
  });

  it("lists the history and links the adopted diagnosis onward", async () => {
    const summary = diagnosis({ status: "adopted", isCurrent: true });
    setup("", {
      production: { diagnosesList: vi.fn(() => ok({ items: [summary] })) },
    });
    const history = await screen.findByRole("navigation", {
      name: zh["diagnosis.history"],
    });
    await waitFor(() =>
      expect(history.textContent).toContain(
        t("diagnosis.history.item", {
          version: 1,
          status: zh["diagnosis.status.adopted"],
        }),
      ),
    );
    expect(
      screen
        .getByRole("link", { name: zh["diagnosis.accepted.strategy"] })
        .getAttribute("href"),
    ).toBe(`#/projects/${PROJECT}/tools/adaptation-strategy`);
  });

  it("discards behind its own dialog", async () => {
    const { production } = setup(`diagnosisId=${DIAGNOSIS}`);
    fireEvent.click(
      await screen.findByRole("button", { name: zh["diagnosis.discard"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: zh["diagnosis.discard.accept"],
      }),
    );
    await waitFor(() =>
      expect(production.diagnosesDiscard).toHaveBeenCalledWith(
        DIAGNOSIS,
        {},
        '"3"',
        expect.any(String),
      ),
    );
  });
});
