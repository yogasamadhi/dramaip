import { expect, test } from "bun:test";
import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";
import {
  matchesExactEpisodeResult,
  productionReferencesForEpisodeResult,
} from "./formal-source-navigation";

test("精确正式结果核对全部身份，不把历史、人工确认或错误链接替换为最近候选", () => {
  const value = {
    id: "original",
    projectId: "project",
    episodeId: "episode",
    operation: "episode-script",
    workflowId: "run",
    sourceState: "stale",
    isCurrent: false,
  } as EpisodeDevelopmentResult;
  const exact = {
    projectId: "project",
    resultId: "original",
    episodeId: "episode",
    operation: "episode-script",
    workflowId: "run",
  };
  expect(matchesExactEpisodeResult(value, exact)).toBe(true);
  for (const [key, changed] of Object.entries({
    projectId: "other",
    resultId: "latest",
    episodeId: "other-episode",
    operation: "storyboard-package",
    workflowId: "latest-run",
  }))
    expect(matchesExactEpisodeResult(value, { ...exact, [key]: changed })).toBe(
      false,
    );
  expect(matchesExactEpisodeResult(undefined, exact)).toBe(false);
  const human = {
    ...value,
    origin: "human-script-revision",
    workflowId: undefined,
  } as EpisodeDevelopmentResult;
  expect(
    matchesExactEpisodeResult(human, { ...exact, workflowId: undefined }),
  ).toBe(true);
  expect(matchesExactEpisodeResult(human, exact)).toBe(false);
});

test("正式分集只通过实际生产记录引用转入工作区，稳定键与候选不冒充 UUID", () => {
  const value = {
    projectId: "project",
    episodeId: "stable-episode-key",
    episodeRecordId: "actual-episode",
    scriptId: "actual-script",
  } as EpisodeDevelopmentResult;
  expect(productionReferencesForEpisodeResult(value, "project")).toEqual({
    episodeId: "actual-episode",
    scriptId: "actual-script",
  });
  expect(
    productionReferencesForEpisodeResult(value, "foreign"),
  ).toBeUndefined();
  expect(
    productionReferencesForEpisodeResult(
      { ...value, episodeRecordId: undefined },
      "project",
    ),
  ).toBeUndefined();
});
