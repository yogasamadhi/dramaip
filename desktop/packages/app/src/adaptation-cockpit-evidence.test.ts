import { expect, test } from "vitest";
import { loadAdaptationCockpitEvidence } from "./adaptation-cockpit-evidence";

type Client = Parameters<typeof loadAdaptationCockpitEvidence>[0];
function client() {
  const list = async (_id: string, cursor?: string) => ({
    items: [{ id: cursor ?? "new", projectId: "project" }],
    ...(cursor ? {} : { nextCursor: "old" }),
  });
  return {
    authorIntents: {
      current: async () => ({ current: { projectId: "project" } }),
    },
    diagnoses: { sources: async () => ({ projectId: "project" }), list },
    seasonPlans: { list },
    episodeDevelopments: { list },
    creation: {
      list: async (_id: string, targetId?: string, cursor?: string) => {
        expect(targetId).toBeUndefined();
        const page = await list(_id, cursor);
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
      list: async (_id: string, cursor?: string) => {
        const page = await list(_id, cursor);
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
}

test("改编驾驶舱核全各领域分页，不用最新一页或目录代替版本链", async () => {
  const result = await loadAdaptationCockpitEvidence(client(), "project");
  for (const domain of [
    "diagnoses",
    "plans",
    "episodes",
    "workflows",
    "packages",
  ] as const)
    expect(result[domain].map((item) => item.id)).toEqual(["new", "old"]);
});

test("跨项目、游标循环或读取失败拒绝整个投影，不伪造已完成", async () => {
  const c = client();
  c.seasonPlans.list = async () => ({ items: [], nextCursor: "loop" });
  await expect(loadAdaptationCockpitEvidence(c, "project")).rejects.toThrow(
    "分页游标重复",
  );
  c.seasonPlans.list = async () => ({
    items: [{ projectId: "other" }] as never,
  });
  await expect(loadAdaptationCockpitEvidence(c, "project")).rejects.toThrow(
    "归属不一致",
  );
  c.seasonPlans.list = async () => {
    throw new Error("真实读取失败");
  };
  await expect(loadAdaptationCockpitEvidence(c, "project")).rejects.toThrow(
    "真实读取失败",
  );
  const other = client();
  other.diagnoses.sources = async () => ({ projectId: "other" }) as never;
  await expect(loadAdaptationCockpitEvidence(other, "project")).rejects.toThrow(
    "归属不一致",
  );
});
