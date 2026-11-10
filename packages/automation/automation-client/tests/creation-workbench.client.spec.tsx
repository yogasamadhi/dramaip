// @vitest-environment jsdom
import type { RenderFactorySlot, TranslateNS } from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  creationEn,
  creationZh,
} from "../src/client/creation/creation-locale.ts";
import {
  CreationRecordWorkbench,
  CreationWorkbench,
  type CreationWorkbenchViewProps,
} from "../src/client/creation/CreationWorkbench.tsx";
import { mergedChapter } from "../src/client/creation/MergeDialogs.tsx";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TranslateNS<"creation">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const never = () => new Promise<never>(() => {});

const PROJECT = "11111111-1111-4111-8111-111111111111";
const WORKFLOW = "44444444-4444-4444-8444-444444444444";
const ACTIVE = [
  "automation",
  "agents",
  "creative-quality",
  "writing",
  "production",
].map((id) => ({ id, status: "active" }));

/** A Remote face whose event stream never yields. */
function remotes(overrides: {
  automation?: Record<string, unknown>;
  plugins?: { id: string; status: string }[];
}) {
  const system = {
    runtime: vi.fn(() => ok({ plugins: overrides.plugins ?? ACTIVE })),
    events: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: never }),
      dispose: vi.fn(),
    })),
  };
  const automation: Record<string, unknown> = {
    creationList: vi.fn(() => ok({ items: [] })),
    creationGet: vi.fn(never),
    ...overrides.automation,
  };
  const agents = {
    enginesGetProjectSettings: vi.fn(() => ok({ defaultEngineKind: "pi" })),
  };
  return { system, automation, agents, writing: {} };
}

const view = (
  faces: ReturnType<typeof remotes>,
  props: Partial<CreationWorkbenchViewProps>,
  renderFactorySlot: RenderFactorySlot = vi.fn(() => null),
) =>
  ({
    ...faces,
    t,
    renderFactorySlot,
    projectId: PROJECT,
    operation: "chapter-outline",
    ...props,
  }) as unknown as CreationWorkbenchViewProps;

const settle = () => act(async () => {});

describe("creation copy", () => {
  it("names every key in both languages with the same parameters", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(Object.keys(creationEn).sort()).toEqual(
      Object.keys(creationZh).sort(),
    );
    for (const [key, text] of Object.entries(creationZh))
      expect(names(creationEn[key as keyof typeof creationEn]), key).toEqual(
        names(text),
      );
  });
});

describe("the creation workbench", () => {
  it("starts a run with the stored goal, the default engine and its own key", async () => {
    const created = { id: WORKFLOW };
    const faces = remotes({
      automation: { creationStart: vi.fn(() => ok(created)) },
    });
    const onStarted = vi.fn();
    render(
      <CreationWorkbench
        {...view(faces, { baseVersion: 3, onStarted, sourceIds: ["s-1"] })}
      />,
    );
    await settle();
    const start = screen.getByText(/^workbench\.start/u);
    await act(async () => {
      fireEvent.click(start);
    });
    const creationStart = faces.automation.creationStart as ReturnType<
      typeof vi.fn
    >;
    expect(creationStart).toHaveBeenCalledTimes(1);
    const [input, ifMatch, key] = creationStart.mock.calls[0]!;
    expect(input).toEqual({
      projectId: PROJECT,
      operation: "chapter-outline",
      baseVersion: 3,
      instruction: expect.stringContaining("workbench.defaultInstruction"),
      sourceIds: ["s-1"],
      engineKind: "pi",
    });
    expect(ifMatch).toBeUndefined();
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);
    expect(onStarted).toHaveBeenCalledWith(created);
  });

  it("keeps the goal on this device and offers nothing while a capability is off", async () => {
    const faces = remotes({
      plugins: [{ id: "automation", status: "active" }],
    });
    render(<CreationWorkbench {...view(faces, {})} />);
    await settle();
    expect(screen.getByText("workbench.capabilityOff")).toBeTruthy();
    expect(
      (screen.getByText(/^workbench\.start/u) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("workbench.instruction.aria"), {
      target: { value: "更紧凑" },
    });
    expect(Object.values({ ...window.localStorage }).includes("更紧凑")).toBe(
      true,
    );
  });

  it("asks the production source picker before a new production run", async () => {
    const faces = remotes({});
    const renderFactorySlot = vi.fn(
      (_name: string, props: { children: (s: object) => unknown }) =>
        props.children({ startDisabled: true }),
    ) as unknown as RenderFactorySlot;
    render(
      <CreationWorkbench
        {...view(faces, { operation: "shot-prompt" }, renderFactorySlot)}
      />,
    );
    await settle();
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "production.narrative-sources",
      expect.objectContaining({
        projectId: PROJECT,
        storageKey: `dramaip-production-source-choice:${PROJECT}:shot-prompt:project:[]`,
      }),
      expect.anything(),
    );
    expect(
      (screen.getByText(/^workbench\.start/u) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("refuses a run list that answers another project", async () => {
    const faces = remotes({
      automation: {
        creationList: vi.fn(() =>
          ok({ items: [{ id: WORKFLOW, input: { projectId: "other" } }] }),
        ),
      },
    });
    render(<CreationWorkbench {...view(faces, {})} />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain(
      "workbench.listForeign",
    );
  });
});

describe("the record workbench", () => {
  it("opens no draft for a record of another project", async () => {
    const faces = remotes({});
    const production = {
      scriptsGet: vi.fn(() =>
        ok({ id: "s-1", domain: "scripts", projectId: "other", version: 1 }),
      ),
    };
    render(
      <CreationRecordWorkbench
        {...(view(faces, {}) as unknown as CreationWorkbenchViewProps)}
        production={production as never}
        targetId="s-1"
        domain="scripts"
        operation="script-revision"
      />,
    );
    await settle();
    expect(production.scriptsGet).toHaveBeenCalledWith("s-1");
    expect(screen.getByRole("alert").textContent).toBe("record.foreign");
  });
});

describe("a chapter merge", () => {
  it("joins each segment as compared and each conflict as chosen", () => {
    const merge = {
      previewId: "p",
      chapterId: "c",
      currentVersion: 2,
      segments: [
        {
          id: "a",
          base: "",
          current: "",
          candidate: "",
          content: "开头",
          conflict: false,
        },
        {
          id: "b",
          base: "旧",
          current: "现",
          candidate: "新",
          content: "",
          conflict: true,
        },
        {
          id: "c",
          base: "旧",
          current: "甲",
          candidate: "乙",
          content: "",
          conflict: true,
        },
      ],
    } as never;
    expect(mergedChapter(merge, { b: "candidate", c: "both" })).toBe(
      "开头新甲\n乙",
    );
  });
});
