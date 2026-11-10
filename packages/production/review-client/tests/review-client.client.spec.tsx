// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import type {
  LegacyEpisodeScope,
  LegacyProductionScope,
} from "@dramaip/workspace-studio-client/client/contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.ts";
import { ReviewPage, type ReviewPageProps } from "../src/client/ReviewPage.tsx";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

/** Copy with its key visible, so assertions name the key. */
const t = ((key: string) => key) as unknown as TranslateNS<"review">;

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ADAPTATION = "22222222-2222-4222-8222-222222222222";
const EPISODE = "33333333-3333-4333-8333-333333333333";

function episodeScope(
  overrides: Partial<LegacyEpisodeScope> = {},
): LegacyEpisodeScope {
  return {
    projects: [{ id: PROJECT, title: "雨夜归来" }],
    projectId: PROJECT,
    adaptations: [{ id: ADAPTATION, title: "第一季" }],
    adaptationId: ADAPTATION,
    episodes: [{ id: EPISODE, title: "第 1 集" }],
    episodeId: EPISODE,
    requestedStage: null,
    selectProject: vi.fn(),
    selectAdaptation: vi.fn(),
    selectEpisode: vi.fn(),
    sync: vi.fn(),
    ...overrides,
  };
}

function mount(
  production: Partial<LegacyProductionScope>,
  episode: LegacyEpisodeScope = episodeScope(),
) {
  const renderSlot = vi.fn(
    (
      key: string,
      owner: { projectId: string; episodeId: string; episodeTitle: string },
      opts?: { entryKey?: string },
    ) => (
      <p>{`${key} [${opts?.entryKey ?? ""}] [${owner.episodeId}] [${owner.episodeTitle}]`}</p>
    ),
  );
  const navigate = vi.fn();
  const props = {
    t,
    navigate,
    renderSlot,
    useProjectScope: () => ({ projects: [], projectId: "", select: () => {} }),
    useProductionScope: () => ({
      status: "ready",
      projectId: PROJECT,
      context: {},
      key: "k",
      ...production,
    }),
    useEpisodeScope: () => episode,
  } as unknown as ReviewPageProps;
  render(<ReviewPage {...props} />);
  return { renderSlot, navigate, episode };
}

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
  const remote = Object.fromEntries(
    NAMESPACES.map((name) => [name, { name }]),
  ) as Record<(typeof NAMESPACES)[number], { name: string }>;
  ctx.provide("remote", remote as never);
  for (const name of NAMESPACES)
    ctx.provide(`remote.${name}`, remote[name] as never);
  await slotsFiber.await();
  return { ctx, remote, slots: ctx.get("slots") as SlotRegistry };
}

const NAMESPACES = [
  "review",
  "delivery",
  "media",
  "timeline",
  "automation",
  "production",
  "quality",
  "system",
] as const;

describe("review client apply", () => {
  it("needs Slots, copy and the stages' Remote namespaces", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      ...NAMESPACES.map((name) => `remote.${name}`),
    ]);
  });

  it("takes /review once the Studio client declares its routes", async () => {
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
            useProjectScope: vi.fn(),
            useProductionScope: vi.fn(),
            useEpisodeScope: vi.fn(),
            useAssistantIntent: vi.fn(),
            useRoute: vi.fn(),
            useProjectRecord: vi.fn(),
            useNovelWorkspace: vi.fn(),
            useNovelQuickStart: vi.fn(),
          },
          { entryKey: "/review" },
        ),
    );
    const [page] = slots.entries("studio.route");
    expect(page?.options).toMatchObject({ key: "/review" });
  });

  it("brings the five stage bodies and the episode workflow once the page declares them", async () => {
    const { ctx, remote, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("review.stage")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: {
          "review.stage": { kind: "keyed", scope: "root" },
          "review.section": { kind: "list", scope: "root" },
        },
      },
      (_props: PropsRenderSlots<"review.stage" | "review.section">) => null,
    );
    const stages = slots.entries("review.stage");
    expect(stages.map((entry) => entry.options.key)).toEqual([
      "quality",
      "compliance",
      "review",
      "localization",
      "delivery",
    ]);
    for (const stage of stages) {
      expect(stage.registrant).toBe("review-client");
      expect(stage.inject?.()).toEqual(remote);
    }
    const [workflow] = slots.entries("review.section");
    expect(workflow?.options).toMatchObject({
      id: "review-episode-workflow",
      order: 10,
    });
    expect(workflow?.registrant).toBe("review-client");
    expect(workflow?.inject?.()).toEqual({ automation: remote.automation });
  });
});

