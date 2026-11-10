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
import { AuthorIntentEntry } from "../src/client/intent/AuthorIntentTool.tsx";
import { zh } from "../src/client/locale.ts";
import type { ToolProps } from "../src/client/tools/PersonalTheaterTool.tsx";

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"workspace">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const never = () => new Promise<never>(() => {});
const PROJECT = "11111111-1111-4111-8111-111111111111";
const INTENT = "22222222-2222-4222-8222-222222222222";
const ADOPTED = "33333333-3333-4333-8333-333333333333";
const WORKFLOW = "44444444-4444-4444-8444-444444444444";
const CHAPTER = "55555555-5555-4555-8555-555555555555";

const content = {
  themeStatement: "原谅",
  emotionalPromise: "温暖",
  targetAudience: "成人",
  mustKeep: ["主角"],
  mayChange: [],
  mustAvoid: [],
  endingContract: "",
  toneAndVoice: "克制",
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: INTENT,
    projectId: PROJECT,
    version: 2,
    stateVersion: 3,
    status: "pending",
    content,
    source: { kind: "manual", projectVersion: 5 },
    sourceState: "current",
    isCurrent: false,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    ...overrides,
  };
}

/** A published event stream the test pushes into. */
function stream() {
  const waiting: ((value: IteratorResult<unknown>) => void)[] = [];
  const queued: unknown[] = [];
  const system = {
    events: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          queued.length
            ? Promise.resolve({ done: false, value: queued.shift() })
            : new Promise<IteratorResult<unknown>>((resolve) =>
                waiting.push(resolve),
              ),
      }),
      dispose: vi.fn(),
    })),
  };
  const push = (event: { type: string; payload: unknown }) => {
    const envelope = { kind: "domain", cursor: 1, event };
    const next = waiting.shift();
    if (next) next({ done: false, value: envelope });
    else queued.push(envelope);
  };
  return { system, push };
}

