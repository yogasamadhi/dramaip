import { expect, test } from "vitest";
import type { Project } from "@dramaip/contracts/product";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { DirectScriptCockpitEvidence } from "./direct-script-cockpit-evidence";
import { deriveDirectScriptCockpit } from "./direct-script-cockpit";

const project = {
  id: "project",
  version: 1,
  synopsis: "实际创意",
  currentAdaptationId: "directory",
  modeConfig: { mode: "single_season", entryPath: "script" },
} as Project;
const ref = (id: string, version = 1) => ({ id, version });
const time = "2026-10-01T00:00:00.000Z";
function fixture(): DirectScriptCockpitEvidence {
  const direct = {
    entryPath: "script",
    project: ref("project"),
    authorIntent: ref("intent"),
    episode: ref("first"),
    sourceScript: { ...ref("original"), documentVersion: 0 },
    durationSeconds: 90,
  };
  const basis = {
    request: { direct, episodeId: "first" },
    authorIntent: ref("intent"),
    episode: {
      ...ref("first"),
      sourcePath: "direct-script",
      durationSeconds: 90,
    },
    chapters: [],
    references: [],
  };
  const result = (id: string, operation: string) => ({
    ...ref(id),
    projectId: "project",
    episodeId: "first",
    operation,
    isCurrent: true,
    sourceState: "current",
    adoptedAt: time,
    staleReasons: [],
    basis,
    content: { kind: operation, value: {} },
  });
  const outline = result("outline", "episode-outline");
  const script = {
    ...result("script", "episode-script"),
    basis: { ...basis, request: { ...basis.request, outline: ref("outline") } },
    scriptId: "native-script",
    episodeRecordId: "first",
    scriptDocumentVersion: 0,
  };
  const productionRecords = [
    { ...ref("scene", 0), kind: "scenes", stableId: "scene-1" },
    { ...ref("shot", 0), kind: "shots", stableId: "shot-1" },
  ];
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
    scriptId: "native-script",
    episodeRecordId: "first",
    scriptDocumentVersion: 0,
    productionRecords,
  };
  const episodes = [outline, script, storyboard];
  const evidence = structuredClone({
    intent: {
      current: {
        ...ref("intent"),
        projectId: "project",
        status: "adopted",
        sourceState: "current",
        isCurrent: true,
        adoptedAt: time,
      },
    },
    sources: {
      projectId: "project",
      episodes: [],
      storyBibleCount: 1,
      currentResults: episodes,
      direct: {
        entryPath: "script",
        project: ref("project"),
        authorIntent: ref("intent"),
        episodes: [
          { ...ref("second"), title: "后集", orderIndex: 9, scripts: [] },
          {
            ...ref("first"),
            title: "真实首集",
            orderIndex: 4,
            scripts: [
              { ...ref("original"), title: "原稿", documentVersion: 0 },
            ],
          },
        ],
      },
    },
    episodes,
    workflows: [],
    packages: [
      {
        ...ref("package"),
        createdAt: time,
        status: "saved",
        sourceState: "current",
        sourceIssues: [],
        rights: { confirmed: true },
        archive: { sha256: "hash", byteSize: 64 },
        receipt: {
          artifactRef: "artifact",
          sha256: "hash",
          byteSize: 64,
          savedAt: time,
        },
        manifest: {
          purpose: "internal-pilot",
          projectId: "project",
          projectVersion: 1,
          episodeId: "first",
          durationSeconds: 90,
          scriptRecordId: "native-script",
          scriptDocumentVersion: 0,
          productionRecords,
          adopted: {
            authorIntent: ref("intent"),
            directSource: direct,
            outline: ref("outline"),
            script: ref("script"),
            storyboard: ref("storyboard"),
          },
          preflight: { blockers: [], checks: [{ state: "unknown" }] },
        },
      },
    ],
  }) as unknown as DirectScriptCockpitEvidence;
  evidence.episodes = evidence.episodes.map((item) => structuredClone(item));
  evidence.sources.currentResults = structuredClone(evidence.episodes);
  evidence.packages = structuredClone(evidence.packages);
  return evidence;
}
const derive = (e: DirectScriptCockpitEvidence) =>
  deriveDirectScriptCockpit(project, e);
