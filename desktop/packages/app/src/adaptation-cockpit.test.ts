import { expect, test } from "vitest";
import type { Project } from "@dramaip/contracts/product";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AdaptationCockpitEvidence } from "./adaptation-cockpit-evidence";
import { deriveAdaptationCockpit } from "./adaptation-cockpit";

const project = { id: "project", version: 1 } as Project;
const ref = (id: string, version = 1) => ({ id, version });
const time = "2026-10-01T00:00:00.000Z";
function fixture(): AdaptationCockpitEvidence {
  const intent = {
    ...ref("intent"),
    projectId: project.id,
    status: "adopted",
    isCurrent: true,
    sourceState: "current",
    adoptedAt: time,
  };
  const chapter = { ...ref("chapter"), contentHash: "hash" };
  const diagnosis = {
    ...ref("diagnosis"),
    projectId: project.id,
    status: "adopted",
    isCurrent: true,
    sourceState: "current",
    adoptedAt: time,
    authorIntent: ref("intent"),
    selectedStrategyId: "strategy",
    content: { strategies: [{ id: "strategy" }] },
    basis: { chapters: [chapter], omittedChapters: [ref("omitted")] },
  };
  const plan = {
    ...ref("plan"),
    projectId: project.id,
    status: "adopted",
    isCurrent: true,
    sourceState: "current",
    adoptedAt: time,
    basis: {
      diagnosis: { ...ref("diagnosis"), strategyId: "strategy" },
      authorIntent: ref("intent"),
    },
    coverage: [
      { chapterId: "chapter", chapterVersion: 1, disposition: "used" },
    ],
    content: {
      episodes: [
        { id: "second", orderIndex: 1 },
        { id: "first", orderIndex: 0 },
      ],
    },
  };
  const basis = {
    request: { seasonPlan: ref("plan"), episodeId: "first" },
    diagnosis: { ...ref("diagnosis"), strategyId: "strategy" },
    authorIntent: ref("intent"),
    episode: { id: "first" },
    chapters: [chapter],
  };
  const result = (id: string, operation: string) => ({
    ...ref(id),
    projectId: project.id,
    episodeId: "first",
    operation,
    isCurrent: true,
    sourceState: "current",
    adoptedAt: time,
    basis,
    content: { kind: operation, value: {} },
  });
  const outline = result("outline", "episode-outline");
  const script = {
    ...result("script", "episode-script"),
    basis: { ...basis, request: { ...basis.request, outline: ref("outline") } },
    scriptId: "native-script",
    episodeRecordId: "native-episode",
    scriptDocumentVersion: 4,
  };
  const storyboard = {
    ...result("storyboard", "storyboard-package"),
    basis: {
      ...basis,
      request: {
        ...basis.request,
        outline: ref("outline"),
        script: ref("script"),
      },
    },
    productionRecords: [{ kind: "scenes" }, { kind: "shots" }],
  };
  const saved = {
    ...ref("package"),
    createdAt: time,
    status: "saved",
    sourceState: "current",
    rights: { confirmed: true },
    archive: { sha256: "sha", byteSize: 64 },
    receipt: { sha256: "sha", byteSize: 64 },
    manifest: {
      projectId: project.id,
      projectVersion: 1,
      episodeId: "first",
      scriptRecordId: "native-script",
      scriptDocumentVersion: 4,
      adopted: {
        authorIntent: ref("intent"),
        diagnosis: { ...ref("diagnosis"), strategyId: "strategy" },
        seasonPlan: ref("plan"),
        outline: ref("outline"),
        script: ref("script"),
        storyboard: ref("storyboard"),
      },
      preflight: { blockers: [], checks: [{ state: "unknown" }] },
    },
  };
  return {
    intent: { current: intent },
    sources: {
      projectId: project.id,
      authorIntent: ref("intent"),
      adoptedDiagnosisId: "diagnosis",
      inventoryFingerprint: "fingerprint",
      chapters: [chapter],
    },
    diagnoses: [diagnosis],
    plans: [plan],
    episodes: [outline, script, storyboard],
    workflows: [],
    packages: [saved],
  } as unknown as AdaptationCockpitEvidence;
}
const derive = (evidence: AdaptationCockpitEvidence) =>
  deriveAdaptationCockpit(project, evidence);

