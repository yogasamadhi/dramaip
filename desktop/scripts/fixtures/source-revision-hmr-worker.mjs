import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bootRuntime, loadProfile } from "./packages/runtime/src/index.js";
import { createDesktopHost } from "./packages/desktop-host/src/index.js";
import { openDatabase } from "./packages/database/src/index.js";
import { setupNovelSourceRevisionHmr } from "./source-revision-hmr-novel.mjs";
import { EpisodeSourceRevisionInputSchema } from "./packages/contracts/src/episode-source-revision.js";

// This fixture is copied into an isolated compiled Runtime by the runner.
assert.equal(process.versions.node, "24.18.0");
assert.equal(process.versions.bun, undefined);
const entryPath = process.argv[2];
const lifecycle = process.argv[3] ?? "adopt";
assert.ok(["create-preview", "adopt", "discard"].includes(lifecycle));
assert.ok(
  [
    "inspiration",
    "script",
    "volume-original",
    "story-arc-original",
    "volume-summary",
    "story-arc-summary",
  ].includes(entryPath),
);
const usesNovel = !["inspiration", "script"].includes(entryPath);
const novelOutputs = {};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const sourceModule = fileURLToPath(
  new URL(
    "./plugins/production/src/episode-source-revision.js",
    import.meta.url,
  ),
);
const originalModule = await readFile(sourceModule, "utf8");
const databasePath = fileURLToPath(
  new URL("./source-state.sqlite", import.meta.url),
);
const runtimeToken = "source-file-hmr-test-token";
const hostToken = "source-file-hmr-host-token";
let engineCalls = 0;
let outlineOutput;
const blocks = [
  { id: randomUUID(), type: "scene_heading", text: "INT. 书房 - NIGHT" },
  { id: randomUUID(), type: "action", text: "林晚记下来电，凝视号码。" },
  { id: randomUUID(), type: "scene_heading", text: "INT. 楼道 - NIGHT" },
  { id: randomUUID(), type: "action", text: "林晚核对线索，转身出门。" },
];
const scriptOutput = {
  title: "第一集求证剧本",
  content: blocks.map((value) => value.text).join("\n\n"),
  items: [
    {
      ref: "script",
      kind: "episode-script",
      title: "标准剧本",
      data: {
        blocks,
        sceneLinks: [0, 1].map((index) => ({
          sceneId: "outline-scene-" + index,
          blockIds: blocks
            .slice(index * 2, index * 2 + 2)
            .map((value) => value.id),
        })),
      },
    },
  ],
};
const bibleOutput = {
  title: "独立正式设定",
  content: "林晚核对线索。",
  items: [
    {
      ref: "bible",
      kind: "story-bible",
      title: "正式林晚约束",
      data: {
        内容: "林晚记录警告，核对矛盾线索后主动出门。",
        依据: "作者明确采用",
      },
    },
  ],
};
const host = createDesktopHost({
  accessToken: hostToken,
  capabilities: [],
  actions: {
    engineHealth: async () => ({
      available: true,
      healthy: true,
      configured: true,
      authenticated: true,
      generation: 1,
    }),
    engineOperation: async (_kind, operation) =>
      operation === "create" ? { id: randomUUID() } : { ok: true },
    async *engineStream(_kind, { prompt }) {
      engineCalls++;
      const result = prompt.includes("审阅候选与冻结")
        ? { issues: [] }
        : prompt.includes("kind=narrative-summary")
          ? novelOutputs.summary
          : prompt.includes("仅提取正文明确")
            ? novelOutputs.memory
            : prompt.includes("kind=adaptation-diagnosis")
              ? novelOutputs.diagnosis
              : prompt.includes("kind=season-plan")
                ? novelOutputs.plan
                : prompt.includes("kind=episode-outline")
                  ? usesNovel
                    ? novelOutputs.outline
                    : outlineOutput
                  : prompt.includes("kind=episode-script")
                    ? scriptOutput
                    : bibleOutput;
      yield { type: "result", result: { text: JSON.stringify(result) } };
    },
  },
});
const hostServer = await host.start({ hostname: "127.0.0.1", port: 0 });
const restarts = [];
const config = {
  databasePath,
  profile: loadProfile(new URL("./profiles/e2e.json", import.meta.url)),
  runtimeKind: "node",
  mode: "headless",
  accessToken: runtimeToken,
  host: {
    baseUrl: "http://127.0.0.1:" + hostServer.port,
    accessToken: hostToken,
  },
  development: { onRestart: (reason) => restarts.push(reason.message) },
};
let runtime;
let database;
let body;
let server;
const start = async (options) => {
  runtime = await bootRuntime(options);
  server = await runtime.start({ hostname: "127.0.0.1", port: 0 });
};
try {
  await start(config);
  database = openDatabase(databasePath);
  let transportPhase = "setup";
  const request = async (path, init = {}) => {
    try {
      return await fetch(
        new Request("http://127.0.0.1:" + server.port + path, {
          ...init,
          headers: {
            Authorization: "Bearer " + runtimeToken,
            "Content-Type": "application/json",
            ...init.headers,
          },
        }),
      );
    } catch (cause) {
      // Retain a failed original request, never retry a mutation. Metadata-only
      // context identifies the phase without logging source bodies or tokens.
      throw new Error(
        `Source HMR transport failure (${entryPath}/${lifecycle}, ${transportPhase}, ${init.method ?? "GET"} ${path})`,
        { cause },
      );
    }
  };
  const json = async (path, init, expected = 200) => {
    const response = await request(path, init);
    const text = await response.text();
    assert.equal(response.status, expected, path + ": " + text);
    return text ? JSON.parse(text) : undefined;
  };
  const state = () =>
    database.uow.execute((tx) => ({
      previews: tx.all(
        "SELECT * FROM production_episode_source_revisions ORDER BY id",
      ),
      receipts: tx.all(
        "SELECT * FROM production_episode_source_revision_requests ORDER BY request_key",
      ),
      results: tx.all("SELECT * FROM production_episode_results ORDER BY id"),
      heads: tx.all(
        "SELECT * FROM production_episode_result_heads ORDER BY project_id,episode_key,operation",
      ),
      events: tx.all(
        "SELECT * FROM domain_events WHERE plugin_id='production' AND aggregate_type IN ('episode-result','episode-source-revision') ORDER BY cursor",
      ),
      documents: tx.all("SELECT * FROM screenplay_documents ORDER BY id"),
      snapshots: tx.all("SELECT * FROM agent_context_snapshots ORDER BY id"),
      contextPreviews: tx.all(
        "SELECT * FROM agent_context_previews ORDER BY id",
      ),
      contextPreparations: tx.all(
        "SELECT * FROM agent_context_preparations ORDER BY preparation_scope,key_sha256",
      ),
      originalProjects: tx.all("SELECT * FROM projects ORDER BY id"),
      originalProductionRecords: tx.all(
        "SELECT * FROM production_records ORDER BY id",
      ),
      originalChapters: tx.all("SELECT * FROM chapters ORDER BY id"),
      originalVolumes: tx.all("SELECT * FROM writing_volumes ORDER BY id"),
      originalMemories: tx.all(
        "SELECT * FROM knowledge_chapter_memories ORDER BY id",
      ),
      originalKnowledge: tx.all("SELECT * FROM knowledge_records ORDER BY id"),
      originalHigher: tx.all(
        "SELECT * FROM knowledge_narrative_summaries ORDER BY id",
      ),
      originalHigherHeads: tx.all(
        "SELECT * FROM knowledge_narrative_summary_heads ORDER BY project_id,target_kind,target_id",
      ),
    }));
  const wait = async (predicate, description, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (!(await predicate())) {
      assert.equal(
        restarts.length,
        0,
        "unexpected supervised restart: " + JSON.stringify(restarts),
      );
      assert.ok(Date.now() < deadline, description + " timeout");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const workflow = async (
    projectId,
    operation,
    episodeDevelopmentRequest,
    additional = {},
  ) => {
    const started = await json("/api/v2/workflows/creation", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        projectId,
        operation,
        engineKind: "codex",
        model: { modelId: "test-fixed-model" },
        instruction: "保留原稿，明确审阅实际来源。",
        wordGoal: 12,
        ...(episodeDevelopmentRequest ? { episodeDevelopmentRequest } : {}),
        ...additional,
      }),
    });
    let value;
    await wait(async () => {
      value = await json("/api/v2/workflows/creation/" + started.id);
      if (value.stage === "failed")
        throw new Error("controlled workflow failed: " + value.error);
      return value.stage === "awaiting-review";
    }, operation);
    await json("/api/v2/change-previews/" + value.previewId + "/commit", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
    });
    await wait(async () => {
      value = await json("/api/v2/workflows/creation/" + started.id);
      return value.stage === "applied";
    }, operation + " adoption");
    return value;
  };
  const { projectId, script, manuscript, sourceInput, higher } = usesNovel
    ? await setupNovelSourceRevisionHmr({
        entryPath,
        json,
        workflow,
        wait,
        outputs: novelOutputs,
      })
    : await (async () => {
        const created = await json(
          "/api/v2/projects",
          {
            method: "POST",
            headers: { "Idempotency-Key": randomUUID() },
            body: JSON.stringify({
              title: "隔离真实源码重载",
              mode: "single_season",
              modeConfig: {
                mode: "single_season",
                entryPath,
                targetEpisodeCount: 12,
              },
              synopsis: "林晚记录警告后主动求证。",
              productionBrief: "不覆盖作者原稿。",
            }),
          },
          201,
        );
        const projectId = created.project.id;
        const createRecord = (kind, parentId, payload = {}) =>
          json(
            "/api/v2/" + kind,
            {
              method: "POST",
              body: JSON.stringify({
                projectId,
                parentId,
                title: "明确" + kind,
                payload,
              }),
            },
            201,
          );
        const adaptation = await createRecord("adaptations");
        const episode = await createRecord("episodes", adaptation.id);
        const sourceScript =
          entryPath === "script"
            ? await createRecord("scripts", episode.id, {
                剧本内容:
                  "INT. 书房 - NIGHT\n\n林晚记录警告。\n\nINT. 楼道 - NIGHT\n\n林晚核对线索。",
                来源类型: "作者原稿",
              })
            : undefined;
        let project = await json(
          "/api/v2/projects/" + projectId + "/current-adaptation",
          {
            method: "POST",
            body: JSON.stringify({ adaptationId: adaptation.id }),
          },
        );
        const intent = await json(
          "/api/v2/projects/" + projectId + "/author-intents",
          {
            method: "POST",
            headers: { "Idempotency-Key": randomUUID() },
            body: JSON.stringify({
              projectVersion: project.version,
              sourceKind: "manual",
              content: {
                themeStatement: "主动求证",
                emotionalPromise: "保留动机",
                targetAudience: "轻悬疑观众",
                mustKeep: ["记录警告"],
                mayChange: ["次要角色"],
                mustAvoid: ["不覆盖作者原稿"],
                endingContract: "主动出门",
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
        await workflow(projectId, "knowledge-plan");
        const catalog = await json(
          "/api/v2/projects/" + projectId + "/episode-development-sources",
        );
        const direct = {
          entryPath,
          project: catalog.direct.project,
          authorIntent: { id: intent.id, version: intent.version },
          episode: { id: episode.id, version: episode.version },
          durationSeconds: 90,
          ...(sourceScript
            ? {
                sourceScript: {
                  id: sourceScript.id,
                  version: sourceScript.version,
                  documentVersion:
                    catalog.direct.episodes[0].scripts[0].documentVersion,
                },
              }
            : {}),
        };
        const sourceReferences = sourceScript
          ? [
              {
                sourceKind: "production",
                sourceId: sourceScript.id,
                sourceVersion: sourceScript.version,
                fieldPath: "/production/" + sourceScript.id,
              },
            ]
          : [
              {
                sourceKind: "project",
                sourceId: projectId,
                sourceVersion: direct.project.version,
                fieldPath: "/project",
              },
            ];
        outlineOutput = {
          title: "两场求证大纲",
          content: "记录警告后核对线索。",
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
                  id: "outline-scene-" + orderIndex,
                  orderIndex,
                  location: orderIndex ? "楼道" : "书房",
                  timeOfDay: "夜",
                  goal: "求证",
                  conflict: "来电可信度",
                  outcome: orderIndex ? "选择核对" : "记下来电",
                  characters: ["林晚"],
                  durationSeconds: 45,
                  sourceChapters: [],
                  sourceReferences,
                  beats: [
                    {
                      id: "beat-" + orderIndex,
                      action: orderIndex ? "核对线索" : "记录警告",
                      causalLink: "矛盾促使求证",
                    },
                  ],
                })),
              },
            },
          ],
        };
        const outlineRun = await workflow(projectId, "episode-outline", {
          direct,
          episodeId: episode.id,
        });
        const outline = await json(
          "/api/v2/episode-development/" + outlineRun.episodeResultId,
        );
        const scriptRun = await workflow(projectId, "episode-script", {
          direct,
          episodeId: episode.id,
          outline: { id: outline.id, version: outline.version },
        });
        const script = await json(
          "/api/v2/episode-development/" + scriptRun.episodeResultId,
        );
        const manuscript = await json(
          "/api/v2/scripts/" + script.scriptId + "/screenplay",
        );
        project = await json("/api/v2/projects/" + projectId);
        const changed = await json("/api/v2/projects/" + projectId, {
          method: "PATCH",
          headers: { "If-Match": '"' + project.version + '"' },
          body: JSON.stringify({
            version: project.version,
            productionBrief: "作者明确新增来源，原稿独立审阅。",
          }),
        });
        const newDirect = {
          ...direct,
          project: { id: projectId, version: changed.version },
        };
        const outlineContent = structuredClone(outline.content.value);
        for (const scene of outlineContent.scenes)
          for (const ref of scene.sourceReferences ?? [])
            if (ref.sourceId === projectId) ref.sourceVersion = changed.version;
        const sourceInput = {
          sourceVersion: script.version,
          outline: { id: outline.id, version: outline.version },
          documentVersion: manuscript.version,
          request: {
            direct: newDirect,
            episodeId: episode.id,
            baseOutlineId: outline.id,
          },
          outlineContent,
          sceneLinks: script.content.value.sceneLinks,
          tokenBudget: 60_000,
        };

        return { projectId, script, manuscript, sourceInput };
      })();
  const previewKey = randomUUID();
  const previewPath =
    "/api/v2/episode-development/" + script.id + "/source-revision-previews";
  const previewRequest = () =>
    json(previewPath, {
      method: "POST",
      headers: {
        "If-Match": '"' + script.version + '"',
        "Idempotency-Key": previewKey,
      },
      body: JSON.stringify(sourceInput),
    });
  const normalizedInput = EpisodeSourceRevisionInputSchema.parse(sourceInput);
  let pending =
    lifecycle === "create-preview" ? undefined : await previewRequest();
  if (usesNovel && pending) {
    const context = await json(
      "/api/v2/episode-source-revisions/" + pending.id + "/source-context",
    );
    assert.equal(context.id, pending.id);
    assert.ok(
      context.entries.some(
        (entry) =>
          entry.sourceId === higher.id &&
          entry.fieldPath === "/narrative-summaries/" + higher.id,
      ),
    );
    assert.deepEqual(
      pending.outlineBasis.sourceBasis.summaries.map(({ id, version }) => ({
        id,
        version,
      })),
      [{ id: higher.id, version: higher.version }],
    );
  }
  const originalPendingState = state();
  const callsBefore = engineCalls;
  const originalRead =
    pending ?? (await json("/api/v2/episode-development/" + script.id));
  if (lifecycle === "create-preview") {
    assert.equal(originalPendingState.previews.length, 0);
    assert.equal(originalPendingState.receipts.length, 0);
    assert.equal(
      originalPendingState.contextPreparations.filter(
        (row) => row.preparation_scope === "production.episode-source-revision",
      ).length,
      0,
    );
  }
  const adoption =
    lifecycle === "create-preview"
      ? sourceInput
      : lifecycle === "discard"
        ? { stateVersion: 0 }
        : {
            stateVersion: 0,
            confirmation: {
              currentSourcesReviewed: true,
              outlineReviewed: true,
              actualDocumentReviewed: true,
              sceneMappingReviewed: true,
              retainedManuscriptReviewed: true,
            },
          };
  const adoptKey = lifecycle === "create-preview" ? previewKey : randomUUID();
  const requestVersion = lifecycle === "create-preview" ? script.version : 0;
  const adoptPath =
    lifecycle === "create-preview"
      ? previewPath
      : "/api/v2/episode-source-revisions/" + pending.id + "/" + lifecycle;
  const adoptRequest = (bodyValue = adoption, key = adoptKey) =>
    json(adoptPath, {
      method: "POST",
      headers: {
        "If-Match":
          '"' +
          (lifecycle === "create-preview"
            ? script.version
            : bodyValue.stateVersion) +
          '"',
        "Idempotency-Key": key,
      },
      body: JSON.stringify(bodyValue),
    });
  const diagnostics = () => json("/api/v2/system/diagnostics");
  let restoredOwnerReadReloadRefusals = 0;
  const readRestoredOwner = async (path) => {
    let value;
    await wait(async () => {
      const response = await request(path);
      if (response.status === 503) {
        const problem = await response.json();
        assert.equal(
          problem.code,
          "RUNTIME_RELOADING",
          "only the actual graph reload gate may defer this read",
        );
        restoredOwnerReadReloadRefusals++;
        assert.deepEqual(state(), originalPendingState);
        assert.equal(engineCalls, callsBefore);
        return false;
      }
      const text = await response.text();
      assert.equal(response.status, 200, "actual restored owner read: " + text);
      value = JSON.parse(text);
      return true;
    }, "actual restored source owner becomes readable after queued watcher recovery");
    return value;
  };
  const stableModule =
    originalModule + "\nexport const authorSourceRecoveryBaseline = true;\n";
  await writeFile(sourceModule, stableModule);
  await wait(async () => {
    const diagnostic = await diagnostics();
    return !diagnostic.router.reloading && diagnostic.hmr.reloadCount >= 1;
  }, "actual successful source-file HMR establishes a module publication baseline");
  assert.deepEqual(state(), originalPendingState);
  assert.equal(engineCalls, callsBefore);
  const beforeImportFailure = await diagnostics();
  transportPhase = "rejected-import-recovery";
  const beforeImportGraph = runtime.runtimeInfo.graphRevision;
  await writeFile(
    sourceModule,
    "this is an invalid actual source owner module !!!",
  );
  await wait(
    async () => (await readFile(sourceModule, "utf8")) === stableModule,
    "actual failed import restores the precise successful source module",
  );
  await wait(
    async () => !(await diagnostics()).router.reloading,
    "failed import finishes router recovery",
  );
  const afterImportFailure = await diagnostics();
  assert.equal(runtime.runtimeInfo.graphRevision, beforeImportGraph);
  assert.equal(
    afterImportFailure.hmr.reloadCount,
    beforeImportFailure.hmr.reloadCount + 1,
    "restored valid module is reactivated, never the rejected syntax",
  );
  assert.deepEqual(
    await readRestoredOwner(
      pending
        ? "/api/v2/episode-source-revisions/" + pending.id
        : "/api/v2/episode-development/" + script.id,
    ),
    originalRead,
  );
  if (pending)
    assert.equal(
      (
        await readRestoredOwner(
          "/api/v2/episode-source-revisions/" + pending.id + "/source-context",
        )
      ).id,
      pending.id,
    );
  assert.deepEqual(state(), originalPendingState);
  assert.equal(engineCalls, callsBefore);
  assert.equal(restarts.length, 0);
  // A restored file may still have a queued native watcher notification.
  // Establish a read-only quiescent baseline before starting the subject write;
  // never retry the mutation or treat an early 503 as an in-flight creation.
  let restoredSignature;
  transportPhase = "restored-quiescent-baseline";
  let restoredStableAt = 0;
  await wait(async () => {
    const value = await diagnostics();
    const plugins = runtime.kernel.diagnostics().plugins;
    const quiet =
      !value.router.reloading &&
      value.router.activeInFlight === 0 &&
      !value.hmr.restarting &&
      value.hmr.lastError === undefined &&
      plugins.length === 14 &&
      plugins.every((plugin) => plugin.status === "active");
    const signature = JSON.stringify([
      value.router.activeRevision,
      value.hmr.reloadCount,
      runtime.runtimeInfo.graphRevision,
    ]);
    assert.deepEqual(state(), originalPendingState);
    assert.equal(engineCalls, callsBefore);
    if (!quiet || signature !== restoredSignature) {
      restoredSignature = quiet ? signature : undefined;
      restoredStableAt = Date.now();
      return false;
    }
    return Date.now() - restoredStableAt >= 250;
  }, "restored file owner and router have a stable read-only publication baseline");
  const beforeDiagnostic = await diagnostics();
  const beforeKernel = runtime.kernel.diagnostics();
  assert.equal(beforeKernel.plugins.length, 14);
  assert.ok(beforeKernel.plugins.every((plugin) => plugin.status === "active"));
  assert.ok(
    Array.isArray(beforeKernel.routeContributions) &&
      beforeKernel.routeContributions.length > 0,
  );
  const beforeRouteMetadata = JSON.stringify(beforeKernel.routeContributions);
  const beforeGraph = runtime.runtimeInfo.graphRevision;
  const fiber = () =>
    [...runtime.kernel.context.loader.entries()].find(
      (entry) => entry.options.id === "production",
    )?.fiber;
  const beforeFiber = fiber();
  const oldMessage =
    lifecycle === "create-preview"
      ? "原请求键已绑定其他来源确认，不换源或决定。"
      : "原来源确认已决定，不以新键重新采用或撤回。";
  const newMessage = "真实文件HMR新模块已激活：" + oldMessage;
  const compiledOldLiteral = JSON.stringify(oldMessage).replace(
    /[^\x00-\x7f]/gu,
    (character) =>
      "\\u" +
      character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
  );
  assert.equal(
    originalModule.split(compiledOldLiteral).length,
    2,
    "one exact actual compiled owner branch required",
  );
  const changedModule = stableModule.replace(
    compiledOldLiteral,
    JSON.stringify(newMessage),
  );
  const stream = new ReadableStream({
    start(controller) {
      body = controller;
      // Undici must send actual headers and a first chunk before the server
      // can enter the route. Keep the JSON deliberately incomplete for drain.
      controller.enqueue(new TextEncoder().encode("{"));
    },
  });
  transportPhase = "body-held-mutation";
  const inFlight = request(adoptPath, {
    method: "POST",
    headers: {
      "If-Match": '"' + requestVersion + '"',
      "Idempotency-Key": adoptKey,
    },
    body: stream,
    duplex: "half",
  });
  // Observe a rejection immediately during setup/cleanup; the original
  // promise is still awaited below and can never be counted as adoption.
  let earlyResponse;
  let earlyError;
  void inFlight.then(
    (value) => {
      earlyResponse = value;
    },
    (error) => {
      earlyError = error;
    },
  );
  await wait(async () => {
    if (earlyError) throw earlyError;
    if (earlyResponse)
      throw new Error(
        "original body-held request ended before entering the actual router: " +
          earlyResponse.status +
          " " +
          (await earlyResponse.text()),
      );
    return (await diagnostics()).router.activeInFlight === 1;
  }, "actual in-flight source decision");
  await writeFile(sourceModule, changedModule);
  transportPhase = "mutation-drain";
  try {
    await wait(
      async () => (await diagnostics()).router.reloading === true,
      "actual file HMR drain",
    );
    assert.equal(fiber(), beforeFiber, "do not dispose owner before drain");
    assert.equal(runtime.runtimeInfo.graphRevision, beforeGraph);
    const unavailable = await request(adoptPath, {
      method: "POST",
      headers: {
        "If-Match": '"' + requestVersion + '"',
        "Idempotency-Key": adoptKey,
      },
      body: JSON.stringify(adoption),
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, "RUNTIME_RELOADING");
    assert.deepEqual(state(), originalPendingState);
  } finally {
    body.enqueue(new TextEncoder().encode(JSON.stringify(adoption).slice(1)));
    body.close();
    body = undefined;
  }
  const adoptedResponse = await inFlight;
  assert.equal(
    adoptedResponse.status,
    200,
    await adoptedResponse.clone().text(),
  );
  const adopted = await adoptedResponse.json();
  if (lifecycle === "create-preview") pending = adopted;
  assert.equal(
    adopted.status,
    lifecycle === "create-preview"
      ? "pending"
      : lifecycle === "discard"
        ? "discarded"
        : "adopted",
  );
  assert.equal(adopted.stateVersion, lifecycle === "create-preview" ? 0 : 1);
  if (lifecycle !== "adopt") assert.equal(adopted.results, undefined);
  const afterAdoption = state();
  assert.equal(
    afterAdoption.previews.length,
    originalPendingState.previews.length +
      (lifecycle === "create-preview" ? 1 : 0),
  );
  if (lifecycle !== "adopt") {
    assert.deepEqual(afterAdoption.results, originalPendingState.results);
    assert.deepEqual(afterAdoption.heads, originalPendingState.heads);
  }
  if (lifecycle === "create-preview") {
    for (const key of ["snapshots", "contextPreviews", "contextPreparations"])
      assert.equal(
        afterAdoption[key].length,
        originalPendingState[key].length + 1,
      );
    assert.deepEqual(pending.input, normalizedInput);
    const preparation = afterAdoption.contextPreparations.find(
      (row) => row.key_sha256 === sha(previewKey),
    );
    assert.ok(preparation);
    assert.equal(
      preparation.preparation_scope,
      "production.episode-source-revision",
    );
    assert.equal(
      preparation.request_sha256,
      sha(
        JSON.stringify({
          id: script.id,
          action: "preview",
          input: normalizedInput,
        }),
      ),
    );
    assert.equal(preparation.snapshot_id, pending.sourceSnapshotId);
    assert.equal(preparation.manifest_sha256, pending.sourceManifestHash);
    assert.equal(preparation.final_prompt_sha256, pending.sourcePromptHash);
    const snapshot = afterAdoption.snapshots.find(
      (row) => row.id === pending.sourceSnapshotId,
    );
    const parent = afterAdoption.contextPreviews.find(
      (row) => row.id === preparation.preview_id,
    );
    assert.ok(snapshot && parent);
    assert.equal(snapshot.preview_id, parent.id);
    assert.equal(parent.status, "frozen");
    assert.equal(parent.version, 0);
    assert.equal(sha(snapshot.final_prompt), pending.sourcePromptHash);
    assert.deepEqual(
      afterAdoption.snapshots.filter((row) => row.id !== snapshot.id),
      originalPendingState.snapshots,
    );
    assert.deepEqual(
      afterAdoption.contextPreviews.filter((row) => row.id !== parent.id),
      originalPendingState.contextPreviews,
    );
    assert.deepEqual(
      afterAdoption.contextPreparations.filter(
        (row) => row.key_sha256 !== sha(previewKey),
      ),
      originalPendingState.contextPreparations,
    );
    assert.equal(afterAdoption.receipts[0].request_key, previewKey);
    assert.equal(afterAdoption.receipts[0].revision_id, pending.id);
    assert.equal(
      afterAdoption.events.at(-1).type,
      "production.episode-source-revision-previewed.v1",
    );
  } else {
    assert.deepEqual(afterAdoption.snapshots, originalPendingState.snapshots);
    assert.deepEqual(
      afterAdoption.contextPreviews,
      originalPendingState.contextPreviews,
    );
    assert.deepEqual(
      afterAdoption.contextPreparations,
      originalPendingState.contextPreparations,
    );
  }
  assert.equal(
    afterAdoption.results.length,
    originalPendingState.results.length + (lifecycle === "adopt" ? 2 : 0),
  );
  assert.equal(
    afterAdoption.receipts.length,
    originalPendingState.receipts.length + 1,
  );
  assert.equal(
    afterAdoption.events.length,
    originalPendingState.events.length + (lifecycle === "adopt" ? 4 : 1),
  );
  assert.deepEqual(afterAdoption.documents, originalPendingState.documents);
  for (const key of [
    "originalProjects",
    "originalProductionRecords",
    "originalChapters",
    "originalVolumes",
    "originalMemories",
    "originalKnowledge",
    "originalHigher",
    "originalHigherHeads",
  ])
    assert.deepEqual(
      afterAdoption[key],
      originalPendingState[key],
      "actual source adoption must preserve " + key,
    );
  await wait(async () => {
    const value = await diagnostics();
    return (
      !value.router.reloading &&
      value.hmr.reloadCount >= 1 &&
      runtime.runtimeInfo.graphRevision !== beforeGraph &&
      fiber() !== beforeFiber
    );
  }, "actual new source module publication");
  const afterDiagnostic = await diagnostics();
  assert.equal(afterDiagnostic.hmr.restarting, false);
  assert.equal(afterDiagnostic.hmr.lastError, undefined);
  assert.equal(
    afterDiagnostic.router.activeRevision,
    beforeDiagnostic.router.activeRevision + 1,
  );
  assert.equal(
    JSON.stringify(runtime.kernel.diagnostics().routeContributions),
    beforeRouteMetadata,
  );
  assert.deepEqual(afterDiagnostic.services, beforeDiagnostic.services);
  assert.equal(afterDiagnostic.effects.length, beforeDiagnostic.effects.length);
  const newBranch = await request(adoptPath, {
    method: "POST",
    headers: {
      "If-Match":
        '"' + (lifecycle === "create-preview" ? script.version : 1) + '"',
      "Idempotency-Key":
        lifecycle === "create-preview" ? previewKey : randomUUID(),
    },
    body: JSON.stringify(
      lifecycle === "create-preview"
        ? { ...sourceInput, tokenBudget: sourceInput.tokenBudget + 1 }
        : { ...adoption, stateVersion: 1 },
    ),
  });
  assert.equal(newBranch.status, 409);
  assert.equal(
    (await newBranch.json()).detail,
    newMessage,
    "observe the actual changed owner branch, not merely graph metadata",
  );
  assert.deepEqual(await adoptRequest(), adopted);
  assert.deepEqual(await previewRequest(), adopted);
  assert.deepEqual(state(), afterAdoption);
  assert.equal(engineCalls, callsBefore);
  assert.deepEqual(
    await json("/api/v2/scripts/" + script.scriptId + "/screenplay"),
    manuscript,
  );
  const sourceContext = await json(
    "/api/v2/episode-source-revisions/" + pending.id + "/source-context",
  );
  assert.equal(sourceContext.id, pending.id);
  assert.equal(sourceContext.sourceSnapshotId, pending.sourceSnapshotId);
  if (usesNovel)
    assert.ok(
      sourceContext.entries.some(
        (entry) =>
          entry.sourceId === higher.id &&
          entry.fieldPath === "/narrative-summaries/" + higher.id,
      ),
    );
  assert.deepEqual(state(), afterAdoption);
  const changedGraph = runtime.runtimeInfo.graphRevision;
  const exactReceiptSha256 = sha(JSON.stringify(afterAdoption));
  transportPhase = "same-process-restart-replay";
  await runtime.stop();
  runtime = undefined;
  database.close();
  database = undefined;
  await start({ ...config, development: undefined });
  database = openDatabase(databasePath);
  assert.deepEqual(await adoptRequest(), adopted);
  assert.deepEqual(await previewRequest(), adopted);
  assert.deepEqual(state(), afterAdoption);
  assert.equal(engineCalls, callsBefore);
  assert.equal(restarts.length, 0);
  await writeFile(
    fileURLToPath(
      new URL("./source-file-hmr-checkpoint.json", import.meta.url),
    ),
    JSON.stringify({
      entryPath,
      lifecycle,
      requestVersion,
      sourceContext,
      sourceInput,
      previewKey,
      previewPath,
      adoptPath,
      adoptKey,
      adoption,
      adopted,
      scriptRecordId: script.scriptId,
      manuscript,
      exactReceiptSha256,
      changedModuleSha256: sha(changedModule),
      newMessage,
    }),
  );
  process.send({
    type: "passed",
    entryPath,
    processId: process.pid,
    originalModuleSha256: sha(originalModule),
    changedModuleSha256: sha(changedModule),
    beforeGraph,
    changedGraph,
    originalPendingId: pending.id,
    exactReceiptSha256,
    modelCallsBeforeHmr: callsBefore,
    newModelCallsDuringHmrAndReplay: 0,
    reloadCount: afterDiagnostic.hmr.reloadCount,
    routerRevisionDelta: 1,
    failedActualSourceImportRecovered: true,
    restoredOwnerReadReloadRefusals,
    originalSourceRowsPreserved: true,
    lifecycle,
    unchangedContextPreparation:
      lifecycle !== "create-preview" ? true : undefined,
    unchangedFormalHeads: lifecycle !== "adopt" ? true : undefined,
    newPreviewCreationInFlightVerified:
      lifecycle === "create-preview" ? true : undefined,
    singleOriginalContextPreparation:
      lifecycle === "create-preview" ? true : undefined,
    discardedCandidateVerified: lifecycle === "discard" ? true : undefined,
    restoredModuleGraph: beforeImportGraph,
    restoredModuleReloadDelta:
      afterImportFailure.hmr.reloadCount - beforeImportFailure.hmr.reloadCount,
    actualChangedOwnerBranchObserved: true,
    sqliteReconstructionVerified: true,
  });
} finally {
  if (body) {
    body.error(new Error("controlled test cleanup"));
  }
  await runtime?.stop();
  database?.close();
  hostServer.close();
}
