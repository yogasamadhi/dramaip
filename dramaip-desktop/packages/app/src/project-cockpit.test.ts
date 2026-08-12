import { expect, test } from "bun:test";
import type { ProductionGraph, Project, Task } from "@sdns/schema";
import { deriveProjectCockpit } from "./project-cockpit";

const project = {
  id: "project-1",
  title: "驾驶舱项目",
  shortDramaType: "悬疑",
} as Project;
const graph = (
  coverage: Partial<ProductionGraph["coverage"]>,
  kinds: string[] = [],
): ProductionGraph => ({
  projectId: project.id,
  nodes: [
    { id: project.id, kind: "project", title: project.title, status: "项目" },
    ...kinds.map((kind, index) => ({
      id: `${kind}-${index}`,
      kind,
      title: kind,
      status: kind === "delivery" ? "已交付" : "已采用",
    })),
  ],
  edges: [],
  coverage: {
    episodes: 0,
    scripts: 0,
    scenes: 0,
    shots: 0,
    assets: 0,
    stills: 0,
    adoptedStills: 0,
    ...coverage,
  },
});
const chapter = { id: "chapter-1", projectId: project.id } as never;

test("驾驶舱为每个真实阶段只派生一个不可跳过的主要下一步", () => {
  const empty = deriveProjectCockpit({
    project,
    chapters: [],
    graph: graph({}),
    tasks: [],
  });
  expect(empty.primaryAction.label).toBe("导入已授权原著");
  expect(empty.status).toBe("needs-input");

  const needsAdaptation = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({}),
    tasks: [],
  });
  expect(needsAdaptation.primaryAction.label).toBe("创建改编方案");
  expect(needsAdaptation.primaryAction.to).toContain("stage=adaptations");

  const needsStill = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({ episodes: 1, scripts: 1, scenes: 1, shots: 1, assets: 1 }, [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
      "visual-assets",
    ]),
    tasks: [],
  });
  expect(needsStill.status).toBe("needs-human");
  expect(needsStill.primaryAction.label).toBe("确认首个静帧");
});

test("失败、运行和已交付状态不被派生为完成", () => {
  const failed = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({}),
    tasks: [
      { projectId: project.id, status: "failed", title: "失败的任务" } as Task,
    ],
  });
  expect(failed.status).toBe("needs-attention");
  expect(failed.primaryAction.label).toBe("处理失败任务");

  const working = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({}),
    tasks: [
      {
        projectId: project.id,
        status: "running",
        title: "进行中的任务",
      } as Task,
    ],
  });
  expect(working.status).toBe("working");

  const delivered = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph(
      {
        episodes: 1,
        scripts: 1,
        scenes: 1,
        shots: 1,
        assets: 1,
        stills: 1,
        adoptedStills: 1,
      },
      ["adaptations", "episodes", "scripts", "scenes", "shots", "delivery"],
    ),
    tasks: [],
  });
  expect(delivered.status).toBe("delivered");
  expect(delivered.primaryAction.label).toBe("查看交付记录");
});