test("新主流程没有旧季纲时推荐独立策略，诊断单独采用不要求重复旧策略选择", () => {
  const e = fixture();
  e.plans = [];
  e.episodes = [];
  e.packages = [];
  delete e.diagnoses[0]!.selectedStrategyId;
  const result = derive(e);
  expect(result.gates).toHaveLength(6);
  expect(result.gates![1]!.status).toBe("ready");
  expect(result.gates![2]!.status).toBe("pending");
  expect(result.primaryAction.to).toContain("tools/adaptation-strategy");
  expect(result.gates![3]!.status).not.toBe("ready");
  // A foreign old plan cannot route a fresh project into compatibility.
  e.plans = [{ ...fixture().plans[0]!, projectId: "foreign" }];
  expect(derive(e).primaryAction.to).toContain("tools/adaptation-strategy");
  expect(deriveAdaptationCockpit(project).gates).toHaveLength(6);
});

test("只有真实同项目旧季纲可保留五 Gate；新诊断不被旧季纲拖回兼容策略", () => {
  const e = fixture();
  expect(derive(e).gates).toHaveLength(5);
  delete e.diagnoses[0]!.selectedStrategyId;
  expect(derive(e).gates).toHaveLength(6);
  expect(derive(e).gates![1]!.status).toBe("ready");
  expect(derive(e).primaryAction.to).toContain("tools/adaptation-strategy");
});

test("独立策略有单独 Gate，实际版本贯穿季纲／单集／包，旧诊断选项不能替代", () => {
  const e = fixture();
  const selected = { ...ref("independent"), optionId: "new-option" };
  e.strategies = [
    {
      ...ref("independent"),
      projectId: project.id,
      workflowId: "strategy-run",
      status: "adopted",
      isCurrent: true,
      sourceState: "current",
      adoptedAt: time,
      selectedOptionId: "new-option",
      basis: { diagnosis: ref("diagnosis"), authorIntent: ref("intent") },
      content: { options: [{ id: "new-option" }] },
    },
  ] as unknown as NonNullable<AdaptationCockpitEvidence["strategies"]>;
  expect(derive(e).gates).toHaveLength(6);
  expect(derive(e).gates![2]!.status).toBe("ready");
  expect(derive(e).gates![3]!.status).not.toBe("ready");
  e.plans[0]!.basis.strategy = selected;
  e.plans[0]!.basis.diagnosis.strategyId = selected.optionId;
  for (const item of e.episodes) {
    item.basis.strategy = selected;
    item.basis.diagnosis!.strategyId = selected.optionId;
  }
  e.packages[0]!.manifest.adopted.strategy = selected;
  e.packages[0]!.manifest.adopted.diagnosis!.strategyId = selected.optionId;
  expect(derive(e).gates!.every((item) => item.status === "ready")).toBe(true);
  expect(derive(e).primaryAction.to).toContain("pilotPackageId=package");
  expect(derive(e).primaryAction.to).toBe(derive(e).gates!.at(-1)!.to);
  expect(
    derive(e).coverage.find((item) => item.label === "当前正式 Gate"),
  ).toMatchObject({ current: 6, required: 6 });
  e.strategies[0]!.sourceState = "stale";
  e.strategies[0]!.staleReasons = ["来源已变化"];
  expect(derive(e).primaryAction.to).toContain("tools/adaptation-strategy");
  expect(
    derive(e)
      .gates!.slice(2)
      .every((item) => item.status !== "ready"),
  ).toBe(true);
});

