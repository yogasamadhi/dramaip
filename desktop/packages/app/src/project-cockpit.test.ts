import { expect, test } from "bun:test";
import type {
  ProductionGraph,
  Project,
  Task,
} from "@dramaip/contracts/product";
import { deriveProjectCockpit } from "./project-cockpit";
import type { Chapter, DomainEntity } from "@dramaip/contracts/product";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { NovelCockpitEvidence } from "./novel-cockpit-evidence";
import type { ManuscriptRecord } from "@dramaip/contracts/delivery";

const project = {
  id: "project-1",
  title: "驾驶舱项目",
  mode: "single_season",
  modeConfig: { mode: "single_season", entryPath: "novel" },
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

test("系列长篇默认继续母本，显式建立改编后才推进试制", () => {
  const longform = {
    ...project,
    mode: "series_longform",
    modeConfig: { mode: "series_longform" },
  } as Project;
  const result = deriveProjectCockpit({
    project: longform,
    chapters: [chapter],
    graph: { ...graph({}), projectId: longform.id },
    tasks: [],
  });
  expect(result.primaryAction.label).toBe("继续 AI 创作");
  expect(result.primaryAction.to).toBe(`/projects/${longform.id}`);
  expect(result.coverage.map((item) => item.label)).toEqual([
    "章节",
    "已保存正文",
  ]);
  expect(result.primaryAction.description).toContain("不要求改编或媒体制作");
});

test("主动取消和局部静帧不能代替新主流程六阶段正式证据", () => {
  const partial = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph(
      {
        episodes: 1,
        scripts: 1,
        scenes: 1,
        shots: 12,
        assets: 1,
        stills: 12,
        adoptedStills: 1,
      },
      ["adaptations", "episodes", "scripts", "scenes", "shots"],
    ),
    tasks: [
      { projectId: project.id, status: "canceled", title: "主动取消" } as Task,
    ],
  });
  expect(partial.status).toBe("needs-attention");
  expect(partial.primaryAction.label).toBe("核对正式创作进度");
  expect(partial.gates).toHaveLength(6);
  expect(partial.gates?.every((gate) => gate.status === "unverified")).toBe(
    true,
  );
});
const chapter = { id: "chapter-1", projectId: project.id } as never;

test("改编目录从空到全部存在均不能制造正式采用或强制静帧", () => {
  const empty = deriveProjectCockpit({
    project,
    chapters: [],
    graph: graph({}),
    tasks: [],
  });
  expect(empty.primaryAction.label).toBe("核对正式创作进度");
  expect(empty.status).toBe("needs-attention");

  const needsAdaptation = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({}),
    tasks: [],
  });
  expect(needsAdaptation.primaryAction.label).toBe("核对正式创作进度");
  expect(needsAdaptation.primaryAction.to).toContain("tools/author-intent");

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
  expect(needsStill.status).toBe("needs-attention");
  expect(needsStill.primaryAction.label).not.toContain("静帧");
});

test("历史失败、通用运行和已交付节点不能代替当前阶段证据", () => {
  const failed = deriveProjectCockpit({
    project,
    chapters: [chapter],
    graph: graph({}),
    tasks: [
      { projectId: project.id, status: "failed", title: "失败的任务" } as Task,
    ],
  });
  expect(failed.status).toBe("needs-attention");
  expect(failed.primaryAction.label).toBe("核对正式创作进度");

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
  expect(working.status).toBe("needs-attention");

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
  expect(delivered.status).toBe("needs-attention");
  expect(delivered.primaryAction.label).toBe("核对正式创作进度");
});

