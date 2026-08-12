import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const matrix = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-06/p0-gate-matrix.json"),
    "utf8",
  ),
) as {
  version: number;
  entryPaths: string[];
  requiredEvidence: string[];
};

test("LM6-06 P0 Gate 的证据矩阵覆盖三入口、恢复和安全边界", () => {
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");
  const cockpit = readFileSync(
    join(root, "packages/app/src/project-cockpit.ts"),
    "utf8",
  );
  const assistant = readFileSync(
    join(root, "packages/app/src/context-assistant.test.ts"),
    "utf8",
  );
  const baseline = readFileSync(join(root, "tests/lm6/lm6-00.test.ts"), "utf8");
  const serverContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const gate = readFileSync(
    join(root, "tests/electron/lm6-p0-gate.spec.ts"),
    "utf8",
  );
  const tests = ["lm6-03.spec.ts", "lm6-04.spec.ts"]
    .map((file) => readFileSync(join(root, "tests/electron", file), "utf8"))
    .join("\n");
  expect(matrix.version).toBe(1);
  expect(matrix.entryPaths).toEqual([
    "inspiration",
    "source-import",
    "script-paste",
  ]);
  expect(matrix.requiredEvidence).toContain("fresh-profile-each-entry");
  expect(matrix.requiredEvidence).toContain("restart-resume-each-entry");
  expect(matrix.requiredEvidence).toContain("bad-file");
  expect(matrix.requiredEvidence).toContain("keyboard-1280");
  expect(gate).toContain("从灵感开始");
  expect(gate).toContain("导入原著");
  expect(gate).toContain("直接导入 / 粘贴剧本");
  expect(gate).toContain("setViewportSize({ width: 1280, height: 720 })");
  expect(gate).toContain("await running.application.close()");
  expect(gate).toContain("请求参数无效，请检查后重试");
  expect(tests).toContain("高级模式");
  expect(tests).toContain("采用已选项目");
  expect(gate).toContain("确认来源并创建试制分集");
  expect(cockpit).toContain("interrupted");
  expect(baseline).toContain("locked-visual-asset");
  expect(serverContract).toContain("项目包往返");
  expect(assistant).toContain('status: "unavailable"');
  expect(assistant).toContain('expect(unknownCost.cost).toBe("unknown")');
  expect(guide).toContain("简洁模式");
  expect(guide).toContain("1–3 集试制向导");
});
