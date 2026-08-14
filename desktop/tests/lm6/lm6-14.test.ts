import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-14/story-bible-sidecar-contract.json"),
    "utf8",
  ),
) as {
  contexts: string[];
  groups: string[];
  states: string[];
  selectableFields: string[];
};

test("LM6-14 锁定编辑器侧栏、选择性 Story Bible 变更与离线边界", () => {
  const model = readFileSync(
    join(root, "packages/app/src/story-bible-sidecar.ts"),
    "utf8",
  );
  const app = readFileSync(
    join(root, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
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
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");

  fixture.contexts.forEach((context) => expect(model).toContain(context));
  fixture.groups.forEach((group) => expect(model).toContain(group));
  fixture.states.forEach((state) => expect(app).toContain(state));
  fixture.selectableFields.forEach((field) => {
    expect(server).toContain(field);
  });
  expect(model).toContain("isLockedVisual");
  expect(app).toContain("StoryBibleSidecar");
  expect(app).toContain("story-bible-sidecar-preferences");
  expect(app).toContain("查看字段差异并选择采用");
  expect(app).toContain("本地 Story Bible 暂不可读取");
  expect(app).toContain("max-h-[calc(100vh-15rem)]");
  expect(schema).toContain("StoryBibleChangeSetApplyInput");
  expect(protocol).toContain("StoryBibleChangeSetApplyInput");
  expect(server).toContain("Selected story bible fields are invalid");
  expect(guide).toContain("编辑器旁的 Story Bible 侧栏");
});