function setup(
  search = "",
  overrides: {
    workspace?: Record<string, unknown>;
    automation?: Record<string, unknown>;
  } = {},
) {
  const { system, push } = stream();
  const workspace = {
    projectsGet: vi.fn(() =>
      ok({
        id: PROJECT,
        version: 5,
        targetAudience: "旧受众",
        emotionalCore: "旧情感",
        styleGuide: "旧风格",
      }),
    ),
    authorIntentsCurrent: vi.fn(() => ok({ projectVersion: 5 })),
    authorIntentsList: vi.fn(() => ok({ items: [] })),
    authorIntentsGet: vi.fn(() => ok(intent())),
    authorIntentsSources: vi.fn(() =>
      ok({
        projectVersion: 5,
        chapterAvailable: true,
        scriptAvailable: false,
        items: [
          {
            title: "第一章",
            source: {
              kind: "chapter",
              id: CHAPTER,
              version: 1,
              contentHash: "a".repeat(64),
            },
          },
        ],
      }),
    ),
    authorIntentsPreview: vi.fn(() => ok(intent())),
    authorIntentsAdopt: vi.fn(() => ok(intent({ status: "adopted" }))),
    authorIntentsDiscard: vi.fn(() => ok(intent({ status: "discarded" }))),
    ...overrides.workspace,
  };
  const automation = { creationGet: vi.fn(never), ...overrides.automation };
  const writing = {
    chaptersList: vi.fn(() =>
      ok([{ id: CHAPTER, projectId: PROJECT, version: 1, orderIndex: 0 }]),
    ),
  };
  const navigate = vi.fn();
  const renderFactorySlot = vi.fn(() => null);
  const props = {
    projectId: PROJECT,
    record: {},
    search,
    reload: vi.fn(),
    navigate,
    t,
    renderFactorySlot,
    workspace,
    automation,
    writing,
    system,
    media: {},
    knowledge: {},
    production: {},
    delivery: {},
  } as unknown as ToolProps;
  render(<AuthorIntentEntry {...props} />);
  return { workspace, automation, writing, navigate, renderFactorySlot, push };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the author intent tool", () => {
  it("previews the trimmed draft frozen to the read basis and opens it", async () => {
    const { workspace, navigate } = setup();
    expect(await screen.findByText(zh["intent.current.none"])).toBeTruthy();
    fireEvent.change(screen.getByLabelText(zh["intent.field.themeStatement"]), {
      target: { value: "  原谅 " },
    });
    fireEvent.change(
      screen.getByLabelText(zh["intent.field.emotionalPromise"]),
      {
        target: { value: "温暖" },
      },
    );
    fireEvent.change(screen.getByLabelText(zh["intent.field.targetAudience"]), {
      target: { value: "成人" },
    });
    fireEvent.change(screen.getByLabelText(zh["intent.field.toneAndVoice"]), {
      target: { value: "克制" },
    });
    fireEvent.change(screen.getByLabelText(zh["intent.field.mustKeep"]), {
      target: { value: "主角\n\n" },
    });
    expect(screen.getByLabelText(zh["intent.draft.label"]).textContent).toBe(
      zh["intent.draft.saved"],
    );
    fireEvent.click(screen.getByRole("button", { name: zh["intent.preview"] }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(workspace.authorIntentsPreview).toHaveBeenCalledWith(
      PROJECT,
      { content, projectVersion: 5, sourceKind: "manual" },
      undefined,
      expect.any(String),
    );
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}/tools/author-intent?intentId=${INTENT}`,
    );
  });

  it("refuses an incomplete draft without calling the owner", async () => {
    const { workspace } = setup();
    await screen.findByText(zh["intent.current.none"]);
    fireEvent.click(screen.getByRole("button", { name: zh["intent.preview"] }));
    expect(await screen.findByText(zh["intent.preview.invalid"])).toBeTruthy();
    expect(workspace.authorIntentsPreview).not.toHaveBeenCalled();
  });

  it("restores the local draft with its original basis and flags a changed source", async () => {
    window.localStorage.setItem(
      `dramaip-author-intent-edit:v1:${PROJECT}`,
      JSON.stringify({
        schemaVersion: 1,
        projectId: PROJECT,
        basisVersion: 4,
        sourceKind: "manual",
        fields: {
          themeStatement: "未写完",
          emotionalPromise: "",
          targetAudience: "",
          mustKeep: "",
          mayChange: "",
          mustAvoid: "",
          endingContract: "",
          toneAndVoice: "",
        },
        updatedAt: "2026-11-03T00:00:00.000Z",
      }),
    );
    setup();
    expect(
      (
        screen.getByLabelText(
          zh["intent.field.themeStatement"],
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("未写完");
    expect(screen.getByLabelText(zh["intent.draft.label"]).textContent).toBe(
      zh["intent.draft.recovered"],
    );
    expect(await screen.findByText(zh["intent.edit.stale"])).toBeTruthy();
  });

  it("keeps an unreadable local draft and clears it only on confirmation", async () => {
    const key = `dramaip-author-intent-edit:v1:${PROJECT}`;
    window.localStorage.setItem(key, "PRIVATE not json");
    setup();
    expect(screen.getByLabelText(zh["intent.draft.label"]).textContent).toBe(
      zh["intent.draft.restore"],
    );
    await screen.findByText(zh["intent.current.none"]);
    fireEvent.change(screen.getByLabelText(zh["intent.field.themeStatement"]), {
      target: { value: "新" },
    });
    expect(window.localStorage.getItem(key)).toBe("PRIVATE not json");
    fireEvent.click(screen.getByRole("button", { name: zh["intent.clear"] }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: zh["intent.clear.accept"] }),
    );
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
    expect(screen.getByLabelText(zh["intent.draft.label"]).textContent).toBe(
      zh["intent.draft.cleared"],
    );
  });

  it("compares the chosen version and adopts it with its state version after confirmation", async () => {
    const { workspace } = setup(`?intentId=${INTENT}`, {
      workspace: {
        authorIntentsCurrent: vi.fn(() =>
          ok({
            projectVersion: 5,
            current: intent({
              id: ADOPTED,
              version: 1,
              status: "adopted",
              content: { ...content, themeStatement: "旧主题" },
            }),
          }),
        ),
      },
    });
    const preview = await screen.findByRole("region", {
      name: zh["intent.candidate.label"],
    });
    expect(preview.getAttribute("data-intent-preview-id")).toBe(INTENT);
    expect(within(preview).getByText("旧主题")).toBeTruthy();
    fireEvent.click(
      within(preview).getByRole("button", { name: zh["intent.adopt"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: zh["intent.adopt.accept"] }),
    );
    await waitFor(() =>
      expect(workspace.authorIntentsAdopt).toHaveBeenCalledWith(
        INTENT,
        { confirmed: true },
        '"3"',
        expect.any(String),
      ),
    );
  });

  it("does not adopt when the confirmation is cancelled", async () => {
    const { workspace } = setup(`?intentId=${INTENT}`);
    const preview = await screen.findByRole("region", {
      name: zh["intent.candidate.label"],
    });
    fireEvent.click(
      within(preview).getByRole("button", { name: zh["intent.discard"] }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText(zh["intent.cancel"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(workspace.authorIntentsDiscard).not.toHaveBeenCalled();
  });

  it("does not open a candidate another workflow or project names", async () => {
    setup(`?intentId=${INTENT}&intentWorkflowId=${WORKFLOW}`, {
      workspace: {
        authorIntentsGet: vi.fn(() => ok(intent({ projectId: ADOPTED }))),
      },
      automation: {
        creationGet: vi.fn(() =>
          ok({
            id: WORKFLOW,
            stage: "review",
            version: 1,
            authorIntentId: INTENT,
            input: { projectId: PROJECT, operation: "author-intent" },
          }),
        ),
      },
    });
    expect(await screen.findByText(zh["intent.selected.missing"])).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: zh["intent.candidate.label"] }),
    ).toBeNull();
  });

  it("refuses a link that names an intent twice", async () => {
    const { workspace } = setup(`?intentId=${INTENT}&intentId=${ADOPTED}`);
    expect((await screen.findAllByText(zh["intent.navigation"])).length).toBe(
      2,
    );
    expect(workspace.authorIntentsGet).not.toHaveBeenCalled();
  });

  it("reads the adopted version again on this project's intent events only", async () => {
    const { workspace, push } = setup();
    await screen.findByText(zh["intent.current.none"]);
    await waitFor(() =>
      expect(workspace.authorIntentsCurrent).toHaveBeenCalledTimes(1),
    );
    push({
      type: "workspace.author-intent-adopted",
      payload: { projectId: ADOPTED },
    });
    push({
      type: "workspace.author-intent-adopted",
      payload: { projectId: PROJECT },
    });
    await waitFor(() =>
      expect(workspace.authorIntentsCurrent).toHaveBeenCalledTimes(2),
    );
    push({ type: "workspace.project-updated", payload: { id: PROJECT } });
    await waitFor(() => expect(workspace.projectsGet).toHaveBeenCalledTimes(2));
  });
});

describe("the AI author intent proposal", () => {
  it("confirms the chosen sources and opens the creation workbench with the frozen request", async () => {
    const { renderFactorySlot } = setup();
    const source = await screen.findByLabelText("意图来源：第一章");
    fireEvent.click(source);
    fireEvent.click(
      screen.getByRole("button", { name: zh["intent.ai.confirm"] }),
    );
    await waitFor(() =>
      expect(renderFactorySlot).toHaveBeenCalledWith(
        "automation.creation-workbench",
        expect.objectContaining({
          projectId: PROJECT,
          operation: "author-intent",
          externalReview: true,
          authorIntentRequest: {
            projectVersion: 5,
            sources: [
              {
                kind: "chapter",
                id: CHAPTER,
                version: 1,
                contentHash: "a".repeat(64),
              },
            ],
          },
        }),
      ),
    );
  });

  it("renders the context picker over the chosen chapters for mixed expressions", async () => {
    const { renderFactorySlot, writing } = setup();
    fireEvent.click(await screen.findByLabelText("意图来源：第一章"));
    fireEvent.click(screen.getByLabelText(zh["intent.ai.expressions.toggle"]));
    await waitFor(() => expect(writing.chaptersList).toHaveBeenCalled());
    await waitFor(() =>
      expect(renderFactorySlot).toHaveBeenCalledWith(
        "writing.context-picker",
        expect.objectContaining({
          purpose: "production",
          chapters: [expect.objectContaining({ id: CHAPTER, version: 1 })],
          request: { format: "narrative-context-v1", chapters: [] },
        }),
      ),
    );
    expect(
      (
        screen.getByRole("button", {
          name: zh["intent.ai.confirm"],
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
