import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const desktopRoot = join(import.meta.dir, "../..");
const fixtureRoot = join(desktopRoot, "tests/fixtures/lm6/lm6-00");
const contract = JSON.parse(
  readFileSync(join(fixtureRoot, "baseline-contract.json"), "utf8"),
) as {
  version: number;
  schema: string;
  fixtures: Array<{
    id: string;
    source: string;
    expected: Record<string, unknown>;
  }>;
  resultContract: Record<string, string>;
  statusVocabulary: Record<string, string[]>;
};

test("LM6-00 基线 fixture 以合成数据定义四种可重复项目状态", () => {
  expect(contract.version).toBe(1);
  expect(contract.schema).toBe("v3");
  expect(contract.fixtures.map((fixture) => fixture.id)).toEqual([
    "empty-project",
    "source-import",
    "script-storyboard",
    "locked-visual-asset",
  ]);
  expect(existsSync(join(fixtureRoot, "source-import.md"))).toBe(true);

  const sourceImport = contract.fixtures.find(
    (fixture) => fixture.id === "source-import",
  );
  expect(sourceImport?.expected.chapters).toEqual([
    "前言",
    "第一章 雨夜来信",
    "第二章 失联电话",
  ]);
  const fixtureText = readFileSync(
    join(fixtureRoot, "source-import.md"),
    "utf8",
  );
  expect(fixtureText).not.toMatch(/(?:\/Users\/|[A-Z]:\\\\)/);
  expect(fixtureText).not.toMatch(/(?:api[_-]?key|password|token)\s*[:=]/i);
});

test("LM6-00 结果契约明确可验证结果与诚实状态词", () => {
  expect(Object.keys(contract.resultContract)).toEqual([
    "firstTrustedResult",
    "singleNextAction",
    "humanAdoption",
    "costGate",
    "delivery",
  ]);
  expect(contract.resultContract.singleNextAction).toContain("partial");
  expect(contract.statusVocabulary.product).toEqual([
    "implemented",
    "partial",
    "unavailable",
    "unknown",
  ]);
  expect(contract.statusVocabulary.verification).toContain("timeout");
});

test("LM6-00 事实文档与当前导航及基线命令保持一致", () => {
  const appSource = readFileSync(
    join(desktopRoot, "packages/app/src/main.tsx"),
    "utf8",
  );
  for (const [path, label] of [
    ["/", "项目"],
    ["/create", "创作"],
    ["/adapt", "改编"],
    ["/produce", "制作"],
    ["/review", "审核交付"],
    ["/insights", "数据洞察"],
    ["/search", "搜索"],
    ["/tasks", "任务"],
    ["/settings", "设置"],
  ]) {
    expect(appSource).toContain(`<Link to="${path}">${label}</Link>`);
  }

  const guide = readFileSync(
    join(desktopRoot, "docs/product/USER_GUIDE.md"),
    "utf8",
  );
  expect(guide).toContain(
    "项目 / 创作 / 改编 / 制作 / 审核交付 / 数据洞察 / 搜索 / 任务 / 设置",
  );
  const packageJson = JSON.parse(
    readFileSync(join(desktopRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  for (const command of [
    "typecheck",
    "lint",
    "test:unit",
    "check:generated",
    "check:engine-locks",
    "check:provider-catalog",
    "build",
    "test:e2e",
  ]) {
    expect(packageJson.scripts[command]).toBeTruthy();
  }
});