test("已有剧本和创意直写目录不冒充正式成果，正式证据缺失时保持未核验", () => {
  const g = graph({ episodes: 2, scripts: 2 }, []);
  g.nodes.push(
    ...["old", "current"].flatMap((prefix) =>
      ["adaptations", "episodes", "scripts"].map((kind) => ({
        id: `${prefix}-${kind}`,
        kind,
        title: `${prefix}-${kind}`,
        status: "待检查",
      })),
    ),
  );
  g.edges = ["old", "current"].flatMap((prefix) => [
    {
      sourceId: `${prefix}-adaptations`,
      targetId: `${prefix}-episodes`,
      relation: "依赖",
    },
    {
      sourceId: `${prefix}-episodes`,
      targetId: `${prefix}-scripts`,
      relation: "依赖",
    },
  ]);
  const result = deriveProjectCockpit({
    project: {
      ...project,
      currentAdaptationId: "current-adaptations",
      modeConfig: { mode: "single_season", entryPath: "script" },
    },
    graph: g,
    chapters: [],
    tasks: [],
  });
  expect(result.primaryAction.label).toBe("核对直写正式进度");
  expect(result.primaryAction.to).toContain("/tools/author-intent");
  expect(result.gates).toHaveLength(4);
  expect(result.gates!.every((gate) => gate.status === "unverified")).toBe(
    true,
  );
  const original = deriveProjectCockpit({
    project: {
      ...project,
      currentAdaptationId: "current-adaptations",
      modeConfig: { mode: "single_season", entryPath: "inspiration" },
    },
    graph: g,
    chapters: [],
    tasks: [],
  });
  expect(original.primaryAction.label).toBe("核对直写正式进度");
  expect(original.primaryAction.to).toBe(result.primaryAction.to);
  expect(original.status).toBe("needs-attention");
});

const novelProject = {
  ...project,
  version: 0,
  mode: "series_longform",
  modeConfig: { mode: "series_longform" },
} as Project;
const novelChapter = {
  id: "chapter-1",
  projectId: project.id,
  title: "铜钥匙",
  orderIndex: 0,
  content: "小禾把铜钥匙交给阿桥。",
  version: 1,
} as Chapter;
const chapterWorkflow = {
  id: "adoption-1",
  taskId: "chapter-task-1",
  input: {
    projectId: project.id,
    targetId: novelChapter.id,
    operation: "chapter",
    baseVersion: 0,
    instruction: "继续温和成长故事",
  },
  stage: "applied",
  output: { title: "铜钥匙", content: novelChapter.content },
  sources: [],
  createdAt: "2026-09-30T00:00:00.000Z",
} as unknown as CreationWorkflow;
const memoryWorkflow = {
  ...chapterWorkflow,
  id: "memory-1",
  input: {
    ...chapterWorkflow.input,
    operation: "chapter-memory",
    baseVersion: 1,
  },
} as CreationWorkflow;
const evidence: NovelCockpitEvidence = {
  adoptions: [
    {
      workflowId: chapterWorkflow.id,
      chapterId: novelChapter.id,
      version: 1,
      adoptedAt: "2026-09-30T00:00:00.000Z",
    },
  ],
  workflows: [chapterWorkflow, memoryWorkflow],
  memories: [
    {
      id: "record-1",
      projectId: project.id,
      domain: "chapter-memories",
      payload: {
        sourceChapterId: novelChapter.id,
        sourceVersion: 1,
        sourceWorkflowId: memoryWorkflow.id,
        evidence: novelChapter.content,
      },
    } as DomainEntity,
  ],
};

