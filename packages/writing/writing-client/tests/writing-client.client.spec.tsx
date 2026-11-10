// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import type {
  LegacyNovelQuickStart,
  LegacyNovelWorkspace,
} from "@dramaip/workspace-studio-client/client/contract";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, inject, NOVEL_WORKSPACE_ROUTE } from "../src/client/index.ts";
import {
  NovelWorkspacePage,
  type NovelWorkspacePageProps,
} from "../src/client/NovelWorkspacePage.tsx";
import {
  QuickStartPage,
  type QuickStartPageProps,
} from "../src/client/QuickStartPage.tsx";
import {
  WritingHomePage,
  type WritingHomePageProps,
} from "../src/client/WritingHomePage.tsx";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

/** Copy with its key and values visible, so assertions name the key. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values
    ? `${key} ${JSON.stringify(values)}`
    : key) as unknown as TranslateNS<"writing">;

const PROJECT = "11111111-1111-4111-8111-111111111111";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "compat/problem", message },
  });

async function bench() {
  const root = new Context();
  let ctx: Context | undefined;
  const owner = root.plugin((owned: Context) => {
    ctx = owned;
  });
  owners.add(owner);
  await owner.await();
  if (ctx === undefined) throw new Error("the fixture owner did not activate");
  const slotsFiber = ctx.plugin(SlotRegistry);
  ctx.provide("locale", new LocaleRuntime(ctx));
  const workspace = {};
  const system = {};
  const knowledge = {};
  ctx.provide("remote", { workspace, system, knowledge } as never);
  ctx.provide("remote.workspace", workspace as never);
  ctx.provide("remote.system", system as never);
  ctx.provide("remote.knowledge", knowledge as never);
  await slotsFiber.await();
  return { ctx, slots: ctx.get("slots") as SlotRegistry };
}

describe("writing client apply", () => {
  it("needs Slots, copy and the workspace, system and knowledge Remote namespaces", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.workspace",
      "remote.system",
      "remote.knowledge",
    ]);
  });

  it("registers the narrative context picker Factory", async () => {
    const { ctx, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(
      slots.snapshot().map((node) => (node as { name?: string }).name),
    ).toContain("writing.context-picker");
  });

  it("takes the novel library, quick start and workspace once the Studio client declares its routes", async () => {
    const { ctx, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("studio.route")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "studio.route": { kind: "keyed", scope: "root" } },
      },
      ({ renderSlot }: PropsRenderSlots<"studio.route">) =>
        renderSlot(
          "studio.route",
          {
            navigate: vi.fn(),
            useRoute: vi.fn(),
            useProjectRecord: vi.fn(),
            useNovelWorkspace: vi.fn(),
            useNovelQuickStart: vi.fn(),
            useProjectScope: vi.fn(),
            useProductionScope: vi.fn(),
            useEpisodeScope: vi.fn(),
            useAssistantIntent: vi.fn(),
          },
          { entryKey: "/write" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/write", "/write/new", NOVEL_WORKSPACE_ROUTE]);
  });
});

describe("the novel library", () => {
  function mountHome(projectsList: ReturnType<typeof vi.fn>) {
    const navigate = vi.fn();
    const props = {
      t,
      navigate,
      workspace: { projectsList },
    } as unknown as WritingHomePageProps;
    render(<WritingHomePage {...props} />);
    return { navigate };
  }

  it("lists every project and opens one in the app", async () => {
    const { navigate } = mountHome(
      vi.fn(() =>
        ok([
          {
            id: PROJECT,
            title: "雨夜归来",
            synopsis: "",
            shortDramaType: "悬疑",
            version: 0,
            targetWordCount: 300000,
          },
        ]),
      ),
    );
    expect(screen.getByRole("status").textContent).toBe("home.loading");
    const title = await screen.findByRole("heading", { level: 3 });
    expect(title.textContent).toBe("雨夜归来");
    expect(screen.getByText("home.synopsis.empty")).toBeTruthy();
    expect(screen.getByText('home.target {"count":300000}')).toBeTruthy();
    expect(screen.getByText('home.version {"version":1}')).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /雨夜归来/ }));
    expect(navigate).toHaveBeenCalledWith(`/projects/${PROJECT}`);
  });

  it("offers the first novel when there is none, and names a failed read", async () => {
    mountHome(vi.fn(() => ok([])));
    expect(await screen.findByText("home.empty.title")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "home.empty.action" })
        .getAttribute("href"),
    ).toBe("/write/new");
    cleanup();
    mountHome(vi.fn(() => failed("offline")));
    expect((await screen.findByRole("alert")).textContent).toBe(
      'home.failed {"message":"offline"}',
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

function quickStart(
  overrides: Partial<LegacyNovelQuickStart> = {},
): LegacyNovelQuickStart {
  return {
    conflict: false,
    mode: "inspiration",
    title: "",
    idea: "",
    genre: "",
    genres: ["悬疑", "言情"],
    saving: false,
    error: undefined,
    replaceOtherDraft: vi.fn(),
    setMode: vi.fn(),
    setTitle: vi.fn(),
    setIdea: vi.fn(),
    setGenre: vi.fn(),
    create: vi.fn(),
    record: { opaque: true },
    ...overrides,
  } as unknown as LegacyNovelQuickStart;
}

function mountStart(start: LegacyNovelQuickStart) {
  const navigate = vi.fn();
  const renderSlot = vi.fn(
    (name: string, owner: unknown, options?: { entryKey?: string }) => (
      <span>{`${name} [${options?.entryKey}] ${JSON.stringify(owner)}`}</span>
    ),
  );
  const props = {
    t,
    navigate,
    renderSlot,
    useNovelQuickStart: () => start,
  } as unknown as QuickStartPageProps;
  render(<QuickStartPage {...props} />);
  return { navigate, renderSlot };
}

describe("the novel quick start", () => {
  it("creates once a title is given, and keeps the preset picker in the idea mode", () => {
    const empty = quickStart();
    mountStart(empty);
    const submit = () =>
      screen.getByRole("button", { name: "start.submit.inspiration" });
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('writing.preset [picker] {"record":{"opaque":true}}'),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "start.name" }), {
      target: { value: "雨夜归来" },
    });
    expect(empty.setTitle).toHaveBeenCalledWith("雨夜归来");
    fireEvent.click(screen.getByRole("button", { name: "言情" }));
    expect(empty.setGenre).toHaveBeenCalledWith("言情");
    fireEvent.click(screen.getByRole("button", { name: "start.mode.source" }));
    expect(empty.setMode).toHaveBeenCalledWith("source");
    cleanup();
    const titled = quickStart({ title: "雨夜归来", genre: "悬疑" });
    mountStart(titled);
    expect(
      screen.getByRole("button", { name: "悬疑" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(submit());
    expect(titled.create).toHaveBeenCalledTimes(1);
  });

  it("imports a source without the preset picker, and names a failed create", () => {
    const { renderSlot } = mountStart(
      quickStart({ mode: "source", title: "原著", error: "busy" }),
    );
    expect(renderSlot).not.toHaveBeenCalled();
    expect(screen.getByText("start.source.note")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("busy");
    expect(
      screen.getByRole("button", { name: "start.submit.source" }),
    ).toBeTruthy();
  });

  it("never overwrites another mode's draft silently", () => {
    const start = quickStart({ conflict: true });
    mountStart(start);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "start.conflict.continue" })
        .getAttribute("href"),
    ).toBe("/");
    fireEvent.click(
      screen.getByRole("button", { name: "start.conflict.replace" }),
    );
    expect(start.replaceOtherDraft).toHaveBeenCalledTimes(1);
  });
});

/** Overrides of the workspace record; a field may be cleared. */
type NovelOverrides = {
  [K in keyof LegacyNovelWorkspace]?: LegacyNovelWorkspace[K] | undefined;
};

