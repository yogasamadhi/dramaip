import { expect, test } from "vitest";
import { loadDirectScriptCockpitEvidence } from "./direct-script-cockpit-evidence";

type Client = Parameters<typeof loadDirectScriptCockpitEvidence>[0];
function client() {
  const calls: string[] = [];
  const list = async (_id: string, cursor?: string) => ({
    items: [{ id: cursor ?? "new", projectId: "project" }],
    ...(cursor ? {} : { nextCursor: "old" }),
  });
  const api = {
    authorIntents: {
      current: async () => {
        calls.push("intent");
        return { current: { projectId: "project" } };
      },
    },
    episodeDevelopments: {
      sources: async () => {
        calls.push("sources");
        return {
          projectId: "project",
          direct: { project: { id: "project" } },
          currentResults: [],
        };
      },
      list: async (id: string, cursor?: string) => {
        calls.push(`episodes:${cursor ?? "first"}`);
        return list(id, cursor);
      },
    },
    creation: {
      list: async (id: string, targetId?: string, cursor?: string) => {
        expect(targetId).toBeUndefined();
        calls.push(`workflows:${cursor ?? "first"}`);
        const page = await list(id, cursor);
        return {
          ...page,
          items: page.items.map((item) => ({
            ...item,
            input: { projectId: "project" },
          })),
        };
      },
    },
    pilotPackages: {
      list: async (id: string, cursor?: string) => {
        calls.push(`packages:${cursor ?? "first"}`);
        const page = await list(id, cursor);
        return {
          ...page,
          items: page.items.map((item) => ({
            ...item,
            manifest: { projectId: "project" },
          })),
        };
      },
    },
  } as unknown as Client;
  return { api, calls };
}

test("直写只读 SDK 核全历史、运行与内部包分页，不调用小说、诊断、季纲或模型", async () => {
  const c = client();
  const result = await loadDirectScriptCockpitEvidence(c.api, "project");
  for (const domain of ["episodes", "workflows", "packages"] as const)
    expect(result[domain].map((item) => item.id)).toEqual(["new", "old"]);
  expect(c.calls.sort()).toEqual([
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

test("分页游标循环、重复对象、跨项目或读取失败拒绝整个直写投影", async () => {
  const c = client().api;
  c.episodeDevelopments.list = async () => ({ items: [], nextCursor: "loop" });
  await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
    "分页游标重复",
  );
  c.episodeDevelopments.list = async () => ({
    items: [{ id: "duplicate", projectId: "project" }] as never,
    nextCursor: "next",
  });
  await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
    "分页对象重复",
  );
  c.episodeDevelopments.list = async () => ({
    items: [{ id: "other", projectId: "other" }] as never,
  });
  await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
    "归属不一致",
  );
  c.episodeDevelopments.list = async () => {
    throw new Error("真实读取失败");
  };
  await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
    "真实读取失败",
  );
});

test("目录、意图与目录内正式头的归属全部核验", async () => {
  for (const value of [
    { projectId: "other", currentResults: [] },
    {
      projectId: "project",
      direct: { project: { id: "other" } },
      currentResults: [],
    },
    { projectId: "project", currentResults: [{ projectId: "other" }] },
  ]) {
    const c = client().api;
    c.episodeDevelopments.sources = async () => value as never;
    await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
      "归属不一致",
    );
  }
  const c = client().api;
  c.authorIntents.current = async () =>
    ({ current: { projectId: "other" } }) as never;
  await expect(loadDirectScriptCockpitEvidence(c, "project")).rejects.toThrow(
    "归属不一致",
  );
});