test("稿件 Gate 只认当前版本、明确权利声明与匹配的 Host 回执；取消/预览/旧版本不算交付", () => {
  const digest = "a".repeat(64);
  const manuscript = {
    id: "manuscript-1",
    version: 2,
    status: "saved",
    sourceState: "current",
    sourceIssues: [],
    manifest: {
      schemaVersion: 1,
      projectId: novelProject.id,
      projectVersion: novelProject.version,
      projectTitle: novelProject.title,
      scope: "whole-project",
      format: "markdown",
      fileName: "稿件.md",
      contentSha256: digest,
      byteSize: 100,
      chapters: [
        {
          id: novelChapter.id,
          version: novelChapter.version,
          title: novelChapter.title,
          orderIndex: 0,
          contentSha256: digest,
        },
      ],
      createdAt: "2026-09-30T00:00:00.000Z",
    },
    rights: { basis: "original", confirmed: true, note: "作者稿" },
    receipt: {
      artifactRef: "artifact-1",
      sha256: digest,
      byteSize: 100,
      savedAt: "2026-09-30T00:01:00.000Z",
    },
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:01:00.000Z",
  } as ManuscriptRecord;
  const derive = (record: ManuscriptRecord, chapters = [novelChapter]) =>
    deriveProjectCockpit({
      project: novelProject,
      chapters,
      graph: graph({}),
      tasks: [],
      novel: { ...evidence, manuscripts: [record] },
    });
  const gate = (record: ManuscriptRecord, chapters?: Chapter[]) =>
    derive(record, chapters).gates!.find(
      (item) => item.id === "novel-manuscript",
    )!;
  expect(gate(manuscript).status).toBe("ready");
  expect(gate(manuscript).statusLabel).toBe("完整稿件已核验保存");
  expect(gate(manuscript).to).toContain("manuscriptId=manuscript-1");
  for (const patch of [
    { status: "canceled" },
    { status: "failed" },
    { receipt: undefined },
    { rights: undefined },
    { receipt: { ...manuscript.receipt!, sha256: "b".repeat(64) } },
    { receipt: { ...manuscript.receipt!, byteSize: 101 } },
    { sourceState: "stale" },
  ])
    expect(
      gate({ ...manuscript, ...patch } as ManuscriptRecord).status,
    ).not.toBe("ready");
  expect(
    gate(manuscript, [{ ...novelChapter, version: novelChapter.version + 1 }])
      .status,
  ).toBe("stale");
  expect(
    gate(manuscript, [
      novelChapter,
      { ...novelChapter, id: "added", orderIndex: 1 },
    ]).status,
  ).toBe("stale");
  const selected = {
    ...manuscript,
    manifest: { ...manuscript.manifest, scope: "selected-chapters" },
  } as ManuscriptRecord;
  expect(
    gate(selected, [
      novelChapter,
      { ...novelChapter, id: "excluded", orderIndex: 1 },
    ]).statusLabel,
  ).toBe("所选范围已核验保存");
  expect(gate(selected).detail).toContain("不代表全稿");
  const pending = {
    ...manuscript,
    status: "awaiting-confirmation",
    receipt: undefined,
    rights: undefined,
  } as ManuscriptRecord;
  expect(gate(pending).status).toBe("needs-human");
  expect(derive(pending).primaryAction.label).toBe("核对稿件交付");
});
const novelCockpit = (
  novel?: NovelCockpitEvidence,
  chapters = [novelChapter],
) =>
  deriveProjectCockpit({
    project: novelProject,
    chapters,
    graph: graph({}),
    tasks: [],
    novel,
  });

test("小说三个结果 Gate 使用正式采用、当前记忆证据，不把稿件生成或任务成功标为已交付", () => {
  const result = novelCockpit(evidence);
  expect(result.primaryAction.label).toBe("继续下一章");
  expect(
    new URLSearchParams(result.primaryAction.to.split("?")[1]).get("chapterId"),
  ).toBe(novelChapter.id);
  expect(result.gates?.map((gate) => [gate.id, gate.status])).toEqual([
    ["novel-adoption", "ready"],
    ["novel-memory", "ready"],
    ["novel-manuscript", "unverified"],
  ]);
  expect(result.status).not.toBe("delivered");
  expect(result.gates?.[2]?.detail).toContain("不要求改编、分镜或媒体");
});

test("作者原稿可独立继续，保存正文/运行 applied 不冒充 Writing 正式 AI 采用记录", () => {
  const result = novelCockpit({ ...evidence, adoptions: [] });
  expect(result.primaryAction.label).toBe("继续 AI 创作");
  expect(result.gates?.[0]?.statusLabel).toBe("作者稿已保存");
  expect(
    result.coverage.find((item) => item.label === "当前版本 AI 采用")?.current,
  ).toBe(0);
  const loading = novelCockpit();
  expect(loading.gates?.[0]?.status).toBe("unverified");
  expect(loading.gates?.[1]?.status).toBe("unverified");
});

test("正式正文后续改变，旧采用与旧记忆不能再表示当前成果", () => {
  const result = novelCockpit(evidence, [
    { ...novelChapter, version: 2, content: "小禾改把钥匙放回柜台。" },
  ]);
  expect(result.gates?.[0]?.status).toBe("stale");
  expect(result.gates?.[1]?.status).toBe("pending");
  expect(result.primaryAction.label).toBe("继续 AI 创作");
  expect(
    result.coverage.find((item) => item.label === "当前版本 AI 采用")?.current,
  ).toBe(0);
});

test("记忆删除、错归属、缺正文证据、错来源版本或未采用记忆工作流均不得显示同步", () => {
  for (const memories of [
    [],
    [{ ...evidence.memories[0]!, projectId: "another-project" }],
    [
      {
        ...evidence.memories[0]!,
        payload: {
          sourceChapterId: novelChapter.id,
          sourceVersion: 1,
          sourceWorkflowId: memoryWorkflow.id,
          evidence: "正文里未发生的事实",
        },
      },
    ],
    [
      {
        ...evidence.memories[0]!,
        payload: {
          sourceChapterId: novelChapter.id,
          sourceVersion: 0,
          sourceWorkflowId: memoryWorkflow.id,
          evidence: novelChapter.content,
        },
      },
    ],
    [{ ...evidence.memories[0]!, payload: null }],
  ]) {
    const result = novelCockpit({ ...evidence, memories });
    expect(result.gates?.[1]?.status).toBe("pending");
    expect(result.primaryAction.label).toBe("核对本章事实记忆");
  }
  expect(
    novelCockpit({
      ...evidence,
      workflows: [
        chapterWorkflow,
        { ...memoryWorkflow, stage: "awaiting-review" },
      ],
    }).gates?.[1]?.status,
  ).toBe("needs-human");
});

