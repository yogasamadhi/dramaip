import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Controlled outputs and real public-API setup, not fabricated domain rows.
// The common worker owns all file-HMR, drain and receipt assertions.
const diagnosisOutput = (chapterId, version, quote = "原正文保留。") => ({
  title: "有证据的改编诊断",
  content: "两种策略分别保护原叙事节奏与重排悬念，不代表季纲已经完成。",
  items: [
    {
      ref: "diagnosis",
      kind: "adaptation-diagnosis",
      title: "策略比较",
      data: {
        summary: "仅判断本轮实际来源",
        theme: "人物学会求助",
        emotionalPromise: "温和成长",
        sellingPoints: ["母女关系"],
        mainLine: "保护原文中已经发生的行动",
        characterArcs: ["从独自承担到求助"],
        relationships: ["母女理解"],
        findings: [
          {
            id: "finding-1",
            kind: "conflict",
            claim: "该行动可以成为改编支点",
            evidence: [{ chapterId, chapterVersion: version, quote }],
            suggestion: "保留动机，勿虚构结局",
          },
        ],
        strategies: ["faithful", "reorder"].map((id) => ({
          id,
          title: id === "faithful" ? "忠实人物弧" : "悬念重排",
          rationale:
            id === "faithful" ? "保持原叙事顺序" : "前置行动并保留因果",
          preserve: ["母女关系"],
          merge: [],
          remove: [],
          reorder: id === "reorder" ? ["前置行动"] : [],
          restructure: [],
          rhythm: "按人物动机推进",
          findingIds: ["finding-1"],
          risks: ["局部来源不能保证全书结构"],
          productionRisk: "unknown",
          productionNotes: "角色一致性与场景复杂度需试制，不虚构报价",
        })),
      },
    },
  ],
});
const planOutput = (chapterId, version) => ({
  title: "两集局部整季方案",
  content: "仅从已采用的局部诊断与所选策略发展两集，不扩大覆盖。",
  items: [
    {
      ref: "plan",
      kind: "season-plan",
      title: "完整分集方案",
      data: {
        theme: "求证与信任",
        mainConflict: "是否相信来电者",
        emotionalPromise: "主动选择",
        risks: ["需实际试制，不是报价"],
        omittedSources: [],
        episodes: [0, 1].map((orderIndex) => ({
          id: `stable-episode-${orderIndex}`,
          orderIndex,
          title: `第${orderIndex + 1}集`,
          logline: orderIndex === 0 ? "接到警告" : "主动核对通话",
          goal: "求证",
          mainConflict: "是否相信来电者",
          turningPoint: orderIndex === 0 ? "电话中断" : "线索矛盾",
          endingHook: orderIndex === 0 ? "留下警告" : "发现跟踪",
          sourceChapters: [
            {
              id: chapterId,
              version,
              adaptationAction: "preserve",
              rationale: "保留原文行动",
            },
          ],
          characterProgress: [
            {
              character: "林晚",
              before: "犹疑",
              after: "求证",
              relationshipChange: "重新信任",
            },
          ],
          plantedForeshadowing: [],
          paidOffForeshadowing: [],
          estimatedScenes: 2,
          estimatedCharacters: 2,
          durationSeconds: 90,
          productionRisk: "unknown",
          productionNotes: "待真实制作核验",
        })),
      },
    },
  ],
});
const episodeOutlineOutput = (chapterId, version) => ({
  title: "第一集求证大纲",
  content: "林晚从听到警告到核对通话，保留行动因果。",
  items: [
    {
      ref: "outline",
      kind: "episode-outline",
      title: "两场节拍",
      data: {
        title: "第一集求证",
        logline: "警告后主动核对",
        goal: "找到姐姐",
        mainConflict: "来电可信度",
        turningPoint: "线索矛盾",
        endingHook: "主动出门",
        scenes: [0, 1].map((orderIndex) => ({
          id: `outline-scene-${orderIndex}`,
          orderIndex,
          location: orderIndex === 0 ? "书房" : "楼道",
          timeOfDay: "夜",
          goal: "求证",
          conflict: "来电可信度",
          outcome: orderIndex === 0 ? "记下来电" : "选择核对",
          characters: ["林晚"],
          durationSeconds: 45,
          sourceChapters: [{ id: chapterId, version }],
          beats: [
            {
              id: `beat-${orderIndex}`,
              action: orderIndex === 0 ? "记录警告" : "核对矛盾线索",
              causalLink:
                orderIndex === 0 ? "警告引起怀疑" : "记录中的矛盾促使求证",
            },
          ],
        })),
      },
    },
  ],
});

