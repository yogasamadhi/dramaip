// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CockpitTool } from "../src/client/cockpit/CockpitTool.tsx";
import { zh } from "../src/client/locale.ts";
import type { ToolProps } from "../src/client/tools/PersonalTheaterTool.tsx";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"workspace">;

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const failed = (message: string) =>
  Promise.resolve({ ok: false, error: { code: "test", message } });
const PROJECT = "10000000-0000-4000-8000-000000000001";

/** A novel project with one chapter and no verified results yet. */
function remotes() {
  const progress = vi.fn(() => ok({}));
  const empty = () => ok({ items: [] });
  return {
    progress,
    remotes: {
      workspace: {
        projectsGet: () =>
          ok({
            id: PROJECT,
            title: "独立小说",
            version: 0,
            mode: "series_longform",
            modeConfig: { mode: "series_longform" },
          }),
        authorIntentsCurrent: () => ok({}),
      },
      writing: {
        chaptersList: () =>
          ok([
            {
              id: "20000000-0000-4000-8000-000000000001",
              projectId: PROJECT,
              title: "第一章",
              orderIndex: 0,
              content: "正文",
              version: 1,
            },
          ]),
        chaptersAdoptions: empty,
      },
      knowledge: {
        chapterMemoriesList: () => ok([]),
        characterStatesList: () => ok([]),
        storyEventsList: () => ok([]),
        foreshadowingsList: () => ok([]),
      },
      automation: {
        tasksList: () => ok([]),
        pilotPlansList: () => ok([]),
        creationList: empty,
      },
      production: {
        graph: () =>
          ok({
            projectId: PROJECT,
            nodes: [],
            edges: [],
            coverage: {
              episodes: 0,
              scripts: 0,
              scenes: 0,
              shots: 0,
              assets: 0,
              stills: 0,
              adoptedStills: 0,
            },
          }),
        projectsProgress: progress,
      },
      delivery: { manuscriptsList: empty },
      media: {},
      system: {},
    },
  };
}

const props = (remotes: object) =>
  ({
    projectId: PROJECT,
    record: {},
    search: "",
    reload: async () => {},
    navigate: () => {},
    t,
    ...remotes,
  }) as unknown as ToolProps;

it("小说项目显示唯一下一步与结果 Gate，不出现改编、制作或试制入口，不读制作进度", async () => {
  const { remotes: fake, progress } = remotes();
  render(<CockpitTool {...props(fake)} />);
  const cockpit = await screen.findByRole("region", { name: "项目驾驶舱" });
  const next = await within(cockpit).findByRole("article", {
    name: "唯一推荐下一步",
  });
  expect(within(next).getByRole("link").getAttribute("href")).toMatch(/^#\//);
  expect(
    await within(cockpit).findByRole("list", { name: "小说结果 Gate" }),
  ).toBeTruthy();
  // A novel project only writes the novel: no adaptation, production or
  // pilot entries anywhere on its cockpit.
  expect(
    within(cockpit).queryByRole("navigation", { name: "项目四区导航" }),
  ).toBeNull();
  expect(
    within(cockpit).queryByRole("link", { name: "打开试制计划" }),
  ).toBeNull();
  expect(
    within(cockpit)
      .queryAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => /adapt|produce|review|pilot/.test(href ?? "")),
  ).toEqual([]);
  expect(progress).not.toHaveBeenCalled();
});

it("证据读取失败时说明未核验，不把缺少证据显示为完成", async () => {
  const { remotes: fake } = remotes();
  fake.writing.chaptersAdoptions = () => failed("采用记录不可用") as never;
  render(<CockpitTool {...props(fake)} />);
  const notice = await screen.findByRole("status");
  expect(notice.textContent).toContain("正式采用与记忆状态暂时无法核验");
  expect(notice.textContent).toContain("采用记录不可用");
});

it("项目图读取失败时只显示失败原因", async () => {
  const { remotes: fake } = remotes();
  fake.production.graph = () => failed("图不可用") as never;
  render(<CockpitTool {...props(fake)} />);
  expect(
    await screen.findByText("项目驾驶舱暂时无法读取真实状态：图不可用"),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "项目驾驶舱" })).toBeNull();
});