const removeStages = (e: DirectScriptCockpitEvidence, from: number) => {
  e.episodes = e.episodes.slice(0, from);
  e.sources.currentResults = structuredClone(e.episodes);
  e.packages = [];
};
function run(
  e: DirectScriptCockpitEvidence,
  stage: CreationWorkflow["stage"],
  id = "run",
  createdAt = time,
): CreationWorkflow {
  return {
    id,
    createdAt,
    stage,
    input: {
      projectId: project.id,
      operation: "episode-script",
      episodeDevelopmentRequest: {
        direct: structuredClone(e.episodes[0]!.basis.request.direct),
        episodeId: "first",
        outline: ref("outline"),
      },
    },
  } as CreationWorkflow;
}

test("直写四个 Gate 核对真实来源与完整采用链，不补诊断季纲且内部保存不冒充发行", () => {
  const c = derive(fixture());
  expect(c.gates).toHaveLength(4);
  expect(c.gates!.every((item) => item.status === "ready")).toBe(true);
  expect(c.status).toBe("delivered");
  expect(c.statusLabel).toContain("发行仍待核验");
  expect(c.primaryAction.to).toContain("pilotPackageId=package");
  expect(c.gates![0]!.detail).toContain("真实首集（first）v1");
  expect(c.coverage).toEqual([
    { label: "当前正式 Gate", current: 4, required: 4 },
  ]);
  expect(JSON.stringify(c)).not.toContain("preparedPrompt");
});

test("来源未读取、旧目录与任意媒体计数不能完成直写 Gate", () => {
  const c = deriveDirectScriptCockpit(project);
  expect(c.status).toBe("needs-attention");
  expect(c.gates!.every((item) => item.status === "unverified")).toBe(true);
  expect(c.primaryAction.label).toBe("核对直写正式进度");
});

test("来源、正式意图与批准 Bible 缺失定位到实际第一步，不能跳过上游", () => {
  const e = fixture();
  e.sources.storyBibleCount = 0;
  expect(derive(e).primaryAction.label).toBe("采用正式故事圣经");
  expect(derive(e).primaryAction.to).toContain("episodeId=first");
  expect(derive(e).gates!.every((item) => item.status !== "ready")).toBe(true);
  e.sources.storyBibleCount = 1;
  e.intent.current!.status = "pending";
  expect(derive(e).primaryAction.to).toContain("intentId=intent");
  e.sources.direct!.episodes.find((item) => item.id === "first")!.scripts = [];
  expect(derive(e).primaryAction.label).toBe("补充实际直写来源");
  expect(derive(e).primaryAction.to).toContain("adaptationId=directory");
  expect(derive(e).primaryAction.to).toContain("episodeId=first");
});

test("创意路径独立采用无原稿链，空简报不被计数代替", () => {
  const e = fixture();
  e.sources.direct!.entryPath = "inspiration";
  for (const item of e.episodes) {
    item.basis.request.direct!.entryPath = "inspiration";
    delete item.basis.request.direct!.sourceScript;
  }
  e.sources.currentResults = structuredClone(e.episodes);
  e.packages[0]!.manifest.adopted.directSource = structuredClone(
    e.episodes[0]!.basis.request.direct,
  );
  const p = {
    ...project,
    modeConfig: { mode: "single_season", entryPath: "inspiration" },
  } as Project;
  expect(deriveDirectScriptCockpit(p, e).status).toBe("delivered");
  expect(
    deriveDirectScriptCockpit({ ...p, synopsis: "", productionBrief: "" }, e)
      .primaryAction.label,
  ).toBe("补充实际直写来源");
});

test("实际顺序选首集，重复分集身份或顺序、旧项目版本保持未核验", () => {
  const e = fixture();
  e.sources.direct!.episodes[0]!.orderIndex = 3;
  const c = derive(e);
  expect(c.gates![0]!.status).toBe("pending"); // first is now the empty actual second script source
  expect(c.primaryAction.to).toContain("episodeId=second");
  e.sources.direct!.episodes[0]!.orderIndex = 4;
  expect(derive(e).gates![0]!.status).toBe("unverified");
  e.sources.direct = fixture().sources.direct;
  e.sources.direct!.episodes[0]!.id = "first";
  expect(derive(e).gates![0]!.status).toBe("unverified");
  e.sources.direct = fixture().sources.direct;
  e.sources.direct!.project.version = 0;
  expect(derive(e).gates![0]!.status).toBe("unverified");
});

