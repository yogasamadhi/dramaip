import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const desktopRoot = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(desktopRoot, "tests/fixtures/lm6/lm6-04/extraction-contract.json"),
    "utf8",
  ),
) as {
  version: number;
  sourceFixture: string;
  candidateTypes: string[];
  safetyGuarantees: string[];
};

test("LM6-04 契约锁定原稿导入的五类可追溯候选", () => {
  const source = readFileSync(
    join(desktopRoot, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const schema = readFileSync(
    join(desktopRoot, "packages/schema/src/index.ts"),
    "utf8",
  );
  const protocol = readFileSync(
    join(desktopRoot, "packages/protocol/src/index.ts"),
    "utf8",
  );
  expect(fixture.version).toBe(1);
  expect(
    readFileSync(
      join(desktopRoot, "tests/fixtures/lm6", fixture.sourceFixture),
      "utf8",
    ),
  ).toContain("林晚");
  expect(fixture.candidateTypes).toEqual([
    "character",
    "scene",
    "prop",
    "chapter-summary",
    "adaptation",
  ]);
  for (const candidateType of fixture.candidateTypes)
    expect(schema).toContain(`Schema.Literal("${candidateType}")`);
  expect(schema).toContain("ImportExtractionSourceRef");
  expect(schema).toContain("confidence: Schema.Number");
  expect(source).toContain("createImportExtractionChangeSet");
  expect(source).toContain("sourceFingerprint");
  expect(protocol).toContain('HttpApiGroup.make("import-extractions")');
});

test("LM6-04 安全边界保持导入可继续、采用原子且人工编辑可保护", () => {
  const source = readFileSync(
    join(desktopRoot, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const app = readFileSync(
    join(desktopRoot, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  expect(fixture.safetyGuarantees).toEqual([
    "source-range-and-confidence",
    "selective-atomic-adoption",
    "stale-on-source-change",
    "duplicate-safe",
    "manual-edit-protected-undo",
    "provider-independent-import",
  ]);
  expect(source).toContain("BEGIN IMMEDIATE");
  expect(source).toContain("importExtractionStaleReason");
  expect(source).toContain("markImportExtractionStaleForChapter");
  expect(source).toContain("Only active change sets can be edited");
  expect(source).toContain("Select one or more draft candidates");
  expect(source).toContain("人工修改");
  expect(source).not.toContain("runAgentForImportExtraction");
  expect(app).toContain("ImportExtractionReviewPanel");
  expect(app).toContain("采用已选项目");
  expect(app).toContain("全部候选预览");
});
