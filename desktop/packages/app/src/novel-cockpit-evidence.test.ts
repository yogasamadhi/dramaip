import { expect, test } from "bun:test";
import type { StudioClient } from "@dramaip/client";
import { loadNovelCockpitEvidence } from "./novel-cockpit-evidence";

type EvidenceClient = Pick<
  StudioClient,
  "chapters" | "creation" | "resources" | "manuscripts"
>;

test("小说驾驶舱读取全部实际分页，不以前 25 次工作流或 50 次采用代表全书", async () => {
  const calls: string[] = [];
  const client = {
    manuscripts: {
      list: async (_id: string, cursor?: string) => ({
        items: [{ id: cursor ? "old-manuscript" : "new-manuscript" }],
        ...(cursor ? {} : { nextCursor: "manuscript-page-2" }),
      }),
    },
    chapters: {
      adoptions: async (projectId: string, cursor?: string) => {
        calls.push(`adoptions:${projectId}:${cursor ?? "first"}`);
        return {
          items: [{ workflowId: cursor ? "old-adoption" : "new-adoption" }],
          ...(cursor ? {} : { nextCursor: "adoption-page-2" }),
        };
      },
    },
    creation: {
      list: async (projectId: string, targetId?: string, cursor?: string) => {
        expect(targetId).toBeUndefined();
        calls.push(`workflows:${projectId}:${cursor ?? "first"}`);
        return {
          items: [{ id: cursor ? "old-pending" : "new-workflow" }],
          ...(cursor ? {} : { nextCursor: "workflow-page-2" }),
        };
      },
    },
    resources: {
      list: async (domain: string, projectId: string) => {
        calls.push(`${domain}:${projectId}`);
        return [{ domain }];
      },
    },
  } as unknown as EvidenceClient;
  const result = await loadNovelCockpitEvidence(client, "project-1");
  expect(result.adoptions.map((item) => item.workflowId)).toEqual([
    "new-adoption",
    "old-adoption",
  ]);
  expect(result.workflows.map((item) => item.id)).toEqual([
    "new-workflow",
    "old-pending",
  ]);
  expect(result.manuscripts?.map((item) => item.id)).toEqual([
    "new-manuscript",
    "old-manuscript",
  ]);
  expect(result.memories.map((item) => item.domain)).toEqual([
    "chapter-memories",
    "character-states",
    "story-events",
    "foreshadowings",
  ]);
  expect(calls).toContain("adoptions:project-1:adoption-page-2");
  expect(calls).toContain("workflows:project-1:workflow-page-2");
});

test("分页循环或读取失败不能被替换成零计数或已核验", async () => {
  const client = {
    manuscripts: { list: async () => ({ items: [] }) },
    chapters: {
      adoptions: async () => ({ items: [], nextCursor: "repeated" }),
    },
    creation: { list: async () => ({ items: [] }) },
    resources: { list: async () => [] },
  } as unknown as EvidenceClient;
  await expect(loadNovelCockpitEvidence(client, "project-1")).rejects.toThrow(
    "分页游标重复",
  );
  client.chapters.adoptions = async () => {
    throw new Error("Runtime 状态不可用");
  };
  await expect(loadNovelCockpitEvidence(client, "project-1")).rejects.toThrow(
    "Runtime 状态不可用",
  );
});