test("每阶段只认唯一正式头，完整历史与目录快照冲突 fail closed", () => {
  const e = fixture();
  e.episodes.push({ ...e.episodes[0]!, id: "another" });
  expect(derive(e).gates![1]!.status).toBe("unverified");
  expect(derive(e).status).not.toBe("delivered");
  const second = fixture();
  second.sources.currentResults[0]!.version = 7;
  expect(derive(second).gates![1]!.status).toBe("unverified");
  const missing = fixture();
  missing.sources.currentResults = [];
  expect(
    derive(missing)
      .gates!.slice(1)
      .every((item) => item.status === "unverified"),
  ).toBe(true);
});

test("原稿记录与 AST 分别核对，null 不被绑定到新创建的 AST 或另一稿件", () => {
  for (const mutate of [
    (e: DirectScriptCockpitEvidence) => {
      e.sources.direct!.episodes[1]!.scripts[0]!.version++;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.sources.direct!.episodes[1]!.scripts[0]!.documentVersion = 2;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[0]!.basis.request.direct!.sourceScript!.documentVersion = null;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[0]!.basis.request.direct!.sourceScript!.id = "another";
    },
  ]) {
    const e = fixture();
    mutate(e);
    e.sources.currentResults = structuredClone(e.episodes);
    expect(derive(e).gates![1]!.status).toBe("stale");
    expect(derive(e).primaryAction.to).toContain("operation=episode-outline");
    expect(
      derive(e)
        .gates!.slice(1)
        .every((item) => item.status !== "ready"),
    ).toBe(true);
  }
});

test("大纲、剧本、分镜须继承同一来源、时长、意图与实际分集，不能补小说链", () => {
  for (const mutate of [
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[1]!.basis.request.direct!.durationSeconds = 120;
      e.episodes[1]!.basis.episode.durationSeconds = 120;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[1]!.basis.request.outline!.version = 0;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[1]!.episodeRecordId = "second";
    },
    (e: DirectScriptCockpitEvidence) => {
      delete e.episodes[1]!.scriptDocumentVersion;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[1]!.basis.request.seasonPlan = ref("invented");
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[1]!.basis.authorIntent.version = 0;
    },
  ]) {
    const e = fixture();
    mutate(e);
    e.sources.currentResults = structuredClone(e.episodes);
    expect(derive(e).gates![1]!.status).toBe("ready");
    expect(derive(e).gates![2]!.status).toBe("stale");
    expect(derive(e).primaryAction.to).toContain("operation=episode-script");
    expect(derive(e).gates![3]!.status).not.toBe("ready");
  }
  const e = fixture();
  e.episodes[2]!.basis.request.script!.version = 0;
  e.sources.currentResults = structuredClone(e.episodes);
  expect(derive(e).primaryAction.to).toContain("operation=storyboard-package");
});

test("正式分镜必须保留当前实际稳定剧本和场景镜头，不认任意生产记录", () => {
  for (const mutate of [
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[2]!.scriptDocumentVersion = 2;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[2]!.scriptId = "other";
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[2]!.productionRecords = [
        e.episodes[2]!.productionRecords![0]!,
      ];
    },
    (e: DirectScriptCockpitEvidence) => {
      e.episodes[2]!.productionRecords!.push(
        e.episodes[2]!.productionRecords![0]!,
      );
    },
  ]) {
    const e = fixture();
    mutate(e);
    e.sources.currentResults = structuredClone(e.episodes);
    expect(derive(e).gates![3]!.status).toBe("stale");
    expect(derive(e).primaryAction.label).toBe("开发首集分镜包");
  }
});

test("候选、运行和失败深链接绑定同一基准，取消或已采用的最新运行抑制旧失败", () => {
  const e = fixture();
  removeStages(e, 1);
  e.workflows = [run(e, "awaiting-review")];
  const c = derive(e);
  expect(c.status).toBe("needs-human");
  expect(c.primaryAction.to).toContain("workflowId=run");
  expect(c.primaryAction.to).toContain("episodeId=first");
  e.workflows[0]!.stage = "checking";
  expect(derive(e).status).toBe("working");
  e.workflows[0]!.stage = "failed";
  expect(derive(e).status).toBe("needs-attention");
  e.workflows.push(run(e, "canceled", "newer", "2026-10-01T00:00:01.000Z"));
  expect(derive(e).status).toBe("needs-input");
  e.workflows = [run(e, "awaiting-review")];
  e.workflows[0]!.input.episodeDevelopmentRequest!.direct!.sourceScript!.documentVersion = 9;
  expect(derive(e).status).toBe("needs-input");
});

