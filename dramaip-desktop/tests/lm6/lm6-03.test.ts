import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { AGENT_TASK_CATALOG } from "@sdns/ai";
import type { AgentTaskDescriptor } from "@sdns/schema";
import {
  CONTEXT_ASSISTANT_REGISTRY,
  assertContextAssistantRegistry,
  contextAssistantPreflight,
  resolveContextAssistantActions,
} from "../../packages/app/src/context-assistant";

const desktopRoot = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(desktopRoot, "tests/fixtures/lm6/lm6-03/assistant-contract.json"),
    "utf8",
  ),
) as {
  version: number;
  defaultMode: string;
  defaultHiddenControls: string[];
  contextPages: string[];
  advancedGuarantees: string[];
  preflight: string[];
};
const catalog: AgentTaskDescriptor[] = AGENT_TASK_CATALOG.map((definition) => ({
  id: definition.id,
  label: definition.label,
  category: definition.category,
  promptVersion: definition.promptVersion,
  writePolicy: definition.writePolicy,
  allowedTools: definition.allowedTools,
}));

test("LM6-03 简洁助手注册表穷尽核验权威任务目录且不复制任务定义", () => {
  expect(fixture.version).toBe(1);
  expect(fixture.defaultMode).toBe("simple");
  expect(catalog).toHaveLength(73);
  expect(() => assertContextAssistantRegistry(catalog)).not.toThrow();
  expect(Object.keys(CONTEXT_ASSISTANT_REGISTRY).sort()).toEqual(
    [...fixture.contextPages].sort(),
  );
  for (const page of fixture.contextPages) {
    const actions = resolveContextAssistantActions({
      page: page as keyof typeof CONTEXT_ASSISTANT_REGISTRY,
      catalog,
    });
    expect(actions.missingTaskTypes).toEqual([]);
    expect(actions.actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.actions.length).toBeLessThanOrEqual(3);
    for (const action of actions.actions) {
      const advanced = catalog.find((task) => task.id === action.id);
      expect(advanced).toMatchObject({
        id: action.id,
        promptVersion: action.promptVersion,
        writePolicy: action.writePolicy,
      });
    }
  }
});

test("LM6-03 预检与远程费用门禁保持推荐、任务快照和预览采用链路分离", () => {
  const source = readFileSync(
    join(desktopRoot, "packages/app/src/main.tsx"),
    "utf8",
  );
  const schema = readFileSync(
    join(desktopRoot, "packages/schema/src/index.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(desktopRoot, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  expect(fixture.defaultHiddenControls).toEqual([
    "engine",
    "model",
    "task",
    "benchmark",
  ]);
  expect(source).toContain('assistantMode === "simple"');
  expect(source).toContain('assistantMode === "advanced"');
  for (const guarantee of fixture.advancedGuarantees) {
    if (guarantee === "full-task-catalog")
      expect(source).toContain("taskDefinitions.map((item) => item.category)");
    if (guarantee === "explicit-engine-model") {
      expect(source).toContain("智能引擎");
      expect(source).toContain("本次模型（可选）");
    }
    if (guarantee === "blind-experiment")
      expect(source).toContain("启动三引擎盲测");
  }
  expect(source).toContain(
    "const costUnknown = props.preview.estimatedCost === undefined",
  );
  expect(source).toContain(
    "disabled={costUnknown || execute.isPending || discard.isPending}",
  );
  expect(schema).toContain("assistantMode: Schema.Literals");
  expect(server).toContain('record?.assistant_mode === "advanced"');
  expect(server).toContain("contextSnapshotId");

  const providerAction = resolveContextAssistantActions({
    page: "produce",
    catalog,
  }).actions.find(
    (action) => action.writePolicy === "provider-action-preview",
  )!;
  const preflight = contextAssistantPreflight({
    action: providerAction,
    projectId: "project-1",
    engine: {
      kind: "opencode",
      name: "OpenCode",
      version: "test",
      status: "available",
      isDefault: true,
      isBeta: false,
      capabilities: {
        streaming: true,
        interrupt: true,
        resume: true,
        fork: true,
        readOnlyMcp: true,
        structuredOutput: true,
        chatGptLogin: false,
        apiKeyLogin: true,
      },
    },
    modelId: "test-model",
  });
  expect(preflight.cost).toBe("unknown");
  expect(preflight.ready).toBe(true);
});

test("LM6-03 用户指南明确简单/高级切换、预览采用和未知费用处理", () => {
  const guide = readFileSync(
    join(desktopRoot, "docs/product/USER_GUIDE.md"),
    "utf8",
  );
  expect(guide).toContain("简洁模式");
  expect(guide).toContain("高级模式");
  expect(guide).toContain("完整任务目录");
  expect(guide).toContain("确认创建远程任务会保持禁用");
});
