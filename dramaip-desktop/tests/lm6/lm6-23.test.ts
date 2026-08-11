import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-23/series-library-contract.json"),
    "utf8",
  ),
) as { version: number; assetModes: string[]; guarantees: string[] };

test("LM6-23 将系列边界、版本快照和项目内资产投影固定为契约", () => {
  const schema = readFileSync(
    join(root, "packages/schema/src/index.ts"),
    "utf8",
  );
  const protocol = readFileSync(
    join(root, "packages/protocol/src/index.ts"),
    "utf8",
  );
  const database = readFileSync(
    join(root, "packages/db/src/operational-schema.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const client = readFileSync(
    join(root, "packages/client/src/generated.template.ts"),
    "utf8",
  );
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const serverContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );

  expect(fixture.version).toBe(1);
  expect(fixture.assetModes).toEqual(["copy", "fork", "link"]);
  expect(fixture.guarantees).toContain("link-is-immutable");
  expect(schema).toContain("SeriesStoryBibleUpgradeInput");
  expect(protocol).toContain("series-story-bible/:id/upgrade");
  expect(database).toContain("project_series_story_bible_versions");
  expect(database).toContain("series_asset_links");
  expect(server).toContain("projectSeriesLibrary");
  expect(server).toContain("不可变的系列版本链接");
  expect(server).toContain("来自项目包的不可变说明快照");
  expect(client).toContain("upgradeStoryBible");
  expect(app).toContain("系列资产库");
  expect(app).toContain("Link 固定版本");
  expect(serverContract).toContain("unchangedProjection");
  expect(serverContract).toContain("changedFork");
});