export async function setupNovelSourceRevisionHmr({
  entryPath,
  json,
  workflow,
  wait,
  outputs,
}) {
  assert.ok(
    [
      "volume-original",
      "story-arc-original",
      "volume-summary",
      "story-arc-summary",
    ].includes(entryPath),
  );
  const usesMemory = entryPath.endsWith("-summary");
  const scopeKind = entryPath.startsWith("volume-") ? "volume" : "story-arc";
  const created = await json(
    "/api/v2/projects",
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        title: "实际小说高层源文件HMR",
        mode: "series_longform",
        modeConfig: { mode: "series_longform" },
      }),
    },
    201,
  );
  const projectId = created.project.id;
  let chapter = await json(
    "/api/v2/chapters",
    {
      method: "POST",
      body: JSON.stringify({
        projectId,
        title: "原作者章节",
        content: "原正文保留。",
      }),
    },
    201,
  );
  let summaryTarget;
  if (scopeKind === "volume") {
    const volume = await json(
      "/api/v2/projects/" + projectId + "/volumes",
      {
        method: "POST",
        body: JSON.stringify({ projectId, title: "实际归属卷" }),
      },
      201,
    );
    chapter = await json("/api/v2/chapters/" + chapter.id, {
      method: "PATCH",
      headers: { "If-Match": '"' + chapter.version + '"' },
      body: JSON.stringify({ version: chapter.version, volumeId: volume.id }),
    });
    summaryTarget = { id: volume.id, kind: scopeKind };
  } else {
    const arc = await json(
      "/api/v2/story-arcs",
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          title: "明确章节绑定故事弧",
          payload: {
            narrativeChapterScope: {
              format: "chapter-refs-v1",
              chapters: [{ id: chapter.id, version: chapter.version }],
            },
          },
        }),
      },
      201,
    );
    summaryTarget = { id: arc.id, kind: scopeKind };
  }
  const project = await json("/api/v2/projects/" + projectId);
  const intent = await json(
    "/api/v2/projects/" + projectId + "/author-intents",
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        projectVersion: project.version,
        sourceKind: "manual",
        content: {
          themeStatement: "保留原人物动机",
          emotionalPromise: "温和成长",
          targetAudience: "成长故事读者",
          mustKeep: ["原正文"],
          mayChange: ["次要角色"],
          mustAvoid: ["无依据覆盖"],
          endingContract: "保留选择",
          toneAndVoice: "克制第三人称",
        },
      }),
    },
    201,
  );
  await json("/api/v2/author-intents/" + intent.id + "/adopt", {
    method: "POST",
    headers: { "If-Match": '"0"', "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ confirmed: true }),
  });
  const candidate = async (operation, extra) => {
    const started = await json("/api/v2/workflows/creation", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        projectId,
        operation,
        engineKind: "codex",
        model: { modelId: "test-fixed-model" },
        instruction: "明确来源，不自动采用。",
        ...extra,
      }),
    });
    let value;
    await wait(async () => {
      value = await json("/api/v2/workflows/creation/" + started.id);
      if (value.stage === "failed")
        throw new Error(operation + " failed: " + JSON.stringify(value.error));
      return value.stage === "awaiting-review";
    }, operation);
    return value;
  };
  outputs.diagnosis = diagnosisOutput(chapter.id, chapter.version);
  const sources = await json(
    "/api/v2/projects/" + projectId + "/diagnosis-sources",
  );
  const diagnosisRun = await candidate("adaptation-diagnosis", {
    diagnosisRequest: {
      scope: "selected-chapters",
      chapters: [{ id: chapter.id, version: chapter.version }],
      inventoryFingerprint: sources.inventoryFingerprint,
      authorIntent: sources.authorIntent,
      baseAdoptedId: sources.adoptedDiagnosisId,
      rightsDeclared: true,
      target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
    },
  });
  const diagnosis = await json("/api/v2/diagnoses/" + diagnosisRun.diagnosisId);
  await json("/api/v2/diagnoses/" + diagnosis.id + "/adopt", {
    method: "POST",
    headers: {
      "If-Match": '"' + diagnosis.stateVersion + '"',
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ confirmed: true, strategyId: "reorder" }),
  });
  outputs.plan = planOutput(chapter.id, chapter.version);
  const planSources = await json(
    "/api/v2/projects/" + projectId + "/season-plan-sources",
  );
  const planRun = await candidate("season-plan", {
    seasonPlanRequest: {
      diagnosis: planSources.diagnosis,
      baseAdoptedId: planSources.adoptedPlanId,
    },
  });
  const plan = await json("/api/v2/season-plans/" + planRun.seasonPlanId);
  await json("/api/v2/season-plans/" + plan.id + "/adopt", {
    method: "POST",
    headers: {
      "If-Match": '"' + plan.stateVersion + '"',
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ confirmed: true }),
  });
  await workflow(projectId, "knowledge-plan");
  outputs.outline = episodeOutlineOutput(chapter.id, chapter.version);
  const episodeId = "stable-episode-0";
  const originalRequest = {
    seasonPlan: { id: plan.id, version: plan.version },
    episodeId,
  };
  const outlineRun = await workflow(
    projectId,
    "episode-outline",
    originalRequest,
  );
  const outline = await json(
    "/api/v2/episode-development/" + outlineRun.episodeResultId,
  );
  const scriptRun = await workflow(projectId, "episode-script", {
    ...originalRequest,
    outline: { id: outline.id, version: outline.version },
  });
  const script = await json(
    "/api/v2/episode-development/" + scriptRun.episodeResultId,
  );
  const manuscript = await json(
    "/api/v2/scripts/" + script.scriptId + "/screenplay",
  );
  outputs.memory = {
    title: "实际章节记忆",
    content: "不改原章",
    items: [
      {
        ref: "memory",
        kind: "chapter-memories",
        title: "明确采用原章摘要",
        data: {
          evidence: chapter.content,
          章节摘要: "人物保管原章的旧书，尚未归还。",
        },
      },
    ],
  };
  await workflow(projectId, "chapter-memory", undefined, {
    targetId: chapter.id,
    baseVersion: chapter.version,
  });
  const detail = await json(
    "/api/v2/projects/" +
      projectId +
      "/narrative-context-index/chapters/" +
      chapter.id,
  );
  const memory = detail.summaries[0];
  assert.ok(memory, "actual adopted chapter memory required");
  const scopes = await json(
    "/api/v2/projects/" + projectId + "/narrative-summaries/scopes",
  );
  const scope = scopes.scopes.find(
    (item) =>
      item.target.kind === scopeKind && item.target.id === summaryTarget.id,
  );
  assert.equal(scope.state, "current");
  assert.deepEqual(
    scope.chapters
      .filter((item) => item.hasContent)
      .map(({ id, version }) => ({ id, version })),
    [{ id: chapter.id, version: chapter.version }],
  );
  outputs.summary = {
    title: "实际高层范围摘要",
    content: "独立明确范围",
    items: [
      {
        ref: "higher",
        kind: "narrative-summary",
        title: "作者明确高层摘要",
        data: {
          summary: "保管旧书，保留原动机，不虚构范围外事件。",
          coveredChapters: [{ id: chapter.id, version: chapter.version }],
          evidence: [
            {
              chapter: { id: chapter.id, version: chapter.version },
              sourceId: usesMemory ? memory.id : chapter.id,
              sourceVersion: usesMemory ? memory.version : chapter.version,
              fieldPath: usesMemory
                ? "/knowledge/" + memory.id
                : "/chapters/" + chapter.id,
              quote: usesMemory ? memory.text : chapter.content,
            },
          ],
        },
      },
    ],
  };
  const summaryRun = await workflow(projectId, "narrative-summary", undefined, {
    targetId: scope.target.id,
    baseVersion: scope.target.version,
    narrativeSummaryRequest: {
      target: scope.target,
      scopeFingerprint: scope.scopeFingerprint,
      expectedHead: null,
      chapters: [
        {
          id: chapter.id,
          version: chapter.version,
          representation: usesMemory ? "summary" : "original",
          ...(usesMemory
            ? { record: { id: memory.id, version: memory.version } }
            : {}),
        },
      ],
    },
  });
  const higher = await json(
    "/api/v2/projects/" +
      projectId +
      "/narrative-summaries/" +
      summaryRun.narrativeSummaryId,
  );
  assert.equal(higher.status, "adopted");
  assert.equal(higher.isHead, true);
  assert.equal(higher.contextEligibility.state, "eligible");
  const currentPlan = await json("/api/v2/season-plans/" + plan.id);
  const reordered = await json("/api/v2/season-plans/" + plan.id + "/reorder", {
    method: "POST",
    headers: {
      "If-Match": '"' + currentPlan.stateVersion + '"',
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      confirmed: true,
      episodeIds: [...plan.content.episodes].reverse().map((item) => item.id),
    }),
  });
  const adoptedPlan = await json(
    "/api/v2/season-plans/" + reordered.id + "/adopt",
    {
      method: "POST",
      headers: {
        "If-Match": '"' + reordered.stateVersion + '"',
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ confirmed: true }),
    },
  );
  const outlineContent = structuredClone(outline.content.value);
  outlineContent.scenes.forEach((scene, index) => {
    scene.sourceEvidence = [
      {
        id: "actual-higher-" + index,
        source: {
          sourceKind: "knowledge",
          sourceId: higher.id,
          sourceVersion: higher.version,
          fieldPath: "/narrative-summaries/" + higher.id,
        },
        valuePath: "/summary",
        quote: higher.content.summary,
        rationale: "PRIVATE author explanation, not semantic proof",
      },
    ];
  });
  const sourceInput = {
    sourceVersion: script.version,
    outline: { id: outline.id, version: outline.version },
    documentVersion: manuscript.version,
    request: {
      seasonPlan: { id: adoptedPlan.id, version: adoptedPlan.version },
      episodeId,
      baseOutlineId: outline.id,
      sourceEvidenceFormat: "exact-expression-quotes-v1",
      episodeNarrativeContext: {
        format: "narrative-context-v1",
        chapters: [],
        summaries: [{ id: higher.id, version: higher.version }],
      },
    },
    outlineContent,
    sceneLinks: script.content.value.sceneLinks,
    tokenBudget: 60000,
  };

  return { projectId, script, manuscript, sourceInput, higher };
}