test("独立策略未采用不能由模型成功、旧诊断方向或同名其他项目填补", () => {
  const e = fixture();
  e.strategies = [
    {
      ...ref("pending-strategy"),
      projectId: project.id,
      workflowId: "strategy-run",
      status: "pending",
      isCurrent: false,
      sourceState: "current",
      basis: { diagnosis: ref("diagnosis") },
    },
  ] as unknown as NonNullable<AdaptationCockpitEvidence["strategies"]>;
  const result = derive(e);
  expect(result.gates).toHaveLength(6);
  expect(result.primaryAction.to).toContain("strategyId=pending-strategy");
  expect(result.gates![2]!.status).not.toBe("ready");
  expect(result.gates!.slice(3).every((item) => item.status !== "ready")).toBe(
    true,
  );
});

test("五个 Gate 来自同一正式版本链，内部保存不冒充质量或发行通过", () => {
  const result = derive(fixture());
  expect(result.gates).toHaveLength(5);
  expect(result.gates!.every((item) => item.status === "ready")).toBe(true);
  expect(result.status).toBe("delivered");
  expect(result.statusLabel).toContain("发行仍待核验");
  expect(result.primaryAction.to).toContain("pilotPackageId=package");
  expect(result.gates![2]!.detail).toContain("当前首集 first");
  expect(result.gates![3]!.detail).toContain("稳定块剧本 v1");
  expect(JSON.stringify(result)).not.toContain("preparedPrompt");
});

test("无真实正文或明确采用意图必须回到第一阶段，不能跳到历史下游", () => {
  const e = fixture();
  e.sources.chapters = [];
  expect(derive(e).primaryAction.label).toBe("补充实际来源正文");
  expect(derive(e).gates!.every((item) => item.status !== "ready")).toBe(true);
  e.sources.chapters = fixture().sources.chapters;
  e.intent.current!.status = "pending";
  expect(derive(e).primaryAction.to).toContain("intentId=intent");
  expect(derive(e).gates![0]!.status).toBe("pending");
});

test("诊断来源、唯一策略或采用头冲突返回诊断，历史成果保留为 stale", () => {
  for (const mutate of [
    (e: AdaptationCockpitEvidence) => {
      e.diagnoses[0]!.selectedStrategyId = "missing";
    },
    (e: AdaptationCockpitEvidence) => {
      e.diagnoses[0]!.authorIntent.version = 0;
    },
    (e: AdaptationCockpitEvidence) => {
      e.sources.adoptedDiagnosisId = "another";
    },
    (e: AdaptationCockpitEvidence) => {
      e.diagnoses[0]!.sourceState = "stale";
    },
  ]) {
    const e = fixture();
    mutate(e);
    expect(derive(e).gates![1]!.status).toBe("stale");
    expect(derive(e).primaryAction.to).toContain("diagnosisId=diagnosis");
    expect(
      derive(e)
        .gates!.slice(1)
        .every((item) => item.status !== "ready"),
    ).toBe(true);
  }
  const e = fixture();
  e.diagnoses.push({ ...e.diagnoses[0]!, id: "duplicate" });
  expect(derive(e).gates![1]!.status).toBe("unverified");
});

test("整季方案必须继承当前诊断策略并交代全部范围，重排不丢稳定首集", () => {
  const e = fixture();
  e.plans[0]!.coverage[0]!.disposition = "unaccounted";
  expect(derive(e).primaryAction.to).toContain("seasonPlanId=plan");
  e.plans[0]!.coverage = fixture().plans[0]!.coverage;
  e.plans[0]!.basis.diagnosis.strategyId = "another";
  expect(derive(e).gates![2]!.status).toBe("stale");
  e.plans[0]!.basis.diagnosis.strategyId = "strategy";
  e.plans[0]!.content.episodes[0]!.orderIndex = 0;
  e.plans[0]!.content.episodes[1]!.orderIndex = 1;
  expect(derive(e).gates![2]!.status).toBe("ready");
  expect(derive(e).gates![3]!.status).toBe("pending");
  expect(derive(e).primaryAction.to).toContain("episodeId=second");
  expect(derive(e).primaryAction.to).toContain("operation=episode-outline");
});

