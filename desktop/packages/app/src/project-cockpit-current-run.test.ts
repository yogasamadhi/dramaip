import { describe, expect, it } from "bun:test";
import {
  CreationWorkflowSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import type {
  Chapter,
  ProductionGraph,
  Project,
  Task,
} from "@dramaip/contracts/product";
import { deriveProjectCockpit } from "./project-cockpit";

const projectId = "10000000-0000-4000-8000-000000000001";
const project = {
  id: projectId,
  title: "独立小说",
  version: 0,
  mode: "series_longform",
  modeConfig: { mode: "series_longform" },
} as Project;
const chapter = {
  id: "20000000-0000-4000-8000-000000000001",
  projectId,
  title: "当前作者稿",
  orderIndex: 0,
  content: "作者稿不被任务导航修改",
  version: 1,
} as Chapter;
const graph: ProductionGraph = {
  projectId,
  nodes: [],
  edges: [],
  coverage: {
    episodes: 0,
    scripts: 0,
    scenes: 0,
    shots: 0,
    assets: 0,
    stills: 0,
    adoptedStills: 0,
  },
};
function workflow(patch: Partial<CreationWorkflow> = {}): CreationWorkflow {
  return CreationWorkflowSchema.parse({
    id: "30000000-0000-4000-8000-000000000001",
    taskId: "40000000-0000-4000-8000-000000000001",
    input: {
      projectId,
      operation: "chapter",
      targetId: chapter.id,
      instruction: "原运行目标",
      engineKind: "pi",
    },
    stage: "awaiting-review",
    version: 1,
    runIds: [],
    contextSnapshotIds: [],
    sources: [],
    preparedPrompt: "PRIVATE frozen input",
    issues: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...patch,
  });
}
function task(patch: Partial<Task> = {}): Task {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    kind: "creation.chapter",
    projectId,
    title: "原运行任务",
    status: "failed",
    attentionStatus: "open",
    resultStatus: "none",
    progress: 0,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...patch,
  };
}
function derive(workflows: CreationWorkflow[] = [], tasks: Task[] = []) {
  return deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph,
    tasks,
    novel: { workflows, adoptions: [], memories: [], manuscripts: [] },
  });
}
function expectExactRun(
  result: ReturnType<typeof derive>,
  original: CreationWorkflow,
) {
  const params = new URLSearchParams(result.primaryAction.to.split("?")[1]);
  expect(params.get("projectId")).toBe(projectId);
  expect(params.get("workflowId")).toBe(original.id);
  expect(params.get("taskId")).toBe(original.taskId);
  expect(result.primaryAction.to).not.toContain("PRIVATE");
}

describe("current novel cockpit action retains the actual unresolved run", () => {
  it.each([
    "awaiting-review",
    "preparing",
    "generating",
    "checking",
    "revising",
    "rechecking",
    "failed",
    "interrupted",
  ] as const)("returns exact task and workflow for %s", (stage) => {
    const original = workflow({ stage });
    expectExactRun(
      derive(
        [original],
        [task({ result: { creationWorkflowId: original.id } })],
      ),
      original,
    );
  });
  it.each(["chapter-memory", "knowledge-plan"] as const)(
    "does not lose the original %s run behind a generic task/project page",
    (operation) => {
      const original = workflow({ input: { ...workflow().input, operation } });
      expectExactRun(derive([original]), original);
    },
  );
  it.each(["applied", "canceled", "discarded"] as const)(
    "a newer %s run does not erase an older unresolved candidate",
    (stage) => {
      const original = workflow();
      const newer = workflow({
        id: "30000000-0000-4000-8000-000000000002",
        taskId: "40000000-0000-4000-8000-000000000002",
        stage,
        createdAt: "2026-10-03T01:00:00.000Z",
      });
      const result = derive([newer, original]);
      expect(result.primaryAction.label).toBe("审阅小说候选");
      expectExactRun(result, original);
    },
  );
  it("acknowledging a historical failure removes its primary-action loop without inventing success", () => {
    const original = workflow({ stage: "failed" });
    const result = derive(
      [original],
      [
        task({
          attentionStatus: "acknowledged",
          result: { creationWorkflowId: original.id },
        }),
      ],
    );
    expect(result.primaryAction.label).toBe("继续 AI 创作");
    expect(result.status).toBe("needs-input");
    expect(
      result.gates?.find((gate) => gate.id === "novel-adoption")?.statusLabel,
    ).toBe("作者稿已保存");
    expect(
      result.gates?.find((gate) => gate.id === "novel-memory")?.status,
    ).not.toBe("ready");
    expect(
      result.gates?.find((gate) => gate.id === "novel-manuscript")?.status,
    ).not.toBe("ready");
  });
  it("a bare acknowledged failed task does not block current author editing", () => {
    const result = derive([], [task({ attentionStatus: "acknowledged" })]);
    expect(result.primaryAction.label).toBe("继续 AI 创作");
    expect(result.status).toBe("needs-input");
  });
  it("a failure with no authoritative acknowledgement remains visible and exact", () => {
    const original = workflow({ stage: "failed" });
    const result = derive([original]);
    expect(result.primaryAction.label).toBe("处理小说创作失败");
    expectExactRun(result, original);
  });
  it.each(["foreign-project", "different-workflow", "different-task"] as const)(
    "%s acknowledgement cannot remove the current workflow failure",
    (mismatch) => {
      const original = workflow({ stage: "failed" });
      const acknowledged = task({
        attentionStatus: "acknowledged",
        result: { creationWorkflowId: original.id },
        ...(mismatch === "foreign-project"
          ? { projectId: "10000000-0000-4000-8000-000000000002" }
          : mismatch === "different-workflow"
            ? {
                result: {
                  creationWorkflowId: "30000000-0000-4000-8000-000000000002",
                },
              }
            : { id: "40000000-0000-4000-8000-000000000002" }),
      });
      const result = derive([original], [acknowledged]);
      expect(result.primaryAction.label).toBe("处理小说创作失败");
      expectExactRun(result, original);
    },
  );
  it("fact-memory review and progress gates also return the original run", () => {
    for (const stage of ["awaiting-review", "checking"] as const) {
      const original = workflow({
        stage,
        input: { ...workflow().input, operation: "chapter-memory" },
      });
      const gate = derive([original]).gates?.find(
        (item) => item.id === "novel-memory",
      );
      expect(gate?.to).toBe(derive([original]).primaryAction.to);
      expect(gate?.status).toBe(
        stage === "awaiting-review" ? "needs-human" : "working",
      );
    }
  });
  it("a standalone active or open failure task carries its actual ID rather than only project scope", () => {
    for (const status of [
      "queued",
      "running",
      "failed",
      "interrupted",
    ] as const) {
      const original = task({ status });
      const result = derive([], [original]);
      const params = new URLSearchParams(result.primaryAction.to.split("?")[1]);
      expect(params.get("projectId")).toBe(projectId);
      expect(params.get("taskId")).toBe(original.id);
      expect(params.has("workflowId")).toBe(false);
    }
  });
});
