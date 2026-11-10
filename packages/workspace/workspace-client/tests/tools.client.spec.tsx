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
import { zh } from "../src/client/locale.ts";
import { CreatorChannelTool } from "../src/client/tools/CreatorChannelTool.tsx";
import {
  PersonalTheaterTool,
  type ToolProps,
} from "../src/client/tools/PersonalTheaterTool.tsx";
import { PilotTool, pilotNextStep } from "../src/client/tools/PilotTool.tsx";
import { SeriesLibraryTool } from "../src/client/tools/SeriesLibraryTool.tsx";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"workspace">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const PROJECT = "11111111-1111-4111-8111-111111111111";

function subject(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    projectId: PROJECT,
    displayName: "小明",
    relationship: "minor",
    ageBand: "under_14",
    consentStatus: "missing",
    version: 0,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    ...overrides,
  };
}

function props(remotes: Partial<ToolProps>) {
  const renderFactorySlot = vi.fn(() => null);
  return {
    renderFactorySlot,
    props: {
      projectId: PROJECT,
      record: {},
      t,
      renderFactorySlot,
      workspace: {},
      media: {},
      writing: {},
      knowledge: {},
      system: {},
      automation: {},
      ...remotes,
    } as unknown as ToolProps,
  };
}

describe("the personal theater tool", () => {
  it("adds a person and records a minor's consent with the guardian and under-14 confirmations", async () => {
    let subjects = [subject()];
    const media = {
      likenessSubjectsList: vi.fn(() => ok(subjects)),
      likenessSubjectsCreate: vi.fn(() => ok(subject({ id: "s2" }))),
      likenessSubjectsConsent: vi.fn(() => {
        subjects = [subject({ consentStatus: "active" })];
        return ok(subjects[0]);
      }),
    };
    const { props: tool, renderFactorySlot } = props({
      media: media as never,
    });
    render(<PersonalTheaterTool {...tool} />);
    expect(await screen.findByText("小明")).toBeTruthy();
    expect(
      screen.getByText("未成年人 · 未满 14 岁 · 授权：未授权"),
    ).toBeTruthy();
    expect(renderFactorySlot).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("人物名称"), {
      target: { value: " 小红 " },
    });
    fireEvent.change(screen.getByLabelText("人物关系"), {
      target: { value: "minor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加人物" }));
    await waitFor(() =>
      expect(media.likenessSubjectsCreate).toHaveBeenCalledWith(
        PROJECT,
        {
          displayName: "小红",
          relationship: "minor",
          ageBand: "minor_14_to_17",
        },
        undefined,
        undefined,
      ),
    );
    expect(await screen.findByRole("status")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认授权" }));
    await waitFor(() =>
      expect(media.likenessSubjectsConsent).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          purposeScopes: ["本项目故事、分镜与人工确认的参考图生成"],
          participantConfirmed: true,
          guardianConfirmed: true,
          under14SeparateConsentConfirmed: true,
        }),
        undefined,
        undefined,
      ),
    );
    await waitFor(() =>
      expect(renderFactorySlot).toHaveBeenCalledWith(
        "automation.creation-workbench",
        expect.objectContaining({ projectId: PROJECT, operation: "episode" }),
      ),
    );
  });

  it("attaches a photo through a Host file grant and says when the list fails", async () => {
    const media = {
      likenessSubjectsList: vi.fn(() =>
        ok([subject({ ageBand: "adult", consentStatus: "active" })]),
      ),
      likenessSubjectsAttachPhoto: vi.fn(() => ok({})),
    };
    const system = {
      pickFiles: vi.fn(() => ok([{ grantId: "g1", name: "a.png" }])),
    };
    const { props: tool } = props({
      media: media as never,
      system: system as never,
    });
    render(<PersonalTheaterTool {...tool} />);
    fireEvent.click(await screen.findByRole("button", { name: "附加照片" }));
    await waitFor(() =>
      expect(media.likenessSubjectsAttachPhoto).toHaveBeenCalledWith(
        "s1",
        { grantId: "g1" },
        undefined,
        undefined,
      ),
    );
    expect(system.pickFiles).toHaveBeenCalledWith({
      multiple: false,
      extensions: ["png", "jpg", "jpeg", "webp"],
    });

    cleanup();
    const broken = {
      likenessSubjectsList: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: "x", message: "读取失败" },
        }),
      ),
    };
    render(
      <PersonalTheaterTool {...props({ media: broken as never }).props} />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("读取失败");
    expect(screen.getByText("先添加小剧场人物")).toBeTruthy();
  });
});

