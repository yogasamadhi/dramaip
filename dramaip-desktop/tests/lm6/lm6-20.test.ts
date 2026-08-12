import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-20/timeline-contract.json"),
    "utf8",
  ),
) as {
  tracks: string[];
  commands: string[];
  mediaStates: string[];
  timebase: string;
  frameRate: number;
};

test("LM6-20 将多轨权威结构、命令历史与不改写源媒体固定为可审查契约", () => {
  const schema = readFileSync(
    join(root, "packages/schema/src/index.ts"),
    "utf8",
  );
  const protocol = readFileSync(
    join(root, "packages/protocol/src/index.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const database = readFileSync(
    join(root, "packages/db/src/operational-schema.ts"),
    "utf8",
  );
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");

  fixture.tracks.forEach((track) => expect(schema).toContain(`"${track}"`));
  fixture.commands.forEach((command) =>
    expect(schema).toContain(`"${command}"`),
  );
  fixture.mediaStates.forEach((state) =>
    expect(schema).toContain(`"${state}"`),
  );
  expect(schema).toContain('Schema.Literal("dramaip-timeline")');
  expect(protocol).toContain("TimelineGroup");
  expect(protocol).toContain("/timelines/:id/commands");
  expect(database).toContain("CREATE TABLE IF NOT EXISTS timelines");
  expect(database).toContain("CREATE TABLE IF NOT EXISTS timeline_history");
  expect(server).toContain("buildInitialTimeline");
  expect(server).toContain("applyTimelineEdit");
  expect(server).toContain("restoreTimelineHistory");
  expect(server).toContain("timelineMediaPreview");
  expect(server).toContain("return Math.round(value * 25) / 25");
  expect(app).toContain("TimelineEditorPanel");
  expect(app).toContain("多轨时间线编辑器");
  expect(app).toContain("源媒体没有被修改");
  expect(guide).toContain("多轨时间线");
  expect(guide).toContain("25 fps");
  expect(fixture.timebase).toBe("seconds");
  expect(fixture.frameRate).toBe(25);
});
