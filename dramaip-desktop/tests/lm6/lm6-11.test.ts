import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-11/storyboard-board-contract.json"),
    "utf8",
  ),
) as { cardFields: string[]; controls: string[]; maxInitialCardsPerScene: number; performanceFixtureShots: number };

test("LM6-11 看板契约覆盖卡片、重排、撤销与分段加载边界", () => {
  const board = readFileSync(
    join(root, "packages/app/src/storyboard-board.ts"),
    "utf8",
  );
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const guide = readFileSync(
    join(root, "docs/product/USER_GUIDE.md"),
    "utf8",
  );
  expect(fixture.cardFields).toContain("资产覆盖");
  expect(fixture.controls).toEqual([
    "keyboard-reorder",
    "drag-reorder",
    "undo",
    "load-more",
  ]);
  expect(fixture.maxInitialCardsPerScene).toBe(50);
  expect(fixture.performanceFixtureShots).toBe(120);
  expect(board).toContain("buildStoryboard");
  expect(board).toContain("reorderStoryboardShots");
  expect(app).toContain("卡片式导演分镜看板");
  expect(app).toContain("撤销上次重排");
  expect(app).toContain("Alt + ↑/↓ 重排");
  expect(server).toContain("Production order changed; refresh before reordering");
  expect(guide).toContain("制作 → 导演看板");
});