describe("the review page", () => {
  it("renders no body while the named objects are checked", () => {
    const { renderSlot } = mount({ status: "checking" });
    expect(screen.getByRole("status").textContent).toBe("scope.checking");
    expect(renderSlot).not.toHaveBeenCalled();
  });

  it("names a failed check and offers only the way back home", () => {
    const { renderSlot, navigate } = mount({ status: "failed" });
    expect(screen.getByRole("alert").textContent).toBe("scope.failed");
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "scope.failed.back" }));
    expect(navigate).toHaveBeenCalledWith("/");
    expect(renderSlot).not.toHaveBeenCalled();
  });

  it("lays out the sections and the stage the address asks for", () => {
    mount({}, episodeScope({ requestedStage: "review" }));
    expect(
      screen.getByText(`review.section [] [${EPISODE}] [第 1 集]`),
    ).toBeTruthy();
    expect(
      screen.getByText(`review.stage [review] [${EPISODE}] [第 1 集]`),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "stages.label" });
    expect(
      nav.querySelector('[aria-current="step"]')?.getAttribute("aria-label"),
    ).toBe("stage.review");
  });

  it("switches stage and writes it into the address", () => {
    const { episode } = mount({});
    fireEvent.click(screen.getByRole("button", { name: "stage.delivery" }));
    expect(episode.sync).toHaveBeenCalledWith({ stage: "delivery" });
    expect(
      screen.getByText(`review.stage [delivery] [${EPISODE}] [第 1 集]`),
    ).toBeTruthy();
  });

  it("blocks the stages until an episode is chosen and points to the adaptation workspace", () => {
    const { renderSlot, navigate } = mount(
      {},
      episodeScope({ episodeId: "", episodes: [] }),
    );
    expect(screen.getByText("stage.blocked.episode")).toBeTruthy();
    expect(screen.getAllByText("stage.state.blocked")).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("link", { name: "stage.recover.adaptation" }),
    );
    expect(navigate).toHaveBeenCalledWith(
      `/adapt?projectId=${PROJECT}&stage=episodes`,
    );
    expect(renderSlot.mock.calls.map(([key]) => key)).toEqual(["review.stage"]);
  });

  it("hands every choice to the app's scope", () => {
    const { episode } = mount({});
    fireEvent.change(screen.getByRole("combobox", { name: "scope.episode" }), {
      target: { value: "" },
    });
    expect(episode.selectEpisode).toHaveBeenCalledWith("");
    fireEvent.change(screen.getByRole("combobox", { name: "scope.project" }), {
      target: { value: "" },
    });
    expect(episode.selectProject).toHaveBeenCalledWith("");
  });

  it("asks for a project before any stage body", () => {
    const { renderSlot } = mount(
      { projectId: "" },
      episodeScope({
        projectId: "",
        adaptationId: "",
        episodeId: "",
        adaptations: [],
        episodes: [],
      }),
    );
    expect(screen.getByText("page.noProject")).toBeTruthy();
    expect(screen.getByText("stage.blocked.project")).toBeTruthy();
    expect(screen.queryByLabelText("scope.label")).toBeNull();
    expect(renderSlot).not.toHaveBeenCalled();
  });
});
