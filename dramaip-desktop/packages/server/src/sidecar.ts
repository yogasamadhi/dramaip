import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, posix } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  initializeOperationalSchema,
  initializeV3AgentSchema,
  openNodeSqliteDatabase,
} from "@sdns/db";
import {
  AGENT_TASK_CATALOG,
  getAgentTaskDefinition,
  isAgentTaskType,
} from "@sdns/ai";
import {
  authorizeMcpTool,
  enforceMcpResultLimit,
  type DramaIpMcpTool,
  type McpAccessClaims,
} from "@sdns/mcp";
import type {
  SourceImportChapter,
  SourceImportCommitResult,
  SourceImportEpisode,
  SourceImportPreview,
  SourceImportScene,
  SourceImportStrategy,
  ImportExtractionCandidate,
  ImportExtractionChangeSet,
  PilotPlan,
  EpisodeWorkflowKind,
  TimelineEditCommand,
  TimelineCommandInput,
  TimelineManifest,
  TimelineTrackKind,
  AudioAssemblyApplyInput,
  AudioTrackKind,
  AudioTrackInput,
  VoiceProfileInput,
  AnimaticDraftInput,
  AnimaticReviewInput,
  ImageGenerationInput,
  TtsGenerationInput,
  VideoGenerationInput,
  VideoGenerationPreflight,
  VideoGenerationBatchPreflight,
  VideoGenerationBatchPreflightInput,
  CreativeCaseStudyInput,
  CreativeCaseStudyPatch,
  CreativeDiagnosticInput,
  CreativeDiagnosticKind,
  CreativeTargetKind,
  CreativeIssueAcknowledgementInput,
  AgentEngineKind,
  AgentModelSelection,
  AgentTaskType,
  AssetCenter,
  AssetCenterCategory,
  AssetCenterUsage,
} from "@sdns/schema";

export interface ServerReadyData {
  url: string;
  username: string;
  password: string;
  version: string;
}

type StartCommand = {
  type: "start";
  hostname: string;
  port: number;
  password: string;
  databasePath: string;
  backupDirectory: string;
  assetDirectory: string;
  allowedOrigins: string[];
  /** 兼容测试宿主；正式桌面端为三个引擎使用互不相同的传输凭据。 */
  mcpToken?: string;
  mcpTokens?: Partial<Record<AgentEngineKind, string>>;
  opencode?: {
    url: string;
    username: string;
    password: string;
    healthy: boolean;
    workspacePath?: string;
  };
  codex?: {
    healthy: boolean;
    version: string;
  };
  langgraph?: {
    healthy: boolean;
    version: string;
  };
};
type Command = StartCommand | { type: "stop" };
type AgentRunOperation = "diagnostic" | "revision";
type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("DramaIP server must run as an Electron utility process");
const hostPort: ParentPort = parentPort;

let server: ReturnType<typeof createServer> | undefined;
let db: DatabaseSync | undefined;
let command: StartCommand | undefined;
const eventClients = new Set<ServerResponse>();
const capabilityRequests = new Map<
  string,
  {
    resolve(value: { path: string; permissions: string[] } | undefined): void;
    reject(error: Error): void;
  }
>();
const credentialRequests = new Map<
  string,
  {
    resolve(value: string | undefined): void;
    reject(error: Error): void;
  }
>();
const opencodeConfigurationRequests = new Map<
  string,
  {
    resolve(value: { available: boolean; message?: string }): void;
    reject(error: Error): void;
  }
>();
const agentEngineRequests = new Map<
  string,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
const activeMcpClaims = new Map<AgentEngineKind, McpAccessClaims>();
const agentEngineRunQueues = new Map<AgentEngineKind, Promise<void>>();
const RESOURCE_DOMAINS = new Set([
  "story",
  "characters",
  "outlines",
  "story-bible",
  "story-bible-settings",
  "story-bible-stale",
  "story-bible-sidecar-preferences",
  "memory",
  "chapter-memories",
  "character-states",
  "visual-profiles",
  "visual-settings",
  "story-events",
  "foreshadowings",
  "analysis",
  "beats",
  "episode-pacing-marks",
  "highlights",
  "feasibility",
  "trends",
  "evaluations",
  "story-arcs",
  "project-skills",
  "agent-schemes",
  "inspirations",
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
  "shot-stills",
  "visual-assets",
  "assets",
  "rights",
  "content-versions",
  "image",
  "audio",
  "video",
  "animatics",
  "renders",
  "quality",
  "compliance",
  "localization",
  "review",
  "delivery",
  "providers",
  "settings",
  "backup",
  "cloud",
  "templates",
  "template-runs",
  "agents",
]);

/**
 * 只保留可由本地应用核验的交付母版。平台后台的实时规则、资质和发布
 * 结果绝不在这里猜测或伪造，均作为人工确认项进入预检和归档。
 */
const PLATFORM_DELIVERY_PROFILES = [
  {
    id: "sdns-vertical-master-2026-08",
    version: "dramaip-vertical-master/2026-08",
    title: "DramaIP 竖屏母版交付",
    platform: "通用外部精剪/发布",
    region: "通用",
    sourceUrl: "urn:dramaip:episode-render-master",
    sourceStatus: "internal_master",
    checkedAt: "2026-08-09T00:00:00.000Z",
    filenamePrefix: "dramaip-master",
    video: { width: 720, height: 1280, videoCodec: "H.264", audioCodec: "AAC" },
    duration: {
      status: "manual",
      note: "成片时长由当前分集策划和外部精剪确认。",
    },
    subtitleSafeZone: {
      bottomMarginPx: 150,
      note: "提交前请在目标平台预览中人工确认字幕安全区。",
    },
    requiredListingFields: ["title", "description", "tags", "cover"],
    manualFields: ["外部精剪后的最终发布规格确认"],
  },
  {
    id: "douyin-manual-submission-2026-08",
    version: "douyin-manual-submission/2026-08",
    title: "抖音人工提交资料包",
    platform: "抖音",
    region: "中国大陆",
    sourceUrl: "https://creator.douyin.com/",
    sourceStatus: "platform_portal",
    checkedAt: "2026-08-09T00:00:00.000Z",
    filenamePrefix: "douyin",
    video: { width: 720, height: 1280, videoCodec: "H.264", audioCodec: "AAC" },
    duration: {
      status: "manual",
      note: "以提交时创作后台的实时限制为准，应用不会猜测。",
    },
    subtitleSafeZone: {
      bottomMarginPx: 150,
      note: "提交前请在平台预览中人工确认字幕不会被界面遮挡。",
    },
    requiredListingFields: ["title", "description", "tags", "cover"],
    manualFields: [
      "发布后台当前视频规格与时长限制",
      "内容分类、资质/备案与广告声明",
      "发布前平台审核结果",
    ],
  },
  {
    id: "hongguo-manual-submission-2026-08",
    version: "hongguo-manual-submission/2026-08",
    title: "红果短剧人工提交资料包",
    platform: "红果短剧",
    region: "中国大陆",
    sourceUrl: "https://www.hongguo.com/",
    sourceStatus: "platform_portal",
    checkedAt: "2026-08-09T00:00:00.000Z",
    filenamePrefix: "hongguo",
    video: { width: 720, height: 1280, videoCodec: "H.264", audioCodec: "AAC" },
    duration: {
      status: "manual",
      note: "以当前合作或投稿入口要求为准，应用不会猜测。",
    },
    subtitleSafeZone: {
      bottomMarginPx: 150,
      note: "提交前请在平台预览中人工确认字幕不会被界面遮挡。",
    },
    requiredListingFields: ["title", "description", "tags", "cover"],
    manualFields: [
      "当前合作/投稿入口资格",
      "分集、版权、资质/备案与审核字段",
      "发布前平台审核结果",
    ],
  },
];

const COMPLIANCE_RULE_PROFILES = [
  {
    id: "cn-aigc-identification-2025-09-01",
    version: "cn-aigc-identification/2025-09-01",
    title: "中国生成合成内容标识办法（正式规则）",
    sourceUrl: "https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm",
    sourceStatus: "official",
    publishedAt: "2025-03-14T00:00:00.000Z",
    effectiveAt: "2025-09-01T00:00:00.000Z",
    regions: ["中国大陆"],
    platforms: [],
    requiredVisibleLabel: "AI Generated",
    requiredMetadataKeys: [
      "dramaip:aigc",
      "dramaip:rule-profile",
      "dramaip:source-fingerprint",
    ],
    contentChecksum:
      "sha256:fa22e0c2573148fac57fcee4206d5a7d6dc579c82ce5573ad3101748abce1110",
    integrityStatus: "verified",
    builtIn: true,
  },
  {
    id: "cn-microdrama-consultation-2026-06-24",
    version: "cn-microdrama-consultation/2026-06-24",
    title: "微短剧发展管理办法（征求意见稿，仅作参考）",
    sourceUrl: "https://www.nrta.gov.cn/art/2026/6/24/art_113_73514.html",
    sourceStatus: "consultation",
    publishedAt: "2026-06-24T00:00:00.000Z",
    regions: ["中国大陆"],
    platforms: [],
    requiredVisibleLabel: "AI Generated",
    requiredMetadataKeys: [
      "dramaip:aigc",
      "dramaip:rule-profile",
      "dramaip:source-fingerprint",
    ],
    contentChecksum:
      "sha256:5712b31878848a52efd9b8e40b2a26101e5bf62dedfc0cf9d89e6a321df85ce9",
    integrityStatus: "verified",
    builtIn: true,
  },
];

hostPort.on("message", (event) => {
  const input = event.data as Partial<Command>;
  if ((input as { type?: string }).type === "capability:resolved") {
    const result = input as {
      requestId: string;
      capability?: { path: string; permissions: string[] };
    };
    const pending = capabilityRequests.get(result.requestId);
    if (pending) {
      capabilityRequests.delete(result.requestId);
      pending.resolve(result.capability);
    }
    return;
  }
  if ((input as { type?: string }).type === "credential:resolved") {
    const result = input as { requestId: string; secret?: string };
    const pending = credentialRequests.get(result.requestId);
    if (pending) {
      credentialRequests.delete(result.requestId);
      pending.resolve(
        typeof result.secret === "string" ? result.secret : undefined,
      );
    }
    return;
  }
  if ((input as { type?: string }).type === "opencode:configured") {
    const result = input as {
      requestId: string;
      available: boolean;
      message?: string;
    };
    const pending = opencodeConfigurationRequests.get(result.requestId);
    if (pending) {
      opencodeConfigurationRequests.delete(result.requestId);
      pending.resolve({
        available: result.available === true,
        ...(typeof result.message === "string"
          ? { message: result.message }
          : {}),
      });
    }
    return;
  }
  if ((input as { type?: string }).type === "opencode:status") {
    const status = input as { healthy?: boolean };
    if (command?.opencode) command.opencode.healthy = status.healthy === true;
    return;
  }
  if ((input as { type?: string }).type === "agent-engine:status") {
    const status = input as {
      engineKind?: AgentEngineKind;
      healthy?: boolean;
      version?: string;
    };
    if (status.engineKind === "codex" && command?.codex) {
      command.codex.healthy = status.healthy === true;
      if (status.version) command.codex.version = status.version;
    }
    if (status.engineKind === "langgraph" && command?.langgraph) {
      command.langgraph.healthy = status.healthy === true;
      if (status.version) command.langgraph.version = status.version;
    }
    emit("agent_engine.status", {
      engineKind: status.engineKind,
      healthy: status.healthy === true,
      version: status.version,
    });
    return;
  }
  if ((input as { type?: string }).type === "agent-engine:response") {
    const result = input as {
      requestId: string;
      result?: unknown;
      error?: string;
    };
    const pending = agentEngineRequests.get(result.requestId);
    if (pending) {
      agentEngineRequests.delete(result.requestId);
      clearTimeout(pending.timeout);
      if (result.error) pending.reject(new Error(result.error));
      else pending.resolve(result.result);
    }
    return;
  }
  if ((input as { type?: string }).type === "agent-engine:event") {
    const incoming = input as {
      engineKind: AgentEngineKind;
      runId: string;
      event: Record<string, unknown>;
    };
    recordAgentEngineEvent(incoming.runId, incoming.event);
    return;
  }
  if (input.type === "stop") return void stop();
  if (input.type === "start") return void start(input as StartCommand);
});

async function start(next: StartCommand): Promise<void> {
  try {
    command = next;
    mkdirSync(dirname(next.databasePath), { recursive: true });
    mkdirSync(next.backupDirectory, { recursive: true });
    db = openNodeSqliteDatabase(next.databasePath).sqlite;
    initializeOperationalSchema(db);
    initializeV3AgentSchema(db);
    initializeDatabaseMaintenance(db);
    server = createServer(handle);
    await new Promise<void>((resolve, reject) =>
      server?.listen(next.port, next.hostname, resolve).once("error", reject),
    );
    hostPort.postMessage({ type: "ready" });
    void restoreActiveAgentProvider();
  } catch (error) {
    hostPort.postMessage({ type: "error", error: serializeError(error) });
    process.exitCode = 1;
  }
}

async function stop(): Promise<void> {
  for (const client of eventClients) client.end();
  eventClients.clear();
  await new Promise<void>(
    (resolve) => server?.close(() => resolve()) ?? resolve(),
  );
  db?.close();
  db = undefined;
  hostPort.postMessage({ type: "stopped" });
  process.exit(0);
}

/** 只做启动恢复、保留期清理与内置规则登记；Schema 由 packages/db 独占。 */
function initializeDatabaseMaintenance(database: DatabaseSync): void {
  seedComplianceRuleProfiles(database);
  const now = timestamp();
  database
    .prepare(
      "UPDATE tasks SET status = ?, error = COALESCE(error, ?), updated_at = ? WHERE status = ?",
    )
    .run(
      "interrupted",
      "Server restarted before the task completed",
      now,
      "running",
    );
  database
    .prepare(
      "UPDATE agent_sessions SET status = ?, active_task_id = NULL, updated_at = ? WHERE status = ?",
    )
    .run("interrupted", now, "running");
  database
    .prepare("DELETE FROM task_events WHERE occurred_at < ?")
    .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString());
  database
    .prepare("DELETE FROM source_imports WHERE expires_at < ?")
    .run(timestamp());
  database
    .prepare("DELETE FROM feedback_previews WHERE expires_at < ?")
    .run(timestamp());
  database
    .prepare("DELETE FROM project_package_imports WHERE expires_at < ?")
    .run(timestamp());
}

function seedComplianceRuleProfiles(database: DatabaseSync): void {
  const now = timestamp();
  const insert = database.prepare(
    `INSERT INTO compliance_rule_profiles
     (id, version, title, source_url, source_status, published_at, effective_at,
      regions_json, platforms_json, required_visible_label, required_metadata_keys_json,
      content_checksum, integrity_status, active, built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      version = excluded.version, title = excluded.title, source_url = excluded.source_url,
      source_status = excluded.source_status, published_at = excluded.published_at,
      effective_at = excluded.effective_at, regions_json = excluded.regions_json,
      platforms_json = excluded.platforms_json,
      required_visible_label = excluded.required_visible_label,
      required_metadata_keys_json = excluded.required_metadata_keys_json,
      content_checksum = excluded.content_checksum, integrity_status = excluded.integrity_status,
      built_in = excluded.built_in, updated_at = excluded.updated_at`,
  );
  for (const profile of COMPLIANCE_RULE_PROFILES)
    insert.run(
      profile.id,
      profile.version,
      profile.title,
      profile.sourceUrl,
      profile.sourceStatus,
      profile.publishedAt,
      profile.effectiveAt ?? null,
      JSON.stringify(profile.regions),
      JSON.stringify(profile.platforms),
      profile.requiredVisibleLabel,
      JSON.stringify(profile.requiredMetadataKeys),
      profile.contentChecksum,
      profile.integrityStatus,
      0,
      profile.builtIn ? 1 : 0,
      now,
      now,
    );
  if (
    !database
      .prepare(
        "SELECT id FROM compliance_rule_profiles WHERE active = 1 LIMIT 1",
      )
      .get()
  ) {
    const defaultProfile = COMPLIANCE_RULE_PROFILES.find(
      (profile) =>
        profile.sourceStatus === "official" &&
        profile.integrityStatus === "verified",
    );
    if (defaultProfile)
      database
        .prepare(
          "UPDATE compliance_rule_profiles SET active = 1, updated_at = ? WHERE id = ?",
        )
        .run(now, defaultProfile.id);
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const requestId = randomUUID();
  try {
    if (!command || !db)
      return respondError(
        res,
        503,
        "INTERNAL_ERROR",
        "Server is not initialized",
        requestId,
      );
    applyCors(req, res);
    if (req.headers.origin && !isAllowedOrigin(req.headers.origin))
      return respondError(
        res,
        403,
        "UNAUTHORIZED",
        "Origin is not allowed",
        requestId,
      );
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(
      req.url ?? "/",
      `http://${command.hostname}:${command.port}`,
    );
    if (url.pathname === "/internal/mcp") {
      const engineKind = mcpEngineForRequest(req);
      if (!engineKind)
        return respondError(
          res,
          401,
          "UNAUTHORIZED",
          "智能引擎工具身份验证失败",
          requestId,
        );
      const claims = activeMcpClaims.get(engineKind);
      if (!claims || claims.expiresAt <= Date.now())
        return respondError(
          res,
          401,
          "UNAUTHORIZED",
          "当前智能运行没有有效的只读工具授权",
          requestId,
        );
      return mcp(req, res, requestId, claims);
    }
    if (!authorized(req))
      return respondError(
        res,
        401,
        "UNAUTHORIZED",
        "Invalid server credentials",
        requestId,
      );
    if (req.method === "GET" && url.pathname === "/api/v1/health")
      return json(res, 200, {
        healthy: true,
        engine: command.opencode?.healthy === true,
      });
    if (req.method === "GET" && url.pathname === "/api/v1/bootstrap")
      return json(res, 200, {
        version: "3.0.0",
        engine: { available: command.opencode?.healthy === true },
      });
    if (req.method === "GET" && url.pathname === "/api/v1/events")
      return streamEvents(req, res, url);
    await route(req, res, url, requestId);
  } catch (error) {
    respondError(
      res,
      500,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Unexpected server error",
      requestId,
    );
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<void> {
  if (!db)
    return respondError(
      res,
      503,
      "INTERNAL_ERROR",
      "Database unavailable",
      requestId,
    );
  const method = req.method ?? "GET";
  const path = url.pathname;
  const exportProjectMatch =
    /^\/api\/v1\/exports\/projects\/([^/]+)\/([^/]+)$/.exec(path);
  if (exportProjectMatch && method === "GET")
    return exportProject(
      res,
      decodeURIComponent(exportProjectMatch[1]),
      decodeURIComponent(exportProjectMatch[2]),
      requestId,
    );
  if (method === "POST" && path === "/api/v1/source-imports/preview")
    return previewSourceImport(req, res, requestId);
  const sourceImportCommit = match(
    path,
    /^\/api\/v1\/source-imports\/([^/]+)\/commit$/,
  );
  if (sourceImportCommit && method === "POST")
    return commitSourceImport(req, res, sourceImportCommit, requestId);
  const sourceImportId = match(path, /^\/api\/v1\/source-imports\/([^/]+)$/);
  if (sourceImportId && method === "DELETE")
    return discardSourceImport(res, sourceImportId, requestId);
  const importExtractionList = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/import-extractions\/change-sets$/,
  );
  if (importExtractionList && method === "GET")
    return listImportExtractionChangeSets(res, importExtractionList, requestId);
  const importExtractionCandidate =
    /^\/api\/v1\/import-extractions\/change-sets\/([^/]+)\/candidates\/([^/]+)$/.exec(
      path,
    );
  if (importExtractionCandidate && method === "PATCH")
    return updateImportExtractionCandidate(
      req,
      res,
      [
        decodeURIComponent(importExtractionCandidate[1]),
        decodeURIComponent(importExtractionCandidate[2]),
      ],
      requestId,
    );
  const importExtractionAdopt = match(
    path,
    /^\/api\/v1\/import-extractions\/change-sets\/([^/]+)\/adopt$/,
  );
  if (importExtractionAdopt && method === "POST")
    return adoptImportExtractionChangeSet(
      req,
      res,
      importExtractionAdopt,
      requestId,
    );
  const importExtractionUndo = match(
    path,
    /^\/api\/v1\/import-extractions\/change-sets\/([^/]+)\/undo$/,
  );
  if (importExtractionUndo && method === "POST")
    return undoImportExtractionChangeSet(res, importExtractionUndo, requestId);
  const pilotPlanList = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/pilot-plans$/,
  );
  if (pilotPlanList && method === "GET")
    return listPilotPlans(res, pilotPlanList, requestId);
  if (method === "POST" && path === "/api/v1/pilot-plans")
    return createPilotPlan(req, res, requestId);
  const pilotPlanAction = match(
    path,
    /^\/api\/v1\/pilot-plans\/([^/]+)\/action$/,
  );
  if (pilotPlanAction && method === "POST")
    return updatePilotPlanAction(req, res, pilotPlanAction, requestId);
  if (method === "POST" && path === "/api/v1/workflows/episodes/run")
    return runEpisodeWorkflow(req, res, requestId);
  if (method === "POST" && path === "/api/v1/image-generation/runs")
    return runImageGeneration(req, res, requestId);
  if (method === "POST" && path === "/api/v1/tts-generation/runs")
    return runTtsGeneration(req, res, requestId);
  if (method === "POST" && path === "/api/v1/video-generation/runs")
    return createVideoGeneration(req, res, requestId);
  const videoPreflightShotId = match(
    path,
    /^\/api\/v1\/shots\/([^/]+)\/video-generation\/preflight$/,
  );
  if (videoPreflightShotId && method === "POST")
    return videoGenerationPreflight(req, res, videoPreflightShotId, requestId);
  const videoBatchPreflightProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/video-generation\/batch-preflight$/,
  );
  if (videoBatchPreflightProjectId && method === "POST")
    return videoGenerationBatchPreflight(
      req,
      res,
      videoBatchPreflightProjectId,
      requestId,
    );
  const videoShotRuns = match(
    path,
    /^\/api\/v1\/shots\/([^/]+)\/video-generation\/runs$/,
  );
  if (videoShotRuns && method === "GET")
    return listVideoGenerationByShot(res, videoShotRuns, requestId);
  const videoRunRefresh = match(
    path,
    /^\/api\/v1\/video-generation\/runs\/([^/]+)\/refresh$/,
  );
  if (videoRunRefresh && method === "POST")
    return refreshVideoGeneration(res, videoRunRefresh, requestId);
  const videoRunCancel = match(
    path,
    /^\/api\/v1\/video-generation\/runs\/([^/]+)\/cancel$/,
  );
  if (videoRunCancel && method === "POST")
    return cancelVideoGeneration(res, videoRunCancel, requestId);
  const videoRunRetry = match(
    path,
    /^\/api\/v1\/video-generation\/runs\/([^/]+)\/retry$/,
  );
  if (videoRunRetry && method === "POST")
    return retryVideoGeneration(req, res, videoRunRetry, requestId);
  const videoRunId = match(
    path,
    /^\/api\/v1\/video-generation\/runs\/([^/]+)$/,
  );
  if (videoRunId && method === "GET")
    return getVideoGeneration(res, videoRunId, requestId);
  if (method === "POST" && path === "/api/v1/feedback/preview")
    return previewFeedbackImport(req, res, requestId);
  const feedbackCommitId = match(
    path,
    /^\/api\/v1\/feedback\/([^/]+)\/commit$/,
  );
  if (feedbackCommitId && method === "POST")
    return commitFeedbackImport(req, res, feedbackCommitId, requestId);
  const feedbackRevisionClusterId = match(
    path,
    /^\/api\/v1\/feedback\/clusters\/([^/]+)\/revision-task$/,
  );
  if (feedbackRevisionClusterId && method === "POST")
    return createFeedbackRevisionTask(
      req,
      res,
      feedbackRevisionClusterId,
      requestId,
    );
  if (method === "POST" && path === "/api/v1/feedback/clusters")
    return clusterFeedback(req, res, requestId);
  const feedbackProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/feedback$/,
  );
  if (feedbackProjectId && method === "GET")
    return feedbackDashboard(res, feedbackProjectId, requestId);
  const productionGraphProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/production-graph$/,
  );
  if (productionGraphProjectId && method === "GET")
    return productionGraph(res, productionGraphProjectId, requestId);
  if (method === "POST" && path === "/api/v1/production/impact")
    return previewProductionImpact(req, res, requestId);
  const generationProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/generation-ledger$/,
  );
  if (generationProjectId && method === "GET")
    return generationLedger(res, generationProjectId, requestId);
  const generationRecordId = match(
    path,
    /^\/api\/v1\/generation-ledger\/([^/]+)$/,
  );
  if (generationRecordId && method === "PATCH")
    return updateGenerationRecord(req, res, generationRecordId, requestId);
  const contentVersionProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/content-versions$/,
  );
  if (contentVersionProjectId && method === "GET")
    return contentVersions(res, contentVersionProjectId, requestId);
  const contentVersionId = match(
    path,
    /^\/api\/v1\/content-versions\/([^/]+)\/restore$/,
  );
  if (contentVersionId && method === "POST")
    return restoreContentVersion(res, contentVersionId, requestId);
  const templateRunId = match(path, /^\/api\/v1\/templates\/([^/]+)\/run$/);
  if (templateRunId && method === "POST")
    return runTemplate(req, res, templateRunId, requestId);
  if (method === "POST" && path === "/api/v1/demo/projects")
    return createDemoProject(res);
  if (method === "GET" && path === "/api/v1/diagnostics")
    return diagnosticReport(res);
  const adoptStillId = match(path, /^\/api\/v1\/shot-stills\/([^/]+)\/adopt$/);
  if (adoptStillId && method === "POST")
    return adoptShotStill(res, adoptStillId, requestId);
  const adoptVisualAssetId = match(
    path,
    /^\/api\/v1\/visual-assets\/([^/]+)\/adopt$/,
  );
  if (adoptVisualAssetId && method === "POST")
    return adoptVisualAsset(res, adoptVisualAssetId, requestId);
  const adoptVideoId = match(path, /^\/api\/v1\/videos\/([^/]+)\/adopt$/);
  if (adoptVideoId && method === "POST")
    return adoptVideo(res, adoptVideoId, requestId);
  const lockVisualAssetId = match(
    path,
    /^\/api\/v1\/visual-assets\/([^/]+)\/lock$/,
  );
  if (lockVisualAssetId && method === "POST")
    return lockVisualAsset(res, lockVisualAssetId, requestId);
  const searchQuery = match(path, /^\/api\/v1\/search\/([^/]+)$/);
  if (searchQuery && method === "GET")
    return globalSearch(res, decodeURIComponent(searchQuery));
  if (method === "GET" && path === "/api/v1/backups")
    return json(
      res,
      200,
      rows("SELECT * FROM backups ORDER BY created_at DESC").map(backup),
    );
  if (method === "POST" && path === "/api/v1/backups") return createBackup(res);
  const restoreBackupId = match(path, /^\/api\/v1\/backups\/([^/]+)\/restore$/);
  if (restoreBackupId && method === "POST")
    return restoreBackup(res, restoreBackupId, requestId);
  if (method === "GET" && path === "/api/v1/projects")
    return json(
      res,
      200,
      rows(
        "SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC",
      ).map(project),
    );
  if (method === "POST" && path === "/api/v1/projects")
    return createProject(req, res, requestId);
  if (method === "GET" && path === "/api/v1/projects/trash")
    return json(
      res,
      200,
      rows(
        "SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
      ).map(project),
    );
  const projectId = match(path, /^\/api\/v1\/projects\/([^/]+)$/);
  if (projectId && method === "GET")
    return getProject(res, projectId, requestId);
  if (projectId && method === "PATCH")
    return updateProject(req, res, projectId, requestId);
  if (projectId && method === "DELETE")
    return purgeProject(req, res, projectId, requestId);
  const trashProjectId = match(path, /^\/api\/v1\/projects\/([^/]+)\/trash$/);
  if (trashProjectId && method === "POST")
    return trashProject(res, trashProjectId, requestId);
  const restoreProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/restore$/,
  );
  if (restoreProjectId && method === "POST")
    return restoreProject(res, restoreProjectId, requestId);
  const currentAdaptationProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/current-adaptation$/,
  );
  if (currentAdaptationProjectId && method === "POST")
    return selectCurrentAdaptation(
      req,
      res,
      currentAdaptationProjectId,
      requestId,
    );
  const reorderProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/chapters\/reorder$/,
  );
  if (reorderProjectId && method === "POST")
    return reorderChapters(req, res, reorderProjectId, requestId);
  const episodeReorderAdaptationId = match(
    path,
    /^\/api\/v1\/adaptations\/([^/]+)\/episodes\/reorder$/,
  );
  if (episodeReorderAdaptationId && method === "POST")
    return reorderProductionChildren(
      req,
      res,
      "episodes",
      episodeReorderAdaptationId,
      requestId,
    );
  const sceneReorderScriptId = match(
    path,
    /^\/api\/v1\/scripts\/([^/]+)\/scenes\/reorder$/,
  );
  if (sceneReorderScriptId && method === "POST")
    return reorderProductionChildren(
      req,
      res,
      "scenes",
      sceneReorderScriptId,
      requestId,
    );
  const shotReorderSceneId = match(
    path,
    /^\/api\/v1\/scenes\/([^/]+)\/shots\/reorder$/,
  );
  if (shotReorderSceneId && method === "POST")
    return reorderProductionChildren(
      req,
      res,
      "shots",
      shotReorderSceneId,
      requestId,
    );
  const adaptationAnalysisId = match(
    path,
    /^\/api\/v1\/adaptations\/([^/]+)\/episode-analysis$/,
  );
  if (adaptationAnalysisId && method === "GET")
    return getEpisodeAnalysis(res, adaptationAnalysisId, requestId);
  if (adaptationAnalysisId && method === "POST")
    return runEpisodeAnalysis(res, adaptationAnalysisId, requestId);
  if (adaptationAnalysisId && method === "DELETE")
    return removeEpisodeAnalysis(res, adaptationAnalysisId, requestId);
  if (method === "GET" && path === "/api/v1/creative/case-studies")
    return listCreativeCaseStudies(res);
  if (method === "POST" && path === "/api/v1/creative/case-studies")
    return createCreativeCaseStudy(req, res, requestId);
  const creativeCaseStudyId = match(
    path,
    /^\/api\/v1\/creative\/case-studies\/([^/]+)$/,
  );
  if (creativeCaseStudyId && method === "PATCH")
    return updateCreativeCaseStudy(req, res, creativeCaseStudyId, requestId);
  if (creativeCaseStudyId && method === "DELETE")
    return removeCreativeCaseStudy(res, creativeCaseStudyId, requestId);
  const creativeProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/creative-diagnostics$/,
  );
  if (creativeProjectId && method === "GET")
    return listCreativeDiagnostics(res, creativeProjectId, requestId);
  if (method === "POST" && path === "/api/v1/creative/diagnostics")
    return runCreativeDiagnostics(req, res, requestId);
  const creativeAcknowledgementProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/creative-issue-acknowledgements$/,
  );
  if (creativeAcknowledgementProjectId && method === "GET")
    return listCreativeIssueAcknowledgements(
      res,
      creativeAcknowledgementProjectId,
      requestId,
    );
  if (method === "POST" && path === "/api/v1/creative/issue-acknowledgements")
    return acknowledgeCreativeIssue(req, res, requestId);
  if (method === "GET" && path === "/api/v1/platform-delivery/profiles")
    return json(res, 200, PLATFORM_DELIVERY_PROFILES);
  if (method === "GET" && path === "/api/v1/compliance/profiles")
    return listComplianceProfiles(res);
  const activateComplianceProfileId = match(
    path,
    /^\/api\/v1\/compliance\/profiles\/([^/]+)\/activate$/,
  );
  if (activateComplianceProfileId && method === "POST")
    return activateComplianceProfile(
      res,
      activateComplianceProfileId,
      requestId,
    );
  const episodeCompliancePreflightId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/compliance-preflight$/,
  );
  if (episodeCompliancePreflightId && method === "POST")
    return runCompliancePreflight(
      req,
      res,
      episodeCompliancePreflightId,
      requestId,
    );
  const adaptationDeliveryVariants = match(
    path,
    /^\/api\/v1\/adaptations\/([^/]+)\/delivery-variants$/,
  );
  if (adaptationDeliveryVariants && method === "GET")
    return listDeliveryCreativeVariants(
      res,
      adaptationDeliveryVariants,
      requestId,
    );
  if (adaptationDeliveryVariants && method === "POST")
    return createDeliveryCreativeVariant(
      req,
      res,
      adaptationDeliveryVariants,
      requestId,
    );
  const adoptDeliveryVariantId = match(
    path,
    /^\/api\/v1\/delivery-variants\/([^/]+)\/adopt$/,
  );
  if (adoptDeliveryVariantId && method === "POST")
    return adoptDeliveryCreativeVariant(res, adoptDeliveryVariantId, requestId);
  const episodeDeliveryArchivesId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/platform-deliveries$/,
  );
  if (episodeDeliveryArchivesId && method === "GET")
    return listPlatformDeliveryArchives(
      res,
      episodeDeliveryArchivesId,
      requestId,
    );
  if (episodeDeliveryArchivesId && method === "POST")
    return createPlatformDeliveryArchive(
      req,
      res,
      episodeDeliveryArchivesId,
      requestId,
    );
  const episodeDeliveryPreflightId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/platform-delivery\/preflight$/,
  );
  if (episodeDeliveryPreflightId && method === "POST")
    return runPlatformDeliveryPreflight(
      req,
      res,
      episodeDeliveryPreflightId,
      requestId,
    );
  const platformDeliveryArchiveExportId = match(
    path,
    /^\/api\/v1\/platform-deliveries\/([^/]+)\/export$/,
  );
  if (platformDeliveryArchiveExportId && method === "GET")
    return exportPlatformDeliveryArchive(
      res,
      platformDeliveryArchiveExportId,
      requestId,
    );
  const episodeTimelineId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/timeline$/,
  );
  if (episodeTimelineId && method === "GET")
    return getTimeline(res, episodeTimelineId, requestId);
  const timelineCommandId = match(
    path,
    /^\/api\/v1\/timelines\/([^/]+)\/commands$/,
  );
  if (timelineCommandId && method === "POST")
    return applyTimelineCommand(req, res, timelineCommandId, requestId);
  const timelineUndoId = match(path, /^\/api\/v1\/timelines\/([^/]+)\/undo$/);
  if (timelineUndoId && method === "POST")
    return undoTimelineCommand(res, timelineUndoId, requestId);
  const timelineRedoId = match(path, /^\/api\/v1\/timelines\/([^/]+)\/redo$/);
  if (timelineRedoId && method === "POST")
    return redoTimelineCommand(res, timelineRedoId, requestId);
  const timelineHistoryId = match(
    path,
    /^\/api\/v1\/timelines\/([^/]+)\/history$/,
  );
  if (timelineHistoryId && method === "GET")
    return timelineHistory(res, timelineHistoryId, requestId);
  const audioAssemblyPreviewEpisodeId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/audio-assembly\/preview$/,
  );
  if (audioAssemblyPreviewEpisodeId && method === "GET")
    return getAudioAssemblyPreview(
      res,
      audioAssemblyPreviewEpisodeId,
      requestId,
    );
  const audioAssemblyApplyEpisodeId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/audio-assembly\/apply$/,
  );
  if (audioAssemblyApplyEpisodeId && method === "POST")
    return applyAudioAssembly(req, res, audioAssemblyApplyEpisodeId, requestId);
  const timelineMediaPreviewId = match(
    path,
    /^\/api\/v1\/timeline-media\/([^/]+)\/preview$/,
  );
  if (timelineMediaPreviewId && method === "GET")
    return timelineMediaPreview(res, timelineMediaPreviewId, requestId);
  const editorTimelineId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/editor-timeline$/,
  );
  if (editorTimelineId && method === "GET")
    return getEditorTimeline(res, editorTimelineId, requestId);
  const editorTimelinePreflightId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/editor-timeline\/preflight$/,
  );
  if (editorTimelinePreflightId && method === "GET")
    return getEditorTimelinePreflight(
      res,
      editorTimelinePreflightId,
      requestId,
    );
  const editorTimelineExport =
    /^\/api\/v1\/episodes\/([^/]+)\/editor-timeline\/export\/(json|edl|fcpxml|srt)$/.exec(
      path,
    );
  if (editorTimelineExport && method === "GET")
    return exportEditorTimeline(
      res,
      decodeURIComponent(editorTimelineExport[1]),
      editorTimelineExport[2] as "json" | "edl" | "fcpxml" | "srt",
      requestId,
    );
  const episodeReviewPackagesId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/review-packages$/,
  );
  if (episodeReviewPackagesId && method === "GET")
    return listReviewPackages(res, episodeReviewPackagesId, requestId);
  if (episodeReviewPackagesId && method === "POST")
    return createReviewPackage(res, episodeReviewPackagesId, requestId);
  const reviewPackageExportId = match(
    path,
    /^\/api\/v1\/review-packages\/([^/]+)\/export$/,
  );
  if (reviewPackageExportId && method === "GET")
    return exportOfflineReviewPackage(res, reviewPackageExportId, requestId);
  const reviewPackageCommentsId = match(
    path,
    /^\/api\/v1\/review-packages\/([^/]+)\/comments$/,
  );
  if (reviewPackageCommentsId && method === "GET")
    return listReviewComments(res, reviewPackageCommentsId, requestId);
  if (reviewPackageCommentsId && method === "POST")
    return createReviewComment(req, res, reviewPackageCommentsId, requestId);
  const reviewCommentId = match(path, /^\/api\/v1\/review-comments\/([^/]+)$/);
  if (reviewCommentId && method === "PATCH")
    return resolveReviewComment(req, res, reviewCommentId, requestId);
  const reviewPackageDecisionsId = match(
    path,
    /^\/api\/v1\/review-packages\/([^/]+)\/decisions$/,
  );
  if (reviewPackageDecisionsId && method === "GET")
    return listReviewDecisions(res, reviewPackageDecisionsId, requestId);
  if (reviewPackageDecisionsId && method === "POST")
    return createReviewDecision(req, res, reviewPackageDecisionsId, requestId);
  const reviewPackageImportId = match(
    path,
    /^\/api\/v1\/review-packages\/([^/]+)\/import-offline$/,
  );
  if (reviewPackageImportId && method === "POST")
    return importOfflineReviewComments(
      req,
      res,
      reviewPackageImportId,
      requestId,
    );
  const voiceProfilesProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/voice-profiles$/,
  );
  if (voiceProfilesProjectId && method === "GET")
    return listVoiceProfiles(res, voiceProfilesProjectId, requestId);
  if (method === "POST" && path === "/api/v1/voice-profiles")
    return createVoiceProfile(req, res, requestId);
  const adoptVoiceProfileId = match(
    path,
    /^\/api\/v1\/voice-profiles\/([^/]+)\/adopt$/,
  );
  if (adoptVoiceProfileId && method === "POST")
    return adoptVoiceProfile(res, adoptVoiceProfileId, requestId);
  const episodeAudioTracksId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/audio-tracks$/,
  );
  if (episodeAudioTracksId && method === "GET")
    return listAudioTracks(res, episodeAudioTracksId, requestId);
  if (method === "POST" && path === "/api/v1/audio-tracks")
    return createAudioTrack(req, res, requestId);
  const adoptAudioTrackId = match(
    path,
    /^\/api\/v1\/audio-tracks\/([^/]+)\/adopt$/,
  );
  if (adoptAudioTrackId && method === "POST")
    return adoptAudioTrack(res, adoptAudioTrackId, requestId);
  const episodeAnimaticInitializationId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/animatic-initialization$/,
  );
  if (episodeAnimaticInitializationId && method === "GET")
    return initializeAnimatic(res, episodeAnimaticInitializationId, requestId);
  const episodeAnimaticsId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/animatics$/,
  );
  if (episodeAnimaticsId && method === "GET")
    return listAnimaticDrafts(res, episodeAnimaticsId, requestId);
  if (method === "POST" && path === "/api/v1/animatics")
    return createAnimaticDraft(req, res, requestId);
  const animaticReviewId = match(
    path,
    /^\/api\/v1\/animatics\/([^/]+)\/review$/,
  );
  if (animaticReviewId && method === "POST")
    return reviewAnimaticDraft(req, res, animaticReviewId, requestId);
  const episodeRenderPreflightId = match(
    path,
    /^\/api\/v1\/episodes\/([^/]+)\/render-preflight$/,
  );
  if (episodeRenderPreflightId && method === "GET")
    return getEpisodeRenderPreflight(res, episodeRenderPreflightId, requestId);
  const scriptReviewId = match(path, /^\/api\/v1\/scripts\/([^/]+)\/review$/);
  if (scriptReviewId && method === "GET")
    return getScriptReview(res, scriptReviewId, requestId);
  if (scriptReviewId && method === "POST")
    return runScriptReview(res, scriptReviewId, requestId);
  if (scriptReviewId && method === "DELETE")
    return removeScriptReview(res, scriptReviewId, requestId);
  const shotReviewId = match(path, /^\/api\/v1\/shots\/([^/]+)\/review$/);
  if (shotReviewId && method === "GET")
    return getShotReview(res, shotReviewId, requestId);
  if (shotReviewId && method === "POST")
    return runShotReview(res, shotReviewId, requestId);
  if (shotReviewId && method === "DELETE")
    return removeShotReview(res, shotReviewId, requestId);
  const shotPromptVersionsId = match(
    path,
    /^\/api\/v1\/shots\/([^/]+)\/prompt-versions$/,
  );
  if (shotPromptVersionsId && method === "GET")
    return listPromptVersions(res, shotPromptVersionsId, requestId);
  if (shotPromptVersionsId && method === "POST")
    return appendPromptVersion(req, res, shotPromptVersionsId, requestId);
  const projectChapters = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/chapters$/,
  );
  if (projectChapters && method === "GET")
    return json(
      res,
      200,
      rows("SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index", [
        projectChapters,
      ]).map(chapter),
    );
  if (method === "POST" && path === "/api/v1/chapters")
    return createChapter(req, res, requestId);
  const chapterId = match(path, /^\/api\/v1\/chapters\/([^/]+)$/);
  if (chapterId && method === "GET")
    return getChapter(res, chapterId, requestId);
  if (chapterId && method === "PATCH")
    return updateChapter(req, res, chapterId, requestId);
  if (chapterId && method === "DELETE")
    return removeChapter(res, chapterId, requestId);
  if (method === "GET" && path === "/api/v1/tasks")
    return json(
      res,
      200,
      rows("SELECT * FROM tasks ORDER BY created_at DESC").map(task),
    );
  if (method === "POST" && path === "/api/v1/tasks")
    return createTask(req, res, requestId);
  const cancelTask = match(path, /^\/api\/v1\/tasks\/([^/]+)\/cancel$/);
  if (cancelTask && method === "POST")
    return cancelTaskRoute(res, cancelTask, requestId);
  const retryTask = match(path, /^\/api\/v1\/tasks\/([^/]+)\/retry$/);
  if (retryTask && method === "POST")
    return retryTaskRoute(req, res, retryTask, requestId);
  if (method === "POST" && path === "/api/v1/revisions")
    return createRevision(req, res, requestId);
  const revisionId = match(path, /^\/api\/v1\/revisions\/([^/]+)$/);
  if (revisionId && method === "GET")
    return getRevision(res, revisionId, requestId);
  const commitId = match(path, /^\/api\/v1\/revisions\/([^/]+)\/commit$/);
  if (commitId && method === "POST")
    return commitRevision(req, res, commitId, requestId);
  const discardId = match(path, /^\/api\/v1\/revisions\/([^/]+)\/discard$/);
  if (discardId && method === "POST")
    return discardRevision(req, res, discardId, requestId);
  if (method === "POST" && path === "/api/v1/agent-sessions")
    return createAgentSession(req, res, requestId);
  if (method === "GET" && path === "/api/v1/agent-engines")
    return listAgentEngines(res);
  if (method === "GET" && path === "/api/v1/agent-tasks")
    return listAgentTasks(res);
  if (method === "GET" && path === "/api/v1/agent-settings")
    return getGlobalAgentSettings(res);
  if (method === "PUT" && path === "/api/v1/agent-settings")
    return updateGlobalAgentSettings(req, res, requestId);
  const projectAgentSettings = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/agent-settings$/,
  );
  if (projectAgentSettings && method === "GET")
    return getProjectAgentSettings(res, projectAgentSettings, requestId);
  if (projectAgentSettings && method === "PUT")
    return updateProjectAgentSettings(
      req,
      res,
      projectAgentSettings,
      requestId,
    );
  const agentRun = match(path, /^\/api\/v1\/agent-sessions\/([^/]+)\/runs$/);
  if (agentRun && method === "POST")
    return runAgentSession(req, res, agentRun, requestId);
  const abortAgent = match(path, /^\/api\/v1\/agent-sessions\/([^/]+)\/abort$/);
  if (abortAgent && method === "POST")
    return abortAgentSession(res, abortAgent, requestId);
  const agentSessionId = match(path, /^\/api\/v1\/agent-sessions\/([^/]+)$/);
  if (agentSessionId && method === "GET")
    return getAgentSession(res, agentSessionId, requestId);
  if (agentSessionId && method === "DELETE")
    return disposeAgentSession(res, agentSessionId, requestId);
  const forkAgentSessionId = match(
    path,
    /^\/api\/v1\/agent-sessions\/([^/]+)\/fork$/,
  );
  if (forkAgentSessionId && method === "POST")
    return forkAgentSession(res, forkAgentSessionId, requestId);
  const agentRunId = match(path, /^\/api\/v1\/agent-runs\/([^/]+)$/);
  if (agentRunId && method === "GET")
    return getAgentRun(res, agentRunId, requestId);
  const agentRunItems = match(path, /^\/api\/v1\/agent-runs\/([^/]+)\/items$/);
  if (agentRunItems && method === "GET")
    return listAgentRunItems(res, agentRunItems, requestId);
  const interruptAgentRun = match(
    path,
    /^\/api\/v1\/agent-runs\/([^/]+)\/interrupt$/,
  );
  if (interruptAgentRun && method === "POST")
    return interruptAgentRunRoute(res, interruptAgentRun, requestId);
  const resumeAgentRun = match(
    path,
    /^\/api\/v1\/agent-runs\/([^/]+)\/resume$/,
  );
  if (resumeAgentRun && method === "POST")
    return resumeAgentRunRoute(res, resumeAgentRun, requestId);
  if (method === "POST" && path === "/api/v1/agent-experiments")
    return createAgentExperiment(req, res, requestId);
  const agentExperimentId = match(
    path,
    /^\/api\/v1\/agent-experiments\/([^/]+)$/,
  );
  if (agentExperimentId && method === "GET")
    return getAgentExperiment(res, agentExperimentId, requestId);
  const agentExperimentReviewId = match(
    path,
    /^\/api\/v1\/agent-experiments\/([^/]+)\/review$/,
  );
  if (agentExperimentReviewId && method === "POST")
    return reviewAgentExperiment(req, res, agentExperimentReviewId, requestId);
  const changePreviewId = match(path, /^\/api\/v1\/change-previews\/([^/]+)$/);
  if (changePreviewId && method === "GET")
    return getChangePreview(res, changePreviewId, requestId);
  const commitChangePreviewId = match(
    path,
    /^\/api\/v1\/change-previews\/([^/]+)\/commit$/,
  );
  if (commitChangePreviewId && method === "POST")
    return commitChangePreview(req, res, commitChangePreviewId, requestId);
  const discardChangePreviewId = match(
    path,
    /^\/api\/v1\/change-previews\/([^/]+)\/discard$/,
  );
  if (discardChangePreviewId && method === "POST")
    return discardChangePreview(req, res, discardChangePreviewId, requestId);
  const providerActionPreviewId = match(
    path,
    /^\/api\/v1\/provider-action-previews\/([^/]+)$/,
  );
  if (providerActionPreviewId && method === "GET")
    return getProviderActionPreview(res, providerActionPreviewId, requestId);
  const executeProviderActionPreviewId = match(
    path,
    /^\/api\/v1\/provider-action-previews\/([^/]+)\/execute$/,
  );
  if (executeProviderActionPreviewId && method === "POST")
    return executeProviderActionPreview(
      req,
      res,
      executeProviderActionPreviewId,
      requestId,
    );
  const discardProviderActionPreviewId = match(
    path,
    /^\/api\/v1\/provider-action-previews\/([^/]+)\/discard$/,
  );
  if (discardProviderActionPreviewId && method === "POST")
    return discardProviderActionPreview(
      req,
      res,
      discardProviderActionPreviewId,
      requestId,
    );
  if (method === "GET" && path === "/api/v1/agent-engines/codex/auth")
    return getCodexAuthStatus(res, requestId);
  if (method === "POST" && path === "/api/v1/agent-engines/codex/login")
    return loginCodex(req, res, requestId);
  if (method === "POST" && path === "/api/v1/agent-engines/codex/logout")
    return logoutCodex(res, requestId);
  const providerConnection = match(
    path,
    /^\/api\/v1\/providers\/([^/]+)\/test-connection$/,
  );
  if (providerConnection && method === "POST")
    return testProviderConnection(res, providerConnection, requestId);
  const providerActivation = match(
    path,
    /^\/api\/v1\/providers\/([^/]+)\/activate-for-agent$/,
  );
  if (providerActivation && method === "POST")
    return activateProviderForAgent(res, providerActivation, requestId);
  const storyBibleSettings = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/story-bible\/settings$/,
  );
  if (storyBibleSettings && method === "GET")
    return getStoryBibleSettings(res, storyBibleSettings, requestId);
  if (storyBibleSettings && method === "PUT")
    return updateStoryBibleSettings(req, res, storyBibleSettings, requestId);
  const storyBibleList = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/story-bible\/change-sets$/,
  );
  if (storyBibleList && method === "GET")
    return listStoryBibleChangeSets(res, storyBibleList, requestId);
  const storyBibleStale = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/story-bible\/stale$/,
  );
  if (storyBibleStale && method === "GET")
    return listStoryBibleStaleMarks(res, storyBibleStale, requestId);
  if (method === "POST" && path === "/api/v1/story-bible/change-sets")
    return queueStoryBibleChangeSet(req, res, requestId);
  const storyBibleApply = match(
    path,
    /^\/api\/v1\/story-bible\/change-sets\/([^/]+)\/apply$/,
  );
  if (storyBibleApply && method === "POST")
    return applyStoryBibleChangeSet(req, res, storyBibleApply, requestId);
  const storyBibleUndo = match(
    path,
    /^\/api\/v1\/story-bible\/change-sets\/([^/]+)\/undo$/,
  );
  if (storyBibleUndo && method === "POST")
    return undoStoryBibleChangeSet(res, storyBibleUndo, requestId);
  const storyBibleStatus = match(
    path,
    /^\/api\/v1\/story-bible\/change-sets\/([^/]+)\/status$/,
  );
  if (storyBibleStatus && method === "PATCH")
    return setStoryBibleChangeSetStatus(req, res, storyBibleStatus, requestId);
  if (method === "POST" && path === "/api/v1/project-packages/preview")
    return previewProjectPackage(req, res, requestId);
  const projectPackageCommit = match(
    path,
    /^\/api\/v1\/project-packages\/([^/]+)\/commit$/,
  );
  if (projectPackageCommit && method === "POST")
    return commitProjectPackage(req, res, projectPackageCommit, requestId);
  const projectPackage = match(path, /^\/api\/v1\/project-packages\/([^/]+)$/);
  if (projectPackage && method === "DELETE")
    return discardProjectPackage(res, projectPackage, requestId);
  const adoptLocalization = match(
    path,
    /^\/api\/v1\/localization\/([^/]+)\/adopt$/,
  );
  if (adoptLocalization && method === "POST")
    return adoptLocalizationVariant(res, adoptLocalization, requestId);
  const localizationSubtitles =
    /^\/api\/v1\/localization\/([^/]+)\/subtitles\/(srt|vtt)$/.exec(path);
  if (localizationSubtitles && method === "GET")
    return exportLocalizationSubtitles(
      res,
      decodeURIComponent(localizationSubtitles[1]),
      localizationSubtitles[2],
      requestId,
    );
  const deliveryExport = match(path, /^\/api\/v1\/delivery\/([^/]+)\/export$/);
  if (deliveryExport && method === "GET")
    return exportDeliveryManifest(res, deliveryExport, requestId);
  const assetCenterProjectId = match(
    path,
    /^\/api\/v1\/projects\/([^/]+)\/asset-center$/,
  );
  if (assetCenterProjectId && method === "GET")
    return getAssetCenter(res, assetCenterProjectId, requestId);
  const assetCenterPreviewId = match(
    path,
    /^\/api\/v1\/asset-center\/([^/]+)\/preview$/,
  );
  if (assetCenterPreviewId && method === "GET")
    return assetCenterPreview(res, assetCenterPreviewId, requestId);
  const assetCenterActionId = match(
    path,
    /^\/api\/v1\/asset-center\/([^/]+)\/action$/,
  );
  if (assetCenterActionId && method === "POST")
    return assetCenterAction(req, res, assetCenterActionId, requestId);
  const chapterAnalysis = match(
    path,
    /^\/api\/v1\/chapters\/([^/]+)\/analysis$/,
  );
  if (chapterAnalysis && method === "POST")
    return runChapterAnalysis(res, chapterAnalysis, requestId);
  const resourceItem = /^\/api\/v1\/([^/]+)\/([^/]+)$/.exec(path);
  const resourceCollection = /^\/api\/v1\/([^/]+)$/.exec(path);
  if (resourceItem && RESOURCE_DOMAINS.has(resourceItem[1]))
    return resource(
      req,
      res,
      method,
      resourceItem[1],
      decodeURIComponent(resourceItem[2]),
      requestId,
      url,
    );
  if (resourceCollection && RESOURCE_DOMAINS.has(resourceCollection[1]))
    return resource(
      req,
      res,
      method,
      resourceCollection[1],
      undefined,
      requestId,
      url,
    );
  respondError(
    res,
    404,
    "NOT_FOUND",
    `No route for ${method} ${path}`,
    requestId,
  );
}

function exportProject(
  res: ServerResponse,
  projectId: string,
  format: string,
  requestId: string,
): void {
  const source = one(
    "SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL",
    [projectId],
  );
  if (!source)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (
    !["json", "markdown", "script", "storyboard", "delivery"].includes(format)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Unsupported export format",
      requestId,
    );
  const snapshot = {
    exportedAt: timestamp(),
    project: project(source),
    chapters: rows(
      "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
      [projectId],
    ).map(chapter),
    resources: rows(
      "SELECT * FROM domain_entities WHERE project_id = ? ORDER BY domain, updated_at DESC",
      [projectId],
    ).map(domainEntity),
    importExtractions: rows(
      "SELECT * FROM import_extraction_change_sets WHERE project_id = ? ORDER BY updated_at DESC",
      [projectId],
    ).map(importExtractionChangeSet),
  };
  const safeTitle =
    String(source.title)
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim()
      .slice(0, 80) || "DramaIP项目";
  if (format === "json")
    return json(res, 200, {
      fileName: `${safeTitle}.json`,
      mimeType: "application/json",
      content: JSON.stringify(snapshot, null, 2),
    });
  if (format === "script")
    return json(res, 200, {
      fileName: `${safeTitle}-剧本.md`,
      mimeType: "text/markdown",
      content: scriptMarkdown(snapshot),
    });
  if (format === "storyboard")
    return json(res, 200, {
      fileName: `${safeTitle}-分镜.md`,
      mimeType: "text/markdown",
      content: storyboardMarkdown(snapshot),
    });
  if (format === "delivery")
    return json(res, 200, {
      fileName: `${safeTitle}-交付资料.json`,
      mimeType: "application/json",
      content: JSON.stringify(deliverySnapshot(snapshot), null, 2),
    });
  return json(res, 200, {
    fileName: `${safeTitle}.md`,
    mimeType: "text/markdown",
    content: projectMarkdown(snapshot),
  });
}

function projectMarkdown(snapshot: {
  exportedAt: string;
  project: ReturnType<typeof project>;
  chapters: Array<ReturnType<typeof chapter>>;
  resources: Array<ReturnType<typeof domainEntity>>;
}): string {
  const lines = [
    `# ${snapshot.project.title}`,
    "",
    `- 题材：${snapshot.project.shortDramaType}`,
    `- 导出时间：${snapshot.exportedAt}`,
    "",
    "## 项目简介",
    "",
    snapshot.project.synopsis || "（未填写）",
    "",
    "## 章节",
    "",
  ];
  for (const chapter of snapshot.chapters) {
    lines.push(`### ${chapter.title}`, "");
    if (chapter.summary) lines.push(chapter.summary, "");
    if (chapter.content) lines.push(chapter.content, "");
  }
  if (snapshot.resources.length) {
    lines.push("## 项目资料", "");
    for (const resource of snapshot.resources)
      lines.push(`- ${resource.title}`);
    lines.push("");
  }
  return lines.join("\n");
}

function scriptMarkdown(snapshot: {
  project: ReturnType<typeof project>;
  resources: Array<ReturnType<typeof domainEntity>>;
}): string {
  const scripts = snapshot.resources.filter(
    (item) => item.domain === "scripts",
  );
  const lines = [`# ${snapshot.project.title}·剧本`, ""];
  if (!scripts.length) return [...lines, "暂无已建立的剧本。", ""].join("\n");
  for (const script of scripts) {
    const payload = domainPayload(script.payload);
    lines.push(`## ${script.title}`, "");
    lines.push(stringPayload(payload, "剧本内容") || "（未填写剧本正文）", "");
  }
  return lines.join("\n");
}

function storyboardMarkdown(snapshot: {
  project: ReturnType<typeof project>;
  resources: Array<ReturnType<typeof domainEntity>>;
}): string {
  const shots = snapshot.resources.filter((item) => item.domain === "shots");
  const lines = [`# ${snapshot.project.title}·分镜`, ""];
  if (!shots.length) return [...lines, "暂无已建立的分镜。", ""].join("\n");
  for (const [index, shot] of shots.entries()) {
    const payload = domainPayload(shot.payload);
    lines.push(`## ${index + 1}. ${shot.title}`, "");
    lines.push(
      `- 镜头描述：${stringPayload(payload, "镜头描述") || "（未填写）"}`,
    );
    lines.push(
      `- 生成提示：${stringPayload(payload, "生成提示") || "（未填写）"}`,
    );
    const adopted = stringPayload(payload, "采用静帧候选");
    if (adopted) lines.push(`- 已采用静帧候选：${adopted}`);
    lines.push("");
  }
  return lines.join("\n");
}

function deliverySnapshot(snapshot: {
  exportedAt: string;
  project: ReturnType<typeof project>;
  resources: Array<ReturnType<typeof domainEntity>>;
}) {
  const domains = new Set([
    "quality",
    "compliance",
    "localization",
    "review",
    "delivery",
    "renders",
    "assets",
    "rights",
  ]);
  return {
    exportedAt: snapshot.exportedAt,
    project: snapshot.project,
    deliveryRecords: snapshot.resources.filter((resource) =>
      domains.has(resource.domain),
    ),
  };
}

function createDemoProject(res: ServerResponse): void {
  const id = randomUUID();
  const now = timestamp();
  const title = "示例短剧：雨夜归来";
  db!
    .prepare(
      `INSERT INTO projects (
        id, title, short_drama_type, target_audience, target_word_count,
        target_episode_count, core_hook, emotional_core, core_selling_point,
        synopsis, style_guide, visual_style_direction, genre_opportunity,
        production_brief, deleted_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    )
    .run(
      id,
      title,
      "都市悬疑情感",
      "18—35 岁喜欢反转与情感线的观众",
      12_000,
      12,
      "失踪三年的恋人带着陌生身份，在暴雨夜敲响女主的门。",
      "信任、记忆与重新选择。",
      "每集一个新线索，情感关系与身份谜团同步反转。",
      "摄影师林晚在雨夜遇见自称失忆的陆沉，却发现他掌握着三年前失踪案的关键证据。",
      "克制、紧张、以人物选择推动反转。",
      "雨夜霓虹、旧胶片质感、近景情绪镜头。",
      "都市悬疑与情感救赎结合的短剧方向。",
      "先完成前三集故事验证，再扩展全季制作。",
      now,
      now,
    );
  const chapters = [
    {
      title: "第一章：雨夜敲门",
      summary: "林晚在停电的雨夜见到失踪三年的陆沉。",
      content:
        "暴雨吞没了巷口的霓虹。林晚打开门，门外的人浑身湿透，却叫出了她从未对外提起的小名。",
    },
    {
      title: "第二章：旧照片",
      summary: "一张旧照片证明陆沉似乎从未离开这座城市。",
      content:
        "照片背面写着一个日期，正是陆沉失踪后的第七天。林晚意识到，自己记得的那场告别或许并不完整。",
    },
    {
      title: "第三章：无人接听",
      summary: "匿名来电要求林晚交出照片，否则陆沉会再次消失。",
      content:
        "电话另一端没有声音，只有规律的列车广播。陆沉看向窗外，第一次露出恐惧：那趟列车本不该存在。",
    },
  ];
  for (const [index, chapterInput] of chapters.entries()) {
    const chapterId = randomUUID();
    db!
      .prepare(
        `INSERT INTO chapters (id, project_id, title, order_index, summary, content, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        chapterId,
        id,
        chapterInput.title,
        index,
        chapterInput.summary,
        chapterInput.content,
        now,
        now,
      );
  }
  insertDomainEntity("characters", id, undefined, "林晚", {
    角色定位: "女主角，独立摄影师",
    人物目标: "查清失踪真相，并决定是否再次相信陆沉。",
    性格与弱点: "冷静克制，却害怕再次失去重要的人。",
    关系与秘密: "曾是陆沉恋人，掌握一张关键照片。",
  });
  insertDomainEntity("characters", id, undefined, "陆沉", {
    角色定位: "失踪归来的男主角",
    人物目标: "找回失去的记忆，并阻止幕后者继续行动。",
    性格与弱点: "表面镇定，记忆碎片会引发失控。",
    关系与秘密: "身份可能被人替换，知道列车线索。",
  });
  insertDomainEntity("outlines", id, undefined, "前三章验证大纲", {
    故事阶段: "开局验证",
    核心冲突: "林晚无法确认归来者是否真是陆沉。",
    章节目标: "建立身份谜团、情感拉扯和列车线索。",
    反转与悬念: "旧照片日期与失踪时间矛盾，匿名来电将威胁升级。",
  });
  insertDomainEntity("story-bible", id, undefined, "世界观核心设定", {
    关联章节: "第一章至第三章",
    状态: "待确认",
    变更说明: "雨夜、旧照片和不存在的列车是贯穿全剧的关键意象。",
    冲突与处理: "陆沉是否本人必须在中段前给出可验证线索。",
  });
  const adaptationId = insertDomainEntity(
    "adaptations",
    id,
    undefined,
    "雨夜归来·第一季改编方案",
    {
      改编方向: "都市悬疑情感短剧",
      目标集数: 12,
      改编简介: "以雨夜重逢开局，围绕旧照片与不存在的列车逐集揭开身份谜团。",
      改编策略: "每集结尾保留可视化线索和关系反转。",
    },
  );
  const episodeId = insertDomainEntity(
    "episodes",
    id,
    adaptationId,
    "第 1 集：雨夜敲门",
    {
      集数: 1,
      关联改编项目: "雨夜归来·第一季改编方案",
      分集简介: "林晚在暴雨夜为陌生来客开门，发现他就是失踪三年的陆沉。",
      结尾悬念: "陆沉叫出了无人知晓的小名。",
    },
  );
  const scriptId = insertDomainEntity("scripts", id, episodeId, "第 1 集剧本", {
    关联分集: "第 1 集：雨夜敲门",
    剧本内容:
      "【雨夜·林晚公寓门口】\n林晚打开门。\n陆沉：你还记得我吗？\n林晚：你不该出现在这里。",
    审查意见: "示例剧本，已具备拆分场景与分镜的基础。",
  });
  const sceneId = insertDomainEntity(
    "scenes",
    id,
    scriptId,
    "场景 1：雨夜门口",
    {
      关联剧本: "第 1 集剧本",
      地点与时间: "林晚公寓门口·雨夜",
      场景动作: "雨水、停电、门缝里的霓虹反光与两人的对视。",
      对白与备注: "对白保持短促，镜头优先捕捉迟疑和认出对方后的情绪。",
    },
  );
  const shotId = insertDomainEntity(
    "shots",
    id,
    sceneId,
    "镜头 1：门缝中的雨夜",
    {
      关联场景: "场景 1：雨夜门口",
      镜头序号: 1,
      镜头描述: "从门内推近林晚，再切到门外被雨水打湿的陆沉。",
      生成提示: "雨夜霓虹，近景人物情绪，对比强烈的冷暖光。",
      审查备注: "人物身份揭示前避免完整正面曝光。",
    },
  );
  insertDomainEntity("shots", id, sceneId, "镜头 2：雨中的来客", {
    关联场景: "场景 1：雨夜门口",
    镜头序号: 2,
    镜头描述: "切到雨中的陆沉，他压低声音叫出林晚的小名。",
    对白: "陆沉：你还记得我吗？",
    景别: "近景",
    运镜: "固定",
    时长: "3 秒",
    审查备注: "保持门内外视线关系，暂不揭示完整身份。",
  });
  insertDomainEntity("assets", id, undefined, "雨夜霓虹参考素材", {
    素材类型: "视觉参考",
    来源: "DramaIP 内置示例素材说明",
    用途与备注: "用于第 1 集雨夜门口场景的氛围参考。",
    版权说明: "仅用于本地内置示例演示，不可用于实际发行。",
  });
  insertDomainEntity("visual-assets", id, undefined, "林晚·雨夜服装设定", {
    资产类型: "角色",
    关联对象: "林晚",
    视觉说明: "深色风衣、湿发、手持旧相机，雨夜霓虹反光。",
    采用状态: "已采用",
    锁定状态: "未锁定",
  });
  insertDomainEntity("shot-stills", id, shotId, "门缝雨夜静帧候选 A", {
    关联分镜: "镜头 1：门缝中的雨夜",
    生成提示: "半开门、雨夜霓虹、人物近景、胶片颗粒。",
    画面说明: "林晚在门内，陆沉站在雨中，门缝形成构图边界。",
    采用状态: "已采用",
  });
  insertDomainEntity("audio", id, episodeId, "第 1 集临时音轨", {
    音频类型: "氛围与对白",
    关联分集: "第 1 集：雨夜敲门",
    制作说明: "雨声、远处列车广播与两句示例对白。",
    采用状态: "待审阅",
  });
  insertDomainEntity("animatics", id, episodeId, "第 1 集动态分镜草案", {
    关联分集: "第 1 集：雨夜敲门",
    审阅状态: "待审阅",
    时间线说明: "0—3 秒：门内推近；3—6 秒：雨中来客；6—9 秒：两人对视。",
    审阅意见: "示例草案，尚未合成实际视频。",
  });
  insertDomainEntity("quality", id, episodeId, "第 1 集质量检查", {
    关联分集: "第 1 集：雨夜敲门",
    严重程度: "提示",
    问题描述: "示例项目中的音轨和最终渲染尚未完成。",
    返工方案: "补充正式音轨与渲染后重新检查。",
  });
  insertDomainEntity("compliance", id, episodeId, "第 1 集合规预检", {
    规则来源: "内置示例规则",
    检查状态: "待人工核验",
    风险与依据: "示例内容不包含真实平台或法务结论。",
    处理说明: "实际发行前必须按地区和平台要求复核。",
  });
  insertDomainEntity("localization", id, episodeId, "第 1 集简体中文字幕", {
    目标语言: "简体中文",
    关联分集: "第 1 集：雨夜敲门",
    字幕与译文: "你还记得我吗？\n你不该出现在这里。",
    采用状态: "已采用",
  });
  insertDomainEntity("review", id, episodeId, "第 1 集审片包", {
    审片方式: "本地示例审阅",
    审片状态: "待确认",
    评论: "确认雨夜氛围和身份揭示镜头节奏。",
    决策与跟进: "补全音轨与渲染后进入交付预检。",
  });
  insertDomainEntity("delivery", id, episodeId, "第 1 集平台交付清单", {
    目标平台: "待选择",
    交付状态: "待预检",
    预检结果: "示例项目仅用于展示交付清单结构。",
    交付说明: "可在审核交付工作区导出本地 JSON 交付清单。",
  });
  const created = project(one("SELECT * FROM projects WHERE id = ?", [id])!);
  emit("project.created", created);
  json(res, 201, created);
}

function diagnosticReport(res: ServerResponse): void {
  const count = (table: "projects" | "chapters" | "tasks" | "backups") =>
    Number(one(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0);
  json(res, 200, {
    generatedAt: timestamp(),
    serverVersion: "3.0.0",
    engineAvailable: command?.opencode?.healthy === true,
    database: {
      projectCount: count("projects"),
      chapterCount: count("chapters"),
      taskCount: count("tasks"),
      backupCount: count("backups"),
    },
  });
}

function generationLedger(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM generation_records WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    ).map(generationRecord),
  );
}

async function updateGenerationRecord(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one("SELECT * FROM generation_records WHERE id = ?", [id]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Generation record not found",
      requestId,
    );
  const input = await body(req);
  const actualCost =
    typeof input.actualCost === "number" && Number.isFinite(input.actualCost)
      ? input.actualCost
      : current.actual_cost;
  if (actualCost !== null && actualCost !== undefined && Number(actualCost) < 0)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Generation cost must not be negative",
      requestId,
    );
  const currency =
    typeof input.currency === "string" && input.currency.trim()
      ? input.currency.trim().slice(0, 12)
      : String(current.currency);
  const note =
    typeof input.costNote === "string"
      ? input.costNote.trim().slice(0, 2_000) || null
      : current.cost_note;
  db!
    .prepare(
      "UPDATE generation_records SET actual_cost = ?, currency = ?, cost_note = ?, updated_at = ? WHERE id = ?",
    )
    .run(actualCost ?? null, currency, note ?? null, timestamp(), id);
  const updated = generationRecord(
    one("SELECT * FROM generation_records WHERE id = ?", [id])!,
  );
  emit("generation.updated", updated);
  json(res, 200, updated);
}

function recordGeneration(input: {
  projectId: string;
  taskId?: string;
  kind: string;
  title: string;
  status: string;
  summary: string;
}): void {
  const now = timestamp();
  const id = randomUUID();
  db!
    .prepare(
      "INSERT INTO generation_records VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'CNY', NULL, ?, ?)",
    )
    .run(
      id,
      input.projectId,
      input.taskId ?? null,
      input.kind,
      input.title,
      input.status,
      input.summary,
      now,
      now,
    );
  emit(
    "generation.created",
    generationRecord(
      one("SELECT * FROM generation_records WHERE id = ?", [id])!,
    ),
  );
}

function generationRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ...(row.task_id ? { taskId: String(row.task_id) } : {}),
    kind: String(row.kind),
    title: String(row.title),
    status: String(row.status),
    summary: String(row.summary),
    ...(row.actual_cost === null || row.actual_cost === undefined
      ? {}
      : { actualCost: Number(row.actual_cost) }),
    currency: String(row.currency),
    ...(row.cost_note ? { costNote: String(row.cost_note) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function contentVersions(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY created_at DESC",
      ["content-versions", projectId],
    ).map(domainEntity),
  );
}

function restoreContentVersion(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const version = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "content-versions"],
  );
  if (!version)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Content checkpoint not found",
      requestId,
    );
  const payload = domainPayload(version.payload_json);
  const targetId =
    stringPayload(payload, "目标标识") || String(version.parent_id ?? "");
  const targetKind = stringPayload(payload, "目标类型");
  const content = stringPayload(payload, "内容");
  if (!targetId || !content || !["章节", "剧本"].includes(targetKind))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Content checkpoint is incomplete",
      requestId,
    );
  db!.exec("BEGIN IMMEDIATE");
  try {
    if (targetKind === "章节") {
      const chapterRecord = one("SELECT * FROM chapters WHERE id = ?", [
        targetId,
      ]);
      if (!chapterRecord)
        throw new Error("Chapter target is no longer available");
      createContentCheckpoint(
        String(chapterRecord.project_id),
        "chapter",
        targetId,
        String(chapterRecord.title),
        String(chapterRecord.content),
        Number(chapterRecord.version),
      );
      db!
        .prepare(
          "UPDATE chapters SET content = ?, summary = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(content, content.slice(0, 240), timestamp(), targetId);
    } else {
      const script = one(
        "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
        [targetId, "scripts"],
      );
      if (!script) throw new Error("Script target is no longer available");
      const scriptPayload = domainPayload(script.payload_json);
      createContentCheckpoint(
        String(script.project_id),
        "script",
        targetId,
        String(script.title),
        stringPayload(scriptPayload, "剧本内容"),
        Number(script.version),
      );
      scriptPayload["剧本内容"] = content;
      updateDomainEntityPayload(targetId, String(script.title), scriptPayload);
    }
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const result = {
    targetKind: targetKind === "章节" ? "chapter" : "script",
    targetId,
    restoredFromId: id,
  };
  emit("content-version.restored", result);
  json(res, 200, result);
}

async function runTemplate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const template = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "templates"],
  );
  if (!template)
    return respondError(res, 404, "NOT_FOUND", "Template not found", requestId);
  const input = await body(req);
  const projectId =
    text(input.projectId) ??
    (template.project_id ? String(template.project_id) : undefined);
  if (
    projectId &&
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const templatePayload = domainPayload(template.payload_json);
  const source = stringPayload(templatePayload, "模板正文");
  if (!source)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Template body is required",
      requestId,
    );
  const values =
    input.variables &&
    typeof input.variables === "object" &&
    !Array.isArray(input.variables)
      ? Object.fromEntries(
          Object.entries(input.variables as Record<string, unknown>)
            .filter(([, value]) =>
              ["string", "number", "boolean"].includes(typeof value),
            )
            .map(([key, value]) => [key.trim(), String(value)]),
        )
      : {};
  const variables = [
    ...new Set(
      [...source.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1].trim())
        .filter(Boolean),
    ),
  ];
  const missing = variables.filter((name) => !values[name]?.trim());
  const rendered = source.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (_match, name: string) => values[name.trim()] ?? "",
  );
  const runId = insertDomainEntity(
    "template-runs",
    projectId,
    id,
    `模板运行：${String(template.title)}`,
    {
      模板名称: String(template.title),
      变量: values,
      缺少变量: missing,
      渲染结果: rendered,
      运行时间: timestamp(),
    },
  );
  const run = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [runId])!,
  );
  emit("template.run", run);
  json(res, 201, { run, rendered, variables, missing });
}

function productionGraph(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  const sourceProject = one(
    "SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL",
    [projectId],
  );
  if (!sourceProject)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const chapters = rows(
    "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
    [projectId],
  );
  const entities = rows(
    "SELECT * FROM domain_entities WHERE project_id = ? ORDER BY created_at",
    [projectId],
  );
  const includedDomains = new Set([
    "adaptations",
    "episodes",
    "scripts",
    "scenes",
    "shots",
    "shot-stills",
    "visual-assets",
    "assets",
    "image",
    "audio",
    "video",
    "animatics",
    "renders",
    "quality",
    "compliance",
    "localization",
    "review",
    "delivery",
  ]);
  const relevant = entities.filter((entity) =>
    includedDomains.has(String(entity.domain)),
  );
  const nodes = [
    {
      id: projectId,
      kind: "project",
      title: String(sourceProject.title),
      status: "项目",
    },
    ...chapters.map((chapter) => ({
      id: String(chapter.id),
      kind: "chapter",
      title: String(chapter.title),
      status: "章节",
    })),
    ...relevant.map((entity) => {
      const payload = domainPayload(entity.payload_json);
      return {
        id: String(entity.id),
        kind: String(entity.domain),
        title: String(entity.title),
        status: String(
          payload["采用状态"] ??
            payload["审阅状态"] ??
            payload["渲染状态"] ??
            payload["交付状态"] ??
            "待完善",
        ),
      };
    }),
  ];
  const knownIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ...chapters.map((chapter) => ({
      sourceId: projectId,
      targetId: String(chapter.id),
      relation: "包含",
    })),
    ...relevant.map((entity) => ({
      sourceId:
        entity.parent_id && knownIds.has(String(entity.parent_id))
          ? String(entity.parent_id)
          : projectId,
      targetId: String(entity.id),
      relation: entity.parent_id ? "依赖" : "归属",
    })),
  ];
  const of = (domain: string) =>
    relevant.filter((entity) => entity.domain === domain);
  const stills = of("shot-stills");
  json(res, 200, {
    projectId,
    nodes,
    edges,
    coverage: {
      episodes: of("episodes").length,
      scripts: of("scripts").length,
      scenes: of("scenes").length,
      shots: of("shots").length,
      assets: of("assets").length + of("visual-assets").length,
      stills: stills.length,
      adoptedStills: stills.filter(
        (still) => domainPayload(still.payload_json)["采用状态"] === "已采用",
      ).length,
    },
  });
}

async function previewProductionImpact(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const sourceId = text(input.sourceId);
  if (!projectId || !sourceId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId and sourceId are required",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const all = rows("SELECT * FROM domain_entities WHERE project_id = ?", [
    projectId,
  ]);
  const source = all.find((item) => String(item.id) === sourceId);
  if (!source)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Production source not found",
      requestId,
    );
  const affected = new Map<string, Record<string, unknown>>();
  const pending = [sourceId];
  while (pending.length) {
    const parentId = pending.shift()!;
    for (const candidate of all) {
      if (
        String(candidate.parent_id ?? "") !== parentId ||
        affected.has(String(candidate.id))
      )
        continue;
      affected.set(String(candidate.id), candidate);
      pending.push(String(candidate.id));
    }
  }
  if (
    [
      "assets",
      "visual-assets",
      "shots",
      "shot-stills",
      "video",
      "animatics",
    ].includes(String(source.domain))
  ) {
    for (const candidate of all) {
      if (
        ["review", "delivery", "renders", "quality"].includes(
          String(candidate.domain),
        )
      )
        affected.set(String(candidate.id), candidate);
    }
  }
  const nodes = [...affected.values()].map((entity) => {
    const payload = domainPayload(entity.payload_json);
    return {
      id: String(entity.id),
      kind: String(entity.domain),
      title: String(entity.title),
      status: String(
        payload["采用状态"] ??
          payload["审阅状态"] ??
          payload["交付状态"] ??
          "建议复核",
      ),
    };
  });
  const sourceTitle = String(source.title);
  json(res, 200, {
    sourceId,
    affected: nodes,
    summary: nodes.length
      ? `「${sourceTitle}」变更后，建议复核 ${nodes.length} 个下游制作或交付条目。`
      : `「${sourceTitle}」当前没有记录到直接下游依赖。`,
  });
}

function adoptShotStill(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "shot-stills"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Shot still candidate not found",
      requestId,
    );
  if (!current.parent_id)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Shot still candidate has no parent shot",
      requestId,
    );
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [current.parent_id, "shots"],
  );
  if (!shot)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Parent shot not found",
      requestId,
    );
  db!.exec("BEGIN IMMEDIATE");
  try {
    const siblings = rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND parent_id = ?",
      ["shot-stills", current.parent_id],
    );
    for (const sibling of siblings) {
      const payload = domainPayload(sibling.payload_json);
      payload["采用状态"] =
        String(sibling.id) === String(current.id) ? "已采用" : "未采用";
      updateDomainEntityPayload(
        String(sibling.id),
        String(sibling.title),
        payload,
      );
    }
    const shotPayload = domainPayload(shot.payload_json);
    shotPayload["采用静帧候选"] = id;
    shotPayload["静帧采用说明"] = `已采用「${String(current.title)}」。`;
    const adoptedStill = one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
      [id, "shot-stills"],
    );
    if (!adoptedStill) throw new Error("采用静帧确认失败");
    const assets = assetReferenceIds(shotPayload).map((assetId) =>
      one(
        "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
        [assetId, "visual-assets", shot.project_id],
      ),
    );
    shotPayload["静帧确认指纹"] = stillConfirmationFingerprint(
      shotPayload,
      adoptedStill,
      assets,
    );
    shotPayload["静帧确认时间"] = timestamp();
    updateDomainEntityPayload(String(shot.id), String(shot.title), shotPayload);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("shot-still.adopted", {
    shotId: String(current.parent_id),
    candidate: adopted,
  });
  json(res, 200, adopted);
}

function adoptVisualAsset(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "visual-assets"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Visual asset not found",
      requestId,
    );
  const lockedTitle = applyVisualAssetAdoption(current);
  if (lockedTitle)
    return respondError(
      res,
      409,
      "CONFLICT",
      `「${lockedTitle}」已锁定；请先明确解除锁定或迁移镜头用途。`,
      requestId,
    );
  const adopted = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("visual-asset.adopted", adopted);
  json(res, 200, adopted);
}

function visualAssetCategory(
  payload: Record<string, unknown>,
): AssetCenterCategory {
  const value = String(payload["资产类型"] ?? "").trim();
  if (value.includes("角色") || value.includes("人物")) return "character";
  if (value.includes("场景") || value.includes("环境")) return "scene";
  if (value.includes("音") || value.includes("声")) return "voice";
  return "prop";
}

function visualAssetSubject(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  return String(payload["关联对象"] ?? payload["资产族"] ?? fallback).trim();
}

function visualAssetSiblings(current: Record<string, any>) {
  const payload = domainPayload(current.payload_json);
  const category = visualAssetCategory(payload);
  const subject = visualAssetSubject(payload, String(current.title));
  return rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ?",
    ["visual-assets", current.project_id],
  ).filter((item) => {
    const candidate = domainPayload(item.payload_json);
    return (
      visualAssetCategory(candidate) === category &&
      visualAssetSubject(candidate, String(item.title)) === subject
    );
  });
}

/** Returns the blocking locked version title, otherwise adopts atomically. */
function applyVisualAssetAdoption(
  current: Record<string, any>,
): string | undefined {
  const siblings = visualAssetSiblings(current);
  const locked = siblings.find(
    (item) =>
      String(item.id) !== String(current.id) &&
      domainPayload(item.payload_json)["锁定状态"] === "已锁定",
  );
  if (locked) return String(locked.title);
  db!.exec("BEGIN IMMEDIATE");
  try {
    for (const sibling of siblings) {
      const payload = domainPayload(sibling.payload_json);
      payload["采用状态"] =
        String(sibling.id) === String(current.id) ? "已采用" : "未采用";
      updateDomainEntityPayload(
        String(sibling.id),
        String(sibling.title),
        payload,
      );
    }
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function adoptVideo(res: ServerResponse, id: string, requestId: string): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "video"],
  );
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "未找到视频候选", requestId);
  if (!current.parent_id)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "视频候选没有关联分镜",
      requestId,
    );
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [current.parent_id, "shots"],
  );
  if (!shot)
    return respondError(res, 404, "NOT_FOUND", "关联分镜不存在", requestId);
  db!.exec("BEGIN IMMEDIATE");
  try {
    const siblings = rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND parent_id = ? AND project_id = ?",
      ["video", current.parent_id, current.project_id],
    );
    for (const sibling of siblings) {
      const payload = domainPayload(sibling.payload_json);
      payload["采用状态"] = sibling.id === id ? "已采用" : "未采用";
      updateDomainEntityPayload(
        String(sibling.id),
        String(sibling.title),
        payload,
      );
    }
    const shotPayload = domainPayload(shot.payload_json);
    shotPayload["采用视频候选"] = id;
    shotPayload["视频采用说明"] = `已采用「${String(current.title)}」。`;
    updateDomainEntityPayload(String(shot.id), String(shot.title), shotPayload);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("video.adopted", {
    shotId: String(current.parent_id),
    candidate: adopted,
  });
  json(res, 200, adopted);
}

function lockVisualAsset(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "visual-assets"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Visual asset not found",
      requestId,
    );
  const payload = domainPayload(current.payload_json);
  if (payload["采用状态"] !== "已采用")
    return respondError(
      res,
      409,
      "CONFLICT",
      "只能锁定已采用的资产版本。",
      requestId,
    );
  payload["锁定状态"] = "已锁定";
  payload["锁定时间"] = timestamp();
  updateDomainEntityPayload(id, String(current.title), payload);
  const locked = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("visual-asset.locked", locked);
  json(res, 200, locked);
}

function assetReferenceIds(payload: Record<string, unknown>): string[] {
  const value = payload["资产版本引用"];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function videoAssetIsStale(payload: Record<string, unknown>): boolean {
  return [payload["设定状态"], payload["版本状态"]].some((value) =>
    ["已过期", "过期"].includes(String(value)),
  );
}

function videoAssetHasVerifiedRights(
  payload: Record<string, unknown>,
): boolean {
  const rights = String(
    payload["权利状态"] ?? payload["授权状态"] ?? payload["素材权利"] ?? "",
  );
  return (
    rights.includes("已授权") ||
    rights.includes("已核验") ||
    rights.includes("已确认")
  );
}

function shotVideoDurationSeconds(
  payload: Record<string, unknown>,
): number | undefined {
  const value = payload["时长"] ?? payload["时长秒数"];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const matched = typeof value === "string" ? value.match(/\d+/) : undefined;
  const parsed = matched?.[0] ? Number(matched[0]) : undefined;
  return Number.isInteger(parsed) ? parsed : undefined;
}

function videoAssetSnapshot(asset: Record<string, any> | undefined) {
  if (!asset) return undefined;
  const payload = domainPayload(asset.payload_json);
  return {
    id: String(asset.id),
    version: Number(asset.version),
    adopted: payload["采用状态"] === "已采用",
    locked: payload["锁定状态"] === "已锁定",
    stale: videoAssetIsStale(payload),
    rights: String(payload["权利状态"] ?? payload["授权状态"] ?? ""),
    cost: String(payload["费用状态"] ?? ""),
    provider: String(payload["服务状态"] ?? ""),
  };
}

function stillConfirmationFingerprint(
  shotPayload: Record<string, unknown>,
  still: Record<string, any>,
  assets: Array<Record<string, any> | undefined>,
): string {
  const stillPayload = domainPayload(still.payload_json);
  const content = {
    shotPrompt: String(shotPayload["生成提示"] ?? ""),
    shotDuration: shotPayload["时长"] ?? shotPayload["时长秒数"] ?? null,
    adoptedStill: {
      id: String(still.id),
      version: Number(still.version),
      prompt: String(stillPayload["生成提示"] ?? ""),
      status: String(stillPayload["采用状态"] ?? ""),
      state: String(stillPayload["设定状态"] ?? stillPayload["版本状态"] ?? ""),
    },
    assets: assets
      .map(videoAssetSnapshot)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
}

function videoGenerationReadiness(
  input: Partial<VideoGenerationInput>,
  shot: Record<string, any>,
  provider: Record<string, any>,
): VideoGenerationPreflight {
  const shotPayload = domainPayload(shot.payload_json);
  const providerPayload = domainPayload(provider.payload_json);
  const providerId = String(provider.id);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const assetIds = [...new Set(assetReferenceIds(shotPayload))];
  const assets = assetIds.map((id) =>
    one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
      [id, "visual-assets", shot.project_id],
    ),
  );
  const stillId = text(shotPayload["采用静帧候选"]);
  const still = stillId
    ? one("SELECT * FROM domain_entities WHERE id = ? AND domain = ?", [
        stillId,
        "shot-stills",
      ])
    : undefined;
  if (!still) blockers.push("请先采用一个静帧候选，再进入视频生成。");
  else {
    const stillPayload = domainPayload(still.payload_json);
    if (String(still.parent_id) !== String(shot.id))
      blockers.push("已采用静帧不属于当前分镜，请重新采用。");
    if (stillPayload["采用状态"] !== "已采用")
      blockers.push("已采用静帧候选已失效，请重新采用。");
    if (videoAssetIsStale(stillPayload))
      blockers.push("已采用静帧已过期，请重新生成并采用。");
  }
  if (!assetIds.length)
    blockers.push("请先在资产中心为分镜分配并锁定至少一个资产版本。");
  const lockedAssetIds: string[] = [];
  for (const [index, asset] of assets.entries()) {
    const id = assetIds[index]!;
    if (!asset) {
      blockers.push(`资产版本 ${id} 已不存在或不属于当前项目。`);
      continue;
    }
    const payload = domainPayload(asset.payload_json);
    if (payload["采用状态"] !== "已采用")
      blockers.push(`资产「${String(asset.title)}」尚未采用。`);
    if (payload["锁定状态"] !== "已锁定")
      blockers.push(`资产「${String(asset.title)}」尚未锁定。`);
    if (videoAssetIsStale(payload))
      blockers.push(`资产「${String(asset.title)}」已过期。`);
    if (!videoAssetHasVerifiedRights(payload))
      blockers.push(`资产「${String(asset.title)}」缺少已核验的权利状态。`);
    if (String(payload["费用状态"] ?? "").includes("未知"))
      blockers.push(`资产「${String(asset.title)}」的费用仍未知。`);
    if (
      String(payload["服务状态"] ?? "").includes("不可用") ||
      String(payload["服务状态"] ?? "").includes("离线")
    )
      blockers.push(`资产「${String(asset.title)}」的服务当前不可用。`);
    if (
      payload["采用状态"] === "已采用" &&
      payload["锁定状态"] === "已锁定" &&
      !videoAssetIsStale(payload) &&
      videoAssetHasVerifiedRights(payload)
    )
      lockedAssetIds.push(id);
  }
  const confirmationFingerprint = still
    ? stillConfirmationFingerprint(shotPayload, still, assets)
    : undefined;
  if (
    !confirmationFingerprint ||
    text(shotPayload["静帧确认指纹"]) !== confirmationFingerprint
  )
    blockers.push(
      "镜头提示、时长、采用静帧或资产锁已变化，请重新采用静帧确认视觉方向。",
    );

  const baseUrl = text(providerPayload["服务地址"]);
  const credentialRef = text(providerPayload["凭据引用"]);
  const model = text(providerPayload["模型名称"]);
  if (!baseUrl || !credentialRef || !model)
    blockers.push("视频服务商需要服务地址、模型和凭据引用。");
  const seconds = input.seconds ?? 5;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
    blockers.push("视频时长须为 1 至 60 秒的整数。");
  const confirmedPrompt = text(shotPayload["生成提示"]);
  const confirmedSeconds = shotVideoDurationSeconds(shotPayload);
  if (!confirmedPrompt || !confirmedSeconds)
    blockers.push("请先在分镜中保存视频提示和时长，再采用静帧确认视觉方向。");
  else if (
    text(input.prompt) !== confirmedPrompt ||
    seconds !== confirmedSeconds
  )
    blockers.push(
      "视频提示或时长已偏离静帧确认基线，请更新分镜后重新采用静帧。",
    );
  const configuredCost = Number(providerPayload["预估费用"]);
  const costKnown = Number.isFinite(configuredCost) && configuredCost >= 0;
  if (!costKnown && input.confirmUnknownCost !== true)
    blockers.push("视频费用未知；请明确确认后才可提交。");
  if (!costKnown && input.confirmUnknownCost === true)
    warnings.push("费用未知已由用户确认；请在生成账本中复核实际费用。");
  const capacity = Number(providerPayload["并发上限"]);
  if (Number.isInteger(capacity) && capacity > 0) {
    const active = Number(
      one(
        "SELECT count(*) AS count FROM video_generation_jobs WHERE provider_id = ? AND status IN ('queued', 'running')",
        [provider.id],
      )?.count ?? 0,
    );
    if (active >= capacity)
      blockers.push(
        `视频服务商并发上限为 ${capacity}，当前已有 ${active} 个待处理任务。`,
      );
  }
  const snapshotHash = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        confirmationFingerprint: confirmationFingerprint ?? null,
        provider: {
          id: providerId,
          version: Number(provider.version),
          model: model ?? null,
          baseUrl: baseUrl ?? null,
          cost: costKnown ? configuredCost : null,
        },
        request: {
          prompt: text(input.prompt) ?? "",
          negativePrompt: text(input.negativePrompt) ?? "",
          seconds,
          size: text(input.size) ?? "",
        },
      }),
    )
    .digest("hex")}`;
  return {
    shotId: String(shot.id),
    providerId,
    snapshotHash,
    ready: blockers.length === 0,
    ...(stillId ? { adoptedStillId: stillId } : {}),
    lockedAssetIds,
    blockers,
    warnings,
    costStatus: costKnown ? "known" : "unknown",
    ...(costKnown ? { estimatedCost: configuredCost } : {}),
    ...(costKnown
      ? { currency: text(providerPayload["计费货币"]) ?? "USD" }
      : {}),
  };
}

function assetCenterUsages(
  projectId: string | undefined,
  assetId: string,
): AssetCenterUsage[] {
  if (!projectId) return [];
  return rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
    ["shots", projectId],
  ).flatMap((shot) => {
    if (!assetReferenceIds(domainPayload(shot.payload_json)).includes(assetId))
      return [];
    const scene = shot.parent_id
      ? one("SELECT title FROM domain_entities WHERE id = ?", [shot.parent_id])
      : undefined;
    return [
      {
        shotId: String(shot.id),
        shotTitle: String(shot.title),
        ...(scene ? { sceneTitle: String(scene.title) } : {}),
      },
    ];
  });
}

function assetCenterForProject(projectId: string): AssetCenter {
  const candidates = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
    ["visual-assets", projectId],
  );
  return {
    projectId,
    assets: candidates.map((candidate) => {
      const payload = domainPayload(candidate.payload_json);
      const category = visualAssetCategory(payload);
      const file = payload.file as Record<string, unknown> | undefined;
      const fileName =
        file && typeof file.name === "string" ? file.name : undefined;
      const hasFile = Boolean(file && typeof file === "object");
      const mediaKind = category === "voice" ? "audio" : "image";
      const preview = hasFile
        ? {
            kind: mediaKind as "image" | "audio",
            status: (hasArchivedFile(candidate) ? "available" : "missing") as
              "available" | "missing",
            ...(fileName ? { label: fileName } : {}),
          }
        : {
            kind: "none" as const,
            status: "unattached" as const,
            ...(typeof payload["视觉说明"] === "string"
              ? { label: String(payload["视觉说明"]) }
              : {}),
          };
      const rights = String(payload["权利状态"] ?? "");
      const provider = String(payload["服务状态"] ?? "");
      return {
        id: String(candidate.id),
        title: String(candidate.title),
        category,
        subject: visualAssetSubject(payload, String(candidate.title)),
        assetVersion: String(payload["资产版本"] ?? `v${candidate.version}`),
        adopted: payload["采用状态"] === "已采用",
        lockStatus:
          payload["锁定状态"] === "已锁定"
            ? ("locked" as const)
            : ("unlocked" as const),
        stale:
          payload["设定状态"] === "已过期" || payload["版本状态"] === "已过期",
        preview,
        rightsStatus:
          rights.includes("已授权") || rights.includes("已核验")
            ? ("verified" as const)
            : rights.includes("受限") ||
                rights.includes("不足") ||
                rights.includes("未授权")
              ? ("restricted" as const)
              : ("unknown" as const),
        costStatus: String(payload["费用状态"] ?? "").includes("未知")
          ? ("unknown" as const)
          : ("known" as const),
        providerStatus:
          provider.includes("不可用") || provider.includes("离线")
            ? ("unavailable" as const)
            : provider
              ? ("available" as const)
              : ("not-required" as const),
        usages: assetCenterUsages(projectId, String(candidate.id)),
        version: Number(candidate.version),
      };
    }),
  };
}

function getAssetCenter(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(res, 200, assetCenterForProject(projectId));
}

function assetCenterPreview(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "visual-assets"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Asset version not found",
      requestId,
    );
  const file = domainPayload(current.payload_json).file;
  const storedName =
    file && typeof file === "object"
      ? safeStoredAssetName((file as Record<string, unknown>).storedName)
      : undefined;
  if (!storedName)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Asset has no local preview file",
      requestId,
    );
  const path = join(command!.assetDirectory, storedName);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Asset preview file is missing",
      requestId,
    );
  }
  if (size > 5 * 1024 * 1024)
    return respondError(
      res,
      413,
      "VALIDATION_ERROR",
      "Preview file exceeds the local 5 MB safety limit",
      requestId,
    );
  const extension = extname(storedName).toLowerCase();
  const mime = (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
    } as Record<string, string>
  )[extension];
  if (!mime)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Only image and audio assets can be previewed",
      requestId,
    );
  const kind = mime.startsWith("audio/") ? "audio" : "image";
  const dataUrl = `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  json(res, 200, { id, kind, dataUrl });
}

async function assetCenterAction(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "visual-assets"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Asset version not found",
      requestId,
    );
  const input = await body(req);
  if (input.version !== current.version)
    return respondError(
      res,
      409,
      "CONFLICT",
      "资产版本已被其他操作更新，请刷新后重试。",
      requestId,
      { current: domainEntity(current) },
    );
  const action = text(input.action);
  const projectId = String(current.project_id);
  const payload = domainPayload(current.payload_json);
  if (action === "adopt") {
    const lockedTitle = applyVisualAssetAdoption(current);
    if (lockedTitle)
      return respondError(
        res,
        409,
        "CONFLICT",
        `「${lockedTitle}」已锁定；请先解除锁定或迁移镜头用途。`,
        requestId,
      );
  } else if (action === "lock") {
    if (payload["采用状态"] !== "已采用")
      return respondError(
        res,
        409,
        "CONFLICT",
        "只能锁定已采用的资产版本。",
        requestId,
      );
    payload["锁定状态"] = "已锁定";
    payload["锁定时间"] = timestamp();
    updateDomainEntityPayload(id, String(current.title), payload);
  } else if (action === "unlock") {
    payload["锁定状态"] = "未锁定";
    delete payload["锁定时间"];
    updateDomainEntityPayload(id, String(current.title), payload);
  } else if (action === "assign-shot" || action === "remove-shot") {
    const shotId = text(input.shotId);
    const shot = shotId
      ? one(
          "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
          [shotId, "shots", projectId],
        )
      : undefined;
    if (!shot)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "请选择当前项目的镜头。",
        requestId,
      );
    if (action === "assign-shot") {
      if (payload["采用状态"] !== "已采用" || payload["锁定状态"] !== "已锁定")
        return respondError(
          res,
          409,
          "CONFLICT",
          "请先采用并锁定资产版本，再分配给镜头。",
          requestId,
        );
      if (payload["设定状态"] === "已过期" || payload["版本状态"] === "已过期")
        return respondError(
          res,
          409,
          "CONFLICT",
          "过期资产不能分配给镜头。",
          requestId,
        );
    }
    const shotPayload = domainPayload(shot.payload_json);
    const references = new Set(assetReferenceIds(shotPayload));
    if (action === "assign-shot") references.add(id);
    else references.delete(id);
    shotPayload["资产版本引用"] = [...references];
    updateDomainEntityPayload(String(shot.id), String(shot.title), shotPayload);
  } else {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Unsupported asset center action",
      requestId,
    );
  }
  emit("asset-center.updated", { assetId: id, action });
  json(res, 200, assetCenterForProject(projectId));
}

type EpisodeMediaContext = {
  projectId: string;
  episode: Record<string, any>;
  shots: Array<Record<string, any>>;
  sourceFingerprint: string;
};

function episodeMediaContext(
  episodeId: string,
): EpisodeMediaContext | undefined {
  const episode = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [episodeId, "episodes"],
  );
  if (!episode?.project_id) return undefined;
  const production = episodeWorkflowContext(
    String(episode.project_id),
    episodeId,
    episode,
  );
  const sourceFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        episode: [episode.id, episode.version, episode.updated_at],
        scripts: production.scripts.map((item) => [
          item.id,
          item.version,
          item.updated_at,
        ]),
        shots: production.shots.map((item) => [
          item.id,
          item.version,
          item.updated_at,
          item.title,
          item.payload_json,
        ]),
      }),
    )
    .digest("hex");
  return {
    projectId: String(episode.project_id),
    episode,
    shots: production.shots,
    sourceFingerprint,
  };
}

function audioClipSourceFingerprint(
  context: EpisodeMediaContext,
  clip: { shotId?: string; text?: string; voiceProfileId?: string },
): string {
  const shot = clip.shotId
    ? context.shots.find((item) => String(item.id) === clip.shotId)
    : undefined;
  return createHash("sha256")
    .update(
      JSON.stringify({
        episode: [context.episode.id, context.episode.version],
        shot: shot
          ? [shot.id, shot.version, shot.updated_at, shot.payload_json]
          : undefined,
        text: clip.text ?? "",
        voiceProfileId: clip.voiceProfileId,
      }),
    )
    .digest("hex");
}

function audioTrackIsStale(
  row: Record<string, any>,
  context: EpisodeMediaContext,
): boolean {
  const clips = parseAudioTrackClips(row.clips_json);
  if (!clips.length) return true;
  return clips.some((clip) =>
    clip.sourceFingerprint
      ? clip.sourceFingerprint !== audioClipSourceFingerprint(context, clip)
      : String(row.source_fingerprint) !== context.sourceFingerprint,
  );
}

function listVoiceProfiles(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM voice_profiles WHERE project_id = ? ORDER BY updated_at DESC",
      [projectId],
    ).map(voiceProfile),
  );
}

async function createVoiceProfile(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<VoiceProfileInput>;
  const projectId = text(input.projectId);
  const title = text(input.title);
  if (!projectId || !title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请填写项目和音色名称",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  const characterId = text(input.characterId);
  if (
    characterId &&
    !one(
      "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
      [characterId, "characters", projectId],
    )
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "关联角色不属于当前项目",
      requestId,
    );
  const sampleAssetId = text(input.sampleAssetId);
  if (
    sampleAssetId &&
    !one(
      "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
      [sampleAssetId, "assets", projectId],
    )
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "声音样本不属于当前项目的素材台账",
      requestId,
    );
  const now = timestamp();
  const id = randomUUID();
  db!
    .prepare(
      "INSERT INTO voice_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .run(
      id,
      projectId,
      title,
      characterId ?? null,
      sampleAssetId ?? null,
      text(input.providerVoice) ?? null,
      text(input.description) ?? null,
      "draft",
      now,
      now,
    );
  const created = voiceProfile(
    one("SELECT * FROM voice_profiles WHERE id = ?", [id])!,
  );
  emit("voice-profile.created", created);
  json(res, 201, created);
}

function adoptVoiceProfile(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM voice_profiles WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "未找到音色档案", requestId);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE voice_profiles SET status = ?, version = version + 1, updated_at = ? WHERE project_id = ? AND character_id IS ?",
      )
      .run(
        "draft",
        timestamp(),
        current.project_id,
        current.character_id ?? null,
      );
    db!
      .prepare(
        "UPDATE voice_profiles SET status = ?, version = version + 1, updated_at = ? WHERE id = ?",
      )
      .run("adopted", timestamp(), id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = voiceProfile(
    one("SELECT * FROM voice_profiles WHERE id = ?", [id])!,
  );
  emit("voice-profile.adopted", adopted);
  json(res, 200, adopted);
}

function listAudioTracks(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeMediaContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "未找到分集", requestId);
  const tracks = rows(
    "SELECT * FROM audio_tracks WHERE episode_id = ? ORDER BY created_at DESC",
    [episodeId],
  ).map((row) => audioTrack(row, context));
  json(res, 200, tracks);
}

async function createAudioTrack(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<AudioTrackInput>;
  const projectId = text(input.projectId);
  const episodeId = text(input.episodeId);
  const label = text(input.label);
  const kind = text(input.kind) as AudioTrackKind | undefined;
  if (
    !projectId ||
    !episodeId ||
    !label ||
    !kind ||
    !["dialogue", "narration", "bgm", "sfx"].includes(kind)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "音轨项目、分集、类别和名称均为必填项",
      requestId,
    );
  const context = episodeMediaContext(episodeId);
  if (!context || context.projectId !== projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "分集不属于当前项目",
      requestId,
    );
  const clips = parseAudioTrackClips(input.clips);
  if (!clips.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "音轨至少需要一个有效片段",
      requestId,
    );
  const shotIds = new Set(context.shots.map((shot) => String(shot.id)));
  for (const clip of clips) {
    if (clip.shotId && !shotIds.has(clip.shotId))
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "音轨片段引用了其他分集的分镜",
        requestId,
      );
    if (
      clip.assetId &&
      !one(
        "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
        [clip.assetId, "assets", projectId],
      )
    )
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "音轨片段引用的素材不属于当前项目",
        requestId,
      );
    if (
      clip.voiceProfileId &&
      !one("SELECT id FROM voice_profiles WHERE id = ? AND project_id = ?", [
        clip.voiceProfileId,
        projectId,
      ])
    )
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "音轨片段引用的音色不属于当前项目",
        requestId,
      );
  }
  const storedClips = clips.map((clip) => ({
    ...clip,
    sourceFingerprint: audioClipSourceFingerprint(context, clip),
  }));
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare(
      "INSERT INTO audio_tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)",
    )
    .run(
      id,
      projectId,
      episodeId,
      kind,
      label,
      context.sourceFingerprint,
      JSON.stringify(storedClips),
      "draft",
      now,
      now,
    );
  const created = audioTrack(
    one("SELECT * FROM audio_tracks WHERE id = ?", [id])!,
    context,
  );
  emit("audio-track.created", created);
  json(res, 201, created);
}

function adoptAudioTrack(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM audio_tracks WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "未找到音轨", requestId);
  const context = episodeMediaContext(String(current.episode_id));
  if (!context || audioTrackIsStale(current, context))
    return respondError(
      res,
      409,
      "CONFLICT",
      "镜头或剧本已更新，不能采用过期音轨；请基于当前分集另存版本",
      requestId,
    );
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE audio_tracks SET status = ?, version = version + 1, updated_at = ? WHERE episode_id = ? AND kind = ?",
      )
      .run("draft", timestamp(), current.episode_id, current.kind);
    db!
      .prepare(
        "UPDATE audio_tracks SET status = ?, stale_reason = NULL, version = version + 1, updated_at = ? WHERE id = ?",
      )
      .run("adopted", timestamp(), id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = audioTrack(
    one("SELECT * FROM audio_tracks WHERE id = ?", [id])!,
    context,
  );
  emit("audio-track.adopted", adopted);
  json(res, 200, adopted);
}

function initializeAnimatic(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeMediaContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "未找到分集", requestId);
  let cursor = 0;
  const clips = context.shots.map((shot) => {
    const durationSeconds = shotDuration(shot);
    const source = visualSourceForShot(context.projectId, String(shot.id));
    const clip = {
      shotId: String(shot.id),
      title: String(shot.title),
      startSeconds: cursor,
      durationSeconds,
      ...(source?.id ? { mediaAssetId: source.id } : {}),
      mediaKind: source?.kind ?? "missing",
    } as const;
    cursor += durationSeconds;
    return clip;
  });
  json(res, 200, {
    projectId: context.projectId,
    episodeId,
    sourceFingerprint: context.sourceFingerprint,
    clips,
  });
}

function listAnimaticDrafts(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeMediaContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "未找到分集", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM animatic_drafts WHERE episode_id = ? ORDER BY created_at DESC",
      [episodeId],
    ).map(animaticDraft),
  );
}

async function createAnimaticDraft(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<AnimaticDraftInput>;
  const projectId = text(input.projectId);
  const episodeId = text(input.episodeId);
  const sourceFingerprint = text(input.sourceFingerprint);
  const clips = parseAnimaticClips(input.clips);
  if (!projectId || !episodeId || !sourceFingerprint || !clips.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "动态分镜需要项目、分集、当前输入指纹和至少一个镜头片段",
      requestId,
    );
  const context = episodeMediaContext(episodeId);
  if (!context || context.projectId !== projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "分集不属于当前项目",
      requestId,
    );
  if (sourceFingerprint !== context.sourceFingerprint)
    return respondError(
      res,
      409,
      "CONFLICT",
      "镜头或剧本已更新，请重新初始化动态分镜后另存版本",
      requestId,
    );
  const knownShotIds = new Set(context.shots.map((shot) => String(shot.id)));
  if (clips.some((clip) => !knownShotIds.has(clip.shotId)))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "动态分镜包含不属于当前分集的镜头",
      requestId,
    );
  for (const clip of clips) {
    if (!clip.mediaAssetId) continue;
    const asset = one(
      "SELECT * FROM domain_entities WHERE id = ? AND project_id = ?",
      [clip.mediaAssetId, projectId],
    );
    if (
      !asset ||
      !["video", "shot-stills", "visual-assets", "assets"].includes(
        String(asset.domain),
      )
    )
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "动态分镜引用了无效的项目媒体素材",
        requestId,
      );
  }
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare(
      "INSERT INTO animatic_drafts VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)",
    )
    .run(
      id,
      projectId,
      episodeId,
      sourceFingerprint,
      JSON.stringify(clips),
      text(input.annotations) ?? "",
      "draft",
      now,
      now,
    );
  const created = animaticDraft(
    one("SELECT * FROM animatic_drafts WHERE id = ?", [id])!,
  );
  emit("animatic.created", created);
  json(res, 201, created);
}

async function reviewAnimaticDraft(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<AnimaticReviewInput>;
  const status = input.status;
  const current = one("SELECT * FROM animatic_drafts WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "未找到动态分镜版本", requestId);
  if (status !== "approved" && status !== "returned")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "审核结论无效",
      requestId,
    );
  if (input.version !== Number(current.version))
    return respondError(
      res,
      409,
      "CONFLICT",
      "动态分镜已在其他窗口更新，请刷新后重试",
      requestId,
    );
  if (current.status !== "draft")
    return respondError(
      res,
      409,
      "CONFLICT",
      "该动态分镜已有审核结论，请另存新版本后再提交审核",
      requestId,
    );
  const context = episodeMediaContext(String(current.episode_id));
  if (!context || context.sourceFingerprint !== current.source_fingerprint)
    return respondError(
      res,
      409,
      "CONFLICT",
      "镜头或剧本已更新，不能审核过期动态分镜",
      requestId,
    );
  db!
    .prepare(
      "UPDATE animatic_drafts SET status = ?, review_note = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(status, text(input.reviewNote) ?? null, timestamp(), id);
  const reviewed = animaticDraft(
    one("SELECT * FROM animatic_drafts WHERE id = ?", [id])!,
  );
  emit("animatic.reviewed", reviewed);
  json(res, 200, reviewed);
}

function getEpisodeRenderPreflight(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeMediaContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "未找到分集", requestId);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const animatic = one(
    "SELECT * FROM animatic_drafts WHERE episode_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 1",
    [episodeId, "approved"],
  );
  if (!animatic) blockers.push("请先通过一版动态分镜，再创建最终成片。");
  else if (animatic.source_fingerprint !== context.sourceFingerprint)
    blockers.push("已通过的动态分镜已过期；镜头或剧本有更新，请重新审核。");
  const audioRows = rows(
    "SELECT * FROM audio_tracks WHERE episode_id = ? AND status = ? ORDER BY updated_at DESC",
    [episodeId, "adopted"],
  );
  const freshAudioRows = audioRows.filter(
    (row) => !audioTrackIsStale(row, context),
  );
  if (!freshAudioRows.length)
    blockers.push("至少需要一条与当前镜头版本一致的已采用音轨。");
  const clips = animatic ? parseAnimaticClips(animatic.clips_json) : [];
  let durationSeconds = 0;
  for (const clip of clips) {
    durationSeconds = Math.max(
      durationSeconds,
      clip.startSeconds + clip.durationSeconds,
    );
    if (clip.mediaKind === "missing" || !clip.mediaAssetId) {
      blockers.push(`镜头「${clip.title}」没有已采用的视频或静帧媒体。`);
      continue;
    }
    const asset = one("SELECT * FROM domain_entities WHERE id = ?", [
      clip.mediaAssetId,
    ]);
    if (!asset || !hasArchivedFile(asset))
      blockers.push(`镜头「${clip.title}」的媒体尚未归档为本地文件。`);
  }
  for (const row of freshAudioRows) {
    const clips = parseAudioTrackClips(row.clips_json);
    if (!clips.some((clip) => clip.assetId))
      blockers.push(`音轨「${String(row.label)}」没有绑定已归档音频素材。`);
    for (const clip of clips) {
      if (!clip.assetId) continue;
      const asset = one(
        "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
        [clip.assetId, "assets", context.projectId],
      );
      if (!asset || !hasArchivedFile(asset))
        blockers.push(`音轨「${String(row.label)}」引用的音频素材不可用。`);
    }
  }
  if (!clips.length) warnings.push("当前分集尚无可用于渲染的动态分镜片段。");
  warnings.push(
    "该预检只验证素材、音轨、动态分镜和版本谱系；最终 MP4 须由已配置的远端渲染 API 生成。",
  );
  json(res, 200, {
    projectId: context.projectId,
    episodeId,
    sourceFingerprint: context.sourceFingerprint,
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ...(animatic ? { animaticId: String(animatic.id) } : {}),
    audioTrackIds: freshAudioRows.map((row) => String(row.id)),
    durationSeconds,
  });
}

function visualSourceForShot(
  projectId: string,
  shotId: string,
): { id: string; kind: "video" | "still" } | undefined {
  const candidates = rows(
    "SELECT * FROM domain_entities WHERE project_id = ? AND parent_id = ? AND domain IN ('video', 'shot-stills', 'visual-assets') ORDER BY updated_at DESC",
    [projectId, shotId],
  );
  const adopted = candidates.find((item) => {
    const payload = domainPayload(item.payload_json);
    return payload["采用状态"] === "已采用";
  });
  const selected = adopted ?? candidates[0];
  if (!selected) return undefined;
  return {
    id: String(selected.id),
    kind: selected.domain === "video" ? "video" : "still",
  };
}

function safeStoredAssetName(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  return value;
}

function hasArchivedFile(entity: Record<string, unknown>): boolean {
  const file = domainPayload(entity.payload_json).file;
  if (!file || typeof file !== "object") return false;
  const storedName = safeStoredAssetName(
    (file as Record<string, unknown>).storedName,
  );
  if (!storedName) return false;
  try {
    return statSync(join(command!.assetDirectory, storedName)).isFile();
  } catch {
    return false;
  }
}

function shotDuration(shot: Record<string, unknown>): number {
  const payload = domainPayload(shot.payload_json);
  const raw = payload["时长（秒）"] ?? payload["时长"] ?? payload["建议时长"];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 120 ? value : 3;
}

function parseAudioTrackClips(value: unknown): Array<{
  id: string;
  shotId?: string;
  assetId?: string;
  voiceProfileId?: string;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
  sourceFingerprint?: string;
}> {
  if (!Array.isArray(value)) {
    try {
      value = typeof value === "string" ? JSON.parse(value) : [];
    } catch {
      value = [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const startSeconds = Number(record.startSeconds);
    const durationSeconds = Number(record.durationSeconds);
    if (
      !Number.isFinite(startSeconds) ||
      startSeconds < 0 ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > 3600
    )
      return [];
    return [
      {
        id: text(record.id) ?? randomUUID(),
        ...(text(record.shotId) ? { shotId: text(record.shotId) } : {}),
        ...(text(record.assetId) ? { assetId: text(record.assetId) } : {}),
        ...(text(record.voiceProfileId)
          ? { voiceProfileId: text(record.voiceProfileId) }
          : {}),
        startSeconds,
        durationSeconds,
        ...(text(record.text) ? { text: text(record.text) } : {}),
        ...(text(record.sourceFingerprint)
          ? { sourceFingerprint: text(record.sourceFingerprint) }
          : {}),
      },
    ];
  });
}

function parseAnimaticClips(value: unknown): Array<{
  shotId: string;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  mediaAssetId?: string;
  mediaKind: "video" | "still" | "missing";
}> {
  if (!Array.isArray(value)) {
    try {
      value = typeof value === "string" ? JSON.parse(value) : [];
    } catch {
      value = [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const shotId = text(record.shotId);
    const title = text(record.title);
    const startSeconds = Number(record.startSeconds);
    const durationSeconds = Number(record.durationSeconds);
    const mediaKind = record.mediaKind;
    if (
      !shotId ||
      !title ||
      !Number.isFinite(startSeconds) ||
      startSeconds < 0 ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !["video", "still", "missing"].includes(String(mediaKind))
    )
      return [];
    return [
      {
        shotId,
        title,
        startSeconds,
        durationSeconds,
        ...(text(record.mediaAssetId)
          ? { mediaAssetId: text(record.mediaAssetId) }
          : {}),
        mediaKind: mediaKind as "video" | "still" | "missing",
      },
    ];
  });
}

function adoptLocalizationVariant(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "localization"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Localization version not found",
      requestId,
    );
  if (!current.parent_id)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Localization version must belong to an episode",
      requestId,
    );
  const currentPayload = domainPayload(current.payload_json);
  if (!stringPayload(currentPayload, "字幕与译文").trim())
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Localization subtitles or translation are required before adoption",
      requestId,
    );
  const siblings = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ?",
    ["localization", current.project_id, current.parent_id],
  );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    for (const sibling of siblings) {
      const payload = domainPayload(sibling.payload_json);
      if (sibling.id === id) {
        payload["采用状态"] = "已采用";
        payload["审阅时间"] = now;
      } else if (payload["采用状态"] === "已采用") {
        payload["采用状态"] = "已归档";
      }
      db!
        .prepare(
          "UPDATE domain_entities SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(JSON.stringify(payload), now, sibling.id);
    }
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("localization.adopted", adopted);
  json(res, 200, adopted);
}

function subtitleTimestamp(seconds: number, separator: "," | "."): string {
  const milliseconds = Math.max(0, Math.floor(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function exportLocalizationSubtitles(
  res: ServerResponse,
  id: string,
  format: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "localization"],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Localization version not found",
      requestId,
    );
  const payload = domainPayload(current.payload_json);
  const raw = stringPayload(payload, "字幕与译文").trim();
  if (!raw)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Localization subtitles or translation are required for export",
      requestId,
    );
  if (format !== "srt" && format !== "vtt")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Unsupported subtitle format",
      requestId,
    );
  const lines = raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2_000);
  const separator = format === "srt" ? "," : ".";
  const cues = lines.map((line, index) => {
    const start = subtitleTimestamp(index * 3, separator);
    const end = subtitleTimestamp(index * 3 + 2.8, separator);
    return format === "srt"
      ? `${index + 1}\n${start} --> ${end}\n${line}`
      : `${start} --> ${end}\n${line}`;
  });
  const fileBase =
    safeFileName(String(current.title)).replace(/\.\w+$/, "") || "字幕";
  json(res, 200, {
    fileName: `${fileBase}.${format}`,
    mimeType: format === "srt" ? "application/x-subrip" : "text/vtt",
    content: `${format === "vtt" ? "WEBVTT\n\n" : ""}${cues.join("\n\n")}\n`,
  });
}

function exportDeliveryManifest(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const delivery = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "delivery"],
  );
  if (!delivery)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Delivery record not found",
      requestId,
    );
  if (!delivery.parent_id)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Delivery record must belong to an episode",
      requestId,
    );
  const episode = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [delivery.parent_id, "episodes", delivery.project_id],
  );
  if (!episode)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const payload = domainPayload(delivery.payload_json);
  const children = rows(
    "SELECT * FROM domain_entities WHERE project_id = ? AND parent_id = ? ORDER BY domain, updated_at DESC",
    [delivery.project_id, delivery.parent_id],
  );
  const findDomain = (domain: string) =>
    children.filter((item) => String(item.domain) === domain).map(domainEntity);
  const adoptedLocalization = findDomain("localization").filter(
    (item) => domainPayload(item.payload)["采用状态"] === "已采用",
  );
  const quality = findDomain("quality");
  const compliance = findDomain("compliance");
  const review = findDomain("review");
  const blockers: string[] = [];
  if (!quality.length) blockers.push("尚未保存质量检查结果");
  if (!compliance.length) blockers.push("尚未保存合规检查结果");
  if (!review.length) blockers.push("尚未保存审片记录");
  if (!adoptedLocalization.length) blockers.push("尚未采用本地化版本");
  const manifest = {
    schemaVersion: "dramaip.delivery-manifest.v1",
    exportedAt: timestamp(),
    status: blockers.length ? "需人工复核" : "可提交前复核",
    delivery: {
      id: String(delivery.id),
      title: String(delivery.title),
      targetPlatform: stringPayload(payload, "目标平台"),
      notes: stringPayload(payload, "交付说明"),
    },
    projectId: String(delivery.project_id),
    episode: { id: String(episode.id), title: String(episode.title) },
    included: {
      qualityReports: quality.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      complianceReports: compliance.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      reviewPackages: review.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      adoptedLocalization: adoptedLocalization.map((item) => ({
        id: item.id,
        title: item.title,
      })),
    },
    blockers,
  };
  const safeTitle =
    safeFileName(String(delivery.title)).replace(/\.\w+$/, "") || "交付清单";
  json(res, 200, {
    fileName: `${safeTitle}-交付清单.json`,
    mimeType: "application/json",
    content: JSON.stringify(manifest, null, 2),
  });
}

function analysisScore(value: number, threshold: number): number {
  return Math.max(1, Math.min(10, Math.round(value / threshold)));
}

function runChapterAnalysis(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const chapterRow = one("SELECT * FROM chapters WHERE id = ?", [id]);
  if (!chapterRow)
    return respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
  const content = String(chapterRow.content ?? "").trim();
  if (!content)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Chapter content is required for analysis",
      requestId,
    );
  const projectId = String(chapterRow.project_id);
  const chapterTitle = String(chapterRow.title);
  const taskId = randomUUID();
  const now = timestamp();
  const questionCount = (content.match(/[？?]/g) ?? []).length;
  const exclamationCount = (content.match(/[！!]/g) ?? []).length;
  const visualWords = (
    content.match(/雨|夜|光|门|车|街|窗|镜|火|血|海|风/g) ?? []
  ).length;
  const conflict = String(chapterRow.main_conflict ?? "").trim();
  const hook = String(chapterRow.hook ?? "").trim();
  const climax = String(chapterRow.highlight ?? "").trim();
  const cliffhanger = String(chapterRow.cliffhanger ?? "").trim();
  const beatId = randomUUID();
  const highlightId = randomUUID();
  const feasibilityId = randomUUID();
  const evaluationId = randomUUID();
  const intensity = analysisScore(
    questionCount + exclamationCount + (conflict ? 3 : 0),
    2,
  );
  const visualScore = analysisScore(visualWords, 2);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        "analysis.chapter",
        "succeeded",
        `章节分析：${chapterTitle}`,
        projectId,
        JSON.stringify({
          chapterId: id,
          records: [beatId, highlightId, feasibilityId, evaluationId],
        }),
        now,
        now,
      );
    const insert = db!.prepare(
      "INSERT INTO domain_entities VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    );
    insert.run(
      beatId,
      "beats",
      projectId,
      id,
      `${chapterTitle}·节拍分析`,
      JSON.stringify({
        关联章节: chapterTitle,
        节拍类型: hook || cliffhanger ? "悬念推进" : "叙事推进",
        戏剧强度: intensity,
        视觉强度: visualScore,
        节拍描述:
          conflict ||
          `本章包含 ${questionCount} 个疑问点和 ${exclamationCount} 个情绪强调点。`,
        分析来源章节: id,
      }),
      now,
      now,
    );
    insert.run(
      highlightId,
      "highlights",
      projectId,
      id,
      `${chapterTitle}·高光分析`,
      JSON.stringify({
        关联章节: chapterTitle,
        高光评分: Math.max(intensity, hook || climax ? 7 : 4),
        高光类型: climax || hook ? "反转或信息揭示" : "待补强高光",
        总结与建议:
          climax ||
          hook ||
          `建议在章节中段增加明确的身份揭示、行动选择或情绪反击。`,
        分析来源章节: id,
      }),
      now,
      now,
    );
    insert.run(
      feasibilityId,
      "feasibility",
      projectId,
      id,
      `${chapterTitle}·可制作性`,
      JSON.stringify({
        关联章节: chapterTitle,
        综合评分: Math.max(
          1,
          Math.min(10, Math.round((visualScore + intensity) / 2)),
        ),
        制作风险:
          visualWords > 12
            ? "视觉元素较多，需提前锁定场景与角色参考。"
            : "主要为叙事和人物镜头，适合先完成分镜规划。",
        优化建议: "将关键动作和空间关系拆分为场景，再为情绪转折建立近景分镜。",
        分析来源章节: id,
      }),
      now,
      now,
    );
    insert.run(
      evaluationId,
      "evaluations",
      projectId,
      id,
      `${chapterTitle}·章节评估`,
      JSON.stringify({
        关联章节: chapterTitle,
        总分: Math.max(
          1,
          Math.min(
            10,
            Math.round(
              (intensity + visualScore + (content.length > 300 ? 7 : 4)) / 3,
            ),
          ),
        ),
        发现的问题: cliffhanger
          ? "已识别章节悬念，可在下一章兑现或升级。"
          : "尚未识别明确的结尾悬念，建议补充可验证的问题或行动后果。",
        改进建议: "保持人物目标、冲突和结尾信息之间的因果连续性。",
        分析来源章节: id,
      }),
      now,
      now,
    );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const records = [beatId, highlightId, feasibilityId, evaluationId].map(
    (recordId) =>
      domainEntity(
        one("SELECT * FROM domain_entities WHERE id = ?", [recordId])!,
      ),
  );
  const createdTask = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
  emit("task.created", createdTask);
  emit("analysis.completed", { chapterId: id, records });
  json(res, 201, { task: createdTask, records });
}

const CREATIVE_DIAGNOSTIC_KINDS: CreativeDiagnosticKind[] = [
  "freshness",
  "anti_trope",
  "quality_gate",
  "audience",
  "narrative_curve",
];
const CREATIVE_TARGET_KINDS: CreativeTargetKind[] = [
  "project",
  "chapter",
  "adaptation",
  "episode",
  "script",
  "scene",
  "shot",
];

function listCreativeCaseStudies(res: ServerResponse): void {
  json(
    res,
    200,
    rows(
      "SELECT * FROM creative_case_studies ORDER BY updated_at DESC, title COLLATE NOCASE",
    ).map(creativeCaseStudy),
  );
}

async function createCreativeCaseStudy(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<CreativeCaseStudyInput>;
  const title = text(input.title);
  if (!title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请填写案例标题",
      requestId,
    );
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare(
      `INSERT INTO creative_case_studies (
        id, title, source_type, genre, summary, relationship_patterns_json,
        opening_hooks_json, highlight_beats_json, reversal_mechanisms_json,
        cliffhangers_json, visual_patterns_json, rhythm_curve_json, risk_tags_json,
        notes, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      title,
      text(input.sourceType) ?? null,
      text(input.genre) ?? null,
      text(input.summary) ?? null,
      JSON.stringify(creativeStringList(input.relationshipPatterns)),
      JSON.stringify(creativeStringList(input.openingHooks)),
      JSON.stringify(creativeStringList(input.highlightBeats)),
      JSON.stringify(creativeStringList(input.reversalMechanisms)),
      JSON.stringify(creativeStringList(input.cliffhangers)),
      JSON.stringify(creativeStringList(input.visualPatterns)),
      JSON.stringify(creativeCurve(input.rhythmCurve)),
      JSON.stringify(creativeStringList(input.riskTags)),
      text(input.notes) ?? null,
      now,
      now,
    );
  const created = creativeCaseStudy(
    one("SELECT * FROM creative_case_studies WHERE id = ?", [id])!,
  );
  emit("creative.case_study_created", created);
  json(res, 201, created);
}

async function updateCreativeCaseStudy(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one("SELECT * FROM creative_case_studies WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "未找到案例", requestId);
  const input = (await body(req)) as Partial<CreativeCaseStudyPatch>;
  if (!Number.isInteger(input.version))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "缺少案例版本号",
      requestId,
    );
  if (Number(input.version) !== Number(current.version))
    return respondError(
      res,
      409,
      "CONFLICT",
      "案例已被其他修改覆盖，请刷新后重试",
      requestId,
    );
  const title =
    input.title === undefined ? String(current.title) : text(input.title);
  if (!title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请填写案例标题",
      requestId,
    );
  const value = (
    key: keyof CreativeCaseStudyInput,
    currentValue: unknown,
  ): string | null => {
    if (input[key] === undefined)
      return typeof currentValue === "string" ? currentValue : null;
    return text(input[key]) ?? null;
  };
  const strings = (
    key:
      | "relationshipPatterns"
      | "openingHooks"
      | "highlightBeats"
      | "reversalMechanisms"
      | "cliffhangers"
      | "visualPatterns"
      | "riskTags",
    currentValue: unknown,
  ) =>
    JSON.stringify(
      input[key] === undefined
        ? creativeStringList(currentValue)
        : creativeStringList(input[key]),
    );
  db!
    .prepare(
      `UPDATE creative_case_studies SET
        title = ?, source_type = ?, genre = ?, summary = ?, relationship_patterns_json = ?,
        opening_hooks_json = ?, highlight_beats_json = ?, reversal_mechanisms_json = ?,
        cliffhangers_json = ?, visual_patterns_json = ?, rhythm_curve_json = ?, risk_tags_json = ?,
        notes = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .run(
      title,
      value("sourceType", current.source_type),
      value("genre", current.genre),
      value("summary", current.summary),
      strings("relationshipPatterns", current.relationship_patterns_json),
      strings("openingHooks", current.opening_hooks_json),
      strings("highlightBeats", current.highlight_beats_json),
      strings("reversalMechanisms", current.reversal_mechanisms_json),
      strings("cliffhangers", current.cliffhangers_json),
      strings("visualPatterns", current.visual_patterns_json),
      JSON.stringify(
        input.rhythmCurve === undefined
          ? creativeCurve(current.rhythm_curve_json)
          : creativeCurve(input.rhythmCurve),
      ),
      strings("riskTags", current.risk_tags_json),
      value("notes", current.notes),
      timestamp(),
      id,
    );
  const updated = creativeCaseStudy(
    one("SELECT * FROM creative_case_studies WHERE id = ?", [id])!,
  );
  emit("creative.case_study_updated", updated);
  json(res, 200, updated);
}

function removeCreativeCaseStudy(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const result = db!
    .prepare("DELETE FROM creative_case_studies WHERE id = ?")
    .run(id);
  if (!result.changes)
    return respondError(res, 404, "NOT_FOUND", "未找到案例", requestId);
  emit("creative.case_study_removed", { id });
  res.writeHead(204).end();
}

function listCreativeDiagnostics(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!activeProject(projectId))
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM creative_diagnostics WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    ).map(creativeDiagnostic),
  );
}

async function runCreativeDiagnostics(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<CreativeDiagnosticInput>;
  const projectId = text(input.projectId);
  if (!projectId || !activeProject(projectId))
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  const kinds = [...new Set(creativeDiagnosticKinds(input.kinds))];
  if (!kinds.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "至少选择一种创意诊断",
      requestId,
    );
  const targetKind = creativeTargetKind(input.targetKind) ?? "project";
  const targetId = text(input.targetId);
  if (targetKind !== "project" && !targetId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请选择诊断目标",
      requestId,
    );
  if (targetKind === "project" && targetId && targetId !== projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "项目级诊断不能引用其他项目",
      requestId,
    );
  const target = creativeDiagnosticTarget(projectId, targetKind, targetId);
  if (!target)
    return respondError(res, 404, "NOT_FOUND", "未找到诊断目标", requestId);
  const caseStudyIds = [...new Set(creativeStringList(input.caseStudyIds))];
  const caseStudies = creativeCaseStudiesById(caseStudyIds);
  if (caseStudies.length !== caseStudyIds.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "所选案例不存在或已删除",
      requestId,
    );
  const sourceFingerprint = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        target: [target.kind, target.id, target.text],
        cases: caseStudies.map((item) => [item.id, item.version]),
      }),
    )
    .digest("hex")}`;
  const now = timestamp();
  const taskId = randomUUID();
  const diagnostics = kinds.map((kind) =>
    buildCreativeDiagnostic({
      id: randomUUID(),
      projectId,
      target,
      kind,
      sourceFingerprint,
      caseStudies,
      createdAt: now,
    }),
  );
  db!.exec("BEGIN IMMEDIATE");
  try {
    const insert = db!.prepare(
      `INSERT INTO creative_diagnostics (
        id, project_id, target_kind, target_id, target_title, kind, title, summary,
        scores_json, findings_json, recommendations_json, curve_json, source_fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const diagnostic of diagnostics)
      insert.run(
        diagnostic.id,
        diagnostic.projectId,
        diagnostic.targetKind,
        diagnostic.targetId ?? null,
        diagnostic.targetTitle,
        diagnostic.kind,
        diagnostic.title,
        diagnostic.summary,
        JSON.stringify(diagnostic.scores),
        JSON.stringify(diagnostic.findings),
        JSON.stringify(diagnostic.recommendations),
        "curve" in diagnostic && diagnostic.curve
          ? JSON.stringify(diagnostic.curve)
          : null,
        diagnostic.sourceFingerprint,
        diagnostic.createdAt,
      );
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        "creative.diagnostics",
        "succeeded",
        `创意诊断：${target.title}`,
        projectId,
        JSON.stringify({
          targetKind,
          targetId: target.id,
          diagnosticIds: diagnostics.map((item) => item.id),
        }),
        now,
        now,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const createdTask = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
  emit("task.created", createdTask);
  emit("creative.diagnostics_completed", { projectId, diagnostics });
  json(res, 201, { task: createdTask, diagnostics });
}

function listCreativeIssueAcknowledgements(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!activeProject(projectId))
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM creative_issue_acknowledgements WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    ).map(creativeIssueAcknowledgement),
  );
}

async function acknowledgeCreativeIssue(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<CreativeIssueAcknowledgementInput>;
  const projectId = text(input.projectId);
  const diagnosticId = text(input.diagnosticId);
  const issueKey = text(input.issueKey);
  const disposition = text(input.disposition);
  if (!projectId || !diagnosticId || !issueKey || !disposition)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请填写问题确认信息",
      requestId,
    );
  if (!activeProject(projectId))
    return respondError(res, 404, "NOT_FOUND", "未找到项目", requestId);
  if (!["accepted", "fixed", "not_applicable"].includes(disposition))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "问题处理状态无效",
      requestId,
    );
  const diagnostic = one(
    "SELECT * FROM creative_diagnostics WHERE id = ? AND project_id = ?",
    [diagnosticId, projectId],
  );
  if (!diagnostic)
    return respondError(res, 404, "NOT_FOUND", "未找到创意诊断报告", requestId);
  if (!creativeStringList(diagnostic.findings_json).includes(issueKey))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "该问题不属于指定诊断报告",
      requestId,
    );
  const existing = one(
    "SELECT id FROM creative_issue_acknowledgements WHERE project_id = ? AND diagnostic_id = ? AND issue_key = ?",
    [projectId, diagnosticId, issueKey],
  );
  const id = existing ? String(existing.id) : randomUUID();
  const now = timestamp();
  db!
    .prepare(
      `INSERT INTO creative_issue_acknowledgements
        (id, project_id, diagnostic_id, issue_key, disposition, note, actor_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, diagnostic_id, issue_key) DO UPDATE SET
         disposition = excluded.disposition, note = excluded.note,
         actor_label = excluded.actor_label, created_at = excluded.created_at`,
    )
    .run(
      id,
      projectId,
      diagnosticId,
      issueKey,
      disposition,
      text(input.note) ?? null,
      text(input.actorLabel) ?? null,
      now,
    );
  const acknowledgement = creativeIssueAcknowledgement(
    one("SELECT * FROM creative_issue_acknowledgements WHERE id = ?", [id])!,
  );
  emit("creative.issue_acknowledged", acknowledgement);
  json(res, 201, acknowledgement);
}

function activeProject(projectId: string): Record<string, any> | undefined {
  return one("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL", [
    projectId,
  ]);
}

function creativeDiagnosticKinds(value: unknown): CreativeDiagnosticKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CreativeDiagnosticKind =>
    CREATIVE_DIAGNOSTIC_KINDS.includes(item as CreativeDiagnosticKind),
  );
}

function creativeTargetKind(value: unknown): CreativeTargetKind | undefined {
  return CREATIVE_TARGET_KINDS.includes(value as CreativeTargetKind)
    ? (value as CreativeTargetKind)
    : undefined;
}

function creativeDiagnosticTarget(
  projectId: string,
  kind: CreativeTargetKind,
  targetId?: string,
):
  | { kind: CreativeTargetKind; id?: string; title: string; text: string }
  | undefined {
  const projectRow = activeProject(projectId);
  if (!projectRow) return undefined;
  if (kind === "project") {
    const chapters = rows(
      "SELECT title, summary, outline, content, main_conflict, hook, highlight, reversal, cliffhanger FROM chapters WHERE project_id = ? ORDER BY order_index",
      [projectId],
    );
    return {
      kind,
      title: String(projectRow.title),
      text: [
        projectRow.title,
        projectRow.synopsis,
        projectRow.core_hook,
        projectRow.emotional_core,
        projectRow.core_selling_point,
        ...chapters.flatMap((chapterRow) => [
          chapterRow.title,
          chapterRow.summary,
          chapterRow.outline,
          chapterRow.content,
          chapterRow.main_conflict,
          chapterRow.hook,
          chapterRow.highlight,
          chapterRow.reversal,
          chapterRow.cliffhanger,
        ]),
      ]
        .filter((item): item is string => typeof item === "string")
        .join("\n"),
    };
  }
  if (!targetId) return undefined;
  if (kind === "chapter") {
    const chapterRow = one(
      "SELECT * FROM chapters WHERE id = ? AND project_id = ?",
      [targetId, projectId],
    );
    if (!chapterRow) return undefined;
    return {
      kind,
      id: targetId,
      title: String(chapterRow.title),
      text: [
        chapterRow.title,
        chapterRow.summary,
        chapterRow.outline,
        chapterRow.content,
        chapterRow.main_conflict,
        chapterRow.hook,
        chapterRow.highlight,
        chapterRow.reversal,
        chapterRow.cliffhanger,
      ]
        .filter((item): item is string => typeof item === "string")
        .join("\n"),
    };
  }
  const domain = (
    {
      adaptation: "adaptations",
      episode: "episodes",
      script: "scripts",
      scene: "scenes",
      shot: "shots",
    } as const
  )[kind];
  if (!domain) return undefined;
  const entity = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [targetId, domain, projectId],
  );
  if (!entity) return undefined;
  return {
    kind,
    id: targetId,
    title: String(entity.title),
    text: [
      String(entity.title),
      ...creativeTextValues(domainPayload(entity.payload_json)),
    ].join("\n"),
  };
}

function creativeTextValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(creativeTextValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(
    creativeTextValues,
  );
}

function creativeCaseStudiesById(ids: string[]): Array<Record<string, any>> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return rows(
    `SELECT * FROM creative_case_studies WHERE id IN (${placeholders})`,
    ids,
  );
}

function buildCreativeDiagnostic(input: {
  id: string;
  projectId: string;
  target: {
    kind: CreativeTargetKind;
    id?: string;
    title: string;
    text: string;
  };
  kind: CreativeDiagnosticKind;
  sourceFingerprint: string;
  caseStudies: Array<Record<string, any>>;
  createdAt: string;
}) {
  const content = input.target.text.replace(/\s+/g, " ").trim();
  const length = Array.from(content).length;
  const paragraphs = content
    .split(/(?:\n{2,}|[。！？!?]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const cliches = [
    ...new Set(
      content.match(/霸总|失忆|复仇|替身|重生|契约婚姻|一夜情|天降|白月光/g) ??
        [],
    ),
  ];
  const punctuation = (content.match(/[！!？?]/g) ?? []).length;
  const reversals = (content.match(/但是|却|原来|没想到|反而|真相|身份/g) ?? [])
    .length;
  const visualSignals = (
    content.match(/雨|夜|光|门|车|街|窗|镜|火|血|海|风|手机/g) ?? []
  ).length;
  const uniqueRatio = length
    ? Math.min(
        1,
        (new Set(Array.from(content.replace(/\s/g, ""))).size / length) * 3,
      )
    : 0;
  const score = (value: number) =>
    Math.max(0, Math.min(10, Math.round(value * 10) / 10));
  const casePatterns = input.caseStudies.flatMap((study) =>
    [
      ...creativeStringList(study.opening_hooks_json),
      ...creativeStringList(study.highlight_beats_json),
      ...creativeStringList(study.reversal_mechanisms_json),
      ...creativeStringList(study.cliffhangers_json),
    ].filter(Boolean),
  );
  const caseNote = casePatterns.length
    ? `已参考 ${input.caseStudies.length} 个案例中的 ${casePatterns.length} 条结构要点。`
    : "尚未选择案例；结果仅基于当前项目资料。";
  const base = {
    id: input.id,
    projectId: input.projectId,
    targetKind: input.target.kind,
    ...(input.target.id ? { targetId: input.target.id } : {}),
    targetTitle: input.target.title,
    kind: input.kind,
    sourceFingerprint: input.sourceFingerprint,
    createdAt: input.createdAt,
  };
  if (input.kind === "freshness") {
    const originality = score(
      4.8 +
        uniqueRatio * 3 +
        Math.min(1.2, reversals * 0.3) -
        cliches.length * 0.45,
    );
    const predictability = score(5.5 + cliches.length * 0.6 - reversals * 0.25);
    const tropeRisk = score(1.5 + cliches.length * 1.1);
    return {
      ...base,
      title: `${input.target.title}·新鲜度诊断`,
      summary: `当前资料的新鲜度为 ${originality}/10；${caseNote}`,
      scores: [
        { label: "原创性", value: originality },
        { label: "可预测性", value: predictability },
        { label: "套路风险", value: tropeRisk },
        { label: "角色差异", value: score(4 + uniqueRatio * 3) },
        { label: "反转活性", value: score(3 + reversals * 0.8) },
      ],
      findings: [
        ...(cliches.length
          ? [`识别到常见题材元素：${cliches.join("、")}。`]
          : ["未识别到高频题材标签，仍需人工核对角色关系与结局走向。"]),
        length < 180
          ? "资料篇幅较短，判断置信度有限。"
          : "资料长度足以进行基础结构扫描。",
      ],
      recommendations: [
        "为主角补充一个会反噬自身的主动选择，避免只由外部事件推动。",
        cliches.length
          ? "保留核心爽点，但将其中一个常见设定改为有代价的选择或错误判断。"
          : "在关键反转前埋入可回看验证的细节，增强新鲜感与公平性。",
      ],
    };
  }
  if (input.kind === "anti_trope") {
    const antiTrope = score(
      3.5 + reversals * 0.9 + uniqueRatio * 2 - cliches.length * 0.25,
    );
    return {
      ...base,
      title: `${input.target.title}·反套路方案`,
      summary:
        "该报告给出保留核心爽点的替代路径，须由作者选择后再形成修订预览。",
      scores: [
        { label: "反套路空间", value: antiTrope },
        {
          label: "爽点保留度",
          value: score(6.5 + Math.min(1.5, punctuation * 0.15)),
        },
        { label: "执行风险", value: score(3 + cliches.length * 0.4) },
      ],
      findings: [
        cliches.length
          ? `可从「${cliches[0]}」切入，改变信息不对称的来源。`
          : "当前没有单一高频套路标签，可优先调整人物动机与胜利代价。",
        "本报告不会自动替换正文；任何改写必须走修订预览与人工提交。",
      ],
      recommendations: [
        "将一次身份揭示改为主角已经知情、却选择隐瞒的行动后果。",
        "让看似反派的角色先完成一次有代价的正确选择，再揭示真实冲突。",
        "把结尾钩子从“新信息出现”改成“主角必须立刻承担的选择”。",
      ],
    };
  }
  if (input.kind === "quality_gate") {
    const blockers = [
      ...(length < 80
        ? ["阻断：资料不足 80 字，无法形成可复核的创意判断。"]
        : []),
      ...(paragraphs.length < 2
        ? ["阻断：缺少可识别的推进段落或场景层次。"]
        : []),
    ];
    const warnings = [
      ...(cliches.length
        ? [`提示：需人工确认「${cliches.join("、")}」是否为刻意类型化表达。`]
        : []),
      ...(punctuation === 0
        ? ["提示：未识别到明确疑问、情绪强调或悬念标点。"]
        : []),
    ];
    const quality = score(
      8.5 -
        blockers.length * 3 -
        warnings.length * 0.8 +
        Math.min(1, visualSignals * 0.08),
    );
    return {
      ...base,
      title: `${input.target.title}·创意质量门禁`,
      summary: blockers.length
        ? "质量门禁未通过；请先处理阻断项。"
        : warnings.length
          ? "质量门禁可继续，但建议先人工确认提示项。"
          : "基础创意门禁通过；仍需结合人工审阅与后续制作检查。",
      scores: [
        { label: "质量分", value: quality },
        {
          label: "结构完整度",
          value: score(Math.min(10, paragraphs.length * 2.2)),
        },
        { label: "视觉可读性", value: score(3 + visualSignals * 0.35) },
      ],
      findings: [...blockers, ...warnings, caseNote],
      recommendations: blockers.length
        ? ["补充人物目标、冲突升级和结尾后果后重新运行门禁。"]
        : [
            "对每个高风险类型元素补充一个可验证的角色动机或代价。",
            "在进入改编前人工确认本报告中的提示项。",
          ],
    };
  }
  if (input.kind === "audience") {
    const audience = String(
      activeProject(input.projectId)?.target_audience ?? "目标短剧观众",
    );
    const retention = score(
      3.5 + punctuation * 0.35 + reversals * 0.8 + Math.min(1.5, length / 700),
    );
    return {
      ...base,
      title: `${input.target.title}·受众模拟`,
      summary: `面向「${audience}」的本地结构模拟；它不是线上用户研究或真实投放数据。`,
      scores: [
        { label: "留存预期", value: retention },
        {
          label: "情感投入",
          value: score(4 + punctuation * 0.25 + reversals * 0.45),
        },
        {
          label: "新鲜感",
          value: score(5 + uniqueRatio * 2 - cliches.length * 0.3),
        },
      ],
      findings: [
        punctuation
          ? `识别到 ${punctuation} 个情绪或提问信号，可作为短段落停留点。`
          : "缺少显性情绪或提问信号，前段可能较平。",
        reversals
          ? `识别到 ${reversals} 个可能的反转或信息揭示信号。`
          : "未识别到明确反转信号，需人工确认中段推进。",
      ],
      recommendations: [
        "在前 15% 内容中明确主角目标与即时损失，避免观众只接收背景。",
        "把最有辨识度的冲突转成可截取的一句台词、一个动作或一个画面。",
      ],
    };
  }
  const chunks = creativeCurveFromText(content, 6);
  const weak = chunks
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value < 4)
    .map((item) => `第 ${item.index + 1} 段冲突/悬念信号较弱。`);
  return {
    ...base,
    title: `${input.target.title}·叙事曲线`,
    summary: `已按 ${chunks.length} 个内容段生成基础强度曲线；${caseNote}`,
    scores: [
      {
        label: "平均推进强度",
        value: score(
          chunks.reduce((sum, item) => sum + item, 0) / chunks.length,
        ),
      },
      { label: "反转密度", value: score(3 + reversals * 0.8) },
      { label: "结尾钩子", value: score(3 + punctuation * 0.4) },
    ],
    findings: weak.length
      ? weak
      : ["未发现明显的低强度区段，仍需人工确认节奏是否单一。"],
    recommendations: [
      "在低谷段加入新的目标、障碍或信息代价，而不是只补充解释性对白。",
      "将结尾的情绪变化落实为下一段必须回答的问题或行动。",
    ],
    curve: chunks,
  };
}

function creativeCurveFromText(content: string, size: number): number[] {
  const characters = Array.from(content);
  if (!characters.length) return Array.from({ length: size }, () => 0);
  return Array.from({ length: size }, (_, index) => {
    const start = Math.floor((characters.length * index) / size);
    const end = Math.floor((characters.length * (index + 1)) / size);
    const segment = characters.slice(start, end).join("");
    const signals = (
      segment.match(/[！!？?]|但是|却|原来|真相|立刻|危险/g) ?? []
    ).length;
    return Math.max(1, Math.min(10, Math.round((2 + signals * 1.4) * 10) / 10));
  });
}

function creativeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return creativeStringList(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 200);
}

function creativeCurve(value: unknown): number[] {
  if (typeof value === "string") {
    try {
      return creativeCurve(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 10)
    .slice(0, 100);
}

function creativeCaseStudy(row: Record<string, any>) {
  return {
    id: String(row.id),
    title: String(row.title),
    ...(row.source_type ? { sourceType: String(row.source_type) } : {}),
    ...(row.genre ? { genre: String(row.genre) } : {}),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    relationshipPatterns: creativeStringList(row.relationship_patterns_json),
    openingHooks: creativeStringList(row.opening_hooks_json),
    highlightBeats: creativeStringList(row.highlight_beats_json),
    reversalMechanisms: creativeStringList(row.reversal_mechanisms_json),
    cliffhangers: creativeStringList(row.cliffhangers_json),
    visualPatterns: creativeStringList(row.visual_patterns_json),
    rhythmCurve: creativeCurve(row.rhythm_curve_json),
    riskTags: creativeStringList(row.risk_tags_json),
    ...(row.notes ? { notes: String(row.notes) } : {}),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function creativeDiagnostic(row: Record<string, any>) {
  const curve = creativeCurve(row.curve_json);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    targetKind: String(row.target_kind) as CreativeTargetKind,
    ...(row.target_id ? { targetId: String(row.target_id) } : {}),
    targetTitle: String(row.target_title),
    kind: String(row.kind) as CreativeDiagnosticKind,
    title: String(row.title),
    summary: String(row.summary),
    scores: creativeScores(row.scores_json),
    findings: creativeStringList(row.findings_json),
    recommendations: creativeStringList(row.recommendations_json),
    ...(curve.length ? { curve } : {}),
    sourceFingerprint: String(row.source_fingerprint),
    createdAt: String(row.created_at),
  };
}

function creativeScores(
  value: unknown,
): Array<{ label: string; value: number }> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const record =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        const label = text(record.label);
        const score = Number(record.value);
        return label && Number.isFinite(score)
          ? { label, value: Math.max(0, Math.min(10, score)) }
          : undefined;
      })
      .filter((item): item is { label: string; value: number } =>
        Boolean(item),
      );
  } catch {
    return [];
  }
}

function creativeIssueAcknowledgement(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    diagnosticId: String(row.diagnostic_id),
    issueKey: String(row.issue_key),
    disposition: String(row.disposition) as
      "accepted" | "fixed" | "not_applicable",
    ...(row.note ? { note: String(row.note) } : {}),
    ...(row.actor_label ? { actorLabel: String(row.actor_label) } : {}),
    createdAt: String(row.created_at),
  };
}

function updateDomainEntityPayload(
  id: string,
  title: string,
  payload: Record<string, unknown>,
): void {
  db!
    .prepare(
      "UPDATE domain_entities SET title = ?, payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(title, JSON.stringify(payload), timestamp(), id);
}

const SOURCE_IMPORT_TTL_MS = 30 * 60 * 1_000;
const MAX_SOURCE_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_IMPORT_CHARS = 1_000_000;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;

async function previewSourceImport(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const capabilityToken = text(input.capabilityToken);
  if (!projectId || !capabilityToken)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId and capabilityToken are required",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const capability = await resolveCapability(capabilityToken);
  if (!capability?.permissions.includes("read"))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "File capability is invalid or expired",
      requestId,
    );
  let source: Buffer;
  let fileName: string;
  try {
    const info = statSync(capability.path);
    if (!info.isFile() || info.size > MAX_SOURCE_IMPORT_BYTES)
      throw new Error("Source file exceeds the supported size limit");
    source = readFileSync(capability.path);
    fileName = basename(capability.path);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Source file cannot be read",
      requestId,
    );
  }
  let preview: SourceImportPreview;
  try {
    preview = parseSourceImportBuffer(fileName, source);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Source file cannot be parsed",
      requestId,
    );
  }
  const id = randomUUID();
  const importsDirectory = join(command!.assetDirectory, "source-imports");
  mkdirSync(importsDirectory, { recursive: true });
  const stagedFileName = `${id}-${safeFileName(fileName)}`;
  copyFileSync(capability.path, join(importsDirectory, stagedFileName));
  const expiresAt = new Date(Date.now() + SOURCE_IMPORT_TTL_MS).toISOString();
  db!
    .prepare("INSERT INTO source_imports VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      id,
      projectId,
      stagedFileName,
      JSON.stringify(preview),
      expiresAt,
      timestamp(),
    );
  const duplicates = sourceImportDuplicates(projectId, preview);
  json(res, 201, { id, importId: id, preview, duplicates, expiresAt });
}

async function commitSourceImport(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const stored = one("SELECT * FROM source_imports WHERE id = ?", [id]);
  if (!stored)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Source import preview not found",
      requestId,
    );
  if (String(stored.expires_at) < timestamp()) {
    removeStagedSourceImport(String(stored.staged_file_name));
    db!.prepare("DELETE FROM source_imports WHERE id = ?").run(id);
    return respondError(
      res,
      409,
      "CONFLICT",
      "Source import preview expired",
      requestId,
    );
  }
  const projectId = text(input.projectId);
  const strategy = text(input.strategy) as SourceImportStrategy | undefined;
  if (projectId !== String(stored.project_id))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Source import project does not match preview",
      requestId,
    );
  if (!input.rightsConfirmed)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Rights confirmation is required",
      requestId,
    );
  if (!strategy || !["append", "merge", "replace"].includes(strategy))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid source import strategy",
      requestId,
    );
  if (strategy !== "append" && !input.destructiveConfirmed)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Destructive confirmation is required",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  let preview: SourceImportPreview;
  try {
    preview = normalizeSourceImportPreview(
      input.preview && typeof input.preview === "object"
        ? (input.preview as SourceImportPreview)
        : (JSON.parse(String(stored.preview_json)) as SourceImportPreview),
    );
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid source import preview",
      requestId,
    );
  }
  if (!preview.chapters.length && !preview.episodes.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Source import has no writable content",
      requestId,
    );
  let result: SourceImportCommitResult;
  try {
    db!.exec("BEGIN IMMEDIATE");
    result = applySourceImport(projectId, preview, strategy);
    const now = timestamp();
    insertDomainEntity(
      "assets",
      projectId,
      undefined,
      `导入原稿：${preview.fileName}`,
      {
        素材类型: "导入原稿",
        来源: "用户本地授权文件",
        用途与备注: "仅供项目内解析与创作参考。",
        版权说明: "用户已在导入时确认拥有使用权或取得必要授权。",
        file: {
          name: preview.fileName,
          storedName: `source-imports/${String(stored.staged_file_name)}`,
        },
        importedAt: now,
      },
    );
    insertDomainEntity(
      "rights",
      projectId,
      undefined,
      `导入内容权利声明：${preview.fileName}`,
      {
        权利状态: "用户声明已获授权",
        来源文件: preview.fileName,
        允许用途: "项目内阅读、改编、制作与交付前审核",
        备注: "该声明由用户导入时确认；仍应在交付前完成版权核验。",
      },
    );
    result.extractionChangeSet = createImportExtractionChangeSet(
      projectId,
      id,
      preview,
    );
    db!.prepare("DELETE FROM source_imports WHERE id = ?").run(id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  emit("source-import.committed", { projectId, id, result: result! });
  json(res, 201, result!);
}

function discardSourceImport(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const stored = one("SELECT * FROM source_imports WHERE id = ?", [id]);
  if (!stored)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Source import preview not found",
      requestId,
    );
  removeStagedSourceImport(String(stored.staged_file_name));
  db!.prepare("DELETE FROM source_imports WHERE id = ?").run(id);
  emit("source-import.discarded", { id });
  res.writeHead(204).end();
}

const MAX_PROJECT_PACKAGE_BYTES = 16 * 1024 * 1024;
const PROJECT_PACKAGE_TTL_MS = 30 * 60 * 1_000;

type ProjectPackageSnapshot = {
  project: Record<string, unknown>;
  chapters: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  importExtractions: Array<Record<string, unknown>>;
  warnings: string[];
};

function packageString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseProjectPackage(
  sourceName: string,
  source: Buffer,
): ProjectPackageSnapshot {
  if (source.length > MAX_PROJECT_PACKAGE_BYTES)
    throw new Error("项目包超过支持的大小限制");
  if (extname(sourceName).toLowerCase() !== ".json")
    throw new Error("项目包必须是由 DramaIP 导出的 JSON 文件");
  let raw: unknown;
  try {
    raw = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("项目包不是有效的 JSON 文件");
  }
  const root = domainPayload(raw);
  const project = domainPayload(root.project);
  const title = packageString(project.title).trim();
  const shortDramaType = packageString(project.shortDramaType).trim();
  if (!title || !shortDramaType)
    throw new Error("项目包缺少项目名称或短剧类型");
  const chapters = Array.isArray(root.chapters)
    ? root.chapters
        .map((item) => domainPayload(item))
        .filter((item) => packageString(item.title).trim())
        .slice(0, 5_000)
    : [];
  const warnings: string[] = [];
  if (Array.isArray(root.chapters) && chapters.length !== root.chapters.length)
    warnings.push("部分没有标题的章节已跳过。");
  const resources = Array.isArray(root.resources)
    ? root.resources
        .map((item) => domainPayload(item))
        .filter(
          (item) =>
            RESOURCE_DOMAINS.has(packageString(item.domain)) &&
            packageString(item.title).trim() &&
            packageString(item.domain) !== "content-versions",
        )
        .slice(0, 20_000)
    : [];
  if (
    Array.isArray(root.resources) &&
    resources.length !== root.resources.length
  )
    warnings.push("不受支持、无标题或仅用于历史恢复的资料未导入。");
  if (resources.some((item) => "file" in domainPayload(item.payload)))
    warnings.push(
      "项目包不会复制本地媒体文件；相关资料会保留，但需重新附加源文件。",
    );
  const importExtractions = Array.isArray(root.importExtractions)
    ? root.importExtractions
        .map((item) => domainPayload(item))
        .filter(
          (item) =>
            packageString(item.sourceFingerprint) &&
            packageString(item.sourceTitle) &&
            Array.isArray(item.candidates),
        )
        .slice(0, 2_000)
    : [];
  if (
    Array.isArray(root.importExtractions) &&
    importExtractions.length !== root.importExtractions.length
  )
    warnings.push("部分导入候选变更集格式无效，未随项目包导入。");
  return {
    project: {
      title,
      shortDramaType,
      targetAudience: packageString(project.targetAudience) || undefined,
      targetWordCount:
        typeof project.targetWordCount === "number" &&
        Number.isInteger(project.targetWordCount)
          ? project.targetWordCount
          : undefined,
      targetEpisodeCount:
        typeof project.targetEpisodeCount === "number" &&
        Number.isInteger(project.targetEpisodeCount)
          ? project.targetEpisodeCount
          : undefined,
      coreHook: packageString(project.coreHook) || undefined,
      emotionalCore: packageString(project.emotionalCore) || undefined,
      coreSellingPoint: packageString(project.coreSellingPoint) || undefined,
      synopsis: packageString(project.synopsis),
      styleGuide: packageString(project.styleGuide) || undefined,
      visualStyleDirection:
        packageString(project.visualStyleDirection) || undefined,
      genreOpportunity: packageString(project.genreOpportunity) || undefined,
      productionBrief: packageString(project.productionBrief) || undefined,
    },
    chapters,
    resources,
    importExtractions,
    warnings,
  };
}

async function previewProjectPackage(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const capabilityToken = text(input.capabilityToken);
  if (!capabilityToken)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "capabilityToken is required",
      requestId,
    );
  const capability = await resolveCapability(capabilityToken);
  if (!capability?.permissions.includes("read"))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "File capability is invalid or expired",
      requestId,
    );
  let snapshot: ProjectPackageSnapshot;
  let sourceName: string;
  try {
    const info = statSync(capability.path);
    if (!info.isFile() || info.size > MAX_PROJECT_PACKAGE_BYTES)
      throw new Error("项目包超过支持的大小限制");
    sourceName = basename(capability.path);
    snapshot = parseProjectPackage(sourceName, readFileSync(capability.path));
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "项目包无法读取",
      requestId,
    );
  }
  const id = randomUUID();
  const importsDirectory = join(command!.assetDirectory, "project-packages");
  mkdirSync(importsDirectory, { recursive: true });
  const stagedFileName = `${id}-${safeFileName(sourceName)}`;
  copyFileSync(capability.path, join(importsDirectory, stagedFileName));
  const expiresAt = new Date(Date.now() + PROJECT_PACKAGE_TTL_MS).toISOString();
  db!
    .prepare("INSERT INTO project_package_imports VALUES (?, ?, ?, ?, ?)")
    .run(id, stagedFileName, JSON.stringify(snapshot), expiresAt, timestamp());
  json(res, 201, {
    id,
    sourceName,
    projectTitle: packageString(snapshot.project.title),
    shortDramaType: packageString(snapshot.project.shortDramaType),
    chapterCount: snapshot.chapters.length,
    resourceCount: snapshot.resources.length,
    warnings: snapshot.warnings,
    expiresAt,
  });
}

function copyImportedProjectPayload(
  value: unknown,
  domain: string,
): Record<string, unknown> {
  const payload = { ...domainPayload(value) };
  if ("file" in payload) {
    delete payload.file;
    payload["本地文件状态"] = "项目包未包含源文件，请重新附加。";
  }
  if (domain === "providers" && "凭据引用" in payload) {
    delete payload["凭据引用"];
    payload["连接状态"] = "导入后需重新绑定安全凭据";
  }
  return payload;
}

async function commitProjectPackage(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const stored = one("SELECT * FROM project_package_imports WHERE id = ?", [
    id,
  ]);
  if (!stored)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Project package preview not found",
      requestId,
    );
  if (String(stored.expires_at) < timestamp()) {
    removeStagedProjectPackage(String(stored.staged_file_name));
    db!.prepare("DELETE FROM project_package_imports WHERE id = ?").run(id);
    return respondError(
      res,
      409,
      "CONFLICT",
      "Project package preview expired",
      requestId,
    );
  }
  let snapshot: ProjectPackageSnapshot;
  try {
    snapshot = JSON.parse(
      String(stored.preview_json),
    ) as ProjectPackageSnapshot;
  } catch {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Project package preview is invalid",
      requestId,
    );
  }
  const requestedTitle = text(input.title)?.trim();
  const title = requestedTitle || packageString(snapshot.project.title);
  if (!title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Project title is required",
      requestId,
    );
  const now = timestamp();
  const projectId = randomUUID();
  const resourceIds = new Map<string, string>();
  const chapterIds = new Map<string, string>();
  const pendingParents: Array<{ id: string; parentId?: string }> = [];
  try {
    db!.exec("BEGIN IMMEDIATE");
    db!
      .prepare(
        `INSERT INTO projects (
          id, title, short_drama_type, target_audience, target_word_count,
          target_episode_count, core_hook, emotional_core, core_selling_point,
          synopsis, style_guide, visual_style_direction, genre_opportunity,
          production_brief, deleted_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      )
      .run(
        projectId,
        title,
        packageString(snapshot.project.shortDramaType),
        optionalText(snapshot.project.targetAudience),
        optionalInteger(snapshot.project.targetWordCount),
        optionalInteger(snapshot.project.targetEpisodeCount),
        optionalText(snapshot.project.coreHook),
        optionalText(snapshot.project.emotionalCore),
        optionalText(snapshot.project.coreSellingPoint),
        packageString(snapshot.project.synopsis),
        optionalText(snapshot.project.styleGuide),
        optionalText(snapshot.project.visualStyleDirection),
        optionalText(snapshot.project.genreOpportunity),
        optionalText(snapshot.project.productionBrief),
        now,
        now,
      );
    const insertChapter = db!.prepare(
      `INSERT INTO chapters (
        id, project_id, title, order_index, summary, outline, content,
        main_conflict, hook, highlight, reversal, cliffhanger, short_drama_note,
        ai_video_note, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    snapshot.chapters.forEach((source, index) => {
      const nextId = randomUUID();
      if (!chapterIds.has(packageString(source.title)))
        chapterIds.set(packageString(source.title), nextId);
      insertChapter.run(
        nextId,
        projectId,
        packageString(source.title),
        index,
        packageString(source.summary),
        optionalText(source.outline),
        packageString(source.content),
        optionalText(source.mainConflict),
        optionalText(source.hook),
        optionalText(source.highlight),
        optionalText(source.reversal),
        optionalText(source.cliffhanger),
        optionalText(source.shortDramaNote),
        optionalText(source.aiVideoNote),
        now,
        now,
      );
    });
    const insertResource = db!.prepare(
      "INSERT INTO domain_entities VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?)",
    );
    snapshot.resources.forEach((source) => {
      const domain = packageString(source.domain);
      const nextId = randomUUID();
      const originalId = packageString(source.id);
      if (originalId) resourceIds.set(originalId, nextId);
      pendingParents.push({
        id: nextId,
        parentId: packageString(source.parentId) || undefined,
      });
      insertResource.run(
        nextId,
        domain,
        projectId,
        packageString(source.title),
        JSON.stringify(copyImportedProjectPayload(source.payload, domain)),
        now,
        now,
      );
    });
    const updateParent = db!.prepare(
      "UPDATE domain_entities SET parent_id = ? WHERE id = ? AND project_id = ?",
    );
    pendingParents.forEach(({ id: resourceId, parentId }) => {
      const resolvedParentId = parentId ? resourceIds.get(parentId) : undefined;
      if (resolvedParentId)
        updateParent.run(resolvedParentId, resourceId, projectId);
    });
    const insertExtraction = db!.prepare(
      `INSERT INTO import_extraction_change_sets(
        id, project_id, source_import_id, source_fingerprint, source_title, source_versions_json,
        status, summary, candidates_json, created_entity_ids_json, adoption_json, error_message,
        applied_at, undone_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, NULL, NULL, ?, ?)`,
    );
    for (const importedExtraction of snapshot.importExtractions) {
      const candidates = importExtractionCandidates(
        JSON.stringify({ items: importedExtraction.candidates }),
      );
      if (!candidates.length) continue;
      const versions = new Map<string, ImportExtractionSourceVersion>();
      for (const candidate of candidates) {
        for (const ref of candidate.sourceRefs) {
          if (versions.has(ref.sourceKey)) continue;
          const chapterId = chapterIds.get(ref.chapterTitle);
          const importedChapter = chapterId
            ? one("SELECT version, content FROM chapters WHERE id = ?", [
                chapterId,
              ])
            : undefined;
          versions.set(ref.sourceKey, {
            sourceKey: ref.sourceKey,
            ...(chapterId ? { chapterId } : {}),
            version: Number(importedChapter?.version ?? ref.sourceVersion),
            contentHash: storyBibleSourceHash(
              String(importedChapter?.content ?? ref.excerpt),
            ),
          });
        }
      }
      const requestedStatus = packageString(importedExtraction.status);
      const status = requestedStatus === "draft" ? "draft" : "discarded";
      insertExtraction.run(
        randomUUID(),
        projectId,
        `project-package:${id}`,
        packageString(importedExtraction.sourceFingerprint),
        packageString(importedExtraction.sourceTitle),
        JSON.stringify({ items: [...versions.values()] }),
        status,
        packageString(importedExtraction.summary) ||
          `从项目包恢复的 ${candidates.length} 条导入候选。`,
        JSON.stringify({ items: candidates }),
        status === "draft"
          ? null
          : "项目包只恢复未采用候选；历史采用记录不支持跨项目撤销。",
        now,
        now,
      );
    }
    db!.prepare("DELETE FROM project_package_imports WHERE id = ?").run(id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const imported = project(
    one("SELECT * FROM projects WHERE id = ?", [projectId])!,
  );
  removeStagedProjectPackage(String(stored.staged_file_name));
  emit("project.package_imported", { project: imported, sourceImportId: id });
  json(res, 201, {
    project: imported,
    chaptersCreated: snapshot.chapters.length,
    resourcesCreated: snapshot.resources.length,
  });
}

function discardProjectPackage(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const stored = one("SELECT * FROM project_package_imports WHERE id = ?", [
    id,
  ]);
  if (!stored)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Project package preview not found",
      requestId,
    );
  removeStagedProjectPackage(String(stored.staged_file_name));
  db!.prepare("DELETE FROM project_package_imports WHERE id = ?").run(id);
  emit("project.package_discarded", { id });
  res.writeHead(204).end();
}

function removeStagedProjectPackage(fileName: string): void {
  rmSync(
    join(command!.assetDirectory, "project-packages", basename(fileName)),
    { force: true },
  );
}

function removeStagedSourceImport(fileName: string): void {
  const name = basename(fileName);
  rmSync(join(command!.assetDirectory, "source-imports", name), {
    force: true,
  });
}

function sourceImportDuplicates(
  projectId: string,
  preview: SourceImportPreview,
): { chapters: string[]; episodes: number[] } {
  const chapterTitles = new Set(
    rows("SELECT title FROM chapters WHERE project_id = ?", [projectId]).map(
      (row) => String(row.title).trim(),
    ),
  );
  const importedChapters = preview.chapters
    .map((chapter) => chapter.title.trim())
    .filter((title) => chapterTitles.has(title));
  const existingEpisodeNumbers = new Set(
    rows(
      "SELECT payload_json FROM domain_entities WHERE domain = ? AND project_id = ?",
      ["episodes", projectId],
    )
      .map((row) => sourceEpisodeNumber(row.payload_json))
      .filter((number): number is number => number !== undefined),
  );
  return {
    chapters: [...new Set(importedChapters)],
    episodes: preview.episodes
      .map((episode) => episode.episodeNumber)
      .filter((number) => existingEpisodeNumbers.has(number)),
  };
}

function applySourceImport(
  projectId: string,
  preview: SourceImportPreview,
  strategy: SourceImportStrategy,
): SourceImportCommitResult {
  const result: SourceImportCommitResult = {
    createdChapters: 0,
    updatedChapters: 0,
    createdEpisodes: 0,
    createdScripts: 0,
    updatedScripts: 0,
    createdScenes: 0,
    checkpointCount: 0,
  };
  applyImportedChapters(projectId, preview.chapters, strategy, result);
  applyImportedScripts(projectId, preview, strategy, result);
  return result;
}

function applyImportedChapters(
  projectId: string,
  chapters: SourceImportChapter[],
  strategy: SourceImportStrategy,
  result: SourceImportCommitResult,
): void {
  const existing = rows(
    "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
    [projectId],
  );
  const byTitle = new Map(
    existing.map((item) => [String(item.title).trim(), item]),
  );
  let nextIndex = existing.length;
  for (const imported of chapters) {
    const current = byTitle.get(imported.title.trim());
    if (!current || strategy === "append") {
      const now = timestamp();
      db!
        .prepare(
          `INSERT INTO chapters (id, project_id, title, order_index, summary, content, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          randomUUID(),
          projectId,
          imported.title,
          nextIndex++,
          imported.content.slice(0, 240),
          imported.content,
          now,
          now,
        );
      result.createdChapters += 1;
      continue;
    }
    createContentCheckpoint(
      projectId,
      "chapter",
      String(current.id),
      String(current.title),
      String(current.content),
      Number(current.version),
    );
    const content =
      strategy === "merge"
        ? `${String(current.content).trim()}\n\n---\n\n${imported.content}`.trim()
        : imported.content;
    db!
      .prepare(
        "UPDATE chapters SET title = ?, summary = ?, content = ?, version = version + 1, updated_at = ? WHERE id = ?",
      )
      .run(
        imported.title,
        content.slice(0, 240),
        content,
        timestamp(),
        current.id,
      );
    result.updatedChapters += 1;
    result.checkpointCount += 1;
  }
}

function applyImportedScripts(
  projectId: string,
  preview: SourceImportPreview,
  strategy: SourceImportStrategy,
  result: SourceImportCommitResult,
): void {
  if (!preview.episodes.length) return;
  let adaptation = one(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id IS NULL ORDER BY created_at LIMIT 1",
    ["adaptations", projectId],
  );
  if (!adaptation) {
    const adaptationId = insertDomainEntity(
      "adaptations",
      projectId,
      undefined,
      `${preview.title}·导入剧本`,
      {
        改编方向: "导入剧本",
        目标集数: preview.episodes.length,
        改编简介: "由用户本地授权剧本导入。",
        改编策略: "先人工审阅，再继续制作。",
      },
    );
    adaptation = one("SELECT * FROM domain_entities WHERE id = ?", [
      adaptationId,
    ])!;
  }
  result.adaptationProjectId = String(adaptation.id);
  const episodes = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ?",
    ["episodes", projectId, adaptation.id],
  );
  const byNumber = new Map(
    episodes
      .map((item) => [sourceEpisodeNumber(item.payload_json), item] as const)
      .filter(
        (entry): entry is readonly [number, Record<string, unknown>] =>
          entry[0] !== undefined,
      ),
  );
  let largestEpisodeNumber = 0;
  for (const number of byNumber.keys())
    largestEpisodeNumber = Math.max(largestEpisodeNumber, number);
  let nextNumber = largestEpisodeNumber + 1;
  for (const imported of preview.episodes) {
    const matchedEpisode = byNumber.get(imported.episodeNumber);
    const matchedScript = matchedEpisode
      ? one(
          "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ? ORDER BY created_at LIMIT 1",
          ["scripts", projectId, matchedEpisode.id],
        )
      : undefined;
    if (matchedEpisode && matchedScript && strategy !== "append") {
      const currentPayload = domainPayload(matchedScript.payload_json);
      const oldContent = stringPayload(currentPayload, "剧本内容");
      createContentCheckpoint(
        projectId,
        "script",
        String(matchedScript.id),
        String(matchedScript.title),
        oldContent,
        Number(matchedScript.version),
      );
      const content =
        strategy === "merge"
          ? `${oldContent.trim()}\n\n---\n\n${imported.content}`.trim()
          : imported.content;
      const payload = {
        ...currentPayload,
        关联分集: String(matchedEpisode.title),
        剧本内容: content,
      };
      db!
        .prepare(
          "UPDATE domain_entities SET title = ?, payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(
          imported.title,
          JSON.stringify(payload),
          timestamp(),
          matchedScript.id,
        );
      if (strategy === "replace")
        db!
          .prepare(
            "DELETE FROM domain_entities WHERE domain = ? AND parent_id = ?",
          )
          .run("scenes", matchedScript.id);
      const sceneOffset =
        strategy === "merge"
          ? Number(
              one(
                "SELECT count(*) AS count FROM domain_entities WHERE domain = ? AND parent_id = ?",
                ["scenes", matchedScript.id],
              )?.count ?? 0,
            )
          : 0;
      for (const [index, scene] of imported.scenes.entries()) {
        insertImportedScene(
          projectId,
          String(matchedScript.id),
          scene,
          sceneOffset + index,
        );
        result.createdScenes += 1;
      }
      result.updatedScripts += 1;
      result.checkpointCount += 1;
      continue;
    }
    const episodeNumber = matchedEpisode
      ? nextNumber++
      : imported.episodeNumber;
    const episodeId = insertDomainEntity(
      "episodes",
      projectId,
      String(adaptation.id),
      imported.title,
      {
        集数: episodeNumber,
        关联改编项目: String(adaptation.title),
        分集简介: imported.content.slice(0, 240),
        结尾悬念: "待补充",
      },
    );
    const scriptId = insertDomainEntity(
      "scripts",
      projectId,
      episodeId,
      imported.title,
      {
        关联分集: imported.title,
        剧本内容: imported.content,
        审查意见: "由导入剧本创建，待人工审阅。",
      },
    );
    for (const [index, scene] of imported.scenes.entries()) {
      insertImportedScene(projectId, scriptId, scene, index);
      result.createdScenes += 1;
    }
    result.createdEpisodes += 1;
    result.createdScripts += 1;
  }
}

function insertImportedScene(
  projectId: string,
  scriptId: string,
  scene: SourceImportScene,
  index: number,
): void {
  insertDomainEntity("scenes", projectId, scriptId, scene.title, {
    关联剧本: scriptId,
    地点与时间: [scene.location, scene.timeOfDay].filter(Boolean).join("，"),
    场景动作: scene.visualDescription || scene.content,
    对白与备注: scene.content,
    场景序号: index + 1,
    人物: scene.characters.join("、"),
    摘要: scene.summary,
  });
}

function createContentCheckpoint(
  projectId: string,
  targetKind: "chapter" | "script",
  targetId: string,
  title: string,
  content: string,
  baseVersion?: number,
  source = "原稿导入前自动保存",
  metadata?: Record<string, unknown>,
): void {
  insertDomainEntity(
    "content-versions",
    projectId,
    targetId,
    `${source === "原稿导入前自动保存" ? "导入前检查点" : source}：${title}`,
    {
      目标类型: targetKind === "chapter" ? "章节" : "剧本",
      目标标识: targetId,
      ...(baseVersion === undefined ? {} : { 基础版本: baseVersion }),
      内容: content,
      来源: source,
      ...metadata,
    },
  );
}

function insertDomainEntity(
  domain: string,
  projectId: string | undefined,
  parentId: string | undefined,
  title: string,
  payload: Record<string, unknown>,
): string {
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare("INSERT INTO domain_entities VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
    .run(
      id,
      domain,
      projectId ?? null,
      parentId ?? null,
      title,
      JSON.stringify(payload),
      now,
      now,
    );
  return id;
}

function sourceEpisodeNumber(value: unknown): number | undefined {
  const number = domainPayload(value)["集数"];
  const parsed = typeof number === "number" ? number : Number(number);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function domainPayload(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringPayload(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === "string" ? payload[key] : "";
}

type ImportExtractionSourceVersion = {
  sourceKey: string;
  chapterId?: string;
  version: number;
  contentHash: string;
};
type ImportExtractionAdoption =
  | {
      kind: "entity";
      candidateId: string;
      entityId: string;
      expectedVersion: number;
    }
  | {
      kind: "chapter-summary";
      candidateId: string;
      chapterId: string;
      previousSummary: string;
      appliedSummary: string;
      appliedVersion: number;
    };

function importExtractionChangeSet(
  row: Record<string, unknown>,
): ImportExtractionChangeSet {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceFingerprint: String(row.source_fingerprint),
    sourceTitle: String(row.source_title),
    status: String(row.status) as ImportExtractionChangeSet["status"],
    summary: String(row.summary),
    candidates: importExtractionCandidates(row.candidates_json),
    ...(row.applied_at ? { appliedAt: String(row.applied_at) } : {}),
    ...(row.undone_at ? { undoneAt: String(row.undone_at) } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function importExtractionCandidates(
  value: unknown,
): ImportExtractionCandidate[] {
  const parsed = domainPayload(value);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const types = new Set([
    "character",
    "scene",
    "prop",
    "chapter-summary",
    "adaptation",
  ]);
  const statuses = new Set(["draft", "rejected", "adopted", "conflict"]);
  return items.flatMap((item): ImportExtractionCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.summary !== "string" ||
      !types.has(String(candidate.type)) ||
      !statuses.has(String(candidate.status))
    )
      return [];
    const sourceRefs = Array.isArray(candidate.sourceRefs)
      ? candidate.sourceRefs.flatMap(
          (source): ImportExtractionCandidate["sourceRefs"] => {
            if (!source || typeof source !== "object") return [];
            const ref = source as Record<string, unknown>;
            if (
              typeof ref.sourceKey !== "string" ||
              typeof ref.chapterTitle !== "string" ||
              typeof ref.excerpt !== "string" ||
              !Number.isInteger(ref.start) ||
              !Number.isInteger(ref.end) ||
              !Number.isInteger(ref.sourceVersion)
            )
              return [];
            return [
              {
                sourceKey: ref.sourceKey,
                chapterTitle: ref.chapterTitle,
                excerpt: ref.excerpt,
                start: Number(ref.start),
                end: Number(ref.end),
                sourceVersion: Number(ref.sourceVersion),
              },
            ];
          },
        )
      : [];
    return [
      {
        id: candidate.id,
        type: candidate.type as ImportExtractionCandidate["type"],
        title: candidate.title,
        summary: candidate.summary,
        confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
        sourceRefs,
        status: candidate.status as ImportExtractionCandidate["status"],
        ...(typeof candidate.conflictNote === "string"
          ? { conflictNote: candidate.conflictNote }
          : {}),
      },
    ];
  });
}

function importExtractionSourceVersions(
  projectId: string,
  preview: SourceImportPreview,
): ImportExtractionSourceVersion[] {
  const segments = importExtractionSegments(preview);
  return segments.map((segment) => {
    const chapter = preview.chapters.some((item) => item.key === segment.key)
      ? one(
          "SELECT id, version, content FROM chapters WHERE project_id = ? AND title = ? ORDER BY updated_at DESC LIMIT 1",
          [projectId, segment.title],
        )
      : undefined;
    return {
      sourceKey: segment.key,
      ...(chapter ? { chapterId: String(chapter.id) } : {}),
      version: Number(chapter?.version ?? 0),
      contentHash: storyBibleSourceHash(
        String(chapter?.content ?? segment.content),
      ),
    };
  });
}

function importExtractionSegments(preview: SourceImportPreview) {
  const chapters = preview.chapters.map((chapter) => ({
    key: chapter.key,
    title: chapter.title,
    content: chapter.content,
  }));
  if (chapters.length) return chapters;
  return preview.episodes.map((episode) => ({
    key: episode.key,
    title: `第${episode.episodeNumber}集·${episode.title}`,
    content: episode.content,
  }));
}

function importExtractionExcerpt(content: string, start = 0): string {
  return content
    .slice(Math.max(0, start), Math.max(0, start) + 180)
    .replace(/\s+/g, " ")
    .trim();
}

function createImportExtractionCandidate(
  type: ImportExtractionCandidate["type"],
  title: string,
  summary: string,
  segment: { key: string; title: string; content: string },
  sourceVersions: ImportExtractionSourceVersion[],
  confidence: number,
  start = 0,
): ImportExtractionCandidate {
  const source = sourceVersions.find((item) => item.sourceKey === segment.key);
  const excerpt = importExtractionExcerpt(segment.content, start);
  return {
    id: randomUUID(),
    type,
    title: title.trim().slice(0, 120),
    summary: summary.trim().slice(0, 600),
    confidence,
    sourceRefs: [
      {
        sourceKey: segment.key,
        chapterTitle: segment.title,
        start,
        end: start + excerpt.length,
        excerpt,
        sourceVersion: source?.version ?? 0,
      },
    ],
    status: "draft",
  };
}

function importExtractionCharacterCandidates(
  segments: Array<{ key: string; title: string; content: string }>,
  sourceVersions: ImportExtractionSourceVersion[],
): ImportExtractionCandidate[] {
  const names = new Map<
    string,
    { segment: (typeof segments)[number]; start: number }
  >();
  const stopWords = new Set([
    "雨夜",
    "门口",
    "天亮",
    "电话",
    "脚步声",
    "没有",
    "一个",
    "已经",
    "自己",
  ]);
  for (const segment of segments) {
    for (const expression of [
      /([\p{Script=Han}]{2,4})[：:]/gu,
      /([\p{Script=Han}]{2,3})(?:在|说|道|问|答|握|走|看|发现|决定|来到|进入|拿起|放下|听见)/gu,
      /\b([A-Z][a-z]{2,})\b(?=\s+(?:said|asked|walked|looked|found|decided))/g,
    ]) {
      for (const match of segment.content.matchAll(expression)) {
        const name = String(match[1]).trim();
        if (!stopWords.has(name) && !names.has(name))
          names.set(name, { segment, start: match.index ?? 0 });
      }
    }
  }
  const found = [...names.entries()]
    .slice(0, 8)
    .map(([name, reference]) =>
      createImportExtractionCandidate(
        "character",
        name,
        `${name}出现在《${reference.segment.title}》的原稿叙事中；采用后会创建可继续完善的人物资料草案。`,
        reference.segment,
        sourceVersions,
        0.72,
        reference.start,
      ),
    );
  if (found.length) return found;
  const first = segments[0];
  return first
    ? [
        createImportExtractionCandidate(
          "character",
          `《${first.title}》人物线索待确认`,
          "原稿未出现可稳定识别的人名；保留此来源线索供人工命名，采用前可编辑。",
          first,
          sourceVersions,
          0.25,
        ),
      ]
    : [];
}

function importExtractionPropCandidates(
  segments: Array<{ key: string; title: string; content: string }>,
  sourceVersions: ImportExtractionSourceVersion[],
): ImportExtractionCandidate[] {
  const propNames = [
    "信封",
    "钥匙",
    "玉佩",
    "戒指",
    "照片",
    "手机",
    "电话",
    "盒子",
    "令牌",
    "药瓶",
    "书信",
    "项链",
    "剑",
    "刀",
  ];
  const found: ImportExtractionCandidate[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    for (const prop of propNames) {
      const start = segment.content.indexOf(prop);
      if (start >= 0 && !seen.has(prop)) {
        seen.add(prop);
        found.push(
          createImportExtractionCandidate(
            "prop",
            prop,
            `${prop}在《${segment.title}》中被提及；采用后会作为制作素材/道具草案写入，便于补充视觉与权利信息。`,
            segment,
            sourceVersions,
            0.7,
            start,
          ),
        );
      }
    }
  }
  if (found.length) return found.slice(0, 8);
  const first = segments[0];
  return first
    ? [
        createImportExtractionCandidate(
          "prop",
          `《${first.title}》关键物件待确认`,
          "未从原稿中识别到稳定的具体道具名称；保留对应原文范围供人工补充，不会虚构道具。",
          first,
          sourceVersions,
          0.2,
        ),
      ]
    : [];
}

function createImportExtractionChangeSet(
  projectId: string,
  sourceImportId: string,
  preview: SourceImportPreview,
): ImportExtractionChangeSet {
  const sourceFingerprint = storyBibleSourceHash(
    JSON.stringify({
      title: preview.title,
      sourceType: preview.sourceType,
      chapters: preview.chapters.map((chapter) => [
        chapter.key,
        chapter.title,
        chapter.content,
      ]),
      episodes: preview.episodes.map((episode) => [
        episode.key,
        episode.title,
        episode.content,
      ]),
    }),
  );
  const duplicate = one(
    `SELECT * FROM import_extraction_change_sets
     WHERE project_id = ? AND source_fingerprint = ? AND status IN ('draft', 'applied', 'stale')`,
    [projectId, sourceFingerprint],
  );
  if (duplicate) return importExtractionChangeSet(duplicate);
  const segments = importExtractionSegments(preview);
  const sourceVersions = importExtractionSourceVersions(projectId, preview);
  const candidates: ImportExtractionCandidate[] = [
    ...importExtractionCharacterCandidates(segments, sourceVersions),
    ...segments.map((segment) =>
      createImportExtractionCandidate(
        "scene",
        `${segment.title}·场景草案`,
        `根据《${segment.title}》的原稿段落整理的场景候选；采用后只创建可编辑的制作场景草案。`,
        segment,
        sourceVersions,
        0.66,
      ),
    ),
    ...importExtractionPropCandidates(segments, sourceVersions),
    ...segments.map((segment) =>
      createImportExtractionCandidate(
        "chapter-summary",
        segment.title,
        importExtractionExcerpt(segment.content) ||
          "原稿段落为空，待人工补充摘要。",
        segment,
        sourceVersions,
        0.8,
      ),
    ),
  ];
  if (segments[0]) {
    candidates.push(
      createImportExtractionCandidate(
        "adaptation",
        `《${preview.title}》短剧改编建议`,
        `基于 ${segments.length} 个${preview.contentKind === "script" ? "分集" : "原稿章节"}、${preview.charCount.toLocaleString("zh-CN")} 字符：先以每章一个剧情单元建立节奏，再由人工确认集数、冲突升级与悬念位置。`,
        segments[0],
        sourceVersions,
        0.62,
      ),
    );
  }
  const now = timestamp();
  const id = randomUUID();
  const summary = `已从《${preview.title}》整理 ${candidates.length} 条待审查候选：人物、场景、道具、章节摘要与改编建议均可逐项编辑后采用。`;
  db!
    .prepare(
      `INSERT INTO import_extraction_change_sets(
        id, project_id, source_import_id, source_fingerprint, source_title, source_versions_json,
        status, summary, candidates_json, created_entity_ids_json, adoption_json, error_message,
        applied_at, undone_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, '[]', '[]', NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      projectId,
      sourceImportId,
      sourceFingerprint,
      preview.title,
      JSON.stringify({ items: sourceVersions }),
      summary,
      JSON.stringify({ items: candidates }),
      now,
      now,
    );
  const taskId = randomUUID();
  db!
    .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?, ?)")
    .run(
      taskId,
      "source_import.extract",
      "succeeded",
      `导入候选已整理：${preview.title}`,
      projectId,
      JSON.stringify({ changeSetId: id, candidateCount: candidates.length }),
      now,
      now,
    );
  return importExtractionChangeSet(
    one("SELECT * FROM import_extraction_change_sets WHERE id = ?", [id])!,
  );
}

function importExtractionSourceVersionsFromRow(
  row: Record<string, unknown>,
): ImportExtractionSourceVersion[] {
  const payload = domainPayload(row.source_versions_json);
  const values = Array.isArray(payload.items) ? payload.items : [];
  return values.flatMap((value): ImportExtractionSourceVersion[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (
      typeof item.sourceKey !== "string" ||
      typeof item.contentHash !== "string" ||
      !Number.isInteger(item.version)
    )
      return [];
    return [
      {
        sourceKey: item.sourceKey,
        ...(typeof item.chapterId === "string"
          ? { chapterId: item.chapterId }
          : {}),
        version: Number(item.version),
        contentHash: item.contentHash,
      },
    ];
  });
}

function importExtractionStaleReason(
  row: Record<string, unknown>,
): string | undefined {
  for (const source of importExtractionSourceVersionsFromRow(row)) {
    if (!source.chapterId) continue;
    const chapter = one("SELECT version, content FROM chapters WHERE id = ?", [
      source.chapterId,
    ]);
    if (!chapter) return "导入来源章节已被删除，需要重新核对候选。";
    if (
      Number(chapter.version) !== source.version ||
      storyBibleSourceHash(String(chapter.content ?? "")) !== source.contentHash
    )
      return "导入来源章节已更新，需要重新核对候选。";
  }
  return undefined;
}

function markImportExtractionStaleForChapter(
  projectId: string,
  chapterId: string,
): void {
  const now = timestamp();
  for (const row of rows(
    "SELECT * FROM import_extraction_change_sets WHERE project_id = ? AND status IN ('draft', 'applied')",
    [projectId],
  )) {
    if (
      !importExtractionSourceVersionsFromRow(row).some(
        (source) => source.chapterId === chapterId,
      )
    )
      continue;
    db!
      .prepare(
        "UPDATE import_extraction_change_sets SET status = 'stale', error_message = ?, updated_at = ? WHERE id = ?",
      )
      .run("导入来源章节已更新，需要重新核对候选。", now, row.id);
  }
}

function listImportExtractionChangeSets(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM import_extraction_change_sets WHERE project_id = ? ORDER BY updated_at DESC",
      [projectId],
    ).map(importExtractionChangeSet),
  );
}

async function updateImportExtractionCandidate(
  req: IncomingMessage,
  res: ServerResponse,
  ids: [string, string],
  requestId: string,
): Promise<void> {
  const [id, candidateId] = ids;
  const current = one(
    "SELECT * FROM import_extraction_change_sets WHERE id = ?",
    [id],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Import extraction change set not found",
      requestId,
    );
  if (!["draft", "applied"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Only active change sets can be edited",
      requestId,
    );
  const input = await body(req);
  const candidates = importExtractionCandidates(current.candidates_json);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Import extraction candidate not found",
      requestId,
    );
  if (candidate.status === "adopted")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Adopted candidates cannot be edited",
      requestId,
    );
  if (typeof input.title === "string") {
    candidate.title = input.title.trim().slice(0, 120);
    if (!candidate.title)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "title cannot be empty",
        requestId,
      );
  }
  if (typeof input.summary === "string") {
    candidate.summary = input.summary.trim().slice(0, 600);
    if (!candidate.summary)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "summary cannot be empty",
        requestId,
      );
  }
  if (input.status === "draft" || input.status === "rejected") {
    candidate.status = input.status;
    if (input.status === "draft") delete candidate.conflictNote;
  }
  const now = timestamp();
  db!
    .prepare(
      "UPDATE import_extraction_change_sets SET candidates_json = ?, error_message = NULL, updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify({ items: candidates }), now, id);
  json(
    res,
    200,
    importExtractionChangeSet(
      one("SELECT * FROM import_extraction_change_sets WHERE id = ?", [id])!,
    ),
  );
}

function importExtractionConflict(
  changeSetId: string,
  projectId: string,
  candidate: ImportExtractionCandidate,
  sourceVersions: ImportExtractionSourceVersion[],
): string | undefined {
  if (candidate.type === "chapter-summary") {
    const source = sourceVersions.find(
      (item) => item.sourceKey === candidate.sourceRefs[0]?.sourceKey,
    );
    if (!source?.chapterId)
      return "该摘要没有可写入的项目章节；请保留为人工草案。";
    const chapter = one("SELECT version FROM chapters WHERE id = ?", [
      source.chapterId,
    ]);
    return !chapter || Number(chapter.version) !== source.version
      ? "来源章节已被人工修改，不会覆盖其摘要。"
      : undefined;
  }
  const domain =
    candidate.type === "character"
      ? "characters"
      : candidate.type === "scene"
        ? "scenes"
        : candidate.type === "prop"
          ? "assets"
          : "adaptations";
  const current = one(
    "SELECT id FROM domain_entities WHERE project_id = ? AND domain = ? AND title = ? AND payload_json NOT LIKE ? LIMIT 1",
    [projectId, domain, candidate.title, `%${changeSetId}%`],
  );
  return current
    ? `项目已有同名人工${candidate.type === "character" ? "人物" : candidate.type === "prop" ? "素材/道具" : "资料"}，不会覆盖。`
    : undefined;
}

async function adoptImportExtractionChangeSet(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one(
    "SELECT * FROM import_extraction_change_sets WHERE id = ?",
    [id],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Import extraction change set not found",
      requestId,
    );
  if (!["draft", "applied"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "This change set is no longer adoptable",
      requestId,
    );
  const staleReason = importExtractionStaleReason(current);
  if (staleReason) {
    db!
      .prepare(
        "UPDATE import_extraction_change_sets SET status = 'stale', error_message = ?, updated_at = ? WHERE id = ?",
      )
      .run(staleReason, timestamp(), id);
    return respondError(res, 409, "CONFLICT", staleReason, requestId);
  }
  const input = await body(req);
  const requested = Array.isArray(input.candidateIds)
    ? input.candidateIds.filter(
        (value): value is string => typeof value === "string",
      )
    : undefined;
  const candidates = importExtractionCandidates(current.candidates_json);
  const selectable = candidates.filter(
    (candidate) => candidate.status === "draft",
  );
  const selected = requested
    ? selectable.filter((candidate) => requested.includes(candidate.id))
    : selectable;
  if (!selected.length || (requested && selected.length !== requested.length))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Select one or more draft candidates",
      requestId,
    );
  const sourceVersions = importExtractionSourceVersionsFromRow(current);
  const conflicts = selected
    .map((candidate) => ({
      candidate,
      note: importExtractionConflict(
        id,
        String(current.project_id),
        candidate,
        sourceVersions,
      ),
    }))
    .filter(
      (item): item is { candidate: ImportExtractionCandidate; note: string } =>
        Boolean(item.note),
    );
  if (conflicts.length) {
    for (const { candidate, note } of conflicts) {
      candidate.status = "conflict";
      candidate.conflictNote = note;
    }
    db!
      .prepare(
        "UPDATE import_extraction_change_sets SET candidates_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify({ items: candidates }), timestamp(), id);
    return respondError(
      res,
      409,
      "CONFLICT",
      "One or more selected candidates conflict with existing human content",
      requestId,
    );
  }
  const createdIds = jsonStringArray(current.created_entity_ids_json);
  const adoptions = importExtractionAdoptions(current.adoption_json);
  const now = timestamp();
  try {
    db!.exec("BEGIN IMMEDIATE");
    for (const candidate of selected) {
      if (candidate.type === "chapter-summary") {
        const source = sourceVersions.find(
          (item) => item.sourceKey === candidate.sourceRefs[0]?.sourceKey,
        );
        const chapter = source?.chapterId
          ? one("SELECT * FROM chapters WHERE id = ?", [source.chapterId])
          : undefined;
        if (!source?.chapterId || !chapter)
          throw new Error("来源章节不存在，无法写入摘要");
        const result = db!
          .prepare(
            "UPDATE chapters SET summary = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
          )
          .run(candidate.summary, now, source.chapterId, source.version);
        if (Number(result.changes) !== 1)
          throw new Error("来源章节已更新，无法安全写入摘要");
        adoptions.push({
          kind: "chapter-summary",
          candidateId: candidate.id,
          chapterId: source.chapterId,
          previousSummary: String(chapter.summary ?? ""),
          appliedSummary: candidate.summary,
          appliedVersion: source.version + 1,
        });
      } else {
        const domain =
          candidate.type === "character"
            ? "characters"
            : candidate.type === "scene"
              ? "scenes"
              : candidate.type === "prop"
                ? "assets"
                : "adaptations";
        const entityId = insertDomainEntity(
          domain,
          String(current.project_id),
          undefined,
          candidate.title,
          {
            来源变更集: id,
            候选类型: candidate.type,
            候选摘要: candidate.summary,
            来源片段: candidate.sourceRefs.map((ref) => ({
              章节: ref.chapterTitle,
              范围: `${ref.start}-${ref.end}`,
              摘录: ref.excerpt,
            })),
            置信度: candidate.confidence,
            ...(candidate.type === "prop" ? { 素材类型: "原稿道具草案" } : {}),
            ...(candidate.type === "adaptation"
              ? { 改编方向: candidate.summary }
              : {}),
          },
        );
        createdIds.push(entityId);
        adoptions.push({
          kind: "entity",
          candidateId: candidate.id,
          entityId,
          expectedVersion: 0,
        });
      }
      candidate.status = "adopted";
      delete candidate.conflictNote;
    }
    db!
      .prepare(
        `UPDATE import_extraction_change_sets SET
          status = 'applied', candidates_json = ?, created_entity_ids_json = ?, adoption_json = ?,
          error_message = NULL, applied_at = COALESCE(applied_at, ?), updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({ items: candidates }),
        JSON.stringify(createdIds),
        JSON.stringify({ items: adoptions }),
        now,
        now,
        id,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    return respondError(
      res,
      409,
      "CONFLICT",
      error instanceof Error
        ? error.message
        : "Unable to adopt import candidates",
      requestId,
    );
  }
  const updated = importExtractionChangeSet(
    one("SELECT * FROM import_extraction_change_sets WHERE id = ?", [id])!,
  );
  emit("import_extraction.adopted", updated);
  json(res, 200, updated);
}

function importExtractionAdoptions(value: unknown): ImportExtractionAdoption[] {
  const payload = domainPayload(value);
  const values = Array.isArray(payload.items) ? payload.items : [];
  return values.flatMap((value): ImportExtractionAdoption[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (
      item.kind === "entity" &&
      typeof item.candidateId === "string" &&
      typeof item.entityId === "string" &&
      Number.isInteger(item.expectedVersion)
    )
      return [
        {
          kind: "entity",
          candidateId: item.candidateId,
          entityId: item.entityId,
          expectedVersion: Number(item.expectedVersion),
        },
      ];
    if (
      item.kind === "chapter-summary" &&
      typeof item.candidateId === "string" &&
      typeof item.chapterId === "string" &&
      typeof item.previousSummary === "string" &&
      typeof item.appliedSummary === "string" &&
      Number.isInteger(item.appliedVersion)
    )
      return [
        {
          kind: "chapter-summary",
          candidateId: item.candidateId,
          chapterId: item.chapterId,
          previousSummary: item.previousSummary,
          appliedSummary: item.appliedSummary,
          appliedVersion: Number(item.appliedVersion),
        },
      ];
    return [];
  });
}

function undoImportExtractionChangeSet(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one(
    "SELECT * FROM import_extraction_change_sets WHERE id = ?",
    [id],
  );
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Import extraction change set not found",
      requestId,
    );
  if (!["applied", "stale"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Only adopted change sets can be undone",
      requestId,
    );
  const candidates = importExtractionCandidates(current.candidates_json);
  const adoptions = importExtractionAdoptions(current.adoption_json);
  const remaining: ImportExtractionAdoption[] = [];
  const protectedCandidateIds = new Set<string>();
  const now = timestamp();
  try {
    db!.exec("BEGIN IMMEDIATE");
    for (const adoption of adoptions) {
      if (adoption.kind === "entity") {
        const entity = one("SELECT * FROM domain_entities WHERE id = ?", [
          adoption.entityId,
        ]);
        const payload = entity ? domainPayload(entity.payload_json) : {};
        if (
          !entity ||
          Number(entity.version) !== adoption.expectedVersion ||
          payload["来源变更集"] !== id
        ) {
          remaining.push(adoption);
          protectedCandidateIds.add(adoption.candidateId);
          continue;
        }
        db!
          .prepare("DELETE FROM domain_entities WHERE id = ?")
          .run(adoption.entityId);
      } else {
        const chapter = one("SELECT * FROM chapters WHERE id = ?", [
          adoption.chapterId,
        ]);
        if (
          !chapter ||
          Number(chapter.version) !== adoption.appliedVersion ||
          String(chapter.summary ?? "") !== adoption.appliedSummary
        ) {
          remaining.push(adoption);
          protectedCandidateIds.add(adoption.candidateId);
          continue;
        }
        db!
          .prepare(
            "UPDATE chapters SET summary = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
          )
          .run(
            adoption.previousSummary,
            now,
            adoption.chapterId,
            adoption.appliedVersion,
          );
      }
    }
    for (const candidate of candidates) {
      if (protectedCandidateIds.has(candidate.id)) {
        candidate.status = "conflict";
        candidate.conflictNote =
          "该采用结果已被人工修改；撤销不会覆盖人工内容。";
      }
    }
    const completed = remaining.length === 0;
    db!
      .prepare(
        `UPDATE import_extraction_change_sets SET
          status = ?, candidates_json = ?, created_entity_ids_json = ?, adoption_json = ?,
          error_message = ?, undone_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        completed ? "discarded" : "stale",
        JSON.stringify({ items: candidates }),
        JSON.stringify(
          remaining
            .filter(
              (
                item,
              ): item is Extract<
                ImportExtractionAdoption,
                { kind: "entity" }
              > => item.kind === "entity",
            )
            .map((item) => item.entityId),
        ),
        JSON.stringify({ items: remaining }),
        completed ? null : "部分采用结果已被人工修改，已保留且可继续处理。",
        completed ? now : null,
        now,
        id,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    return respondError(
      res,
      500,
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to undo import candidates",
      requestId,
    );
  }
  const updated = importExtractionChangeSet(
    one("SELECT * FROM import_extraction_change_sets WHERE id = ?", [id])!,
  );
  emit("import_extraction.undone", updated);
  json(res, 200, updated);
}

type PilotChapterVersion = { id: string; version: number; contentHash: string };

function pilotChapterVersions(
  row: Record<string, unknown>,
): PilotChapterVersion[] {
  const payload = domainPayload(row.chapter_versions_json);
  const values = Array.isArray(payload.items) ? payload.items : [];
  return values.flatMap((value): PilotChapterVersion[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !Number.isInteger(item.version) ||
      typeof item.contentHash !== "string"
    )
      return [];
    return [
      {
        id: item.id,
        version: Number(item.version),
        contentHash: item.contentHash,
      },
    ];
  });
}

function pilotPlanStaleReason(
  row: Record<string, unknown>,
): string | undefined {
  const versions = pilotChapterVersions(row);
  if (!versions.length) return "试制来源记录不完整，请重新确认来源。";
  for (const source of versions) {
    const chapter = one("SELECT version, content FROM chapters WHERE id = ?", [
      source.id,
    ]);
    if (
      !chapter ||
      Number(chapter.version) !== source.version ||
      storyBibleSourceHash(String(chapter.content ?? "")) !== source.contentHash
    )
      return "试制来源章节已更新，请重新确认后继续。";
  }
  return undefined;
}

function pilotPlan(row: Record<string, unknown>): PilotPlan {
  const chapterIds = jsonStringArray(row.chapter_ids_json);
  const episodeIds = jsonStringArray(row.episode_ids_json);
  const episodeRows = episodeIds.length
    ? rows(
        `SELECT * FROM domain_entities WHERE domain = 'episodes' AND project_id = ? AND id IN (${episodeIds.map(() => "?").join(",")})`,
        [row.project_id, ...episodeIds],
      )
    : [];
  const actualEpisodeIds = episodeRows.map((item) => String(item.id));
  const scriptRows = actualEpisodeIds.length
    ? rows(
        `SELECT * FROM domain_entities WHERE domain = 'scripts' AND project_id = ? AND parent_id IN (${actualEpisodeIds.map(() => "?").join(",")})`,
        [row.project_id, ...actualEpisodeIds],
      )
    : [];
  const scriptIds = scriptRows.map((item) => String(item.id));
  const sceneRows = scriptIds.length
    ? rows(
        `SELECT * FROM domain_entities WHERE domain = 'scenes' AND project_id = ? AND parent_id IN (${scriptIds.map(() => "?").join(",")})`,
        [row.project_id, ...scriptIds],
      )
    : [];
  const sceneIds = sceneRows.map((item) => String(item.id));
  const shotCount = sceneIds.length
    ? Number(
        one(
          `SELECT count(*) AS count FROM domain_entities WHERE domain = 'shots' AND project_id = ? AND parent_id IN (${sceneIds.map(() => "?").join(",")})`,
          [row.project_id, ...sceneIds],
        )?.count ?? 0,
      )
    : 0;
  const coverage = {
    episodes: actualEpisodeIds.length,
    scripts: scriptRows.length,
    scenes: sceneRows.length,
    shots: shotCount,
    assets: Number(
      one(
        "SELECT count(*) AS count FROM domain_entities WHERE domain IN ('assets', 'visual-assets') AND project_id = ?",
        [row.project_id],
      )?.count ?? 0,
    ),
  };
  const staleReason =
    Number(row.source_confirmed) === 1 ? pilotPlanStaleReason(row) : undefined;
  const canceled = String(row.status) === "canceled";
  const sourceConfirmed = Number(row.source_confirmed) === 1;
  const target = Number(row.episode_count);
  const stage: PilotPlan["stage"] =
    !sourceConfirmed || staleReason || canceled
      ? "confirm-source"
      : coverage.scripts < target
        ? "script"
        : !coverage.scenes
          ? "scenes"
          : !coverage.shots
            ? "shots"
            : !coverage.assets
              ? "assets"
              : "review";
  const status: PilotPlan["status"] = canceled
    ? "canceled"
    : staleReason
      ? "stale"
      : stage === "review"
        ? "ready-for-review"
        : sourceConfirmed
          ? "active"
          : "draft";
  const blockers: Partial<Record<PilotPlan["stage"], string>> = {
    "confirm-source":
      staleReason ??
      (canceled
        ? "试制已取消，可恢复后重新确认来源。"
        : "等待人工确认试制来源。"),
    script: "每个试制分集都需要先采用剧本。",
    scenes: "已采用剧本需要拆分为可制作场景。",
    shots: "已采用场景需要建立分镜。",
    assets: "制作前需至少归档一项视觉或道具资产。",
  };
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterIds,
    episodeCount: target,
    status,
    stage,
    sourceConfirmed,
    ...(row.adaptation_id ? { adaptationId: String(row.adaptation_id) } : {}),
    episodeIds: actualEpisodeIds,
    coverage,
    ...(blockers[stage] ? { blocker: blockers[stage] } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function listPilotPlans(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM pilot_plans WHERE project_id = ? ORDER BY updated_at DESC",
      [projectId],
    ).map(pilotPlan),
  );
}

async function createPilotPlan(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const chapterIds = Array.isArray(input.chapterIds)
    ? [
        ...new Set(
          input.chapterIds.filter(
            (item): item is string => typeof item === "string",
          ),
        ),
      ]
    : [];
  const episodeCount = Number(input.episodeCount);
  if (
    !projectId ||
    !chapterIds.length ||
    chapterIds.length > 3 ||
    !Number.isInteger(episodeCount) ||
    episodeCount < 1 ||
    episodeCount > 3 ||
    episodeCount > chapterIds.length
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Choose one to three source chapters and pilot episodes",
      requestId,
    );
  const chapterRows = rows(
    `SELECT * FROM chapters WHERE project_id = ? AND id IN (${chapterIds.map(() => "?").join(",")})`,
    [projectId, ...chapterIds],
  );
  if (chapterRows.length !== chapterIds.length)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "One or more source chapters were not found",
      requestId,
    );
  const duplicate = one(
    "SELECT * FROM pilot_plans WHERE project_id = ? AND chapter_ids_json = ? AND episode_count = ? AND status != 'canceled' ORDER BY updated_at DESC LIMIT 1",
    [projectId, JSON.stringify(chapterIds), episodeCount],
  );
  if (duplicate) return json(res, 200, pilotPlan(duplicate));
  const now = timestamp();
  const id = randomUUID();
  const versions = chapterRows.map((chapter) => ({
    id: String(chapter.id),
    version: Number(chapter.version),
    contentHash: storyBibleSourceHash(String(chapter.content ?? "")),
  }));
  db!
    .prepare(
      `INSERT INTO pilot_plans(id, project_id, chapter_ids_json, chapter_versions_json, episode_count, status, source_confirmed, adaptation_id, episode_ids_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', 0, NULL, '[]', NULL, ?, ?)`,
    )
    .run(
      id,
      projectId,
      JSON.stringify(chapterIds),
      JSON.stringify({ items: versions }),
      episodeCount,
      now,
      now,
    );
  const created = pilotPlan(
    one("SELECT * FROM pilot_plans WHERE id = ?", [id])!,
  );
  emit("pilot_plan.created", created);
  json(res, 201, created);
}

async function updatePilotPlanAction(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one("SELECT * FROM pilot_plans WHERE id = ?", [id]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Pilot plan not found",
      requestId,
    );
  const input = await body(req);
  const action = text(input.action);
  if (
    !action ||
    !["confirm-source", "return-source", "cancel", "resume"].includes(action)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid pilot plan action",
      requestId,
    );
  const now = timestamp();
  if (action === "cancel") {
    db!
      .prepare(
        "UPDATE pilot_plans SET status = 'canceled', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
  } else if (action === "return-source") {
    db!
      .prepare(
        "UPDATE pilot_plans SET source_confirmed = 0, status = 'draft', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
  } else if (action === "resume") {
    const chapterIds = jsonStringArray(current.chapter_ids_json);
    const chapters = rows(
      `SELECT * FROM chapters WHERE project_id = ? AND id IN (${chapterIds.map(() => "?").join(",")})`,
      [current.project_id, ...chapterIds],
    );
    if (chapters.length !== chapterIds.length)
      return respondError(
        res,
        409,
        "CONFLICT",
        "Pilot source is no longer available",
        requestId,
      );
    const versions = chapters.map((chapter) => ({
      id: String(chapter.id),
      version: Number(chapter.version),
      contentHash: storyBibleSourceHash(String(chapter.content ?? "")),
    }));
    db!
      .prepare(
        "UPDATE pilot_plans SET status = 'draft', source_confirmed = 0, chapter_versions_json = ?, error_message = NULL, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify({ items: versions }), now, id);
  } else {
    const stale = pilotPlanStaleReason(current);
    if (stale) return respondError(res, 409, "CONFLICT", stale, requestId);
    const existing = pilotPlan(current);
    if (!existing.sourceConfirmed) {
      const chapters = rows(
        `SELECT * FROM chapters WHERE id IN (${existing.chapterIds.map(() => "?").join(",")}) ORDER BY order_index`,
        existing.chapterIds,
      );
      try {
        db!.exec("BEGIN IMMEDIATE");
        let adaptationId = current.adaptation_id
          ? String(current.adaptation_id)
          : undefined;
        if (!adaptationId)
          adaptationId = insertDomainEntity(
            "adaptations",
            String(current.project_id),
            undefined,
            "试制改编方案",
            {
              改编方向: "1–3 集试制",
              目标集数: Number(current.episode_count),
              来源: "试制向导人工确认",
            },
          );
        const episodeIds = jsonStringArray(current.episode_ids_json);
        while (episodeIds.length < Number(current.episode_count)) {
          const source = chapters[episodeIds.length % chapters.length];
          episodeIds.push(
            insertDomainEntity(
              "episodes",
              String(current.project_id),
              adaptationId,
              `试制第 ${episodeIds.length + 1} 集·${String(source.title)}`,
              {
                集数: episodeIds.length + 1,
                分集简介: String(source.summary || source.content).slice(
                  0,
                  240,
                ),
                试制来源章节: String(source.title),
                审阅状态: "待采用剧本",
              },
            ),
          );
        }
        db!
          .prepare(
            "UPDATE pilot_plans SET status = 'active', source_confirmed = 1, adaptation_id = ?, episode_ids_json = ?, error_message = NULL, updated_at = ? WHERE id = ?",
          )
          .run(adaptationId, JSON.stringify(episodeIds), now, id);
        db!.exec("COMMIT");
      } catch (error) {
        try {
          db!.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    }
  }
  const updated = pilotPlan(
    one("SELECT * FROM pilot_plans WHERE id = ?", [id])!,
  );
  emit("pilot_plan.updated", updated);
  json(res, 200, updated);
}

function safeFileName(value: string): string {
  return (
    basename(value)
      .replace(/[^\p{L}\p{N}._-]/gu, "_")
      .slice(0, 160) || "source"
  );
}

function parseSourceImportBuffer(
  fileName: string,
  buffer: Buffer,
): SourceImportPreview {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".docx") return parseDocxImport(fileName, buffer);
  if (extension === ".epub") return parseEpubImport(fileName, buffer);
  const content = assertSourceImportLimit(
    normalizeSourceText(decodeSourceText(buffer)),
  );
  if (extension === ".json")
    return parseStructuredScriptImport(fileName, content);
  if ([".txt", ".md", ".markdown"].includes(extension))
    return parseTextImport(fileName, content, extension);
  throw new Error(
    `Unsupported source import format: ${extension || "no extension"}`,
  );
}

function parseTextImport(
  fileName: string,
  content: string,
  extension: string,
): SourceImportPreview {
  const episodes = parseMarkdownEpisodes(content);
  if (episodes)
    return {
      fileName,
      sourceType: "markdown",
      contentKind: "script",
      title: sourceDocumentTitle(fileName, content),
      charCount: content.length,
      chapters: [],
      episodes,
      warnings: [],
    };
  const parsed = parseNovelImportChapters(content);
  return {
    fileName,
    sourceType: extension === ".txt" ? "txt" : "markdown",
    contentKind: parsed.detected ? "novel" : "draft",
    title: sourceDocumentTitle(fileName, content),
    charCount: content.length,
    chapters: parsed.chapters,
    episodes: [],
    warnings: parsed.warnings,
  };
}

function parseDocxImport(
  fileName: string,
  buffer: Buffer,
): SourceImportPreview {
  const entry = readZipImportEntry(buffer, "word/document.xml");
  if (!entry) throw new Error("Word document body cannot be read");
  const content = assertSourceImportLimit(
    normalizeSourceText(extractDocxImportText(entry.toString("utf-8"))),
  );
  const parsed = parseNovelImportChapters(content);
  return {
    fileName,
    sourceType: "docx",
    contentKind: parsed.detected ? "novel" : "draft",
    title: sourceDocumentTitle(fileName, content),
    charCount: content.length,
    chapters: parsed.chapters,
    episodes: [],
    warnings: parsed.warnings,
  };
}

function parseEpubImport(
  fileName: string,
  buffer: Buffer,
): SourceImportPreview {
  const container = readZipImportEntry(buffer, "META-INF/container.xml");
  if (!container) throw new Error("EPUB container cannot be read");
  const rootPath = /full-path=["']([^"']+)["']/i.exec(
    container.toString("utf-8"),
  )?.[1];
  if (!rootPath) throw new Error("EPUB package manifest is missing");
  const opf = readZipImportEntry(buffer, rootPath);
  if (!opf) throw new Error("EPUB package manifest cannot be read");
  const opfText = opf.toString("utf-8");
  const manifest = new Map<string, string>();
  for (const match of opfText.matchAll(/<item\b([^>]+)>/gi)) {
    const key = zipAttribute(match[1], "id");
    const href = zipAttribute(match[1], "href");
    if (key && href) manifest.set(key, zipResolvePath(dirname(rootPath), href));
  }
  const spine = [...opfText.matchAll(/<itemref\b([^>]+)>/gi)]
    .map((match) => zipAttribute(match[1], "idref"))
    .filter((key): key is string => Boolean(key));
  const chapters: SourceImportChapter[] = [];
  const warnings: string[] = [];
  for (const key of spine) {
    const entryPath = manifest.get(key);
    const entry = entryPath ? readZipImportEntry(buffer, entryPath) : undefined;
    if (!entry) {
      warnings.push(`EPUB section ${key} could not be read and was skipped.`);
      continue;
    }
    const document = entry.toString("utf-8");
    const content = normalizeSourceText(extractHtmlImportText(document));
    if (!content) continue;
    const heading = decodeImportXml(
      /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(document)?.[1] ?? "",
    );
    chapters.push(
      createImportedChapter(
        chapters.length,
        heading || `第${chapters.length + 1}章`,
        content,
      ),
    );
  }
  if (!chapters.length) throw new Error("EPUB has no readable body content");
  assertSourceImportLimit(
    chapters.map((chapter) => chapter.content).join("\n"),
  );
  addLongImportWarnings(chapters, warnings);
  return {
    fileName,
    sourceType: "epub",
    contentKind: "novel",
    title:
      decodeImportXml(
        /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfText)?.[1] ?? "",
      ) || sourceNameWithoutExtension(fileName),
    charCount: chapters.reduce(
      (total, chapter) => total + chapter.content.length,
      0,
    ),
    chapters,
    episodes: [],
    warnings,
  };
}

function parseStructuredScriptImport(
  fileName: string,
  content: string,
): SourceImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return sourceDraftPreview(
      fileName,
      content,
      "JSON was not a recognized script exchange document; it was imported as a draft.",
    );
  }
  const record = asImportRecord(parsed);
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.episodes)
      ? record.episodes
      : Array.isArray(record?.scripts)
        ? record.scripts
        : undefined;
  if (!source)
    return sourceDraftPreview(
      fileName,
      content,
      "JSON has no episodes or scripts list; it was imported as a draft.",
    );
  const episodes = source.map((item, index) =>
    parseImportedEpisode(item, index),
  );
  if (!episodes.length)
    throw new Error("Script exchange document has no episodes");
  return {
    fileName,
    sourceType: "script-json",
    contentKind: "script",
    title: importString(record?.title) ?? sourceNameWithoutExtension(fileName),
    charCount: content.length,
    chapters: [],
    episodes,
    warnings: [],
  };
}

function parseMarkdownEpisodes(
  content: string,
): SourceImportEpisode[] | undefined {
  const lines = content.split("\n");
  const markers = lines
    .map((line, index) => ({
      index,
      match:
        /^(?:#{1,6}\s*)?(?:第\s*([0-9一二三四五六七八九十百零〇两]+)\s*集|episode\s*(\d+))\s*[:：\-—]?(.*)$/i.exec(
          line.trim(),
        ),
    }))
    .filter((item): item is { index: number; match: RegExpExecArray } =>
      Boolean(item.match),
    );
  if (!markers.length) return undefined;
  return markers.map(({ index, match }, episodeIndex) => {
    const end = markers[episodeIndex + 1]?.index ?? lines.length;
    const episodeNumber =
      importChineseNumber(match[1]) ?? (Number(match[2]) || episodeIndex + 1);
    const title = match[3]?.trim() || `第${episodeNumber}集`;
    const body = lines
      .slice(index + 1, end)
      .join("\n")
      .trim();
    return {
      key: `episode-${episodeIndex}`,
      episodeNumber,
      title,
      content: body || title,
      scenes: parseMarkdownScenes(body),
    };
  });
}

function parseMarkdownScenes(content: string): SourceImportScene[] {
  const lines = content.split("\n");
  const markers = lines
    .map((line, index) => ({
      index,
      match:
        /^(?:#{1,6}\s*)?(?:场景|scene)\s*([0-9一二三四五六七八九十百零〇两]+)?\s*[:：\-—｜|]?\s*(.*)$/i.exec(
          line.trim(),
        ),
    }))
    .filter((item): item is { index: number; match: RegExpExecArray } =>
      Boolean(item.match),
    );
  return markers.map(({ index, match }, sceneIndex) => {
    const end = markers[sceneIndex + 1]?.index ?? lines.length;
    const content = lines
      .slice(index + 1, end)
      .join("\n")
      .trim();
    const label = match[2]?.trim() || `场景 ${sceneIndex + 1}`;
    const [location, timeOfDay] = label
      .split(/[，,｜|]/)
      .map((part) => part.trim());
    return createImportedScene(
      sceneIndex,
      label,
      location || "待补充",
      timeOfDay,
      content,
    );
  });
}

function parseImportedEpisode(
  value: unknown,
  index: number,
): SourceImportEpisode {
  const episode = asImportRecord(value);
  if (!episode) throw new Error(`Script episode ${index + 1} is invalid`);
  const episodeNumber =
    importPositiveNumber(episode.episodeNumber) ??
    importPositiveNumber(episode.number) ??
    index + 1;
  const title = importString(episode.title) ?? `第${episodeNumber}集`;
  const scenes = Array.isArray(episode.scenes)
    ? episode.scenes.map((scene, sceneIndex) =>
        parseImportedScene(scene, sceneIndex),
      )
    : [];
  const content =
    importString(episode.content) ??
    importString(episode.script) ??
    renderImportedEpisode(title, scenes);
  if (!content && !scenes.length)
    throw new Error(`Script episode ${episodeNumber} has no content`);
  return { key: `episode-${index}`, episodeNumber, title, content, scenes };
}

function parseImportedScene(value: unknown, index: number): SourceImportScene {
  const scene = asImportRecord(value);
  if (!scene) throw new Error(`Script scene ${index + 1} is invalid`);
  const title = importString(scene.title) ?? `场景 ${index + 1}`;
  const location = importString(scene.location) ?? "待补充";
  const content =
    importString(scene.content) ??
    importString(scene.script) ??
    importString(scene.summary) ??
    "";
  const characters = Array.isArray(scene.characters)
    ? scene.characters.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
  return {
    ...createImportedScene(
      index,
      title,
      location,
      importString(scene.timeOfDay),
      content,
    ),
    visualDescription:
      importString(scene.visualDescription) ?? importString(scene.visual) ?? "",
    characters,
    summary: importString(scene.summary) ?? content.slice(0, 240),
  };
}

function parseNovelImportChapters(content: string): {
  chapters: SourceImportChapter[];
  warnings: string[];
  detected: boolean;
} {
  const lines = content.split("\n");
  const markers = lines
    .map((line, index) => ({ index, title: importedChapterHeading(line) }))
    .filter((item): item is { index: number; title: string } =>
      Boolean(item.title),
    );
  const warnings: string[] = [];
  if (!markers.length) {
    if (!content.trim())
      return {
        chapters: [],
        warnings: ["No readable text was found."],
        detected: false,
      };
    const chapters = [createImportedChapter(0, "草稿文本", content)];
    addLongImportWarnings(chapters, warnings);
    warnings.unshift(
      "No chapter boundaries were detected; the text is imported as one draft.",
    );
    return { chapters, warnings, detected: false };
  }
  const chapters: SourceImportChapter[] = [];
  const preface = lines.slice(0, markers[0].index).join("\n").trim();
  if (preface)
    chapters.push(createImportedChapter(chapters.length, "前言", preface));
  markers.forEach((marker, index) => {
    const end = markers[index + 1]?.index ?? lines.length;
    const body = lines
      .slice(marker.index + 1, end)
      .join("\n")
      .trim();
    if (!body) {
      warnings.push(`Empty chapter ${marker.title} was skipped.`);
      return;
    }
    chapters.push(createImportedChapter(chapters.length, marker.title, body));
  });
  if (!chapters.length) throw new Error("All detected chapters were empty");
  addLongImportWarnings(chapters, warnings);
  return { chapters, warnings, detected: true };
}

function normalizeSourceImportPreview(
  value: SourceImportPreview,
): SourceImportPreview {
  const chapters = Array.isArray(value.chapters)
    ? value.chapters
        .map((chapter, index) =>
          createImportedChapter(
            index,
            String(chapter.title ?? ""),
            normalizeSourceText(String(chapter.content ?? "")),
          ),
        )
        .filter((chapter) => Boolean(chapter.content))
    : [];
  const episodes = Array.isArray(value.episodes)
    ? value.episodes
        .map((episode, index) => {
          const source = episode as Partial<SourceImportEpisode>;
          const scenes = Array.isArray(source.scenes)
            ? source.scenes
                .map((scene, sceneIndex) => {
                  const item = scene as Partial<SourceImportScene>;
                  return createImportedScene(
                    sceneIndex,
                    String(item.title ?? ""),
                    String(item.location ?? "待补充"),
                    item.timeOfDay ? String(item.timeOfDay) : undefined,
                    normalizeSourceText(String(item.content ?? "")),
                  );
                })
                .filter((scene) => Boolean(scene.content))
            : [];
          const episodeNumber =
            importPositiveNumber(source.episodeNumber) ?? index + 1;
          return {
            key: `episode-${index}`,
            episodeNumber,
            title: String(source.title ?? "").trim() || `第${episodeNumber}集`,
            content: normalizeSourceText(String(source.content ?? "")),
            scenes,
          };
        })
        .filter((episode) => Boolean(episode.content) || episode.scenes.length)
    : [];
  const charCount =
    chapters.reduce((total, chapter) => total + chapter.content.length, 0) +
    episodes.reduce((total, episode) => total + episode.content.length, 0);
  if (charCount > MAX_SOURCE_IMPORT_CHARS)
    throw new Error("Source import text exceeds the supported limit");
  return {
    fileName: String(value.fileName ?? "未命名导入"),
    sourceType: value.sourceType,
    contentKind: value.contentKind,
    title: String(value.title ?? "未命名导入").trim() || "未命名导入",
    charCount,
    chapters,
    episodes,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.map(String).slice(0, 50)
      : [],
  };
}

function sourceDraftPreview(
  fileName: string,
  content: string,
  warning: string,
): SourceImportPreview {
  if (!content.trim()) throw new Error("Source file has no readable content");
  return {
    fileName,
    sourceType: "draft",
    contentKind: "draft",
    title: sourceNameWithoutExtension(fileName),
    charCount: content.length,
    chapters: [createImportedChapter(0, "草稿文本", content)],
    episodes: [],
    warnings: [warning],
  };
}

function createImportedChapter(
  index: number,
  title: string,
  content: string,
): SourceImportChapter {
  const cleaned = content.trim();
  return {
    key: `chapter-${index}`,
    title: title.trim() || `第${index + 1}章`,
    content: cleaned,
    orderIndex: index,
    wordCount: [...cleaned.replace(/\s/g, "")].length,
  };
}

function createImportedScene(
  index: number,
  title: string,
  location: string,
  timeOfDay: string | undefined,
  content: string,
): SourceImportScene {
  const cleaned = content.trim();
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    key: `scene-${index}`,
    title: title.trim() || `场景 ${index + 1}`,
    location: location.trim() || "待补充",
    ...(timeOfDay?.trim() ? { timeOfDay: timeOfDay.trim() } : {}),
    visualDescription: "",
    characters: [],
    summary: cleaned.slice(0, 240),
    content: cleaned,
    orderIndex: index,
    dialogueCount: lines.filter((line) => /^[^：:]{1,24}[：:]/.test(line))
      .length,
    actionCount: lines.filter((line) =>
      ["（", "(", "【", "["].some((mark) => line.startsWith(mark)),
    ).length,
  };
}

function renderImportedEpisode(
  title: string,
  scenes: SourceImportScene[],
): string {
  return [
    title,
    ...scenes.map((scene) => `## ${scene.title}\n${scene.content}`),
  ]
    .join("\n\n")
    .trim();
}

function addLongImportWarnings(
  chapters: SourceImportChapter[],
  warnings: string[],
): void {
  for (const chapter of chapters) {
    if (chapter.content.length > 25_000) {
      chapter.warning = `本章 ${chapter.wordCount.toLocaleString("zh-CN")} 字，建议拆分后再进入改编。`;
      warnings.push(`「${chapter.title}」正文较长，已完整保留。`);
    }
  }
}

function decodeSourceText(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    return buffer.subarray(3).toString("utf8");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])))
    return buffer.subarray(2).toString("utf16le");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function extractDocxImportText(xml: string): string {
  const output: string[] = [];
  const expression =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g;
  let next: RegExpExecArray | null;
  while ((next = expression.exec(xml))) {
    if (next[1] !== undefined) output.push(decodeImportXml(next[1]));
    else if (next[0].startsWith("<w:tab")) output.push("\t");
    else output.push("\n");
  }
  return output.join("");
}

function extractHtmlImportText(html: string): string {
  return decodeImportXml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:p|div|h[1-6]|li|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function readZipImportEntry(
  buffer: Buffer,
  fileName: string,
): Buffer | undefined {
  const end = findZipImportEnd(buffer);
  if (end < 0) return undefined;
  const offsetStart = buffer.readUInt32LE(end + 16);
  const entries = buffer.readUInt16LE(end + 10);
  let offset = offsetStart;
  for (let index = 0; index < entries; index += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    )
      return undefined;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf-8");
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES)
      throw new Error("Compressed source document contains an oversized entry");
    if (name === fileName) {
      if (
        localOffset + 30 > buffer.length ||
        buffer.readUInt32LE(localOffset) !== 0x04034b50
      )
        return undefined;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) return undefined;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(compressed);
      if (method === 8)
        return inflateRawSync(compressed, {
          maxOutputLength: MAX_ZIP_ENTRY_BYTES,
        });
      throw new Error(
        "Compressed source document uses an unsupported compression method",
      );
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

function findZipImportEnd(buffer: Buffer): number {
  if (buffer.length < 22) return -1;
  const start = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= start; index -= 1)
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  return -1;
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u0000", "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertSourceImportLimit(value: string): string {
  if (value.length > MAX_SOURCE_IMPORT_CHARS)
    throw new Error("Source import text exceeds the supported limit");
  return value;
}

function sourceDocumentTitle(fileName: string, content: string): string {
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+\S/.test(line));
  return (
    heading?.replace(/^#\s+/, "").trim() || sourceNameWithoutExtension(fileName)
  );
}

function sourceNameWithoutExtension(fileName: string): string {
  return basename(fileName, extname(fileName)).trim() || "未命名导入";
}

function importedChapterHeading(line: string): string | undefined {
  const trimmed = line.trim();
  const markdown = /^(?:#{1,6}\s+)(.+)$/.exec(trimmed)?.[1]?.trim();
  const candidate = markdown ?? trimmed;
  return /^(?:第\s*[0-9一二三四五六七八九十百零〇两]+\s*[章节回]|chapter\s+[0-9ivxlcdm]+\b)/i.test(
    candidate,
  )
    ? candidate
    : undefined;
}

function asImportRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function importString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function importPositiveNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function importChineseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const table: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value.length === 1) return table[value];
  if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(value))
    return table[value[0]] * 10 + (value.length === 3 ? table[value[2]] : 0);
  return undefined;
}

function zipAttribute(fragment: string, name: string): string | undefined {
  return new RegExp(`${name}=["']([^"']+)["']`, "i").exec(fragment)?.[1];
}

function zipResolvePath(base: string, href: string): string {
  return posix
    .normalize(posix.join(base.replace(/\\/g, "/"), href.replace(/\\/g, "/")))
    .replace(/^\.\//, "");
}

function decodeImportXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, entity: string) =>
      String.fromCodePoint(
        entity.startsWith("x")
          ? Number.parseInt(entity.slice(1), 16)
          : Number(entity),
      ),
    );
}

async function runEpisodeWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = await body(req);
  const projectId = text(input.projectId);
  const episodeId = text(input.episodeId);
  const kind = text(input.kind) as EpisodeWorkflowKind | undefined;
  const supported: EpisodeWorkflowKind[] = [
    "quality-check",
    "compliance-check",
    "delivery-preflight",
    "render-preflight",
    "animatic-draft",
    "minimal-redo-plan",
    "review-package",
  ];
  if (!projectId || !episodeId || !kind || !supported.includes(kind))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid episode workflow input",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const episode = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [episodeId, "episodes", projectId],
  );
  if (!episode)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const taskId = randomUUID();
  const now = timestamp();
  const taskTitle = episodeWorkflowTitle(kind, String(episode.title));
  db!
    .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)")
    .run(
      taskId,
      kind,
      "running",
      taskTitle,
      0.1,
      projectId,
      JSON.stringify({ episodeId }),
      now,
      now,
    );
  emit(
    "task.created",
    task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
  );
  try {
    const context = episodeWorkflowContext(projectId, episodeId, episode);
    const outcome = executeEpisodeWorkflow(kind, context);
    const recordId = insertDomainEntity(
      outcome.domain,
      projectId,
      episodeId,
      outcome.title,
      outcome.payload,
    );
    const record = domainEntity(
      one("SELECT * FROM domain_entities WHERE id = ?", [recordId])!,
    );
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = ?, result_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        "succeeded",
        1,
        JSON.stringify({
          summary: outcome.summary,
          recordId,
          domain: outcome.domain,
        }),
        timestamp(),
        taskId,
      );
    recordGeneration({
      projectId,
      taskId,
      kind,
      title: taskTitle,
      status: "已完成",
      summary: outcome.summary,
    });
    const response = {
      task: task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
      record,
      summary: outcome.summary,
    };
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
      .run(idempotencyKey, JSON.stringify(response), timestamp());
    emit("task.updated", response.task);
    emit(`${outcome.domain}.created`, record);
    json(res, 201, response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Episode workflow failed";
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run("failed", errorMessage, timestamp(), taskId);
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
    throw error;
  }
}

/** Calls an approved image provider over HTTP; this process never runs image inference itself. */
async function runImageGeneration(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  approvedTaskId?: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "图片生成需要幂等键",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = (await body(req)) as Partial<ImageGenerationInput>;
  const providerId = text(input.providerId);
  const projectId = text(input.projectId);
  const shotId = text(input.shotId);
  const prompt = text(input.prompt);
  const kind = text(input.kind);
  if (
    !providerId ||
    !projectId ||
    !shotId ||
    !prompt ||
    !["still", "first_frame", "last_frame", "cover"].includes(kind ?? "")
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "图片生成请求不完整",
      requestId,
    );
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [shotId, "shots", projectId],
  );
  if (!shot)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "目标分镜不属于当前项目",
      requestId,
    );
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [providerId, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到图片服务商", requestId);
  const providerPayload = domainPayload(provider.payload_json);
  const baseUrl = text(providerPayload["服务地址"]);
  const credentialRef = text(providerPayload["凭据引用"]);
  const model = text(providerPayload["模型名称"]);
  const protocol = imageProviderProtocol(providerPayload);
  if (!baseUrl || (protocol === "openai" && (!credentialRef || !model)))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      protocol === "openai"
        ? "OpenAI 兼容图片服务需要服务地址、模型和凭据引用"
        : "Stable Diffusion 服务需要服务地址",
      requestId,
    );
  let endpoint: string;
  try {
    endpoint =
      protocol === "stable-diffusion-webui"
        ? stableDiffusionImageEndpoint(baseUrl)
        : openAiImageEndpoint(baseUrl);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "图片服务地址无效",
      requestId,
    );
  }
  const taskId = approvedTaskId ?? randomUUID();
  const now = timestamp();
  if (approvedTaskId) {
    db!
      .prepare(
        `UPDATE tasks
         SET kind = ?, status = 'running', title = ?, progress = ?, project_id = ?,
             result_json = ?, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        "image-generation",
        `图片生成 · ${String(shot.title)}`,
        0.1,
        projectId,
        JSON.stringify({ providerId, shotId, kind, prompt }),
        now,
        taskId,
      );
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
  } else {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        "image-generation",
        "running",
        `图片生成 · ${String(shot.title)}`,
        0.1,
        projectId,
        JSON.stringify({ providerId, shotId, kind, prompt }),
        now,
        now,
      );
    emit(
      "task.created",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
  }
  let secret: string | undefined;
  try {
    if (credentialRef) secret = await resolveCredential(credentialRef);
    if (protocol === "openai" && !secret)
      throw new Error("图片服务商凭据不可用");
    const size = text(input.size);
    const stableDiffusionSize =
      protocol === "stable-diffusion-webui"
        ? stableDiffusionImageSize(size)
        : undefined;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "DramaIP-Desktop/1.0",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(
        protocol === "stable-diffusion-webui"
          ? {
              prompt,
              ...(text(input.negativePrompt)
                ? { negative_prompt: text(input.negativePrompt) }
                : {}),
              width: stableDiffusionSize!.width,
              height: stableDiffusionSize!.height,
              ...(model
                ? { override_settings: { sd_model_checkpoint: model } }
                : {}),
            }
          : {
              model,
              prompt,
              ...(size ? { size } : {}),
              ...(text(input.quality) ? { quality: text(input.quality) } : {}),
              ...(text(input.outputFormat)
                ? { output_format: text(input.outputFormat) }
                : {}),
            },
      ),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    if (raw.length > 30_000_000)
      throw new Error("图片服务响应超过安全大小限制");
    if (!response.ok) throw new Error(`图片服务返回 HTTP ${response.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("图片服务未返回有效 JSON");
    }
    const data =
      parsed && typeof parsed === "object"
        ? protocol === "stable-diffusion-webui"
          ? (parsed as { images?: unknown }).images
          : (parsed as { data?: unknown }).data
        : undefined;
    if (!Array.isArray(data) || !data.length)
      throw new Error("图片服务未返回可归档的图片结果");
    const assets: unknown[] = [];
    const candidates: unknown[] = [];
    const outputFormat =
      protocol === "stable-diffusion-webui"
        ? "png"
        : text(input.outputFormat) === "jpeg"
          ? "jpg"
          : text(input.outputFormat) === "webp"
            ? "webp"
            : "png";
    for (const [index, result] of data.slice(0, 4).entries()) {
      const bytes = await imageResultBytes(result, outputFormat);
      const storedName = `generated/${taskId}-${index + 1}.${outputFormat}`;
      mkdirSync(join(command!.assetDirectory, "generated"), {
        recursive: true,
      });
      writeFileSync(join(command!.assetDirectory, storedName), bytes);
      const assetId = insertDomainEntity(
        "assets",
        projectId,
        undefined,
        `图片素材 · ${String(shot.title)} · ${index + 1}`,
        {
          素材类型: "AI 图片",
          来源: `${imageProviderProtocolLabel(protocol)}：${String(provider.title)}`,
          用途与备注: `分镜「${String(shot.title)}」的${imageKindLabel(kind!)}。`,
          生成任务标识: taskId,
          file: {
            name: `${imageKindLabel(kind!)}.${outputFormat}`,
            storedName,
          },
        },
      );
      const candidateId = insertDomainEntity(
        "shot-stills",
        projectId,
        shotId,
        `${imageKindLabel(kind!)} · ${index + 1}`,
        {
          关联分镜: shotId,
          生成提示: prompt,
          结果状态: "待采用",
          素材标识: assetId,
          file: {
            name: `${imageKindLabel(kind!)}.${outputFormat}`,
            storedName,
          },
        },
      );
      assets.push(
        domainEntity(
          one("SELECT * FROM domain_entities WHERE id = ?", [assetId])!,
        ),
      );
      candidates.push(
        domainEntity(
          one("SELECT * FROM domain_entities WHERE id = ?", [candidateId])!,
        ),
      );
    }
    const outcome = { assets, candidates };
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = ?, result_json = ?, updated_at = ? WHERE id = ?",
      )
      .run("succeeded", 1, JSON.stringify(outcome), timestamp(), taskId);
    const responseBody = {
      task: task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
      ...outcome,
    };
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
      .run(idempotencyKey, JSON.stringify(responseBody), timestamp());
    recordGeneration({
      projectId,
      taskId,
      kind: "图片生成",
      title: `图片生成 · ${String(shot.title)}`,
      status: "已完成",
      summary: `已归档 ${assets.length} 张候选图片，等待人工采用。`,
    });
    emit("task.updated", responseBody.task);
    emit("image-generation.completed", responseBody);
    json(res, 201, responseBody);
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 240)
        : "图片生成失败";
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run("failed", errorMessage, timestamp(), taskId);
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
    return respondError(res, 502, "INTERNAL_ERROR", errorMessage, requestId);
  } finally {
    secret = undefined;
  }
}

function openAiImageEndpoint(baseUrl: string): string {
  const source = new URL(baseUrl.trim());
  if (source.protocol !== "https:" && source.protocol !== "http:")
    throw new Error("图片服务地址必须使用 HTTP 或 HTTPS 协议");
  if (source.username || source.password)
    throw new Error("图片服务地址不能包含账号或密码");
  const path = source.pathname.replace(/\/+$/, "");
  source.pathname = path.endsWith("/images/generations")
    ? path
    : `${path || ""}/images/generations`;
  source.search = "";
  source.hash = "";
  return source.toString();
}

function imageProviderProtocol(
  payload: Record<string, unknown>,
): "openai" | "stable-diffusion-webui" {
  const value = text(payload["调用协议"])
    ?.toLowerCase()
    .replace(/[\s_]+/g, "-");
  return value === "stable-diffusion-webui" ||
    value === "stable-diffusion" ||
    value === "sd-webui" ||
    value === "sd"
    ? "stable-diffusion-webui"
    : "openai";
}

function imageProviderProtocolLabel(
  protocol: "openai" | "stable-diffusion-webui",
): string {
  return protocol === "stable-diffusion-webui"
    ? "Stable Diffusion WebUI 服务"
    : "图片服务商 API";
}

function stableDiffusionImageEndpoint(baseUrl: string): string {
  const source = new URL(baseUrl.trim());
  if (source.protocol !== "https:" && source.protocol !== "http:")
    throw new Error("Stable Diffusion 服务地址必须使用 HTTP 或 HTTPS 协议");
  if (source.username || source.password)
    throw new Error("Stable Diffusion 服务地址不能包含账号或密码");
  const path = source.pathname.replace(/\/+$/, "");
  source.pathname = path.endsWith("/sdapi/v1/txt2img")
    ? path
    : `${path || ""}/sdapi/v1/txt2img`;
  source.search = "";
  source.hash = "";
  return source.toString();
}

function stableDiffusionImageSize(value?: string): {
  width: number;
  height: number;
} {
  const match = value?.trim().match(/^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i);
  const width = Number(match?.[1] ?? 1024);
  const height = Number(match?.[2] ?? 1536);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 2048 ||
    height > 2048 ||
    width % 8 !== 0 ||
    height % 8 !== 0
  )
    throw new Error("Stable Diffusion 尺寸须为 64 到 2048 的 8 倍数");
  return { width, height };
}

async function imageResultBytes(
  result: unknown,
  extension: string,
): Promise<Buffer> {
  if (typeof result === "string")
    return imageResultBytes({ b64_json: result }, extension);
  if (!result || typeof result !== "object")
    throw new Error("图片结果格式无效");
  const record = result as Record<string, unknown>;
  if (typeof record.b64_json === "string") {
    const bytes = Buffer.from(record.b64_json, "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new Error("图片结果大小无效或超过 20 MB");
    return bytes;
  }
  const url = text(record.url);
  if (!url) throw new Error("图片结果缺少可归档数据");
  const source = new URL(url);
  if (
    !["https:", "http:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    isPrivateMediaHostname(source.hostname)
  )
    throw new Error("图片结果 URL 不安全，已拒绝归档");
  const response = await fetch(source, {
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: `image/${extension},image/*` },
  });
  if (!response.ok)
    throw new Error(`无法下载图片结果（HTTP ${response.status}）`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 20 * 1024 * 1024) throw new Error("图片结果超过 20 MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new Error("图片结果大小无效或超过 20 MB");
  return bytes;
}

function isPrivateMediaHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".local")
  );
}

function imageKindLabel(kind: string): string {
  return (
    { still: "静帧", first_frame: "首帧", last_frame: "尾帧", cover: "封面" }[
      kind
    ] ?? "图片"
  );
}

async function runTtsGeneration(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  approvedTaskId?: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "语音生成需要幂等键",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = (await body(req)) as Partial<TtsGenerationInput>;
  const providerId = text(input.providerId),
    projectId = text(input.projectId),
    episodeId = text(input.episodeId);
  const voice = text(input.voice),
    sourceText = text(input.input),
    kind = text(input.kind);
  if (
    !providerId ||
    !projectId ||
    !episodeId ||
    !voice ||
    !sourceText ||
    !["dialogue", "narration"].includes(kind ?? "")
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "语音生成请求不完整",
      requestId,
    );
  const context = episodeMediaContext(episodeId);
  if (!context || context.projectId !== projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "分集不属于当前项目",
      requestId,
    );
  const shotId = text(input.shotId);
  if (shotId && !context.shots.some((shot) => shot.id === shotId))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "目标分镜不属于当前分集",
      requestId,
    );
  const voiceProfileId = text(input.voiceProfileId);
  if (
    voiceProfileId &&
    !one("SELECT id FROM voice_profiles WHERE id = ? AND project_id = ?", [
      voiceProfileId,
      projectId,
    ])
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "音色档案不属于当前项目",
      requestId,
    );
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [providerId, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到语音服务商", requestId);
  const payload = domainPayload(provider.payload_json),
    baseUrl = text(payload["服务地址"]),
    credentialRef = text(payload["凭据引用"]),
    model = text(payload["模型名称"]);
  if (!baseUrl || !credentialRef || !model)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "语音服务商需要服务地址、模型和凭据引用",
      requestId,
    );
  let endpoint: string;
  try {
    endpoint = openAiTtsEndpoint(baseUrl);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "语音服务地址无效",
      requestId,
    );
  }
  const taskId = approvedTaskId ?? randomUUID(),
    now = timestamp();
  if (approvedTaskId) {
    db!
      .prepare(
        `UPDATE tasks
         SET kind = ?, status = 'running', title = ?, progress = ?, project_id = ?,
             result_json = ?, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        "tts-generation",
        `语音生成 · ${String(context.episode.title)}`,
        0.1,
        projectId,
        JSON.stringify({ providerId, episodeId, shotId, kind }),
        now,
        taskId,
      );
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
  } else {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        "tts-generation",
        "running",
        `语音生成 · ${String(context.episode.title)}`,
        0.1,
        projectId,
        JSON.stringify({ providerId, episodeId, shotId, kind }),
        now,
        now,
      );
    emit(
      "task.created",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
  }
  let secret: string | undefined;
  try {
    secret = await resolveCredential(credentialRef);
    if (!secret) throw new Error("语音服务商凭据不可用");
    const format = text(input.responseFormat) ?? "mp3";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "audio/*",
        "User-Agent": "DramaIP-Desktop/1.0",
      },
      body: JSON.stringify({
        model,
        input: sourceText,
        voice,
        ...(text(input.instructions)
          ? { instructions: text(input.instructions) }
          : {}),
        ...(typeof input.speed === "number" ? { speed: input.speed } : {}),
        response_format: format,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`语音服务返回 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 50 * 1024 * 1024)
      throw new Error("语音结果大小无效或超过 50 MB");
    const storedName = `generated/${taskId}.${format}`;
    mkdirSync(join(command!.assetDirectory, "generated"), { recursive: true });
    writeFileSync(join(command!.assetDirectory, storedName), bytes);
    const assetId = insertDomainEntity(
      "assets",
      projectId,
      episodeId,
      `${kind === "dialogue" ? "对白" : "旁白"}音频 · ${String(context.episode.title)}`,
      {
        素材类型: kind === "dialogue" ? "对白音频" : "旁白音频",
        来源: `语音服务商：${String(provider.title)}`,
        用途与备注: sourceText,
        生成任务标识: taskId,
        ...(shotId ? { 关联分镜: shotId } : {}),
        ...(voiceProfileId ? { 音色档案: voiceProfileId } : {}),
        file: { name: `语音.${format}`, storedName },
      },
    );
    const asset = domainEntity(
      one("SELECT * FROM domain_entities WHERE id = ?", [assetId])!,
    );
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = ?, result_json = ?, updated_at = ? WHERE id = ?",
      )
      .run("succeeded", 1, JSON.stringify({ assetId }), timestamp(), taskId);
    const responseBody = {
      task: task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
      asset,
    };
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
      .run(idempotencyKey, JSON.stringify(responseBody), timestamp());
    recordGeneration({
      projectId,
      taskId,
      kind: "语音生成",
      title: `语音生成 · ${String(context.episode.title)}`,
      status: "已完成",
      summary: "已归档语音素材，可绑定到音轨版本。",
    });
    emit("task.updated", responseBody.task);
    json(res, 201, responseBody);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message.slice(0, 240) : "语音生成失败";
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run("failed", errorMessage, timestamp(), taskId);
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
    return respondError(res, 502, "INTERNAL_ERROR", errorMessage, requestId);
  } finally {
    secret = undefined;
  }
}

function openAiTtsEndpoint(baseUrl: string): string {
  const source = new URL(baseUrl.trim());
  if (
    !["https:", "http:"].includes(source.protocol) ||
    source.username ||
    source.password
  )
    throw new Error("语音服务地址必须是无账号密码的 HTTP 或 HTTPS 地址");
  const path = source.pathname.replace(/\/+$/, "");
  source.pathname = path.endsWith("/audio/speech")
    ? path
    : `${path || ""}/audio/speech`;
  source.search = "";
  source.hash = "";
  return source.toString();
}

async function videoGenerationPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  shotId: string,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<VideoGenerationInput>;
  const providerId = text(input.providerId);
  const projectId = text(input.projectId);
  if (!providerId || !projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "视频预检需要服务商和项目。",
      requestId,
    );
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [shotId, "shots", projectId],
  );
  if (!shot)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "目标分镜不属于当前项目。",
      requestId,
    );
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [providerId, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到视频服务商", requestId);
  json(
    res,
    200,
    videoGenerationReadiness({ ...input, shotId }, shot, provider),
  );
}

async function videoGenerationBatchPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  requestId: string,
): Promise<void> {
  const input = (await body(
    req,
  )) as Partial<VideoGenerationBatchPreflightInput>;
  if (text(input.projectId) !== projectId || !Array.isArray(input.submissions))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "批量视频预检需要当前项目和提交列表。",
      requestId,
    );
  const items: VideoGenerationPreflight[] = [];
  const providerCounts = new Map<
    string,
    { provider: Record<string, any>; requested: number }
  >();
  for (const submission of input.submissions) {
    const shotId = text(submission.shotId);
    const providerId = text(submission.providerId);
    if (!shotId || !providerId)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "每个批量视频提交都需要分镜和服务商。",
        requestId,
      );
    const shot = one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
      [shotId, "shots", projectId],
    );
    const provider = one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
      [providerId, "providers"],
    );
    if (!shot || !provider)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "批量视频提交包含无效的分镜或服务商。",
        requestId,
      );
    items.push(videoGenerationReadiness(submission, shot, provider));
    const current = providerCounts.get(providerId);
    if (current) current.requested += 1;
    else providerCounts.set(providerId, { provider, requested: 1 });
  }
  for (const [providerId, item] of providerCounts) {
    const capacity = Number(
      domainPayload(item.provider.payload_json)["并发上限"],
    );
    if (!Number.isInteger(capacity) || capacity <= 0) continue;
    const active = Number(
      one(
        "SELECT count(*) AS count FROM video_generation_jobs WHERE provider_id = ? AND status IN ('queued', 'running')",
        [providerId],
      )?.count ?? 0,
    );
    if (active + item.requested <= capacity) continue;
    const message = `服务商「${String(item.provider.title)}」批量并发上限为 ${capacity}，当前 ${active} 个任务与本批 ${item.requested} 个提交会超限。`;
    for (let index = 0; index < items.length; index += 1) {
      if (items[index]?.providerId !== providerId) continue;
      const current = items[index]!;
      items[index] = {
        ...current,
        ready: false,
        blockers: [...current.blockers, message],
      };
    }
  }
  const knownEstimatedCost = items.reduce(
    (sum, item) => sum + (item.estimatedCost ?? 0),
    0,
  );
  const unknownCostCount = items.filter(
    (item) => item.costStatus === "unknown",
  ).length;
  const blockers = items.flatMap((item) =>
    item.blockers.map((blocker) => `分镜 ${item.shotId}：${blocker}`),
  );
  const result: VideoGenerationBatchPreflight = {
    projectId,
    ready: items.every((item) => item.ready),
    items,
    blockers,
    knownEstimatedCost,
    unknownCostCount,
  };
  json(res, 200, result);
}

async function createVideoGeneration(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  approvedTaskId?: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "视频生成需要幂等键",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = (await body(req)) as Partial<VideoGenerationInput>;
  const providerId = text(input.providerId),
    projectId = text(input.projectId),
    prompt = text(input.prompt),
    shotId = text(input.shotId),
    episodeId = text(input.episodeId);
  const parentTaskId = text((input as Record<string, unknown>).parentTaskId);
  if (!providerId || !projectId || !prompt || !shotId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "视频生成需要服务商、项目、分镜和提示",
      requestId,
    );
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [shotId, "shots", projectId],
  );
  if (!shot)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "目标分镜不属于当前项目",
      requestId,
    );
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [providerId, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到视频服务商", requestId);
  const readiness = videoGenerationReadiness(input, shot, provider);
  if (!readiness.ready)
    return respondError(
      res,
      409,
      "VIDEO_NOT_READY",
      "视频提交前置条件未满足。",
      requestId,
      { preflight: readiness },
    );
  if (input.readinessHash !== readiness.snapshotHash)
    return respondError(
      res,
      409,
      "CONFLICT",
      "视频预检快照已变化，请重新检查后再提交。",
      requestId,
      { preflight: readiness },
    );
  const payload = domainPayload(provider.payload_json),
    baseUrl = text(payload["服务地址"]),
    credentialRef = text(payload["凭据引用"]),
    model = text(payload["模型名称"]);
  if (!baseUrl || !credentialRef || !model)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "视频服务商需要服务地址、模型和凭据引用",
      requestId,
    );
  const context = episodeId ? episodeMediaContext(episodeId) : undefined;
  if (
    episodeId &&
    (!context ||
      context.projectId !== projectId ||
      !context.shots.some((item) => item.id === shotId))
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "分镜不属于指定分集",
      requestId,
    );
  const taskId = approvedTaskId ?? randomUUID(),
    jobId = randomUUID(),
    now = timestamp();
  if (approvedTaskId) {
    db!
      .prepare(
        `UPDATE tasks
         SET kind = ?, status = 'running', title = ?, progress = ?, project_id = ?,
             parent_task_id = ?, result_json = ?, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        "video-generation",
        `视频生成 · ${String(shot.title)}`,
        0.1,
        projectId,
        parentTaskId ?? null,
        JSON.stringify({ providerId, shotId, episodeId, prompt, readiness }),
        now,
        taskId,
      );
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
  } else {
    db!
      .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
      .run(
        taskId,
        "video-generation",
        "running",
        `视频生成 · ${String(shot.title)}`,
        0.1,
        projectId,
        parentTaskId ?? null,
        JSON.stringify({ providerId, shotId, episodeId, prompt, readiness }),
        now,
        now,
      );
  }
  let secret: string | undefined;
  try {
    secret = await resolveCredential(credentialRef);
    if (!secret) throw new Error("视频服务商凭据不可用");
    const endpoint = openAiVideoEndpoint(baseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "DramaIP-Desktop/1.0",
      },
      body: JSON.stringify({
        model,
        prompt,
        ...(text(input.negativePrompt)
          ? { negative_prompt: text(input.negativePrompt) }
          : {}),
        ...(typeof input.seconds === "number"
          ? { seconds: input.seconds }
          : {}),
        ...(text(input.size) ? { size: text(input.size) } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`视频服务返回 HTTP ${response.status}`);
    const remote = JSON.parse(raw) as Record<string, unknown>;
    const remoteJobId = text(remote.id);
    if (!remoteJobId) throw new Error("视频服务未返回任务标识");
    const status = videoRemoteStatus(remote.status);
    db!
      .prepare(
        "INSERT INTO video_generation_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)",
      )
      .run(
        jobId,
        taskId,
        projectId,
        episodeId ?? null,
        shotId,
        providerId,
        remoteJobId,
        prompt,
        JSON.stringify({ ...input, baseUrl, readiness }),
        status,
        now,
        now,
      );
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status === "succeeded" ? "running" : status,
        status === "running" ? 0.3 : 0.1,
        timestamp(),
        taskId,
      );
    let result = videoGenerationJob(
      one("SELECT * FROM video_generation_jobs WHERE id = ?", [jobId])!,
    );
    if (status === "succeeded")
      result = await refreshVideoGenerationRecord(jobId);
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
      .run(idempotencyKey, JSON.stringify(result), timestamp());
    recordGeneration({
      projectId,
      taskId,
      kind: "视频生成",
      title: `视频生成 · ${String(shot.title)}`,
      status: "已提交",
      summary: [
        `已固定静帧 ${readiness.adoptedStillId ?? "无"} 与 ${readiness.lockedAssetIds.length} 个锁定资产。`,
        `预检快照 ${readiness.snapshotHash.slice(0, 18)}…。`,
        readiness.costStatus === "known"
          ? `预估费用 ${readiness.estimatedCost ?? 0} ${readiness.currency ?? "USD"}；实际费用请在生成账本补录。`
          : "费用未知已由用户确认；实际费用请在生成账本补录。",
      ].join(" "),
    });
    emit(
      "task.created",
      task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
    );
    emit("video-generation.created", result);
    json(res, 201, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 240) : "视频生成失败";
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run("failed", message, timestamp(), taskId);
    return respondError(res, 502, "INTERNAL_ERROR", message, requestId);
  } finally {
    secret = undefined;
  }
}

function listVideoGenerationByShot(
  res: ServerResponse,
  shotId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      shotId,
      "shots",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "未找到分镜", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM video_generation_jobs WHERE shot_id = ? ORDER BY created_at DESC",
      [shotId],
    ).map(videoGenerationJob),
  );
}
function getVideoGeneration(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const row = one("SELECT * FROM video_generation_jobs WHERE id = ?", [id]);
  if (!row)
    return respondError(res, 404, "NOT_FOUND", "未找到视频生成任务", requestId);
  json(res, 200, videoGenerationJob(row));
}
async function refreshVideoGeneration(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  try {
    const job = await refreshVideoGenerationRecord(id);
    json(res, 200, job);
  } catch (error) {
    return respondError(
      res,
      502,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "视频状态查询失败",
      requestId,
    );
  }
}
async function refreshVideoGenerationRecord(id: string): Promise<any> {
  const row = one("SELECT * FROM video_generation_jobs WHERE id = ?", [id]);
  if (!row) throw new Error("未找到视频生成任务");
  if (["succeeded", "failed", "canceled"].includes(String(row.status)))
    return videoGenerationJob(row);
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [row.provider_id, "providers"],
  );
  if (!provider) throw new Error("视频服务商配置已删除");
  const payload = domainPayload(provider.payload_json),
    baseUrl = text(payload["服务地址"]),
    credentialRef = text(payload["凭据引用"]);
  if (!baseUrl || !credentialRef) throw new Error("视频服务商配置不完整");
  let secret: string | undefined;
  try {
    secret = await resolveCredential(credentialRef);
    if (!secret) throw new Error("视频服务商凭据不可用");
    const response = await fetch(
      `${openAiVideoEndpoint(baseUrl)}/${encodeURIComponent(String(row.remote_job_id))}`,
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(`视频服务返回 HTTP ${response.status}`);
    const remote = JSON.parse(raw) as Record<string, unknown>;
    const status = videoRemoteStatus(remote.status);
    let results: unknown[] = [];
    if (status === "succeeded")
      results = [
        await archiveVideoContent(row, openAiVideoEndpoint(baseUrl), secret),
      ];
    db!
      .prepare(
        "UPDATE video_generation_jobs SET status = ?, results_json = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status,
        JSON.stringify(results),
        status === "failed" ? (text(remote.error) ?? "视频服务执行失败") : null,
        timestamp(),
        id,
      );
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status === "succeeded" ? "succeeded" : status,
        status === "succeeded" ? 1 : 0.6,
        status === "succeeded"
          ? JSON.stringify({ videoJobId: id, resultCount: results.length })
          : null,
        status === "failed" ? (text(remote.error) ?? "视频服务执行失败") : null,
        timestamp(),
        row.task_id,
      );
    const updated = videoGenerationJob(
      one("SELECT * FROM video_generation_jobs WHERE id = ?", [id])!,
    );
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [row.task_id])!),
    );
    emit("video-generation.updated", updated);
    return updated;
  } finally {
    secret = undefined;
  }
}
async function cancelVideoGeneration(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const row = one("SELECT * FROM video_generation_jobs WHERE id = ?", [id]);
  if (!row)
    return respondError(res, 404, "NOT_FOUND", "未找到视频生成任务", requestId);
  if (["succeeded", "failed", "canceled"].includes(String(row.status)))
    return json(res, 200, videoGenerationJob(row));
  db!
    .prepare(
      "UPDATE video_generation_jobs SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run("canceled", timestamp(), id);
  db!
    .prepare(
      "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      "canceled",
      "已停止本地追踪；请在服务商侧确认远端任务状态。",
      timestamp(),
      row.task_id,
    );
  const updated = videoGenerationJob(
    one("SELECT * FROM video_generation_jobs WHERE id = ?", [id])!,
  );
  emit("video-generation.updated", updated);
  json(res, 200, updated);
}
async function retryVideoGeneration(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const row = one("SELECT * FROM video_generation_jobs WHERE id = ?", [id]);
  if (!row)
    return respondError(res, 404, "NOT_FOUND", "未找到视频生成任务", requestId);
  const requested = await body(req);
  const original = domainPayload(row.input_json);
  const input = {
    ...original,
    providerId: text(requested.providerId) ?? String(row.provider_id),
    projectId: String(row.project_id),
    shotId: String(row.shot_id),
    ...(row.episode_id ? { episodeId: String(row.episode_id) } : {}),
    parentTaskId: String(row.task_id),
  };
  const retryRequest = {
    headers: {
      ...req.headers,
      "idempotency-key":
        typeof req.headers["idempotency-key"] === "string"
          ? req.headers["idempotency-key"]
          : randomUUID(),
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(input));
    },
  } as unknown as IncomingMessage;
  return createVideoGeneration(retryRequest, res, requestId);
}
function openAiVideoEndpoint(baseUrl: string): string {
  const source = new URL(baseUrl.trim());
  if (
    !["https:", "http:"].includes(source.protocol) ||
    source.username ||
    source.password
  )
    throw new Error("视频服务地址必须是无账号密码的 HTTP 或 HTTPS 地址");
  const path = source.pathname.replace(/\/+$/, "");
  source.pathname = path.endsWith("/videos") ? path : `${path || ""}/videos`;
  source.search = "";
  source.hash = "";
  return source.toString().replace(/\/$/, "");
}
function videoRemoteStatus(
  value: unknown,
): "queued" | "running" | "succeeded" | "failed" | "canceled" {
  const state = String(value ?? "queued").toLowerCase();
  if (["completed", "succeeded", "success"].includes(state)) return "succeeded";
  if (["failed", "error"].includes(state)) return "failed";
  if (["canceled", "cancelled"].includes(state)) return "canceled";
  return state === "running" || state === "processing" ? "running" : "queued";
}
async function archiveVideoContent(
  row: Record<string, any>,
  endpoint: string,
  secret: string,
): Promise<unknown> {
  const response = await fetch(
    `${endpoint}/${encodeURIComponent(String(row.remote_job_id))}/content`,
    {
      headers: { Authorization: `Bearer ${secret}`, Accept: "video/*" },
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok)
    throw new Error(`无法下载视频结果（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 500 * 1024 * 1024)
    throw new Error("视频结果大小无效或超过 500 MB");
  const storedName = `generated/${String(row.task_id)}.mp4`;
  mkdirSync(join(command!.assetDirectory, "generated"), { recursive: true });
  writeFileSync(join(command!.assetDirectory, storedName), bytes);
  const assetId = insertDomainEntity(
    "assets",
    String(row.project_id),
    undefined,
    `视频素材 · ${String(row.prompt).slice(0, 24)}`,
    {
      素材类型: "AI 视频",
      来源: "视频服务商",
      生成任务标识: String(row.task_id),
      file: { name: "视频.mp4", storedName },
    },
  );
  const videoId = insertDomainEntity(
    "video",
    String(row.project_id),
    String(row.shot_id),
    `视频结果 · ${String(row.id).slice(0, 8)}`,
    {
      关联分镜: String(row.shot_id),
      生成提示: String(row.prompt),
      任务状态: "已完成",
      素材标识: assetId,
      file: { name: "视频.mp4", storedName },
    },
  );
  return domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [videoId])!,
  );
}
function videoGenerationJob(row: Record<string, any>) {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    ...(row.episode_id ? { episodeId: String(row.episode_id) } : {}),
    ...(row.shot_id ? { shotId: String(row.shot_id) } : {}),
    providerId: String(row.provider_id),
    remoteJobId: String(row.remote_job_id),
    prompt: String(row.prompt),
    status: String(row.status),
    results: (() => {
      try {
        const stored = JSON.parse(String(row.results_json));
        if (!Array.isArray(stored)) return [];
        return stored.map((candidate) => {
          const id =
            candidate && typeof candidate === "object"
              ? text((candidate as Record<string, unknown>).id)
              : undefined;
          const current = id
            ? one("SELECT * FROM domain_entities WHERE id = ? AND domain = ?", [
                id,
                "video",
              ])
            : undefined;
          return current ? domainEntity(current) : candidate;
        });
      } catch {
        return [];
      }
    })(),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

type EpisodeWorkflowContext = {
  projectId: string;
  episodeId: string;
  episodeTitle: string;
  scripts: Array<Record<string, unknown>>;
  scenes: Array<Record<string, unknown>>;
  shots: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  quality: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  localization: Array<Record<string, unknown>>;
  review: Array<Record<string, unknown>>;
  delivery: Array<Record<string, unknown>>;
  scriptContent: string;
};

function episodeWorkflowContext(
  projectId: string,
  episodeId: string,
  episode: Record<string, unknown>,
): EpisodeWorkflowContext {
  const scripts = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ? ORDER BY created_at",
    ["scripts", projectId, episodeId],
  );
  const scenes = scripts.flatMap((script) =>
    rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ? ORDER BY created_at",
      ["scenes", projectId, script.id],
    ),
  );
  const shots = scenes.flatMap((scene) =>
    rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ? ORDER BY created_at",
      ["shots", projectId, scene.id],
    ),
  );
  const byEpisode = (domain: string) =>
    rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id = ? ORDER BY updated_at DESC",
      [domain, projectId, episodeId],
    );
  return {
    projectId,
    episodeId,
    episodeTitle: String(episode.title),
    scripts,
    scenes,
    shots,
    assets: rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
      ["assets", projectId],
    ),
    quality: byEpisode("quality"),
    compliance: byEpisode("compliance"),
    localization: byEpisode("localization"),
    review: byEpisode("review"),
    delivery: byEpisode("delivery"),
    scriptContent: scripts
      .map((script) =>
        stringPayload(domainPayload(script.payload_json), "剧本内容"),
      )
      .filter(Boolean)
      .join("\n\n"),
  };
}

function executeEpisodeWorkflow(
  kind: EpisodeWorkflowKind,
  context: EpisodeWorkflowContext,
): {
  domain: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
} {
  const qualityIssues = collectQualityIssues(context);
  if (kind === "quality-check") {
    const blockerCount = qualityIssues.filter(
      (issue) => issue.severity === "阻断",
    ).length;
    return {
      domain: "quality",
      title: `${context.episodeTitle}·质量检查`,
      summary: blockerCount
        ? `发现 ${blockerCount} 个阻断问题，建议先完成返工。`
        : `质量检查完成，发现 ${qualityIssues.length} 个需要关注的项目。`,
      payload: {
        关联分集: context.episodeTitle,
        检查状态: blockerCount ? "需返工" : "通过（有提示）",
        严重程度: blockerCount ? "阻断" : qualityIssues.length ? "提示" : "无",
        问题描述: renderWorkflowIssues(qualityIssues),
        返工方案: qualityIssues.length
          ? "使用“生成最小返工计划”生成按依赖顺序排列的处理步骤。"
          : "当前未发现需要返工的结构问题。",
      },
    };
  }
  if (kind === "compliance-check") {
    const flags = collectComplianceFlags(context);
    return {
      domain: "compliance",
      title: `${context.episodeTitle}·合规预检`,
      summary: flags.length
        ? `合规预检发现 ${flags.length} 项需要人工核验的内容。`
        : "合规预检未发现关键字风险；仍需人工完成最终核验。",
      payload: {
        规则来源: "本地基础风险词与素材权利状态",
        检查状态: flags.length ? "需人工核验" : "通过（待人工复核）",
        风险与依据: flags.length
          ? flags.join("\n")
          : "未发现基础风险词或缺失版权声明。",
        处理说明:
          "自动预检仅用于发现线索，不能替代发行地区、平台和法务的最终审核。",
      },
    };
  }
  if (kind === "delivery-preflight") {
    const issues = collectDeliveryIssues(context, qualityIssues);
    return {
      domain: "delivery",
      title: `${context.episodeTitle}·交付预检`,
      summary: issues.length
        ? `交付预检发现 ${issues.length} 项待处理事项。`
        : "交付预检通过，可以继续创建平台交付包。",
      payload: {
        目标平台: "待选择",
        交付状态: issues.length ? "预检未通过" : "预检通过",
        预检结果: issues.length
          ? issues.join("\n")
          : "剧本、制作资料和审核记录已满足本地预检规则。",
        交付说明: "交付前仍需确认平台规格、地域规则和最终输出文件。",
      },
    };
  }
  if (kind === "render-preflight") {
    const issues = [
      ...(!context.scripts.length ? ["阻断：缺少分集剧本。"] : []),
      ...(!context.scenes.length ? ["阻断：剧本尚未拆分场景。"] : []),
      ...(!context.shots.length ? ["阻断：尚未建立分镜。"] : []),
      ...(!context.assets.length ? ["提示：项目尚无已归档素材。"] : []),
    ];
    return {
      domain: "renders",
      title: `${context.episodeTitle}·成片渲染预检`,
      summary: issues.some((item) => item.startsWith("阻断"))
        ? "渲染预检未通过，需先补齐阻断项。"
        : "渲染预检通过，可在接入渲染器后提交最终成片任务。",
      payload: {
        关联分集: context.episodeTitle,
        渲染状态: issues.some((item) => item.startsWith("阻断"))
          ? "预检未通过"
          : "可提交",
        预检结果: issues.length ? issues.join("\n") : "制作链路资料齐全。",
        说明: "本地预检不会伪造视频成片；实际渲染需由已配置的渲染服务执行。",
      },
    };
  }
  if (kind === "animatic-draft") {
    const timeline = context.shots.map((shot, index) => {
      const payload = domainPayload(shot.payload_json);
      return `${index * 3}—${index * 3 + 3} 秒：${String(shot.title)}${stringPayload(payload, "镜头描述") ? `，${stringPayload(payload, "镜头描述")}` : ""}`;
    });
    return {
      domain: "animatics",
      title: `${context.episodeTitle}·动态分镜草案`,
      summary: context.shots.length
        ? `已基于 ${context.shots.length} 个分镜创建可审阅的节奏草案。`
        : "尚无分镜，未能形成动态分镜时间线。",
      payload: {
        关联分集: context.episodeTitle,
        审阅状态: context.shots.length ? "待审阅" : "资料不足",
        时间线说明: timeline.join("\n") || "请先建立场景与分镜。",
        审阅意见:
          "这是节奏草案；接入真实媒体后可生成包含画面与音频的审片版本。",
      },
    };
  }
  if (kind === "minimal-redo-plan") {
    const actionable = qualityIssues.filter(
      (issue) => issue.severity !== "提示",
    );
    const plan = (actionable.length ? actionable : qualityIssues).map(
      (issue, index) => `${index + 1}. ${issue.message}`,
    );
    return {
      domain: "quality",
      title: `${context.episodeTitle}·最小返工计划`,
      summary: plan.length
        ? `已生成 ${plan.length} 步最小返工计划。`
        : "当前没有需要返工的项目。",
      payload: {
        关联分集: context.episodeTitle,
        检查状态: plan.length ? "待处理" : "无需返工",
        严重程度: plan.length ? "按依赖排序" : "无",
        问题描述: renderWorkflowIssues(qualityIssues),
        返工方案: plan.join("\n") || "无需返工。",
      },
    };
  }
  const comments = [
    "请确认剧情节奏、人物动机和镜头衔接。",
    ...qualityIssues.map((issue) => `请复核：${issue.message}`),
  ];
  return {
    domain: "review",
    title: `${context.episodeTitle}·审片包`,
    summary: `已汇总 ${context.scripts.length} 个剧本、${context.scenes.length} 个场景和 ${context.shots.length} 个分镜的审阅清单。`,
    payload: {
      审片方式: "本地审阅清单",
      审片状态: "待审阅",
      评论: comments.join("\n"),
      决策与跟进: "审阅后可创建修订预览或最小返工计划。",
    },
  };
}

function collectQualityIssues(context: EpisodeWorkflowContext): Array<{
  severity: "阻断" | "警告" | "提示";
  message: string;
}> {
  const issues: Array<{ severity: "阻断" | "警告" | "提示"; message: string }> =
    [];
  if (!context.scripts.length)
    issues.push({ severity: "阻断", message: "缺少分集剧本。" });
  if (
    context.scripts.length &&
    context.scriptContent.replace(/\s/g, "").length < 300
  )
    issues.push({
      severity: "警告",
      message: "剧本正文较短，建议补充完整剧情与对白。",
    });
  if (!context.scenes.length)
    issues.push({ severity: "阻断", message: "剧本尚未拆分为可制作的场景。" });
  if (context.scenes.length && !context.shots.length)
    issues.push({ severity: "警告", message: "尚未为场景建立分镜。" });
  if (!context.assets.length)
    issues.push({ severity: "提示", message: "项目还没有归档制作素材。" });
  return issues;
}

function collectComplianceFlags(context: EpisodeWorkflowContext): string[] {
  const flags: string[] = [];
  const keywords = ["盗版", "侵权", "未授权", "血腥", "自杀", "仇恨", "诽谤"];
  for (const keyword of keywords)
    if (context.scriptContent.includes(keyword))
      flags.push(`剧本包含“${keyword}”，请人工核验适用规则与表达尺度。`);
  if (!context.assets.length)
    flags.push("未发现项目素材归档记录，交付前需核实外部素材权利。");
  return flags;
}

function collectDeliveryIssues(
  context: EpisodeWorkflowContext,
  qualityIssues: Array<{ severity: string; message: string }>,
): string[] {
  const issues: string[] = [];
  if (qualityIssues.some((issue) => issue.severity === "阻断"))
    issues.push("质量检查存在阻断项。");
  if (!context.compliance.length) issues.push("尚未执行合规预检。");
  if (!context.review.length) issues.push("尚未生成审片包或记录审片结论。");
  if (!context.localization.length)
    issues.push("尚未准备本地化版本；若目标平台需要字幕或多语言请先补齐。");
  return issues;
}

function renderWorkflowIssues(
  issues: Array<{ severity: string; message: string }>,
): string {
  return issues.length
    ? issues
        .map(
          (issue, index) =>
            `${index + 1}. 【${issue.severity}】${issue.message}`,
        )
        .join("\n")
    : "未发现问题。";
}

function episodeWorkflowTitle(
  kind: EpisodeWorkflowKind,
  episodeTitle: string,
): string {
  const names: Record<EpisodeWorkflowKind, string> = {
    "quality-check": "质量检查",
    "compliance-check": "合规预检",
    "delivery-preflight": "交付预检",
    "render-preflight": "成片渲染预检",
    "animatic-draft": "动态分镜草案",
    "minimal-redo-plan": "最小返工计划",
    "review-package": "审片包",
  };
  return `${episodeTitle}·${names[kind]}`;
}

type FeedbackMetricInput = {
  name: string;
  value: number;
  occurredAt?: string;
  dimensions: Record<string, unknown>;
};
type FeedbackCommentInput = {
  content: string;
  author?: string;
  occurredAt?: string;
  category: string;
};

async function previewFeedbackImport(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const kind = text(input.kind);
  const capabilityToken = text(input.capabilityToken);
  if (
    !projectId ||
    !capabilityToken ||
    !["metrics", "comments"].includes(kind ?? "")
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid feedback import input",
      requestId,
    );
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const capability = await resolveCapability(capabilityToken);
  if (!capability?.permissions.includes("read"))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "File capability is invalid or expired",
      requestId,
    );
  let content = "";
  let sourceName = "";
  try {
    const info = statSync(capability.path);
    if (!info.isFile() || info.size > 4 * 1024 * 1024)
      throw new Error("Feedback file exceeds the supported size limit");
    content = decodeSourceText(readFileSync(capability.path));
    sourceName = basename(capability.path);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Feedback file cannot be read",
      requestId,
    );
  }
  let parsed: {
    rows: FeedbackMetricInput[] | FeedbackCommentInput[];
    warnings: string[];
  };
  try {
    parsed = parseFeedbackContent(
      kind as "metrics" | "comments",
      sourceName,
      content,
    );
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Feedback file cannot be parsed",
      requestId,
    );
  }
  if (!parsed.rows.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Feedback file has no valid rows",
      requestId,
    );
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SOURCE_IMPORT_TTL_MS).toISOString();
  db!
    .prepare("INSERT INTO feedback_previews VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      id,
      projectId,
      kind as "metrics" | "comments",
      sourceName,
      JSON.stringify(parsed.rows),
      JSON.stringify(parsed.warnings),
      expiresAt,
      timestamp(),
    );
  json(res, 201, {
    importId: id,
    projectId,
    kind: kind as "metrics" | "comments",
    sourceName,
    validCount: parsed.rows.length,
    warnings: parsed.warnings,
    sample: parsed.rows.slice(0, 8),
    expiresAt,
  });
}

async function commitFeedbackImport(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const stored = one("SELECT * FROM feedback_previews WHERE id = ?", [id]);
  if (!stored)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Feedback preview not found",
      requestId,
    );
  if (String(stored.expires_at) < timestamp()) {
    db!.prepare("DELETE FROM feedback_previews WHERE id = ?").run(id);
    return respondError(
      res,
      409,
      "CONFLICT",
      "Feedback preview expired",
      requestId,
    );
  }
  if (!projectId || projectId !== String(stored.project_id))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Feedback project does not match preview",
      requestId,
    );
  let rowsValue: unknown;
  try {
    rowsValue = JSON.parse(String(stored.rows_json));
  } catch {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Feedback preview is invalid",
      requestId,
    );
  }
  if (!Array.isArray(rowsValue))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Feedback preview is invalid",
      requestId,
    );
  const kind = String(stored.kind) as "metrics" | "comments";
  const batchId = randomUUID();
  const now = timestamp();
  try {
    db!.exec("BEGIN IMMEDIATE");
    db!
      .prepare("INSERT INTO feedback_import_batches VALUES (?, ?, ?, ?, ?, ?)")
      .run(batchId, projectId, kind, stored.source_name, rowsValue.length, now);
    if (kind === "metrics") {
      const insert = db!.prepare(
        "INSERT INTO feedback_metrics VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const value of rowsValue) {
        const row = value as FeedbackMetricInput;
        insert.run(
          randomUUID(),
          batchId,
          row.name,
          row.value,
          row.occurredAt ?? null,
          JSON.stringify(row.dimensions ?? {}),
          now,
        );
      }
    } else {
      const insert = db!.prepare(
        "INSERT INTO feedback_comments VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const value of rowsValue) {
        const row = value as FeedbackCommentInput;
        insert.run(
          randomUUID(),
          batchId,
          row.content,
          row.author ?? null,
          row.occurredAt ?? null,
          row.category,
          now,
        );
      }
    }
    db!.prepare("DELETE FROM feedback_previews WHERE id = ?").run(id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const batch = feedbackBatch(
    one("SELECT * FROM feedback_import_batches WHERE id = ?", [batchId])!,
  );
  emit("feedback.imported", batch);
  json(res, 201, batch);
}

function feedbackDashboard(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL", [
      projectId,
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const batches = rows(
    "SELECT * FROM feedback_import_batches WHERE project_id = ? ORDER BY created_at DESC",
    [projectId],
  ).map(feedbackBatch);
  const metrics = rows(
    `SELECT m.* FROM feedback_metrics m
     INNER JOIN feedback_import_batches b ON b.id = m.batch_id
     WHERE b.project_id = ? ORDER BY m.created_at DESC LIMIT 500`,
    [projectId],
  ).map(feedbackMetric);
  const comments = rows(
    `SELECT c.* FROM feedback_comments c
     INNER JOIN feedback_import_batches b ON b.id = c.batch_id
     WHERE b.project_id = ? ORDER BY c.created_at DESC LIMIT 500`,
    [projectId],
  ).map(feedbackComment);
  const clusters = rows(
    "SELECT * FROM feedback_clusters WHERE project_id = ? ORDER BY created_at DESC",
    [projectId],
  ).map(feedbackCluster);
  json(res, 200, { batches, metrics, comments, clusters });
}

async function clusterFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const batchId = text(input.batchId);
  if (!projectId || !batchId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId and batchId are required",
      requestId,
    );
  const batch = one(
    "SELECT * FROM feedback_import_batches WHERE id = ? AND project_id = ?",
    [batchId, projectId],
  );
  if (!batch)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Feedback batch not found",
      requestId,
    );
  if (String(batch.kind) !== "comments")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Only comment batches can be clustered",
      requestId,
    );
  const comments = rows("SELECT * FROM feedback_comments WHERE batch_id = ?", [
    batchId,
  ]);
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const comment of comments) {
    const category = String(comment.category || "其他反馈");
    const group = groups.get(category) ?? [];
    group.push(comment);
    groups.set(category, group);
  }
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare("DELETE FROM feedback_clusters WHERE batch_id = ?")
      .run(batchId);
    const insert = db!.prepare(
      "INSERT INTO feedback_clusters VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const [category, values] of groups) {
      const examples = values
        .slice(0, 3)
        .map((item) => String(item.content).slice(0, 80))
        .join("；");
      insert.run(
        randomUUID(),
        projectId,
        batchId,
        category,
        `共 ${values.length} 条评论。代表反馈：${examples}`,
        values.length,
        timestamp(),
      );
    }
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const clusters = rows(
    "SELECT * FROM feedback_clusters WHERE batch_id = ? ORDER BY comment_count DESC",
    [batchId],
  ).map(feedbackCluster);
  emit("feedback.clustered", { projectId, batchId, count: clusters.length });
  json(res, 201, clusters);
}

async function createFeedbackRevisionTask(
  req: IncomingMessage,
  res: ServerResponse,
  clusterId: string,
  requestId: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const cluster = one("SELECT * FROM feedback_clusters WHERE id = ?", [
    clusterId,
  ]);
  if (!cluster)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Feedback cluster not found",
      requestId,
    );
  const taskId = randomUUID();
  const now = timestamp();
  const title = `反馈修订建议：${String(cluster.title)}`;
  const payload = {
    retry: { clusterId },
    clusterId,
    summary: String(cluster.summary),
    suggestedAction: `请针对“${String(cluster.title)}”主题复核内容，并先创建修订预览供人工确认。`,
  };
  db!
    .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL, ?, ?)")
    .run(
      taskId,
      "feedback.revision",
      "running",
      title,
      cluster.project_id,
      JSON.stringify(payload),
      now,
      now,
    );
  const created = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
  db!
    .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
    .run(idempotencyKey, JSON.stringify(created), now);
  emit("task.created", created);
  json(res, 201, created);
  queueMicrotask(() => executeFeedbackRevisionTask(taskId, clusterId));
}

/**
 * Feedback has no authority to change a chapter.  The worker only creates a
 * durable, explainable recommendation that the user can turn into a controlled
 * revision preview from the writing workflow.
 */
function executeFeedbackRevisionTask(taskId: string, clusterId: string): void {
  const current = one("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!current || String(current.status) === "canceled") return;
  const cluster = one("SELECT * FROM feedback_clusters WHERE id = ?", [
    clusterId,
  ]);
  if (!cluster) {
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run("failed", "反馈主题已不存在", timestamp(), taskId, "running");
    const failed = one("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (failed) emit("task.updated", task(failed));
    return;
  }
  const chapters = rows(
    "SELECT id, title, summary, version, updated_at FROM chapters WHERE project_id = ? ORDER BY updated_at DESC LIMIT 5",
    [cluster.project_id],
  ).map((chapter) => ({
    id: String(chapter.id),
    title: String(chapter.title),
    summary: String(chapter.summary ?? ""),
    version: Number(chapter.version),
    updatedAt: String(chapter.updated_at),
  }));
  const result = {
    retry: { clusterId },
    feedbackCluster: {
      id: String(cluster.id),
      title: String(cluster.title),
      summary: String(cluster.summary),
      commentCount: Number(cluster.comment_count),
    },
    candidateChapters: chapters,
    nextSteps: [
      "选择最相关的章节并核对反馈是否适用于当前版本。",
      "在创作工作台创建修订预览，比较改动后再由人工提交。",
      "采用后记录验证结果，避免把单一评论簇直接视为事实。",
    ],
  };
  db!
    .prepare(
      "UPDATE tasks SET status = ?, progress = 1, result_json = ?, error = NULL, updated_at = ? WHERE id = ? AND status = ?",
    )
    .run("succeeded", JSON.stringify(result), timestamp(), taskId, "running");
  const completed = one("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (completed) emit("task.updated", task(completed));
}

function parseFeedbackContent(
  kind: "metrics" | "comments",
  sourceName: string,
  content: string,
): {
  rows: FeedbackMetricInput[] | FeedbackCommentInput[];
  warnings: string[];
} {
  const extension = extname(sourceName).toLowerCase();
  const records =
    extension === ".json"
      ? parseFeedbackJson(content)
      : parseFeedbackCsv(content);
  if (records.length > 10_000)
    throw new Error("Feedback file has too many rows");
  const warnings: string[] = [];
  if (kind === "metrics") {
    const rows: FeedbackMetricInput[] = [];
    for (const [index, record] of records.entries()) {
      const name = feedbackText(record, ["指标", "metric", "name", "名称"]);
      const value = feedbackNumber(record, ["数值", "value", "值", "count"]);
      if (!name || value === undefined) {
        warnings.push(`第 ${index + 1} 行缺少指标名称或数值，已跳过。`);
        continue;
      }
      rows.push({
        name,
        value,
        occurredAt: feedbackDate(record, ["日期", "date", "时间", "time"]),
        dimensions: feedbackDimensions(record, [
          "指标",
          "metric",
          "name",
          "名称",
          "数值",
          "value",
          "值",
          "count",
          "日期",
          "date",
          "时间",
          "time",
        ]),
      });
    }
    return { rows, warnings: warnings.slice(0, 30) };
  }
  const rows: FeedbackCommentInput[] = [];
  for (const [index, record] of records.entries()) {
    const contentValue = feedbackText(record, [
      "评论",
      "comment",
      "content",
      "text",
      "内容",
    ]);
    if (!contentValue) {
      warnings.push(`第 ${index + 1} 行缺少评论正文，已跳过。`);
      continue;
    }
    rows.push({
      content: contentValue,
      author: feedbackText(record, ["作者", "author", "user", "用户", "昵称"]),
      occurredAt: feedbackDate(record, ["日期", "date", "时间", "time"]),
      category: feedbackCategory(contentValue),
    });
  }
  return { rows, warnings: warnings.slice(0, 30) };
}

function parseFeedbackJson(content: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(content) as unknown;
  const root = asImportRecord(parsed);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.metrics)
        ? root.metrics
        : Array.isArray(root?.comments)
          ? root.comments
          : [];
  return list.filter((item): item is Record<string, unknown> =>
    Boolean(asImportRecord(item)),
  );
}

function parseFeedbackCsv(content: string): Array<Record<string, unknown>> {
  const rows = parseCsvRows(content);
  const headers =
    rows.shift()?.map((item) => item.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!headers.length) throw new Error("Feedback CSV has no header row");
  return rows
    .filter((row) => row.some((item) => item.trim()))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index]?.trim() ?? ""]),
      ),
    );
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("Feedback CSV has an unclosed quoted value");
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function feedbackText(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function feedbackNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/,/g, ""))
          : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function feedbackDate(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  const value = feedbackText(record, keys);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function feedbackDimensions(
  record: Record<string, unknown>,
  ignored: string[],
): Record<string, unknown> {
  const ignoredKeys = new Set(ignored);
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !ignoredKeys.has(key) && value !== "",
    ),
  );
}

function feedbackCategory(content: string): string {
  const categories: Array<[string, string[]]> = [
    ["剧情节奏", ["剧情", "节奏", "拖沓", "反转", "结局"]],
    ["角色与表演", ["角色", "人物", "主角", "演技", "动机"]],
    ["画面与分镜", ["画面", "镜头", "特效", "美术", "分镜"]],
    ["声音与配音", ["配音", "音效", "音乐", "声音"]],
  ];
  return (
    categories.find(([, words]) =>
      words.some((word) => content.includes(word)),
    )?.[0] ?? "其他反馈"
  );
}

function feedbackBatch(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: String(row.kind) as "metrics" | "comments",
    sourceName: String(row.source_name),
    rowCount: Number(row.row_count),
    createdAt: String(row.created_at),
  };
}

function feedbackMetric(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    name: String(row.name),
    value: Number(row.value),
    ...(row.occurred_at ? { occurredAt: String(row.occurred_at) } : {}),
    dimensions: domainPayload(row.dimensions_json),
    createdAt: String(row.created_at),
  };
}

function feedbackComment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    content: String(row.content),
    ...(row.author ? { author: String(row.author) } : {}),
    ...(row.occurred_at ? { occurredAt: String(row.occurred_at) } : {}),
    category: String(row.category),
    createdAt: String(row.created_at),
  };
}

function feedbackCluster(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    batchId: String(row.batch_id),
    title: String(row.title),
    summary: String(row.summary),
    commentCount: Number(row.comment_count),
    createdAt: String(row.created_at),
  };
}

function globalSearch(res: ServerResponse, query: string): void {
  const keyword = query.trim();
  if (!keyword) return json(res, 200, { query: "", results: [] });
  const like = `%${keyword}%`;
  const projectResults = rows(
    `SELECT id, title, synopsis AS excerpt, NULL AS project_id, updated_at
     FROM projects
     WHERE deleted_at IS NULL AND (title LIKE ? OR synopsis LIKE ?)
     ORDER BY updated_at DESC LIMIT 20`,
    [like, like],
  ).map((row) => searchResult("project", row));
  const chapterResults = rows(
    `SELECT id, title, COALESCE(summary, content) AS excerpt, project_id, updated_at
     FROM chapters
     WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?
     ORDER BY updated_at DESC LIMIT 20`,
    [like, like, like],
  ).map((row) => searchResult("chapter", row));
  const resourceResults = rows(
    `SELECT id, domain, title, payload_json AS excerpt, project_id, updated_at
     FROM domain_entities
     WHERE title LIKE ? OR payload_json LIKE ?
     ORDER BY updated_at DESC LIMIT 40`,
    [like, like],
  ).map((row) => searchResult(String(row.domain), row));
  json(res, 200, {
    query: keyword,
    results: [...projectResults, ...chapterResults, ...resourceResults].slice(
      0,
      60,
    ),
  });
}

function createBackup(res: ServerResponse): void {
  const id = randomUUID();
  const createdAt = timestamp();
  const fileName = `dramaip-${createdAt.replace(/[:.]/g, "-")}-${id}.db`;
  const path = join(command!.backupDirectory, fileName);
  db!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  copyFileSync(command!.databasePath, path);
  const size = statSync(path).size;
  db!
    .prepare("INSERT INTO backups VALUES (?, ?, ?, ?)")
    .run(id, fileName, size, createdAt);
  const created = backup(one("SELECT * FROM backups WHERE id = ?", [id])!);
  emit("backup.created", created);
  json(res, 201, created);
}

function restoreBackup(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const record = one("SELECT * FROM backups WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "Backup not found", requestId);
  const path = join(command!.backupDirectory, String(record.file_name));
  try {
    statSync(path);
  } catch {
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Backup file is not available",
      requestId,
    );
  }
  db!.close();
  copyFileSync(path, command!.databasePath);
  db = openNodeSqliteDatabase(command!.databasePath).sqlite;
  initializeOperationalSchema(db);
  initializeV3AgentSchema(db);
  initializeDatabaseMaintenance(db);
  if (!one("SELECT id FROM backups WHERE id = ?", [id]))
    db!
      .prepare("INSERT INTO backups VALUES (?, ?, ?, ?)")
      .run(record.id, record.file_name, record.size, record.created_at);
  const restored = backup(
    one("SELECT * FROM backups WHERE id = ?", [id]) ?? record,
  );
  emit("backup.restored", restored);
  json(res, 200, restored);
}

async function resource(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  domain: string,
  id: string | undefined,
  requestId: string,
  url: URL,
): Promise<void> {
  if (method === "GET" && !id) {
    const projectId = url.searchParams.get("projectId");
    const parentId = url.searchParams.get("parentId");
    const constraints = ["domain = ?"];
    const params: string[] = [domain];
    if (projectId) {
      constraints.push("project_id = ?");
      params.push(projectId);
    }
    if (parentId) {
      constraints.push("parent_id = ?");
      params.push(parentId);
    }
    const ordering = ["episodes", "scenes", "shots"].includes(domain)
      ? "ORDER BY COALESCE(CAST(json_extract(payload_json, '$.排序') AS INTEGER), 2147483647), created_at"
      : "ORDER BY updated_at DESC";
    const sql = `SELECT * FROM domain_entities WHERE ${constraints.join(" AND ")} ${ordering}`;
    return json(res, 200, rows(sql, params).map(domainEntity));
  }
  if (method === "POST" && !id) {
    const input = await body(req);
    const title = text(input.title);
    if (!title)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "title is required",
        requestId,
      );
    const projectId = text(input.projectId);
    if (projectId && !one("SELECT id FROM projects WHERE id = ?", [projectId]))
      return respondError(
        res,
        404,
        "NOT_FOUND",
        "Project not found",
        requestId,
      );
    const now = timestamp();
    const nextId = randomUUID();
    const payload =
      input.payload && typeof input.payload === "object"
        ? ({ ...input.payload } as Record<string, unknown>)
        : {};
    if (
      (domain === "providers" || domain === "settings") &&
      containsSecret(payload)
    ) {
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "Secrets must be stored by the local encrypted credential vault; persist only credentialRef",
        requestId,
      );
    }
    if (
      ["assets", "visual-assets", "shot-stills"].includes(domain) &&
      typeof input.capabilityToken === "string"
    ) {
      const capability = await resolveCapability(input.capabilityToken);
      if (!capability?.permissions.includes("read"))
        return respondError(
          res,
          400,
          "VALIDATION_ERROR",
          "File capability is invalid or expired",
          requestId,
        );
      mkdirSync(command!.assetDirectory, { recursive: true });
      const storedName = `${nextId}-${basename(capability.path)}`;
      await new Promise<void>((resolve, reject) =>
        copyFile(
          capability.path,
          `${command!.assetDirectory}/${storedName}`,
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      payload.file = { name: basename(capability.path), storedName };
    }
    db!
      .prepare("INSERT INTO domain_entities VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .run(
        nextId,
        domain,
        projectId ?? null,
        text(input.parentId) ?? null,
        title,
        JSON.stringify(payload),
        now,
        now,
      );
    const created = domainEntity(
      one("SELECT * FROM domain_entities WHERE id = ?", [nextId])!,
    );
    emit(`${domain}.created`, created);
    return json(res, 201, created);
  }
  const current = id
    ? one("SELECT * FROM domain_entities WHERE id = ? AND domain = ?", [
        id,
        domain,
      ])
    : undefined;
  if (!id || !current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      `${domain} resource not found`,
      requestId,
    );
  if (method === "GET") return json(res, 200, domainEntity(current));
  if (method === "PATCH") {
    const input = await body(req);
    if (input.version !== current.version)
      return respondError(
        res,
        409,
        "CONFLICT",
        "Resource changed in another session",
        requestId,
        { current: domainEntity(current) },
      );
    const title =
      typeof input.title === "string" ? input.title.trim() : current.title;
    if (!title)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "title is required",
        requestId,
      );
    const payload =
      input.payload && typeof input.payload === "object"
        ? input.payload
        : JSON.parse(String(current.payload_json));
    if (
      (domain === "providers" || domain === "settings") &&
      containsSecret(payload)
    ) {
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "Secrets must be stored by the local encrypted credential vault; persist only credentialRef",
        requestId,
      );
    }
    db!
      .prepare(
        "UPDATE domain_entities SET title = ?, payload_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(title, JSON.stringify(payload), timestamp(), id, current.version);
    const updated = domainEntity(
      one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
    );
    emit(`${domain}.updated`, updated);
    return json(res, 200, updated);
  }
  if (method === "DELETE") {
    if (domain === "visual-assets") {
      const usages = assetCenterUsages(
        current.project_id ? String(current.project_id) : undefined,
        id,
      );
      if (usages.length)
        return respondError(
          res,
          409,
          "CONFLICT",
          `资产正在被 ${usages.length} 个镜头使用；请先在资产中心迁移或移除用途。`,
          requestId,
        );
    }
    const deleted = removeDomainEntityCascade(current);
    emit(`${domain}.deleted`, { id, domain, deleted });
    res.writeHead(204).end();
    return;
  }
  return respondError(
    res,
    404,
    "NOT_FOUND",
    `No route for ${method} ${domain}`,
    requestId,
  );
}

/**
 * The production hierarchy is intentionally stored as an adjacency tree.  A
 * deletion must therefore clean every descendant and the review/version rows
 * that reference it; leaving descendants behind makes the workspace appear to
 * lose or duplicate data after an upper-level item is removed.
 */
function removeDomainEntityCascade(root: Record<string, any>): number {
  const rootId = String(root.id);
  const rootDomain = String(root.domain);
  const rootProjectId = root.project_id ? String(root.project_id) : undefined;
  let deleted = 0;
  const remove = (id: string): void => {
    const current = one("SELECT id, domain FROM domain_entities WHERE id = ?", [
      id,
    ]);
    if (!current) return;
    const children = rows(
      "SELECT id FROM domain_entities WHERE parent_id = ?",
      [id],
    );
    for (const child of children) remove(String(child.id));
    if (current.domain === "adaptations")
      db!
        .prepare("DELETE FROM episode_analyses WHERE adaptation_id = ?")
        .run(id);
    if (current.domain === "adaptations") {
      db!
        .prepare(
          "DELETE FROM platform_delivery_archives WHERE adaptation_id = ?",
        )
        .run(id);
      db!
        .prepare(
          "DELETE FROM delivery_creative_variants WHERE adaptation_id = ?",
        )
        .run(id);
      deleteReviewPackages("adaptation_id", id);
    }
    if (current.domain === "episodes") {
      db!
        .prepare("DELETE FROM platform_delivery_archives WHERE episode_id = ?")
        .run(id);
      deleteReviewPackages("episode_id", id);
    }
    if (current.domain === "scripts")
      db!.prepare("DELETE FROM script_reviews WHERE script_id = ?").run(id);
    if (current.domain === "shots") {
      db!.prepare("DELETE FROM shot_reviews WHERE shot_id = ?").run(id);
      db!.prepare("DELETE FROM prompt_versions WHERE shot_id = ?").run(id);
    }
    db!.prepare("DELETE FROM domain_entities WHERE id = ?").run(id);
    deleted += 1;
  };
  db!.exec("BEGIN IMMEDIATE");
  try {
    remove(rootId);
    if (rootDomain === "adaptations" && rootProjectId) {
      const project = one(
        "SELECT current_adaptation_id FROM projects WHERE id = ?",
        [rootProjectId],
      );
      if (project?.current_adaptation_id === rootId) {
        const fallback = one(
          "SELECT id FROM domain_entities WHERE domain = ? AND project_id = ? AND parent_id IS NULL ORDER BY updated_at DESC LIMIT 1",
          ["adaptations", rootProjectId],
        );
        db!
          .prepare(
            "UPDATE projects SET current_adaptation_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
          )
          .run(fallback?.id ?? null, timestamp(), rootProjectId);
      }
    }
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  return deleted;
}

function deleteReviewPackages(
  column: "adaptation_id" | "episode_id",
  value: string,
): void {
  db!
    .prepare(
      `DELETE FROM review_comments WHERE package_id IN (SELECT id FROM review_packages WHERE ${column} = ?)`,
    )
    .run(value);
  db!
    .prepare(
      `DELETE FROM review_decisions WHERE package_id IN (SELECT id FROM review_packages WHERE ${column} = ?)`,
    )
    .run(value);
  db!.prepare(`DELETE FROM review_packages WHERE ${column} = ?`).run(value);
}

function resolveCapability(
  token: string,
): Promise<{ path: string; permissions: string[] } | undefined> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      capabilityRequests.delete(requestId);
      reject(new Error("File capability resolution timed out"));
    }, 5_000);
    capabilityRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    hostPort.postMessage({ type: "capability:resolve", requestId, token });
  });
}

/**
 * Resolves a credential only inside the Server sidecar. The renderer never sees
 * the decrypted value and the database stores only its opaque reference.
 */
function resolveCredential(credentialRef: string): Promise<string | undefined> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      credentialRequests.delete(requestId);
      reject(new Error("Credential resolution timed out"));
    }, 5_000);
    credentialRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    hostPort.postMessage({
      type: "credential:resolve",
      requestId,
      credentialRef,
    });
  });
}

function openAiModelsEndpoint(baseUrl: string): string {
  const source = new URL(baseUrl.trim());
  if (source.protocol !== "https:" && source.protocol !== "http:")
    throw new Error("服务地址必须使用 HTTP 或 HTTPS 协议");
  if (source.username || source.password)
    throw new Error("服务地址不能包含账号或密码");
  const normalizedPath = source.pathname.replace(/\/+$/, "");
  source.pathname = normalizedPath.endsWith("/models")
    ? normalizedPath
    : `${normalizedPath || ""}/models`;
  source.search = "";
  source.hash = "";
  return source.toString();
}

function providerModels(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { data?: unknown; models?: unknown }).data;
  if (Array.isArray(data))
    return data
      .map((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string"
          ? (item as { id: string }).id
          : undefined,
      )
      .filter((id): id is string => Boolean(id))
      .slice(0, 12);
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string"
        ? (item as { name: string }).name.replace(/^models\//, "")
        : undefined,
    )
    .filter((id): id is string => Boolean(id))
    .slice(0, 12);
}

type ProviderConnectionProtocol =
  "openai" | "anthropic" | "google" | "stable-diffusion-webui";

function providerConnectionProtocol(
  payload: Record<string, unknown>,
): ProviderConnectionProtocol {
  if (imageProviderProtocol(payload) === "stable-diffusion-webui")
    return "stable-diffusion-webui";
  const protocol = text(payload["调用协议"])?.toLowerCase() ?? "";
  if (protocol.includes("anthropic")) return "anthropic";
  if (protocol.includes("google") || protocol.includes("gemini"))
    return "google";
  return "openai";
}

function providerModelsEndpoint(
  baseUrl: string,
  protocol: Exclude<ProviderConnectionProtocol, "stable-diffusion-webui">,
): string {
  if (protocol === "openai") return openAiModelsEndpoint(baseUrl);
  const source = new URL(baseUrl.trim());
  if (source.protocol !== "https:" && source.protocol !== "http:")
    throw new Error("服务地址必须使用 HTTP 或 HTTPS 协议");
  if (source.username || source.password)
    throw new Error("服务地址不能包含账号或密码");
  const path = source.pathname.replace(/\/+$/, "");
  if (protocol === "anthropic") {
    source.pathname = path.endsWith("/v1/models")
      ? path
      : path.endsWith("/v1")
        ? `${path}/models`
        : `${path || ""}/v1/models`;
  } else {
    source.pathname = path.endsWith("/models")
      ? path
      : path.endsWith("/v1beta")
        ? `${path}/models`
        : `${path || ""}/v1beta/models`;
  }
  source.search = "";
  source.hash = "";
  return source.toString();
}

async function testProviderConnection(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到服务商", requestId);
  const payload = domainPayload(provider.payload_json);
  const protocol = providerConnectionProtocol(payload);
  const baseUrl =
    text(payload["服务地址"]) ??
    (protocol === "anthropic"
      ? "https://api.anthropic.com"
      : protocol === "google"
        ? "https://generativelanguage.googleapis.com"
        : undefined);
  const credentialRef = text(payload["凭据引用"]);
  const isStableDiffusion = protocol === "stable-diffusion-webui";
  if (!baseUrl || (!isStableDiffusion && !credentialRef))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      isStableDiffusion
        ? "Stable Diffusion 服务需要服务地址"
        : "服务商需要服务地址和凭据引用",
      requestId,
    );
  let secret: string | undefined;
  const checkedAt = timestamp();
  let outcome: {
    providerId: string;
    ok: boolean;
    checkedAt: string;
    statusCode?: number;
    models: string[];
    message: string;
  };
  try {
    const endpoint = isStableDiffusion
      ? stableDiffusionOptionsEndpoint(baseUrl)
      : providerModelsEndpoint(baseUrl, protocol);
    if (credentialRef) {
      secret = await resolveCredential(credentialRef);
      if (!secret)
        return respondError(
          res,
          400,
          "VALIDATION_ERROR",
          "服务商凭据不可用",
          requestId,
        );
    }
    const response = await fetch(endpoint, {
      headers: {
        ...(secret && protocol === "anthropic"
          ? {
              "X-Api-Key": secret,
              "Anthropic-Version": "2023-06-01",
            }
          : secret && protocol === "google"
            ? { "X-Goog-Api-Key": secret }
            : secret
              ? { Authorization: `Bearer ${secret}` }
              : {}),
        Accept: "application/json",
        "User-Agent": "DramaIP-Desktop/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) throw new Error("服务响应超过安全大小限制");
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("服务响应超过安全大小限制");
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    const models = response.ok
      ? isStableDiffusion
        ? stableDiffusionModels(parsed)
        : providerModels(parsed)
      : [];
    outcome = {
      providerId: id,
      ok: response.ok,
      checkedAt,
      statusCode: response.status,
      models,
      message: response.ok
        ? models.length
          ? `连接成功，已发现 ${models.length} 个可用模型。`
          : "连接成功，服务未返回模型列表。"
        : `服务返回 HTTP ${response.status}，请检查地址、密钥或服务权限。`,
    };
  } catch (error) {
    outcome = {
      providerId: id,
      ok: false,
      checkedAt,
      models: [],
      message:
        error instanceof Error && error.message.includes("服务")
          ? error.message
          : "无法连接到服务，请检查网络、服务地址和本地代理设置。",
    };
  } finally {
    secret = undefined;
  }
  const updatedPayload = {
    ...payload,
    连接状态: outcome.ok ? "连接正常" : "连接失败",
    最近测试: outcome.checkedAt,
    可用模型: outcome.models.join("、"),
    测试说明: outcome.message,
  };
  db!
    .prepare(
      "UPDATE domain_entities SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(updatedPayload), timestamp(), id);
  const updated = domainEntity(
    one("SELECT * FROM domain_entities WHERE id = ?", [id])!,
  );
  emit("providers.connection_tested", { provider: updated, outcome });
  json(res, 200, outcome);
}

type OpenCodeProviderConfiguration = {
  providerId: string;
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  credentialRef: string;
  environmentName:
    "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
};

function activeAgentProviderId(): string | undefined {
  const configured = one(
    "SELECT provider_id FROM agent_engine_config WHERE singleton = 1",
  );
  return configured ? String(configured.provider_id) : undefined;
}

function openCodeProviderConfiguration(
  provider: Record<string, any>,
): OpenCodeProviderConfiguration {
  const payload = domainPayload(provider.payload_json);
  const serviceType = text(payload["服务类型"]);
  const credentialRef = text(payload["凭据引用"]);
  const model = text(payload["模型名称"]);
  const baseUrl = text(payload["服务地址"]);
  if (serviceType !== "智能模型")
    throw new Error("仅“智能模型”类型的服务商可供智能助手使用");
  if (!credentialRef || !model)
    throw new Error("智能助手模型需要模型名称和安全凭据引用");
  const protocol = text(payload["调用协议"])?.toLowerCase() ?? "";
  const providerKind = protocol.includes("anthropic")
    ? "anthropic"
    : protocol.includes("google") || protocol.includes("gemini")
      ? "google"
      : "openai";
  if (baseUrl) {
    const address = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(address.protocol) ||
      address.username ||
      address.password
    )
      throw new Error("智能助手服务地址必须是无账号密码的 HTTP 或 HTTPS 地址");
  }
  return {
    providerId: String(provider.id),
    providerKind,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    credentialRef,
    environmentName:
      providerKind === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : providerKind === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY",
  };
}

async function requestOpenCodeConfiguration(
  configuration: OpenCodeProviderConfiguration,
): Promise<{ available: boolean; message?: string }> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      opencodeConfigurationRequests.delete(requestId);
      reject(new Error("智能助手引擎配置超时"));
    }, 20_000);
    opencodeConfigurationRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    hostPort.postMessage({
      type: "opencode:configure",
      requestId,
      configuration,
    });
  });
}

async function activateProviderForAgent(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [id, "providers"],
  );
  if (!provider)
    return respondError(res, 404, "NOT_FOUND", "未找到模型服务商", requestId);
  let configuration: OpenCodeProviderConfiguration;
  try {
    configuration = openCodeProviderConfiguration(provider);
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "模型服务商配置无效",
      requestId,
    );
  }
  let engine: { available: boolean; message?: string };
  try {
    engine = await requestOpenCodeConfiguration(configuration);
  } catch (error) {
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "智能助手引擎暂不可用",
      requestId,
    );
  }
  if (!engine.available)
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      engine.message ?? "智能助手引擎暂不可用",
      requestId,
    );
  const activatedAt = timestamp();
  db!
    .prepare(
      `INSERT INTO agent_engine_config (singleton, provider_id, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET provider_id = excluded.provider_id, updated_at = excluded.updated_at`,
    )
    .run(id, activatedAt);
  if (command?.opencode) command.opencode.healthy = true;
  const outcome = {
    providerId: id,
    engineAvailable: true,
    providerKind: configuration.providerKind,
    model: configuration.model,
    activatedAt,
    message: "已设为智能助手模型，后续任务将通过受控 OpenCode 会话调用。",
  };
  emit("providers.agent_activated", outcome);
  json(res, 200, outcome);
}

async function restoreActiveAgentProvider(): Promise<void> {
  const providerId = activeAgentProviderId();
  if (!providerId) return;
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [providerId, "providers"],
  );
  if (!provider) {
    db!.prepare("DELETE FROM agent_engine_config WHERE singleton = 1").run();
    return;
  }
  try {
    const result = await requestOpenCodeConfiguration(
      openCodeProviderConfiguration(provider),
    );
    if (command?.opencode) command.opencode.healthy = result.available;
  } catch {
    if (command?.opencode) command.opencode.healthy = false;
  }
}

function stableDiffusionOptionsEndpoint(baseUrl: string): string {
  return stableDiffusionImageEndpoint(baseUrl).replace(/txt2img$/, "options");
}

function stableDiffusionModels(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const model = text((value as Record<string, unknown>).sd_model_checkpoint);
  return model ? [model] : [];
}

function jsonStringArray(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function storyBibleSettings(row: Record<string, unknown>) {
  return {
    projectId: String(row.project_id),
    autoSuggest: Number(row.auto_suggest) === 1,
    updatedAt: String(row.updated_at),
  };
}

function storyBibleChangeSet(row: Record<string, unknown>) {
  const draft = domainPayload(row.payload_json);
  const memory = domainPayload(draft.memory);
  const memoryPayload = domainPayload(memory.payload);
  const previewFields = [
    "章节摘要",
    "重要事件",
    "人物变化与秘密",
    "新增或回收伏笔",
  ].flatMap((key) => {
    const value = text(memoryPayload[key]);
    return value ? [{ key, value }] : [];
  });
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterId: String(row.chapter_id),
    sourceVersion: Number(row.source_version),
    status: String(row.status),
    summary: String(row.summary),
    ...(row.task_id ? { taskId: String(row.task_id) } : {}),
    conflictNotes: jsonStringArray(row.conflict_notes_json),
    preview: {
      title: text(memory.title) ?? String(row.summary),
      fields: previewFields,
    },
    ...(row.applied_at ? { appliedAt: String(row.applied_at) } : {}),
    ...(row.undone_at ? { undoneAt: String(row.undone_at) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function storyBibleStaleMark(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterId: String(row.chapter_id),
    reason: String(row.reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function storyBibleSourceHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function storyBibleDraft(chapterRow: Record<string, unknown>) {
  const content = String(chapterRow.content ?? "").trim();
  const summary = String(chapterRow.summary ?? "").trim();
  const excerpt = content.replace(/\s+/g, " ").slice(0, 300);
  const chapterTitle = String(chapterRow.title);
  return {
    summary:
      summary ||
      `${chapterTitle}：${excerpt}${content.length > excerpt.length ? "…" : ""}`,
    memory: {
      title: `《${chapterTitle}》章节记忆`,
      payload: {
        关联章节: chapterTitle,
        章节摘要: summary || excerpt,
        重要事件: String(chapterRow.main_conflict ?? "") || "待人工补充",
        人物变化与秘密: String(chapterRow.highlight ?? "") || "待人工补充",
        新增或回收伏笔: String(chapterRow.cliffhanger ?? "") || "待人工补充",
      },
    },
  };
}

function getStoryBibleSettings(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const existing = one(
    "SELECT * FROM story_bible_settings WHERE project_id = ?",
    [projectId],
  );
  json(
    res,
    200,
    existing
      ? storyBibleSettings(existing)
      : { projectId, autoSuggest: false, updatedAt: timestamp() },
  );
}

async function updateStoryBibleSettings(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  requestId: string,
): Promise<void> {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const input = await body(req);
  if (typeof input.autoSuggest !== "boolean")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "autoSuggest is required",
      requestId,
    );
  const now = timestamp();
  db!
    .prepare(
      `INSERT INTO story_bible_settings(project_id, auto_suggest, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET auto_suggest = excluded.auto_suggest, updated_at = excluded.updated_at`,
    )
    .run(projectId, input.autoSuggest ? 1 : 0, now);
  const updated = storyBibleSettings(
    one("SELECT * FROM story_bible_settings WHERE project_id = ?", [
      projectId,
    ])!,
  );
  emit("story_bible.settings_updated", updated);
  json(res, 200, updated);
}

function listStoryBibleChangeSets(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM story_bible_change_sets WHERE project_id = ? ORDER BY updated_at DESC",
      [projectId],
    ).map(storyBibleChangeSet),
  );
}

function listStoryBibleStaleMarks(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM story_bible_stale_marks WHERE project_id = ? AND resolved_at IS NULL ORDER BY updated_at DESC",
      [projectId],
    ).map(storyBibleStaleMark),
  );
}

function createStoryBibleChangeSetForChapter(
  chapterRow: Record<string, unknown>,
) {
  const projectId = String(chapterRow.project_id);
  const chapterId = String(chapterRow.id);
  const content = String(chapterRow.content ?? "").trim();
  if (!content) throw new Error("章节正文为空，无法生成故事圣经建议");
  const hash = storyBibleSourceHash(content);
  const duplicate = one(
    `SELECT * FROM story_bible_change_sets
     WHERE project_id = ? AND chapter_id = ? AND source_content_hash = ?
       AND status IN ('queued', 'draft', 'paused')`,
    [projectId, chapterId, hash],
  );
  if (duplicate) return storyBibleChangeSet(duplicate);
  const now = timestamp();
  const id = randomUUID();
  const taskId = randomUUID();
  const draft = storyBibleDraft(chapterRow);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        "story_bible.suggest",
        "succeeded",
        `提取故事圣经变更：${String(chapterRow.title)}`,
        projectId,
        JSON.stringify({ changeSetId: id, summary: draft.summary }),
        now,
        now,
      );
    db!
      .prepare(
        `INSERT INTO story_bible_change_sets(
          id, project_id, chapter_id, source_version, source_content_hash, status,
          summary, task_id, conflict_notes_json, payload_json, created_entity_ids_json,
          error_message, applied_at, undone_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, '[]', ?, '[]', NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        projectId,
        chapterId,
        Number(chapterRow.version),
        hash,
        draft.summary,
        taskId,
        JSON.stringify(draft),
        now,
        now,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const created = storyBibleChangeSet(
    one("SELECT * FROM story_bible_change_sets WHERE id = ?", [id])!,
  );
  emit(
    "task.created",
    task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
  );
  emit("story_bible.draft_created", created);
  return created;
}

async function queueStoryBibleChangeSet(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const chapterId = text(input.chapterId);
  if (!projectId || !chapterId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId and chapterId are required",
      requestId,
    );
  const chapterRow = one(
    "SELECT * FROM chapters WHERE id = ? AND project_id = ?",
    [chapterId, projectId],
  );
  if (!chapterRow)
    return respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
  try {
    json(res, 201, createStoryBibleChangeSetForChapter(chapterRow));
  } catch (error) {
    respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to create story bible draft",
      requestId,
    );
  }
}

function markStoryBibleStaleForChapter(
  projectId: string,
  chapterId: string,
): void {
  const now = timestamp();
  db!
    .prepare(
      `UPDATE story_bible_change_sets SET status = 'stale', updated_at = ?
       WHERE project_id = ? AND chapter_id = ? AND status IN ('queued', 'draft', 'applied', 'paused')`,
    )
    .run(now, projectId, chapterId);
  const existing = one(
    "SELECT id FROM story_bible_stale_marks WHERE project_id = ? AND chapter_id = ? AND resolved_at IS NULL",
    [projectId, chapterId],
  );
  if (!existing) {
    db!
      .prepare(
        "INSERT INTO story_bible_stale_marks VALUES (?, ?, ?, ?, NULL, ?, ?)",
      )
      .run(
        randomUUID(),
        projectId,
        chapterId,
        "章节正文已更新，需要重新核对故事圣经。",
        now,
        now,
      );
  }
  emit("story_bible.stale", { projectId, chapterId });
}

function maybeAutoSuggestStoryBibleChangeSet(
  chapterRow: Record<string, unknown>,
): void {
  const setting = one(
    "SELECT auto_suggest FROM story_bible_settings WHERE project_id = ?",
    [chapterRow.project_id],
  );
  if (
    Number(setting?.auto_suggest) !== 1 ||
    !String(chapterRow.content ?? "").trim()
  )
    return;
  try {
    createStoryBibleChangeSetForChapter(chapterRow);
  } catch {
    // A failed suggestion must never prevent the user's chapter from being saved.
  }
}

async function applyStoryBibleChangeSet(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one("SELECT * FROM story_bible_change_sets WHERE id = ?", [
    id,
  ]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Story bible change set not found",
      requestId,
    );
  if (current.status !== "draft")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Only a draft story bible change set can be applied",
      requestId,
    );
  const input = await body(req);
  const requestedFields = Array.isArray(input.fields)
    ? input.fields.filter((value): value is string => typeof value === "string")
    : undefined;
  const selectableFields = [
    "章节摘要",
    "重要事件",
    "人物变化与秘密",
    "新增或回收伏笔",
  ];
  if (
    requestedFields &&
    (!requestedFields.length ||
      requestedFields.some((field) => !selectableFields.includes(field)))
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Selected story bible fields are invalid",
      requestId,
    );
  const chapterRow = one("SELECT * FROM chapters WHERE id = ?", [
    current.chapter_id,
  ]);
  if (
    !chapterRow ||
    storyBibleSourceHash(String(chapterRow.content ?? "")) !==
      current.source_content_hash
  ) {
    markStoryBibleStaleForChapter(
      String(current.project_id),
      String(current.chapter_id),
    );
    return respondError(
      res,
      409,
      "CONFLICT",
      "Chapter changed since the story bible draft was created",
      requestId,
    );
  }
  const payload = domainPayload(current.payload_json);
  const memory = domainPayload(payload.memory);
  const memoryPayload = domainPayload(memory.payload);
  const selectedMemoryPayload = requestedFields
    ? {
        ...(memoryPayload["关联章节"] === undefined
          ? {}
          : { 关联章节: memoryPayload["关联章节"] }),
        ...Object.fromEntries(
          requestedFields.flatMap((field) =>
            memoryPayload[field] === undefined
              ? []
              : [[field, memoryPayload[field]]],
          ),
        ),
      }
    : memoryPayload;
  const now = timestamp();
  const memoryId = randomUUID();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "INSERT INTO domain_entities VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?)",
      )
      .run(
        memoryId,
        "chapter-memories",
        current.project_id,
        String(memory.title ?? `《${chapterRow.title}》章节记忆`),
        JSON.stringify({
          ...selectedMemoryPayload,
          来源变更集: current.id,
          来源章节版本: Number(current.source_version),
        }),
        now,
        now,
      );
    db!
      .prepare(
        "UPDATE story_bible_change_sets SET status = ?, created_entity_ids_json = ?, applied_at = ?, updated_at = ? WHERE id = ?",
      )
      .run("applied", JSON.stringify([memoryId]), now, now, id);
    db!
      .prepare(
        "UPDATE story_bible_stale_marks SET resolved_at = ?, updated_at = ? WHERE project_id = ? AND chapter_id = ? AND resolved_at IS NULL",
      )
      .run(now, now, current.project_id, current.chapter_id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const updated = storyBibleChangeSet(
    one("SELECT * FROM story_bible_change_sets WHERE id = ?", [id])!,
  );
  emit("story_bible.applied", updated);
  json(res, 200, updated);
}

function undoStoryBibleChangeSet(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM story_bible_change_sets WHERE id = ?", [
    id,
  ]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Story bible change set not found",
      requestId,
    );
  if (!["applied", "stale"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Only an applied or stale story bible change set can be undone",
      requestId,
    );
  const ids = jsonStringArray(current.created_entity_ids_json);
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    const remove = db!.prepare(
      "DELETE FROM domain_entities WHERE id = ? AND project_id = ?",
    );
    ids.forEach((entityId) => remove.run(entityId, current.project_id));
    db!
      .prepare(
        "UPDATE story_bible_change_sets SET status = ?, undone_at = ?, updated_at = ? WHERE id = ?",
      )
      .run("discarded", now, now, id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const updated = storyBibleChangeSet(
    one("SELECT * FROM story_bible_change_sets WHERE id = ?", [id])!,
  );
  emit("story_bible.undone", updated);
  json(res, 200, updated);
}

async function setStoryBibleChangeSetStatus(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = one("SELECT * FROM story_bible_change_sets WHERE id = ?", [
    id,
  ]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Story bible change set not found",
      requestId,
    );
  const input = await body(req);
  const status = text(input.status);
  if (!status || !["queued", "paused", "skipped", "discarded"].includes(status))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid story bible change set status",
      requestId,
    );
  if (["applied", "stale"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Applied or stale story bible change sets cannot be paused or discarded",
      requestId,
    );
  db!
    .prepare(
      "UPDATE story_bible_change_sets SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, timestamp(), id);
  const updated = storyBibleChangeSet(
    one("SELECT * FROM story_bible_change_sets WHERE id = ?", [id])!,
  );
  emit("story_bible.status_updated", updated);
  json(res, 200, updated);
}

async function createProject(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const title = text(input.title);
  const shortDramaType = text(input.shortDramaType);
  const synopsis = textValue(input.synopsis, "");
  if (!title || !shortDramaType)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "title and shortDramaType are required",
      requestId,
    );
  const now = timestamp();
  const id = randomUUID();
  db!
    .prepare(
      `INSERT INTO projects (
        id, title, short_drama_type, target_audience, target_word_count,
        target_episode_count, core_hook, emotional_core, core_selling_point,
        synopsis, style_guide, visual_style_direction, genre_opportunity,
        production_brief, deleted_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    )
    .run(
      id,
      title,
      shortDramaType,
      optionalText(input.targetAudience),
      optionalInteger(input.targetWordCount),
      optionalInteger(input.targetEpisodeCount),
      optionalText(input.coreHook),
      optionalText(input.emotionalCore),
      optionalText(input.coreSellingPoint),
      synopsis,
      optionalText(input.styleGuide),
      optionalText(input.visualStyleDirection),
      optionalText(input.genreOpportunity),
      optionalText(input.productionBrief),
      now,
      now,
    );
  const created = one("SELECT * FROM projects WHERE id = ?", [id]);
  emit("project.created", project(created!));
  json(res, 201, project(created!));
}

function getProject(res: ServerResponse, id: string, requestId: string): void {
  const item = one("SELECT * FROM projects WHERE id = ?", [id]);
  if (item) json(res, 200, project(item));
  else respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
}

async function updateProject(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const current = one("SELECT * FROM projects WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (input.version !== current.version)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Project changed in another session",
      requestId,
      { current: project(current) },
    );
  const title =
    typeof input.title === "string" ? input.title.trim() : current.title;
  const shortDramaType =
    typeof input.shortDramaType === "string"
      ? input.shortDramaType.trim()
      : current.short_drama_type;
  const synopsis = textValue(input.synopsis, current.synopsis);
  if (!title || !shortDramaType)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "title and shortDramaType are required",
      requestId,
    );
  db!
    .prepare(
      `UPDATE projects SET
        title = ?, short_drama_type = ?, target_audience = ?, target_word_count = ?,
        target_episode_count = ?, core_hook = ?, emotional_core = ?, core_selling_point = ?,
        synopsis = ?, style_guide = ?, visual_style_direction = ?, genre_opportunity = ?,
        production_brief = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .run(
      title,
      shortDramaType,
      patchOptionalText(input.targetAudience, current.target_audience),
      patchOptionalInteger(input.targetWordCount, current.target_word_count),
      patchOptionalInteger(
        input.targetEpisodeCount,
        current.target_episode_count,
      ),
      patchOptionalText(input.coreHook, current.core_hook),
      patchOptionalText(input.emotionalCore, current.emotional_core),
      patchOptionalText(input.coreSellingPoint, current.core_selling_point),
      synopsis,
      patchOptionalText(input.styleGuide, current.style_guide),
      patchOptionalText(
        input.visualStyleDirection,
        current.visual_style_direction,
      ),
      patchOptionalText(input.genreOpportunity, current.genre_opportunity),
      patchOptionalText(input.productionBrief, current.production_brief),
      timestamp(),
      id,
      current.version,
    );
  const updated = one("SELECT * FROM projects WHERE id = ?", [id])!;
  emit("project.updated", project(updated));
  json(res, 200, project(updated));
}

/** Persist the project-level active adaptation after verifying ownership. */
async function selectCurrentAdaptation(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const adaptationId = text(input.adaptationId);
  const current = one("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (!adaptationId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "adaptationId is required",
      requestId,
    );
  const adaptation = one(
    "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
    [adaptationId, "adaptations", projectId],
  );
  if (!adaptation)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation does not belong to this project",
      requestId,
    );
  db!
    .prepare(
      "UPDATE projects SET current_adaptation_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(adaptationId, timestamp(), projectId);
  const updated = one("SELECT * FROM projects WHERE id = ?", [projectId])!;
  emit("project.current_adaptation_updated", project(updated));
  json(res, 200, project(updated));
}

/**
 * Reorder a complete set of production siblings.  We intentionally reject a
 * partial list and stale version instead of silently producing two competing
 * scene or shot orders.
 */
async function reorderProductionChildren(
  req: IncomingMessage,
  res: ServerResponse,
  domain: "episodes" | "scenes" | "shots",
  parentId: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const requested = Array.isArray(input.items)
    ? input.items.filter(
        (item): item is { id: string; version: number } =>
          Boolean(item) &&
          typeof item.id === "string" &&
          Number.isInteger(item.version),
      )
    : [];
  const parentDomain =
    domain === "episodes"
      ? "adaptations"
      : domain === "scenes"
        ? "scripts"
        : "scenes";
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      parentId,
      parentDomain,
    ])
  )
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Production parent was not found",
      requestId,
    );
  const current = rows(
    `SELECT * FROM domain_entities
     WHERE domain = ? AND parent_id = ?
     ORDER BY COALESCE(CAST(json_extract(payload_json, '$.排序') AS INTEGER), 2147483647), created_at`,
    [domain, parentId],
  );
  if (
    requested.length !== current.length ||
    new Set(requested.map((item) => item.id)).size !== requested.length ||
    current.some((row) => {
      const expected = requested.find((item) => item.id === String(row.id));
      return !expected || expected.version !== Number(row.version);
    })
  )
    return respondError(
      res,
      409,
      "CONFLICT",
      "Production order changed; refresh before reordering",
      requestId,
      { current: current.map(domainEntity) },
    );
  const now = timestamp();
  const update = db!.prepare(
    "UPDATE domain_entities SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND parent_id = ? AND domain = ?",
  );
  db!.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, item] of requested.entries()) {
      const row = current.find(
        (candidate) => String(candidate.id) === item.id,
      )!;
      const payload = domainPayload(row.payload_json);
      payload["排序"] = index + 1;
      update.run(JSON.stringify(payload), now, item.id, parentId, domain);
    }
    db!.exec("COMMIT");
  } catch (error) {
    db!.exec("ROLLBACK");
    throw error;
  }
  const records = rows(
    `SELECT * FROM domain_entities
     WHERE domain = ? AND parent_id = ?
     ORDER BY COALESCE(CAST(json_extract(payload_json, '$.排序') AS INTEGER), 2147483647), created_at`,
    [domain, parentId],
  ).map(domainEntity);
  emit(`${domain}.reordered`, {
    parentId,
    recordIds: records.map((record) => record.id),
  });
  json(res, 200, { records });
}

function getScriptReview(
  res: ServerResponse,
  scriptId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      scriptId,
      "scripts",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Script not found", requestId);
  const existing = one("SELECT * FROM script_reviews WHERE script_id = ?", [
    scriptId,
  ]);
  json(res, 200, existing ? scriptReview(existing) : null);
}

function getEpisodeAnalysis(
  res: ServerResponse,
  adaptationId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      adaptationId,
      "adaptations",
    ])
  )
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation not found",
      requestId,
    );
  const existing = one(
    "SELECT * FROM episode_analyses WHERE adaptation_id = ?",
    [adaptationId],
  );
  json(res, 200, existing ? episodeAnalysis(existing) : null);
}

function runEpisodeAnalysis(
  res: ServerResponse,
  adaptationId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      adaptationId,
      "adaptations",
    ])
  )
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation not found",
      requestId,
    );
  const episodes = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND parent_id = ? ORDER BY COALESCE(CAST(json_extract(payload_json, '$.排序') AS INTEGER), 2147483647), created_at",
    ["episodes", adaptationId],
  );
  const coverage = (keys: string[]): number => {
    if (!episodes.length) return 0;
    const filled = episodes.filter((episode) => {
      const payload = domainPayload(episode.payload_json);
      return keys.some((key) => stringPayload(payload, key).trim().length > 0);
    }).length;
    return roundScore((filled / episodes.length) * 100);
  };
  const hookCoverage = coverage(["分集钩子", "钩子", "开场钩子"]);
  const cliffhangerCoverage = coverage(["结尾悬念", "悬念", "反转"]);
  const outlineCoverage = coverage(["分集简介", "分集大纲", "剧情概要"]);
  const overallScore = roundScore(
    (hookCoverage + cliffhangerCoverage + outlineCoverage) / 3,
  );
  const suggestions: string[] = [];
  if (!episodes.length) suggestions.push("先建立分集后再运行结构分析。");
  if (hookCoverage < 80)
    suggestions.push("为缺少开场钩子的分集补充首屏冲突或明确目标。");
  if (cliffhangerCoverage < 80)
    suggestions.push("为缺少结尾悬念的分集设计可见的未解问题或反转。");
  if (outlineCoverage < 80)
    suggestions.push("补充分集简介，明确本集推进、冲突与情绪落点。");
  const summary = episodes.length
    ? `已检查 ${episodes.length} 集：钩子覆盖 ${hookCoverage}%，结尾悬念覆盖 ${cliffhangerCoverage}%，分集简介覆盖 ${outlineCoverage}%。`
    : "当前改编方案尚未建立分集，无法进行结构覆盖分析。";
  const now = timestamp();
  const existing = one(
    "SELECT id FROM episode_analyses WHERE adaptation_id = ?",
    [adaptationId],
  );
  if (existing)
    db!
      .prepare(
        "UPDATE episode_analyses SET episode_count = ?, hook_coverage = ?, cliffhanger_coverage = ?, outline_coverage = ?, overall_score = ?, summary = ?, suggestions_json = ?, updated_at = ? WHERE adaptation_id = ?",
      )
      .run(
        episodes.length,
        hookCoverage,
        cliffhangerCoverage,
        outlineCoverage,
        overallScore,
        summary,
        JSON.stringify(suggestions),
        now,
        adaptationId,
      );
  else
    db!
      .prepare(
        "INSERT INTO episode_analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        adaptationId,
        episodes.length,
        hookCoverage,
        cliffhangerCoverage,
        outlineCoverage,
        overallScore,
        summary,
        JSON.stringify(suggestions),
        now,
        now,
      );
  const analysis = episodeAnalysis(
    one("SELECT * FROM episode_analyses WHERE adaptation_id = ?", [
      adaptationId,
    ])!,
  );
  emit("adaptation.episode_analysis_updated", analysis);
  json(res, 200, analysis);
}

function removeEpisodeAnalysis(
  res: ServerResponse,
  adaptationId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      adaptationId,
      "adaptations",
    ])
  )
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation not found",
      requestId,
    );
  db!
    .prepare("DELETE FROM episode_analyses WHERE adaptation_id = ?")
    .run(adaptationId);
  emit("adaptation.episode_analysis_deleted", { adaptationId });
  res.writeHead(204).end();
}

function listComplianceProfiles(res: ServerResponse): void {
  json(
    res,
    200,
    rows(
      "SELECT * FROM compliance_rule_profiles ORDER BY active DESC, published_at DESC",
    ).map(complianceRuleProfile),
  );
}

function activateComplianceProfile(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM compliance_rule_profiles WHERE id = ?", [
    id,
  ]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Compliance profile not found",
      requestId,
    );
  if (
    current.source_status !== "official" ||
    current.integrity_status !== "verified" ||
    Number(current.built_in) !== 1
  )
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Only a verified official built-in profile may become active",
      requestId,
    );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare("UPDATE compliance_rule_profiles SET active = 0, updated_at = ?")
      .run(now);
    db!
      .prepare(
        "UPDATE compliance_rule_profiles SET active = 1, updated_at = ? WHERE id = ?",
      )
      .run(now, id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const activated = complianceRuleProfile(
    one("SELECT * FROM compliance_rule_profiles WHERE id = ?", [id])!,
  );
  emit("compliance.profile_activated", activated);
  json(res, 200, activated);
}

async function runCompliancePreflight(
  req: IncomingMessage,
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): Promise<void> {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const input = await body(req);
  const title = text(input.title)?.trim();
  const subtitleLanguage = text(input.subtitleLanguage)?.trim();
  const deliveryDate = text(input.deliveryDate)?.trim();
  if (!title || !subtitleLanguage || !deliveryDate)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Title, subtitle language and delivery date are required",
      requestId,
    );
  const profileRow = one(
    "SELECT * FROM compliance_rule_profiles WHERE active = 1 ORDER BY updated_at DESC LIMIT 1",
  );
  const profile = profileRow ? complianceRuleProfile(profileRow) : undefined;
  const blockers: string[] = [];
  const warnings: string[] = [
    "当前版本生成合规预检证据，不会渲染、加水印或伪造合规 MP4；最终媒体封装仍须由受控渲染流程完成。",
  ];
  if (!profile)
    blockers.push("没有启用的合规规则档案；未知规则不能静默放行。 ");
  else {
    if (profile.integrityStatus !== "verified")
      blockers.push("规则档案未通过本地完整性校验，不能用于交付。 ");
    if (profile.sourceStatus !== "official")
      blockers.push("当前规则档案不是正式规则，不能作为强制交付依据。 ");
    if (profile.effectiveAt && deliveryDate < profile.effectiveAt.slice(0, 10))
      warnings.push(
        `当前交付日期早于规则生效日 ${profile.effectiveAt.slice(0, 10)}，仍保留标识作为保守实践。`,
      );
    const targetPlatform = text(input.targetPlatform)?.trim();
    const targetRegion = text(input.targetRegion)?.trim();
    if (
      targetPlatform &&
      profile.platforms.length &&
      !profile.platforms.includes(targetPlatform)
    )
      warnings.push(
        `规则档案未明确覆盖平台“${targetPlatform}”，请在提交前核对最新要求。`,
      );
    if (
      targetRegion &&
      profile.regions.length &&
      !profile.regions.includes(targetRegion)
    )
      warnings.push(
        `规则档案未明确覆盖地区“${targetRegion}”，请使用对应地区的已验证规则。`,
      );
  }
  if (input.aigcDeclared !== true)
    blockers.push(
      "请明确声明此交付包含 AI 生成或合成内容；系统不会代替用户作出声明。 ",
    );
  if (input.manualContentReviewConfirmed !== true)
    blockers.push(
      "请完成人工内容复核：未成年人、历史/民俗、版权、许可证或备案。 ",
    );
  const supporting = rows(
    "SELECT * FROM domain_entities WHERE project_id = ? AND parent_id = ?",
    [context.projectId, episodeId],
  );
  if (!supporting.some((item) => item.domain === "quality"))
    blockers.push("尚未保存当前分集的质量检查结果。 ");
  const assets = rows(
    "SELECT id FROM domain_entities WHERE project_id = ? AND domain = ?",
    [context.projectId, "assets"],
  );
  const rights = rows(
    "SELECT id FROM domain_entities WHERE project_id = ? AND domain = ?",
    [context.projectId, "rights"],
  );
  if (assets.length && !rights.length)
    blockers.push("项目已有素材但尚未记录版权或授权依据。 ");
  const scriptText = rows(
    `SELECT scripts.payload_json FROM domain_entities AS scripts
     WHERE scripts.domain = 'scripts' AND scripts.project_id = ? AND scripts.parent_id = ?`,
    [context.projectId, episodeId],
  )
    .map((script) => JSON.stringify(domainPayload(script.payload_json)))
    .join("\n");
  const flags = [
    "盗版",
    "侵权",
    "未授权",
    "血腥",
    "自杀",
    "仇恨",
    "诽谤",
  ].filter((keyword) => scriptText.includes(keyword));
  if (flags.length)
    warnings.push(`剧本命中需人工核验的风险词：${flags.join("、")}。`);
  const sourceFingerprint = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        episodeId,
        profile: profile?.version,
        title,
        subtitleLanguage,
        deliveryDate,
        targetPlatform: text(input.targetPlatform),
        targetRegion: text(input.targetRegion),
        supporting: supporting
          .map((item) => `${item.domain}:${item.id}:${item.version}`)
          .sort(),
        assets: assets.map((item) => item.id).sort(),
        rights: rights.map((item) => item.id).sort(),
        declared: input.aigcDeclared === true,
        manualReview: input.manualContentReviewConfirmed === true,
      }),
    )
    .digest("hex")}`;
  const metadata = profile
    ? {
        "dramaip:aigc": "true",
        "dramaip:rule-profile": profile.version,
        "dramaip:rule-source": profile.sourceUrl,
        "dramaip:source-fingerprint": sourceFingerprint,
        "dramaip:subtitle-language": subtitleLanguage,
        title,
      }
    : {};
  json(res, 200, {
    ok: blockers.length === 0,
    ...(profile ? { profile, visibleLabel: profile.requiredVisibleLabel } : {}),
    blockers,
    warnings,
    metadata,
    sourceFingerprint,
  });
}

function listDeliveryCreativeVariants(
  res: ServerResponse,
  adaptationId: string,
  requestId: string,
): void {
  if (!adaptationForDelivery(adaptationId))
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation not found",
      requestId,
    );
  json(
    res,
    200,
    rows(
      "SELECT * FROM delivery_creative_variants WHERE adaptation_id = ? ORDER BY CASE status WHEN 'adopted' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, version_number DESC",
      [adaptationId],
    ).map(deliveryCreativeVariant),
  );
}

async function createDeliveryCreativeVariant(
  req: IncomingMessage,
  res: ServerResponse,
  adaptationId: string,
  requestId: string,
): Promise<void> {
  const adaptation = adaptationForDelivery(adaptationId);
  if (!adaptation)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Adaptation not found",
      requestId,
    );
  const input = await body(req);
  const label = text(input.label)?.trim();
  const title = text(input.title)?.trim();
  const description = text(input.description)?.trim();
  const tags = Array.isArray(input.tags)
    ? input.tags
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const coverAssetId = optionalText(input.coverAssetId) ?? undefined;
  const source = input.source === "ai_draft" ? "ai_draft" : "manual";
  if (!label || !title || !description || !tags.length)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Candidate label, title, description and at least one tag are required",
      requestId,
    );
  if (
    coverAssetId &&
    !one(
      "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
      [coverAssetId, "assets", adaptation.project_id],
    )
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Cover asset does not belong to the adaptation project",
      requestId,
    );
  const id = randomUUID();
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    const versionNumber = Number(
      one(
        "SELECT COALESCE(MAX(version_number), 0) AS version FROM delivery_creative_variants WHERE adaptation_id = ?",
        [adaptationId],
      )?.version ?? 0,
    );
    db!
      .prepare(
        "INSERT INTO delivery_creative_variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        adaptation.project_id,
        adaptationId,
        label,
        title,
        description,
        JSON.stringify(tags),
        coverAssetId ?? null,
        source,
        "candidate",
        versionNumber + 1,
        now,
        now,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const created = deliveryCreativeVariant(
    one("SELECT * FROM delivery_creative_variants WHERE id = ?", [id])!,
  );
  emit("platform_delivery.variant_created", created);
  json(res, 201, created);
}

function adoptDeliveryCreativeVariant(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM delivery_creative_variants WHERE id = ?", [
    id,
  ]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Delivery variant not found",
      requestId,
    );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE delivery_creative_variants SET status = ?, updated_at = ? WHERE adaptation_id = ? AND status = ?",
      )
      .run("archived", now, current.adaptation_id, "adopted");
    db!
      .prepare(
        "UPDATE delivery_creative_variants SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run("adopted", now, id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const adopted = deliveryCreativeVariant(
    one("SELECT * FROM delivery_creative_variants WHERE id = ?", [id])!,
  );
  emit("platform_delivery.variant_adopted", adopted);
  json(res, 200, adopted);
}

function listPlatformDeliveryArchives(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  if (!episodeDeliveryContext(episodeId))
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM platform_delivery_archives WHERE episode_id = ? ORDER BY created_at DESC",
      [episodeId],
    ).map(platformDeliveryArchive),
  );
}

async function runPlatformDeliveryPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): Promise<void> {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const input = await body(req);
  const result = evaluatePlatformDeliveryPreflight(context, input);
  json(res, 200, result);
}

async function createPlatformDeliveryArchive(
  req: IncomingMessage,
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): Promise<void> {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const input = await body(req);
  const result = evaluatePlatformDeliveryPreflight(context, input);
  if (!result.ok)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Platform delivery preflight did not pass",
      requestId,
      result,
    );
  const profile = result.profile!;
  const variantId = text(input.creativeVariantId)!;
  const nextVersion = Number(
    one(
      "SELECT COALESCE(MAX(delivery_version), 0) AS version FROM platform_delivery_archives WHERE episode_id = ? AND profile_id = ?",
      [episodeId, profile.id],
    )?.version ?? 0,
  );
  const id = randomUUID();
  db!
    .prepare(
      "INSERT INTO platform_delivery_archives VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      context.projectId,
      context.adaptationId,
      episodeId,
      profile.id,
      profile.version,
      variantId,
      nextVersion + 1,
      result.sourceFingerprint!,
      JSON.stringify(result),
      timestamp(),
    );
  const archive = platformDeliveryArchive(
    one("SELECT * FROM platform_delivery_archives WHERE id = ?", [id])!,
  );
  emit("platform_delivery.archive_created", archive);
  json(res, 201, archive);
}

function exportPlatformDeliveryArchive(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const archive = one("SELECT * FROM platform_delivery_archives WHERE id = ?", [
    id,
  ]);
  if (!archive)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Platform delivery archive not found",
      requestId,
    );
  const variant = one("SELECT * FROM delivery_creative_variants WHERE id = ?", [
    archive.creative_variant_id,
  ]);
  const episode = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [archive.episode_id, "episodes"],
  );
  const profile = PLATFORM_DELIVERY_PROFILES.find(
    (item) => item.id === archive.profile_id,
  );
  const preflight = domainPayload(archive.preflight_json);
  const manifest = {
    schemaVersion: "dramaip.platform-delivery-archive.v1",
    archive: platformDeliveryArchive(archive),
    profile,
    episode: episode
      ? { id: String(episode.id), title: String(episode.title) }
      : { id: String(archive.episode_id), title: "已删除分集" },
    creativeVariant: variant ? deliveryCreativeVariant(variant) : undefined,
    preflight,
    manualSubmission: {
      required: true,
      note: "此文件是平台提交资料清单，不包含、不会伪造也不会自动上传视频、字幕、封面或平台后台结果。请人工附加已核验媒体并在目标平台完成最终复核。",
    },
  };
  const fileBase = safeFileName(
    `${profile?.filenamePrefix ?? "平台交付"}-${episode?.title ?? "分集"}-v${String(archive.delivery_version).padStart(3, "0")}`,
  );
  json(res, 200, {
    fileName: `${fileBase}-提交资料清单.json`,
    mimeType: "application/json",
    content: JSON.stringify(manifest, null, 2),
  });
}

function adaptationForDelivery(
  adaptationId: string,
): Record<string, any> | undefined {
  return one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ? AND project_id IS NOT NULL",
    [adaptationId, "adaptations"],
  );
}

function episodeDeliveryContext(
  episodeId: string,
):
  | { episode: Record<string, any>; adaptationId: string; projectId: string }
  | undefined {
  const episode = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [episodeId, "episodes"],
  );
  if (!episode?.parent_id || !episode.project_id) return undefined;
  const adaptation = adaptationForDelivery(String(episode.parent_id));
  if (!adaptation || adaptation.project_id !== episode.project_id)
    return undefined;
  return {
    episode,
    adaptationId: String(adaptation.id),
    projectId: String(episode.project_id),
  };
}

function evaluatePlatformDeliveryPreflight(
  context: {
    episode: Record<string, any>;
    adaptationId: string;
    projectId: string;
  },
  input: Record<string, any>,
) {
  const profileId = text(input.profileId);
  const creativeVariantId = text(input.creativeVariantId);
  const profile = PLATFORM_DELIVERY_PROFILES.find(
    (item) => item.id === profileId,
  );
  const variant = creativeVariantId
    ? one("SELECT * FROM delivery_creative_variants WHERE id = ?", [
        creativeVariantId,
      ])
    : undefined;
  const blockers: string[] = [];
  const warnings: string[] = [
    "当前版本只生成可保存的提交资料清单；真实成片、字幕和封面必须由人工附加并在目标平台完成最终复核。",
  ];
  if (!profile)
    blockers.push("未找到平台交付档案；未知规则不能创建提交资料清单。");
  if (
    !variant ||
    variant.project_id !== context.projectId ||
    variant.adaptation_id !== context.adaptationId
  )
    blockers.push("创意候选不属于当前项目和改编方案。");
  else {
    if (variant.status !== "adopted")
      blockers.push("请先显式采用一个创意候选后再归档交付资料。");
    if (!String(variant.title).trim()) blockers.push("创意候选缺少平台标题。");
    if (!String(variant.description).trim())
      blockers.push("创意候选缺少平台简介。");
    if (!jsonStringArray(variant.tags_json).length)
      blockers.push("创意候选至少需要一个标签词。");
    if (!variant.cover_asset_id)
      blockers.push("创意候选缺少已归档封面素材引用。");
    else if (
      !one(
        "SELECT id FROM domain_entities WHERE id = ? AND domain = ? AND project_id = ?",
        [variant.cover_asset_id, "assets", context.projectId],
      )
    )
      blockers.push("创意候选引用的封面素材已不存在或不属于当前项目。");
  }
  if (profile?.manualFields.length && input.manualFieldsConfirmed !== true)
    blockers.push(`请确认人工核对：${profile.manualFields.join("；")}。`);
  const children = rows(
    "SELECT * FROM domain_entities WHERE parent_id = ? AND project_id = ?",
    [context.episode.id, context.projectId],
  );
  const has = (domain: string) =>
    children.some((item) => item.domain === domain);
  const adoptedLocalization = children.some(
    (item) =>
      item.domain === "localization" &&
      stringPayload(domainPayload(item.payload_json), "采用状态") === "已采用",
  );
  if (!has("quality")) blockers.push("尚未保存质量检查结果。");
  if (!has("compliance")) blockers.push("尚未保存合规检查结果。");
  if (!has("review")) blockers.push("尚未保存审片记录或审片包。");
  if (!adoptedLocalization)
    blockers.push("尚未采用本地化版本，无法归档字幕交付依据。");
  const sourceFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        episodeId: context.episode.id,
        profileId: profile?.id,
        profileVersion: profile?.version,
        variantId: variant?.id,
        variantVersion: variant?.version_number,
        variantUpdatedAt: variant?.updated_at,
        supportingRecordIds: children
          .filter((item) =>
            ["quality", "compliance", "review", "localization"].includes(
              String(item.domain),
            ),
          )
          .map((item) => `${item.domain}:${item.id}:${item.version}`)
          .sort(),
        manualFieldsConfirmed: input.manualFieldsConfirmed === true,
      }),
    )
    .digest("hex");
  return {
    ok: blockers.length === 0,
    ...(profile ? { profile } : {}),
    blockers,
    warnings,
    expectedFiles: [
      "平台提交资料清单.json",
      "人工附加：当前合规成片",
      "人工附加：已采用字幕文件",
      "人工附加：已核验封面文件",
    ],
    ...(profile
      ? {
          finalBaseName: `${profile.filenamePrefix}-${safeFileName(String(variant?.title ?? "提交资料"))}`,
        }
      : {}),
    sourceFingerprint: `sha256:${sourceFingerprint}`,
  };
}

const TIMELINE_TRACK_DEFINITIONS: Array<{
  kind: TimelineTrackKind;
  label: string;
}> = [
  { kind: "video", label: "视频" },
  { kind: "dialogue", label: "对白" },
  { kind: "narration", label: "旁白" },
  { kind: "bgm", label: "配乐" },
  { kind: "sfx", label: "音效" },
  { kind: "subtitle", label: "字幕" },
];

type StoredTimeline = TimelineManifest;

function timelineTime(value: number): number {
  return Math.round(value * 25) / 25;
}

function timelineMediaStatus(
  assetId: string | undefined,
): "linked" | "missing" | "unsupported" | "proxy" | "unattached" {
  if (!assetId) return "unattached";
  const asset = one("SELECT * FROM domain_entities WHERE id = ?", [assetId]);
  if (!asset) return "missing";
  const file = domainPayload(asset.payload_json).file;
  const storedName =
    file && typeof file === "object"
      ? safeStoredAssetName((file as Record<string, unknown>).storedName)
      : undefined;
  if (!storedName) return "unattached";
  if (!hasArchivedFile(asset)) return "missing";
  if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".gif",
      ".mp3",
      ".wav",
      ".ogg",
      ".m4a",
      ".mp4",
      ".webm",
    ].includes(extname(storedName).toLowerCase())
  )
    return "linked";
  return "unsupported";
}

function timelineDuration(tracks: StoredTimeline["tracks"]): number {
  return timelineTime(
    tracks.reduce(
      (latest, track) =>
        Math.max(
          latest,
          ...track.clips.map(
            (clip) => clip.startSeconds + clip.durationSeconds,
          ),
        ),
      0,
    ),
  );
}

function parseTimelineManifest(value: unknown): StoredTimeline | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const manifest = value as Partial<StoredTimeline>;
  if (
    manifest.format !== "dramaip-timeline" ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.tracks) ||
    !manifest.id ||
    !manifest.projectId ||
    !manifest.adaptationId ||
    !manifest.episodeId
  )
    return undefined;
  return manifest as StoredTimeline;
}

function cloneTimeline(timeline: StoredTimeline): StoredTimeline {
  return JSON.parse(JSON.stringify(timeline)) as StoredTimeline;
}

function timelineForResponse(timeline: StoredTimeline): StoredTimeline {
  const next = cloneTimeline(timeline);
  next.tracks = next.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({
      ...clip,
      ...(clip.assetId
        ? { mediaStatus: timelineMediaStatus(clip.assetId) }
        : {}),
    })),
  }));
  next.durationSeconds = timelineDuration(next.tracks);
  return next;
}

function audioAssemblyDefaults(kind: AudioTrackKind): {
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  duckingGain?: number;
} {
  if (kind === "bgm")
    return {
      volume: 0.24,
      fadeInSeconds: 0.4,
      fadeOutSeconds: 0.6,
      duckingGain: 0.55,
    };
  if (kind === "sfx")
    return { volume: 0.62, fadeInSeconds: 0.04, fadeOutSeconds: 0.12 };
  return { volume: 1, fadeInSeconds: 0.04, fadeOutSeconds: 0.08 };
}

function audioAssemblyLineage(assetId: string | undefined): {
  provider: string;
  cost?: number;
  rightsStatus: "cleared" | "unknown" | "restricted";
} {
  if (!assetId) return { provider: "未绑定素材", rightsStatus: "unknown" };
  const asset = one("SELECT * FROM domain_entities WHERE id = ?", [assetId]);
  if (!asset) return { provider: "缺失素材", rightsStatus: "restricted" };
  const payload = domainPayload(asset.payload_json);
  const provider =
    firstTextPayload(payload, ["来源", "服务商", "Provider", "生成服务商"]) ||
    "本地导入";
  const rawRights = firstTextPayload(payload, [
    "权利状态",
    "授权状态",
    "版权状态",
    "许可",
  ]).toLowerCase();
  const rightsStatus = /受限|禁止|未授权|restricted|denied|blocked/.test(
    rawRights,
  )
    ? "restricted"
    : /已授权|许可|可用|cleared|licensed|approved/.test(rawRights)
      ? "cleared"
      : "unknown";
  const rawCost =
    payload["成本（元）"] ?? payload["成本"] ?? payload["实际成本"];
  const cost = typeof rawCost === "number" ? rawCost : Number(rawCost);
  return {
    provider,
    ...(Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    rightsStatus,
  };
}

function subtitleParts(value: string): string[] {
  const source = value.trim();
  if (!source) return [];
  const parts: string[] = [];
  let current = "";
  for (const character of Array.from(source)) {
    current += character;
    if (
      current.length >= 18 ||
      (/[。！？!?；;，,]/u.test(character) && current.length >= 6)
    ) {
      parts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function subtitleCuesForAssemblyClip(clip: {
  id: string;
  audioTrackId: string;
  sourceClipId: string;
  shotId?: string;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
}): Array<{
  id: string;
  audioTrackId: string;
  sourceClipId: string;
  shotId?: string;
  startSeconds: number;
  durationSeconds: number;
  text: string;
}> {
  const parts = subtitleParts(clip.text ?? "");
  if (!parts.length) return [];
  const slice = clip.durationSeconds / parts.length;
  return parts.map((textValue, index) => {
    const startSeconds = timelineTime(clip.startSeconds + slice * index);
    const endSeconds = timelineTime(
      index === parts.length - 1
        ? clip.startSeconds + clip.durationSeconds
        : clip.startSeconds + slice * (index + 1),
    );
    return {
      id: `timeline-subtitle-${clip.audioTrackId}-${clip.sourceClipId}-${index}`,
      audioTrackId: clip.audioTrackId,
      sourceClipId: clip.sourceClipId,
      ...(clip.shotId ? { shotId: clip.shotId } : {}),
      startSeconds,
      durationSeconds: Math.max(0.04, timelineTime(endSeconds - startSeconds)),
      text: textValue,
    };
  });
}

function audioAssemblySubtitleExports(
  cues: Array<{ startSeconds: number; durationSeconds: number; text: string }>,
): { srt: string; webVtt: string } {
  const entries = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${timelineSubtitleTime(cue.startSeconds)} --> ${timelineSubtitleTime(cue.startSeconds + cue.durationSeconds)}\n${cue.text}`,
    )
    .join("\n\n");
  return {
    srt: entries ? `${entries}\n` : "",
    webVtt: entries
      ? `WEBVTT\n\n${entries.replaceAll(/(\d{2}:\d{2}:\d{2}),/g, "$1.")}\n`
      : "WEBVTT\n",
  };
}

function buildAudioAssemblyPreview(episodeId: string):
  | {
      timeline: StoredTimeline;
      sourceFingerprint: string;
      clips: Array<{
        id: string;
        audioTrackId: string;
        sourceClipId: string;
        kind: AudioTrackKind;
        name: string;
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        text?: string;
        startSeconds: number;
        durationSeconds: number;
        volume: number;
        fadeInSeconds: number;
        fadeOutSeconds: number;
        duckingGain?: number;
        overflowSeconds: number;
        provider: string;
        cost?: number;
        rightsStatus: "cleared" | "unknown" | "restricted";
      }>;
      subtitleCues: Array<{
        id: string;
        audioTrackId: string;
        sourceClipId: string;
        shotId?: string;
        startSeconds: number;
        durationSeconds: number;
        text: string;
      }>;
      warnings: string[];
      protectedClipIds: string[];
      staleTrackIds: string[];
    }
  | undefined {
  const context = episodeMediaContext(episodeId);
  const timeline = getOrCreateTimeline(episodeId);
  if (!context || !timeline) return undefined;
  const audioRows = rows(
    "SELECT * FROM audio_tracks WHERE episode_id = ? AND status = ? ORDER BY updated_at DESC, rowid DESC",
    [episodeId, "adopted"],
  );
  const freshRows = audioRows.filter((row) => !audioTrackIsStale(row, context));
  const staleTrackIds = audioRows
    .filter((row) => audioTrackIsStale(row, context))
    .map((row) => String(row.id));
  const videoRanges = new Map(
    (timeline.tracks.find((track) => track.kind === "video")?.clips ?? [])
      .filter((clip) => Boolean(clip.shotId))
      .map((clip) => [
        clip.shotId!,
        {
          startSeconds: clip.startSeconds,
          durationSeconds: clip.durationSeconds,
        },
      ]),
  );
  const warnings: string[] = [];
  if (staleTrackIds.length)
    warnings.push(
      "已排除与当前剧本或分镜不一致的已采用音轨；仅相关音频和字幕需要局部重生成。",
    );
  const clips = freshRows.flatMap((row) => {
    const kind = String(row.kind) as AudioTrackKind;
    const defaults = audioAssemblyDefaults(kind);
    return parseAudioTrackClips(row.clips_json).map((source) => {
      const range = source.shotId ? videoRanges.get(source.shotId) : undefined;
      const startSeconds = timelineTime(
        (range?.startSeconds ?? 0) + source.startSeconds,
      );
      const overflowSeconds = range
        ? timelineTime(
            Math.max(
              0,
              startSeconds +
                source.durationSeconds -
                (range.startSeconds + range.durationSeconds),
            ),
          )
        : 0;
      const lineage = audioAssemblyLineage(source.assetId);
      if (overflowSeconds > 0)
        warnings.push(
          `「${String(row.label)}」有 ${overflowSeconds.toFixed(2)} 秒超出镜头范围；请审查 time-stretch 或改词建议，系统不会静默裁断。`,
        );
      if (lineage.rightsStatus === "restricted")
        warnings.push(`「${String(row.label)}」的素材权利受限，不能自动采用。`);
      if (!source.assetId)
        warnings.push(
          `「${String(row.label)}」未绑定音频素材，可审查定位但不能试听。`,
        );
      return {
        id: `timeline-audio-${String(row.id)}-${source.id}`,
        audioTrackId: String(row.id),
        sourceClipId: source.id,
        kind,
        name: String(row.label),
        ...(source.shotId ? { shotId: source.shotId } : {}),
        ...(source.assetId ? { assetId: source.assetId } : {}),
        ...(source.voiceProfileId
          ? { voiceProfileId: source.voiceProfileId }
          : {}),
        ...(source.text ? { text: source.text } : {}),
        startSeconds,
        durationSeconds: timelineTime(source.durationSeconds),
        ...defaults,
        overflowSeconds,
        ...lineage,
      };
    });
  });
  const subtitleCues = clips.flatMap((clip) =>
    ["dialogue", "narration"].includes(clip.kind)
      ? subtitleCuesForAssemblyClip(clip)
      : [],
  );
  const protectedClipIds = timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.manuallyEdited || clip.locked)
      .map((clip) => clip.id),
  );
  return {
    timeline,
    sourceFingerprint: context.sourceFingerprint,
    clips: clips.sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.id.localeCompare(right.id),
    ),
    subtitleCues: subtitleCues.sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.id.localeCompare(right.id),
    ),
    warnings: [...new Set(warnings)],
    protectedClipIds,
    staleTrackIds,
  };
}

function getAudioAssemblyPreview(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const preview = buildAudioAssemblyPreview(episodeId);
  if (!preview)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const exports = audioAssemblySubtitleExports(preview.subtitleCues);
  json(res, 200, {
    timelineId: preview.timeline.id,
    timelineVersion: preview.timeline.version,
    sourceFingerprint: preview.sourceFingerprint,
    clips: preview.clips,
    subtitleCues: preview.subtitleCues,
    ...exports,
    warnings: preview.warnings,
    protectedClipIds: preview.protectedClipIds,
    staleTrackIds: preview.staleTrackIds,
  });
}

async function applyAudioAssembly(
  req: IncomingMessage,
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): Promise<void> {
  const input = (await body(req)) as Partial<AudioAssemblyApplyInput>;
  if (
    !Number.isInteger(input.timelineVersion) ||
    !Array.isArray(input.audioTrackIds) ||
    !input.audioTrackIds.every((id) => typeof id === "string") ||
    typeof input.includeSubtitles !== "boolean"
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "自动编排需要当前时间线版本、音轨选择和字幕采用选择。",
      requestId,
    );
  const preview = buildAudioAssemblyPreview(episodeId);
  if (!preview)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  if (input.timelineVersion !== preview.timeline.version)
    return respondError(
      res,
      409,
      "CONFLICT",
      "时间线已更新，请重新审查自动编排预览。",
      requestId,
      { current: timelineForResponse(preview.timeline) },
    );
  const selectedTrackIds = [...new Set(input.audioTrackIds)];
  const availableTrackIds = new Set(
    preview.clips.map((clip) => clip.audioTrackId),
  );
  if (selectedTrackIds.some((id) => !availableTrackIds.has(id)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "所选音轨不存在、已过期或尚未采用；请刷新预览。",
      requestId,
    );
  const selected = new Set(selectedTrackIds);
  const selectedClips = preview.clips.filter((clip) =>
    selected.has(clip.audioTrackId),
  );
  const restricted = selectedClips.find(
    (clip) => clip.rightsStatus === "restricted",
  );
  if (restricted)
    return respondError(
      res,
      409,
      "CONFLICT",
      `素材「${restricted.name}」权利受限，不能自动采用。`,
      requestId,
    );
  const before = cloneTimeline(preview.timeline);
  const next = cloneTimeline(preview.timeline);
  const protectedIds = new Set(preview.protectedClipIds);
  for (const track of next.tracks) {
    if (!["dialogue", "narration", "bgm", "sfx"].includes(track.kind)) continue;
    const desired = selectedClips.filter((clip) => clip.kind === track.kind);
    if (!desired.length) continue;
    const retained = track.clips.filter(
      (clip) =>
        !selected.has(clip.audioTrackId ?? "") || protectedIds.has(clip.id),
    );
    const retainedIds = new Set(retained.map((clip) => clip.id));
    track.clips = [
      ...retained,
      ...desired
        .filter((clip) => !retainedIds.has(clip.id))
        .map((clip) => ({
          id: clip.id,
          shotId: clip.shotId,
          assetId: clip.assetId,
          audioTrackId: clip.audioTrackId,
          name: clip.name,
          startSeconds: clip.startSeconds,
          durationSeconds: clip.durationSeconds,
          sourceOffsetSeconds: 0,
          mediaStatus: timelineMediaStatus(clip.assetId),
          ...(clip.text ? { text: clip.text } : {}),
          volume: clip.volume,
          fadeInSeconds: clip.fadeInSeconds,
          fadeOutSeconds: clip.fadeOutSeconds,
          ...(clip.duckingGain ? { duckingGain: clip.duckingGain } : {}),
          locked: false,
          manuallyEdited: false,
        })),
    ].sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.id.localeCompare(right.id),
    );
  }
  if (input.includeSubtitles) {
    const subtitleTrack = next.tracks.find(
      (track) => track.kind === "subtitle",
    );
    if (subtitleTrack) {
      const desired = preview.subtitleCues.filter((cue) =>
        selected.has(cue.audioTrackId),
      );
      const selectedShotIds = new Set(
        desired.flatMap((cue) => (cue.shotId ? [cue.shotId] : [])),
      );
      const retained = subtitleTrack.clips.filter(
        (clip) =>
          protectedIds.has(clip.id) ||
          (!selected.has(clip.audioTrackId ?? "") &&
            !(
              !clip.audioTrackId &&
              clip.shotId &&
              selectedShotIds.has(clip.shotId)
            )),
      );
      const retainedIds = new Set(retained.map((clip) => clip.id));
      subtitleTrack.clips = [
        ...retained,
        ...desired
          .filter((cue) => !retainedIds.has(cue.id))
          .map((cue) => ({
            id: cue.id,
            sourceClipId: cue.sourceClipId,
            ...(cue.shotId ? { shotId: cue.shotId } : {}),
            audioTrackId: cue.audioTrackId,
            name: "自动字幕",
            startSeconds: cue.startSeconds,
            durationSeconds: cue.durationSeconds,
            sourceOffsetSeconds: 0,
            mediaStatus: "linked" as const,
            text: cue.text,
            locked: false,
            manuallyEdited: false,
          })),
      ].sort(
        (left, right) =>
          left.startSeconds - right.startSeconds ||
          left.id.localeCompare(right.id),
      );
    }
  }
  next.sourceFingerprint = preview.sourceFingerprint;
  const saved = timelineWithVersion(next, preview.timeline.version + 1);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "DELETE FROM timeline_history WHERE timeline_id = ? AND undone = 1",
      )
      .run(saved.id);
    db!
      .prepare(
        "UPDATE timelines SET source_fingerprint = ?, manifest_json = ?, version = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        saved.sourceFingerprint,
        JSON.stringify(saved),
        saved.version,
        saved.updatedAt,
        saved.id,
      );
    db!
      .prepare(
        "INSERT INTO timeline_history (id, timeline_id, command_json, before_json, after_json, undone, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      )
      .run(
        randomUUID(),
        saved.id,
        JSON.stringify({
          type: "apply-audio-assembly",
          audioTrackIds: selectedTrackIds,
          includeSubtitles: input.includeSubtitles,
        }),
        JSON.stringify(before),
        JSON.stringify(saved),
        saved.updatedAt,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  emit("timeline.audio-assembly-applied", {
    id: saved.id,
    audioTrackIds: selectedTrackIds,
    includeSubtitles: input.includeSubtitles,
    version: saved.version,
  });
  json(res, 200, timelineForResponse(saved));
}

function buildInitialTimeline(context: {
  episode: Record<string, any>;
  adaptationId: string;
  projectId: string;
}): StoredTimeline {
  const mediaContext = episodeMediaContext(String(context.episode.id));
  const sourceFingerprint =
    mediaContext?.sourceFingerprint ?? "sha256:unavailable";
  const now = timestamp();
  let cursor = 0;
  const videoClips = (mediaContext?.shots ?? []).map((shot) => {
    const durationSeconds = timelineTime(shotDuration(shot));
    const source = visualSourceForShot(context.projectId, String(shot.id));
    const clip = {
      id: `timeline-video-${String(shot.id)}`,
      shotId: String(shot.id),
      ...(source ? { assetId: source.id } : {}),
      name: String(shot.title),
      startSeconds: timelineTime(cursor),
      durationSeconds,
      sourceOffsetSeconds: 0,
      mediaStatus: timelineMediaStatus(source?.id),
      manuallyEdited: false,
    };
    cursor += durationSeconds;
    return clip;
  });
  const audioRows = rows(
    "SELECT * FROM audio_tracks WHERE episode_id = ? AND status = ? ORDER BY updated_at DESC",
    [context.episode.id, "adopted"],
  ).filter((row) => !mediaContext || !audioTrackIsStale(row, mediaContext));
  const audioClipsByKind = new Map<
    TimelineTrackKind,
    StoredTimeline["tracks"][number]["clips"]
  >();
  for (const kind of ["dialogue", "narration", "bgm", "sfx"] as const) {
    const row = audioRows.find((item) => item.kind === kind);
    audioClipsByKind.set(
      kind,
      row
        ? parseAudioTrackClips(row.clips_json).map((clip) => ({
            id: `timeline-audio-${String(row.id)}-${clip.id}`,
            ...(clip.shotId ? { shotId: clip.shotId } : {}),
            ...(clip.assetId ? { assetId: clip.assetId } : {}),
            audioTrackId: String(row.id),
            name: String(row.label),
            startSeconds: timelineTime(clip.startSeconds),
            durationSeconds: timelineTime(clip.durationSeconds),
            sourceOffsetSeconds: 0,
            mediaStatus: timelineMediaStatus(clip.assetId),
            ...(clip.text ? { text: clip.text } : {}),
            ...audioAssemblyDefaults(kind),
            locked: false,
            manuallyEdited: false,
          }))
        : [],
    );
  }
  const subtitleClips = (mediaContext?.shots ?? []).flatMap((shot) => {
    const textValue = firstTextPayload(domainPayload(shot.payload_json), [
      "字幕",
      "字幕草稿",
      "对白",
      "旁白",
    ]);
    const video = videoClips.find((clip) => clip.shotId === String(shot.id));
    if (!textValue || !video) return [];
    return [
      {
        id: `timeline-subtitle-${String(shot.id)}`,
        shotId: String(shot.id),
        name: String(shot.title),
        startSeconds: video.startSeconds,
        durationSeconds: video.durationSeconds,
        sourceOffsetSeconds: 0,
        mediaStatus: "linked" as const,
        text: textValue,
        locked: false,
        manuallyEdited: false,
      },
    ];
  });
  const tracks = TIMELINE_TRACK_DEFINITIONS.map(({ kind, label }) => ({
    id: `timeline-track-${kind}`,
    kind,
    label,
    muted: false,
    solo: false,
    clips:
      kind === "video"
        ? videoClips
        : kind === "subtitle"
          ? subtitleClips
          : (audioClipsByKind.get(kind) ?? []),
  }));
  return {
    format: "dramaip-timeline",
    schemaVersion: 1,
    id: randomUUID(),
    projectId: context.projectId,
    adaptationId: context.adaptationId,
    episodeId: String(context.episode.id),
    sourceFingerprint,
    frameRate: 25,
    timebase: "seconds",
    durationSeconds: timelineDuration(tracks),
    tracks,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function getOrCreateTimeline(episodeId: string): StoredTimeline | undefined {
  const context = episodeDeliveryContext(episodeId);
  if (!context) return undefined;
  const current = one("SELECT * FROM timelines WHERE episode_id = ?", [
    episodeId,
  ]);
  if (current) {
    const parsed = parseTimelineManifest(current.manifest_json);
    if (parsed) return parsed;
  }
  const timeline = buildInitialTimeline(context);
  db!
    .prepare(
      "INSERT INTO timelines (id, project_id, adaptation_id, episode_id, source_fingerprint, manifest_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      timeline.id,
      timeline.projectId,
      timeline.adaptationId,
      timeline.episodeId,
      timeline.sourceFingerprint,
      JSON.stringify(timeline),
      timeline.version,
      timeline.createdAt,
      timeline.updatedAt,
    );
  emit("timeline.initialized", timeline);
  return timeline;
}

function getTimeline(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const timeline = getOrCreateTimeline(episodeId);
  if (!timeline)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  json(res, 200, timelineForResponse(timeline));
}

function timelineRow(id: string): Record<string, any> | undefined {
  return one("SELECT * FROM timelines WHERE id = ?", [id]);
}

function timelineWithVersion(
  timeline: StoredTimeline,
  version: number,
): StoredTimeline {
  const next = cloneTimeline(timeline);
  next.version = version;
  next.updatedAt = timestamp();
  next.durationSeconds = timelineDuration(next.tracks);
  return next;
}

function findTimelineClip(timeline: StoredTimeline, clipId: string) {
  for (const track of timeline.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return undefined;
}

function applyTimelineEdit(
  timeline: StoredTimeline,
  command: TimelineEditCommand,
  projectId: string,
): string | undefined {
  if (command.type === "set-track-audio") {
    const track = timeline.tracks.find((item) => item.id === command.trackId);
    if (!track) return "未找到目标轨道";
    if (command.muted === undefined && command.solo === undefined)
      return "请指定静音或独听状态";
    if (command.muted !== undefined) track.muted = command.muted;
    if (command.solo !== undefined) {
      if (command.solo)
        for (const item of timeline.tracks) item.solo = item.id === track.id;
      else track.solo = false;
    }
    return undefined;
  }
  const found = findTimelineClip(timeline, command.clipId);
  if (!found) return "未找到目标片段";
  const { track, clip, index } = found;
  if (command.type === "move") {
    if (
      !Number.isFinite(command.startSeconds) ||
      command.startSeconds < 0 ||
      command.startSeconds > 86_400
    )
      return "片段起点必须是非负时间";
    clip.startSeconds = timelineTime(command.startSeconds);
    clip.manuallyEdited = true;
    return undefined;
  }
  if (command.type === "trim") {
    if (
      !Number.isFinite(command.durationSeconds) ||
      command.durationSeconds <= 0 ||
      command.durationSeconds > 3_600
    )
      return "片段时长必须大于零";
    const startSeconds =
      command.startSeconds === undefined
        ? clip.startSeconds
        : timelineTime(command.startSeconds);
    if (
      !Number.isFinite(startSeconds) ||
      startSeconds < 0 ||
      startSeconds > 86_400
    )
      return "片段起点必须是非负时间";
    clip.sourceOffsetSeconds = timelineTime(
      clip.sourceOffsetSeconds + (startSeconds - clip.startSeconds),
    );
    clip.startSeconds = startSeconds;
    clip.durationSeconds = timelineTime(command.durationSeconds);
    clip.manuallyEdited = true;
    return undefined;
  }
  if (command.type === "split") {
    if (!Number.isFinite(command.atSeconds)) return "分割点必须是有效时间";
    const atSeconds = timelineTime(command.atSeconds);
    if (
      atSeconds <= clip.startSeconds ||
      atSeconds >= clip.startSeconds + clip.durationSeconds
    )
      return "分割点必须落在片段内部";
    const firstDuration = timelineTime(atSeconds - clip.startSeconds);
    const secondDuration = timelineTime(clip.durationSeconds - firstDuration);
    const second = {
      ...clip,
      id: randomUUID(),
      sourceClipId: clip.sourceClipId ?? clip.id,
      startSeconds: atSeconds,
      durationSeconds: secondDuration,
      sourceOffsetSeconds: timelineTime(
        clip.sourceOffsetSeconds + firstDuration,
      ),
      manuallyEdited: true,
    };
    clip.durationSeconds = firstDuration;
    clip.manuallyEdited = true;
    track.clips.splice(index + 1, 0, second);
    return undefined;
  }
  if (command.type === "relink") {
    const asset = one(
      "SELECT * FROM domain_entities WHERE id = ? AND project_id = ? AND domain IN ('assets', 'video', 'shot-stills', 'visual-assets')",
      [command.assetId, projectId],
    );
    if (!asset) return "重链接媒体不属于当前项目或不受支持";
    clip.assetId = command.assetId;
    clip.mediaStatus = timelineMediaStatus(command.assetId);
    clip.manuallyEdited = true;
    return undefined;
  }
  if (command.type === "set-clip-audio") {
    if (command.volume === undefined && command.locked === undefined)
      return "请指定音量或锁定状态";
    if (
      command.volume !== undefined &&
      (!Number.isFinite(command.volume) ||
        command.volume < 0 ||
        command.volume > 2)
    )
      return "音量必须在 0 到 2 之间";
    if (command.volume !== undefined) clip.volume = command.volume;
    if (command.locked !== undefined) clip.locked = command.locked;
    clip.manuallyEdited = true;
    return undefined;
  }
  return "不支持的时间线编辑命令";
}

async function applyTimelineCommand(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const current = timelineRow(id);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Timeline not found", requestId);
  const input = (await body(req)) as Partial<TimelineCommandInput>;
  const timeline = parseTimelineManifest(current.manifest_json);
  if (!timeline)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Timeline data is invalid",
      requestId,
    );
  if (
    !Number.isInteger(input.version) ||
    input.version !== Number(current.version)
  )
    return respondError(
      res,
      409,
      "CONFLICT",
      "时间线已被更新，请刷新后重试。",
      requestId,
      {
        current: timelineForResponse(timeline),
      },
    );
  const command = input.command as TimelineEditCommand | undefined;
  if (!command || typeof command.type !== "string")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "缺少有效的时间线编辑命令",
      requestId,
    );
  const before = cloneTimeline(timeline);
  const next = cloneTimeline(timeline);
  const problem = applyTimelineEdit(next, command, String(current.project_id));
  if (problem)
    return respondError(res, 400, "VALIDATION_ERROR", problem, requestId);
  const saved = timelineWithVersion(next, Number(current.version) + 1);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "DELETE FROM timeline_history WHERE timeline_id = ? AND undone = 1",
      )
      .run(id);
    db!
      .prepare(
        "UPDATE timelines SET source_fingerprint = ?, manifest_json = ?, version = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        saved.sourceFingerprint,
        JSON.stringify(saved),
        saved.version,
        saved.updatedAt,
        id,
      );
    db!
      .prepare(
        "INSERT INTO timeline_history (id, timeline_id, command_json, before_json, after_json, undone, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      )
      .run(
        randomUUID(),
        id,
        JSON.stringify(command),
        JSON.stringify(before),
        JSON.stringify(saved),
        saved.updatedAt,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  emit("timeline.edited", { id, command, version: saved.version });
  json(res, 200, timelineForResponse(saved));
}

function timelineHistory(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  if (!timelineRow(id))
    return respondError(res, 404, "NOT_FOUND", "Timeline not found", requestId);
  json(res, 200, {
    canUndo: Boolean(
      one(
        "SELECT id FROM timeline_history WHERE timeline_id = ? AND undone = 0 LIMIT 1",
        [id],
      ),
    ),
    canRedo: Boolean(
      one(
        "SELECT id FROM timeline_history WHERE timeline_id = ? AND undone = 1 LIMIT 1",
        [id],
      ),
    ),
  });
}

function restoreTimelineHistory(
  res: ServerResponse,
  id: string,
  direction: "undo" | "redo",
  requestId: string,
): void {
  const current = timelineRow(id);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Timeline not found", requestId);
  const history = one(
    `SELECT * FROM timeline_history WHERE timeline_id = ? AND undone = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [id, direction === "undo" ? 0 : 1],
  );
  if (!history)
    return respondError(
      res,
      409,
      "CONFLICT",
      direction === "undo" ? "没有可撤销的操作" : "没有可重做的操作",
      requestId,
    );
  const restored = parseTimelineManifest(
    direction === "undo" ? history.before_json : history.after_json,
  );
  if (!restored)
    return respondError(res, 409, "CONFLICT", "历史时间线数据无效", requestId);
  const saved = timelineWithVersion(restored, Number(current.version) + 1);
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE timelines SET manifest_json = ?, version = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(saved), saved.version, saved.updatedAt, id);
    db!
      .prepare("UPDATE timeline_history SET undone = ? WHERE id = ?")
      .run(direction === "undo" ? 1 : 0, history.id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  emit(`timeline.${direction}`, { id, version: saved.version });
  json(res, 200, timelineForResponse(saved));
}

function undoTimelineCommand(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  restoreTimelineHistory(res, id, "undo", requestId);
}

function redoTimelineCommand(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  restoreTimelineHistory(res, id, "redo", requestId);
}

function timelineMediaPreview(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const asset = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain IN ('assets', 'video', 'shot-stills', 'visual-assets')",
    [id],
  );
  if (!asset)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Timeline media not found",
      requestId,
    );
  const file = domainPayload(asset.payload_json).file;
  const storedName =
    file && typeof file === "object"
      ? safeStoredAssetName((file as Record<string, unknown>).storedName)
      : undefined;
  if (!storedName || !hasArchivedFile(asset))
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Timeline media file is missing",
      requestId,
    );
  const path = join(command!.assetDirectory, storedName);
  if (statSync(path).size > 12 * 1024 * 1024)
    return respondError(
      res,
      413,
      "VALIDATION_ERROR",
      "Timeline preview exceeds 12 MB",
      requestId,
    );
  const mime = (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
    } as Record<string, string>
  )[extname(storedName).toLowerCase()];
  if (!mime)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "媒体编码不受本地预览支持",
      requestId,
    );
  json(res, 200, {
    id,
    kind: mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "image",
    dataUrl: `data:${mime};base64,${readFileSync(path).toString("base64")}`,
  });
}

function getEditorTimeline(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  json(res, 200, buildEditorTimeline(context));
}

function getEditorTimelinePreflight(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  json(res, 200, editorTimelinePreflight(buildEditorTimeline(context)));
}

function exportEditorTimeline(
  res: ServerResponse,
  episodeId: string,
  format: "json" | "edl" | "fcpxml" | "srt",
  requestId: string,
): void {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const timeline = buildEditorTimeline(context);
  const preflight = editorTimelinePreflight(timeline);
  if (!preflight.canExport)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Editor timeline has blocking issues",
      requestId,
      preflight,
    );
  const base = safeFileName(timeline.title);
  const document =
    format === "json"
      ? {
          fileName: `${base}-剪辑时间线.json`,
          mimeType: "application/json",
          content: JSON.stringify(timeline, null, 2),
        }
      : format === "edl"
        ? {
            fileName: `${base}-剪辑时间线.edl`,
            mimeType: "text/plain",
            content: renderEditorEdl(timeline),
          }
        : format === "fcpxml"
          ? {
              fileName: `${base}-剪辑时间线.fcpxml`,
              mimeType: "application/xml",
              content: renderEditorFcpxml(timeline),
            }
          : {
              fileName: `${base}-字幕.srt`,
              mimeType: "application/x-subrip",
              content: renderTimelineSrt(timeline),
            };
  json(res, 200, document);
}

function listReviewPackages(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  if (!episodeDeliveryContext(episodeId))
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  json(
    res,
    200,
    rows(
      "SELECT * FROM review_packages WHERE episode_id = ? ORDER BY created_at DESC",
      [episodeId],
    ).map(reviewPackage),
  );
}

function createReviewPackage(
  res: ServerResponse,
  episodeId: string,
  requestId: string,
): void {
  const context = episodeDeliveryContext(episodeId);
  if (!context)
    return respondError(res, 404, "NOT_FOUND", "Episode not found", requestId);
  const manifest = buildEditorTimeline(context);
  const preflight = editorTimelinePreflight(manifest);
  if (!preflight.canExport)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Review package requires at least one shot",
      requestId,
      preflight,
    );
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare(
      "INSERT INTO review_packages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      context.projectId,
      context.adaptationId,
      episodeId,
      "offline",
      "exported",
      `${manifest.title}·离线审片包`,
      JSON.stringify(manifest),
      now,
      now,
    );
  const created = reviewPackage(
    one("SELECT * FROM review_packages WHERE id = ?", [id])!,
  );
  emit("review.package_created", created);
  json(res, 201, created);
}

function exportOfflineReviewPackage(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM review_packages WHERE id = ?", [id]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  const packageRecord = reviewPackage(current);
  json(res, 200, {
    fileName: `${safeFileName(packageRecord.title)}.html`,
    mimeType: "text/html",
    content: renderOfflineReviewHtml(packageRecord),
  });
}

function listReviewComments(
  res: ServerResponse,
  packageId: string,
  requestId: string,
): void {
  if (!reviewPackageExists(packageId))
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  json(
    res,
    200,
    rows(
      "SELECT * FROM review_comments WHERE package_id = ? ORDER BY created_at",
      [packageId],
    ).map(reviewComment),
  );
}

async function createReviewComment(
  req: IncomingMessage,
  res: ServerResponse,
  packageId: string,
  requestId: string,
): Promise<void> {
  const packageRecord = one("SELECT * FROM review_packages WHERE id = ?", [
    packageId,
  ]);
  if (!packageRecord)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  const input = await body(req);
  const created = insertReviewComment(packageRecord, input);
  if (!created)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Review comment must contain a body and a shot from this package when supplied",
      requestId,
    );
  emit("review.comment_created", created);
  json(res, 201, created);
}

async function resolveReviewComment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  if (typeof input.resolved !== "boolean")
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "resolved is required",
      requestId,
    );
  const current = one("SELECT * FROM review_comments WHERE id = ?", [id]);
  if (!current)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review comment not found",
      requestId,
    );
  db!
    .prepare(
      "UPDATE review_comments SET resolved = ?, updated_at = ? WHERE id = ?",
    )
    .run(input.resolved ? 1 : 0, timestamp(), id);
  const updated = reviewComment(
    one("SELECT * FROM review_comments WHERE id = ?", [id])!,
  );
  emit("review.comment_resolved", updated);
  json(res, 200, updated);
}

function listReviewDecisions(
  res: ServerResponse,
  packageId: string,
  requestId: string,
): void {
  if (!reviewPackageExists(packageId))
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  json(
    res,
    200,
    rows(
      "SELECT * FROM review_decisions WHERE package_id = ? ORDER BY created_at",
      [packageId],
    ).map(reviewDecision),
  );
}

async function createReviewDecision(
  req: IncomingMessage,
  res: ServerResponse,
  packageId: string,
  requestId: string,
): Promise<void> {
  const packageRecord = one("SELECT * FROM review_packages WHERE id = ?", [
    packageId,
  ]);
  if (!packageRecord)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  const input = await body(req);
  const created = insertReviewDecision(packageRecord, input);
  if (!created)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "A supported decision and an in-package shot are required when a shot is supplied",
      requestId,
    );
  emit("review.decision_created", created);
  json(res, 201, created);
}

async function importOfflineReviewComments(
  req: IncomingMessage,
  res: ServerResponse,
  packageId: string,
  requestId: string,
): Promise<void> {
  const packageRecord = one("SELECT * FROM review_packages WHERE id = ?", [
    packageId,
  ]);
  if (!packageRecord)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Review package not found",
      requestId,
    );
  const input = await body(req);
  const token = text(input.capabilityToken);
  if (!token)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "File capability is required",
      requestId,
    );
  const capability = await resolveCapability(token);
  if (!capability?.permissions.includes("read"))
    return respondError(
      res,
      401,
      "UNAUTHORIZED",
      "File capability is not valid",
      requestId,
    );
  try {
    const info = statSync(capability.path);
    if (info.size > 10 * 1024 * 1024)
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "Review comments file exceeds 10 MB",
        requestId,
      );
    const parsed = JSON.parse(readFileSync(capability.path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.format !== "dramaip-review-comments" ||
      parsed.version !== 1 ||
      parsed.packageId !== packageId ||
      !Array.isArray(parsed.comments)
    )
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "Offline review comments do not match this package",
        requestId,
      );
    let commentCount = 0;
    let decisionCount = 0;
    for (const entry of parsed.comments.slice(0, 5_000)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (insertReviewComment(packageRecord, record)) commentCount += 1;
      if (
        record.decision !== "note" &&
        insertReviewDecision(packageRecord, record)
      )
        decisionCount += 1;
    }
    emit("review.comments_imported", {
      packageId,
      commentCount,
      decisionCount,
    });
    json(res, 200, { packageId, commentCount, decisionCount });
  } catch (error) {
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to import offline review comments",
      requestId,
    );
  }
}

function buildEditorTimeline(context: {
  episode: Record<string, any>;
  adaptationId: string;
  projectId: string;
}) {
  const adaptation = adaptationForDelivery(context.adaptationId)!;
  const shots = rows(
    `SELECT shots.* FROM domain_entities AS shots
     JOIN domain_entities AS scenes ON scenes.id = shots.parent_id AND scenes.domain = 'scenes'
     JOIN domain_entities AS scripts ON scripts.id = scenes.parent_id AND scripts.domain = 'scripts'
     WHERE shots.domain = 'shots' AND shots.project_id = ? AND scripts.parent_id = ?
     ORDER BY COALESCE(CAST(json_extract(scenes.payload_json, '$.排序') AS INTEGER), 2147483647),
              COALESCE(CAST(json_extract(shots.payload_json, '$.排序') AS INTEGER), 2147483647), shots.created_at`,
    [context.projectId, context.episode.id],
  );
  let cursor = 0;
  const clips = shots.map((shot, orderIndex) => {
    const payload = domainPayload(shot.payload_json);
    const proposedDuration = Number(
      payload["时长秒"] ?? payload["时长"] ?? payload["镜头时长"],
    );
    const durationSeconds =
      Number.isFinite(proposedDuration) && proposedDuration > 0
        ? Math.min(proposedDuration, 600)
        : 3;
    const media = rows(
      "SELECT domain FROM domain_entities WHERE parent_id = ? AND domain IN ('video', 'shot-stills')",
      [shot.id],
    );
    const mediaKind = media.some((item) => item.domain === "video")
      ? "video"
      : media.some((item) => item.domain === "shot-stills")
        ? "still"
        : "slate";
    const clip = {
      id: `timeline-${String(shot.id)}`,
      shotId: String(shot.id),
      orderIndex,
      name: String(shot.title),
      startSeconds: roundTimelineSeconds(cursor),
      durationSeconds: roundTimelineSeconds(durationSeconds),
      ...(firstTextPayload(payload, ["字幕", "字幕草稿", "对白", "旁白"])
        ? {
            subtitle: firstTextPayload(payload, [
              "字幕",
              "字幕草稿",
              "对白",
              "旁白",
            ]),
          }
        : {}),
      transition:
        firstTextPayload(payload, ["转场"]) === "淡入淡出"
          ? "fade"
          : firstTextPayload(payload, ["转场"]) === "叠化"
            ? "dissolve"
            : "cut",
      mediaKind,
      mediaStatus: mediaKind === "slate" ? "needs_relink" : "referenced",
    };
    cursor += durationSeconds;
    return clip;
  });
  return {
    format: "dramaip-editor-timeline",
    version: 1,
    projectId: context.projectId,
    adaptationId: context.adaptationId,
    episodeId: String(context.episode.id),
    title: `${String(adaptation.title)} · ${String(context.episode.title)}`,
    frameRate: 25 as const,
    width: 1080,
    height: 1920,
    clips,
    createdAt: timestamp(),
  };
}

function editorTimelinePreflight(
  timeline: ReturnType<typeof buildEditorTimeline>,
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!timeline.clips.length)
    blockers.push("当前分集尚无可审分镜，无法生成剪辑时间线。");
  const referencedClipCount = timeline.clips.filter(
    (clip) => clip.mediaStatus === "referenced",
  ).length;
  const relinkRequiredCount = timeline.clips.length - referencedClipCount;
  if (relinkRequiredCount)
    warnings.push(
      `${relinkRequiredCount} 个分镜没有新版已引用媒体；导出的时间线会保留占位与字幕，需在剪辑软件中人工重链接。`,
    );
  warnings.push(
    "导出的 FCPXML/EDL/SRT 仅为可编辑交换资料，不会伪造、渲染或复制真实成片。",
  );
  return {
    canExport: blockers.length === 0,
    blockers,
    warnings,
    referencedClipCount,
    relinkRequiredCount,
  };
}

function renderEditorEdl(
  timeline: ReturnType<typeof buildEditorTimeline>,
): string {
  const lines = [`TITLE: ${timeline.title}`, "FCM: NON-DROP FRAME", ""];
  for (const clip of timeline.clips) {
    const start = timelineTimecode(clip.startSeconds, timeline.frameRate);
    const end = timelineTimecode(
      clip.startSeconds + clip.durationSeconds,
      timeline.frameRate,
    );
    lines.push(
      `${String(clip.orderIndex + 1).padStart(3, "0")}  AX       V     C        ${start} ${end} ${start} ${end}`,
      `* FROM CLIP NAME: ${clip.name}`,
      `* MEDIA: ${clip.mediaStatus === "referenced" ? "已引用，仍须人工重链接" : "占位，必须人工重链接"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderEditorFcpxml(
  timeline: ReturnType<typeof buildEditorTimeline>,
): string {
  const clips = timeline.clips
    .map(
      (clip) =>
        `      <gap name="${escapeXml(clip.name)}" offset="${roundTimelineSeconds(clip.startSeconds)}s" duration="${roundTimelineSeconds(clip.durationSeconds)}s" start="0s"><marker start="0s" value="${escapeXml(clip.mediaStatus === "referenced" ? "已引用媒体，需人工重链接" : "待人工重链接媒体")}"/></gap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<fcpxml version="1.10">\n  <resources><format id="r1" name="DramaIP 竖屏" frameDuration="1/${timeline.frameRate}s" width="${timeline.width}" height="${timeline.height}"/></resources>\n  <library><event name="DramaIP"><project name="${escapeXml(timeline.title)}"><sequence format="r1" tcStart="0s" tcFormat="NDF"><spine>\n${clips}\n    </spine></sequence></project></event></library>\n</fcpxml>\n`;
}

function renderTimelineSrt(
  timeline: ReturnType<typeof buildEditorTimeline>,
): string {
  return timeline.clips
    .filter((clip) => clip.subtitle?.trim())
    .map(
      (clip, index) =>
        `${index + 1}\n${timelineSubtitleTime(clip.startSeconds)} --> ${timelineSubtitleTime(clip.startSeconds + clip.durationSeconds)}\n${clip.subtitle!.trim()}`,
    )
    .join("\n\n")
    .concat(timeline.clips.some((clip) => clip.subtitle?.trim()) ? "\n" : "");
}

function reviewPackageExists(id: string): boolean {
  return Boolean(one("SELECT id FROM review_packages WHERE id = ?", [id]));
}

function insertReviewComment(
  packageRecord: Record<string, any>,
  input: Record<string, unknown>,
) {
  const bodyText = text(input.body)?.trim();
  const shotId = optionalText(input.shotId) ?? undefined;
  const manifest = domainPayload(packageRecord.manifest_json);
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
  if (
    !bodyText ||
    (shotId &&
      !clips.some(
        (clip) => clip && typeof clip === "object" && clip.shotId === shotId,
      ))
  )
    return undefined;
  const timecode = Number(input.timecodeSeconds);
  const timecodeSeconds =
    Number.isFinite(timecode) && timecode >= 0 ? timecode : undefined;
  const now = timestamp();
  const id =
    typeof input.id === "string" &&
    !one("SELECT id FROM review_comments WHERE id = ? AND package_id != ?", [
      input.id,
      packageRecord.id,
    ])
      ? input.id
      : randomUUID();
  const existing = one("SELECT id FROM review_comments WHERE id = ?", [id]);
  if (existing)
    db!
      .prepare(
        "UPDATE review_comments SET shot_id = ?, timecode_seconds = ?, author_alias = ?, body = ?, resolved = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        shotId ?? null,
        timecodeSeconds ?? null,
        optionalText(input.authorAlias),
        bodyText,
        input.resolved === true ? 1 : 0,
        now,
        id,
      );
  else
    db!
      .prepare("INSERT INTO review_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        id,
        packageRecord.id,
        shotId ?? null,
        timecodeSeconds ?? null,
        optionalText(input.authorAlias),
        bodyText,
        input.resolved === true ? 1 : 0,
        now,
        now,
      );
  return reviewComment(
    one("SELECT * FROM review_comments WHERE id = ?", [id])!,
  );
}

function insertReviewDecision(
  packageRecord: Record<string, any>,
  input: Record<string, unknown>,
) {
  const decision = input.decision;
  if (
    decision !== "approve" &&
    decision !== "return" &&
    decision !== "request_changes" &&
    decision !== "note"
  )
    return undefined;
  const shotId = optionalText(input.shotId) ?? undefined;
  const manifest = domainPayload(packageRecord.manifest_json);
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
  if (
    shotId &&
    !clips.some(
      (clip) => clip && typeof clip === "object" && clip.shotId === shotId,
    )
  )
    return undefined;
  const id = randomUUID();
  db!
    .prepare("INSERT INTO review_decisions VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      id,
      packageRecord.id,
      shotId ?? null,
      decision,
      optionalText(input.authorAlias),
      optionalText(input.note),
      timestamp(),
    );
  return reviewDecision(
    one("SELECT * FROM review_decisions WHERE id = ?", [id])!,
  );
}

function renderOfflineReviewHtml(
  packageRecord: ReturnType<typeof reviewPackage>,
): string {
  const embedded = JSON.stringify(packageRecord).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeXml(packageRecord.title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#1e293b}main{max-width:900px;margin:auto;padding:24px}.card{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:12px 0}.clip{padding:10px;border-top:1px solid #e2e8f0}.muted{color:#64748b;font-size:13px}input,textarea,select,button{font:inherit;padding:8px;border-radius:7px;border:1px solid #94a3b8}textarea{width:100%;min-height:80px;box-sizing:border-box}button{background:#1d4ed8;color:#fff;border:0;cursor:pointer}.row{display:flex;gap:8px;flex-wrap:wrap}label{display:grid;gap:4px;font-size:14px}</style></head><body><main><h1>离线审片：${escapeXml(packageRecord.title)}</h1><p class="muted">本离线页仅包含时间线和审阅意见，不包含媒体代理。请对照已核验成片人工审阅；导出意见后导回 DramaIP。</p><section class="card"><h2>分镜时间线</h2><div id="clips"></div></section><section class="card"><h2>新增审阅意见</h2><div class="row"><label>分镜<select id="shot"></select></label><label>时间码（秒）<input id="time" type="number" min="0" step="0.1"></label><label>署名<input id="author" placeholder="可选"></label></div><label>意见<textarea id="body" placeholder="描述问题、建议或确认事项"></textarea></label><div class="row"><label>决定<select id="decision"><option value="note">仅备注</option><option value="approve">通过</option><option value="return">退回</option><option value="request_changes">需要修改</option></select></label><button id="add">加入意见</button><button id="download">导出意见 JSON</button></div><div id="comments"></div></section></main><script>const pkg=${embedded};const key='dramaip-review:'+pkg.id;let comments=JSON.parse(localStorage.getItem(key)||'[]');const clips=document.querySelector('#clips'),shot=document.querySelector('#shot'),commentsEl=document.querySelector('#comments');function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function render(){clips.innerHTML=pkg.manifest.clips.map(c=>'<div class="clip"><b>'+esc(c.name)+'</b> · '+c.startSeconds.toFixed(1)+'s–'+(c.startSeconds+c.durationSeconds).toFixed(1)+'s<br><span class="muted">'+(c.subtitle?esc(c.subtitle):'无字幕')+' · '+(c.mediaStatus==='referenced'?'已引用，仍需人工重链接':'待人工重链接')+'</span></div>').join('');shot.innerHTML='<option value="">项目级意见</option>'+pkg.manifest.clips.map(c=>'<option value="'+esc(c.shotId)+'">'+esc(c.name)+'</option>').join('');commentsEl.innerHTML=comments.length?'<h3>已记录意见</h3>'+comments.map(c=>'<div class="clip"><b>'+esc(c.decision==='approve'?'通过':c.decision==='return'?'退回':c.decision==='request_changes'?'需要修改':'备注')+'</b> '+esc(c.body)+'<br><span class="muted">'+esc(c.authorAlias||'匿名')+(c.timecodeSeconds!==undefined?' · '+c.timecodeSeconds+' 秒':'')+'</span></div>').join(''):'<p class="muted">尚无意见。</p>'}document.querySelector('#add').onclick=()=>{const body=document.querySelector('#body').value.trim();if(!body)return alert('请填写审阅意见');const time=Number(document.querySelector('#time').value);comments.push({id:crypto.randomUUID(),shotId:shot.value||undefined,timecodeSeconds:Number.isFinite(time)&&time>=0?time:undefined,authorAlias:document.querySelector('#author').value.trim()||undefined,body,decision:document.querySelector('#decision').value,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(comments));document.querySelector('#body').value='';render()};document.querySelector('#download').onclick=()=>{const blob=new Blob([JSON.stringify({format:'dramaip-review-comments',version:1,packageId:pkg.id,comments},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='审片意见-'+pkg.id+'.json';a.click();URL.revokeObjectURL(a.href)};render()</script></body></html>`;
}

function firstTextPayload(
  payload: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = stringPayload(payload, key).trim();
    if (value) return value;
  }
  return "";
}

function roundTimelineSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function timelineTimecode(seconds: number, frameRate: number): string {
  const totalFrames = Math.max(0, Math.round(seconds * frameRate));
  const frames = totalFrames % frameRate;
  const totalSeconds = Math.floor(totalFrames / frameRate);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, secs, frames]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function timelineSubtitleTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const ms = milliseconds % 1_000;
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

function runScriptReview(
  res: ServerResponse,
  scriptId: string,
  requestId: string,
): void {
  const script = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [scriptId, "scripts"],
  );
  if (!script)
    return respondError(res, 404, "NOT_FOUND", "Script not found", requestId);
  const payload = domainPayload(script.payload_json);
  const content = stringPayload(payload, "剧本内容");
  const scenes = rows(
    "SELECT * FROM domain_entities WHERE domain = ? AND parent_id = ?",
    ["scenes", scriptId],
  );
  const hasDialogue =
    /[：:][^\n]{1,}/u.test(content) || Boolean(stringPayload(payload, "对白"));
  const hasConflict = /冲突|对抗|争执|阻止|危机/u.test(
    content + stringPayload(payload, "冲突"),
  );
  const hasVisual = /画面|镜头|特写|远景|动作|场/u.test(
    content + stringPayload(payload, "视觉说明"),
  );
  const hasCliffhanger = /悬念|反转|秘密|危机|未完/u.test(
    content + stringPayload(payload, "结尾悬念"),
  );
  const textScore = scoreFromLength(content.length, 120, 900);
  const values = {
    hookStrengthScore:
      hasConflict || /钩子|开场/u.test(content)
        ? Math.max(textScore, 68)
        : Math.min(textScore, 58),
    dialogueScore: hasDialogue
      ? Math.max(textScore, 70)
      : Math.min(textScore, 50),
    conflictScore: hasConflict
      ? Math.max(textScore, 72)
      : Math.min(textScore, 48),
    visualClarityScore: hasVisual
      ? Math.max(textScore, 68)
      : Math.min(textScore, 52),
    sceneClarityScore: scenes.length
      ? Math.min(92, 60 + scenes.length * 8)
      : 35,
    characterFitScore: /角色|人物|主角|配角/u.test(content)
      ? Math.max(textScore, 65)
      : Math.min(textScore, 52),
    shotReadinessScore:
      scenes.length && hasVisual ? 78 : scenes.length ? 58 : 35,
    aiVideoFeasibilityScore:
      content.length && scenes.length ? 72 : content.length ? 55 : 30,
    cliffhangerScore: hasCliffhanger
      ? Math.max(textScore, 70)
      : Math.min(textScore, 50),
  };
  const issues: string[] = [];
  const suggestions: string[] = [];
  if (content.trim().length < 120) {
    issues.push("剧本正文过短，尚不足以稳定拆分场景和镜头。");
    suggestions.push("补充人物目标、冲突推进和可执行的动作或对白。");
  }
  if (!scenes.length) {
    issues.push("尚未建立结构化场景，无法核验制作衔接。");
    suggestions.push("先按地点、时间与剧情动作拆分场景，再进入分镜阶段。");
  }
  if (!hasCliffhanger) {
    issues.push("未识别到明确的结尾悬念或反转线索。");
    suggestions.push("在集尾补充可视化的悬念、反转或未解问题。");
  }
  if (!hasDialogue) suggestions.push("为关键冲突补充可表演的对白或旁白。");
  const scoreValues = Object.values(values);
  const overallScore = roundScore(
    scoreValues.reduce((total, value) => total + value, 0) / scoreValues.length,
  );
  const now = timestamp();
  const existing = one("SELECT id FROM script_reviews WHERE script_id = ?", [
    scriptId,
  ]);
  if (existing)
    db!
      .prepare(
        `UPDATE script_reviews SET hook_strength_score = ?, dialogue_score = ?, conflict_score = ?,
         visual_clarity_score = ?, scene_clarity_score = ?, character_fit_score = ?,
         shot_readiness_score = ?, ai_video_feasibility_score = ?, cliffhanger_score = ?,
         overall_score = ?, issues_json = ?, suggestions_json = ?, updated_at = ? WHERE script_id = ?`,
      )
      .run(
        values.hookStrengthScore,
        values.dialogueScore,
        values.conflictScore,
        values.visualClarityScore,
        values.sceneClarityScore,
        values.characterFitScore,
        values.shotReadinessScore,
        values.aiVideoFeasibilityScore,
        values.cliffhangerScore,
        overallScore,
        JSON.stringify(issues),
        JSON.stringify(suggestions),
        now,
        scriptId,
      );
  else
    db!
      .prepare(
        "INSERT INTO script_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        scriptId,
        values.hookStrengthScore,
        values.dialogueScore,
        values.conflictScore,
        values.visualClarityScore,
        values.sceneClarityScore,
        values.characterFitScore,
        values.shotReadinessScore,
        values.aiVideoFeasibilityScore,
        values.cliffhangerScore,
        overallScore,
        JSON.stringify(issues),
        JSON.stringify(suggestions),
        now,
        now,
      );
  const reviewed = scriptReview(
    one("SELECT * FROM script_reviews WHERE script_id = ?", [scriptId])!,
  );
  emit("script.reviewed", reviewed);
  json(res, 200, reviewed);
}

function removeScriptReview(
  res: ServerResponse,
  scriptId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      scriptId,
      "scripts",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Script not found", requestId);
  db!.prepare("DELETE FROM script_reviews WHERE script_id = ?").run(scriptId);
  emit("script.review_deleted", { scriptId });
  res.writeHead(204).end();
}

function getShotReview(
  res: ServerResponse,
  shotId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      shotId,
      "shots",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Shot not found", requestId);
  const existing = one("SELECT * FROM shot_reviews WHERE shot_id = ?", [
    shotId,
  ]);
  json(res, 200, existing ? shotReview(existing) : null);
}

function runShotReview(
  res: ServerResponse,
  shotId: string,
  requestId: string,
): void {
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [shotId, "shots"],
  );
  if (!shot)
    return respondError(res, 404, "NOT_FOUND", "Shot not found", requestId);
  const payload = domainPayload(shot.payload_json);
  const description = stringPayload(payload, "镜头描述");
  const prompt = stringPayload(payload, "生成提示");
  const action = stringPayload(payload, "动作");
  const characters =
    stringPayload(payload, "角色") || stringPayload(payload, "关联角色");
  const duration = Number(
    payload["时长秒"] ?? payload["时长"] ?? payload["镜头时长"],
  );
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const complexAction = /追逐|打斗|爆炸|群体|变形|快速切换/u.test(
    action + description,
  );
  const characterCount = characters
    .split(/[、，,\s/]+/u)
    .filter(Boolean).length;
  const promptScore = scoreFromLength(prompt.length, 30, 220);
  const values = {
    lengthScore: hasDuration && duration <= 12 ? 82 : hasDuration ? 58 : 40,
    characterCountScore:
      characterCount <= 2 ? 84 : characterCount <= 4 ? 65 : 42,
    actionComplexityScore: complexAction ? 45 : action ? 78 : 62,
    visualClarityScore: description
      ? Math.max(scoreFromLength(description.length, 25, 180), 65)
      : 38,
    characterConsistencyScore: characters ? 74 : 50,
    sceneContinuityScore: shot.parent_id ? 75 : 45,
    promptControllabilityScore: prompt ? Math.max(promptScore, 62) : 35,
    verticalSuitabilityScore: /近景|特写|竖屏|半身/u.test(description + prompt)
      ? 82
      : 64,
  };
  const difficulty =
    complexAction || characterCount > 4 || duration > 15
      ? "high"
      : !prompt || !description || !hasDuration || characterCount > 2
        ? "medium"
        : "low";
  const issues: string[] = [];
  const suggestions: string[] = [];
  if (!description) {
    issues.push("缺少镜头画面描述。");
    suggestions.push("说明景别、主体、动作、场景和镜头运动。");
  }
  if (!prompt) {
    issues.push("缺少可执行的生成提示词。");
    suggestions.push(
      "补充主体、构图、光线、镜头运动和风格约束，并保存提示词版本。",
    );
  }
  if (!hasDuration)
    suggestions.push("填写预估时长，便于动态分镜和成片节奏核验。");
  if (complexAction) {
    issues.push("动作或调度复杂，生成一致性风险较高。");
    suggestions.push("拆成更短的镜头，减少同镜头中的人物和动作变化。");
  }
  const scoreValues = Object.values(values);
  const overallScore = roundScore(
    scoreValues.reduce((total, value) => total + value, 0) / scoreValues.length,
  );
  const now = timestamp();
  const existing = one("SELECT id FROM shot_reviews WHERE shot_id = ?", [
    shotId,
  ]);
  if (existing)
    db!
      .prepare(
        `UPDATE shot_reviews SET length_score = ?, character_count_score = ?, action_complexity_score = ?,
         visual_clarity_score = ?, character_consistency_score = ?, scene_continuity_score = ?,
         prompt_controllability_score = ?, vertical_suitability_score = ?, overall_score = ?,
         ai_video_difficulty = ?, issues_json = ?, suggestions_json = ?, updated_at = ? WHERE shot_id = ?`,
      )
      .run(
        values.lengthScore,
        values.characterCountScore,
        values.actionComplexityScore,
        values.visualClarityScore,
        values.characterConsistencyScore,
        values.sceneContinuityScore,
        values.promptControllabilityScore,
        values.verticalSuitabilityScore,
        overallScore,
        difficulty,
        JSON.stringify(issues),
        JSON.stringify(suggestions),
        now,
        shotId,
      );
  else
    db!
      .prepare(
        "INSERT INTO shot_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        shotId,
        values.lengthScore,
        values.characterCountScore,
        values.actionComplexityScore,
        values.visualClarityScore,
        values.characterConsistencyScore,
        values.sceneContinuityScore,
        values.promptControllabilityScore,
        values.verticalSuitabilityScore,
        overallScore,
        difficulty,
        JSON.stringify(issues),
        JSON.stringify(suggestions),
        now,
        now,
      );
  const reviewed = shotReview(
    one("SELECT * FROM shot_reviews WHERE shot_id = ?", [shotId])!,
  );
  emit("shot.reviewed", reviewed);
  json(res, 200, reviewed);
}

function removeShotReview(
  res: ServerResponse,
  shotId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      shotId,
      "shots",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Shot not found", requestId);
  db!.prepare("DELETE FROM shot_reviews WHERE shot_id = ?").run(shotId);
  emit("shot.review_deleted", { shotId });
  res.writeHead(204).end();
}

function listPromptVersions(
  res: ServerResponse,
  shotId: string,
  requestId: string,
): void {
  if (
    !one("SELECT id FROM domain_entities WHERE id = ? AND domain = ?", [
      shotId,
      "shots",
    ])
  )
    return respondError(res, 404, "NOT_FOUND", "Shot not found", requestId);
  json(
    res,
    200,
    rows("SELECT * FROM prompt_versions WHERE shot_id = ? ORDER BY version", [
      shotId,
    ]).map(promptVersion),
  );
}

async function appendPromptVersion(
  req: IncomingMessage,
  res: ServerResponse,
  shotId: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const taskType = text(input.taskType);
  const shot = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = ?",
    [shotId, "shots"],
  );
  if (!shot)
    return respondError(res, 404, "NOT_FOUND", "Shot not found", requestId);
  if (!taskType)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "taskType is required",
      requestId,
    );
  const payload = domainPayload(shot.payload_json);
  const currentVersion = Number(
    one(
      "SELECT COALESCE(MAX(version), 0) AS version FROM prompt_versions WHERE shot_id = ?",
      [shotId],
    )?.version ?? 0,
  );
  const id = randomUUID();
  db!
    .prepare("INSERT INTO prompt_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      id,
      shotId,
      currentVersion + 1,
      taskType,
      textValue(input.videoPrompt, stringPayload(payload, "生成提示")),
      optionalText(input.negativePrompt),
      optionalText(input.imagePrompt),
      optionalText(input.note),
      timestamp(),
    );
  const created = promptVersion(
    one("SELECT * FROM prompt_versions WHERE id = ?", [id])!,
  );
  emit("shot.prompt_version_created", created);
  json(res, 201, created);
}

function trashProject(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM projects WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (current.deleted_at)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Project is already in trash",
      requestId,
    );
  db!
    .prepare(
      "UPDATE projects SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(timestamp(), timestamp(), id);
  const updated = one("SELECT * FROM projects WHERE id = ?", [id])!;
  emit("project.trashed", project(updated));
  json(res, 200, project(updated));
}

function restoreProject(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM projects WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (!current.deleted_at)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Project is not in trash",
      requestId,
    );
  db!
    .prepare(
      "UPDATE projects SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .run(timestamp(), id);
  const updated = one("SELECT * FROM projects WHERE id = ?", [id])!;
  emit("project.restored", project(updated));
  json(res, 200, project(updated));
}

async function purgeProject(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const current = one("SELECT * FROM projects WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (!current.deleted_at)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Project must be moved to trash before deletion",
      requestId,
    );
  if (text(input.confirmationTitle) !== current.title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Project title confirmation does not match",
      requestId,
    );
  db!.prepare("DELETE FROM projects WHERE id = ?").run(id);
  emit("project.purged", { id });
  res.writeHead(204).end();
}

async function createChapter(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const title = text(input.title);
  if (!projectId || !title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId and title are required",
      requestId,
    );
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  const orderIndex = Number(
    one("SELECT count(*) AS count FROM chapters WHERE project_id = ?", [
      projectId,
    ])?.count ?? 0,
  );
  const id = randomUUID();
  const now = timestamp();
  db!
    .prepare(
      `INSERT INTO chapters (
        id, project_id, title, order_index, summary, outline, content,
        main_conflict, hook, highlight, reversal, cliffhanger, short_drama_note,
        ai_video_note, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      title,
      orderIndex,
      textValue(input.summary, ""),
      optionalText(input.outline),
      textValue(input.content, ""),
      optionalText(input.mainConflict),
      optionalText(input.hook),
      optionalText(input.highlight),
      optionalText(input.reversal),
      optionalText(input.cliffhanger),
      optionalText(input.shortDramaNote),
      optionalText(input.aiVideoNote),
      now,
      now,
    );
  const created = one("SELECT * FROM chapters WHERE id = ?", [id])!;
  emit("chapter.created", chapter(created));
  json(res, 201, chapter(created));
}

function getChapter(res: ServerResponse, id: string, requestId: string): void {
  const item = one("SELECT * FROM chapters WHERE id = ?", [id]);
  if (item) json(res, 200, chapter(item));
  else respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
}

async function updateChapter(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const current = one("SELECT * FROM chapters WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
  if (input.version !== current.version)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Chapter changed in another session",
      requestId,
      { current: chapter(current) },
    );
  const title =
    typeof input.title === "string" ? input.title.trim() : current.title;
  if (!title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "title is required",
      requestId,
    );
  const summary = textValue(input.summary, current.summary);
  const content = textValue(input.content, current.content);
  db!
    .prepare(
      `UPDATE chapters SET
        title = ?, summary = ?, outline = ?, content = ?, main_conflict = ?, hook = ?,
        highlight = ?, reversal = ?, cliffhanger = ?, short_drama_note = ?, ai_video_note = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    )
    .run(
      title,
      summary,
      patchOptionalText(input.outline, current.outline),
      content,
      patchOptionalText(input.mainConflict, current.main_conflict),
      patchOptionalText(input.hook, current.hook),
      patchOptionalText(input.highlight, current.highlight),
      patchOptionalText(input.reversal, current.reversal),
      patchOptionalText(input.cliffhanger, current.cliffhanger),
      patchOptionalText(input.shortDramaNote, current.short_drama_note),
      patchOptionalText(input.aiVideoNote, current.ai_video_note),
      timestamp(),
      id,
      current.version,
    );
  const updated = one("SELECT * FROM chapters WHERE id = ?", [id])!;
  markImportExtractionStaleForChapter(String(current.project_id), id);
  if (content !== String(current.content)) {
    markStoryBibleStaleForChapter(String(current.project_id), id);
    maybeAutoSuggestStoryBibleChangeSet(updated);
  }
  emit("chapter.updated", chapter(updated));
  json(res, 200, chapter(updated));
}

async function reorderChapters(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const chapterIds = Array.isArray(input.chapterIds)
    ? input.chapterIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const current = rows(
    "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
    [projectId],
  );
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "Project not found", requestId);
  if (
    chapterIds.length !== current.length ||
    new Set(chapterIds).size !== chapterIds.length ||
    current.some((item) => !chapterIds.includes(String(item.id)))
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Chapter order must contain every project chapter exactly once",
      requestId,
    );
  const update = db!.prepare(
    "UPDATE chapters SET order_index = ?, version = version + 1, updated_at = ? WHERE id = ? AND project_id = ?",
  );
  const now = timestamp();
  db!.exec("BEGIN");
  try {
    chapterIds.forEach((id, index) => update.run(index, now, id, projectId));
    db!.exec("COMMIT");
  } catch (error) {
    db!.exec("ROLLBACK");
    throw error;
  }
  const updated = rows(
    "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
    [projectId],
  ).map(chapter);
  emit("chapter.reordered", { projectId, chapterIds });
  json(res, 200, updated);
}

function removeChapter(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM chapters WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
  db!.prepare("DELETE FROM chapters WHERE id = ?").run(id);
  const remaining = rows(
    "SELECT id FROM chapters WHERE project_id = ? ORDER BY order_index",
    [current.project_id],
  );
  const reorder = db!.prepare(
    "UPDATE chapters SET order_index = ? WHERE id = ?",
  );
  remaining.forEach((row, index) => reorder.run(index, row.id));
  emit("chapter.deleted", { id, projectId: current.project_id });
  res.writeHead(204).end();
}

/** Cancel an active OpenCode run together with its persisted task record. */
function cancelTaskRoute(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const current = one("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Task not found", requestId);
  if (!["queued", "running", "interrupted"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Task cannot be canceled",
      requestId,
    );
  const linkedSession = one(
    "SELECT * FROM agent_sessions WHERE active_task_id = ?",
    [id],
  );
  const linkedRun = one("SELECT * FROM agent_runs WHERE task_id = ?", [id]);
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run("canceled", now, id);
    if (linkedSession) {
      db!
        .prepare(
          "UPDATE agent_sessions SET status = ?, active_task_id = NULL, updated_at = ? WHERE id = ?",
        )
        .run("interrupted", now, linkedSession.id);
    }
    if (linkedRun)
      db!
        .prepare(
          "UPDATE agent_runs SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, linkedRun.id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  if (linkedSession) {
    const engineKind = isEngineKind(linkedSession.engine_kind)
      ? linkedSession.engine_kind
      : "opencode";
    void interruptEngineRun(
      engineKind,
      String(linkedSession.engine_session_id),
      String(linkedRun?.id ?? id),
    ).catch(() => undefined);
  }
  const updated = task(one("SELECT * FROM tasks WHERE id = ?", [id])!);
  emit("task.updated", updated);
  if (linkedSession) {
    const session = one("SELECT * FROM agent_sessions WHERE id = ?", [
      linkedSession.id,
    ]);
    if (session)
      emit("agent_session.interrupted", {
        ...agentSession(session),
        taskId: id,
      });
  }
  json(res, 200, updated);
}

async function createTask(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = await body(req);
  const kind = text(input.kind);
  const title = text(input.title);
  if (!kind || !title)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "kind and title are required",
      requestId,
    );
  // A queued task with no executor is worse than an explicit rejection: it
  // looks actionable in the task center yet can never make progress. Domain
  // routes own task creation until each kind has an audited dispatcher.
  return respondError(
    res,
    409,
    "TASK_REJECTED",
    "Generic task creation is disabled; use the corresponding domain operation",
    requestId,
  );
}

async function retryTaskRoute(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const retryInput = await body(req);
  const selectedEngine = text(retryInput.engineKind) as
    AgentEngineKind | undefined;
  if (
    !selectedEngine ||
    !(["opencode", "codex", "langgraph"] as const).includes(selectedEngine)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "重试任务必须明确选择智能引擎",
      requestId,
    );
  const current = one("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!current)
    return respondError(res, 404, "NOT_FOUND", "Task not found", requestId);
  if (!["failed", "canceled", "interrupted"].includes(String(current.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "Task cannot be retried",
      requestId,
    );
  if (current.kind === "feedback.revision")
    return retryFeedbackRevisionTask(res, current, requestId);
  if (!String(current.kind).startsWith("agent."))
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "This task kind does not support automatic retry",
      requestId,
    );
  const retry = domainPayload(domainPayload(current.result_json).retry);
  const sessionId = text(retry.sessionId);
  const requestedOperation = text(retry.operation);
  if (
    requestedOperation !== undefined &&
    requestedOperation !== "diagnostic" &&
    requestedOperation !== "revision"
  )
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "任务重试上下文无效",
      requestId,
    );
  const instructions = text(retry.instructions);
  const legacyPrompt = text(retry.prompt);
  if (!sessionId)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Task retry context is unavailable",
      requestId,
    );
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [sessionId]);
  if (!session || session.project_id !== current.project_id)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Agent session is unavailable for retry",
      requestId,
    );
  const sessionEngine = String(session.engine_kind) as AgentEngineKind;
  if (selectedEngine !== sessionEngine)
    return respondError(
      res,
      409,
      "CONFLICT",
      "重试必须使用原会话的智能引擎；如需更换引擎，请新建会话",
      requestId,
    );
  if (!engineHealthy(selectedEngine))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `${agentEngineDescriptor(selectedEngine).name} 引擎当前不可用`,
      requestId,
    );
  if (session.status === "running")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Agent session is already running",
      requestId,
    );
  const sourceProject = one("SELECT * FROM projects WHERE id = ?", [
    session.project_id,
  ]);
  if (!sourceProject)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "项目已不存在，无法重试智能任务",
      requestId,
    );
  const sourceChapter = session.chapter_id
    ? one("SELECT * FROM chapters WHERE id = ? AND project_id = ?", [
        session.chapter_id,
        session.project_id,
      ])
    : undefined;
  const requestedTaskType =
    text(retry.taskType) ??
    text(session.task_type) ??
    String(current.kind).replace(/^agent\./, "");
  if (!isAgentTaskType(requestedTaskType))
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "智能任务类型已失效，无法重试",
      requestId,
    );
  const taskType: AgentTaskType = requestedTaskType;
  const definition = getAgentTaskDefinition(taskType);
  const operation: AgentRunOperation =
    taskType === "chapter_revision" || requestedOperation === "revision"
      ? "revision"
      : "diagnostic";
  const retryModel = session.model_json
    ? normalizeAgentModelSelection(JSON.parse(String(session.model_json)))
    : undefined;
  if (definition.contextPolicy.includeChapter && !sourceChapter)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "此智能任务所需的目标章节已不存在",
      requestId,
    );
  // Old failed diagnostic tasks saved the assembled prompt. New tasks retain
  // only a user instruction so retry always receives a current project snapshot.
  const snapshot = createAgentContextSnapshot({
    project: sourceProject,
    chapter: sourceChapter,
    taskType,
    promptVersion: definition.promptVersion,
    model: retryModel,
  });
  const prompt =
    requestedOperation === undefined && legacyPrompt
      ? legacyPrompt
      : buildUnifiedAgentPrompt({
          definition,
          project: sourceProject,
          chapter: sourceChapter,
          userPrompt: instructions ?? "",
          snapshot,
        });
  const now = timestamp();
  const taskId = randomUUID();
  const runId = randomUUID();
  const retryContext = {
    retry: {
      sessionId,
      taskType,
      operation,
      instructions: instructions ?? "",
      engineKind: selectedEngine,
    },
  };
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)")
      .run(
        taskId,
        current.kind,
        "running",
        current.title,
        current.project_id,
        id,
        JSON.stringify(retryContext),
        now,
        now,
      );
    db!
      .prepare(
        "UPDATE agent_sessions SET status = ?, active_task_id = ?, updated_at = ? WHERE id = ?",
      )
      .run("running", taskId, now, sessionId);
    db!
      .prepare(
        `INSERT INTO agent_runs(
          id, session_id, task_id, task_type, engine_kind, status,
          model_json, context_snapshot_id, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        sessionId,
        taskId,
        taskType,
        selectedEngine,
        retryModel ? JSON.stringify(retryModel) : null,
        snapshot.id,
        now,
        now,
        now,
      );
    db!
      .prepare(
        "INSERT INTO agent_checkpoints(id, run_id, engine_kind, checkpoint_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        runId,
        selectedEngine,
        JSON.stringify({
          prompt,
          projectId: String(session.project_id),
          chapterId: session.chapter_id
            ? String(session.chapter_id)
            : undefined,
          operation,
          model: retryModel,
          chapterBaseVersion: sourceChapter
            ? Number(sourceChapter.version)
            : undefined,
        }),
        now,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const created = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
  emit("task.created", created);
  emit("agent_session.running", { ...agentSession(session), taskId });
  enqueueAgentRun({
    sessionId,
    engineSessionId: String(session.engine_session_id),
    taskId,
    runId,
    taskType,
    engineKind: selectedEngine,
    prompt,
    projectId: String(session.project_id),
    chapterId: session.chapter_id ? String(session.chapter_id) : undefined,
    operation,
    model: retryModel,
    chapterBaseVersion: sourceChapter
      ? Number(sourceChapter.version)
      : undefined,
  });
  json(res, 201, created);
}

function retryFeedbackRevisionTask(
  res: ServerResponse,
  previous: Record<string, any>,
  requestId: string,
): void {
  const retry = domainPayload(domainPayload(previous.result_json).retry);
  const clusterId = text(retry.clusterId);
  if (
    !clusterId ||
    !one("SELECT id FROM feedback_clusters WHERE id = ?", [clusterId])
  )
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "Feedback context is unavailable for retry",
      requestId,
    );
  const taskId = randomUUID();
  const now = timestamp();
  const payload = { retry: { clusterId } };
  db!
    .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)")
    .run(
      taskId,
      "feedback.revision",
      "running",
      String(previous.title),
      previous.project_id,
      previous.id,
      JSON.stringify(payload),
      now,
      now,
    );
  const created = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
  emit("task.created", created);
  json(res, 201, created);
  queueMicrotask(() => executeFeedbackRevisionTask(taskId, clusterId));
}

async function createRevision(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = await body(req);
  const chapterId = text(input.chapterId);
  const proposedContent =
    typeof input.proposedContent === "string" ? input.proposedContent : "";
  if (!chapterId || !proposedContent)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "chapterId and proposedContent are required",
      requestId,
    );
  const source = one("SELECT * FROM chapters WHERE id = ?", [chapterId]);
  if (!source)
    return respondError(res, 404, "NOT_FOUND", "Chapter not found", requestId);
  const now = timestamp();
  const id = randomUUID();
  db!
    .prepare("INSERT INTO revision_previews VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .run(
      id,
      chapterId,
      source.version,
      proposedContent,
      typeof input.rationale === "string" ? input.rationale : "",
      "pending",
      now,
    );
  const item = revision(
    one("SELECT * FROM revision_previews WHERE id = ?", [id])!,
  );
  db!
    .prepare("INSERT INTO request_deduplication VALUES (?, 201, ?, ?)")
    .run(key, JSON.stringify(item), now);
  emit("revision.created", item);
  json(res, 201, item);
}

/**
 * The assistant can create only a pending preview.  This helper deliberately
 * has no code path that updates a chapter; the user-facing commit route owns
 * the optimistic-locking write.
 */
function createAgentRevisionPreview(input: {
  chapterId: string;
  baseVersion: number;
  proposedContent: string;
  rationale: string;
}): ReturnType<typeof revision> {
  const now = timestamp();
  const id = randomUUID();
  db!
    .prepare("INSERT INTO revision_previews VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .run(
      id,
      input.chapterId,
      input.baseVersion,
      input.proposedContent,
      input.rationale,
      "pending",
      now,
    );
  const created = revision(
    one("SELECT * FROM revision_previews WHERE id = ?", [id])!,
  );
  emit("revision.created", created);
  return created;
}

function getRevision(res: ServerResponse, id: string, requestId: string): void {
  const item = one("SELECT * FROM revision_previews WHERE id = ?", [id]);
  if (item) json(res, 200, revision(item));
  else
    respondError(
      res,
      404,
      "NOT_FOUND",
      "Revision preview not found",
      requestId,
    );
}

async function commitRevision(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = await body(req);
  const item = one("SELECT * FROM revision_previews WHERE id = ?", [id]);
  if (!item)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Revision preview not found",
      requestId,
    );
  if (item.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Revision is no longer pending",
      requestId,
    );
  if (input.version !== item.base_version)
    return respondError(
      res,
      409,
      "CONFLICT",
      "Revision version does not match its base version",
      requestId,
    );
  db!.exec("BEGIN IMMEDIATE");
  try {
    const result = db!
      .prepare(
        "UPDATE chapters SET content = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(
        item.proposed_content,
        timestamp(),
        item.chapter_id,
        item.base_version,
      );
    if (Number(result.changes) !== 1) {
      db!.exec("ROLLBACK");
      return respondError(
        res,
        409,
        "CONFLICT",
        "Chapter changed since revision was generated",
        requestId,
      );
    }
    const now = timestamp();
    db!
      .prepare(
        "UPDATE revision_previews SET status = ?, committed_at = ? WHERE id = ?",
      )
      .run("committed", now, id);
    const payload = { ok: true, revisionId: id };
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 200, ?, ?)")
      .run(key, JSON.stringify(payload), now);
    db!.exec("COMMIT");
    emit("revision.committed", payload);
    json(res, 200, payload);
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

async function discardRevision(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const item = one("SELECT * FROM revision_previews WHERE id = ?", [id]);
  if (!item)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Revision preview not found",
      requestId,
    );
  if (item.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Revision is no longer pending",
      requestId,
    );
  const now = timestamp();
  db!
    .prepare("UPDATE revision_previews SET status = ? WHERE id = ?")
    .run("discarded", id);
  const discarded = revision(
    one("SELECT * FROM revision_previews WHERE id = ?", [id])!,
  );
  db!
    .prepare("INSERT INTO request_deduplication VALUES (?, 200, ?, ?)")
    .run(key, JSON.stringify(discarded), now);
  emit("revision.discarded", discarded);
  json(res, 200, discarded);
}

function isEngineKind(value: unknown): value is AgentEngineKind {
  return value === "opencode" || value === "codex" || value === "langgraph";
}

function engineHealthy(kind: AgentEngineKind): boolean {
  if (kind === "opencode") return command?.opencode?.healthy === true;
  if (kind === "codex") return command?.codex?.healthy === true;
  return command?.langgraph?.healthy === true;
}

function engineVersion(kind: AgentEngineKind): string {
  if (kind === "opencode") return "1.18.15";
  if (kind === "codex") return command?.codex?.version ?? "0.147.0";
  return command?.langgraph?.version ?? "0.2.43";
}

function agentEngineDescriptor(kind: AgentEngineKind) {
  const healthy = engineHealthy(kind);
  const globalSettings = globalAgentSettingsRecord();
  return {
    kind,
    name:
      kind === "opencode"
        ? "OpenCode"
        : kind === "codex"
          ? "Codex"
          : "LangGraph.js",
    version: engineVersion(kind),
    status: healthy ? "available" : "unavailable",
    isDefault: kind === globalSettings.defaultEngineKind,
    isBeta: kind === "codex",
    statusMessage: healthy ? "引擎运行正常" : "引擎当前未启动或尚未完成配置",
    capabilities: {
      streaming: true,
      interrupt: true,
      resume: true,
      fork: true,
      readOnlyMcp: true,
      structuredOutput: true,
      chatGptLogin: kind === "codex",
      apiKeyLogin: true,
    },
  };
}

function globalAgentSettingsRecord() {
  const record = one(
    "SELECT * FROM agent_engine_configs WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1",
  );
  return {
    defaultEngineKind: isEngineKind(record?.engine_kind)
      ? record.engine_kind
      : "opencode",
    defaultModel: record?.model_json
      ? JSON.parse(String(record.model_json))
      : undefined,
    updatedAt: record?.updated_at ?? timestamp(),
  };
}

function getGlobalAgentSettings(res: ServerResponse): void {
  json(res, 200, globalAgentSettingsRecord());
}

async function updateGlobalAgentSettings(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  if (!isEngineKind(input.defaultEngineKind))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请选择有效的全局默认智能引擎",
      requestId,
    );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!.prepare("UPDATE agent_engine_configs SET is_default = 0").run();
    db!
      .prepare(
        `INSERT INTO agent_engine_configs(
          engine_kind, enabled, is_default, credential_ref, model_json, updated_at
        ) VALUES (?, 1, 1, NULL, ?, ?)
        ON CONFLICT(engine_kind) DO UPDATE SET
          enabled = 1,
          is_default = 1,
          model_json = excluded.model_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.defaultEngineKind,
        input.defaultModel === undefined
          ? null
          : JSON.stringify(input.defaultModel),
        now,
      );
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const result = globalAgentSettingsRecord();
  emit("agent_settings.updated", result);
  json(res, 200, result);
}

function listAgentEngines(res: ServerResponse): void {
  json(res, 200, [
    agentEngineDescriptor("opencode"),
    agentEngineDescriptor("codex"),
    agentEngineDescriptor("langgraph"),
  ]);
}

function listAgentTasks(res: ServerResponse): void {
  json(
    res,
    200,
    AGENT_TASK_CATALOG.map((definition) => ({
      id: definition.id,
      label: definition.label,
      category: definition.category,
      promptVersion: definition.promptVersion,
      writePolicy: definition.writePolicy,
      allowedTools: definition.allowedTools,
    })),
  );
}

function projectAgentSettingsRecord(projectId: string) {
  const record = one(
    "SELECT * FROM project_agent_settings WHERE project_id = ?",
    [projectId],
  );
  const globalSettings = globalAgentSettingsRecord();
  return {
    projectId,
    defaultEngineKind: isEngineKind(record?.default_engine_kind)
      ? record.default_engine_kind
      : globalSettings.defaultEngineKind,
    defaultModel: record?.default_model_json
      ? JSON.parse(String(record.default_model_json))
      : globalSettings.defaultModel,
    assistantMode:
      record?.assistant_mode === "advanced" ? "advanced" : "simple",
    updatedAt: record?.updated_at ?? timestamp(),
  };
}

function getProjectAgentSettings(
  res: ServerResponse,
  projectId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "项目不存在", requestId);
  json(res, 200, projectAgentSettingsRecord(projectId));
}

async function updateProjectAgentSettings(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  requestId: string,
): Promise<void> {
  if (!one("SELECT id FROM projects WHERE id = ?", [projectId]))
    return respondError(res, 404, "NOT_FOUND", "项目不存在", requestId);
  const input = await body(req);
  if (!isEngineKind(input.defaultEngineKind))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请选择有效的智能引擎",
      requestId,
    );
  if (
    input.assistantMode !== undefined &&
    input.assistantMode !== "simple" &&
    input.assistantMode !== "advanced"
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请选择有效的智能助手界面模式",
      requestId,
    );
  const previous = projectAgentSettingsRecord(projectId);
  const now = timestamp();
  db!
    .prepare(
      `INSERT INTO project_agent_settings(
         project_id, default_engine_kind, default_model_json, assistant_mode, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         default_engine_kind = excluded.default_engine_kind,
         default_model_json = excluded.default_model_json,
         assistant_mode = excluded.assistant_mode,
         updated_at = excluded.updated_at`,
    )
    .run(
      projectId,
      input.defaultEngineKind,
      input.defaultModel === undefined
        ? null
        : JSON.stringify(input.defaultModel),
      input.assistantMode ?? previous.assistantMode,
      now,
    );
  const result = projectAgentSettingsRecord(projectId);
  emit("project.agent_settings.updated", result);
  json(res, 200, result);
}

function getAgentSession(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const record = one("SELECT * FROM agent_sessions WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "智能会话不存在", requestId);
  json(res, 200, agentSession(record));
}

function agentRunRecord(row: Record<string, any>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    taskType: row.task_type,
    engineKind: row.engine_kind,
    status: row.status,
    model: row.model_json ? JSON.parse(row.model_json) : undefined,
    contextSnapshotId: row.context_snapshot_id ?? undefined,
    error: row.error ? publicErrorMessage(String(row.error)) : undefined,
    inputTokens:
      row.input_tokens === null || row.input_tokens === undefined
        ? undefined
        : Number(row.input_tokens),
    outputTokens:
      row.output_tokens === null || row.output_tokens === undefined
        ? undefined
        : Number(row.output_tokens),
    cachedTokens:
      row.cached_tokens === null || row.cached_tokens === undefined
        ? undefined
        : Number(row.cached_tokens),
    estimatedCost:
      row.estimated_cost === null || row.estimated_cost === undefined
        ? undefined
        : Number(row.estimated_cost),
    currency: row.currency ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function agentItemRecord(row: Record<string, any>) {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.type,
    status: row.status,
    content: row.content ?? undefined,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextAgentItemSequence(runId: string): number {
  return (
    Number(
      one("SELECT MAX(sequence) AS value FROM agent_items WHERE run_id = ?", [
        runId,
      ])?.value ?? 0,
    ) + 1
  );
}

function recordAgentEngineEvent(
  runId: string,
  event: Record<string, unknown>,
): void {
  if (!db || !one("SELECT id FROM agent_runs WHERE id = ?", [runId])) return;
  const now = timestamp();
  if (event.type === "content.delta" && typeof event.delta === "string") {
    const current = one(
      `SELECT * FROM agent_items
       WHERE run_id = ? AND type = 'message' AND status = 'streaming'
       ORDER BY sequence DESC LIMIT 1`,
      [runId],
    );
    if (current) {
      const content = `${String(current.content ?? "")}${event.delta}`.slice(
        0,
        200_000,
      );
      db.prepare(
        "UPDATE agent_items SET content = ?, updated_at = ? WHERE id = ?",
      ).run(content, now, current.id);
      emit("agent_item.delta", {
        runId,
        itemId: current.id,
        delta: event.delta,
      });
      return;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agent_items(
        id, run_id, sequence, type, status, content, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'message', 'streaming', ?, NULL, ?, ?)`,
    ).run(id, runId, nextAgentItemSequence(runId), event.delta, now, now);
    emit(
      "agent_item.started",
      agentItemRecord(one("SELECT * FROM agent_items WHERE id = ?", [id])!),
    );
    return;
  }
  if (event.type === "tool") {
    const id = randomUUID();
    const status = event.status === "completed" ? "completed" : "started";
    db.prepare(
      `INSERT INTO agent_items(
        id, run_id, sequence, type, status, content, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'tool_call', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      runId,
      nextAgentItemSequence(runId),
      status,
      typeof event.tool === "string" ? event.tool : "DramaIP 只读工具",
      JSON.stringify({
        server: event.server,
        tool: event.tool,
        itemId: event.itemId,
        ...(event.error
          ? { error: publicErrorMessage(String(event.error)) }
          : {}),
      }),
      now,
      now,
    );
    emit(
      `agent_item.${status}`,
      agentItemRecord(one("SELECT * FROM agent_items WHERE id = ?", [id])!),
    );
    return;
  }
  if (event.type === "usage") {
    const inputTokens = Math.max(0, Number(event.inputTokens ?? 0));
    const outputTokens = Math.max(0, Number(event.outputTokens ?? 0));
    const cachedTokens = Math.max(0, Number(event.cachedTokens ?? 0));
    const estimatedCost =
      event.estimatedCost === undefined
        ? undefined
        : Math.max(0, Number(event.estimatedCost));
    db.prepare(
      `UPDATE agent_runs SET input_tokens = ?, output_tokens = ?, cached_tokens = ?,
       estimated_cost = COALESCE(?, estimated_cost),
       currency = CASE WHEN ? IS NULL THEN currency ELSE 'USD' END,
       updated_at = ? WHERE id = ?`,
    ).run(
      inputTokens,
      outputTokens,
      cachedTokens,
      estimatedCost ?? null,
      estimatedCost ?? null,
      now,
      runId,
    );
    emit("agent_run.usage", {
      runId,
      inputTokens,
      outputTokens,
      cachedTokens,
      ...(estimatedCost === undefined
        ? {}
        : { estimatedCost, currency: "USD" }),
    });
  }
}

function getAgentRun(res: ServerResponse, id: string, requestId: string): void {
  const record = one("SELECT * FROM agent_runs WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "智能运行不存在", requestId);
  json(res, 200, agentRunRecord(record));
}

function listAgentRunItems(
  res: ServerResponse,
  runId: string,
  requestId: string,
): void {
  if (!one("SELECT id FROM agent_runs WHERE id = ?", [runId]))
    return respondError(res, 404, "NOT_FOUND", "智能运行不存在", requestId);
  json(
    res,
    200,
    rows("SELECT * FROM agent_items WHERE run_id = ? ORDER BY sequence", [
      runId,
    ]).map(agentItemRecord),
  );
}

async function bridgeEngineRequest(
  engineKind: Exclude<AgentEngineKind, "opencode">,
  operation: string,
  payload: unknown,
  timeoutMs = 120_000,
): Promise<unknown> {
  if (!engineHealthy(engineKind))
    throw new Error(
      `${engineKind === "codex" ? "Codex" : "LangGraph.js"} 引擎当前不可用`,
    );
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      agentEngineRequests.delete(requestId);
      reject(new Error("智能引擎响应超时"));
    }, timeoutMs);
    agentEngineRequests.set(requestId, { resolve, reject, timeout });
    hostPort.postMessage({
      type: "agent-engine:request",
      requestId,
      engineKind,
      operation,
      payload,
    });
  });
}

async function createEngineSession(
  kind: AgentEngineKind,
  input: {
    title: string;
    projectId: string;
    chapterId?: string;
    model?: AgentModelSelection;
  },
): Promise<{ id: string }> {
  if (kind === "opencode") {
    const sessionDirectory = command?.opencode?.workspacePath
      ? join(command.opencode.workspacePath, randomUUID())
      : undefined;
    if (sessionDirectory)
      mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
    const result = (await engineRequest(
      `/session${sessionDirectory ? `?directory=${encodeURIComponent(sessionDirectory)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({ title: input.title }),
      },
    )) as { id?: string };
    if (!result.id) throw new Error("OpenCode 未返回会话编号");
    return { id: result.id };
  }
  const result = (await bridgeEngineRequest(kind, "createSession", input)) as {
    id?: string;
  };
  if (!result.id) throw new Error("智能引擎未返回会话编号");
  return { id: result.id };
}

function normalizeAgentModelSelection(
  value: unknown,
): AgentModelSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["providerId", "modelId", "profileId"])
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "string" ||
        !String(record[key]).trim() ||
        String(record[key]).length > 200)
    )
      return undefined;
  const providerId = text(record.providerId);
  const modelId = text(record.modelId);
  const profileId = text(record.profileId);
  return {
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(profileId ? { profileId } : {}),
  };
}

function validateAgentModelSelection(
  engineKind: AgentEngineKind,
  model: AgentModelSelection | undefined,
): string | undefined {
  if (!model?.providerId) return undefined;
  if (engineKind === "codex")
    return ["openai", "codex"].includes(model.providerId.toLowerCase())
      ? undefined
      : "Codex 只能使用其认证账户支持的 OpenAI 模型";
  const providerId = activeAgentProviderId();
  return providerId === model.providerId
    ? undefined
    : "所选模型不属于当前启用的智能模型服务商";
}

async function interruptEngineRun(
  kind: AgentEngineKind,
  engineSessionId: string,
  runId: string,
): Promise<void> {
  if (kind === "opencode") {
    await engineRequest(
      `/session/${encodeURIComponent(engineSessionId)}/abort`,
      { method: "POST" },
    );
    return;
  }
  await bridgeEngineRequest(kind, "interrupt", { engineSessionId, runId });
}

async function createAgentSession(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const input = await body(req);
  const projectId = text(input.projectId);
  const chapterId = text(input.chapterId);
  if (!projectId)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "projectId is required",
      requestId,
    );
  const sourceProject = one("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!sourceProject)
    return respondError(res, 404, "NOT_FOUND", "项目不存在", requestId);
  const settings = projectAgentSettingsRecord(projectId);
  const engineKind = isEngineKind(input.engineKind)
    ? input.engineKind
    : settings.defaultEngineKind;
  if (!engineHealthy(engineKind))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `${agentEngineDescriptor(engineKind).name} 引擎当前不可用`,
      requestId,
    );
  if (engineKind !== "codex" && !activeAgentProviderId())
    return respondError(
      res,
      409,
      "CONFLICT",
      "请先在模型服务商中将一项“智能模型”设为智能助手模型",
      requestId,
    );
  const requestedModel = input.model ?? settings.defaultModel;
  const model = normalizeAgentModelSelection(requestedModel);
  if (requestedModel !== undefined && !model)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "模型配置格式无效",
      requestId,
    );
  const modelError = validateAgentModelSelection(engineKind, model);
  if (modelError)
    return respondError(res, 400, "VALIDATION_ERROR", modelError, requestId);
  const taskType =
    typeof input.taskType === "string" && isAgentTaskType(input.taskType)
      ? input.taskType
      : undefined;
  if (input.taskType !== undefined && !taskType)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "不支持的智能任务类型",
      requestId,
    );
  const sourceChapter = chapterId
    ? one("SELECT * FROM chapters WHERE id = ? AND project_id = ?", [
        chapterId,
        projectId,
      ])
    : undefined;
  if (chapterId && !sourceChapter)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "所选章节不属于当前项目",
      requestId,
    );
  try {
    const title =
      text(input.title) ??
      `${taskType ? getAgentTaskDefinition(taskType).label : "智能任务"}：${sourceChapter?.title ?? sourceProject.title}`;
    const engineSession = await createEngineSession(engineKind, {
      title,
      projectId,
      ...(chapterId ? { chapterId } : {}),
      ...(model ? { model } : {}),
    });
    const id = randomUUID();
    const now = timestamp();
    db!
      .prepare(
        `INSERT INTO agent_sessions(
          id, engine_session_id, engine_kind, project_id, chapter_id,
          task_type, title, model_json, status, active_task_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        engineSession.id,
        engineKind,
        projectId,
        chapterId ?? null,
        taskType ?? null,
        title,
        model === undefined ? null : JSON.stringify(model),
        "idle",
        now,
        now,
      );
    const created = agentSession(
      one("SELECT * FROM agent_sessions WHERE id = ?", [id])!,
    );
    emit("agent_session.created", created);
    json(res, 201, created);
  } catch (error) {
    respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "无法创建智能会话",
      requestId,
    );
  }
}

function createAgentContextSnapshot(input: {
  project: Record<string, any>;
  chapter?: Record<string, any>;
  taskType: AgentTaskType;
  promptVersion: string;
  target?: unknown;
  model?: unknown;
}) {
  const projectId = String(input.project.id);
  const providerMetadata = rows(
    "SELECT * FROM domain_entities WHERE domain = 'providers' ORDER BY updated_at DESC",
  ).map((row) => {
    const payload = domainPayload(row.payload_json);
    const publicPayload = Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) =>
          !/(?:凭据|密钥|口令|密码|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password)$/i.test(
            key,
          ),
      ),
    );
    return {
      id: String(row.id),
      title: String(row.title),
      version: Number(row.version),
      payload: publicPayload,
    };
  });
  const payload = {
    project: project(input.project),
    chapter: input.chapter ? chapter(input.chapter) : undefined,
    characters: rows(
      "SELECT * FROM domain_entities WHERE project_id = ? AND domain = 'characters' ORDER BY updated_at DESC",
      [projectId],
    ).map(domainEntity),
    storyBible: rows(
      "SELECT * FROM domain_entities WHERE project_id = ? AND domain = 'story-bible' ORDER BY updated_at DESC",
      [projectId],
    ).map(domainEntity),
    outlines: rows(
      "SELECT * FROM domain_entities WHERE project_id = ? AND domain IN ('outlines', 'story-arcs') ORDER BY updated_at DESC",
      [projectId],
    ).map(domainEntity),
    providers: providerMetadata,
    target: input.target,
    model: input.model,
  };
  const serialized = JSON.stringify(payload);
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        taskType: input.taskType,
        promptVersion: input.promptVersion,
        schemaVersion: "v3.1",
        toolPolicyVersion: "readonly-v1",
        payload,
      }),
    )
    .digest("hex");
  const createdAt = timestamp();
  const candidateId = randomUUID();
  db!
    .prepare(
      `INSERT OR IGNORE INTO agent_context_snapshots(
        id, project_id, chapter_id, task_type, prompt_version, schema_version,
        tool_policy_version, content_hash, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'v3.1', 'readonly-v1', ?, ?, ?)`,
    )
    .run(
      candidateId,
      projectId,
      input.chapter?.id ?? null,
      input.taskType,
      input.promptVersion,
      contentHash,
      serialized,
      createdAt,
    );
  const record = one(
    "SELECT * FROM agent_context_snapshots WHERE project_id = ? AND content_hash = ?",
    [projectId, contentHash],
  )!;
  return {
    id: String(record.id),
    projectId,
    chapterId: record.chapter_id ? String(record.chapter_id) : undefined,
    taskType: input.taskType,
    promptVersion: input.promptVersion,
    schemaVersion: "v3.1",
    toolPolicyVersion: "readonly-v1",
    contentHash,
    payload,
    createdAt: String(record.created_at),
  };
}

function buildUnifiedAgentPrompt(input: {
  definition: ReturnType<typeof getAgentTaskDefinition>;
  project: Record<string, any>;
  chapter?: Record<string, any>;
  userPrompt: string;
  snapshot: ReturnType<typeof createAgentContextSnapshot>;
}): string {
  if (input.definition.id === "chapter_revision" && input.chapter)
    return revisionPrompt(input.project, input.chapter, input.userPrompt);
  if (input.definition.id === "chapter_diagnostic")
    return diagnosticPrompt(input.project, input.chapter, input.userPrompt);
  const providerActionInstruction =
    input.definition.writePolicy === "provider-action-preview"
      ? [
          "本任务只能规划远程厂商调用，不能直接生成媒体、不能执行调用，也不能提供本地生成或本地渲染方案。",
          'data 必须包含 providerAction：{"kind":"image|audio|video|remote_render","providerId":"从上下文 providers 中选择","modelId":"可选","parameters":{},"estimatedCost":0,"currency":"CNY"}。',
          "parameters 只能包含对应远程接口需要的项目、分集、镜头、提示词、音色、时长或尺寸等公开参数，绝不能包含密钥、令牌、凭据引用或任意本地路径。",
        ]
      : [];
  return [
    "你是 DramaIP 的中文创作智能助手。所有输出必须使用简体中文。",
    `任务：${input.definition.label}（${input.definition.id}）`,
    `输出策略：${input.definition.writePolicy}。你无权直接修改正式内容，也无权直接发起付费生成。`,
    "只使用 DramaIP 提供的只读工具，不得尝试读取本地路径、执行命令或访问未授权网络。",
    '请返回 JSON 对象：{"summary":"简短结论","content":"主要内容","data":{}}。不要输出隐藏思维过程。',
    ...providerActionInstruction,
    input.userPrompt ? `用户补充要求：${input.userPrompt}` : "",
    `上下文快照编号：${input.snapshot.id}`,
    `上下文：${JSON.stringify(input.snapshot.payload)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runAgentSession(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "执行智能任务必须提供 Idempotency-Key",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [id]);
  if (!session)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Agent session not found",
      requestId,
    );
  if (session.status === "running")
    return respondError(
      res,
      409,
      "CONFLICT",
      "Agent session is already running",
      requestId,
    );
  const engineKind = isEngineKind(session.engine_kind)
    ? session.engine_kind
    : "opencode";
  if (!engineHealthy(engineKind))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `${agentEngineDescriptor(engineKind).name} 引擎当前不可用`,
      requestId,
    );
  const input = await body(req);
  const explicitPrompt =
    typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (explicitPrompt.length > 4_000)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "任务要求不能超过 4000 个字符",
      requestId,
    );
  if (
    input.operation !== undefined &&
    !["diagnostic", "revision"].includes(input.operation)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "不支持的智能任务类型",
      requestId,
    );
  const compatibilityTaskType: AgentTaskType =
    input.operation === "revision" ? "chapter_revision" : "chapter_diagnostic";
  const requestedTaskType = text(input.taskType) ?? text(session.task_type);
  const taskType = requestedTaskType
    ? isAgentTaskType(requestedTaskType)
      ? requestedTaskType
      : undefined
    : compatibilityTaskType;
  if (!taskType)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "不支持的智能任务类型",
      requestId,
    );
  const definition = getAgentTaskDefinition(taskType);
  const requestedModel =
    input.model ??
    (session.model_json ? JSON.parse(String(session.model_json)) : undefined);
  const model = normalizeAgentModelSelection(requestedModel);
  if (requestedModel !== undefined && !model)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "模型配置格式无效",
      requestId,
    );
  const modelError = validateAgentModelSelection(engineKind, model);
  if (modelError)
    return respondError(res, 400, "VALIDATION_ERROR", modelError, requestId);
  const project = one("SELECT * FROM projects WHERE id = ?", [
    session.project_id,
  ])!;
  const sourceChapter = session.chapter_id
    ? one("SELECT * FROM chapters WHERE id = ?", [session.chapter_id])
    : undefined;
  if (definition.contextPolicy.includeChapter && !sourceChapter)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "此智能任务必须先选择一个章节",
      requestId,
    );
  const operation: AgentRunOperation =
    taskType === "chapter_revision" ? "revision" : "diagnostic";
  const snapshot = createAgentContextSnapshot({
    project,
    chapter: sourceChapter,
    taskType,
    promptVersion: definition.promptVersion,
    target: input.target,
    model,
  });
  const prompt = buildUnifiedAgentPrompt({
    definition,
    project,
    chapter: sourceChapter,
    userPrompt: explicitPrompt,
    snapshot,
  });
  const taskId = randomUUID();
  const runId = randomUUID();
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        `agent.${taskType}`,
        "running",
        `${definition.label}：${sourceChapter?.title ?? project.title}`,
        session.project_id,
        JSON.stringify({
          retry: {
            sessionId: id,
            taskType,
            instructions: explicitPrompt,
            engineKind,
          },
        }),
        now,
        now,
      );
    db!
      .prepare(
        `INSERT INTO agent_runs(
          id, session_id, task_id, task_type, engine_kind, status, model_json,
          context_snapshot_id, error, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        runId,
        id,
        taskId,
        taskType,
        engineKind,
        model === undefined ? null : JSON.stringify(model),
        snapshot.id,
        now,
        now,
        now,
      );
    db!
      .prepare(
        `INSERT INTO agent_checkpoints(id, run_id, engine_kind, checkpoint_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        engineKind,
        JSON.stringify({
          prompt,
          projectId: String(session.project_id),
          chapterId: session.chapter_id
            ? String(session.chapter_id)
            : undefined,
          operation,
          model,
          chapterBaseVersion: sourceChapter
            ? Number(sourceChapter.version)
            : undefined,
        }),
        now,
      );
    db!
      .prepare(
        "UPDATE agent_sessions SET status = ?, active_task_id = ?, task_type = ?, model_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        "running",
        taskId,
        taskType,
        model === undefined ? session.model_json : JSON.stringify(model),
        now,
        id,
      );
    const response = { taskId, sessionId: id, runId };
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 202, ?, ?)")
      .run(idempotencyKey, JSON.stringify(response), now);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  emit(
    "task.created",
    task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!),
  );
  emit("agent_session.running", { ...agentSession(session), taskId, runId });
  emit(
    "agent_run.started",
    agentRunRecord(one("SELECT * FROM agent_runs WHERE id = ?", [runId])!),
  );
  enqueueAgentRun({
    sessionId: id,
    engineSessionId: String(session.engine_session_id),
    taskId,
    runId,
    taskType,
    engineKind,
    prompt,
    projectId: String(session.project_id),
    chapterId: session.chapter_id ? String(session.chapter_id) : undefined,
    operation,
    model,
    chapterBaseVersion: sourceChapter
      ? Number(sourceChapter.version)
      : undefined,
  });
  json(res, 202, { taskId, sessionId: id, runId });
}

function abortAgentSession(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [id]);
  if (!session)
    return respondError(
      res,
      404,
      "NOT_FOUND",
      "Agent session not found",
      requestId,
    );
  const activeRun = session.active_task_id
    ? one("SELECT * FROM agent_runs WHERE task_id = ?", [
        session.active_task_id,
      ])
    : undefined;
  const engineKind = isEngineKind(session.engine_kind)
    ? session.engine_kind
    : "opencode";
  void interruptEngineRun(
    engineKind,
    String(session.engine_session_id),
    activeRun ? String(activeRun.id) : String(session.active_task_id ?? id),
  ).catch(() => undefined);
  const now = timestamp();
  if (session.active_task_id) {
    db!
      .prepare(
        "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running', 'interrupted')",
      )
      .run("canceled", now, session.active_task_id);
    if (activeRun)
      db!
        .prepare(
          "UPDATE agent_runs SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, activeRun.id);
  }
  db!
    .prepare(
      "UPDATE agent_sessions SET status = ?, active_task_id = NULL, updated_at = ? WHERE id = ?",
    )
    .run("interrupted", now, id);
  if (session.active_task_id) {
    const canceled = one("SELECT * FROM tasks WHERE id = ?", [
      session.active_task_id,
    ]);
    if (canceled) emit("task.updated", task(canceled));
  }
  emit(
    "agent_session.interrupted",
    agentSession(one("SELECT * FROM agent_sessions WHERE id = ?", [id])!),
  );
  json(res, 202, { ok: true });
}

async function interruptAgentRunRoute(
  res: ServerResponse,
  runId: string,
  requestId: string,
): Promise<void> {
  const run = one("SELECT * FROM agent_runs WHERE id = ?", [runId]);
  if (!run)
    return respondError(res, 404, "NOT_FOUND", "智能运行不存在", requestId);
  if (!["queued", "running"].includes(String(run.status)))
    return respondError(
      res,
      409,
      "CONFLICT",
      "当前智能运行无法中断",
      requestId,
    );
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [
    run.session_id,
  ])!;
  const engineKind = isEngineKind(run.engine_kind)
    ? run.engine_kind
    : "opencode";
  try {
    await interruptEngineRun(
      engineKind,
      String(session.engine_session_id),
      runId,
    );
  } catch {
    // Persist the local interruption even if a crashed engine cannot acknowledge it.
  }
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE agent_runs SET status = 'interrupted', completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, runId);
    db!
      .prepare(
        "UPDATE tasks SET status = 'interrupted', updated_at = ? WHERE id = ?",
      )
      .run(now, run.task_id);
    db!
      .prepare(
        "UPDATE agent_sessions SET status = 'interrupted', active_task_id = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, run.session_id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const updated = agentRunRecord(
    one("SELECT * FROM agent_runs WHERE id = ?", [runId])!,
  );
  emit("agent_run.interrupted", updated);
  json(res, 200, updated);
}

async function resumeAgentRunRoute(
  res: ServerResponse,
  runId: string,
  requestId: string,
): Promise<void> {
  const run = one("SELECT * FROM agent_runs WHERE id = ?", [runId]);
  if (!run)
    return respondError(res, 404, "NOT_FOUND", "智能运行不存在", requestId);
  if (run.status !== "interrupted")
    return respondError(
      res,
      409,
      "CONFLICT",
      "只有已中断的智能运行可以继续",
      requestId,
    );
  const engineKind = isEngineKind(run.engine_kind)
    ? run.engine_kind
    : "opencode";
  if (!engineHealthy(engineKind))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `${agentEngineDescriptor(engineKind).name} 引擎当前不可用`,
      requestId,
    );
  const checkpoint = one(
    "SELECT * FROM agent_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
    [runId],
  );
  if (!checkpoint)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "此运行没有可恢复的检查点，请手动重新运行",
      requestId,
    );
  const state = JSON.parse(String(checkpoint.checkpoint_json)) as {
    prompt?: string;
    projectId?: string;
    chapterId?: string;
    operation?: AgentRunOperation;
    model?: AgentModelSelection;
    chapterBaseVersion?: number;
  };
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [
    run.session_id,
  ])!;
  if (!state.prompt || !state.projectId)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "恢复检查点不完整，请手动重新运行",
      requestId,
    );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "UPDATE agent_runs SET status = 'running', error = NULL, completed_at = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, runId);
    db!
      .prepare(
        "UPDATE tasks SET status = 'running', error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, run.task_id);
    db!
      .prepare(
        "UPDATE agent_sessions SET status = 'running', active_task_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(run.task_id, now, run.session_id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  enqueueAgentRun({
    sessionId: String(run.session_id),
    engineSessionId: String(session.engine_session_id),
    taskId: String(run.task_id),
    runId,
    taskType: run.task_type as AgentTaskType,
    engineKind,
    prompt: state.prompt,
    projectId: state.projectId,
    ...(state.chapterId ? { chapterId: state.chapterId } : {}),
    operation: state.operation ?? "diagnostic",
    model:
      state.model ??
      (run.model_json
        ? normalizeAgentModelSelection(JSON.parse(String(run.model_json)))
        : undefined),
    ...(state.chapterBaseVersion !== undefined
      ? { chapterBaseVersion: state.chapterBaseVersion }
      : {}),
  });
  const updated = agentRunRecord(
    one("SELECT * FROM agent_runs WHERE id = ?", [runId])!,
  );
  emit("agent_run.resumed", updated);
  json(res, 200, updated);
}

async function forkAgentSession(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [id]);
  if (!session)
    return respondError(res, 404, "NOT_FOUND", "智能会话不存在", requestId);
  const engineKind = isEngineKind(session.engine_kind)
    ? session.engine_kind
    : "opencode";
  if (!engineHealthy(engineKind))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `${agentEngineDescriptor(engineKind).name} 引擎当前不可用`,
      requestId,
    );
  try {
    const engineSession =
      engineKind === "opencode"
        ? ((await engineRequest(
            `/session/${encodeURIComponent(String(session.engine_session_id))}/fork`,
            { method: "POST" },
          )) as { id?: string })
        : ((await bridgeEngineRequest(engineKind, "fork", {
            engineSessionId: session.engine_session_id,
          })) as { id?: string });
    if (!engineSession.id) throw new Error("智能引擎未返回分支会话编号");
    const forkId = randomUUID();
    const now = timestamp();
    db!
      .prepare(
        `INSERT INTO agent_sessions(
          id, engine_session_id, engine_kind, project_id, chapter_id,
          task_type, title, model_json, status, active_task_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?)`,
      )
      .run(
        forkId,
        engineSession.id,
        engineKind,
        session.project_id,
        session.chapter_id,
        session.task_type,
        `${session.title ?? "智能会话"}（分支）`,
        session.model_json,
        now,
        now,
      );
    const created = agentSession(
      one("SELECT * FROM agent_sessions WHERE id = ?", [forkId])!,
    );
    emit("agent_session.forked", { sourceSessionId: id, session: created });
    json(res, 201, created);
  } catch (error) {
    respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "无法创建会话分支",
      requestId,
    );
  }
}

async function disposeAgentSession(
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const session = one("SELECT * FROM agent_sessions WHERE id = ?", [id]);
  if (!session)
    return respondError(res, 404, "NOT_FOUND", "智能会话不存在", requestId);
  if (session.status === "running")
    return respondError(
      res,
      409,
      "CONFLICT",
      "请先中断正在运行的任务",
      requestId,
    );
  const engineKind = isEngineKind(session.engine_kind)
    ? session.engine_kind
    : "opencode";
  try {
    if (engineHealthy(engineKind)) {
      if (engineKind === "opencode")
        await engineRequest(
          `/session/${encodeURIComponent(String(session.engine_session_id))}`,
          { method: "DELETE" },
        );
      else
        await bridgeEngineRequest(engineKind, "dispose", {
          engineSessionId: session.engine_session_id,
        });
    }
  } catch {
    // Local disposal is authoritative even when an optional engine has crashed.
  }
  db!
    .prepare(
      "UPDATE agent_sessions SET status = 'disposed', updated_at = ? WHERE id = ?",
    )
    .run(timestamp(), id);
  emit("agent_session.disposed", { id, engineKind });
  res.writeHead(204).end();
}

function changePreviewRecord(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    taskId: row.task_id ?? undefined,
    engineKind: row.engine_kind ?? undefined,
    taskType: row.task_type ?? undefined,
    targets: JSON.parse(String(row.targets_json)),
    rationale: row.rationale,
    status: row.status,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    committedAt: row.committed_at ?? undefined,
  };
}

function providerActionPreviewRecord(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    taskId: row.task_id ?? undefined,
    kind: row.kind,
    providerId: row.provider_id,
    modelId: row.model_id ?? undefined,
    parameters: JSON.parse(String(row.parameters_json)),
    estimatedCost:
      row.estimated_cost === null || row.estimated_cost === undefined
        ? undefined
        : Number(row.estimated_cost),
    currency: row.currency ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    executedAt: row.executed_at ?? undefined,
  };
}

function getChangePreview(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const record = one("SELECT * FROM change_previews WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "变更预览不存在", requestId);
  json(res, 200, changePreviewRecord(record));
}

function currentChangeTarget(target: Record<string, unknown>) {
  const kind = String(target.kind);
  const id = String(target.id);
  if (kind === "project")
    return one("SELECT * FROM projects WHERE id = ?", [id]);
  if (kind === "chapter")
    return one("SELECT * FROM chapters WHERE id = ?", [id]);
  return one("SELECT * FROM domain_entities WHERE id = ?", [id]);
}

function applyChangeTarget(target: Record<string, unknown>, now: string): void {
  const kind = String(target.kind);
  const id = String(target.id);
  const baseVersion = Number(target.baseVersion);
  const patch =
    target.patch && typeof target.patch === "object"
      ? (target.patch as Record<string, unknown>)
      : {};
  if (kind === "chapter") {
    const current = one("SELECT * FROM chapters WHERE id = ?", [id])!;
    const result = db!
      .prepare(
        `UPDATE chapters SET
          title = ?, summary = ?, outline = ?, content = ?,
          version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      )
      .run(
        typeof patch.title === "string" ? patch.title : current.title,
        typeof patch.summary === "string" ? patch.summary : current.summary,
        typeof patch.outline === "string" ? patch.outline : current.outline,
        typeof patch.content === "string" ? patch.content : current.content,
        now,
        id,
        baseVersion,
      );
    if (Number(result.changes) !== 1) throw new Error("CHANGE_CONFLICT");
    return;
  }
  if (kind === "project") {
    const current = one("SELECT * FROM projects WHERE id = ?", [id])!;
    const result = db!
      .prepare(
        `UPDATE projects SET title = ?, synopsis = ?, style_guide = ?,
          version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
      )
      .run(
        typeof patch.title === "string" ? patch.title : current.title,
        typeof patch.synopsis === "string" ? patch.synopsis : current.synopsis,
        typeof patch.styleGuide === "string"
          ? patch.styleGuide
          : current.style_guide,
        now,
        id,
        baseVersion,
      );
    if (Number(result.changes) !== 1) throw new Error("CHANGE_CONFLICT");
    return;
  }
  const current = one("SELECT * FROM domain_entities WHERE id = ?", [id])!;
  const currentPayload = domainPayload(current.payload_json);
  const nextPayload =
    patch.payload === undefined ? currentPayload : patch.payload;
  const displayDiff =
    target.displayDiff && typeof target.displayDiff === "object"
      ? (target.displayDiff as Record<string, unknown>)
      : {};
  if (
    kind === "script" &&
    typeof nextPayload === "object" &&
    nextPayload !== null &&
    stringPayload(currentPayload, "剧本内容") !==
      stringPayload(nextPayload as Record<string, unknown>, "剧本内容")
  )
    createContentCheckpoint(
      String(current.project_id),
      "script",
      id,
      String(current.title),
      stringPayload(currentPayload, "剧本内容"),
      Number(current.version),
      displayDiff.pacingSourceId
        ? "节奏修订预览采用前检查点"
        : "变更预览采用前检查点",
      displayDiff.pacingSourceId
        ? { 节奏来源: String(displayDiff.pacingSourceId) }
        : undefined,
    );
  const result = db!
    .prepare(
      `UPDATE domain_entities SET title = ?, payload_json = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    )
    .run(
      typeof patch.title === "string" ? patch.title : current.title,
      JSON.stringify(nextPayload),
      now,
      id,
      baseVersion,
    );
  if (Number(result.changes) !== 1) throw new Error("CHANGE_CONFLICT");
}

async function commitChangePreview(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "提交变更必须提供 Idempotency-Key",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const record = one("SELECT * FROM change_previews WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "变更预览不存在", requestId);
  if (record.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "变更预览已不再等待确认",
      requestId,
    );
  const targets = JSON.parse(String(record.targets_json)) as Array<
    Record<string, unknown>
  >;
  for (const target of targets) {
    const current = currentChangeTarget(target);
    if (
      !current ||
      Number(current.version) !== Number(target.baseVersion) ||
      !changeTargetBelongsToProject(
        String(record.project_id),
        String(target.kind),
        String(target.id),
      )
    ) {
      db!
        .prepare(
          "UPDATE change_previews SET status = 'conflicted' WHERE id = ?",
        )
        .run(id);
      return respondError(
        res,
        409,
        "CONFLICT",
        "正式内容已发生变化，请重新生成或人工合并",
        requestId,
      );
    }
  }
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    for (const target of targets) applyChangeTarget(target, now);
    db!
      .prepare(
        "UPDATE change_previews SET status = 'committed', committed_at = ? WHERE id = ?",
      )
      .run(now, id);
    const updated = changePreviewRecord(
      one("SELECT * FROM change_previews WHERE id = ?", [id])!,
    );
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 200, ?, ?)")
      .run(key, JSON.stringify(updated), now);
    db!.exec("COMMIT");
    markAgentExperimentRunAdopted(record.run_id);
    emit("change_preview.committed", updated);
    json(res, 200, updated);
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    if (error instanceof Error && error.message === "CHANGE_CONFLICT")
      return respondError(
        res,
        409,
        "CONFLICT",
        "正式内容已发生变化，请重新生成或人工合并",
        requestId,
      );
    throw error;
  }
}

async function discardChangePreview(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "放弃变更必须提供 Idempotency-Key",
      requestId,
    );
  const record = one("SELECT * FROM change_previews WHERE id = ?", [id]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "变更预览不存在", requestId);
  if (record.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "变更预览已不再等待确认",
      requestId,
    );
  const now = timestamp();
  db!
    .prepare("UPDATE change_previews SET status = 'discarded' WHERE id = ?")
    .run(id);
  const updated = changePreviewRecord(
    one("SELECT * FROM change_previews WHERE id = ?", [id])!,
  );
  db!
    .prepare(
      "INSERT OR REPLACE INTO request_deduplication VALUES (?, 200, ?, ?)",
    )
    .run(key, JSON.stringify(updated), now);
  emit("change_preview.discarded", updated);
  json(res, 200, updated);
}

function getProviderActionPreview(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const record = one("SELECT * FROM provider_action_previews WHERE id = ?", [
    id,
  ]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "厂商调用预览不存在", requestId);
  json(res, 200, providerActionPreviewRecord(record));
}

async function executeProviderActionPreview(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "确认厂商调用必须提供 Idempotency-Key",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const record = one("SELECT * FROM provider_action_previews WHERE id = ?", [
    id,
  ]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "厂商调用预览不存在", requestId);
  if (record.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "厂商调用预览已不再等待确认",
      requestId,
    );
  const provider = one(
    "SELECT * FROM domain_entities WHERE id = ? AND domain = 'providers'",
    [record.provider_id],
  );
  if (!provider)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "所选厂商配置已不存在",
      requestId,
    );
  const parameters = domainPayload(record.parameters_json);
  if (containsSecret(parameters))
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "厂商调用参数中不得包含密钥或令牌",
      requestId,
    );
  const now = timestamp();
  const taskId = randomUUID();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, 'queued', ?, 0, ?, NULL, ?, NULL, ?, ?)",
      )
      .run(
        taskId,
        `provider.${record.kind}`,
        `${record.kind === "image" ? "图片" : record.kind === "audio" ? "音频" : record.kind === "video" ? "视频" : "远程渲染"}厂商任务`,
        record.project_id,
        JSON.stringify({
          providerActionPreviewId: id,
          providerId: record.provider_id,
          parameters,
        }),
        now,
        now,
      );
    db!
      .prepare(
        "UPDATE provider_action_previews SET status = 'executed', executed_at = ? WHERE id = ?",
      )
      .run(now, id);
    const created = task(one("SELECT * FROM tasks WHERE id = ?", [taskId])!);
    db!
      .prepare("INSERT INTO request_deduplication VALUES (?, 202, ?, ?)")
      .run(key, JSON.stringify(created), now);
    db!.exec("COMMIT");
    markAgentExperimentRunAdopted(record.run_id);
    emit("task.created", created);
    emit("provider_action_preview.executed", { id, taskId });
    json(res, 202, created);
    void dispatchApprovedProviderAction(id, taskId);
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

async function discardProviderActionPreview(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "放弃厂商调用必须提供 Idempotency-Key",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const record = one("SELECT * FROM provider_action_previews WHERE id = ?", [
    id,
  ]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "厂商调用预览不存在", requestId);
  if (record.status !== "pending")
    return respondError(
      res,
      409,
      "CONFLICT",
      "厂商调用预览已不再等待确认",
      requestId,
    );
  const now = timestamp();
  db!
    .prepare(
      "UPDATE provider_action_previews SET status = 'discarded' WHERE id = ?",
    )
    .run(id);
  const updated = providerActionPreviewRecord(
    one("SELECT * FROM provider_action_previews WHERE id = ?", [id])!,
  );
  db!
    .prepare("INSERT INTO request_deduplication VALUES (?, 200, ?, ?)")
    .run(key, JSON.stringify(updated), now);
  emit("provider_action_preview.discarded", updated);
  json(res, 200, updated);
}

/**
 * 用户确认后才进入这里。所有媒体任务都复用公开远程 Provider 执行器，
 * 因而不会引入本地推理或本地视频渲染的第二条路径。
 */
async function dispatchApprovedProviderAction(
  previewId: string,
  taskId: string,
): Promise<void> {
  const preview = one(
    "SELECT * FROM provider_action_previews WHERE id = ? AND status = 'executed'",
    [previewId],
  );
  if (!preview) return;
  const parameters = domainPayload(preview.parameters_json);
  const input = {
    ...parameters,
    providerId: String(preview.provider_id),
    projectId: String(preview.project_id),
  };
  const request = internalJsonRequest(input, `provider-preview-${previewId}`);
  const response = internalJsonResponse();
  try {
    if (preview.kind === "image")
      await runImageGeneration(request, response.value, randomUUID(), taskId);
    else if (preview.kind === "audio")
      await runTtsGeneration(request, response.value, randomUUID(), taskId);
    else if (preview.kind === "video" || preview.kind === "remote_render")
      await createVideoGeneration(
        request,
        response.value,
        randomUUID(),
        taskId,
      );
    else throw new Error("不支持的厂商调用类型");
    if (response.status() >= 400) {
      const result = response.json();
      throw new Error(
        typeof result?.message === "string"
          ? result.message
          : "厂商任务启动失败",
      );
    }
    emit("provider_action_preview.started", {
      id: previewId,
      taskId,
      kind: preview.kind,
    });
  } catch (error) {
    const message = publicErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    db!
      .prepare(
        "UPDATE tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')",
      )
      .run(message, timestamp(), taskId);
    const failed = one("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (failed) emit("task.updated", task(failed));
    emit("provider_action_preview.failed", {
      id: previewId,
      taskId,
      error: message,
    });
  }
}

function internalJsonRequest(
  value: Record<string, unknown>,
  idempotencyKey: string,
): IncomingMessage {
  return {
    headers: { "idempotency-key": idempotencyKey },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(value));
    },
  } as unknown as IncomingMessage;
}

function internalJsonResponse(): {
  value: ServerResponse;
  status(): number;
  json(): Record<string, unknown> | undefined;
} {
  let statusCode = 200;
  const chunks: Buffer[] = [];
  const value = {
    writeHead(status: number) {
      statusCode = status;
      return value;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return value;
    },
    setHeader() {
      return value;
    },
  } as unknown as ServerResponse;
  return {
    value,
    status: () => statusCode,
    json: () => {
      if (!chunks.length) return undefined;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

async function getCodexAuthStatus(
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!engineHealthy("codex"))
    return json(res, 200, {
      available: false,
      authenticated: false,
      message: "Codex 引擎当前不可用",
    });
  try {
    json(res, 200, await bridgeEngineRequest("codex", "authStatus", {}));
  } catch (error) {
    respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "无法读取 Codex 登录状态",
      requestId,
    );
  }
}

async function loginCodex(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!engineHealthy("codex"))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      "Codex 引擎当前不可用",
      requestId,
    );
  const input = await body(req);
  if (
    !["api_key", "chatgpt_browser", "chatgpt_device_code"].includes(
      String(input.mode),
    )
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "不支持的 Codex 登录方式",
      requestId,
    );
  if (input.mode === "api_key" && !text(input.credentialRef))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "API 密钥登录必须提供安全凭据引用",
      requestId,
    );
  try {
    json(res, 200, await bridgeEngineRequest("codex", "login", input));
  } catch (error) {
    respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "Codex 登录失败",
      requestId,
    );
  }
}

async function logoutCodex(
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!engineHealthy("codex"))
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      "Codex 引擎当前不可用",
      requestId,
    );
  try {
    await bridgeEngineRequest("codex", "logout", {});
    json(res, 200, {
      available: true,
      authenticated: false,
      message: "已退出 Codex",
    });
  } catch (error) {
    respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      error instanceof Error ? error.message : "Codex 退出失败",
      requestId,
    );
  }
}

function agentExperimentRecord(row: Record<string, any>) {
  const revealed = Number(row.revealed) === 1;
  const candidates = rows(
    `SELECT er.*, ar.status AS run_status, t.result_json
     FROM agent_experiment_runs er
     JOIN agent_runs ar ON ar.id = er.run_id
     JOIN tasks t ON t.id = ar.task_id
     WHERE er.experiment_id = ?
     ORDER BY CASE er.candidate WHEN 'one' THEN 1 WHEN 'two' THEN 2 ELSE 3 END`,
    [row.id],
  ).map((candidate) => ({
    candidate: candidate.candidate,
    runId: candidate.run_id,
    status: candidate.run_status,
    output: candidate.result_json
      ? JSON.parse(String(candidate.result_json))
      : undefined,
    metrics: candidate.metrics_json
      ? JSON.parse(String(candidate.metrics_json))
      : undefined,
    ...(revealed
      ? {
          engineKind: candidate.engine_kind,
          engineVersion: candidate.engine_version,
        }
      : {}),
  }));
  return {
    id: row.id,
    projectId: row.project_id,
    taskType: row.task_type,
    contextSnapshotId: row.context_snapshot_id,
    status: row.status,
    comparisonMode:
      row.comparison_mode === "same_model" ? "same_model" : "recommended",
    model: row.model_json ? JSON.parse(String(row.model_json)) : undefined,
    estimatedCost:
      row.estimated_cost === null || row.estimated_cost === undefined
        ? undefined
        : Number(row.estimated_cost),
    currency: row.currency ?? undefined,
    error: row.error ? publicErrorMessage(String(row.error)) : undefined,
    revealed,
    candidates,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createAgentExperiment(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "创建三引擎盲测必须提供 Idempotency-Key",
      requestId,
    );
  const replay = one(
    "SELECT * FROM request_deduplication WHERE idempotency_key = ?",
    [key],
  );
  if (replay)
    return json(
      res,
      Number(replay.response_status),
      JSON.parse(String(replay.response_json)),
    );
  const input = await body(req);
  const projectId = text(input.projectId);
  const chapterId = text(input.chapterId);
  const requestedTaskType = text(input.taskType);
  if (!projectId || !requestedTaskType || !isAgentTaskType(requestedTaskType))
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "项目和智能任务类型不能为空",
      requestId,
    );
  if (input.confirmedEstimatedCost !== true)
    return respondError(
      res,
      409,
      "TASK_REJECTED",
      "请先确认三次模型调用可能产生的费用",
      requestId,
    );
  const comparisonMode =
    input.comparisonMode === "same_model" ? "same_model" : "recommended";
  const comparisonModel = normalizeAgentModelSelection(input.model);
  if (
    comparisonMode === "same_model" &&
    (!comparisonModel?.modelId || input.model === undefined)
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "同模型盲测必须填写有效的模型标识",
      requestId,
    );
  if (comparisonMode === "same_model") {
    const activeProvider = activeAgentProviderId();
    const provider = activeProvider
      ? one(
          "SELECT * FROM domain_entities WHERE id = ? AND domain = 'providers'",
          [activeProvider],
        )
      : undefined;
    const configuration = provider
      ? openCodeProviderConfiguration(provider)
      : undefined;
    if (!configuration || configuration.providerKind !== "openai")
      return respondError(
        res,
        409,
        "TASK_REJECTED",
        "同模型盲测要求 OpenCode 与 LangGraph 使用 OpenAI 兼容服务商",
        requestId,
      );
    if (
      comparisonModel?.providerId &&
      comparisonModel.providerId !== configuration.providerId
    )
      return respondError(
        res,
        400,
        "VALIDATION_ERROR",
        "同模型盲测选择的服务商不是当前启用的智能模型服务商",
        requestId,
      );
  }
  const unavailable = (["opencode", "codex", "langgraph"] as const).filter(
    (kind) => !engineHealthy(kind),
  );
  if (unavailable.length)
    return respondError(
      res,
      503,
      "ENGINE_UNAVAILABLE",
      `以下引擎当前不可用：${unavailable.map((kind) => agentEngineDescriptor(kind).name).join("、")}`,
      requestId,
    );
  if (!activeAgentProviderId())
    return respondError(
      res,
      409,
      "CONFLICT",
      "请先配置 OpenCode 与 LangGraph 使用的智能模型",
      requestId,
    );
  const sourceProject = one("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!sourceProject)
    return respondError(res, 404, "NOT_FOUND", "项目不存在", requestId);
  const sourceChapter = chapterId
    ? one("SELECT * FROM chapters WHERE id = ? AND project_id = ?", [
        chapterId,
        projectId,
      ])
    : undefined;
  const definition = getAgentTaskDefinition(requestedTaskType);
  if (definition.contextPolicy.includeChapter && !sourceChapter)
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "此盲测任务必须选择章节",
      requestId,
    );
  const snapshot = createAgentContextSnapshot({
    project: sourceProject,
    chapter: sourceChapter,
    taskType: requestedTaskType,
    promptVersion: definition.promptVersion,
    model: comparisonMode === "same_model" ? comparisonModel : undefined,
  });
  const experimentId = randomUUID();
  const now = timestamp();
  const candidates = ["one", "two", "three"] as const;
  const engines = (["opencode", "codex", "langgraph"] as const)
    .map((engineKind) => ({
      engineKind,
      order: createHash("sha256")
        .update(`${experimentId}:${engineKind}`)
        .digest("hex"),
    }))
    .sort((a, b) => a.order.localeCompare(b.order));
  const candidateOrder = Object.fromEntries(
    candidates.map((candidate, index) => [
      candidate,
      engines[index].engineKind,
    ]),
  );
  db!
    .prepare(
      `INSERT INTO agent_experiment_groups(
        id, project_id, task_type, context_snapshot_id, status,
        comparison_mode, model_json, candidate_order_json,
        estimated_cost, currency, revealed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, NULL, NULL, 0, ?, ?)`,
    )
    .run(
      experimentId,
      projectId,
      requestedTaskType,
      snapshot.id,
      comparisonMode,
      comparisonMode === "same_model" ? JSON.stringify(comparisonModel) : null,
      JSON.stringify(candidateOrder),
      now,
      now,
    );
  const created = agentExperimentRecord(
    one("SELECT * FROM agent_experiment_groups WHERE id = ?", [experimentId])!,
  );
  db!
    .prepare("INSERT INTO request_deduplication VALUES (?, 202, ?, ?)")
    .run(key, JSON.stringify(created), now);
  emit("agent_experiment.created", created);
  json(res, 202, created);
  void startAgentExperiment({
    experimentId,
    project: sourceProject,
    chapter: sourceChapter,
    definition,
    snapshot,
    candidateOrder: candidateOrder as Record<
      "one" | "two" | "three",
      AgentEngineKind
    >,
    comparisonMode,
    model: comparisonMode === "same_model" ? comparisonModel : undefined,
    userPrompt: typeof input.prompt === "string" ? input.prompt : "",
  });
}

async function startAgentExperiment(input: {
  experimentId: string;
  project: Record<string, any>;
  chapter?: Record<string, any>;
  definition: ReturnType<typeof getAgentTaskDefinition>;
  snapshot: ReturnType<typeof createAgentContextSnapshot>;
  candidateOrder: Record<"one" | "two" | "three", AgentEngineKind>;
  comparisonMode: "recommended" | "same_model";
  model?: AgentModelSelection;
  userPrompt: string;
}): Promise<void> {
  const now = timestamp();
  db!
    .prepare(
      "UPDATE agent_experiment_groups SET status = 'running', updated_at = ? WHERE id = ?",
    )
    .run(now, input.experimentId);
  emit("agent_experiment.running", { id: input.experimentId });
  const prompt = buildUnifiedAgentPrompt({
    definition: input.definition,
    project: input.project,
    chapter: input.chapter,
    userPrompt: input.userPrompt,
    snapshot: input.snapshot,
  });
  try {
    const candidates = Object.entries(input.candidateOrder) as Array<
      ["one" | "two" | "three", AgentEngineKind]
    >;
    // 一个 SQLite 连接不能并发开启多个事务；先顺序落库，再由三个
    // 独立引擎队列并发执行，避免留下半组盲测记录。
    for (const [candidate, engineKind] of candidates) {
      const engineSession = await createEngineSession(engineKind, {
        title: `三引擎盲测：${input.definition.label}`,
        projectId: String(input.project.id),
        ...(input.chapter ? { chapterId: String(input.chapter.id) } : {}),
        ...(input.model ? { model: input.model } : {}),
      });
      const sessionId = randomUUID();
      const taskId = randomUUID();
      const runId = randomUUID();
      const createdAt = timestamp();
      db!.exec("BEGIN IMMEDIATE");
      try {
        db!
          .prepare(
            `INSERT INTO agent_sessions(
                id, engine_session_id, engine_kind, project_id, chapter_id,
                task_type, title, model_json, status, active_task_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
          )
          .run(
            sessionId,
            engineSession.id,
            engineKind,
            input.project.id,
            input.chapter?.id ?? null,
            input.definition.id,
            `三引擎盲测：${input.definition.label}`,
            input.model ? JSON.stringify(input.model) : null,
            createdAt,
            createdAt,
          );
        db!
          .prepare(
            "INSERT INTO tasks VALUES (?, ?, 'running', ?, 0, ?, NULL, NULL, NULL, ?, ?)",
          )
          .run(
            taskId,
            `agent.experiment.${input.definition.id}`,
            `盲测方案${candidate === "one" ? "一" : candidate === "two" ? "二" : "三"}`,
            input.project.id,
            createdAt,
            createdAt,
          );
        db!
          .prepare("UPDATE agent_sessions SET active_task_id = ? WHERE id = ?")
          .run(taskId, sessionId);
        db!
          .prepare(
            `INSERT INTO agent_runs(
                id, session_id, task_id, task_type, engine_kind, status,
                model_json, context_snapshot_id, started_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            sessionId,
            taskId,
            input.definition.id,
            engineKind,
            input.model ? JSON.stringify(input.model) : null,
            input.snapshot.id,
            createdAt,
            createdAt,
            createdAt,
          );
        db!
          .prepare(
            "INSERT INTO agent_checkpoints(id, run_id, engine_kind, checkpoint_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            randomUUID(),
            runId,
            engineKind,
            JSON.stringify({
              prompt,
              projectId: String(input.project.id),
              chapterId: input.chapter ? String(input.chapter.id) : undefined,
              operation:
                input.definition.id === "chapter_revision"
                  ? "revision"
                  : "diagnostic",
              model: input.model,
              chapterBaseVersion: input.chapter
                ? Number(input.chapter.version)
                : undefined,
            }),
            createdAt,
          );
        db!
          .prepare(
            `INSERT INTO agent_experiment_runs(
                id, experiment_id, run_id, candidate, engine_kind,
                engine_version, model_json, metrics_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .run(
            randomUUID(),
            input.experimentId,
            runId,
            candidate,
            engineKind,
            engineVersion(engineKind),
            input.model ? JSON.stringify(input.model) : null,
            createdAt,
          );
        db!.exec("COMMIT");
      } catch (error) {
        try {
          db!.exec("ROLLBACK");
        } catch {}
        throw error;
      }
      enqueueAgentRun({
        sessionId,
        engineSessionId: engineSession.id,
        taskId,
        runId,
        taskType: input.definition.id,
        engineKind,
        prompt,
        projectId: String(input.project.id),
        ...(input.chapter ? { chapterId: String(input.chapter.id) } : {}),
        operation:
          input.definition.id === "chapter_revision"
            ? "revision"
            : "diagnostic",
        model: input.model,
        ...(input.chapter
          ? { chapterBaseVersion: Number(input.chapter.version) }
          : {}),
      });
    }
  } catch (error) {
    const failedAt = timestamp();
    hostPort.postMessage({
      type: "diagnostic",
      level: "error",
      message: `三引擎盲测启动失败：${error instanceof Error ? error.message : String(error)}`,
    });
    db!
      .prepare(
        "UPDATE agent_experiment_groups SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        error instanceof Error ? error.message : String(error),
        failedAt,
        input.experimentId,
      );
    emit("agent_experiment.failed", {
      id: input.experimentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function updateAgentExperimentForRun(runId: string): void {
  const link = one(
    "SELECT experiment_id FROM agent_experiment_runs WHERE run_id = ?",
    [runId],
  );
  if (!link) return;
  updateAgentExperimentRunMetrics(runId);
  const states = rows(
    `SELECT ar.status FROM agent_experiment_runs er
     JOIN agent_runs ar ON ar.id = er.run_id
     WHERE er.experiment_id = ?`,
    [link.experiment_id],
  ).map((item) => String(item.status));
  if (
    states.length !== 3 ||
    states.some((state) => ["queued", "running"].includes(state))
  )
    return;
  const status = states.every((state) => state === "succeeded")
    ? "ready_for_review"
    : "failed";
  const now = timestamp();
  db!
    .prepare(
      "UPDATE agent_experiment_groups SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, now, link.experiment_id);
  emit(`agent_experiment.${status}`, {
    id: link.experiment_id,
    status,
  });
}

function updateAgentExperimentRunMetrics(runId: string): void {
  const record = one(
    `SELECT ar.*, er.metrics_json
     FROM agent_runs ar
     JOIN agent_experiment_runs er ON er.run_id = ar.id
     WHERE ar.id = ?`,
    [runId],
  );
  if (!record) return;
  const items = rows(
    "SELECT type, payload_json FROM agent_items WHERE run_id = ? ORDER BY sequence",
    [runId],
  );
  const recordedTaskType = String(record.task_type);
  const definition = isAgentTaskType(recordedTaskType)
    ? getAgentTaskDefinition(recordedTaskType)
    : undefined;
  const allowedTools = new Set(definition?.allowedTools ?? []);
  const toolViolation = items.some((item) => {
    if (item.type !== "tool_call" || !item.payload_json) return false;
    const payload = domainPayload(item.payload_json);
    const tool = text(payload.tool);
    return Boolean(tool && !allowedTools.has(tool as DramaIpMcpTool));
  });
  const previous = record.metrics_json
    ? domainPayload(record.metrics_json)
    : {};
  const startedAt = Date.parse(String(record.started_at ?? record.created_at));
  const completedAt = Date.parse(
    String(record.completed_at ?? record.updated_at ?? record.created_at),
  );
  const metrics = {
    completed: record.status === "succeeded",
    formatError:
      record.status === "succeeded" &&
      !items.some((item) => item.type === "structured_output"),
    toolViolation,
    latencyMs: Math.max(
      0,
      Number.isFinite(completedAt - startedAt) ? completedAt - startedAt : 0,
    ),
    inputTokens: Number(record.input_tokens ?? 0),
    outputTokens: Number(record.output_tokens ?? 0),
    cachedTokens: Number(record.cached_tokens ?? 0),
    ...(record.estimated_cost === null || record.estimated_cost === undefined
      ? {}
      : { estimatedCost: Number(record.estimated_cost) }),
    ...(record.currency ? { currency: String(record.currency) } : {}),
    adopted: previous.adopted === true,
  };
  db!
    .prepare(
      "UPDATE agent_experiment_runs SET metrics_json = ? WHERE run_id = ?",
    )
    .run(JSON.stringify(metrics), runId);
}

function markAgentExperimentRunAdopted(runId: unknown): void {
  if (typeof runId !== "string") return;
  const record = one(
    "SELECT metrics_json FROM agent_experiment_runs WHERE run_id = ?",
    [runId],
  );
  if (!record) return;
  const metrics = record.metrics_json ? domainPayload(record.metrics_json) : {};
  db!
    .prepare(
      "UPDATE agent_experiment_runs SET metrics_json = ? WHERE run_id = ?",
    )
    .run(JSON.stringify({ ...metrics, adopted: true }), runId);
}

function getAgentExperiment(
  res: ServerResponse,
  id: string,
  requestId: string,
): void {
  const record = one("SELECT * FROM agent_experiment_groups WHERE id = ?", [
    id,
  ]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "三引擎盲测不存在", requestId);
  json(res, 200, agentExperimentRecord(record));
}

async function reviewAgentExperiment(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestId: string,
): Promise<void> {
  const record = one("SELECT * FROM agent_experiment_groups WHERE id = ?", [
    id,
  ]);
  if (!record)
    return respondError(res, 404, "NOT_FOUND", "三引擎盲测不存在", requestId);
  if (record.status !== "ready_for_review")
    return respondError(
      res,
      409,
      "CONFLICT",
      "盲测结果尚未全部完成",
      requestId,
    );
  const input = await body(req);
  if (
    !["one", "two", "three", "tie"].includes(String(input.preferredCandidate))
  )
    return respondError(
      res,
      400,
      "VALIDATION_ERROR",
      "请选择有效的盲测结果",
      requestId,
    );
  const now = timestamp();
  db!.exec("BEGIN IMMEDIATE");
  try {
    db!
      .prepare(
        `INSERT INTO agent_experiment_reviews(
          id, experiment_id, preferred_candidate, notes, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        id,
        input.preferredCandidate,
        typeof input.notes === "string" ? input.notes : null,
        now,
      );
    db!
      .prepare(
        "UPDATE agent_experiment_groups SET status = 'completed', revealed = 1, updated_at = ? WHERE id = ?",
      )
      .run(now, id);
    db!.exec("COMMIT");
  } catch (error) {
    try {
      db!.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  const updated = agentExperimentRecord(
    one("SELECT * FROM agent_experiment_groups WHERE id = ?", [id])!,
  );
  emit("agent_experiment.reviewed", updated);
  json(res, 200, updated);
}

type AgentRunExecutionInput = {
  sessionId: string;
  engineSessionId: string;
  taskId: string;
  runId: string;
  taskType: AgentTaskType;
  engineKind: AgentEngineKind;
  prompt: string;
  projectId: string;
  chapterId?: string;
  operation: AgentRunOperation;
  model?: AgentModelSelection;
  chapterBaseVersion?: number;
};

function enqueueAgentRun(input: AgentRunExecutionInput): void {
  const predecessor = agentEngineRunQueues.get(input.engineKind);
  if (predecessor) {
    const now = timestamp();
    db!
      .prepare(
        "UPDATE tasks SET status = 'queued', progress = 0, updated_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(now, input.taskId);
    db!
      .prepare(
        "UPDATE agent_runs SET status = 'queued', started_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(now, input.runId);
    const queuedTask = one("SELECT * FROM tasks WHERE id = ?", [input.taskId]);
    const queuedRun = one("SELECT * FROM agent_runs WHERE id = ?", [
      input.runId,
    ]);
    if (queuedTask) emit("task.updated", task(queuedTask));
    if (queuedRun) emit("agent_run.queued", agentRunRecord(queuedRun));
  }
  const execution = (predecessor ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = one("SELECT status FROM tasks WHERE id = ?", [
        input.taskId,
      ]);
      if (
        !current ||
        ["canceled", "interrupted"].includes(String(current.status))
      ) {
        updateAgentExperimentForRun(input.runId);
        return;
      }
      const now = timestamp();
      db!
        .prepare(
          "UPDATE tasks SET status = 'running', progress = MAX(progress, 0.05), updated_at = ? WHERE id = ?",
        )
        .run(now, input.taskId);
      db!
        .prepare(
          "UPDATE agent_runs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
        )
        .run(now, now, input.runId);
      const runningTask = one("SELECT * FROM tasks WHERE id = ?", [
        input.taskId,
      ]);
      const runningRun = one("SELECT * FROM agent_runs WHERE id = ?", [
        input.runId,
      ]);
      if (runningTask) emit("task.updated", task(runningTask));
      if (runningRun) emit("agent_run.started", agentRunRecord(runningRun));
      await executeAgentRun(input);
    });
  agentEngineRunQueues.set(input.engineKind, execution);
  const cleanup = () => {
    if (agentEngineRunQueues.get(input.engineKind) === execution)
      agentEngineRunQueues.delete(input.engineKind);
  };
  void execution.then(cleanup, cleanup);
}

async function executeAgentRun(input: AgentRunExecutionInput): Promise<void> {
  const definition = getAgentTaskDefinition(input.taskType);
  const runRecord = one(
    "SELECT context_snapshot_id FROM agent_runs WHERE id = ?",
    [input.runId],
  );
  const claims: McpAccessClaims = {
    tokenId: randomUUID(),
    userId: "desktop-owner",
    projectId: input.projectId,
    sessionId: input.sessionId,
    runId: input.runId,
    contextSnapshotId: String(runRecord?.context_snapshot_id ?? ""),
    tools: definition.allowedTools,
    expiresAt: Date.now() + 15 * 60 * 1_000,
    maxResultBytes: 512 * 1_024,
  };
  try {
    if (activeMcpClaims.has(input.engineKind))
      throw new Error(
        `${agentEngineDescriptor(input.engineKind).name} 正在执行另一项任务，请等待完成后重试`,
      );
    activeMcpClaims.set(input.engineKind, claims);
    const result =
      input.engineKind === "opencode"
        ? await runOpenCodeWithEvents(
            input.engineSessionId,
            input.runId,
            input.prompt,
            input.model,
          )
        : await bridgeEngineRequest(input.engineKind, "run", {
            engineSessionId: input.engineSessionId,
            runId: input.runId,
            taskType: input.taskType,
            prompt: input.prompt,
            projectId: input.projectId,
            ...(input.model ? { model: input.model } : {}),
            ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          });
    const now = timestamp();
    const currentTask = one("SELECT * FROM tasks WHERE id = ?", [input.taskId]);
    if (!currentTask || currentTask.status === "canceled") {
      db!
        .prepare(
          "UPDATE agent_sessions SET active_task_id = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, input.sessionId);
      const session = one("SELECT * FROM agent_sessions WHERE id = ?", [
        input.sessionId,
      ]);
      if (session)
        emit("agent_session.interrupted", {
          ...agentSession(session),
          taskId: input.taskId,
        });
      updateAgentExperimentForRun(input.runId);
      return;
    }
    let taskResult: unknown = result;
    let createdPreview: ReturnType<typeof revision> | undefined;
    if (input.operation === "revision") {
      const proposal = extractRevisionProposal(result);
      if (
        proposal &&
        input.chapterId &&
        input.chapterBaseVersion !== undefined
      ) {
        createdPreview = createAgentRevisionPreview({
          chapterId: input.chapterId,
          baseVersion: input.chapterBaseVersion,
          proposedContent: proposal.proposedContent,
          rationale: proposal.rationale,
        });
        taskResult = {
          message: "已生成章节修订预览；请在任务中心核对差异后，由你确认采用。",
          revisionPreview: createdPreview,
          engine: result,
        };
      } else {
        taskResult = {
          message: "智能助手未按受控格式返回完整修订正文，未创建修订预览。",
          revisionWarning:
            "请调整任务要求后重试；系统不会把未标记的模型文本直接写入章节。",
          engine: result,
        };
      }
    }
    const normalized = extractStructuredAgentOutput(result);
    const changePreview =
      definition.writePolicy === "change-preview"
        ? createAgentChangePreview({
            projectId: input.projectId,
            chapterId: input.chapterId,
            chapterBaseVersion: input.chapterBaseVersion,
            sessionId: input.sessionId,
            runId: input.runId,
            taskId: input.taskId,
            engineKind: input.engineKind,
            taskType: input.taskType,
            normalized,
          })
        : undefined;
    const providerActionPreview =
      definition.writePolicy === "provider-action-preview"
        ? createAgentProviderActionPreview({
            projectId: input.projectId,
            sessionId: input.sessionId,
            runId: input.runId,
            taskId: input.taskId,
            normalized,
          })
        : undefined;
    if (!createdPreview && (changePreview || providerActionPreview))
      taskResult = {
        message: changePreview
          ? "已生成待确认的内容变更预览，正式内容尚未修改。"
          : "已生成待确认的厂商调用方案，尚未产生费用。",
        output: normalized,
        ...(changePreview ? { changePreview } : {}),
        ...(providerActionPreview ? { providerActionPreview } : {}),
      };
    db!
      .prepare(
        "UPDATE agent_items SET status = 'completed', updated_at = ? WHERE run_id = ? AND status = 'streaming'",
      )
      .run(now, input.runId);
    const itemId = randomUUID();
    db!
      .prepare(
        `INSERT INTO agent_items(
          id, run_id, sequence, type, status, content, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        input.runId,
        nextAgentItemSequence(input.runId),
        normalized ? "structured_output" : "message",
        normalized?.content ?? collectAgentText(result).slice(0, 200_000),
        JSON.stringify(result),
        now,
        now,
      );
    db!
      .prepare(
        "UPDATE tasks SET status = ?, progress = 1, result_json = ?, updated_at = ? WHERE id = ?",
      )
      .run("succeeded", JSON.stringify(taskResult), now, input.taskId);
    db!
      .prepare(
        "UPDATE agent_runs SET status = 'succeeded', completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, input.runId);
    db!
      .prepare(
        "UPDATE agent_sessions SET status = ?, active_task_id = NULL, updated_at = ? WHERE id = ?",
      )
      .run("idle", now, input.sessionId);
    recordGeneration({
      projectId: input.projectId,
      taskId: input.taskId,
      kind: `${agentEngineDescriptor(input.engineKind).name} ${getAgentTaskDefinition(input.taskType).label}`,
      title: getAgentTaskDefinition(input.taskType).label,
      status: "已完成",
      summary:
        input.operation === "revision"
          ? createdPreview
            ? `已通过受控 ${agentEngineDescriptor(input.engineKind).name} 会话生成修订预览；尚未修改正式章节，需由用户确认采用。`
            : `${agentEngineDescriptor(input.engineKind).name} 已返回结果，但未满足修订预览格式，未修改正式章节。`
          : `已通过受控 ${agentEngineDescriptor(input.engineKind).name} 会话生成结果。`,
    });
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [input.taskId])!),
    );
    emit("agent_session.completed", {
      ...agentSession(
        one("SELECT * FROM agent_sessions WHERE id = ?", [input.sessionId])!,
      ),
      taskId: input.taskId,
      runId: input.runId,
    });
    emit(
      "agent_item.completed",
      agentItemRecord(one("SELECT * FROM agent_items WHERE id = ?", [itemId])!),
    );
    emit(
      "agent_run.completed",
      agentRunRecord(
        one("SELECT * FROM agent_runs WHERE id = ?", [input.runId])!,
      ),
    );
    updateAgentExperimentForRun(input.runId);
  } catch (error) {
    const now = timestamp();
    const description = error instanceof Error ? error.message : String(error);
    const currentTask = one("SELECT * FROM tasks WHERE id = ?", [input.taskId]);
    if (currentTask?.status === "canceled") {
      db!
        .prepare(
          "UPDATE agent_sessions SET active_task_id = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, input.sessionId);
      const session = one("SELECT * FROM agent_sessions WHERE id = ?", [
        input.sessionId,
      ]);
      if (session)
        emit("agent_session.interrupted", {
          ...agentSession(session),
          taskId: input.taskId,
        });
      updateAgentExperimentForRun(input.runId);
      return;
    }
    db!
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run("failed", description, now, input.taskId);
    db!
      .prepare(
        "UPDATE agent_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(description, now, now, input.runId);
    db!
      .prepare(
        "UPDATE agent_sessions SET status = ?, active_task_id = NULL, updated_at = ? WHERE id = ?",
      )
      .run("failed", now, input.sessionId);
    emit(
      "task.updated",
      task(one("SELECT * FROM tasks WHERE id = ?", [input.taskId])!),
    );
    emit("agent_session.failed", {
      ...agentSession(
        one("SELECT * FROM agent_sessions WHERE id = ?", [input.sessionId])!,
      ),
      taskId: input.taskId,
      error: description,
      runId: input.runId,
    });
    const failedRun = one("SELECT * FROM agent_runs WHERE id = ?", [
      input.runId,
    ]);
    if (failedRun) emit("agent_run.failed", agentRunRecord(failedRun));
    updateAgentExperimentForRun(input.runId);
  } finally {
    if (activeMcpClaims.get(input.engineKind)?.tokenId === claims.tokenId)
      activeMcpClaims.delete(input.engineKind);
  }
}

async function runOpenCodeWithEvents(
  sessionId: string,
  runId: string,
  prompt: string,
  model?: AgentModelSelection,
): Promise<unknown> {
  const controller = new AbortController();
  let markConnected: (() => void) | undefined;
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve;
  });
  const events = consumeOpenCodeEvents(
    sessionId,
    runId,
    controller.signal,
    () => markConnected?.(),
  );
  await Promise.race([
    connected,
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);
  try {
    const activeProvider = activeAgentProviderId();
    const provider = activeProvider
      ? one(
          "SELECT * FROM domain_entities WHERE id = ? AND domain = 'providers'",
          [activeProvider],
        )
      : undefined;
    const configuration = provider
      ? openCodeProviderConfiguration(provider)
      : undefined;
    return await engineRequest(
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        body: JSON.stringify({
          agent: "build",
          ...(model?.modelId && configuration
            ? {
                model: {
                  providerID: configuration.providerKind,
                  modelID: model.modelId,
                },
              }
            : {}),
          parts: [{ type: "text", text: prompt }],
        }),
      },
    );
  } finally {
    controller.abort();
    await events.catch(() => undefined);
  }
}

async function consumeOpenCodeEvents(
  sessionId: string,
  runId: string,
  signal: AbortSignal,
  onConnected: () => void,
): Promise<void> {
  const engine = command?.opencode;
  if (!engine?.healthy) return;
  const authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
  const response = await fetch(new URL("/global/event", engine.url), {
    headers: { Authorization: authorization, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) return;
  onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!data) continue;
      let envelope: Record<string, any>;
      try {
        envelope = JSON.parse(data) as Record<string, any>;
      } catch {
        continue;
      }
      const payload = (envelope.payload ?? envelope) as Record<string, any>;
      const properties = (payload.properties ?? {}) as Record<string, any>;
      const part = properties.part as Record<string, any> | undefined;
      const eventSessionId = String(
        part?.sessionID ??
          properties.info?.sessionID ??
          properties.sessionID ??
          "",
      );
      if (eventSessionId !== sessionId) continue;
      if (
        payload.type === "message.part.updated" &&
        part?.type === "text" &&
        typeof properties.delta === "string"
      )
        recordAgentEngineEvent(runId, {
          type: "content.delta",
          delta: properties.delta,
        });
      if (payload.type === "message.part.updated" && part?.type === "tool")
        recordAgentEngineEvent(runId, {
          type: "tool",
          status:
            part.state?.status === "completed" || part.state?.status === "error"
              ? "completed"
              : "started",
          tool: String(part.tool ?? "DramaIP 只读工具"),
          server: "dramaip",
          itemId: String(part.id ?? ""),
          ...(part.state?.error ? { error: String(part.state.error) } : {}),
        });
      if (
        payload.type === "message.part.updated" &&
        part?.type === "step-finish"
      )
        recordAgentEngineEvent(runId, {
          type: "usage",
          inputTokens: Number(part.tokens?.input ?? 0),
          outputTokens: Number(part.tokens?.output ?? 0),
          cachedTokens: Number(part.tokens?.cache?.read ?? 0),
          estimatedCost: Number(part.cost ?? 0),
        });
    }
  }
}

async function engineRequest(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const engine = command?.opencode;
  if (!engine?.healthy) throw new Error("OpenCode engine is unavailable");
  const authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authorization);
  headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, engine.url), {
    ...init,
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(`OpenCode ${response.status}: ${raw.slice(0, 500)}`);
  return raw ? JSON.parse(raw) : undefined;
}

async function mcp(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  claims: McpAccessClaims,
): Promise<void> {
  if (req.method !== "POST")
    return json(res, 405, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "只读工具接口仅接受 POST 请求" },
    });
  const rpc = await body(req);
  const id = rpc.id;
  const respond = (result: unknown) =>
    json(res, 200, { jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) =>
    json(res, 200, {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, data: { requestId } },
    });
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
    return fail(-32600, "JSON-RPC 请求格式无效");
  if (rpc.method === "notifications/initialized") {
    res.writeHead(202).end();
    return;
  }
  if (rpc.method === "initialize")
    return respond({
      protocolVersion:
        typeof rpc.params?.protocolVersion === "string"
          ? rpc.params.protocolVersion
          : "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "dramaip-readonly", version: "3.0.0" },
    });
  if (rpc.method === "tools/list")
    return respond({
      tools: mcpToolDefinitions().filter((tool) =>
        claims.tools.includes(tool.name as DramaIpMcpTool),
      ),
    });
  if (rpc.method !== "tools/call")
    return fail(-32601, "当前只读工具方法未开放");
  const name = rpc.params?.name;
  const args = rpc.params?.arguments ?? {};
  if (typeof name !== "string" || !args || typeof args !== "object")
    return fail(-32602, "只读工具参数无效");
  const tool = name as DramaIpMcpTool;
  const toolArgs = args as Record<string, unknown>;
  const projectId = mcpToolProjectId(tool, toolArgs);
  if (!projectId) return fail(-32602, "只读资源不存在或不属于当前项目");
  const authorization = authorizeMcpTool({ claims, tool, projectId });
  if (!authorization.allowed) return fail(-32603, authorization.message);
  const value = readMcpTool(tool, toolArgs);
  if (value === undefined) return fail(-32602, "只读工具未开放或资源不存在");
  const serialized = JSON.stringify(value, null, 2);
  const sizeCheck = enforceMcpResultLimit(
    claims,
    Buffer.byteLength(serialized, "utf8"),
  );
  if (!sizeCheck.allowed) return fail(-32603, sizeCheck.message);
  respond({
    content: [{ type: "text", text: serialized }],
    structuredContent: value,
    isError: false,
  });
}

function mcpToolDefinitions() {
  return [
    {
      name: "dramaip_get_project",
      description: "按项目编号读取 DramaIP 项目；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_get_chapter",
      description: "按章节编号读取 DramaIP 章节；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { chapterId: { type: "string" } },
        required: ["chapterId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_chapters",
      description: "读取指定项目的章节资料；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_characters",
      description: "读取指定项目的人物资料；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_search_story_bible",
      description: "搜索指定项目的故事圣经资料；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          query: { type: "string" },
        },
        required: ["projectId", "query"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_analyze_continuity",
      description: "读取连续性分析所需的有序章节和故事圣经依据；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          chapterId: { type: "string" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_search_project",
      description: "在指定项目的章节和创作资料中搜索；只读且最多返回五十项。",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          query: { type: "string" },
        },
        required: ["projectId", "query"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_get_adaptation",
      description: "读取当前项目中的一个改编项目；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { adaptationId: { type: "string" } },
        required: ["adaptationId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_episodes",
      description: "读取一个改编项目下的分集资料；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { adaptationId: { type: "string" } },
        required: ["adaptationId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_get_script",
      description: "读取当前项目中的一个剧本；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { scriptId: { type: "string" } },
        required: ["scriptId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_scenes",
      description: "读取一个剧本下的场景；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { scriptId: { type: "string" } },
        required: ["scriptId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_shots",
      description: "读取一个场景下的分镜；不会写入数据。",
      inputSchema: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
        additionalProperties: false,
      },
    },
    {
      name: "dramaip_list_asset_metadata",
      description: "只读取项目素材的元数据，不返回密钥或本地绝对路径。",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
  ];
}

function mcpDomainProjectId(id: unknown, domain?: string): string | undefined {
  if (typeof id !== "string") return undefined;
  const record = one(
    `SELECT project_id FROM domain_entities WHERE id = ?${domain ? " AND domain = ?" : ""}`,
    domain ? [id, domain] : [id],
  );
  return typeof record?.project_id === "string" ? record.project_id : undefined;
}

function mcpToolProjectId(
  name: DramaIpMcpTool,
  args: Record<string, unknown>,
): string | undefined {
  if (
    [
      "dramaip_get_project",
      "dramaip_list_chapters",
      "dramaip_list_characters",
      "dramaip_search_story_bible",
      "dramaip_analyze_continuity",
      "dramaip_search_project",
      "dramaip_list_asset_metadata",
    ].includes(name)
  )
    return typeof args.projectId === "string" ? args.projectId : undefined;
  if (name === "dramaip_get_chapter" && typeof args.chapterId === "string") {
    const chapterRecord = one("SELECT project_id FROM chapters WHERE id = ?", [
      args.chapterId,
    ]);
    return typeof chapterRecord?.project_id === "string"
      ? chapterRecord.project_id
      : undefined;
  }
  if (name === "dramaip_get_adaptation" || name === "dramaip_list_episodes")
    return mcpDomainProjectId(args.adaptationId, "adaptations");
  if (name === "dramaip_get_script" || name === "dramaip_list_scenes")
    return mcpDomainProjectId(args.scriptId, "scripts");
  if (name === "dramaip_list_shots")
    return mcpDomainProjectId(args.sceneId, "scenes");
  return undefined;
}

function readMcpTool(
  name: DramaIpMcpTool,
  args: Record<string, unknown>,
): unknown {
  if (name === "dramaip_get_project" && typeof args.projectId === "string") {
    const item = one("SELECT * FROM projects WHERE id = ?", [args.projectId]);
    return item ? project(item) : undefined;
  }
  if (name === "dramaip_get_chapter" && typeof args.chapterId === "string") {
    const item = one("SELECT * FROM chapters WHERE id = ?", [args.chapterId]);
    return item ? chapter(item) : undefined;
  }
  if (name === "dramaip_list_chapters" && typeof args.projectId === "string")
    return rows(
      "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
      [args.projectId],
    ).map(chapter);
  if (name === "dramaip_list_characters" && typeof args.projectId === "string")
    return rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
      ["characters", args.projectId],
    ).map(domainEntity);
  if (
    name === "dramaip_search_story_bible" &&
    typeof args.projectId === "string" &&
    typeof args.query === "string"
  ) {
    const needle = args.query.trim().toLocaleLowerCase();
    return rows(
      "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
      ["story-bible", args.projectId],
    )
      .map(domainEntity)
      .filter(
        (item) =>
          !needle ||
          `${item.title}\n${JSON.stringify(item.payload)}`
            .toLocaleLowerCase()
            .includes(needle),
      );
  }
  if (
    name === "dramaip_analyze_continuity" &&
    typeof args.projectId === "string"
  ) {
    const chaptersForProject = rows(
      "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
      [args.projectId],
    ).map(chapter);
    const selected =
      typeof args.chapterId === "string"
        ? chaptersForProject.find((item) => item.id === args.chapterId)
        : undefined;
    if (typeof args.chapterId === "string" && !selected) return undefined;
    return {
      projectId: args.projectId,
      focusChapter: selected,
      orderedChapters: chaptersForProject.map(
        ({ id, orderIndex, title, summary, version }) => ({
          id,
          orderIndex,
          title,
          summary,
          version,
        }),
      ),
      storyBible: rows(
        "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
        ["story-bible", args.projectId],
      ).map(domainEntity),
      characters: rows(
        "SELECT * FROM domain_entities WHERE domain = ? AND project_id = ? ORDER BY updated_at DESC",
        ["characters", args.projectId],
      ).map(domainEntity),
    };
  }
  if (
    name === "dramaip_search_project" &&
    typeof args.projectId === "string" &&
    typeof args.query === "string"
  ) {
    const needle = args.query.trim().toLocaleLowerCase();
    const chapterMatches = rows(
      "SELECT * FROM chapters WHERE project_id = ? ORDER BY updated_at DESC",
      [args.projectId],
    )
      .map(chapter)
      .filter((item) =>
        `${item.title}\n${item.summary}\n${item.content}`
          .toLocaleLowerCase()
          .includes(needle),
      )
      .map((item) => ({
        kind: "chapter",
        id: item.id,
        title: item.title,
        summary: item.summary,
        version: item.version,
      }));
    const resourceMatches = rows(
      `SELECT id, domain, title, payload_json, version
       FROM domain_entities WHERE project_id = ? ORDER BY updated_at DESC`,
      [args.projectId],
    )
      .filter((item) =>
        `${item.title}\n${item.payload_json}`
          .toLocaleLowerCase()
          .includes(needle),
      )
      .map((item) => ({
        kind: String(item.domain),
        id: String(item.id),
        title: String(item.title),
        version: Number(item.version),
      }));
    return [...chapterMatches, ...resourceMatches].slice(0, 50);
  }
  if (
    name === "dramaip_get_adaptation" &&
    typeof args.adaptationId === "string"
  ) {
    const item = one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = 'adaptations'",
      [args.adaptationId],
    );
    return item ? domainEntity(item) : undefined;
  }
  if (name === "dramaip_list_episodes" && typeof args.adaptationId === "string")
    return rows(
      `SELECT * FROM domain_entities
       WHERE domain = 'episodes' AND parent_id = ? ORDER BY updated_at DESC LIMIT 200`,
      [args.adaptationId],
    ).map(domainEntity);
  if (name === "dramaip_get_script" && typeof args.scriptId === "string") {
    const item = one(
      "SELECT * FROM domain_entities WHERE id = ? AND domain = 'scripts'",
      [args.scriptId],
    );
    return item ? domainEntity(item) : undefined;
  }
  if (name === "dramaip_list_scenes" && typeof args.scriptId === "string")
    return rows(
      `SELECT * FROM domain_entities
       WHERE domain = 'scenes' AND parent_id = ? ORDER BY updated_at DESC LIMIT 500`,
      [args.scriptId],
    ).map(domainEntity);
  if (name === "dramaip_list_shots" && typeof args.sceneId === "string")
    return rows(
      `SELECT * FROM domain_entities
       WHERE domain = 'shots' AND parent_id = ? ORDER BY updated_at DESC LIMIT 1000`,
      [args.sceneId],
    ).map(domainEntity);
  if (
    name === "dramaip_list_asset_metadata" &&
    typeof args.projectId === "string"
  )
    return rows(
      `SELECT id, title, version, created_at, updated_at
       FROM domain_entities
       WHERE domain IN ('assets', 'visual-assets', 'shot-stills')
         AND project_id = ? ORDER BY updated_at DESC LIMIT 1000`,
      [args.projectId],
    ).map((item) => ({
      id: String(item.id),
      title: String(item.title),
      version: Number(item.version),
      createdAt: String(item.created_at),
      updatedAt: String(item.updated_at),
    }));
  return undefined;
}

function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const cursor = Number(
    url.searchParams.get("cursor") ?? req.headers["last-event-id"] ?? 0,
  );
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of rows(
    "SELECT * FROM task_events WHERE id > ? ORDER BY id",
    [Number.isFinite(cursor) ? cursor : 0],
  ))
    sendEvent(res, event);
  eventClients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  req.once("close", () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
}
function emit(type: string, payload: unknown): void {
  const occurredAt = timestamp();
  const result = db!
    .prepare(
      "INSERT INTO task_events(type, payload_json, occurred_at) VALUES (?, ?, ?)",
    )
    .run(type, JSON.stringify(payload), occurredAt);
  const event = {
    id: Number(result.lastInsertRowid),
    type,
    payload_json: JSON.stringify(payload),
    occurred_at: occurredAt,
  };
  for (const client of eventClients) sendEvent(client, event);
}
function sendEvent(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ id: event.id, type: event.type, occurredAt: event.occurred_at, payload: JSON.parse(String(event.payload_json)) })}\n\n`,
  );
}
function rows(sql: string, params: any[] = []): Record<string, any>[] {
  return db!.prepare(sql).all(...params) as Record<string, any>[];
}
function one(sql: string, params: any[] = []): Record<string, any> | undefined {
  return db!.prepare(sql).get(...params) as Record<string, any> | undefined;
}
function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function patchOptionalText(value: unknown, fallback: unknown): string | null {
  return typeof value === "string"
    ? value
    : typeof fallback === "string"
      ? fallback
      : null;
}
function patchOptionalInteger(
  value: unknown,
  fallback: unknown,
): number | null {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : typeof fallback === "number"
      ? fallback
      : null;
}
function searchResult(kind: string, row: Record<string, any>) {
  const rawExcerpt = typeof row.excerpt === "string" ? row.excerpt : "";
  return {
    kind,
    id: row.id,
    title: row.title,
    excerpt:
      rawExcerpt.length > 240
        ? `${rawExcerpt.slice(0, 240)}…`
        : rawExcerpt || undefined,
    projectId: row.project_id ?? undefined,
    updatedAt: row.updated_at,
  };
}
function backup(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.file_name,
    size: Number(row.size),
    createdAt: row.created_at,
  };
}
function reviewStringList(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
function scoreFromLength(
  length: number,
  minimum: number,
  ideal: number,
): number {
  if (length <= 0) return 25;
  if (length < minimum) return roundScore(35 + (length / minimum) * 25);
  return roundScore(
    Math.min(90, 60 + ((length - minimum) / Math.max(ideal - minimum, 1)) * 30),
  );
}
function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
function scriptReview(row: Record<string, any>) {
  return {
    id: String(row.id),
    scriptId: String(row.script_id),
    hookStrengthScore: Number(row.hook_strength_score),
    dialogueScore: Number(row.dialogue_score),
    conflictScore: Number(row.conflict_score),
    visualClarityScore: Number(row.visual_clarity_score),
    sceneClarityScore: Number(row.scene_clarity_score),
    characterFitScore: Number(row.character_fit_score),
    shotReadinessScore: Number(row.shot_readiness_score),
    aiVideoFeasibilityScore: Number(row.ai_video_feasibility_score),
    cliffhangerScore: Number(row.cliffhanger_score),
    overallScore: Number(row.overall_score),
    issues: reviewStringList(row.issues_json),
    suggestions: reviewStringList(row.suggestions_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function shotReview(row: Record<string, any>) {
  return {
    id: String(row.id),
    shotId: String(row.shot_id),
    lengthScore: Number(row.length_score),
    characterCountScore: Number(row.character_count_score),
    actionComplexityScore: Number(row.action_complexity_score),
    visualClarityScore: Number(row.visual_clarity_score),
    characterConsistencyScore: Number(row.character_consistency_score),
    sceneContinuityScore: Number(row.scene_continuity_score),
    promptControllabilityScore: Number(row.prompt_controllability_score),
    verticalSuitabilityScore: Number(row.vertical_suitability_score),
    overallScore: Number(row.overall_score),
    aiVideoDifficulty: String(row.ai_video_difficulty) as
      "low" | "medium" | "high",
    issues: reviewStringList(row.issues_json),
    suggestions: reviewStringList(row.suggestions_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function promptVersion(row: Record<string, any>) {
  return {
    id: String(row.id),
    shotId: String(row.shot_id),
    version: Number(row.version),
    taskType: String(row.task_type),
    videoPrompt: String(row.video_prompt),
    ...(row.negative_prompt
      ? { negativePrompt: String(row.negative_prompt) }
      : {}),
    ...(row.image_prompt ? { imagePrompt: String(row.image_prompt) } : {}),
    ...(row.note ? { note: String(row.note) } : {}),
    createdAt: String(row.created_at),
  };
}
function episodeAnalysis(row: Record<string, any>) {
  return {
    id: String(row.id),
    adaptationId: String(row.adaptation_id),
    episodeCount: Number(row.episode_count),
    hookCoverage: Number(row.hook_coverage),
    cliffhangerCoverage: Number(row.cliffhanger_coverage),
    outlineCoverage: Number(row.outline_coverage),
    overallScore: Number(row.overall_score),
    summary: String(row.summary),
    suggestions: reviewStringList(row.suggestions_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function deliveryCreativeVariant(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    adaptationId: String(row.adaptation_id),
    label: String(row.label),
    title: String(row.title),
    description: String(row.description),
    tags: jsonStringArray(row.tags_json),
    ...(row.cover_asset_id ? { coverAssetId: String(row.cover_asset_id) } : {}),
    source: String(row.source) as "manual" | "ai_draft",
    status: String(row.status) as "candidate" | "adopted" | "archived",
    versionNumber: Number(row.version_number),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function platformDeliveryArchive(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    adaptationId: String(row.adaptation_id),
    episodeId: String(row.episode_id),
    profileId: String(row.profile_id),
    profileVersion: String(row.profile_version),
    creativeVariantId: String(row.creative_variant_id),
    deliveryVersion: Number(row.delivery_version),
    sourceFingerprint: String(row.source_fingerprint),
    createdAt: String(row.created_at),
  };
}
function reviewPackage(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    adaptationId: String(row.adaptation_id),
    episodeId: String(row.episode_id),
    kind: "offline" as const,
    status: "exported" as const,
    title: String(row.title),
    manifest: JSON.parse(String(row.manifest_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function reviewComment(row: Record<string, any>) {
  return {
    id: String(row.id),
    packageId: String(row.package_id),
    ...(row.shot_id ? { shotId: String(row.shot_id) } : {}),
    ...(row.timecode_seconds === null || row.timecode_seconds === undefined
      ? {}
      : { timecodeSeconds: Number(row.timecode_seconds) }),
    ...(row.author_alias ? { authorAlias: String(row.author_alias) } : {}),
    body: String(row.body),
    resolved: Boolean(row.resolved),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function reviewDecision(row: Record<string, any>) {
  return {
    id: String(row.id),
    packageId: String(row.package_id),
    ...(row.shot_id ? { shotId: String(row.shot_id) } : {}),
    decision: String(row.decision) as
      "approve" | "return" | "request_changes" | "note",
    ...(row.author_alias ? { authorAlias: String(row.author_alias) } : {}),
    ...(row.note ? { note: String(row.note) } : {}),
    createdAt: String(row.created_at),
  };
}
function complianceRuleProfile(row: Record<string, any>) {
  return {
    id: String(row.id),
    version: String(row.version),
    title: String(row.title),
    sourceUrl: String(row.source_url),
    sourceStatus: String(row.source_status) as
      "official" | "consultation" | "platform_guidance" | "unknown",
    publishedAt: String(row.published_at),
    ...(row.effective_at ? { effectiveAt: String(row.effective_at) } : {}),
    regions: jsonStringArray(row.regions_json),
    platforms: jsonStringArray(row.platforms_json),
    requiredVisibleLabel: String(row.required_visible_label),
    requiredMetadataKeys: jsonStringArray(row.required_metadata_keys_json),
    contentChecksum: String(row.content_checksum),
    integrityStatus: String(row.integrity_status) as
      "verified" | "unchecked" | "invalid",
    active: Number(row.active) === 1,
    builtIn: Number(row.built_in) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function voiceProfile(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    ...(row.character_id ? { characterId: String(row.character_id) } : {}),
    ...(row.sample_asset_id
      ? { sampleAssetId: String(row.sample_asset_id) }
      : {}),
    ...(row.provider_voice
      ? { providerVoice: String(row.provider_voice) }
      : {}),
    ...(row.description ? { description: String(row.description) } : {}),
    status: String(row.status) as "draft" | "adopted",
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function audioTrack(row: Record<string, any>, context: EpisodeMediaContext) {
  const stale = audioTrackIsStale(row, context);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    episodeId: String(row.episode_id),
    kind: String(row.kind) as AudioTrackKind,
    label: String(row.label),
    sourceFingerprint: String(row.source_fingerprint),
    clips: parseAudioTrackClips(row.clips_json),
    status: String(row.status) as "draft" | "adopted",
    stale,
    ...(stale
      ? {
          staleReason:
            "镜头或剧本已更新；请从当前分集重新初始化并另存音轨版本。",
        }
      : {}),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function animaticDraft(row: Record<string, any>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    episodeId: String(row.episode_id),
    sourceFingerprint: String(row.source_fingerprint),
    clips: parseAnimaticClips(row.clips_json),
    annotations: String(row.annotations ?? ""),
    status: String(row.status) as "draft" | "approved" | "returned",
    ...(row.review_note ? { reviewNote: String(row.review_note) } : {}),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function project(row: Record<string, any>) {
  return {
    id: row.id,
    title: row.title,
    shortDramaType: row.short_drama_type,
    targetAudience: row.target_audience ?? undefined,
    targetWordCount:
      row.target_word_count === null || row.target_word_count === undefined
        ? undefined
        : Number(row.target_word_count),
    targetEpisodeCount:
      row.target_episode_count === null ||
      row.target_episode_count === undefined
        ? undefined
        : Number(row.target_episode_count),
    coreHook: row.core_hook ?? undefined,
    emotionalCore: row.emotional_core ?? undefined,
    coreSellingPoint: row.core_selling_point ?? undefined,
    synopsis: row.synopsis,
    styleGuide: row.style_guide ?? undefined,
    visualStyleDirection: row.visual_style_direction ?? undefined,
    genreOpportunity: row.genre_opportunity ?? undefined,
    productionBrief: row.production_brief ?? undefined,
    currentAdaptationId: row.current_adaptation_id ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function chapter(row: Record<string, any>) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    orderIndex: Number(row.order_index),
    summary: row.summary,
    outline: row.outline ?? undefined,
    content: row.content,
    mainConflict: row.main_conflict ?? undefined,
    hook: row.hook ?? undefined,
    highlight: row.highlight ?? undefined,
    reversal: row.reversal ?? undefined,
    cliffhanger: row.cliffhanger ?? undefined,
    shortDramaNote: row.short_drama_note ?? undefined,
    aiVideoNote: row.ai_video_note ?? undefined,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function task(row: Record<string, any>) {
  const rawResult = row.result_json ? JSON.parse(row.result_json) : undefined;
  const retryContext = domainPayload(rawResult).retry;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    progress: Number(row.progress),
    projectId: row.project_id ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    result: row.status === "succeeded" || !retryContext ? rawResult : undefined,
    error: row.error ? publicErrorMessage(String(row.error)) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function revision(row: Record<string, any>) {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    baseVersion: Number(row.base_version),
    proposedContent: row.proposed_content,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at,
    committedAt: row.committed_at ?? undefined,
  };
}
function agentSession(row: Record<string, any>) {
  return {
    id: row.id,
    engineSessionId: row.engine_session_id,
    engineKind: row.engine_kind,
    projectId: row.project_id,
    chapterId: row.chapter_id ?? undefined,
    taskType: row.task_type ?? undefined,
    title: row.title ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function domainEntity(row: Record<string, any>) {
  return {
    id: row.id,
    domain: row.domain,
    projectId: row.project_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    payload: JSON.parse(row.payload_json),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  try {
    const [username, password] = Buffer.from(header.slice(6), "base64")
      .toString("utf8")
      .split(":");
    return username === "dramaip" && password === command?.password;
  } catch {
    return false;
  }
}
function mcpEngineForRequest(
  req: IncomingMessage,
): AgentEngineKind | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice(7);
  for (const engineKind of ["opencode", "codex", "langgraph"] as const)
    if (token && token === command?.mcpTokens?.[engineKind]) return engineKind;
  if (token && token === command?.mcpToken) return "opencode";
  return undefined;
}
function isAllowedOrigin(origin: string): boolean {
  return command?.allowedOrigins.includes(origin) === true;
}
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Idempotency-Key, Last-Event-ID",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
  }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
function respondError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): void {
  json(res, status, {
    code,
    message: publicErrorMessage(message, code),
    requestId,
    ...(details === undefined ? {} : { details }),
  });
}

function publicErrorMessage(raw: string, code?: string): string {
  if (/[㐀-鿿]/u.test(raw)) return raw;
  const known: Record<string, string> = {
    "Server is not initialized": "本地服务尚未初始化",
    "Origin is not allowed": "当前界面来源未获授权",
    "Invalid server credentials": "本地服务身份验证失败",
    "Invalid MCP credentials": "智能引擎工具身份验证失败",
    "Database unavailable": "本地数据库暂不可用",
    "Project not found": "未找到项目",
    "Chapter not found": "未找到章节",
    "Agent session not found": "未找到智能会话",
    "Agent session is already running": "智能会话已有正在执行的任务",
    "OpenCode engine is unavailable": "OpenCode 引擎当前不可用",
  };
  if (known[raw]) return known[raw];
  if (raw.startsWith("OpenCode ")) return "OpenCode 引擎调用失败";
  if (raw.startsWith("Codex ")) return "Codex 引擎调用失败";
  if (raw.startsWith("LangGraph")) return "LangGraph.js 引擎调用失败";
  if (code === "VALIDATION_ERROR") return "请求参数无效，请检查后重试";
  if (code === "NOT_FOUND") return "未找到所请求的内容";
  if (code === "CONFLICT") return "内容状态已变化，请刷新后重试";
  if (code === "UNAUTHORIZED") return "当前操作未获授权";
  if (code === "ENGINE_UNAVAILABLE") return "所选智能引擎当前不可用";
  if (code === "TASK_REJECTED") return "当前任务无法执行";
  return "操作未能完成，请稍后重试";
}
async function body(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function match(path: string, expression: RegExp): string | undefined {
  const result = expression.exec(path);
  return result?.[1] ? decodeURIComponent(result[1]) : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)$/i.test(
        key,
      ) || containsSecret(nested),
  );
}
function diagnosticPrompt(
  sourceProject: Record<string, any>,
  sourceChapter: Record<string, any> | undefined,
  instructions?: string,
): string {
  const projectInfo = project(sourceProject);
  const chapterInfo = sourceChapter ? chapter(sourceChapter) : undefined;
  return [
    "你是 DramaIP 的章节诊断助手。只能分析，并提出可供用户确认的修订建议；绝不能直接写入内容、调用 shell、读取本地文件或联网。",
    "请使用 DramaIP 只读 MCP 工具核对必要上下文。输出包含：问题清单、连续性风险、可执行的修订建议和一份候选改写。",
    ...(instructions ? [`用户的补充要求：${instructions}`] : []),
    `项目快照：${JSON.stringify(projectInfo)}`,
    `章节快照：${JSON.stringify(chapterInfo ?? { note: "未指定章节，请给项目级诊断。" })}`,
  ].join("\n\n");
}

function revisionPrompt(
  sourceProject: Record<string, any>,
  sourceChapter: Record<string, any>,
  instructions?: string,
): string {
  const projectInfo = project(sourceProject);
  const chapterInfo = chapter(sourceChapter);
  return [
    "你是 DramaIP 的受控章节修订助手。只能使用 DramaIP 的只读 MCP 工具核对上下文；绝不能写入正式内容、调用 shell、读取本地文件或联网。",
    "请针对指定章节给出一份可直接替换章节正文的完整候选稿。不要调用任何提交、写入或文件工具；系统会把你的文本保存为待用户确认的修订预览。",
    "必须严格使用以下 XML 标记输出，标记外可补充简短说明：",
    "<dramaip-revision>这里放完整候选正文</dramaip-revision>",
    "<dramaip-rationale>这里放修改理由与连续性注意事项</dramaip-rationale>",
    "若无法给出完整候选正文，请明确说明原因，且不要伪造上述标记。",
    ...(instructions ? [`用户的补充要求：${instructions}`] : []),
    `项目快照：${JSON.stringify(projectInfo)}`,
    `章节快照：${JSON.stringify(chapterInfo)}`,
  ].join("\n\n");
}

function extractRevisionProposal(
  value: unknown,
): { proposedContent: string; rationale: string } | undefined {
  const fragments: string[] = [];
  const seen = new Set<unknown>();
  const collect = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || current === undefined) return;
    if (typeof current === "string") {
      fragments.push(current);
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const nested of current) collect(nested, depth + 1);
      return;
    }
    const object = current as Record<string, unknown>;
    // OpenCode text parts are preferred, but keep the traversal tolerant of
    // provider-specific response envelopes.
    if (typeof object.text === "string") fragments.push(object.text);
    for (const [key, nested] of Object.entries(object))
      if (key !== "text") collect(nested, depth + 1);
  };
  collect(value, 0);
  for (const fragment of fragments) {
    const revisionMatch =
      /<dramaip-revision>\s*([\s\S]*?)\s*<\/dramaip-revision>/i.exec(fragment);
    if (!revisionMatch?.[1]?.trim()) continue;
    const rationaleMatch =
      /<dramaip-rationale>\s*([\s\S]*?)\s*<\/dramaip-rationale>/i.exec(
        fragment,
      );
    return {
      proposedContent: revisionMatch[1].trim(),
      rationale: rationaleMatch?.[1]?.trim() || "智能引擎未单独提供修订说明。",
    };
  }
  return undefined;
}

function collectAgentText(value: unknown): string {
  const fragments: string[] = [];
  const seen = new Set<unknown>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > 10 || current === null || current === undefined) return;
    if (typeof current === "string") {
      fragments.push(current);
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const object = current as Record<string, unknown>;
    if (typeof object.text === "string") fragments.push(object.text);
    if (typeof object.content === "string") fragments.push(object.content);
    for (const [key, nested] of Object.entries(object))
      if (key !== "text" && key !== "content") visit(nested, depth + 1);
  };
  visit(value, 0);
  return [
    ...new Set(fragments.map((item) => item.trim()).filter(Boolean)),
  ].join("\n");
}

function extractStructuredAgentOutput(
  value: unknown,
): { summary: string; content?: string; data?: unknown } | undefined {
  const candidates: unknown[] = [value];
  const text = collectAgentText(value);
  if (text) {
    candidates.push(text);
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
      candidates.push(match[1]);
    const objectMatch = /\{[\s\S]*\}/.exec(text);
    if (objectMatch) candidates.push(objectMatch[0]);
  }
  for (const candidate of candidates) {
    let object: unknown = candidate;
    if (typeof candidate === "string") {
      try {
        object = JSON.parse(candidate.trim());
      } catch {
        continue;
      }
    }
    if (!object || typeof object !== "object" || Array.isArray(object))
      continue;
    const record = object as Record<string, unknown>;
    if (typeof record.summary !== "string") continue;
    return {
      summary: record.summary,
      ...(typeof record.content === "string"
        ? { content: record.content }
        : {}),
      ...(record.data !== undefined ? { data: record.data } : {}),
    };
  }
  return text ? { summary: text.slice(0, 500), content: text } : undefined;
}

function changeTargetBelongsToProject(
  projectId: string,
  kind: string,
  id: string,
): boolean {
  if (kind === "project")
    return (
      Boolean(one("SELECT id FROM projects WHERE id = ?", [id])) &&
      id === projectId
    );
  if (kind === "chapter")
    return Boolean(
      one("SELECT id FROM chapters WHERE id = ? AND project_id = ?", [
        id,
        projectId,
      ]),
    );
  const domainByKind: Record<string, string> = {
    character: "characters",
    outline: "outlines",
    story_bible: "story-bible",
    episode: "episodes",
    script: "scripts",
    scene: "scenes",
    shot: "shots",
  };
  const domain = domainByKind[kind];
  return Boolean(
    domain &&
    one(
      "SELECT id FROM domain_entities WHERE id = ? AND project_id = ? AND domain = ?",
      [id, projectId, domain],
    ),
  );
}

function createAgentChangePreview(input: {
  projectId: string;
  chapterId?: string;
  chapterBaseVersion?: number;
  sessionId: string;
  runId: string;
  taskId: string;
  engineKind: AgentEngineKind;
  taskType: AgentTaskType;
  normalized?: { summary: string; content?: string; data?: unknown };
}) {
  if (!input.normalized) return undefined;
  const data =
    input.normalized.data && typeof input.normalized.data === "object"
      ? (input.normalized.data as Record<string, unknown>)
      : undefined;
  const rawTargets = Array.isArray(data?.targets) ? data.targets : undefined;
  const targets: Array<{
    kind: string;
    id: string;
    baseVersion: number;
    patch: unknown;
    displayDiff?: unknown;
  }> = [];
  if (rawTargets) {
    for (const raw of rawTargets) {
      if (!raw || typeof raw !== "object") continue;
      const target = raw as Record<string, unknown>;
      if (
        typeof target.kind !== "string" ||
        typeof target.id !== "string" ||
        !Number.isInteger(target.baseVersion) ||
        target.patch === undefined ||
        !changeTargetBelongsToProject(input.projectId, target.kind, target.id)
      )
        continue;
      targets.push({
        kind: target.kind,
        id: target.id,
        baseVersion: Number(target.baseVersion),
        patch: target.patch,
        ...(target.displayDiff !== undefined
          ? { displayDiff: target.displayDiff }
          : {}),
      });
    }
  }
  if (
    targets.length === 0 &&
    input.chapterId &&
    input.chapterBaseVersion !== undefined &&
    input.normalized.content
  )
    targets.push({
      kind: "chapter",
      id: input.chapterId,
      baseVersion: input.chapterBaseVersion,
      patch: { content: input.normalized.content },
      displayDiff: { proposedContent: input.normalized.content },
    });
  if (targets.length === 0) return undefined;
  const id = randomUUID();
  const createdAt = timestamp();
  const serializedTargets = JSON.stringify(targets);
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        taskType: input.taskType,
        targets,
      }),
    )
    .digest("hex");
  db!
    .prepare(
      `INSERT INTO change_previews(
        id, project_id, session_id, run_id, task_id, engine_kind, task_type,
        targets_json, rationale, status, content_hash, created_at, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
    )
    .run(
      id,
      input.projectId,
      input.sessionId,
      input.runId,
      input.taskId,
      input.engineKind,
      input.taskType,
      serializedTargets,
      input.normalized.summary,
      contentHash,
      createdAt,
    );
  const created = changePreviewRecord(
    one("SELECT * FROM change_previews WHERE id = ?", [id])!,
  );
  emit("change_preview.created", created);
  return created;
}

function createAgentProviderActionPreview(input: {
  projectId: string;
  sessionId: string;
  runId: string;
  taskId: string;
  normalized?: { summary: string; content?: string; data?: unknown };
}) {
  if (!input.normalized?.data || typeof input.normalized.data !== "object")
    return undefined;
  const root = input.normalized.data as Record<string, unknown>;
  const action =
    root.providerAction && typeof root.providerAction === "object"
      ? (root.providerAction as Record<string, unknown>)
      : root;
  if (
    !["image", "audio", "video", "remote_render"].includes(
      String(action.kind),
    ) ||
    typeof action.providerId !== "string" ||
    action.parameters === undefined
  )
    return undefined;
  if (
    !one(
      "SELECT id FROM domain_entities WHERE id = ? AND domain = 'providers'",
      [action.providerId],
    )
  )
    return undefined;
  const id = randomUUID();
  const createdAt = timestamp();
  db!
    .prepare(
      `INSERT INTO provider_action_previews(
        id, project_id, session_id, run_id, task_id, kind, provider_id,
        model_id, parameters_json, estimated_cost, currency, status,
        created_at, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    )
    .run(
      id,
      input.projectId,
      input.sessionId,
      input.runId,
      input.taskId,
      String(action.kind),
      action.providerId,
      typeof action.modelId === "string" ? action.modelId : null,
      JSON.stringify(action.parameters),
      typeof action.estimatedCost === "number" ? action.estimatedCost : null,
      typeof action.currency === "string" ? action.currency : null,
      createdAt,
    );
  const created = providerActionPreviewRecord(
    one("SELECT * FROM provider_action_previews WHERE id = ?", [id])!,
  );
  emit("provider_action_preview.created", created);
  return created;
}
function timestamp(): string {
  return new Date().toISOString();
}
function serializeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) };
}
