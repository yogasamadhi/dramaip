import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-15/p1-pilot-gate-matrix.json"),
    "utf8",
  ),
) as {
  pilotEpisodeCounts: number[];
  workflows: string[];
  negativeStates: string[];
  requiredElectronSpecs: string[];
};

test("LM6-15 P1 Gate 将 1 / 3 集试制与五项能力的自动证据固定为同一矩阵", () => {
  const serverContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const app = readFileSync(
    join(root, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");
  const evidence = Object.fromEntries(
    fixture.requiredElectronSpecs.map((spec) => [
      spec,
      readFileSync(join(root, "tests/electron", spec), "utf8"),
    ]),
  );

  expect(fixture.pilotEpisodeCounts).toEqual([1, 3]);
  expect(serverContract).toContain("episodeCount: 3");
  expect(serverContract).toContain("coverage.episodes, 3");
  expect(evidence["lm6-10.spec.ts"]).toContain("统一资产中心");
  expect(evidence["lm6-11.spec.ts"]).toContain("导演分镜看板");
  expect(evidence["lm6-12.spec.ts"]).toContain("视频提交");
  expect(evidence["lm6-13.spec.ts"]).toContain("集级节奏看板");
  expect(evidence["lm6-14.spec.ts"]).toContain("Story Bible 侧栏");
  expect(evidence["lm6-15.spec.ts"]).toContain("3 集试制");
  expect(evidence["lm6-p0-gate.spec.ts"]).toContain("1280");
  expect(fixture.workflows).toEqual([
    "asset-lock",
    "storyboard",
    "still-first",
    "episode-pacing",
    "story-bible",
  ]);
  expect(fixture.negativeStates).toEqual([
    "missing-media",
    "rights-expired",
    "cost-unknown",
    "provider-offline",
    "long-list",
    "narrow-viewport",
  ]);
  expect(app).toContain("ProjectPilotPanel");
  expect(app).toContain("StoryBibleSidecar");
  expect(app).toContain("集级节奏看板");
  expect(app).toContain("静帧优先预检");
  expect(server).toContain("VIDEO_NOT_READY");
  expect(server).toContain("静帧确认指纹");
  expect(guide).toContain("卡片式导演分镜看板");
  expect(guide).toContain("静帧优先的视频预检");
  expect(guide).toContain("编辑器旁的 Story Bible 侧栏");
});