describe("the creator channel tool", () => {
  it("counts this project's positioning, topics and research and starts research in its risk domain", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const workspace = {
      projectsGet: vi.fn(() =>
        ok({
          id: PROJECT,
          modeConfig: { mode: "creator_channel", riskDomain: "finance" },
        }),
      ),
    };
    const writing = {
      creatorProfileList: vi.fn(() =>
        ok({
          items: [
            { projectId: PROJECT, title: "宏观财经" },
            { projectId: other, title: "别的项目" },
          ],
        }),
      ),
      creatorIdeaList: vi.fn(() =>
        ok({ items: [{ projectId: PROJECT, title: "利率" }] }),
      ),
      creatorIdeaCreate: vi.fn(() => ok({})),
    };
    const knowledge = {
      researchTopicsList: vi.fn(() => ok({ items: [] })),
      researchTopicsCreate: vi.fn(() => ok({ id: "topic" })),
      researchSearch: vi.fn(() => ok({ fallbackUsed: false })),
    };
    const { props: tool, renderFactorySlot } = props({
      workspace: workspace as never,
      writing: writing as never,
      knowledge: knowledge as never,
    });
    render(<CreatorChannelTool {...tool} />);
    expect(await screen.findByText("宏观财经")).toBeTruthy();
    expect(screen.getByText("1 个选题")).toBeTruthy();
    expect(screen.getByText("0 个专题")).toBeTruthy();
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "automation.creation-workbench",
      expect.objectContaining({ operation: "creator-content" }),
    );

    fireEvent.change(screen.getByLabelText("新增内容选题"), {
      target: { value: "通胀" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存选题" }));
    await waitFor(() =>
      expect(writing.creatorIdeaCreate).toHaveBeenCalledWith(
        { projectId: PROJECT, title: "通胀", payload: {} },
        undefined,
        undefined,
      ),
    );

    fireEvent.change(screen.getByLabelText("公开资料网址（HTTPS）"), {
      target: { value: "https://public.example/economy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "读取资料" }));
    await waitFor(() =>
      expect(knowledge.researchSearch).toHaveBeenCalledWith(
        "topic",
        { query: "https://public.example/economy" },
        undefined,
        undefined,
      ),
    );
    expect(knowledge.researchTopicsCreate).toHaveBeenCalledWith(
      PROJECT,
      {
        title: "public.example",
        query: "https://public.example/economy",
        riskDomain: "finance",
      },
      undefined,
      undefined,
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "已通过 curl",
    );
  });
});

describe("the series library tool", () => {
  it("creates and joins a series, then adds a setting and links a locked asset version", async () => {
    let library: Record<string, unknown> = {
      projectId: PROJECT,
      storyBible: [],
      assets: [],
    };
    const series = { id: "series-1", title: "雨夜系列", version: 1 };
    const workspace = {
      seriesList: vi.fn(() => ok([])),
      seriesLibrary: vi.fn(() => ok(library)),
      projectsList: vi.fn(() =>
        ok([{ id: PROJECT, title: "本项目", seriesId: "series-1" }]),
      ),
      seriesCreate: vi.fn(() => ok(series)),
      seriesSetProjectSeries: vi.fn(() => {
        library = { ...library, series };
        return ok({});
      }),
      seriesCreateStoryBible: vi.fn(() => ok({ id: "bible-1", version: 2 })),
      seriesUpgradeStoryBible: vi.fn(() => ok({})),
      seriesTransferAsset: vi.fn(() => ok({})),
    };
    const media = {
      visualAssetsList: vi.fn(() =>
        ok([{ id: "asset-1", title: "主角定妆", version: 3 }]),
      ),
    };
    render(
      <SeriesLibraryTool
        {...props({ workspace: workspace as never, media: media as never })
          .props}
      />,
    );
    const library$ = await screen.findByTestId("series-library");
    expect(screen.getByRole("heading", { name: "系列资产库" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建系列并加入" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "请填写系列名称。",
    );
    fireEvent.change(screen.getByLabelText("新系列名称"), {
      target: { value: "雨夜系列" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新建系列并加入" }));
    expect(await screen.findByText("当前系列：雨夜系列")).toBeTruthy();
    expect(workspace.seriesSetProjectSeries).toHaveBeenCalledWith(
      PROJECT,
      { seriesId: "series-1" },
      undefined,
      undefined,
    );
    expect(library$.textContent).toContain("已创建并加入「雨夜系列」。");

    fireEvent.change(screen.getByLabelText("系列设定标题"), {
      target: { value: "世界观" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增系列设定" }));
    await waitFor(() =>
      expect(workspace.seriesUpgradeStoryBible).toHaveBeenCalledWith(
        PROJECT,
        "bible-1",
        { sourceVersion: 2 },
        undefined,
        undefined,
      ),
    );
    expect(workspace.seriesCreateStoryBible).toHaveBeenCalledWith(
      "series-1",
      { title: "世界观", payload: { 说明: "待补充" } },
      undefined,
      undefined,
    );

    fireEvent.click(screen.getByRole("button", { name: "Link 固定版本" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "请选择已锁定、权利已核验的源资产版本。",
    );
    fireEvent.change(screen.getByLabelText("源资产版本"), {
      target: { value: "asset-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link 固定版本" }));
    await waitFor(() =>
      expect(workspace.seriesTransferAsset).toHaveBeenCalledWith(
        PROJECT,
        { sourceAssetId: "asset-1", sourceVersion: 3, mode: "link" },
        undefined,
        undefined,
      ),
    );
  });
});

describe("the pilot tool", () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    id: "plan-1",
    projectId: PROJECT,
    chapterIds: ["c1", "c2"],
    episodeCount: 2,
    status: "active",
    stage: "confirm-source",
    sourceConfirmed: false,
    episodeIds: [],
    coverage: { episodes: 0, scripts: 0, scenes: 0, shots: 0, assets: 0 },
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    ...overrides,
  });
  const chapters = [
    { id: "c1", projectId: PROJECT, title: "第一章" },
    { id: "c2", projectId: PROJECT, title: "第二章" },
  ];

  it("checks the first chapter, creates a plan of the chosen size and confirms its source", async () => {
    let plans: unknown[] = [];
    const automation = {
      pilotPlansList: vi.fn(() => ok(plans)),
      pilotPlansCreate: vi.fn(() => {
        plans = [plan()];
        return ok(plans[0]);
      }),
      pilotPlansAction: vi.fn(() => {
        plans = [
          plan({
            stage: "script",
            sourceConfirmed: true,
            adaptationId: "a1",
            episodeIds: ["e1", "e2"],
          }),
        ];
        return ok(plans[0]);
      }),
    };
    const writing = { chaptersList: vi.fn(() => ok(chapters)) };
    const { props: tool, renderFactorySlot } = props({
      automation: automation as never,
      writing: writing as never,
    });
    render(<PilotTool {...tool} />);
    const wizard = await screen.findByLabelText("试制向导");
    const sources = await screen.findAllByRole("checkbox");
    expect(sources).toHaveLength(2);
    await waitFor(() => expect(sources[0]!).toHaveProperty("checked", true));
    fireEvent.click(sources[1]!);
    fireEvent.change(screen.getByRole("combobox", { name: "试制集数" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立试制计划" }));
    await waitFor(() =>
      expect(automation.pilotPlansCreate).toHaveBeenCalledWith(
        { projectId: PROJECT, chapterIds: ["c1", "c2"], episodeCount: 2 },
        undefined,
        undefined,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "确认来源并生成首集" }),
    );
    expect(await screen.findByText("当前阶段：采用试制剧本")).toBeTruthy();
    expect(wizard.textContent).toContain("2 集试制");
    expect(
      screen.getByRole("link", { name: "前往唯一待办" }).getAttribute("href"),
    ).toBe(
      `#/adapt?projectId=${PROJECT}&adaptationId=a1&episodeId=e1&stage=scripts`,
    );
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "automation.creation-record",
      expect.objectContaining({
        targetId: "e1",
        domain: "episodes",
        sourceIds: ["c1", "c2"],
        operation: "episode",
      }),
    );
  });

  it("names the next step of every stage, none before the source is confirmed", () => {
    const base = plan({ episodeIds: ["e1"] }) as never;
    expect(pilotNextStep(base)).toBeUndefined();
    expect(
      pilotNextStep({ ...(base as object), stage: "assets" } as never),
    ).toBe(`/produce?projectId=${PROJECT}&episodeId=e1&stage=visual-assets`);
    expect(
      pilotNextStep({ ...(base as object), stage: "review" } as never),
    ).toBe(`/review?projectId=${PROJECT}&episodeId=e1&stage=quality`);
  });
});
