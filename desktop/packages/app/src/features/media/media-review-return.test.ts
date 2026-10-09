import { expect, test } from "bun:test";
import type { StudioClient } from "@dramaip/client";
import {
  mediaReviewRequest,
  readMediaReviewReturn,
} from "./media-review-return";
const projectId = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const sourceId = "10000000-0000-4000-8000-000000000003";
const other = "10000000-0000-4000-8000-000000000004";
const path = (kind: string, extra: Record<string, string> = {}) =>
  `?${new URLSearchParams({ projectId, [kind]: id, ...extra })}`;

test("媒体精确入口要求唯一有效身份，不回退默认项目／最新候选", () => {
  expect(mediaReviewRequest("?projectId=anything")).toBeUndefined();
  expect(mediaReviewRequest(path("audioRevisionId"))).toMatchObject({
    id,
    projectId,
    kind: "audioRevisionId",
  });
  for (const search of [
    "?audioRevisionId=bad",
    path("audioRevisionId", { audioResolutionId: id }),
    `${path("audioRevisionId")}&audioRevisionId=${id}`,
    path("audioRevisionId", { episodeId: "bad" }),
    `${path("audioRevisionId")}&projectId=${projectId}`,
  ])
    expect(() => mediaReviewRequest(search)).toThrow();
});

test("实际身份错误立即阻止下游读取，不把外项目正文或最新音轨当作指定对象", async () => {
  let downstream = 0;
  const client = {
    projects: { list: async () => [{ id: projectId }] },
    audioRevisions: {
      get: async () => ({
        id,
        projectId,
        episodeId: sourceId,
        sourceTrackId: sourceId,
      }),
    },
    mediaSources: {
      get: async () => ({ id, projectId: other, recordId: sourceId }),
    },
    episodeMedia: {
      listAudioTracks: async () => {
        downstream++;
        return [{ id: other, projectId, episodeId: sourceId }];
      },
    },
    resources: {
      get: async () => {
        downstream++;
        throw new Error("should not read");
      },
    },
  } as unknown as StudioClient;
  await expect(
    readMediaReviewReturn(client, path("mediaSourceReviewId")),
  ).rejects.toThrow("不属于入口");
  await expect(
    readMediaReviewReturn(
      client,
      path("audioRevisionId", { sourceTrackId: other }),
    ),
  ).rejects.toThrow("不属于入口");
  expect(downstream).toBe(0);
  await expect(
    readMediaReviewReturn(client, path("audioRevisionId")),
  ).rejects.toThrow("实际原音轨不可用");
  expect(downstream).toBe(1);
});

test("返回时间线预览只读实际 options 和指定记录，不调用可能创建时间线的 get", async () => {
  const calls: string[] = [];
  const review = {
    id,
    projectId,
    episodeId: sourceId,
    timelineId: sourceId,
    before: { id: sourceId, projectId, episodeId: sourceId },
  };
  const client = {
    projects: { list: async () => [{ id: projectId }] },
    audioResolutions: {
      get: async (value: string) => {
        calls.push(`review:${value}`);
        return review;
      },
      options: async (value: string) => {
        calls.push(`options:${value}`);
        return { timelineId: value };
      },
    },
    timeline: {
      get: async () => {
        throw new Error("must never create");
      },
    },
  } as unknown as StudioClient;
  expect(
    await readMediaReviewReturn(
      client,
      path("audioResolutionId", { timelineId: sourceId }),
    ),
  ).toMatchObject({ kind: "resolution", review });
  expect(calls).toEqual([`review:${id}`, `options:${sourceId}`]);
  await expect(
    readMediaReviewReturn(
      client,
      path("audioResolutionId", { timelineId: other }),
    ),
  ).rejects.toThrow("不属于入口");
  expect(calls).toHaveLength(3);
});
