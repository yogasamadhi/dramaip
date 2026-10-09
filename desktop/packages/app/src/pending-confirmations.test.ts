import { expect, test } from "bun:test";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type {
  NarrativeQualitySummary,
  NarrativeLocalQualitySummary,
} from "@dramaip/contracts/creative-quality";
import type { ManuscriptRecord } from "@dramaip/contracts/delivery";
import type {
  StoryBibleChangeSet,
  NarrativeSummaryStatus,
} from "@dramaip/contracts/knowledge";
import type {
  AuthorIntentSummary,
  ImportExtractionChangeSet,
} from "@dramaip/contracts/workspace";
import type { Project, Task } from "@dramaip/contracts/product";
import type {
  DiagnosisSummary,
  SeasonPlanSummary,
  EpisodeDevelopmentSummary,
} from "@dramaip/contracts/production";
import {
  deriveConfirmations,
  loadConfirmations,
  type ConfirmationClient,
} from "./pending-confirmations";

const project = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "待确认作品",
} as Project;
const time = "2026-09-30T00:00:00.000Z";
test("新来源待确认只读严格摘要并精确返回原剧本／原预览，完整扫描故障不保留前页", async () => {
  const id = (n: number) =>
    `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const owner = { ...project, id: id(1) };
  const summary: import("@dramaip/contracts/production").EpisodeSourceRevisionSummary =
    {
      id: id(2),
      projectId: owner.id,
      episodeId: id(3),
      sourceScript: { id: id(4), version: 2 },
      sourceOutline: { id: id(5), version: 3 },
      document: { id: id(6), scriptId: id(7), version: 8 },
      status: "pending",
      stateVersion: 0,
      sourceState: "current",
      staleReasons: [],
      createdAt: time,
      updatedAt: time,
    };
  const calls: Array<string | undefined> = [];
  const client = fakeClient({
    projects: { list: async () => [owner] },
    episodeDevelopments: {
      scriptRevisionSummaries: async () => ({ items: [] }),
      sourceRevisionSummaries: async (_projectId, cursor) => {
        calls.push(cursor);
        return cursor
          ? {
              items: [
                {
                  ...summary,
                  id: id(8),
                  sourceState: "stale",
                  staleReasons: ["actual-source-changed"],
                },
              ],
            }
          : { items: [summary], nextCursor: summary.id };
      },
    },
  });
  const result = await loadConfirmations(client, owner.id);
  expect(calls).toEqual([undefined, summary.id]);
  expect(result.unavailable).toEqual([]);
  expect(result.items).toHaveLength(2);
  const item = result.items.find((value) => value.objectId === summary.id)!;
  expect(item.kind).toBe("author-source-revision");
  expect(item.category).toBe("waiting");
  expect(item.to).toContain(
    `resultId=${summary.sourceScript.id}&sourceRevisionId=${summary.id}`,
  );
  expect(item.to).toContain(
    `episodeId=${summary.episodeId}&operation=episode-script`,
  );
  expect(result.items.some((value) => value.category === "attention")).toBe(
    true,
  );
  for (const fault of [
    "missing",
    "later-error",
    "duplicate",
    "foreign",
    "wrong-cursor",
    "body",
  ] as const) {
    const bad = fakeClient({
      projects: { list: async () => [owner] },
      episodeDevelopments: {
        scriptRevisionSummaries: async () => ({ items: [] }),
        sourceRevisionSummaries:
          fault === "missing"
            ? undefined
            : async (_id, cursor) => {
                if (cursor && fault === "later-error")
                  throw new Error("PRIVATE /secret");
                if (cursor && fault === "foreign")
                  return {
                    items: [{ ...summary, id: id(9), projectId: id(99) }],
                  };
                if (fault === "wrong-cursor")
                  return { items: [summary], nextCursor: id(99) };
                if (fault === "body")
                  return {
                    items: [{ ...summary, input: "PRIVATE MANUSCRIPT" }],
                  };
                return cursor
                  ? { items: [summary] }
                  : { items: [summary], nextCursor: summary.id };
              },
      },
    });
    const incomplete = await loadConfirmations(bad, owner.id);
    expect(incomplete.items).toEqual([]);
    expect(incomplete.unavailable).toEqual([
      { source: "上游新来源确认", projectId: owner.id },
    ]);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});
const workflow = (
  id: string,
  stage: CreationWorkflow["stage"] = "awaiting-review",
): CreationWorkflow => ({
  id,
  taskId: `task-${id}`,
  version: 1,
  stage,
  input: {
    projectId: project.id,
    operation: "chapter",
    targetId: "chapter-2",
    instruction: "私人创作要求",
    sourceIds: [],
    engineKind: "langgraph",
  },
  sources: [],
  referenceVersions: [],
  runIds: [],
  contextSnapshotIds: [],
  contextEntries: [],
  preparedPrompt: "PRIVATE PROMPT",
  output: { title: "候选", content: "PRIVATE MANUSCRIPT", items: [] },
  issues: [],
  createdAt: time,
  updatedAt: time,
});
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: "外部调用",
  kind: "generation",
  status: "succeeded",
  resultStatus: "pending",
  attentionStatus: "open",
  progress: 1,
  projectId: project.id,
  createdAt: time,
  updatedAt: time,
  ...patch,
});
test("旧 episode 待确认明确兼容且保留原工作流和任务深链接，不改成新操作", () => {
  const old = workflow("original-episode");
  old.input.operation = "episode";
  const items = deriveConfirmations({
    projects: [project],
    tasks: [task(old.taskId)],
    workflows: [old],
    storyBible: [],
    imports: [],
    manuscripts: [],
  });
  expect(items).toHaveLength(1);
  expect(items[0]!.title).toContain("旧 episode 兼容");
  expect(items[0]!.to).toContain("workflowId=original-episode");
  expect(items[0]!.to).toContain("taskId=task-original-episode");
  expect(items[0]!.to).not.toContain("episode-development");
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
});
test("独立策略待确认按项目／工作流／候选三重核对，只显示无正文摘要并精确返回", () => {
  const run = workflow("strategy-run");
  run.input.operation = "adaptation-strategy";
  run.adaptationStrategyId = "strategy-candidate";
  const candidate = {
    id: "strategy-candidate",
    projectId: project.id,
    workflowId: run.id,
    version: 1,
    stateVersion: 0,
    status: "pending",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    createdAt: time,
    updatedAt: time,
  } as import("@dramaip/contracts/production").AdaptationStrategySummary;
  const base = {
    projects: [project],
    tasks: [task(run.taskId)],
    workflows: [run],
    storyBible: [],
    imports: [],
    manuscripts: [],
  };
  const items = deriveConfirmations({
    ...base,
    adaptationStrategies: [candidate],
  });
  expect(items).toHaveLength(1);
  expect(items[0]!.key).toBe("adaptation-strategy:strategy-candidate");
  expect(items[0]!.to).toContain(
    "workflowId=strategy-run&strategyId=strategy-candidate",
  );
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  expect(
    deriveConfirmations({
      ...base,
      adaptationStrategies: [{ ...candidate, sourceState: "stale" }],
    })[0]!.category,
  ).toBe("attention");
  expect(
    deriveConfirmations({
      ...base,
      adaptationStrategies: [{ ...candidate, projectId: "other" }],
    })[0]!.key,
  ).toBe("creation:strategy-run");
  expect(
    deriveConfirmations({
      ...base,
      adaptationStrategies: [{ ...candidate, workflowId: "unrelated" }],
    })[0]!.key,
  ).toBe("creation:strategy-run");
  expect(
    deriveConfirmations({
      ...base,
      adaptationStrategies: [{ ...candidate, status: "adopted" }],
    }),
  ).toEqual([]);
  run.stage = "failed";
  run.adaptationStrategyId = undefined;
  expect(deriveConfirmations(base)[0]!.to).toBe(
    "/projects/10000000-0000-4000-8000-000000000001/tools/adaptation-strategy?workflowId=strategy-run",
  );
});
const manuscript = (
  id: string,
  status: ManuscriptRecord["status"] = "awaiting-confirmation",
): ManuscriptRecord => ({
  id,
  status,
  version: 0,
  sourceState: "current",
  sourceIssues: [],
  createdAt: time,
  updatedAt: time,
  manifest: {
    schemaVersion: 1,
    projectId: project.id,
    projectVersion: 1,
    projectTitle: project.title,
    scope: "selected-chapters",
    chapters: [
      {
        id: "chapter-2",
        title: "第二章",
        version: 3,
        orderIndex: 1,
        contentSha256: "a".repeat(64),
      },
    ],
    format: "json",
    fileName: "稿件.json",
    contentSha256: "a".repeat(64),
    byteSize: 100,
    createdAt: time,
  },
});
const base = {
  projects: [project],
  workflows: [],
  tasks: [],
  storyBible: [],
  imports: [],
  manuscripts: [],
};
const frozenSummary: NarrativeSummaryStatus = {
  id: "summary-original",
  projectId: project.id,
  workflowId: "summary-run",
  version: 1,
  status: "adopted",
  target: { id: project.id, version: 0, kind: "book" },
  isHead: true,
  isCurrent: false,
  sourceState: "stale",
  staleReasonCount: 1,
  contextEligibility: { state: "eligible", reasonCount: 0 },
  coveredChapterCount: 2,
  createdAt: time,
  updatedAt: time,
  adoptedAt: time,
};
const formalEpisode: EpisodeDevelopmentSummary = {
  id: "formal-original",
  projectId: project.id,
  origin: "human-script-revision",
  episodeId: "original-episode",
  operation: "episode-script",
  version: 2,
  adoptedAt: time,
  isCurrent: true,
  sourceState: "stale",
  staleReasonCount: 2,
};
test("已采用分层摘要失效独立于工作流进入 attention，完整范围变化不冒充冻结来源不可用", () => {
  const items = deriveConfirmations({
    ...base,
    narrativeSummaries: [
      frozenSummary,
      { ...frozenSummary, id: "historical", isHead: false },
      { ...frozenSummary, id: "foreign", projectId: "not-listed" },
      { ...frozenSummary, id: "discarded", status: "discarded" },
    ],
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    objectId: frozenSummary.id,
    category: "attention",
    status: "完整范围已变化，原冻结范围仍可使用",
  });
  expect(items[0]!.to).toBe(
    `/projects/${project.id}/tools/quality-review?summaryId=summary-original&summaryWorkflowId=summary-run`,
  );
  expect(
    deriveConfirmations({
      ...base,
      narrativeSummaries: [
        {
          ...frozenSummary,
          contextEligibility: { state: "ineligible", reasonCount: 1 },
        },
      ],
    })[0]!.status,
  ).toBe("冻结摘要来源不可用，需复核");
  expect(
    deriveConfirmations({
      ...base,
      narrativeSummaries: [
        { ...frozenSummary, sourceState: "current", isCurrent: true },
      ],
    }),
  ).toEqual([]);
});
test("分层摘要候选精确去重关联工作流与任务，错误归属不吞掉原待确认", () => {
  const run = workflow("summary-run");
  run.input.operation = "narrative-summary";
  run.narrativeSummaryId = frozenSummary.id;
  const candidate = {
    ...frozenSummary,
    status: "awaiting-review" as const,
    isHead: false,
    sourceState: "current" as const,
  };
  const input = {
    ...base,
    workflows: [run],
    tasks: [task(run.taskId)],
    narrativeSummaries: [candidate],
  };
  expect(deriveConfirmations(input)).toHaveLength(1);
  expect(deriveConfirmations(input)[0]!.key).toBe(
    `narrative-summary:${candidate.id}`,
  );
  expect(
    deriveConfirmations({
      ...input,
      narrativeSummaries: [{ ...candidate, workflowId: "other" }],
    }).some((item) => item.key === `creation:${run.id}`),
  ).toBe(true);
  expect(JSON.stringify(deriveConfirmations(input))).not.toContain("PRIVATE");
});
test("正式单集只聚合当前失效头，人工版本没有虚构工作流并精确返回原结果", () => {
  const items = deriveConfirmations({
    ...base,
    episodeResults: [
      formalEpisode,
      { ...formalEpisode, id: "historical", isCurrent: false },
      { ...formalEpisode, id: "valid", sourceState: "current" },
      { ...formalEpisode, id: "foreign", projectId: "not-listed" },
    ],
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    objectId: formalEpisode.id,
    category: "attention",
  });
  expect(items[0]!.detail).toContain("人工确认版本，无模型工作流");
  expect(items[0]!.to).toBe(
    `/projects/${project.id}/tools/episode-development?resultId=formal-original&episodeId=original-episode&operation=episode-script`,
  );
  expect(items[0]!.to).not.toContain("workflowId");
});

test("人工正式剧本确认进入精确待确认入口，没有模型工作流或正文；失效候选仍保留待处理", () => {
  const revision = {
    id: "actual-script-preview",
    projectId: project.id,
    episodeId: "actual-episode",
    sourceResult: { id: "formal-script", version: 2 },
    document: { id: "actual-doc", version: 3, scriptId: "actual-script" },
    status: "pending" as const,
    stateVersion: 0,
    sourceState: "current" as const,
    staleReasons: [],
    createdAt: time,
    updatedAt: time,
  };
  const items = deriveConfirmations({ ...base, scriptRevisions: [revision] });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    key: "author-script-revision:actual-script-preview",
    kind: "author-script-revision",
    objectId: revision.id,
    category: "waiting",
  });
  expect(items[0]!.to).toBe(
    `/projects/${project.id}/tools/episode-development?episodeId=actual-episode&operation=episode-script&scriptRevisionId=actual-script-preview`,
  );
  expect(items[0]!.detail).toContain("实际文档 v3");
  expect(items[0]!.to).not.toContain("workflowId");
  expect(
    deriveConfirmations({
      ...base,
      scriptRevisions: [{ ...revision, sourceState: "stale" }],
    })[0]!.category,
  ).toBe("attention");
  expect(
    deriveConfirmations({
      ...base,
      scriptRevisions: [{ ...revision, status: "adopted" }],
    }),
  ).toEqual([]);
  expect(
    deriveConfirmations({
      ...base,
      scriptRevisions: [{ ...revision, status: "discarded" }],
    }),
  ).toEqual([]);
});

test("质量报告待确认保留真实版本与旧未处理问题，去重关联任务且不复制引文备注", () => {
  const run = workflow("quality");
  run.input.operation = "quality-review";
  run.narrativeReportId = "report";
  const value: NarrativeQualitySummary = {
    id: "report",
    projectId: project.id,
    workflowId: run.id,
    version: 2,
    status: "awaiting-review",
    isCurrent: false,
    sourceState: "current",
    createdAt: time,
    updatedAt: time,
    request: {
      target: { kind: "chapter", id: "chapter-2", version: 3 },
      dimensions: ["causality"],
    },
    openIssueCount: 1,
    blockerCount: 1,
    acceptedRiskCount: 0,
  };
  const items = deriveConfirmations({
    ...base,
    workflows: [run],
    tasks: [task(run.taskId)],
    narrativeReports: [value],
  });
  expect(items).toHaveLength(1);
  expect(items[0]!.to).toBe(
    `/projects/${project.id}/tools/quality-review?reportId=report&workflowId=quality`,
  );
  expect(items[0]!.category).toBe("waiting");
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  const old = {
    ...value,
    id: "old-report",
    status: "adopted" as const,
    isCurrent: false,
  };
  const clean = {
    ...value,
    status: "adopted" as const,
    isCurrent: true,
    openIssueCount: 0,
    blockerCount: 0,
  };
  const unresolved = deriveConfirmations({
    ...base,
    workflows: [{ ...run, stage: "applied" }],
    tasks: [task(run.taskId)],
    narrativeReports: [old, clean],
  });
  expect(unresolved.map((item) => item.objectId)).toEqual([old.id]);
  expect(unresolved[0]!.category).toBe("attention");
  expect(
    deriveConfirmations({
      ...base,
      narrativeReports: [{ ...clean, sourceState: "stale" }],
    }),
  ).toHaveLength(1);
  expect(
    deriveConfirmations({
      ...base,
      narrativeReports: [{ ...old, sourceState: "stale" }],
    }),
  ).toHaveLength(0);
});

test("分层摘要待确认返回精确运行和候选，不复制私人摘要、Prompt 或来源", () => {
  const run = workflow("summary-workflow");
  run.input.operation = "narrative-summary";
  run.narrativeSummaryId = "actual-summary";
  const items = deriveConfirmations({
    ...base,
    workflows: [run],
    tasks: [task(run.taskId)],
  });
  expect(items).toHaveLength(1);
  expect(items[0]!.to).toBe(
    `/projects/${project.id}/tools/quality-review?summaryWorkflowId=${run.id}&summaryId=${run.narrativeSummaryId}`,
  );
  expect(items[0]!.category).toBe("waiting");
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
});

test("单集大纲、剧本与分镜包待确认返回实际分集和工作流，不复制私人正文", () => {
  const runs = ["episode-outline", "episode-script", "storyboard-package"].map(
    (operation) => {
      const value = workflow(operation);
      value.input.operation = operation as
        "episode-outline" | "episode-script" | "storyboard-package";
      value.input.episodeDevelopmentRequest = {
        seasonPlan: { id: "plan-id", version: 2 },
        episodeId: "stable-episode-1",
      };
      return value;
    },
  );
  const items = deriveConfirmations({ ...base, workflows: runs });
  expect(items).toHaveLength(3);
  for (const item of items)
    expect(item.to).toBe(
      `/projects/${project.id}/tools/episode-development?workflowId=${item.objectId}&operation=${item.objectId}&episodeId=stable-episode-1`,
    );
  expect(JSON.stringify(items)).not.toContain("PRIVATE MANUSCRIPT");
  expect(JSON.stringify(items)).not.toContain("PRIVATE PROMPT");
});

test("季纲模型候选与人工重排按真实谱系分别返回；采用投影滞后、来源冲突和跨项目不混淆", () => {
  const run = workflow("season-workflow");
  run.input.operation = "season-plan";
  run.seasonPlanId = "root-plan";
  const summary = (
    id: string,
    patch: Partial<SeasonPlanSummary> = {},
  ): SeasonPlanSummary => ({
    id,
    projectId: project.id,
    workflowId: run.id,
    version: 1,
    stateVersion: 0,
    origin: "model",
    status: "pending",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    createdAt: time,
    updatedAt: time,
    ...patch,
  });
  const root = summary("root-plan");
  const child = summary("order-plan", {
    origin: "human-reorder",
    sourcePlanId: root.id,
    version: 2,
  });
  const unrelated = summary("foreign-plan");
  const wrongProject = summary("cross-project", {
    sourcePlanId: root.id,
    origin: "human-reorder",
    projectId: "other",
  });
  const pending = deriveConfirmations({
    ...base,
    workflows: [run],
    tasks: [task(run.taskId)],
    seasonPlans: [root, child, unrelated, wrongProject],
  });
  expect(pending.map((item) => item.key).sort()).toEqual([
    "season-plan:order-plan",
    "season-plan:root-plan",
  ]);
  expect(pending.find((item) => item.objectId === child.id)?.to).toBe(
    `/projects/${project.id}/tools/season-plan?workflowId=${run.id}&seasonPlanId=${child.id}`,
  );
  const applied = { ...run, stage: "applied" as const, seasonPlanId: child.id };
  const current = deriveConfirmations({
    ...base,
    workflows: [applied],
    tasks: [task(run.taskId)],
    seasonPlans: [
      { ...root, status: "discarded" },
      { ...child, status: "adopted", isCurrent: true },
      summary("next-order", {
        origin: "human-reorder",
        sourcePlanId: child.id,
        version: 3,
        sourceState: "stale",
      }),
    ],
  });
  expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({
    objectId: "next-order",
    category: "attention",
    status: "季纲来源冲突",
  });
  expect(JSON.stringify(current)).not.toContain("PRIVATE");
});

test("季纲摘要读取全分页，缺能力与后续失败显示未核全且不复制正文", async () => {
  const run = workflow("season-workflow");
  run.input.operation = "season-plan";
  run.seasonPlanId = "root-plan";
  const summary: SeasonPlanSummary = {
    id: "root-plan",
    projectId: project.id,
    workflowId: run.id,
    version: 1,
    stateVersion: 0,
    status: "pending",
    origin: "model",
    isCurrent: false,
    sourceState: "current",
    staleReasons: [],
    createdAt: time,
    updatedAt: time,
  };
  const creation = { list: async () => ({ items: [run] }) };
  const calls: Array<string | undefined> = [];
  const result = await loadConfirmations(
    fakeClient({
      creation,
      seasonPlans: {
        summaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? { items: [summary] }
            : { items: [], nextCursor: "actual-next" };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "actual-next"]);
  expect(result.unavailable).toEqual([]);
  expect(result.items[0]).toMatchObject({ key: "season-plan:root-plan" });
  for (const failure of ["missing", "error", "cycle"] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        creation,
        ...(failure === "missing"
          ? {}
          : {
              seasonPlans: {
                summaries: async (_id: string, cursor?: string) => {
                  if (cursor && failure === "error")
                    throw new Error("PRIVATE /secret/path");
                  return { items: [summary], nextCursor: "repeat" };
                },
              },
            }),
      }),
      project.id,
    );
    expect(incomplete.unavailable).toEqual([
      { source: "季纲来源", projectId: project.id },
    ]);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});

test("聚合实际领域状态，工作流与所属任务去重，候选不能冒充已采用", () => {
  const items = deriveConfirmations({
    ...base,
    workflows: [
      workflow("pending"),
      workflow("running", "generating"),
      workflow("failed", "failed"),
      workflow("applied", "applied"),
      workflow("discarded", "discarded"),
      workflow("canceled", "canceled"),
    ],
    tasks: [
      task("task-pending"),
      task("task-running", { status: "running" }),
      task("handled", {
        status: "failed",
        resultStatus: "none",
        attentionStatus: "acknowledged",
      }),
    ],
  });
  expect(items.map((item) => item.key).sort()).toEqual([
    "creation:failed",
    "creation:pending",
    "creation:running",
  ]);
  expect(items.find((item) => item.key === "creation:pending")).toMatchObject({
    category: "waiting",
    status: "等待审阅采用",
  });
  expect(items.find((item) => item.key === "creation:running")?.category).toBe(
    "running",
  );
  expect(items.find((item) => item.key === "creation:failed")?.category).toBe(
    "attention",
  );
  expect(items.find((item) => item.key === "creation:pending")?.to).toContain(
    "workflowId=pending",
  );
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  expect(JSON.stringify(items)).not.toContain("私人创作要求");
  expect(
    deriveConfirmations({
      ...base,
      workflows: [workflow("handled", "failed")],
      tasks: [
        task("task-handled", {
          attentionStatus: "acknowledged",
          status: "failed",
          resultStatus: "none",
        }),
      ],
    }),
  ).toEqual([]);
});

test("改编诊断候选返回精确策略工作台，已采用任务去重且不泄露诊断正文", () => {
  const value = workflow("diagnosis-workflow");
  value.input = {
    ...value.input,
    operation: "adaptation-diagnosis",
    targetId: undefined,
  };
  value.diagnosisId = "diagnosis-version-2";
  const items = deriveConfirmations({
    ...base,
    workflows: [value],
    tasks: [task(value.taskId)],
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "改编诊断",
    category: "waiting",
    to: "/projects/10000000-0000-4000-8000-000000000001/tools/adaptation-diagnosis?workflowId=diagnosis-workflow&diagnosisId=diagnosis-version-2",
  });
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  const summary: DiagnosisSummary = {
    id: value.diagnosisId!,
    projectId: project.id,
    workflowId: value.id,
    version: 2,
    stateVersion: 0,
    status: "pending",
    isCurrent: false,
    sourceState: "stale",
    staleReasons: ["来源已变化"],
    createdAt: time,
    updatedAt: time,
  };
  expect(
    deriveConfirmations({
      ...base,
      workflows: [value],
      diagnoses: [summary],
      tasks: [task(value.taskId)],
    })[0],
  ).toMatchObject({ category: "attention", status: "诊断来源冲突" });
  for (const status of ["adopted", "discarded"] as const)
    expect(
      deriveConfirmations({
        ...base,
        workflows: [value],
        diagnoses: [{ ...summary, status }],
        tasks: [task(value.taskId)],
      }),
    ).toEqual([]);
  for (const foreign of [
    { ...summary, projectId: "other" },
    { ...summary, workflowId: "other-workflow" },
    { ...summary, id: "other-diagnosis" },
  ])
    expect(
      deriveConfirmations({
        ...base,
        workflows: [value],
        diagnoses: [foreign],
      })[0],
    ).toMatchObject({ category: "waiting", status: "等待审阅采用" });
  expect(
    deriveConfirmations({
      ...base,
      workflows: [{ ...value, stage: "applied" }],
      tasks: [task(value.taskId, { resultStatus: "applied" })],
    }),
  ).toEqual([]);
});

test("旧独立修订候选进入统一列表，实际记录与任务去重且冲突不冒充可采用", () => {
  const preview = {
    id: "revision-1",
    projectId: project.id,
    chapterId: "chapter-2",
    baseVersion: 3,
    status: "pending" as const,
    createdAt: time,
  };
  const items = deriveConfirmations({
    ...base,
    revisions: [
      preview,
      { ...preview, id: "conflict", status: "conflicted" },
      { ...preview, id: "discarded", status: "discarded" },
    ],
    tasks: [
      task("revision-task", {
        result: { revisionPreview: { id: preview.id } },
      }),
    ],
  });
  expect(items.map((item) => item.key).sort()).toEqual([
    "revision:conflict",
    "revision:revision-1",
  ]);
  expect(items.find((item) => item.objectId === preview.id)?.to).toBe(
    "/tasks?projectId=10000000-0000-4000-8000-000000000001&revisionId=revision-1",
  );
  expect(items.find((item) => item.objectId === "conflict")?.category).toBe(
    "attention",
  );
});

test("费用确认来自实际待确认结果；全局任务不被当前项目误绑定", () => {
  const items = deriveConfirmations({
    ...base,
    tasks: [
      task("provider", { result: { providerActionPreviewId: "preview-1" } }),
      task("global", {
        projectId: undefined,
        result: { providerActionPreview: { id: "preview-2" } },
      }),
      task("committed", { resultStatus: "applied" }),
      task("conflict", { resultStatus: "conflicted" }),
    ],
  });
  expect(items.find((item) => item.objectId === "provider")?.status).toBe(
    "费用与外部调用待确认",
  );
  expect(items.find((item) => item.objectId === "global")?.to).toBe(
    "/tasks?taskId=global&scope=all",
  );
  expect(items.some((item) => item.objectId === "committed")).toBe(false);
  expect(items.find((item) => item.objectId === "conflict")?.category).toBe(
    "attention",
  );
});

test("所选稿件保留格式与实际记录链接，历史取消/保存不反复制造待办", () => {
  const items = deriveConfirmations({
    ...base,
    manuscripts: [
      manuscript("preview"),
      manuscript("saving", "saving"),
      manuscript("failed", "failed"),
      { ...manuscript("stale"), sourceState: "stale" },
      manuscript("canceled", "canceled"),
      manuscript("saved", "saved"),
    ],
  });
  expect(items).toHaveLength(4);
  expect(items.find((item) => item.objectId === "preview")).toMatchObject({
    detail: "所选范围 · 1 章 · JSON；作者声明不等于授权证明。",
    to: "/projects/10000000-0000-4000-8000-000000000001?manuscriptId=preview",
    category: "waiting",
  });
  expect(items.find((item) => item.objectId === "stale")?.category).toBe(
    "attention",
  );
  expect(items.find((item) => item.objectId === "saving")?.status).toBe(
    "保存中或等待核验",
  );
});

test("部分导入采用仍保留未采用候选，Story Bible 过期返回精确变更", () => {
  const change = {
    id: "bible-1",
    projectId: project.id,
    chapterId: "chapter-2",
    sourceVersion: 3,
    status: "stale",
    updatedAt: time,
  } as StoryBibleChangeSet;
  const extraction = {
    id: "import-1",
    projectId: project.id,
    status: "applied",
    candidates: [{ status: "adopted" }, { status: "draft" }],
    updatedAt: time,
  } as ImportExtractionChangeSet;
  const items = deriveConfirmations({
    ...base,
    storyBible: [change],
    imports: [extraction],
  });
  expect(items.find((item) => item.kind === "story-bible")).toMatchObject({
    category: "attention",
    to: "/create?projectId=10000000-0000-4000-8000-000000000001&chapterId=chapter-2&changeSetId=bible-1",
  });
  expect(items.find((item) => item.kind === "import")).toMatchObject({
    category: "waiting",
    detail: "1 条候选尚未采用；部分采用不等于全部完成。",
    to: "/projects/10000000-0000-4000-8000-000000000001/tools/review?extractionId=import-1",
  });
});

test("Story Bible 保留草稿生命周期，真实来源过期优先于排队或暂停，历史采用不制造待办", () => {
  const change = {
    id: "bible-source",
    projectId: project.id,
    chapterId: "chapter-2",
    sourceVersion: 3,
    status: "draft",
    sourceState: "stale",
    updatedAt: time,
  } as StoryBibleChangeSet;
  const items = deriveConfirmations({
    ...base,
    storyBible: [
      change,
      { ...change, id: "paused", status: "paused" },
      { ...change, id: "queued", status: "queued" },
      { ...change, id: "missing", sourceState: "missing" },
      { ...change, id: "current", sourceState: "current" },
      { ...change, id: "applied", status: "applied" },
      { ...change, id: "discarded", status: "discarded" },
    ],
  });
  expect(items).toHaveLength(5);
  for (const id of [change.id, "paused", "queued"])
    expect(items.find((item) => item.objectId === id)).toMatchObject({
      category: "attention",
      status: "来源版本已变化",
    });
  expect(items.find((item) => item.objectId === "missing")).toMatchObject({
    category: "attention",
    status: "来源章节不可用",
  });
  expect(items.find((item) => item.objectId === "current")?.category).toBe(
    "waiting",
  );
  expect(change.status).toBe("draft");
});

test("AI 意图待确认按候选、运行和项目三重绑定去重，精确恢复失败运行，不泄露文本", () => {
  const value = {
    ...workflow("ai-intent"),
    input: {
      ...workflow("ai-intent").input,
      operation: "author-intent" as const,
      targetId: undefined,
    },
    authorIntentId: "candidate-ai",
  };
  const candidate: AuthorIntentSummary = {
    id: "candidate-ai",
    projectId: project.id,
    workflowId: value.id,
    version: 2,
    stateVersion: 0,
    status: "pending",
    sourceState: "current",
    isCurrent: false,
    sourceKind: "ai-generated",
    sourceProjectVersion: 3,
    createdAt: time,
    updatedAt: time,
  };
  const failed = {
    ...value,
    id: "failed-intent",
    taskId: "failed-intent-task",
    stage: "failed" as const,
    authorIntentId: undefined,
  };
  const items = deriveConfirmations({
    ...base,
    authorIntents: [candidate],
    workflows: [value, failed],
  });
  expect(items).toHaveLength(2);
  expect(items.find((item) => item.objectId === candidate.id)?.to).toBe(
    "/projects/10000000-0000-4000-8000-000000000001/tools/author-intent?intentId=candidate-ai&intentWorkflowId=ai-intent",
  );
  expect(items.find((item) => item.objectId === failed.id)?.to).toBe(
    "/projects/10000000-0000-4000-8000-000000000001/tools/author-intent?intentWorkflowId=failed-intent",
  );
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  expect(
    deriveConfirmations({
      ...base,
      authorIntents: [{ ...candidate, workflowId: "unrelated" }],
      workflows: [value],
    }),
  ).toHaveLength(2);
});

test("正式作者意图候选按真实来源区分待确认与冲突，返回指定版本，不泄露约束文本", () => {
  const candidate = {
    id: "intent-1",
    projectId: project.id,
    version: 2,
    stateVersion: 0,
    status: "pending" as const,
    sourceState: "current" as const,
    isCurrent: false,
    sourceKind: "legacy-project" as const,
    sourceProjectVersion: 3,
    createdAt: time,
    updatedAt: time,
  };
  const items = deriveConfirmations({
    ...base,
    authorIntents: [
      candidate,
      { ...candidate, id: "stale", sourceState: "stale" },
      { ...candidate, id: "conflicted", status: "conflicted" },
      { ...candidate, id: "adopted", status: "adopted" },
      { ...candidate, id: "discarded", status: "discarded" },
    ],
  });
  expect(items).toHaveLength(3);
  expect(items.find((item) => item.objectId === candidate.id)).toMatchObject({
    category: "waiting",
    to: "/projects/10000000-0000-4000-8000-000000000001/tools/author-intent?intentId=intent-1",
    detail: "意图 v2 · 项目来源 v3；旧字段与候选不等于正式采用。",
  });
  expect(items.filter((item) => item.category === "attention")).toHaveLength(2);
});

function fakeClient(
  overrides: Partial<ConfirmationClient> = {},
): ConfirmationClient {
  return {
    projects: { list: async () => [project] },
    tasks: { list: async () => [] },
    creation: { list: async () => ({ items: [] }) },
    storyBible: { list: async () => [] },
    importExtractions: { list: async () => [] },
    manuscripts: { list: async () => ({ items: [] }) },
    providerActionPreviews: {
      summaries: async (projectId) => ({ projectId, items: [] }),
    },
    pilotPackages: { list: async () => ({ items: [] }) },
    revisions: { list: async () => ({ items: [] }) },
    authorIntents: { list: async () => ({ items: [] }) },
    mediaSources: { summaries: async () => ({ items: [] }) },
    audioRevisions: { summaries: async () => ({ items: [] }) },
    audioResolutions: { summaries: async () => ({ items: [] }) },
    narrativeSummaries: { summaries: async () => ({ items: [] }) },
    storyDeclarations: {
      list: async (projectId) => ({ projectId, items: [] }),
    },
    storyAssertions: {
      list: async (projectId) => ({ projectId, items: [] }),
    },
    ...overrides,
    narrativeQuality: {
      localSummaries: async (projectId) => ({ projectId, items: [] }),
      ...overrides.narrativeQuality,
    },
    episodeDevelopments: {
      summaries: async () => ({ items: [] }),
      scriptRevisionSummaries: async () => ({ items: [] }),
      topologyRevisionSummaries: async () => ({ items: [] }),
      sourceRevisionSummaries: async () => ({ items: [] }),
      ...overrides.episodeDevelopments,
    },
  };
}

type SourceNodeSummary = Awaited<
  ReturnType<NonNullable<ConfirmationClient["storyDeclarations"]>["list"]>
>["items"][number];
const localReview = (id: string): NarrativeLocalQualitySummary => ({
  id,
  projectId: project.id,
  origin: "human-declared",
  version: 1,
  status: "awaiting-review",
  request: {
    target: { kind: "chapter", id: "original-chapter", version: 2 },
    dimensions: ["causality"],
  },
  sourceFingerprint: "a".repeat(64),
  qualityState: "unverified",
  isCurrent: false,
  sourceState: "current",
  sourceReasonCount: 0,
  issueCount: 1,
  openIssueCount: 1,
  blockerCount: 1,
  acceptedRiskCount: 0,
  resolvedIssueCount: 0,
  createdAt: time,
  updatedAt: time,
});

test("独立人工／规则待确认没有假模型身份，旧已采用问题不被新干净头隐藏，未知和原ID单列", () => {
  const adopted = { ...localReview("old-error"), status: "adopted" as const },
    clean = {
      ...adopted,
      id: "new-clean",
      isCurrent: true,
      issueCount: 0,
      openIssueCount: 0,
      blockerCount: 0,
    },
    privateReview = {
      ...localReview("human"),
      source: "PRIVATE original",
      note: "PRIVATE note",
    };
  const items = deriveConfirmations({
    ...base,
    localReviews: [
      privateReview,
      { ...localReview("rule"), origin: "rule" },
      adopted,
      clean,
      { ...adopted, id: "old-unknown", sourceState: "unverified" },
      { ...clean, id: "head-unknown", sourceState: "unverified" },
      { ...localReview("stale"), sourceState: "stale" },
      { ...localReview("discarded"), status: "discarded" },
      { ...localReview("foreign"), projectId: "other" },
    ],
  });
  expect(items).toHaveLength(6);
  expect(items.find((item) => item.objectId === "human")).toMatchObject({
    kind: "narrative-local-review",
    category: "waiting",
    to: "/projects/10000000-0000-4000-8000-000000000001/tools/quality-review?localReviewId=human",
  });
  expect(items.find((item) => item.objectId === "rule")?.title).toContain(
    "逐字规则",
  );
  for (const id of ["old-error", "old-unknown", "head-unknown", "stale"])
    expect(items.find((item) => item.objectId === id)?.category).toBe(
      "attention",
    );
  expect(JSON.stringify(items)).not.toMatch(
    /PRIVATE|workflowId|reportId|sourceFingerprint/u,
  );
  expect(items.every((item) => item.detail.includes("无模型运行"))).toBe(true);
});

test("所有项目无模型运行也完整读取本地脱敏摘要，中途失败／归属／重复／游标异常拒绝整个源", async () => {
  const calls: Array<[string, string | undefined]> = [];
  const evidence = await loadConfirmations(
    fakeClient({
      projects: {
        list: async () => [
          project,
          { ...project, id: "10000000-0000-4000-8000-000000000002" },
        ],
      },
      narrativeQuality: {
        localSummaries: async (projectId, cursor) => {
          calls.push([projectId, cursor]);
          return {
            projectId,
            items: [
              {
                ...localReview(`${projectId}-${cursor ? "second" : "first"}`),
                projectId,
              },
            ],
            ...(cursor ? {} : { nextCursor: `${projectId}-first` }),
          };
        },
      },
    }),
  );
  expect(calls.sort()).toEqual(
    (
      [
        [project.id, `${project.id}-first`],
        [project.id, undefined],
        [
          "10000000-0000-4000-8000-000000000002",
          "10000000-0000-4000-8000-000000000002-first",
        ],
        ["10000000-0000-4000-8000-000000000002", undefined],
      ] as Array<[string, string | undefined]>
    ).sort(),
  );
  expect(evidence.unavailable).toEqual([]);
  expect(evidence.items).toHaveLength(4);
  expect(
    evidence.items.every((item) => item.kind === "narrative-local-review"),
  ).toBe(true);
  for (const mode of [
    "missing",
    "failed",
    "page-project",
    "item-project",
    "duplicate",
    "cursor",
    "loop",
  ] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        narrativeQuality: {
          localSummaries:
            mode === "missing"
              ? undefined
              : async (projectId, cursor) => {
                  if (mode === "failed" && cursor)
                    throw new Error("PRIVATE failure");
                  return {
                    projectId: mode === "page-project" ? "foreign" : projectId,
                    items: [
                      {
                        ...localReview(
                          cursor && mode !== "duplicate" && mode !== "loop"
                            ? "second"
                            : "first",
                        ),
                        projectId:
                          mode === "item-project" ? "foreign" : projectId,
                      },
                    ],
                    ...(cursor && mode !== "loop"
                      ? {}
                      : { nextCursor: mode === "cursor" ? "wrong" : "first" }),
                  };
                },
        },
      }),
      project.id,
    );
    expect(incomplete.unavailable).toContainEqual({
      source: "本地人工／规则评议",
      projectId: project.id,
    });
    expect(incomplete.items).toEqual([]);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});
type SourceAssertionSummary = Awaited<
  ReturnType<NonNullable<ConfirmationClient["storyAssertions"]>["list"]>
>["items"][number];
const sourceNode = (id: string): SourceNodeSummary => ({
  id,
  projectId: project.id,
  version: 0,
  status: "pending",
  title: "实际来源节点候选",
  kind: "secret",
  sourceFingerprint: "a".repeat(64),
  sourceStatus: { state: "current", reasons: [] },
  createdAt: time,
  updatedAt: time,
});
const sourceAssertion = (id: string): SourceAssertionSummary => ({
  ...sourceNode(id),
  title: "独立关系证据候选",
  kind: "relationship",
});

test("小说／保存剧本来源声明独立进入待确认，保留原项目和原 ID，只投影元数据", () => {
  const privateNode = {
      ...sourceNode("original"),
      statement: "PRIVATE 作者解释",
    },
    privateRelation = {
      ...sourceAssertion("relationship-original"),
      basis: { quote: "PRIVATE 剧本实际块" },
    };
  const items = deriveConfirmations({
    ...base,
    storyDeclarations: [
      privateNode,
      sourceNode("newer"),
      { ...sourceNode("foreign"), projectId: "not-listed" },
      { ...sourceNode("discarded"), status: "discarded" },
    ],
    storyAssertions: [
      privateRelation,
      { ...sourceAssertion("cognition-original"), kind: "cognition" },
    ],
  });
  expect(items).toHaveLength(4);
  expect(items.find((item) => item.objectId === "original")).toMatchObject({
    key: "story-declaration:original",
    kind: "story-declaration",
    projectId: project.id,
    category: "waiting",
    to: "/create?projectId=10000000-0000-4000-8000-000000000001&storyDeclarationId=original",
  });
  expect(
    items.find((item) => item.objectId === "relationship-original")!.to,
  ).toBe(
    "/create?projectId=10000000-0000-4000-8000-000000000001&storyAssertionId=relationship-original",
  );
  expect(
    items.find((item) => item.objectId === "cognition-original")!.title,
  ).toContain("认知");
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
  expect(JSON.stringify(items)).not.toContain("a".repeat(64));
});

test("来源变化／无法核对的待采用和实际已采用声明进入处理，当前已采用与已放弃不重复待确认", () => {
  const node = sourceNode("pending-stale"),
    relation = sourceAssertion("adopted-unavailable");
  const items = deriveConfirmations({
    ...base,
    storyDeclarations: [
      { ...node, sourceStatus: { state: "stale", reasons: ["PRIVATE 原文"] } },
      {
        ...node,
        id: "pending-unavailable",
        sourceStatus: { state: "unavailable", reasons: [] },
      },
      {
        ...node,
        id: "adopted-current",
        status: "adopted",
        adoptedNode: { id: "actual-node", version: 0 },
      },
      {
        ...node,
        id: "adopted-stale",
        status: "adopted",
        adoptedNode: { id: "actual-stale-node", version: 1 },
        sourceStatus: { state: "stale", reasons: [] },
      },
      {
        ...node,
        id: "discarded-stale",
        status: "discarded",
        sourceStatus: { state: "stale", reasons: [] },
      },
    ],
    storyAssertions: [
      {
        ...relation,
        status: "adopted",
        adoptedRecord: { kind: "edge", id: "actual-edge", version: 0 },
        sourceStatus: { state: "unavailable", reasons: ["PRIVATE 错误"] },
      },
      {
        ...relation,
        id: "adopted-current-edge",
        status: "adopted",
        adoptedRecord: { kind: "edge", id: "current-edge", version: 0 },
      },
      {
        ...relation,
        id: "discarded-edge",
        status: "discarded",
        sourceStatus: { state: "unavailable", reasons: [] },
      },
    ],
  });
  expect(items).toHaveLength(4);
  expect(items.every((item) => item.category === "attention")).toBe(true);
  expect(items.find((item) => item.objectId === relation.id)!.status).toContain(
    "无法核对",
  );
  expect(
    items.find((item) => item.objectId === "adopted-stale")!.title,
  ).toContain("已采用");
  expect(JSON.stringify(items)).not.toContain("PRIVATE");
});

test("明确撤回或替换的原采用绑定保留历史，但不再作为当前失效正式来源制造待办", () => {
  const lifecycle = {
    state: "withdrawn" as const,
    version: 1,
    record: { kind: "node" as const, id: "old-node", version: 1 },
  };
  const items = deriveConfirmations({
    ...base,
    storyDeclarations: [
      {
        ...sourceNode("withdrawn"),
        status: "adopted",
        adoptedNode: { id: "old-node", version: 0 },
        lifecycle,
        sourceStatus: { state: "unavailable", reasons: ["private"] },
      },
      {
        ...sourceNode("replaced"),
        status: "adopted",
        adoptedNode: { id: "old-node", version: 0 },
        lifecycle: {
          ...lifecycle,
          state: "replaced",
          replacementId: "new-node",
        },
        sourceStatus: { state: "stale", reasons: [] },
      },
      sourceNode("new-pending"),
    ],
    storyAssertions: [
      {
        ...sourceAssertion("retired-edge"),
        status: "adopted",
        adoptedRecord: { kind: "edge", id: "old-edge", version: 0 },
        lifecycle: {
          ...lifecycle,
          record: { kind: "edge", id: "old-edge", version: 1 },
        },
        sourceStatus: { state: "stale", reasons: [] },
      },
      {
        ...sourceAssertion("retired-cognition"),
        kind: "cognition",
        status: "adopted",
        adoptedRecord: { kind: "cognition", id: "old-state", version: 0 },
        lifecycle: {
          ...lifecycle,
          state: "replaced",
          replacementId: "new-state",
          record: { kind: "cognition", id: "old-state", version: 1 },
        },
        sourceStatus: { state: "unavailable", reasons: [] },
      },
    ],
  });
  expect(items.map((item) => item.objectId)).toEqual(["new-pending"]);
  expect(JSON.stringify(items)).not.toContain("private");
});

test("两种来源声明无模型运行也全项目完整分页，单项目不读取别的项目或冻结详情", async () => {
  const other = {
    ...project,
    id: "10000000-0000-4000-8000-000000000002",
    title: "第二作品",
  };
  const calls: string[] = [];
  const client = fakeClient({
    projects: { list: async () => [project, other] },
    storyDeclarations: {
      list: async (id, input = {}) => {
        calls.push(`node:${id}:${input.cursor ?? "first"}:${input.limit}`);
        return {
          projectId: id,
          items: [
            {
              ...sourceNode(`${id}-${input.cursor ? "old" : "new"}`),
              projectId: id,
            },
          ],
          ...(input.cursor ? {} : { nextCursor: `${id}-new` }),
        };
      },
    },
    storyAssertions: {
      list: async (id, input = {}) => {
        calls.push(`assertion:${id}:${input.cursor ?? "first"}:${input.limit}`);
        return {
          projectId: id,
          items: [
            {
              ...sourceAssertion(`${id}-${input.cursor ? "old" : "new"}`),
              projectId: id,
            },
          ],
          ...(input.cursor ? {} : { nextCursor: `${id}-new` }),
        };
      },
    },
  });
  const all = await loadConfirmations(client);
  expect(all.items).toHaveLength(8);
  expect(all.unavailable).toEqual([]);
  expect(calls).toHaveLength(8);
  expect(calls.every((call) => call.endsWith(":100"))).toBe(true);
  calls.length = 0;
  const scoped = await loadConfirmations(client, project.id);
  expect(scoped.items).toHaveLength(4);
  expect(scoped.items.every((item) => item.projectId === project.id)).toBe(
    true,
  );
  expect(calls).toHaveLength(4);
  expect(calls.some((call) => call.includes(other.id))).toBe(false);
});

for (const source of ["storyDeclarations", "storyAssertions"] as const) {
  for (const mode of [
    "later-error",
    "cursor-cycle",
    "duplicate",
    "foreign-page",
    "foreign-item",
    "wrong-cursor",
    "invalid-adoption",
    "missing",
  ] as const) {
    test(`${source} ${mode} 整个领域明确未核全，不留下前页候选或泄露错误正文`, async () => {
      const value =
        source === "storyDeclarations"
          ? sourceNode("original")
          : sourceAssertion("original");
      const broken = fakeClient({
        [source]:
          mode === "missing"
            ? undefined
            : {
                list: async (id: string, input: { cursor?: string } = {}) => {
                  if (input.cursor && mode === "later-error")
                    throw new Error("PRIVATE 原文／本地路径");
                  return {
                    projectId: mode === "foreign-page" ? "other" : id,
                    items: [
                      {
                        ...value,
                        ...(mode === "foreign-item"
                          ? { projectId: "other" }
                          : {}),
                        ...(mode === "invalid-adoption"
                          ? { status: "adopted" }
                          : {}),
                      },
                    ],
                    ...(mode === "wrong-cursor"
                      ? { nextCursor: "not-the-last-id" }
                      : mode === "cursor-cycle" || !input.cursor
                        ? { nextCursor: value.id }
                        : {}),
                  };
                },
              },
      });
      const result = await loadConfirmations(broken, project.id);
      expect(result.items).toEqual([]);
      expect(result.unavailable).toEqual([
        {
          source:
            source === "storyDeclarations"
              ? "原文来源节点声明"
              : "原文来源关系与认知声明",
          projectId: project.id,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    });
  }
}

test("全项目只读聚合分页状态且不依赖模型运行，后页失败／循环／缺能力必须明确未核全", async () => {
  const other = {
    ...project,
    id: "10000000-0000-4000-8000-000000000002",
    title: "另一作品",
  };
  const calls: string[] = [];
  const client = fakeClient({
    projects: { list: async () => [project, other] },
    narrativeSummaries: {
      summaries: async (id, cursor) => {
        calls.push(`summary:${id}:${cursor ?? "first"}`);
        return cursor
          ? {
              items: [{ ...frozenSummary, projectId: id, id: `summary-${id}` }],
            }
          : { items: [], nextCursor: "actual-second-page" };
      },
    },
    episodeDevelopments: {
      scriptRevisionSummaries: async () => ({ items: [] }),
      summaries: async (id) => ({
        items: [
          { ...formalEpisode, id: `formal-${id}`, projectId: id },
          { ...formalEpisode, id: "foreign", projectId: "not-listed" },
        ],
      }),
    },
  });
  const result = await loadConfirmations(client);
  expect(result.unavailable).toEqual([]);
  expect(result.items).toHaveLength(4);
  expect(new Set(result.items.map((item) => item.projectId))).toEqual(
    new Set([project.id, other.id]),
  );
  expect(calls).toHaveLength(4);
  expect(calls).toContain(`summary:${other.id}:actual-second-page`);
  for (const mode of ["failed", "loop", "missing"] as const) {
    const broken = fakeClient({
      narrativeSummaries:
        mode === "missing"
          ? undefined
          : {
              summaries: async (_id, cursor) => {
                if (cursor && mode === "failed")
                  throw new Error("owner unavailable");
                return { items: [frozenSummary], nextCursor: "same-real-page" };
              },
            },
    });
    broken.episodeDevelopments = undefined;
    const incomplete = await loadConfirmations(broken, project.id);
    expect(incomplete.items).toEqual([]);
    expect(incomplete.unavailable).toContainEqual({
      source: "分层摘要范围与来源",
      projectId: project.id,
    });
    expect(incomplete.unavailable).toContainEqual({
      source: "正式单集来源",
      projectId: project.id,
    });
  }
});
const mediaSummary = {
  id: "source-review",
  projectId: project.id,
  recordId: "record",
  recordVersion: 3,
  shotId: "shot",
  shotVersion: 2,
  state: "pending" as const,
  stateVersion: 0,
  sourceState: "current" as const,
  reasonCount: 0,
  createdAt: time,
  updatedAt: time,
};
const audioSummary = {
  id: "audio-review",
  projectId: project.id,
  episodeId: "episode",
  sourceTrackId: "track",
  state: "pending" as const,
  stateVersion: 0,
  sourceState: "current" as const,
  isCurrent: false,
  originalVersion: 1,
  candidateId: "draft",
  candidateClipCount: 2,
  mappedCount: 1,
  removedCount: 1,
  addedCount: 1,
  reasonCount: 0,
  createdAt: time,
  updatedAt: time,
};
const timelineSummary = {
  id: "resolution",
  projectId: project.id,
  episodeId: "episode",
  timelineId: "timeline",
  state: "pending" as const,
  stateVersion: 0,
  sourceState: "current" as const,
  isCurrent: false,
  timelineVersion: 4,
  changeCount: 2,
  replaceCount: 1,
  removeCount: 1,
  protectedCount: 1,
  reasonCount: 0,
  createdAt: time,
  updatedAt: time,
};

test("三类媒体待确认仅映射身份计数，历史不反复出现，修订新草稿采用是独立状态", () => {
  const items = deriveConfirmations({
    ...base,
    mediaSourceReviews: [
      mediaSummary,
      mediaSummary,
      { ...mediaSummary, id: "adopted", state: "adopted" },
      { ...mediaSummary, id: "discarded", state: "discarded" },
    ],
    audioRevisions: [
      audioSummary,
      {
        ...audioSummary,
        id: "draft-wait",
        state: "confirmed",
        isCurrent: true,
        targetStatus: "draft",
        targetTrackId: "new-track",
        targetVersion: 0,
      },
      {
        ...audioSummary,
        id: "missing",
        state: "confirmed",
        isCurrent: true,
        targetStatus: "missing",
      },
      {
        ...audioSummary,
        id: "adopted-audio",
        state: "confirmed",
        isCurrent: true,
        targetStatus: "adopted",
      },
      {
        ...audioSummary,
        id: "old-confirmed",
        state: "confirmed",
        targetStatus: "draft",
      },
      { ...audioSummary, id: "discarded-audio", state: "discarded" },
    ],
    audioResolutions: [
      timelineSummary,
      { ...timelineSummary, id: "stale", sourceState: "stale" },
      {
        ...timelineSummary,
        id: "confirmed",
        state: "confirmed",
        isCurrent: true,
      },
      { ...timelineSummary, id: "discarded-resolution", state: "discarded" },
    ],
  });
  expect(items).toHaveLength(6);
  expect(items.find((item) => item.objectId === "draft-wait")).toMatchObject({
    title: "音轨修订新草稿待采用",
    category: "waiting",
  });
  expect(items.find((item) => item.objectId === "missing")?.category).toBe(
    "attention",
  );
  expect(items.find((item) => item.objectId === "stale")?.category).toBe(
    "attention",
  );
  expect(items.find((item) => item.objectId === mediaSummary.id)?.to).toBe(
    "/produce?projectId=10000000-0000-4000-8000-000000000001&mediaSourceReviewId=source-review&recordId=record",
  );
  expect(items.find((item) => item.objectId === audioSummary.id)?.to).toContain(
    "audioRevisionId=audio-review&sourceTrackId=track",
  );
  expect(
    items.find((item) => item.objectId === timelineSummary.id)?.to,
  ).toContain("audioResolutionId=resolution&timelineId=timeline");
});

test("三类媒体摘要读全分页、隔离项目、去重，缺能力与后页失败均明确未核全", async () => {
  const calls: string[] = [];
  const complete = await loadConfirmations(
    fakeClient({
      mediaSources: {
        summaries: async (id, cursor) => {
          calls.push(`source:${id}:${cursor ?? "first"}`);
          return cursor
            ? {
                items: [
                  mediaSummary,
                  { ...mediaSummary, id: "foreign", projectId: "other" },
                ],
              }
            : { items: [mediaSummary], nextCursor: "source-next" };
        },
      },
      audioRevisions: {
        summaries: async (_id, cursor) =>
          cursor
            ? { items: [audioSummary] }
            : { items: [], nextCursor: "audio-next" },
      },
      audioResolutions: {
        summaries: async (_id, cursor) =>
          cursor
            ? { items: [timelineSummary] }
            : { items: [], nextCursor: "timeline-next" },
      },
    }),
    project.id,
  );
  expect(complete.items).toHaveLength(3);
  expect(complete.unavailable).toEqual([]);
  expect(calls).toEqual([
    `source:${project.id}:first`,
    `source:${project.id}:source-next`,
  ]);
  for (const family of [
    "mediaSources",
    "audioRevisions",
    "audioResolutions",
  ] as const) {
    for (const mode of ["missing", "failure", "loop"] as const) {
      const result = await loadConfirmations(
        fakeClient({
          [family]:
            mode === "missing"
              ? undefined
              : {
                  summaries: async (_id: string, cursor?: string) => {
                    if (mode === "failure" && cursor)
                      throw new Error("PRIVATE owner failure");
                    return { items: [], nextCursor: "repeat" };
                  },
                },
        }),
        project.id,
      );
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0]?.projectId).toBe(project.id);
      expect(result.items).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    }
  }
});

test("人工剧本确认摘要读全分页且隔离项目，读取失败或循环明确未核全", async () => {
  const summary = {
    id: "manual-1",
    projectId: project.id,
    episodeId: "episode",
    sourceResult: { id: "source", version: 1 },
    document: { id: "doc", version: 1, scriptId: "script" },
    status: "pending" as const,
    stateVersion: 0,
    sourceState: "current" as const,
    staleReasons: [],
    createdAt: time,
    updatedAt: time,
  };
  const calls: Array<string | undefined> = [];
  const complete = await loadConfirmations(
    fakeClient({
      episodeDevelopments: {
        scriptRevisionSummaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? {
                items: [
                  { ...summary, id: "manual-2", sourceState: "stale" },
                  { ...summary, id: "foreign", projectId: "other" },
                ],
              }
            : { items: [summary], nextCursor: "actual-next" };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "actual-next"]);
  expect(complete.items.map((item) => item.key).sort()).toEqual([
    "author-script-revision:manual-1",
    "author-script-revision:manual-2",
  ]);
  for (const mode of ["failed", "loop"] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        episodeDevelopments: {
          scriptRevisionSummaries: async (_id, cursor) => {
            if (cursor && mode === "failed")
              throw new Error("owner unavailable");
            return { items: [summary], nextCursor: "actual-next" };
          },
        },
      }),
      project.id,
    );
    expect(incomplete.unavailable).toContainEqual({
      source: "人工剧本确认",
      projectId: project.id,
    });
    expect(incomplete.items).toEqual([]);
  }
});

test("作者场景拓扑待确认仅用无正文元数据精确返回原双头，旧能力缺失与分页失败不当零待办", async () => {
  const summary: import("@dramaip/contracts/production").EpisodeTopologyRevisionSummary =
    {
      id: "topology-pending",
      projectId: project.id,
      episodeId: "episode",
      sourceScript: { id: "original-formal-script", version: 2 },
      sourceOutline: { id: "original-formal-outline", version: 1 },
      document: {
        id: "actual-document",
        scriptId: "actual-script",
        version: 3,
      },
      status: "pending",
      stateVersion: 0,
      sourceState: "current",
      staleReasons: [],
      createdAt: time,
      updatedAt: time,
    };
  const calls: Array<string | undefined> = [];
  const complete = await loadConfirmations(
    fakeClient({
      episodeDevelopments: {
        scriptRevisionSummaries: async () => ({ items: [] }),
        topologyRevisionSummaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? {
                items: [
                  { ...summary, id: "second", sourceState: "stale" },
                  { ...summary, id: "foreign", projectId: "other" },
                ],
              }
            : { items: [summary], nextCursor: "exact-next" };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "exact-next"]);
  expect(complete.unavailable).toEqual([]);
  expect(complete.items.map((item) => item.kind)).toEqual([
    "author-topology-revision",
    "author-topology-revision",
  ]);
  const current = complete.items.find((item) => item.objectId === summary.id)!;
  expect(current.to).toContain(
    `resultId=${summary.sourceScript.id}&topologyRevisionId=${summary.id}`,
  );
  expect(current.to).not.toMatch(/workflowId|latest/u);
  expect(current.detail).toContain("无模型运行");
  expect(JSON.stringify(complete)).not.toMatch(
    /outlineContent|scriptContent|sourceEvidence|rationale|preparedPrompt/u,
  );
  for (const mode of ["missing", "failed", "loop"] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        episodeDevelopments: {
          scriptRevisionSummaries: async () => ({ items: [] }),
          topologyRevisionSummaries:
            mode === "missing"
              ? undefined
              : async (_id, cursor) => {
                  if (mode === "failed" && cursor)
                    throw new Error("PRIVATE owner fault");
                  return { items: [summary], nextCursor: "repeat" };
                },
        },
      }),
      project.id,
    );
    expect(incomplete.unavailable).toContainEqual({
      source: "作者场景拓扑确认",
      projectId: project.id,
    });
    expect(incomplete.items).toEqual([]);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});

test("质量摘要读取实际后续游标并隔离项目，失败或缺能力不冒充空待办", async () => {
  const run = workflow("quality-workflow");
  run.input.operation = "quality-review";
  run.narrativeReportId = "report";
  const summary: NarrativeQualitySummary = {
    id: "report",
    projectId: project.id,
    workflowId: run.id,
    version: 1,
    status: "awaiting-review",
    isCurrent: false,
    sourceState: "stale",
    createdAt: time,
    updatedAt: time,
    request: {
      target: { kind: "chapter", id: "chapter-2", version: 3 },
      dimensions: ["causality"],
    },
    openIssueCount: 1,
    blockerCount: 1,
    acceptedRiskCount: 0,
  };
  const calls: Array<string | undefined> = [];
  const creation = { list: async () => ({ items: [run] }) };
  const evidence = await loadConfirmations(
    fakeClient({
      creation,
      narrativeQuality: {
        summaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? { items: [summary] }
            : {
                items: [{ ...summary, id: "foreign", projectId: "other" }],
                nextCursor: "older",
              };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "older"]);
  expect(evidence.unavailable).toEqual([]);
  expect(evidence.items.map((item) => item.objectId)).toEqual([summary.id]);
  expect(evidence.items[0]!.category).toBe("attention");
  for (const client of [
    fakeClient({ creation }),
    fakeClient({
      creation,
      narrativeQuality: {
        summaries: async () => {
          throw new Error("OFFLINE");
        },
      },
    }),
  ]) {
    expect(
      (await loadConfirmations(client, project.id)).unavailable,
    ).toContainEqual({ source: "质量报告与问题", projectId: project.id });
  }
});

test("诊断摘要读取全部真实游标、隔离归属，失败或缺能力明确未核全", async () => {
  const value = workflow("diagnosis-workflow");
  value.input.operation = "adaptation-diagnosis";
  value.diagnosisId = "diagnosis-old";
  const summary: DiagnosisSummary = {
    id: value.diagnosisId,
    workflowId: value.id,
    projectId: project.id,
    version: 2,
    stateVersion: 0,
    status: "pending",
    isCurrent: false,
    sourceState: "stale",
    staleReasons: ["来源已变化"],
    createdAt: time,
    updatedAt: time,
  };
  const creation = { list: async () => ({ items: [value] }) };
  const calls: Array<string | undefined> = [];
  const complete = await loadConfirmations(
    fakeClient({
      creation,
      diagnoses: {
        summaries: async (_id, cursor) => {
          calls.push(cursor);
          return cursor
            ? { items: [summary] }
            : {
                items: [
                  { ...summary, projectId: "other", sourceState: "current" },
                ],
                nextCursor: "older",
              };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "older"]);
  expect(complete.unavailable).toEqual([]);
  expect(complete.items).toHaveLength(1);
  expect(complete.items[0]).toMatchObject({
    category: "attention",
    status: "诊断来源冲突",
  });
  for (const failure of ["missing", "error", "cycle"] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        creation,
        ...(failure === "missing"
          ? {}
          : {
              diagnoses: {
                summaries: async (_id: string, cursor?: string) => {
                  if (cursor && failure === "error")
                    throw new Error("PRIVATE /secret/path");
                  return { items: [summary], nextCursor: "repeat" };
                },
              },
            }),
      }),
      project.id,
    );
    expect(incomplete.unavailable).toEqual([
      { source: "诊断来源", projectId: project.id },
    ]);
    expect(incomplete.items).toHaveLength(1);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});

test("作者意图读取全部真实游标、隔离归属；后续失败或循环不冒充零待办", async () => {
  const candidate = (id: string): AuthorIntentSummary => ({
    id,
    projectId: project.id,
    version: 1,
    stateVersion: 0,
    status: "pending",
    sourceState: "current",
    isCurrent: false,
    sourceKind: "manual",
    sourceProjectVersion: 0,
    createdAt: time,
    updatedAt: time,
  });
  const calls: Array<string | undefined> = [];
  const paginated = await loadConfirmations(
    fakeClient({
      authorIntents: {
        list: async (_projectId, cursor) => {
          calls.push(cursor);
          return cursor
            ? {
                items: [
                  candidate("older-intent"),
                  { ...candidate("foreign-intent"), projectId: "other" },
                ],
              }
            : { items: [candidate("new-intent")], nextCursor: "older" };
        },
      },
    }),
    project.id,
  );
  expect(calls).toEqual([undefined, "older"]);
  expect(paginated.unavailable).toEqual([]);
  expect(paginated.items.map((item) => item.key)).toEqual([
    "author-intent:new-intent",
    "author-intent:older-intent",
  ]);
  for (const failure of ["error", "cycle"] as const) {
    const incomplete = await loadConfirmations(
      fakeClient({
        authorIntents: {
          list: async (_projectId, cursor) => {
            if (cursor && failure === "error")
              throw new Error("PRIVATE source /secret/path");
            return { items: [candidate("partial")], nextCursor: "repeat" };
          },
        },
      }),
      project.id,
    );
    expect(incomplete.items).toEqual([]);
    expect(incomplete.unavailable).toEqual([
      { source: "作者意图", projectId: project.id },
    ]);
    expect(JSON.stringify(incomplete)).not.toContain("PRIVATE");
  }
});

test("读取后续真实游标，不遗漏旧候选；按实际项目归属隔离", async () => {
  const calls: string[] = [];
  const client = fakeClient({
    creation: {
      list: async (id: string, _target?: string, cursor?: string) => {
        calls.push(`${id}:${cursor ?? "first"}`);
        return cursor
          ? {
              items: [
                workflow("old"),
                {
                  ...workflow("wrong-project"),
                  input: {
                    ...workflow("wrong-project").input,
                    projectId: "other",
                  },
                },
              ],
            }
          : { items: [workflow("new")], nextCursor: "older" };
      },
    },
    manuscripts: {
      list: async (_id: string, cursor?: string) =>
        cursor
          ? { items: [manuscript("old-manuscript")] }
          : { items: [], nextCursor: "older-manuscript" },
    },
  });
  const result = await loadConfirmations(client, project.id);
  expect(calls).toEqual([
    "10000000-0000-4000-8000-000000000001:first",
    "10000000-0000-4000-8000-000000000001:older",
  ]);
  expect(result.unavailable).toEqual([]);
  expect(result.items.map((item) => item.key).sort()).toEqual([
    "creation:new",
    "creation:old",
    "manuscript:old-manuscript",
  ]);
});

test("分页循环或领域读取失败必须明确未核全，不能当成零待办", async () => {
  const client = fakeClient({
    creation: {
      list: async () => ({
        items: [workflow("partial")],
        nextCursor: "repeat",
      }),
    },
    storyBible: {
      list: async () => {
        throw new Error("PRIVATE /secret/path");
      },
    },
    manuscripts: {
      list: async () => ({ items: [manuscript("actual")] }),
    },
  });
  const result = await loadConfirmations(client, project.id);
  expect(result.items.map((item) => item.key)).toEqual(["manuscript:actual"]);
  expect(result.unavailable).toEqual(
    expect.arrayContaining([
      { source: "创作候选", projectId: project.id },
      { source: "Story Bible", projectId: project.id },
    ]),
  );
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  await expect(loadConfirmations(fakeClient(), "deleted")).rejects.toThrow(
    "指定项目已不存在",
  );
});

test("全局范围包含多个项目与全局任务，单项目范围不混入其他作品", async () => {
  const other = { ...project, id: "other", title: "另一个作品" };
  const client = fakeClient({
    projects: {
      list: async () => [project, other],
    },
    tasks: {
      list: async () => [
        task("global", { projectId: undefined }),
        task("other-task", { projectId: other.id }),
      ],
    },
    creation: {
      list: async (id: string) => ({
        items: [
          { ...workflow(id), input: { ...workflow(id).input, projectId: id } },
        ],
      }),
    },
  });
  expect((await loadConfirmations(client)).items).toHaveLength(4);
  expect(
    (await loadConfirmations(client, project.id)).items.map((item) => item.key),
  ).toEqual(["creation:10000000-0000-4000-8000-000000000001"]);
});