function novel(overrides: NovelOverrides = {}): LegacyNovelWorkspace {
  return {
    status: "ready",
    project: { id: PROJECT, title: "雨夜归来", mode: "series_longform" },
    chapterCount: 3,
    record: { opaque: true },
    ...overrides,
  } as unknown as LegacyNovelWorkspace;
}

function mountWorkspace(
  record: LegacyNovelWorkspace,
  search = "",
  remotes: {
    exportsProject?: ReturnType<typeof vi.fn>;
    saveTextFile?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const navigate = vi.fn();
  const renderSlot = vi.fn(
    (
      name: string,
      owner: { outlineMode?: string },
      options?: { entryKey?: string },
    ) => <span>{`${name} [${options?.entryKey}] [${owner.outlineMode}]`}</span>,
  );
  const useNovelWorkspace = vi.fn(() => record);
  const props = {
    t,
    navigate,
    renderSlot,
    useRoute: () => ({ params: { projectId: PROJECT }, search }),
    useNovelWorkspace,
    workspace: { exportsProject: remotes.exportsProject ?? vi.fn() },
    system: { saveTextFile: remotes.saveTextFile ?? vi.fn() },
  } as unknown as NovelWorkspacePageProps;
  render(<NovelWorkspacePage {...props} />);
  return { navigate, renderSlot, useNovelWorkspace };
}

describe("the novel workspace", () => {
  it("lays out nothing while the project is read, and names a failed read", () => {
    const loading = mountWorkspace(
      novel({ status: "loading", project: undefined }),
    );
    expect(screen.getByRole("status").textContent).toBe("workspace.loading");
    expect(loading.useNovelWorkspace).toHaveBeenCalledWith(PROJECT);
    cleanup();
    const failure = mountWorkspace(
      novel({ status: "failed", project: undefined, error: "404" }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      'workspace.failed {"message":"404"}',
    );
    expect(failure.renderSlot).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("link", { name: "workspace.failed.back" }),
    );
    expect(failure.navigate).toHaveBeenCalledWith("/write");
  });

  it("opens the chapters by default and switches sections from the header", () => {
    const { renderSlot } = mountWorkspace(novel());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "雨夜归来",
    );
    expect(screen.getByText('workspace.chapters {"count":3}')).toBeTruthy();
    expect(screen.getByText("writing.section [chapters] [book]")).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith(
      "writing.banner",
      expect.objectContaining({ record: { opaque: true } }),
    );
    const nav = screen.getByRole("navigation", { name: "workspace.nav" });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
      "section.chapters",
    );
    fireEvent.click(screen.getByRole("button", { name: "section.characters" }));
    expect(
      screen.getByText("writing.section [characters] [book]"),
    ).toBeTruthy();
  });

  it("follows the section and outline mode the address names", () => {
    mountWorkspace(novel(), "?section=outlines&outlineMode=arc");
    expect(screen.getByText("writing.section [outlines] [arc]")).toBeTruthy();
    cleanup();
    mountWorkspace(novel(), "?section=unknown&outlineMode=none");
    expect(screen.getByText("writing.section [chapters] [book]")).toBeTruthy();
  });

  it("exports through the workspace namespace and saves through the system one", async () => {
    const exportsProject = vi.fn(() =>
      ok({ fileName: "雨夜归来.md", content: "# 雨夜归来" }),
    );
    const saveTextFile = vi.fn(() => ok({ saved: true }));
    mountWorkspace(novel(), "", { exportsProject, saveTextFile });
    fireEvent.click(screen.getByRole("button", { name: "io.menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "io.markdown" }));
    expect(exportsProject).toHaveBeenCalledWith(PROJECT, "markdown");
    expect((await screen.findByRole("status")).textContent).toBe("io.saved");
    expect(saveTextFile).toHaveBeenCalledWith({
      suggestedName: "雨夜归来.md",
      content: "# 雨夜归来",
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("names a failed export, and opens the manuscript dialog for a submission", async () => {
    const saveTextFile = vi.fn();
    const { renderSlot } = mountWorkspace(novel(), "", {
      exportsProject: vi.fn(() => failed("disk full")),
      saveTextFile,
    });
    fireEvent.click(screen.getByRole("button", { name: "io.menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "io.json" }));
    expect((await screen.findByRole("alert")).textContent).toBe("disk full");
    expect(saveTextFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "io.menu" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "io.submission-json" }),
    );
    expect(renderSlot).toHaveBeenCalledWith(
      "writing.manuscript",
      expect.objectContaining({ projectId: PROJECT, format: "json" }),
      { entryKey: "dialog" },
    );
  });

  it("opens the manuscript preview the address names and drops it from the address on close", () => {
    const { renderSlot, navigate } = mountWorkspace(
      novel(),
      "?section=chapters&manuscriptId=m-1",
    );
    const call = renderSlot.mock.calls.find(
      ([name]) => name === "writing.manuscript",
    );
    const owner = call?.[1] as unknown as {
      format: string;
      previewId: string;
      onClose(): void;
    };
    expect(owner.format).toBe("markdown");
    expect(owner.previewId).toBe("m-1");
    owner.onClose();
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT}?section=chapters`,
    );
  });

  it("closes the mode guide for good", async () => {
    mountWorkspace(novel());
    expect(screen.getByText("guide.series_longform.title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "guide.close" }));
    await waitFor(() =>
      expect(screen.queryByText("guide.series_longform.title")).toBeNull(),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("dramaip-mode-guide-dismissed-v1") ?? "[]",
      ),
    ).toEqual(["series_longform"]);
    cleanup();
    mountWorkspace(novel());
    expect(screen.queryByText("guide.series_longform.title")).toBeNull();
  });

  it("keeps a failed re-read in view above the section", () => {
    mountWorkspace(novel({ error: "stale" }));
    expect(screen.getByRole("alert").textContent).toBe("stale");
  });
});
