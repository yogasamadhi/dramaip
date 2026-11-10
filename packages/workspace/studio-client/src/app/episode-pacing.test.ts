import { expect, test } from "vitest";
import { buildEpisodePacingBoard } from "./episode-pacing";

const entity = (
  id: string,
  version: number,
  payload: Record<string, unknown>,
) => ({
  id,
  domain: "shots",
  projectId: "p",
  title: id,
  payload,
  version,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("集级节奏看板保留来源、四类轨道与人工标记 stale", () => {
  const script = {
    ...entity("script-1", 1, { 剧本内容: "雨夜的选择。" }),
    domain: "scripts",
    parentId: "e",
  };
  const scene = {
    ...entity("scene-1", 1, { 场景动作: "门后传来异响。" }),
    domain: "scenes",
    parentId: "script-1",
  };
  const shot = {
    ...entity("shot-1", 2, {
      镜头序号: 1,
      镜头描述: "主角发现真相，却收到不要回头的短信。",
    }),
    parentId: "scene-1",
  };
  const board = buildEpisodePacingBoard({
    episodeId: "e",
    scripts: [script],
    beats: [],
    scenes: [scene],
    shots: [shot],
    manualMarks: [
      entity("manual", 0, {
        类型: "highlight",
        位置: 1,
        来源标识: "shot-1",
        来源版本: 1,
        依据: "人工确认的爽点",
      }),
    ],
  });
  expect(new Set(board.points.map((point) => point.kind))).toEqual(
    new Set(["density", "highlight", "reversal", "cliffhanger"]),
  );
  expect(board.points.find((point) => point.id === "manual")?.stale).toBe(true);
});

test("按剧本、场景与镜头展开稳定时间轴，并保留已否决人工判断", () => {
  const script = {
    ...entity("script", 1, { 剧本内容: "开场埋下危机。" }),
    domain: "scripts",
    parentId: "episode",
  };
  const scene = {
    ...entity("scene", 1, { 场景序号: 2, 场景动作: "主角决定揭开真相。" }),
    domain: "scenes",
    parentId: "script",
  };
  const shot = {
    ...entity("shot", 1, { 镜头序号: 1, 镜头描述: "门外传来谁的敲门声。" }),
    parentId: "scene",
  };
  const board = buildEpisodePacingBoard({
    episodeId: "episode",
    episode: {
      ...entity("episode", 1, { 分集简介: "暴雨夜的重逢。" }),
      domain: "episodes",
    },
    scripts: [script],
    beats: [],
    scenes: [scene],
    shots: [shot],
    manualMarks: [
      entity("rejected", 1, {
        类型: "highlight",
        位置: 3,
        来源标识: "scene",
        来源版本: 1,
        依据: "编辑否决",
        状态: "已否决",
      }),
    ],
  });
  expect(
    board.points.find((point) => point.id === "density:script")?.position,
  ).toBeLessThan(
    board.points.find((point) => point.id === "density:scene")?.position ??
      Infinity,
  );
  expect(
    board.points.find((point) => point.id === "rejected")?.disposition,
  ).toBe("rejected");
  expect(board.rejectedCount).toBe(1);
});

test("空集不伪造曲线，长分集仍按稳定实体顺序映射", () => {
  const empty = buildEpisodePacingBoard({
    episodeId: "empty",
    scripts: [],
    beats: [],
    scenes: [],
    shots: [],
    manualMarks: [],
  });
  expect(empty.hasSources).toBe(false);
  expect(empty.points).toHaveLength(0);
  const script = {
    ...entity("script-long", 1, { 剧本内容: "短剧开场。" }),
    domain: "scripts",
    parentId: "long",
  };
  const scene = {
    ...entity("scene-long", 1, { 场景动作: "角色持续推进目标。" }),
    domain: "scenes",
    parentId: "script-long",
  };
  const shots = Array.from({ length: 120 }, (_, index) => ({
    ...entity(`shot-${index}`, 1, {
      镜头序号: index + 1,
      镜头描述: `镜头 ${index + 1} 推进冲突。`,
    }),
    parentId: "scene-long",
  }));
  const board = buildEpisodePacingBoard({
    episodeId: "long",
    scripts: [script],
    beats: [],
    scenes: [scene],
    shots,
    manualMarks: [],
  });
  const density = board.points.filter((point) => point.kind === "density");
  expect(density).toHaveLength(122);
  expect(density.at(-1)?.sourceId).toBe("shot-119");
  expect(density.map((point) => point.position)).toEqual(
    Array.from({ length: 122 }, (_, index) => index + 1),
  );
});
