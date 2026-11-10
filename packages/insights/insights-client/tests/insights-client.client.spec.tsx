// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.ts";
import { sampleText } from "../src/client/FeedbackSection.tsx";
import {
  InsightsPage,
  type InsightsPageProps,
} from "../src/client/InsightsPage.tsx";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TranslateNS<"insights">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "compat/problem", message },
  });

const PROJECT = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
const CLUSTER = "33333333-3333-4333-8333-333333333333";

const dashboard = (clusters = 0) => ({
  batches: [
    {
      id: BATCH,
      projectId: PROJECT,
      kind: "comments",
      sourceName: "评论.csv",
      rowCount: 4,
      createdAt: "2026-10-28T00:00:00.000Z",
    },
  ],
  metrics: [],
  comments: [],
  clusters: Array.from({ length: clusters }, () => ({
    id: CLUSTER,
    projectId: PROJECT,
    batchId: BATCH,
    title: "节奏太慢",
    summary: "多条评论认为开头拖沓。",
    commentCount: 3,
    createdAt: "2026-10-28T00:00:00.000Z",
  })),
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
  const insights = { feedbackDashboard: vi.fn() };
  const system = { pickFiles: vi.fn() };
  const workspace = { projectsList: vi.fn() };
  const agents = { agentUsageObservationsList: vi.fn() };
  const writing = { chaptersList: vi.fn() };
  const production = { scriptsList: vi.fn() };
  ctx.provide("remote", {
    agents,
    insights,
    production,
    system,
    workspace,
    writing,
  } as never);
  ctx.provide("remote.agents", agents as never);
  ctx.provide("remote.insights", insights as never);
  ctx.provide("remote.production", production as never);
  ctx.provide("remote.system", system as never);
  ctx.provide("remote.workspace", workspace as never);
  ctx.provide("remote.writing", writing as never);
  await slotsFiber.await();
  return {
    ctx,
    slots: ctx.get("slots") as SlotRegistry,
    agents,
    insights,
    system,
    writing,
    production,
  };
}

describe("insights client apply", () => {
  it("needs Slots, copy and the agents, insights, production, system, workspace and writing Remote namespaces", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.agents",
      "remote.insights",
      "remote.production",
      "remote.system",
      "remote.workspace",
      "remote.writing",
    ]);
  });

  it("takes /insights once the Studio client declares its routes", async () => {
    const { ctx, slots, insights, system } = await bench();
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
            navigate: () => {},
            useProjectScope: () => ({
              projects: [],
              projectId: "",
              select: () => {},
            }),
            useProductionScope: vi.fn(),
            useEpisodeScope: vi.fn(),
            useAssistantIntent: vi.fn(),
            useRoute: vi.fn(),
            useProjectRecord: vi.fn(),
            useNovelWorkspace: vi.fn(),
            useNovelQuickStart: vi.fn(),
          },
          { entryKey: "/insights" },
        ),
    );
    const [page] = slots.entries("studio.route");
    expect(page?.options).toMatchObject({ key: "/insights" });
    expect(page?.inject?.()).toEqual({ insights, system });
  });

  it("lays the feedback revision and the outcome ledgers into the insights page once it declares its sections", async () => {
    const { ctx, slots, agents, insights, writing, production } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("insights.section")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "insights.section": { kind: "list", scope: "root" } },
      },
      (_props: PropsRenderSlots<"insights.section">) => null,
    );
    const [revision, section] = slots.entries("insights.section");
    expect(revision?.options).toMatchObject({
      id: "insights-revision",
      order: 10,
    });
    expect(revision?.inject?.()).toEqual({ writing, production });
    expect(section?.options).toMatchObject({
      id: "insights-outcomes",
      order: 20,
    });
    expect(section?.inject?.()).toEqual({ insights, agents });
  });
});

