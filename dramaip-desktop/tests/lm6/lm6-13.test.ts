import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-13/episode-pacing-contract.json"),
    "utf8",
  ),
) as { tracks: string[]; states: string[] };

test("LM6-13 锁定四轨、来源版本与人工标记的节奏契约", () => {
  const model = readFileSync(
    join(root, "packages/app/src/episode-pacing.ts"),
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
  fixture.tracks.forEach((track) => expect(app).toContain(track));
  fixture.states.forEach((state) => expect(app).toContain(state));
  expect(model).toContain("sourceVersion");
  expect(model).toContain('confidence: "manual"');
  expect(model).toContain("disposition");
  expect(app).toContain("创建上下文 AI 修订预览");
  expect(app).toContain("contentVersions.restore");
  expect(server).toContain('"episode-pacing-marks"');
  expect(server).toContain("节奏修订预览采用前检查点");
  expect(guide).toContain("集级节奏看板");
});
