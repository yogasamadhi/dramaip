import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-12/still-first-gate-contract.json"),
    "utf8",
  ),
) as {
  requiredBlockers: string[];
  requiredSnapshotFields: string[];
  requiredActions: string[];
};

test("LM6-12 静帧优先 Gate 覆盖快照、批量预检和服务端阻断", () => {
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
  const app = readFileSync(
    join(root, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");

  for (const field of fixture.requiredSnapshotFields)
    expect(schema).toContain(field);
  for (const action of fixture.requiredActions)
    expect(protocol).toContain(action);
  expect(schema).toContain("readinessHash");
  expect(schema).toContain("confirmUnknownCost");
  for (const blocker of fixture.requiredBlockers)
    expect(server).toContain(blocker);
  expect(server).toContain("VIDEO_NOT_READY");
  expect(server).toContain("视频预检快照已变化");
  expect(server).toContain("静帧确认指纹");
  expect(server).toContain("videoGenerationBatchPreflight");
  expect(server).toContain("recordGeneration");
  expect(app).toContain("检查静帧与视频预检");
  expect(app).toContain("预检快照");
  expect(app).toContain("请先完成静帧、资产、权利和费用预检");
  expect(guide).toContain("静帧优先的视频预检");
  expect(guide).toContain("生成账本");
});
