import { expect, test } from "vitest";
import {
  loadAdaptationCockpitEvidence,
  loadDirectScriptCockpitEvidence,
  loadNovelCockpitEvidence,
  type EvidenceRemotes,
} from "../src/client/cockpit/evidence.ts";

type Query = { cursor?: string; limit?: number } | undefined;
type Item = Record<string, unknown>;

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const failed = (message: string) =>
  Promise.resolve({ ok: false, error: { code: "test", message } });

/** Two pages: `new` then `old`, each item shaped by `shape`. */
const paged =
  (calls: string[], name: string, shape: (id: string) => Item) =>
  (_id: string, query?: Query) => {
    calls.push(`${name}:${query?.cursor ?? "first"}`);
    expect(query?.limit).toBe(100);
    const cursor = query?.cursor;
    return ok({
      items: [shape(cursor ?? "new")],
      ...(cursor ? {} : { nextCursor: "old" }),
    });
  };

function remotes() {
  const calls: string[] = [];
  const own = (id: string) => ({ id, projectId: "project" });
  const fake = {
    workspace: {
      authorIntentsCurrent: () => {
        calls.push("intent");
        return ok({ current: { projectId: "project" } });
      },
    },
    writing: {
      chaptersAdoptions: paged(calls, "adoptions", (id) => ({
        workflowId: id,
      })),
    },
    knowledge: Object.fromEntries(
      [
        ["chapterMemoriesList", "chapter-memories"],
        ["characterStatesList", "character-states"],
        ["storyEventsList", "story-events"],
        ["foreshadowingsList", "foreshadowings"],
      ].map(([method, domain]) => [
        method,
        (query: { projectId: string }) => {
          calls.push(`${domain}:${query.projectId}`);
          return ok([{ domain }]);
        },
      ]),
    ),
    automation: {
      creationList: (query: { projectId: string; cursor?: string }) => {
        calls.push(`workflows:${query.cursor ?? "first"}`);
        return ok({
          items: [
            {
              id: query.cursor ?? "new",
              input: { projectId: query.projectId },
            },
          ],
          ...(query.cursor ? {} : { nextCursor: "old" }),
        });
      },
    },
    production: {
      diagnosesSources: () => ok({ projectId: "project" }),
      diagnosesList: paged(calls, "diagnoses", own),
      seasonPlansList: paged(calls, "plans", own),
      adaptationStrategiesList: paged(calls, "strategies", own),
      episodeDevelopmentsList: paged(calls, "episodes", own),
      episodeDevelopmentsSources: () => {
        calls.push("sources");
        return ok({
          projectId: "project",
          direct: { project: { id: "project" } },
          currentResults: [],
        });
      },
    },
    delivery: {
      manuscriptsList: paged(calls, "manuscripts", (id) => ({ id })),
      pilotPackagesList: paged(calls, "packages", (id) => ({
        id,
        manifest: { projectId: "project" },
      })),
    },
  };
  return { fake, api: fake as unknown as EvidenceRemotes, calls };
}

test("小说驾驶舱读取全部实际分页，不以前一页的工作流或采用代表全书", async () => {
  const { api, calls } = remotes();
  const result = await loadNovelCockpitEvidence(api, "project");
  expect(result.adoptions.map((item) => item.workflowId)).toEqual([
    "new",
    "old",
  ]);
  expect(result.workflows.map((item) => item.id)).toEqual(["new", "old"]);
  expect(result.manuscripts?.map((item) => item.id)).toEqual(["new", "old"]);
  expect(result.memories.map((item) => item.domain)).toEqual([
    "chapter-memories",
    "character-states",
    "story-events",
    "foreshadowings",
  ]);
  expect(calls).toContain("adoptions:old");
  expect(calls).toContain("workflows:old");
});

test("小说分页循环或读取失败不能被替换成零计数或已核验", async () => {
  const { fake, api } = remotes();
  fake.writing.chaptersAdoptions = () =>
    ok({ items: [], nextCursor: "repeated" });
  await expect(loadNovelCockpitEvidence(api, "project")).rejects.toThrow(
    "分页游标重复",
  );
  fake.writing.chaptersAdoptions = () => failed("Runtime 状态不可用") as never;
  await expect(loadNovelCockpitEvidence(api, "project")).rejects.toThrow(
    "Runtime 状态不可用",
  );
});