test("小说与规划候选返回原运行，不以普通编辑器的最新记录替代或进入媒体", () => {
  const pending = {
    ...chapterWorkflow,
    id: "pending-1",
    stage: "awaiting-review",
    createdAt: "2026-09-30T01:00:00.000Z",
  } as CreationWorkflow;
  const result = novelCockpit({
    ...evidence,
    workflows: [...evidence.workflows, pending],
  });
  expect(result.status).toBe("needs-human");
  expect(result.primaryAction.label).toBe("审阅小说候选");
  expect(result.primaryAction.to).toBe(
    `/tasks?projectId=${project.id}&taskId=${pending.taskId}&workflowId=${pending.id}`,
  );
  expect(result.primaryAction.to).not.toContain("media");
  expect(result.gates?.[0]?.status).toBe("needs-human");
  const planning = novelCockpit({
    ...evidence,
    workflows: [
      {
        ...pending,
        input: {
          ...pending.input,
          targetId: undefined,
          operation: "characters",
        },
      },
    ],
  });
  expect(planning.primaryAction.to).toBe(result.primaryAction.to);
  const arc = novelCockpit({
    ...evidence,
    workflows: [
      {
        ...pending,
        input: {
          ...pending.input,
          targetId: undefined,
          operation: "story-arc",
        },
      },
    ],
  });
  expect(arc.primaryAction.to).toBe(result.primaryAction.to);
  const knowledge = novelCockpit({
    ...evidence,
    workflows: [
      {
        ...pending,
        input: {
          ...pending.input,
          targetId: undefined,
          operation: "knowledge-plan",
        },
      },
    ],
  });
  expect(knowledge.primaryAction.to).toBe(result.primaryAction.to);
  const discarded = novelCockpit({
    ...evidence,
    workflows: [...evidence.workflows, { ...pending, stage: "discarded" }],
  });
  expect(discarded.primaryAction.label).toBe("继续下一章");
});

test("章节重排按当前顺序推荐，不用返回数组的旧顺序或其他项目候选", () => {
  const other = {
    ...novelChapter,
    id: "chapter-2",
    title: "先发生的章节",
    orderIndex: 0,
  };
  const result = novelCockpit(
    {
      ...evidence,
      workflows: [
        ...evidence.workflows,
        {
          ...chapterWorkflow,
          stage: "awaiting-review",
          input: { ...chapterWorkflow.input, projectId: "another-project" },
        },
      ],
    },
    [{ ...novelChapter, orderIndex: 1 }, other],
  );
  expect(result.primaryAction.label).toBe("继续下一章");
  expect(result.primaryAction.to).toContain("chapterId=chapter-1");
});

test("同一章多次采用保留历史，当前版本已有正式记录时不因旧记录误判 stale", () => {
  const result = novelCockpit({
    ...evidence,
    adoptions: [
      ...evidence.adoptions,
      { ...evidence.adoptions[0]!, workflowId: "earlier", version: 0 },
    ],
  });
  expect(result.gates?.[0]?.status).toBe("ready");
  expect(result.primaryAction.label).toBe("继续下一章");
});

test("候选引用发生变化或原章节已删除，显示冲突而不是引导到另一章采用", () => {
  const pending = {
    ...chapterWorkflow,
    stage: "awaiting-review",
    sources: [{ kind: "chapter", id: novelChapter.id, version: 0 }],
  } as CreationWorkflow;
  const result = novelCockpit({ ...evidence, workflows: [pending] });
  expect(result.primaryAction.label).toBe("核对过期小说候选");
  expect(result.gates?.[0]?.status).toBe("stale");
  const deleted = novelCockpit({ ...evidence, workflows: [pending] }, []);
  expect(deleted.primaryAction.to).toContain("/tasks?");
  expect(deleted.primaryAction.to).not.toContain("chapterId");
});
