// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import type { LegacyProjectRecord } from "@dramaip/workspace-studio-client/client/contract";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, inject, PROJECT_TOOLS_ROUTE } from "../src/client/index.ts";
import {
  modeTools,
  ProjectToolsPage,
  type ProjectToolsPageProps,
} from "../src/client/ProjectToolsPage.tsx";
import {
  searchHitPath,
  SearchPage,
  type SearchPageProps,
} from "../src/client/SearchPage.tsx";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

/** Copy with its key and values visible, so assertions name the key. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values
    ? `${key} ${JSON.stringify(values)}`
    : key) as unknown as TranslateNS<"workspace">;

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
  const remote = {
    workspace: {},
    system: {},
    media: {},
    writing: {},
    knowledge: {},
    automation: {},
    production: {},
    delivery: {},
  };
  ctx.provide("remote", remote as never);
  for (const [name, namespace] of Object.entries(remote))
    ctx.provide(`remote.${name}`, namespace as never);
  await slotsFiber.await();
  return { ctx, remote, slots: ctx.get("slots") as SlotRegistry };
}

describe("workspace client apply", () => {
  it("needs Slots, copy and the Remote namespaces its pages and tools call", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.workspace",
      "remote.system",
      "remote.media",
      "remote.writing",
      "remote.knowledge",
      "remote.automation",
      "remote.production",
      "remote.delivery",
    ]);
  });

  it("brings the native tool bodies once the project tools page declares them", async () => {
    const { ctx, remote, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("workspace.tool")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "workspace.tool": { kind: "keyed", scope: "root" } },
      },
      (_props: PropsRenderSlots<"workspace.tool">) => null,
    );
    const tools = slots.entries("workspace.tool");
    expect(tools.map((entry) => entry.options.key)).toEqual([
      "personal-theater",
      "creator-channel",
      "series",
      "pilot",
      "import",
      "review",
      "cockpit",
      "author-intent",
    ]);
    for (const tool of tools) {
      expect(tool.registrant).toBe("workspace-client");
      expect(tool.inject?.()).toEqual(remote);
    }
  });

  it("defines the records workspace Factory under the workspace copy", async () => {
    const { ctx, slots } = await bench();
    const define = vi.spyOn(slots, "registerFactory");
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(
      define.mock.calls.map(([options]) => [
        options.name,
        options.scope,
        options.locale,
      ]),
    ).toEqual([["workspace.records", "root", "workspace"]]);
  });

  it("takes /search and the project tools once the Studio client declares its routes", async () => {
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
          { entryKey: "/search" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/search", PROJECT_TOOLS_ROUTE]);
  });
});

describe("search hit paths", () => {
  it("opens a project, a chapter's project, the stage that holds a record, or the settings", () => {
    expect(searchHitPath({ kind: "project", id: "p" })).toBe("/projects/p");
    expect(searchHitPath({ kind: "chapter", id: "c", projectId: "p" })).toBe(
      "/projects/p",
    );
    expect(searchHitPath({ kind: "episodes", id: "e", projectId: "p" })).toBe(
      "/adapt?stage=episodes&projectId=p&episodeId=e",
    );
    expect(searchHitPath({ kind: "video", id: "v", projectId: "p" })).toBe(
      "/produce?stage=video&projectId=p",
    );
    expect(searchHitPath({ kind: "delivery", id: "d" })).toBe(
      "/review?stage=delivery",
    );
    expect(searchHitPath({ kind: "providers", id: "x" })).toBe("/settings");
    expect(searchHitPath({ kind: "beats", id: "b" })).toBe("/create");
  });
});

function mountSearch(searchGlobal: ReturnType<typeof vi.fn>) {
  const navigate = vi.fn();
  const props = {
    t,
    navigate,
    workspace: { searchGlobal },
  } as unknown as SearchPageProps;
  render(<SearchPage {...props} />);
  return { navigate };
}

describe("the search page", () => {
  it("searches the trimmed terms and opens a hit in the app", async () => {
    const searchGlobal = vi.fn(() =>
      ok({
        query: "雨夜",
        results: [
          {
            kind: "project",
            id: PROJECT,
            title: "雨夜归来",
            excerpt: "梗概",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            kind: "scenes",
            id: "s-1",
            title: "门口",
            excerpt: "not shown",
            projectId: PROJECT,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            kind: "unlisted-kind",
            id: "u-1",
            title: "其他",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const { navigate } = mountSearch(searchGlobal);
    const submit = screen.getByRole("button", { name: "search.submit" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByRole("textbox", { name: "search.label" });
    fireEvent.change(input, { target: { value: "  雨夜 " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText('search.count {"query":"雨夜","count":3}');
    expect(searchGlobal).toHaveBeenCalledWith("雨夜");
    expect(screen.getByText("梗概")).toBeTruthy();
    expect(screen.queryByText("not shown")).toBeNull();
    expect(screen.getByText("kind.scenes")).toBeTruthy();
    expect(screen.getByText("kind.other")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /门口/ }));
    expect(navigate).toHaveBeenCalledWith(
      `/adapt?stage=scenes&projectId=${PROJECT}&sceneId=s-1`,
    );
  });

  it("says when nothing matched", async () => {
    mountSearch(vi.fn(() => ok({ query: "无", results: [] })));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "无" } });
    fireEvent.click(screen.getByRole("button", { name: "search.submit" }));
    await screen.findByText("search.empty");
  });

  it("names a failed search", async () => {
    mountSearch(vi.fn(() => failed("Host unavailable")));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "search.submit" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      'search.failed {"message":"Host unavailable"}',
    );
  });
});

function projectRecord(
  overrides: {
    [Key in keyof LegacyProjectRecord]?: LegacyProjectRecord[Key] | undefined;
  } = {},
): LegacyProjectRecord {
  return {
    status: "ready",
    project: {
      id: PROJECT,
      title: "雨夜归来",
      mode: "series_longform",
      directScript: false,
    },
    chapterCount: 0,
    record: { opaque: true },
    ...overrides,
  } as LegacyProjectRecord;
}

function mountTools(
  record: LegacyProjectRecord,
  toolKey?: string,
  importExtractionsList: ReturnType<typeof vi.fn> = vi.fn(() => ok([])),
) {
  const navigate = vi.fn();
  const renderSlot = vi.fn(
    (
      key: string,
      owner: { projectId: string; record: object },
      opts?: { entryKey?: string },
    ) => (
      <p>{`${key} [${opts?.entryKey ?? ""}] [${owner.projectId}] [${JSON.stringify(owner.record)}]`}</p>
    ),
  );
  const useProjectRecord = vi.fn(() => record);
  const props = {
    t,
    navigate,
    renderSlot,
    useRoute: () => ({
      params: { projectId: PROJECT, toolKey },
      search: "",
    }),
    useProjectRecord,
    workspace: { importExtractionsList },
  } as unknown as ProjectToolsPageProps;
  render(<ProjectToolsPage {...props} />);
  return { navigate, renderSlot, useProjectRecord, importExtractionsList };
}

describe("the project tools page", () => {
  it("offers the tools of each mode in the overview's order", () => {
    expect(modeTools("creator_channel")).toEqual([
      "review",
      "cockpit",
      "creator-channel",
    ]);
    expect(modeTools("single_season")).not.toContain("series");
    expect(modeTools("series_longform")).toContain("series");
  });

  it("renders no tools while the project is read, and names a failed read", () => {
    const loading = mountTools(
      projectRecord({ status: "loading", project: undefined }),
    );
    expect(screen.getByRole("status").textContent).toBe("tools.loading");
    expect(loading.useProjectRecord).toHaveBeenCalledWith(PROJECT);
    cleanup();
    const failure = mountTools(
      projectRecord({ status: "failed", project: undefined, error: "404" }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      'tools.failed {"message":"404"}',
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(failure.renderSlot).not.toHaveBeenCalled();
  });

  it("recommends importing a project without text, and reviewing drafts once they wait", async () => {
    mountTools(projectRecord());
    const next = () =>
      screen.getByRole("link", { name: /tools\.next/ }).getAttribute("href");
    expect(next()).toBe(`/projects/${PROJECT}/tools/import`);
    cleanup();
    const { importExtractionsList } = mountTools(
      projectRecord({ chapterCount: 2 }),
      undefined,
      vi.fn(() =>
        ok([
          {
            candidates: [
              { status: "draft" },
              { status: "applied" },
              { status: "draft" },
            ],
          },
        ]),
      ),
    );
    expect(importExtractionsList).toHaveBeenCalledWith(PROJECT);
    await waitFor(() =>
      expect(next()).toBe(`/projects/${PROJECT}/tools/review`),
    );
    expect(screen.getByText("tools.state.review.pending")).toBeTruthy();
    expect(screen.getByText('tools.pending {"count":2}')).toBeTruthy();
  });

  it("recommends the cockpit once there is text, and goes back to the script of a script-only project", () => {
    mountTools(projectRecord({ chapterCount: 1 }));
    expect(
      screen.getByRole("link", { name: /tools\.next/ }).getAttribute("href"),
    ).toBe(`/projects/${PROJECT}/tools/cockpit`);
    expect(screen.getByRole("button").textContent).toBe("tools.back.writing");
    cleanup();
    const { navigate } = mountTools(
      projectRecord({
        project: {
          id: PROJECT,
          title: "剧本",
          mode: "single_season",
          directScript: true,
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "tools.back.script" }));
    expect(navigate).toHaveBeenCalledWith(`/projects/${PROJECT}`);
  });

  it("lays out the chosen tool's body with the project record, and reads no drafts for it", () => {
    const { renderSlot, importExtractionsList, navigate } = mountTools(
      projectRecord(),
      "series",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "tool.series",
    );
    expect(
      screen.getByText(
        `workspace.tool [series] [${PROJECT}] [{"opaque":true}]`,
      ),
    ).toBeTruthy();
    expect(importExtractionsList).not.toHaveBeenCalled();
    const nav = screen.getByRole("navigation", { name: "tools.nav" });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
      "tool.series",
    );
    fireEvent.click(screen.getByRole("link", { name: "tools.overview" }));
    expect(navigate).toHaveBeenCalledWith(`/projects/${PROJECT}/tools`);
    expect(renderSlot).toHaveBeenCalledTimes(1);
  });

  it("shows the overview for a tool the project's mode does not offer", () => {
    const { renderSlot } = mountTools(
      projectRecord({
        project: {
          id: PROJECT,
          title: "频道",
          mode: "creator_channel",
          directScript: false,
        },
      }),
      "series",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "tools.title",
    );
    expect(renderSlot).not.toHaveBeenCalled();
  });

  it("keeps a failed re-read in view above the tools", () => {
    mountTools(projectRecord({ error: "stale" }), "cockpit");
    expect(screen.getByRole("alert").textContent).toBe("stale");
  });
});
