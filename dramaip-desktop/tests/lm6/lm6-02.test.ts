import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ProductionGraph, Project, Task } from "@sdns/schema";
import { deriveProjectCockpit } from "../../packages/app/src/project-cockpit";

const desktopRoot = join(import.meta.dir, "../..");
const matrix = JSON.parse(
  readFileSync(
    join(desktopRoot, "tests/fixtures/lm6/lm6-02/cockpit-matrix.json"),
    "utf8",
  ),
) as {
  version: number;
  scenarios: Array<{
    id: string;
    expectedStatus: string;
    expectedAction: string;
  }>;
};
const project = {
  id: "lm6-02-project",
  title: "驾驶舱 fixture",
  shortDramaType: "悬疑",
} as Project;
const chapter = { id: "chapter-1", projectId: project.id } as never;

function graph(
  coverage: Partial<ProductionGraph["coverage"]> = {},
  kinds: string[] = [],
): ProductionGraph {
  return {
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
  };
}

test("LM6-02 fixture 锁定每个项目状态的唯一推荐动作", () => {
  expect(matrix.version).toBe(1);
  const states = {
    "empty-project": { chapters: [], graph: graph(), tasks: [] },
    "content-without-adaptation": {
      chapters: [chapter],
      graph: graph(),
      tasks: [],
    },
    "awaiting-still-adoption": {
      chapters: [chapter],
      graph: graph(
        { episodes: 1, scripts: 1, scenes: 1, shots: 1, assets: 1 },
        [
          "adaptations",
          "episodes",
          "scripts",
          "scenes",
          "shots",
          "visual-assets",
        ],
      ),
      tasks: [],
    },
    "failed-task": {
      chapters: [chapter],
      graph: graph(),
      tasks: [
        { projectId: project.id, status: "failed", title: "失败任务" } as Task,
      ],
    },
    delivered: {
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
    },
  } as const;
  for (const scenario of matrix.scenarios) {
    const state = states[scenario.id as keyof typeof states];
    const cockpit = deriveProjectCockpit({ project, ...state });
    expect(cockpit.status).toBe(scenario.expectedStatus);
    expect(cockpit.primaryAction.label).toBe(scenario.expectedAction);
    expect(cockpit.primaryAction.to).toMatch(
      /(?:\/projects\/lm6-02-project|projectId=lm6-02-project)/,
    );
  }
});

test("LM6-02 保留四区项目上下文，并让旧全局路由成为兼容入口", () => {
  const appSource = readFileSync(
    join(desktopRoot, "packages/app/src/main.tsx"),
    "utf8",
  );
  expect(appSource).toContain("项目四区导航");
  for (const label of ["创作", "改编", "制作", "审核交付"]) {
    expect(appSource).toContain(`label: "${label}"`);
  }
  expect(appSource).toContain('get("projectId")');
  expect(appSource).toContain('get("stage")');
});
