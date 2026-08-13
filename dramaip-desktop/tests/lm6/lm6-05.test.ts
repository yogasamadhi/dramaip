import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const desktopRoot = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(desktopRoot, "tests/fixtures/lm6/lm6-05/pilot-contract.json"),
    "utf8",
  ),
) as {
  version: number;
  episodeCounts: number[];
  stages: string[];
  safety: string[];
};

test("LM6-05 锁定 1–3 集试制状态机与权威覆盖率边界", () => {
  const schema = readFileSync(
    join(desktopRoot, "packages/schema/src/index.ts"),
    "utf8",
  );
  const database = readFileSync(
    join(desktopRoot, "packages/db/src/operational-schema.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(desktopRoot, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const app = readFileSync(
    join(desktopRoot, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  expect(fixture.version).toBe(1);
  expect(fixture.episodeCounts).toEqual([1, 2, 3]);
  expect(fixture.stages).toEqual([
    "confirm-source",
    "script",
    "scenes",
    "shots",
    "assets",
    "review",
  ]);
  expect(database).toContain("CHECK(episode_count BETWEEN 1 AND 3)");
  for (const stage of fixture.stages)
    expect(schema).toContain(`Schema.Literal("${stage}")`);
  expect(server).toContain("pilotPlanStaleReason");
  expect(server).toContain(
    "while (episodeIds.length < Number(current.episode_count))",
  );
  expect(server).toContain("source_confirmed");
  expect(app).toContain("ProjectPilotPanel");
  expect(app).toContain("前往唯一待办");
});
