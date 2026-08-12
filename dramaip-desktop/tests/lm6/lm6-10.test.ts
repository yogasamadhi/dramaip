import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-10/asset-center-contract.json"),
    "utf8",
  ),
) as { version: number; categories: string[]; states: string[] };

test("LM6-10 资产中心契约覆盖四类资产、锁、用途与诚实媒体状态", () => {
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
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const guide = readFileSync(
    join(root, "docs/product/USER_GUIDE.md"),
    "utf8",
  );
  expect(fixture.version).toBe(1);
  expect(fixture.categories).toEqual(["character", "scene", "prop", "voice"]);
  expect(fixture.states).toContain("missing");
  expect(fixture.states).toContain("unknown");
  expect(schema).toContain("AssetCenterAsset");
  expect(schema).toContain("AssetCenterActionInput");
  expect(protocol).toContain("asset-center/:id/action");
  expect(protocol).toContain("asset-center/:id/preview");
  expect(server).toContain("assetCenterUsages");
  expect(server).toContain("资产正在被");
  expect(server).toContain("请先采用并锁定资产版本，再分配给镜头。");
  expect(app).toContain("统一资产中心");
  expect(app).toContain("本地归档文件缺失；不会伪造预览。");
  expect(guide).toContain("制作 → 资产中心");
});