test.each(["canceled", "discarded", "applied"] as const)(
  "直写较新 %s 运行不能抹掉同一当前基准的较早待审候选",
  (stage) => {
    const e = fixture();
    removeStages(e, 1);
    const original = run(e, "awaiting-review", "original-pending");
    const newer = run(e, stage, "newer-ended", "2026-10-01T00:00:01.000Z");
    e.workflows = [newer, original];
    const result = derive(e);
    expect(result.status).toBe("needs-human");
    expect(result.primaryAction.to).toContain("workflowId=original-pending");
    expect(result.primaryAction.to).toContain("episodeId=first");
    expect(result.primaryAction.to).not.toContain("newer-ended");
  },
);

test("直写仍待审的原候选优先于同基准的新失败，但不接受旧正式头", () => {
  const e = fixture();
  removeStages(e, 1);
  const original = run(e, "awaiting-review", "original-pending");
  e.workflows = [
    run(e, "failed", "new-failure", "2026-10-01T00:00:01.000Z"),
    original,
  ];
  expect(derive(e).primaryAction.to).toContain("workflowId=original-pending");
  original.input.episodeDevelopmentRequest!.outline!.version = 0;
  expect(derive(e).primaryAction.to).toContain("workflowId=new-failure");
});

test("最新有效候选必须基于当前采用头，其他集或旧头不能挤占唯一下一步", () => {
  const e = fixture();
  removeStages(e, 1);
  const wrong = run(e, "awaiting-review");
  wrong.input.episodeDevelopmentRequest!.baseScriptId = "obsolete";
  e.workflows = [wrong];
  expect(derive(e).primaryAction.label).toBe("开发首集标准剧本");
  wrong.input.episodeDevelopmentRequest!.baseScriptId = undefined;
  wrong.input.episodeDevelopmentRequest!.episodeId = "second";
  expect(derive(e).primaryAction.label).toBe("开发首集标准剧本");
});

test("只有当前内部包的实际摘要字节回执和权利确认才标保存，不使用预览/失败/旧链", () => {
  for (const mutate of [
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.status = "awaiting-confirmation";
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.status = "failed";
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.status = "canceled";
    },
    (e: DirectScriptCockpitEvidence) => {
      delete e.packages[0]!.receipt;
    },
    (e: DirectScriptCockpitEvidence) => {
      delete e.packages[0]!.rights;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.receipt!.byteSize = 1;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.receipt!.sha256 = "other";
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.sourceState = "stale";
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.projectVersion = 0;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.adopted.directSource!.durationSeconds = 120;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.adopted.script.version = 0;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.productionRecords[0]!.version++;
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.productionRecords[1] = structuredClone(
        e.packages[0]!.manifest.productionRecords[0]!,
      );
    },
    (e: DirectScriptCockpitEvidence) => {
      e.packages[0]!.manifest.preflight.blockers = ["已知错误"];
    },
  ]) {
    const e = fixture();
    mutate(e);
    expect(derive(e).status).not.toBe("delivered");
    expect(derive(e).gates![3]!.status).not.toBe("ready");
    expect(derive(e).primaryAction.label).toBe("核验并保存内部试制包");
  }
});

test("修改上游后保留正式历史和失效原因，但不会继续显示下游保存完成", () => {
  const e = fixture();
  for (const item of e.episodes) {
    item.sourceState = "stale";
    item.staleReasons = ["原稿正文已变化"];
  }
  e.sources.currentResults = structuredClone(e.episodes);
  const c = derive(e);
  expect(c.primaryAction.to).toContain("operation=episode-outline");
  expect(c.gates![1]!.detail).toContain("原稿正文已变化");
  expect(c.status).toBe("needs-attention");
  expect(c.gates!.slice(1).every((item) => item.status !== "ready")).toBe(true);
});