test("首集剧本须继承正式大纲和本季版本，空稿与其他集不能完成", () => {
  const e = fixture();
  e.episodes[1]!.basis.request.outline!.version = 0;
  expect(derive(e).gates![3]!.status).toBe("stale");
  expect(derive(e).primaryAction.to).toContain("operation=episode-script");
  e.episodes[1] = fixture().episodes[1]!;
  delete e.episodes[1]!.scriptDocumentVersion;
  expect(derive(e).gates![3]!.status).toBe("stale");
  e.episodes = [];
  expect(derive(e).primaryAction.to).toContain("operation=episode-outline");
});

test("正式分镜须继承当前首集剧本及真实生产记录；媒体不是保存前置", () => {
  const e = fixture();
  e.episodes[2]!.basis.request.script!.version = 0;
  expect(derive(e).primaryAction.label).toBe("开发首集分镜包");
  e.episodes[2] = fixture().episodes[2]!;
  e.episodes[2]!.productionRecords = [];
  expect(derive(e).gates![4]!.status).toBe("stale");
  e.episodes[2] = fixture().episodes[2]!;
  e.packages = [];
  expect(derive(e).primaryAction.label).toBe("核验并保存内部试制包");
  expect(derive(e).primaryAction.description).toContain("不要求先生成静帧");
});

test("预览、取消、缺回执、伪摘要、旧来源和未确认权利均不显示当前交付", () => {
  for (const mutate of [
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.status = "canceled";
    },
    (e: AdaptationCockpitEvidence) => {
      delete e.packages[0]!.receipt;
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.receipt!.sha256 = "wrong";
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.receipt!.byteSize++;
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.sourceState = "stale";
    },
    (e: AdaptationCockpitEvidence) => {
      delete e.packages[0]!.rights;
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.manifest.projectVersion++;
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.manifest.adopted.script.version++;
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.manifest.preflight.blockers.push("错误未处理");
    },
    (e: AdaptationCockpitEvidence) => {
      e.packages[0]!.manifest.preflight.checks[0]!.state = "blocked";
    },
  ]) {
    const e = fixture();
    mutate(e);
    expect(derive(e).status).not.toBe("delivered");
    expect(derive(e).gates![4]!.status).not.toBe("ready");
  }
  const e = fixture();
  e.packages[0]!.status = "awaiting-confirmation";
  expect(derive(e).gates![4]!.status).toBe("needs-human");
  expect(derive(e).primaryAction.to).toContain("pilotPackageId=package");
  e.packages[0]!.status = "saving";
  expect(derive(e).status).toBe("working");
});

test("明确候选返回实际 ID，人工重排不能被原模型候选替代", () => {
  const e = fixture();
  e.plans[0]!.status = "pending";
  e.plans[0]!.isCurrent = false;
  e.plans[0]!.createdAt = time;
  e.plans.push({
    ...e.plans[0]!,
    id: "reordered",
    createdAt: "2026-10-01T00:00:01.000Z",
    origin: "human-reorder",
  });
  expect(derive(e).primaryAction.to).toContain("seasonPlanId=reordered");
  expect(derive(e).gates![2]!.status).toBe("needs-human");
});

test("运行只关联当前精确阶段，历史失败与已取消不会夺取唯一主动作", () => {
  const e = fixture();
  e.episodes = [];
  e.packages = [];
  const w = {
    id: "old-failed",
    createdAt: time,
    stage: "failed",
    input: {
      projectId: project.id,
      operation: "episode-outline",
      episodeDevelopmentRequest: {
        seasonPlan: ref("plan"),
        episodeId: "first",
      },
    },
  } as unknown as CreationWorkflow;
  e.workflows = [w];
  expect(derive(e).primaryAction.to).toContain("workflowId=old-failed");
  e.workflows.push({
    ...w,
    id: "canceled",
    stage: "canceled",
    createdAt: "2026-10-01T00:00:01.000Z",
  });
  expect(derive(e).primaryAction.label).toBe("开发首集大纲");
  e.workflows.push({
    ...w,
    id: "new",
    stage: "awaiting-review",
    createdAt: "2026-10-01T00:00:02.000Z",
  });
  expect(derive(e).primaryAction.to).toContain("workflowId=new");
  expect(derive(e).status).toBe("needs-human");
  e.workflows[2]!.input.episodeDevelopmentRequest!.seasonPlan!.version = 0;
  expect(derive(e).primaryAction.label).toBe("开发首集大纲");
});

