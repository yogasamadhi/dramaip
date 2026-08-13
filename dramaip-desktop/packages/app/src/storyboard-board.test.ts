import { expect, test } from "bun:test";
import type { AssetCenterAsset, DomainEntity } from "@sdns/schema";
import { buildStoryboard, reorderStoryboardShots } from "./storyboard-board";

const entity = (
  id: string,
  domain: string,
  parentId?: string,
  payload: unknown = {},
): DomainEntity =>
  ({
    id,
    domain,
    parentId,
    projectId: "project-1",
    title: id,
    payload,
    version: 1,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }) as DomainEntity;

const asset = (id: string, category: AssetCenterAsset["category"]) =>
  ({
    id,
    title: id,
    category,
    subject: id,
    assetVersion: "v1",
    adopted: true,
    lockStatus: "locked",
    stale: false,
    preview: { kind: "none", status: "unattached" },
    rightsStatus: "verified",
    costStatus: "known",
    providerStatus: "not-required",
    usages: [],
    version: 1,
  }) as AssetCenterAsset;

test("导演看板从权威层级、资产引用和静帧状态派生卡片", () => {
  const board = buildStoryboard({
    episodeId: "episode-1",
    scripts: [entity("script-1", "scripts", "episode-1")],
    scenes: [
      entity("scene-2", "scenes", "script-1", { 排序: 2 }),
      entity("scene-1", "scenes", "script-1", {
        排序: 1,
        地点与时间: "雨夜门口",
      }),
    ],
    shots: [
      entity("shot-2", "shots", "scene-1", { 排序: 2 }),
      entity("shot-1", "shots", "scene-1", {
        排序: 1,
        镜头描述: "门缝特写",
        对白: "你终于来了。",
        景别: "特写",
        运镜: "推镜",
        时长: "3 秒",
        资产版本引用: ["character-1", "voice-1"],
      }),
    ],
    stills: [
      entity("still-1", "shot-stills", "shot-1", { 采用状态: "已采用" }),
    ],
    assets: [asset("character-1", "character"), asset("voice-1", "voice")],
  });
  expect(board.map((scene) => scene.id)).toEqual(["scene-1", "scene-2"]);
  expect(board[0]?.location).toBe("雨夜门口");
  expect(board[0]?.shots.map((shot) => shot.id)).toEqual(["shot-1", "shot-2"]);
  expect(board[0]?.shots[0]).toMatchObject({
    stillState: "adopted",
    lockedAssetCount: 2,
    missingAssetReference: false,
    categoryCounts: { character: 1, scene: 0, prop: 0, voice: 1 },
  });
  expect(board[0]?.shots[1]?.missingAssetReference).toBe(true);
});

test("100+ 分镜 fixture 保持稳定排序并可局部重排", () => {
  const board = buildStoryboard({
    episodeId: "episode-1",
    scripts: [entity("script-1", "scripts", "episode-1")],
    scenes: [entity("scene-1", "scenes", "script-1")],
    shots: Array.from({ length: 120 }, (_, index) =>
      entity(`shot-${index + 1}`, "shots", "scene-1", {
        排序: index + 1,
        镜头描述: `第 ${index + 1} 个镜头`,
      }),
    ),
    stills: [],
    assets: [],
  });
  const shots = board[0]?.shots ?? [];
  const reordered = reorderStoryboardShots(shots, "shot-120", "shot-1");
  expect(shots).toHaveLength(120);
  expect(reordered).toHaveLength(120);
  expect(reordered[0]?.id).toBe("shot-120");
  expect(reordered[1]?.id).toBe("shot-1");
});