describe("the insights page", () => {
  function mount(
    remote: { insights: Record<string, unknown>; system?: unknown },
    scope: { projectId: string; select?: (id: string) => void },
  ) {
    const renderSlot = vi.fn(
      (
        _key: string,
        owner: { projectId: string; revisionClusterId?: string },
      ) => (
        <p>{`sections [${owner.projectId}] [${owner.revisionClusterId ?? ""}]`}</p>
      ),
    );
    const value = {
      t,
      navigate: () => {},
      renderSlot,
      insights: remote.insights,
      system: remote.system ?? { pickFiles: vi.fn() },
      useProjectScope: () => ({
        projects: [{ id: PROJECT, title: "长夜" }],
        projectId: scope.projectId,
        select: scope.select ?? (() => {}),
      }),
    } as unknown as InsightsPageProps;
    return { renderSlot, ...render(<InsightsPage {...value} />) };
  }

  it("chooses the project through the app's scope and hands it to the sections", () => {
    const select = vi.fn();
    mount({ insights: {} }, { projectId: "", select });
    expect(screen.getByText("sections [] []")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "feedback.importMetrics" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "page.project" }), {
      target: { value: PROJECT },
    });
    expect(select).toHaveBeenCalledWith(PROJECT);
  });

  it("previews an import and writes it only on confirmation", async () => {
    const feedbackDashboard = vi.fn(() => ok(dashboard()));
    const feedbackPreview = vi.fn(() =>
      ok({
        importId: "44444444-4444-4444-8444-444444444444",
        projectId: PROJECT,
        kind: "metrics",
        sourceName: "指标.csv",
        validCount: 2,
        warnings: ["row 3 has an unknown column", "第 4 行缺少数值"],
        sample: [{ name: "完播率", value: 0.4 }],
        expiresAt: "2026-10-29T00:00:00.000Z",
      }),
    );
    const feedbackCommit = vi.fn(() =>
      ok({ ...dashboard().batches[0], kind: "metrics", rowCount: 2 }),
    );
    const pickFiles = vi.fn(() => ok([{ grantId: "grant-1" }]));
    mount(
      {
        insights: { feedbackDashboard, feedbackPreview, feedbackCommit },
        system: { pickFiles },
      },
      { projectId: PROJECT },
    );
    await screen.findByText("评论.csv");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "feedback.importMetrics" }),
      );
    });
    expect(pickFiles).toHaveBeenCalledWith({
      multiple: false,
      extensions: ["csv", "json"],
    });
    expect(feedbackPreview).toHaveBeenCalledWith(
      { projectId: PROJECT, kind: "metrics", capabilityToken: "grant-1" },
      undefined,
      expect.any(String),
    );
    expect(screen.getByText("feedback.preview.review")).toBeTruthy();
    expect(screen.getByText("第 4 行缺少数值")).toBeTruthy();
    expect(feedbackCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "feedback.preview.commit" }),
      );
    });
    expect(feedbackCommit).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      { projectId: PROJECT },
      undefined,
      expect.any(String),
    );
    expect(
      screen.getByText(
        'feedback.committed({"count":2,"kind":"feedback.kind.metrics"})',
      ),
    ).toBeTruthy();
    expect(feedbackDashboard).toHaveBeenCalledTimes(2);
  });

  it("clusters a comment batch and hands a cluster to the revision sections", async () => {
    let clusters = 0;
    const feedbackDashboard = vi.fn(() => ok(dashboard(clusters)));
    const feedbackCluster = vi.fn(() => {
      clusters = 1;
      return ok(dashboard(1).clusters);
    });
    mount(
      { insights: { feedbackDashboard, feedbackCluster } },
      { projectId: PROJECT },
    );
    const organise = await screen.findByRole("button", {
      name: "feedback.batch.cluster",
    });
    await act(async () => {
      fireEvent.click(organise);
    });
    expect(feedbackCluster).toHaveBeenCalledWith(
      { projectId: PROJECT, batchId: BATCH },
      undefined,
      expect.any(String),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "feedback.cluster.revise" }),
    );
    expect(screen.getByText(`sections [${PROJECT}] [${CLUSTER}]`)).toBeTruthy();
  });

  it("names a failed read and a cancelled pick without stale state", async () => {
    const pickFiles = vi.fn(() => ok(null));
    mount(
      {
        insights: { feedbackDashboard: () => failed("未找到项目。") },
        system: { pickFiles },
      },
      { projectId: PROJECT },
    );
    expect(
      await screen.findByText('feedback.failed({"message":"未找到项目。"})'),
    ).toBeTruthy();
    expect(screen.getByText("feedback.batches.empty")).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "feedback.importComments" }),
      );
    });
    expect(screen.queryByText(/feedback\.preview\.title/u)).toBeNull();
  });
});

describe("preview samples", () => {
  it("reads metric and comment rows, and anything else as one row", () => {
    expect(sampleText({ name: "完播率", value: 0.4 }, "metrics", t)).toBe(
      'feedback.sample.metric({"name":"完播率","value":"0.4"})',
    );
    expect(sampleText({ content: "好看" }, "comments", t)).toBe(
      'feedback.sample.comment({"content":"好看"})',
    );
    expect(sampleText([1], "comments", t)).toBe("feedback.sample.other");
  });
});