test.each(["canceled", "discarded", "applied"] as const)(
  "改编较新 %s 运行不能抹掉同一当前基准的较早待审候选",
  (stage) => {
    const e = fixture();
    e.episodes = [];
    e.packages = [];
    const original = {
      id: "original-pending",
      createdAt: time,
      stage: "awaiting-review",
      input: {
        projectId: project.id,
        operation: "episode-outline",
        episodeDevelopmentRequest: {
          seasonPlan: ref("plan"),
          episodeId: "first",
        },
      },
    } as unknown as CreationWorkflow;
    e.workflows = [
      {
        ...original,
        id: "newer-ended",
        stage,
        createdAt: "2026-10-01T00:00:01.000Z",
      },
      original,
    ];
    const result = derive(e);
    expect(result.status).toBe("needs-human");
    expect(result.primaryAction.to).toContain("workflowId=original-pending");
    expect(result.primaryAction.to).toContain("episodeId=first");
    expect(result.primaryAction.to).not.toContain("newer-ended");
  },
);

test("改编原待审候选优先于新失败，但不借旧季纲或其他集冒充当前候选", () => {
  const e = fixture();
  e.episodes = [];
  e.packages = [];
  const original = {
    id: "original-pending",
    createdAt: time,
    stage: "awaiting-review",
    input: {
      projectId: project.id,
      operation: "episode-outline",
      episodeDevelopmentRequest: {
        seasonPlan: ref("plan"),
        episodeId: "first",
      },
    },
  } as unknown as CreationWorkflow;
  const failure = {
    ...original,
    id: "new-failure",
    stage: "failed",
    createdAt: "2026-10-01T00:00:01.000Z",
  } as CreationWorkflow;
  e.workflows = [failure, original];
  expect(derive(e).primaryAction.to).toContain("workflowId=original-pending");
  original.input = {
    ...original.input,
    episodeDevelopmentRequest: {
      ...original.input.episodeDevelopmentRequest!,
      seasonPlan: ref("plan", 0),
    },
  };
  expect(derive(e).primaryAction.to).toContain("workflowId=new-failure");
  original.input.episodeDevelopmentRequest!.seasonPlan!.version = 1;
  original.input.episodeDevelopmentRequest!.episodeId = "second";
  expect(derive(e).primaryAction.to).toContain("workflowId=new-failure");
});

test("失败诊断返回精确运行与原候选，不保留会优先读到的旧头重复参数", () => {
  const e = fixture();
  e.diagnoses[0]!.sourceState = "stale";
  e.diagnoses[0]!.staleReasons = ["来源章节已更新"];
  e.workflows = [
    {
      id: "failed-new",
      diagnosisId: "candidate-new",
      createdAt: time,
      stage: "failed",
      input: {
        projectId: project.id,
        operation: "adaptation-diagnosis",
        diagnosisRequest: {
          authorIntent: ref("intent"),
          inventoryFingerprint: "fingerprint",
          baseAdoptedId: "diagnosis",
          chapters: [ref("chapter")],
        },
      },
    },
  ] as unknown as CreationWorkflow[];
  const result = derive(e);
  const params = new URLSearchParams(result.primaryAction.to.split("?")[1]);
  expect(params.getAll("diagnosisId")).toEqual(["candidate-new"]);
  expect(params.get("workflowId")).toBe("failed-new");
  expect(result.blockers[0]).toContain("来源章节已更新");
});