test("改编驾驶舱核全各领域分页，不用最新一页或目录代替版本链", async () => {
  const { api } = remotes();
  const result = await loadAdaptationCockpitEvidence(api, "project");
  for (const domain of [
    "diagnoses",
    "plans",
    "strategies",
    "episodes",
    "workflows",
    "packages",
  ] as const)
    expect(result[domain]?.map((item) => item.id)).toEqual(["new", "old"]);
});

test("改编跨项目、游标循环或读取失败拒绝整个投影，不伪造已完成", async () => {
  const { fake, api } = remotes();
  fake.production.seasonPlansList = () => ok({ items: [], nextCursor: "loop" });
  await expect(loadAdaptationCockpitEvidence(api, "project")).rejects.toThrow(
    "分页游标重复",
  );
  fake.production.seasonPlansList = () =>
    ok({ items: [{ projectId: "other" }] });
  await expect(loadAdaptationCockpitEvidence(api, "project")).rejects.toThrow(
    "归属不一致",
  );
  fake.production.seasonPlansList = () => failed("真实读取失败") as never;
  await expect(loadAdaptationCockpitEvidence(api, "project")).rejects.toThrow(
    "真实读取失败",
  );
  const other = remotes();
  other.fake.production.diagnosesSources = () => ok({ projectId: "other" });
  await expect(
    loadAdaptationCockpitEvidence(other.api, "project"),
  ).rejects.toThrow("归属不一致");
});

test("直写只读核全历史、运行与内部包分页，不读取小说、诊断或季纲", async () => {
  const { api, calls } = remotes();
  const result = await loadDirectScriptCockpitEvidence(api, "project");
  for (const domain of ["episodes", "workflows", "packages"] as const)
    expect(result[domain].map((item) => item.id)).toEqual(["new", "old"]);
  expect(calls.sort()).toEqual([
    "episodes:first",
    "episodes:old",
    "intent",
    "packages:first",
    "packages:old",
    "sources",
    "workflows:first",
    "workflows:old",
  ]);
});

test("直写分页游标循环、重复对象、跨项目或读取失败拒绝整个投影", async () => {
  const { fake, api } = remotes();
  fake.production.episodeDevelopmentsList = () =>
    ok({ items: [], nextCursor: "loop" });
  await expect(loadDirectScriptCockpitEvidence(api, "project")).rejects.toThrow(
    "分页游标重复",
  );
  fake.production.episodeDevelopmentsList = () =>
    ok({
      items: [{ id: "duplicate", projectId: "project" }],
      nextCursor: "next",
    });
  await expect(loadDirectScriptCockpitEvidence(api, "project")).rejects.toThrow(
    "分页对象重复",
  );
  fake.production.episodeDevelopmentsList = () =>
    ok({ items: [{ id: "other", projectId: "other" }] });
  await expect(loadDirectScriptCockpitEvidence(api, "project")).rejects.toThrow(
    "归属不一致",
  );
  fake.production.episodeDevelopmentsList = () =>
    failed("真实读取失败") as never;
  await expect(loadDirectScriptCockpitEvidence(api, "project")).rejects.toThrow(
    "真实读取失败",
  );
});

test("直写目录、意图与目录内正式头的归属全部核验", async () => {
  for (const sources of [
    { projectId: "other", currentResults: [] },
    {
      projectId: "project",
      direct: { project: { id: "other" } },
      currentResults: [],
    },
    { projectId: "project", currentResults: [{ projectId: "other" }] },
  ]) {
    const { fake, api } = remotes();
    fake.production.episodeDevelopmentsSources = () => ok(sources);
    await expect(
      loadDirectScriptCockpitEvidence(api, "project"),
    ).rejects.toThrow("归属不一致");
  }
  const { fake, api } = remotes();
  fake.workspace.authorIntentsCurrent = () =>
    ok({ current: { projectId: "other" } });
  await expect(loadDirectScriptCockpitEvidence(api, "project")).rejects.toThrow(
    "归属不一致",
  );
});
