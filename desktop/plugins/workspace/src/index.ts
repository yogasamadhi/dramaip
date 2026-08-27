import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  CREATIVE_QUALITY_SERVICE,
  type CreativeQualityRecordService,
} from "@dramaip/contracts/creative-quality";
import {
  DELIVERY_RECORD_SERVICE,
  type DeliveryRecordService,
} from "@dramaip/contracts/delivery";
import {
  MEDIA_RECORD_SERVICE,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  REVIEW_RECORD_SERVICE,
  type ReviewRecordService,
} from "@dramaip/contracts/review";
import {
  ProjectInputSchema,
  ProjectCreationResultSchema,
  ProjectDerivationCommitInputSchema,
  ProjectDerivationCommitResultSchema,
  ProjectDerivationInputSchema,
  ProjectDerivationPreviewSchema,
  ProjectInitializationSchema,
  ProjectModeConfigSchema,
  ProjectPatchSchema,
  ProjectPurgeSchema,
  ProjectSchema,
  WORKSPACE_PROJECT_SERVICE,
  type ProjectInitialization,
  type ProjectMode,
  type ProjectModeConfig,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
  type WritingChapterService,
  type WritingResourceService,
} from "@dramaip/contracts/writing";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z } from "zod";
import { seriesMigrations, seriesRoutes } from "./series.js";
import {
  workspaceMaintenanceMigrations,
  workspaceMaintenanceRoutes,
} from "./maintenance.js";
import {
  sourceImportMigrations,
  sourceImportRoutes,
} from "./source-imports.js";

interface ProjectRow {
  id: string;
  title: string;
  short_drama_type: string;
  mode: ProjectMode;
  mode_config_json: string;
  lifecycle_status: "initializing" | "ready" | "failed";
  derived_from_project_id: string | null;
  target_audience: string | null;
  target_word_count: number | null;
  target_episode_count: number | null;
  core_hook: string | null;
  emotional_core: string | null;
  core_selling_point: string | null;
  synopsis: string;
  style_guide: string | null;
  visual_style_direction: string | null;
  genre_opportunity: string | null;
  production_brief: string | null;
  current_adaptation_id: string | null;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  series_id: string | null;
  series_title: string | null;
}

interface RouteContext {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;

const problemResponses = {
  400: {
    description: "Invalid request",
    content: { "application/problem+json": { schema: ProblemDetailsSchema } },
  },
  404: {
    description: "Not found",
    content: { "application/problem+json": { schema: ProblemDetailsSchema } },
  },
  409: {
    description: "Version conflict",
    content: { "application/problem+json": { schema: ProblemDetailsSchema } },
  },
} as const;

const idParams = z.object({ id: z.string().uuid() });

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: RouteHandler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function problem(
  context: RouteContext,
  status: number,
  code: string,
  title: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      detail: title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function defaultModeConfig(mode: ProjectMode): ProjectModeConfig {
  switch (mode) {
    case "series_longform":
      return {
        mode,
        targetChapterCount: 300,
        targetSeasonCount: 5,
      };
    case "single_season":
      return { mode, entryPath: "novel", targetEpisodeCount: 80 };
    case "personal_theater":
      return {
        mode,
        storyMethod: "template",
        episodeCount: 1,
        episodeDurationMinutes: 5,
      };
    case "creator_channel":
      return { mode, topic: "待确定主题", riskDomain: "general" };
  }
}

function modeConfigFor(input: ProjectInput): ProjectModeConfig | undefined {
  const mode = input.mode ?? "series_longform";
  const candidate = input.modeConfig ?? defaultModeConfig(mode);
  const parsed = ProjectModeConfigSchema.safeParse(candidate);
  return parsed.success && parsed.data.mode === mode ? parsed.data : undefined;
}

function initializationPlan(mode: ProjectMode): ReadonlyArray<{
  key: string;
  pluginId: string;
  message: string;
}> {
  const shared = [
    { key: "workspace", pluginId: "workspace", message: "项目空间已建立" },
    { key: "writing", pluginId: "writing", message: "写作资料已准备" },
  ];
  if (mode === "creator_channel")
    return [
      ...shared,
      { key: "knowledge", pluginId: "knowledge", message: "研究资料库已准备" },
      { key: "review", pluginId: "review", message: "事实与合规检查已准备" },
      { key: "delivery", pluginId: "delivery", message: "内容包导出已准备" },
      { key: "insights", pluginId: "insights", message: "复盘数据区已准备" },
    ];
  if (mode === "series_longform")
    return [
      ...shared,
      { key: "knowledge", pluginId: "knowledge", message: "故事圣经已准备" },
      { key: "production", pluginId: "production", message: "分季改编已准备" },
      { key: "media", pluginId: "media", message: "媒体制作已准备" },
      { key: "review", pluginId: "review", message: "审核工作区已准备" },
      { key: "delivery", pluginId: "delivery", message: "交付工作区已准备" },
    ];
  return [
    ...shared,
    { key: "production", pluginId: "production", message: "分集制作已准备" },
    { key: "media", pluginId: "media", message: "媒体制作已准备" },
    { key: "review", pluginId: "review", message: "审核工作区已准备" },
    { key: "delivery", pluginId: "delivery", message: "交付工作区已准备" },
  ];
}

interface InitializationRow {
  step_key: string;
  plugin_id: string;
  status: "pending" | "running" | "ready" | "failed";
  message: string | null;
  error_message: string | null;
  attempts: number;
  updated_at: string;
}

function initialization(
  context: PluginContext,
  projectId: string,
): ProjectInitialization {
  return context.uow.execute((transaction) => {
    const current = transaction.get<{
      lifecycle_status: "initializing" | "ready" | "failed";
      updated_at: string;
    }>(
      "SELECT lifecycle_status, updated_at FROM projects WHERE id = ?",
      projectId,
    );
    const rows = transaction.all<InitializationRow>(
      `SELECT step_key, plugin_id, status, message, error_message, attempts, updated_at
       FROM project_initialization_steps
       WHERE project_id = ? ORDER BY rowid`,
      projectId,
    );
    return {
      projectId,
      status: current?.lifecycle_status ?? "failed",
      steps: rows.map((row) => ({
        key: row.step_key,
        pluginId: row.plugin_id,
        status: row.status,
        ...(row.message ? { message: row.message } : {}),
        ...(row.error_message ? { error: row.error_message } : {}),
        attempts: row.attempts,
        updatedAt: row.updated_at,
      })),
      updatedAt: current?.updated_at ?? new Date().toISOString(),
    };
  });
}

function supportedDerivation(
  source: ProjectMode,
  target: ProjectMode,
): string | undefined {
  if (source === "single_season" && target === "series_longform")
    return "single-season-expand";
  if (source === "series_longform" && target === "single_season")
    return "series-season-derive";
  if (source === "personal_theater" && target === "single_season")
    return "personal-theater-expand";
  if (source === "creator_channel" && target === "personal_theater")
    return "creator-story-derive";
  return undefined;
}

function project(row: ProjectRow): Project {
  const fallbackMode: ProjectMode = "series_longform";
  let rawConfig: unknown = {};
  try {
    rawConfig = JSON.parse(row.mode_config_json || "{}");
  } catch {
    // A damaged legacy value must not make the project list unavailable. The
    // forward migration's conservative series default keeps it recoverable.
  }
  const parsedConfig = ProjectModeConfigSchema.safeParse(rawConfig);
  const mode = row.mode ?? fallbackMode;
  const modeConfig =
    parsedConfig.success && parsedConfig.data.mode === mode
      ? parsedConfig.data
      : defaultModeConfig(mode);
  return {
    id: row.id,
    title: row.title,
    ...(row.short_drama_type ? { shortDramaType: row.short_drama_type } : {}),
    mode,
    modeConfig,
    lifecycleStatus: row.lifecycle_status,
    ...(row.derived_from_project_id
      ? { derivedFromProjectId: row.derived_from_project_id }
      : {}),
    targetAudience: optional(row.target_audience),
    targetWordCount: optional(row.target_word_count),
    targetEpisodeCount: optional(row.target_episode_count),
    coreHook: optional(row.core_hook),
    emotionalCore: optional(row.emotional_core),
    coreSellingPoint: optional(row.core_selling_point),
    synopsis: row.synopsis,
    styleGuide: optional(row.style_guide),
    visualStyleDirection: optional(row.visual_style_direction),
    genreOpportunity: optional(row.genre_opportunity),
    productionBrief: optional(row.production_brief),
    seriesId: optional(row.series_id),
    seriesTitle: optional(row.series_title),
    currentAdaptationId: optional(row.current_adaptation_id),
    deletedAt: optional(row.deleted_at),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const projectSelect = `
  SELECT p.*, ps.series_id AS series_id, s.title AS series_title
  FROM projects p
  LEFT JOIN project_series ps ON ps.project_id = p.id
  LEFT JOIN series s ON s.id = ps.series_id`;

function appendProjectEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: Project | { id: string },
): void {
  transaction.append({
    type: `workspace.project-${action}.v1`,
    pluginId: "workspace",
    aggregateType: "project",
    aggregateId: value.id,
    aggregateVersion: "version" in value ? value.version : 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function createProjectRecord(
  context: PluginContext,
  input: ProjectInput,
  options: { derivedFromProjectId?: string } = {},
): Project {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const mode = input.mode ?? "series_longform";
  const modeConfig = modeConfigFor(input);
  if (!modeConfig) throw new Error("项目模式配置无效。");
  return context.uow.execute((transaction) => {
    transaction.run(
      `INSERT INTO projects(
        id, title, short_drama_type, mode, mode_config_json, lifecycle_status,
        derived_from_project_id, target_audience, target_word_count,
        target_episode_count, core_hook, emotional_core, core_selling_point,
        synopsis, style_guide, visual_style_direction, genre_opportunity,
        production_brief, current_adaptation_id, deleted_at, version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'initializing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
      id,
      input.title.trim(),
      input.shortDramaType?.trim() || "未分类",
      mode,
      JSON.stringify(modeConfig),
      options.derivedFromProjectId ?? null,
      input.targetAudience ?? null,
      input.targetWordCount ?? null,
      input.targetEpisodeCount ?? null,
      input.coreHook ?? null,
      input.emotionalCore ?? null,
      input.coreSellingPoint ?? null,
      input.synopsis ?? "",
      input.styleGuide ?? null,
      input.visualStyleDirection ?? null,
      input.genreOpportunity ?? null,
      input.productionBrief ?? null,
      now,
      now,
    );
    for (const step of initializationPlan(mode)) {
      transaction.run(
        `INSERT INTO project_initialization_steps(
          project_id, step_key, plugin_id, status, message, attempts, updated_at
        ) VALUES (?, ?, ?, 'ready', ?, 1, ?)`,
        id,
        step.key,
        step.pluginId,
        step.message,
        now,
      );
      transaction.append({
        type: "workspace.project-initialization-progress.v1",
        pluginId: "workspace",
        aggregateType: "project-initialization",
        aggregateId: id,
        aggregateVersion: 1,
        payload: {
          projectId: id,
          key: step.key,
          pluginId: step.pluginId,
          status: "ready",
          updatedAt: now,
        },
      });
    }
    transaction.run(
      "UPDATE projects SET lifecycle_status = 'ready', updated_at = ? WHERE id = ?",
      now,
      id,
    );
    const value = project(
      transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id)!,
    );
    appendProjectEvent(transaction, "created", value);
    return value;
  });
}

function updateProjectRecord(
  context: PluginContext,
  id: string,
  input: ProjectPatch,
): Project | "conflict" | undefined {
  return context.uow.execute((transaction) => {
    const current = transaction.get<ProjectRow>(
      `${projectSelect} WHERE p.id = ?`,
      id,
    );
    if (!current) return undefined;
    if (current.version !== input.version) return "conflict" as const;
    transaction.run(
      `UPDATE projects SET
        title = ?, short_drama_type = ?, target_audience = ?,
        target_word_count = ?, target_episode_count = ?, core_hook = ?,
        emotional_core = ?, core_selling_point = ?, synopsis = ?,
        style_guide = ?, visual_style_direction = ?, genre_opportunity = ?,
        production_brief = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
      input.title?.trim() ?? current.title,
      input.shortDramaType?.trim() ?? current.short_drama_type,
      input.targetAudience ?? current.target_audience,
      input.targetWordCount ?? current.target_word_count,
      input.targetEpisodeCount ?? current.target_episode_count,
      input.coreHook ?? current.core_hook,
      input.emotionalCore ?? current.emotional_core,
      input.coreSellingPoint ?? current.core_selling_point,
      input.synopsis ?? current.synopsis,
      input.styleGuide ?? current.style_guide,
      input.visualStyleDirection ?? current.visual_style_direction,
      input.genreOpportunity ?? current.genre_opportunity,
      input.productionBrief ?? current.production_brief,
      new Date().toISOString(),
      id,
      current.version,
    );
    const value = project(
      transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id)!,
    );
    appendProjectEvent(transaction, "updated", value);
    return value;
  });
}

function projectRoutes(context: PluginContext): readonly RouteContribution[] {
  const listDeclaration = createRoute({
    method: "get",
    path: "/api/v2/projects",
    operationId: "projects.list",
    tags: ["projects"],
    responses: {
      200: {
        description: "Projects",
        content: { "application/json": { schema: z.array(ProjectSchema) } },
      },
    },
  });
  const createDeclaration = createRoute({
    method: "post",
    path: "/api/v2/projects",
    operationId: "projects.create",
    tags: ["projects"],
    request: {
      headers: z.object({ "idempotency-key": z.string().min(8).max(200) }),
      body: {
        required: true,
        content: { "application/json": { schema: ProjectInputSchema } },
      },
    },
    responses: {
      201: {
        description: "Created project",
        content: {
          "application/json": { schema: ProjectCreationResultSchema },
        },
      },
      ...problemResponses,
    },
  });
  const getDeclaration = createRoute({
    method: "get",
    path: "/api/v2/projects/{id}",
    operationId: "projects.get",
    tags: ["projects"],
    request: { params: idParams },
    responses: {
      200: {
        description: "Project",
        content: { "application/json": { schema: ProjectSchema } },
      },
      ...problemResponses,
    },
  });
  const updateDeclaration = createRoute({
    method: "patch",
    path: "/api/v2/projects/{id}",
    operationId: "projects.update",
    tags: ["projects"],
    request: {
      params: idParams,
      headers: z.object({ "if-match": z.string().min(3).max(80) }),
      body: {
        required: true,
        content: { "application/json": { schema: ProjectPatchSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated project",
        content: { "application/json": { schema: ProjectSchema } },
      },
      ...problemResponses,
    },
  });
  const initializationDeclaration = createRoute({
    method: "get",
    path: "/api/v2/projects/{id}/initialization",
    operationId: "projects.initialization",
    tags: ["projects"],
    request: { params: idParams },
    responses: {
      200: {
        description: "Project initialization progress",
        content: {
          "application/json": { schema: ProjectInitializationSchema },
        },
      },
      ...problemResponses,
    },
  });
  const retryInitializationDeclaration = createRoute({
    method: "post",
    path: "/api/v2/projects/{id}/initialization/retry",
    operationId: "projects.retryInitialization",
    tags: ["projects"],
    request: { params: idParams },
    responses: {
      200: {
        description: "Retried project initialization",
        content: {
          "application/json": { schema: ProjectInitializationSchema },
        },
      },
      ...problemResponses,
    },
  });
  const derivationPreviewDeclaration = createRoute({
    method: "post",
    path: "/api/v2/projects/{id}/derivations/preview",
    operationId: "projects.previewDerivation",
    tags: ["projects"],
    request: {
      params: idParams,
      body: {
        required: true,
        content: {
          "application/json": { schema: ProjectDerivationInputSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Derivation preview",
        content: {
          "application/json": { schema: ProjectDerivationPreviewSchema },
        },
      },
      ...problemResponses,
    },
  });
  const derivationCommitDeclaration = createRoute({
    method: "post",
    path: "/api/v2/projects/{id}/derivations",
    operationId: "projects.commitDerivation",
    tags: ["projects"],
    request: {
      params: idParams,
      headers: z.object({ "idempotency-key": z.string().min(8).max(200) }),
      body: {
        required: true,
        content: {
          "application/json": { schema: ProjectDerivationCommitInputSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Derived project",
        content: {
          "application/json": { schema: ProjectDerivationCommitResultSchema },
        },
      },
      ...problemResponses,
    },
  });
  const trashListDeclaration = createRoute({
    method: "get",
    path: "/api/v2/projects/trash",
    operationId: "projects.listTrash",
    tags: ["projects"],
    responses: {
      200: {
        description: "Trashed projects",
        content: { "application/json": { schema: z.array(ProjectSchema) } },
      },
    },
  });
  const transitionDeclaration = (action: "restore" | "trash") =>
    createRoute({
      method: "post",
      path: `/api/v2/projects/{id}/${action}`,
      operationId: `projects.${action}`,
      tags: ["projects"],
      request: { params: idParams },
      responses: {
        200: {
          description: `${action} project`,
          content: { "application/json": { schema: ProjectSchema } },
        },
        ...problemResponses,
      },
    });
  const purgeDeclaration = createRoute({
    method: "delete",
    path: "/api/v2/projects/{id}",
    operationId: "projects.purge",
    tags: ["projects"],
    request: {
      params: idParams,
      body: {
        required: true,
        content: { "application/json": { schema: ProjectPurgeSchema } },
      },
    },
    responses: { 204: { description: "Purged" }, ...problemResponses },
  });
  const demoDeclaration = createRoute({
    method: "post",
    path: "/api/v2/demo/projects",
    operationId: "desktop-support.createDemo",
    tags: ["desktop-support"],
    responses: {
      201: {
        description: "Created example project",
        content: { "application/json": { schema: ProjectSchema } },
      },
      ...problemResponses,
    },
  });

  const getProject = (id: string): ProjectRow | undefined =>
    context.uow.execute((transaction) =>
      transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id),
    );
  const timestamp = () => new Date().toISOString();

  const transitions = (
    [
      ["trash", true, "projects.trash"],
      ["restore", false, "projects.restore"],
    ] as const
  ).map(([action, deleted, operationId]): RouteContribution =>
    route(
      {
        id: `workspace:projects-${action}`,
        pluginId: "workspace",
        method: "post",
        path: `/api/v2/projects/{id}/${action}`,
        operationId: operationId,
      },
      transitionDeclaration(action),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ProjectRow>(
            `${projectSelect} WHERE p.id = ?`,
            id,
          );
          if (!current) return { state: "missing" as const };
          if (Boolean(current.deleted_at) === deleted)
            return { state: "conflict" as const };
          const now = timestamp();
          transaction.run(
            "UPDATE projects SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
            deleted ? now : null,
            now,
            id,
          );
          const value = project(
            transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id)!,
          );
          appendProjectEvent(transaction, action, value);
          return { state: "updated" as const, value };
        });
        if (result.state === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            deleted ? "项目已在回收站。" : "项目不在回收站。",
          );
        return requestContext.json(result.value);
      },
    ),
  );

  return [
    route(
      {
        id: "workspace:demo-project-create",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/demo/projects",
        operationId: "desktop-support.createDemo",
      },
      demoDeclaration,
      (requestContext) => {
        const id = crypto.randomUUID();
        const now = timestamp();
        const created = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO projects(
              id, title, short_drama_type, target_audience, target_word_count,
              target_episode_count, core_hook, emotional_core, core_selling_point,
              synopsis, style_guide, visual_style_direction, genre_opportunity,
              production_brief, current_adaptation_id, deleted_at, version,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
            id,
            "示例短剧：雨夜归来",
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
          const value = project(
            transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id)!,
          );
          appendProjectEvent(transaction, "demo-created", value);
          return value;
        });
        const writing = context.services.optional<WritingChapterService>(
          WRITING_CHAPTER_SERVICE,
        );
        const production = context.services.optional<ProductionRecordService>(
          PRODUCTION_RECORD_SERVICE,
        );
        const media =
          context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE);
        const writingResources =
          context.services.optional<WritingResourceService>(
            WRITING_RESOURCE_SERVICE,
          );
        const creativeQuality =
          context.services.optional<CreativeQualityRecordService>(
            CREATIVE_QUALITY_SERVICE,
          );
        const review = context.services.optional<ReviewRecordService>(
          REVIEW_RECORD_SERVICE,
        );
        const delivery = context.services.optional<DeliveryRecordService>(
          DELIVERY_RECORD_SERVICE,
        );
        if (
          !writing ||
          !writingResources ||
          !production ||
          !media ||
          !creativeQuality
        ) {
          context.uow.execute((transaction) =>
            transaction.run("DELETE FROM projects WHERE id = ?", id),
          );
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "示例项目需要启用写作套件。",
          );
        }
        try {
          for (const input of [
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
          ])
            writing.create({ projectId: id, ...input });
          writingResources.create({
            kind: "characters",
            projectId: id,
            title: "林晚",
            payload: {
              身份: "摄影师",
              人物目标: "查清陆沉失踪与归来的真相",
              性格: "克制、敏锐、对记忆保持怀疑",
              视觉设定: "雨夜冷色外套与暖色室内光",
            },
          });
          const adaptation = production.create("adaptations", {
            projectId: id,
            title: "雨夜归来·第一季改编方案",
            payload: {
              改编方向: "都市悬疑情感短剧",
              目标集数: 12,
              改编简介:
                "以雨夜重逢开局，围绕旧照片与不存在的列车逐集揭开身份谜团。",
              改编策略: "每集结尾保留可视化线索和关系反转。",
            },
          });
          const episode = production.create("episodes", {
            projectId: id,
            parentId: adaptation.id,
            title: "第 1 集：雨夜敲门",
            payload: {
              集数: 1,
              关联改编项目: adaptation.title,
              分集简介:
                "林晚在暴雨夜为陌生来客开门，发现他就是失踪三年的陆沉。",
              结尾悬念: "陆沉叫出了无人知晓的小名。",
            },
          });
          const script = production.create("scripts", {
            projectId: id,
            parentId: episode.id,
            title: "第 1 集剧本",
            payload: {
              关联分集: episode.title,
              剧本内容:
                "【雨夜·林晚公寓门口】\n林晚打开门。\n陆沉：你还记得我吗？\n林晚：你不该出现在这里。",
              审查意见: "示例剧本，已具备拆分场景与分镜的基础。",
            },
          });
          const scene = production.create("scenes", {
            projectId: id,
            parentId: script.id,
            title: "场景 1：雨夜门口",
            payload: {
              关联剧本: script.title,
              地点与时间: "林晚公寓门口·雨夜",
              场景动作: "雨水、停电、门缝里的霓虹反光与两人的对视。",
              对白与备注: "对白保持短促，镜头优先捕捉迟疑和认出对方后的情绪。",
            },
          });
          const firstShot = production.create("shots", {
            projectId: id,
            parentId: scene.id,
            title: "镜头 1：门缝中的雨夜",
            payload: {
              关联场景: scene.title,
              镜头序号: 1,
              镜头描述: "从门内推近林晚，再切到门外被雨水打湿的陆沉。",
              生成提示: "雨夜霓虹，近景人物情绪，对比强烈的冷暖光。",
            },
          });
          production.create("shots", {
            projectId: id,
            parentId: scene.id,
            title: "镜头 2：雨中的来客",
            payload: {
              关联场景: scene.title,
              镜头序号: 2,
              镜头描述: "切到雨中的陆沉，他压低声音叫出林晚的小名。",
              对白: "陆沉：你还记得我吗？",
              景别: "近景",
              运镜: "固定",
              时长: "3 秒",
            },
          });
          media.create("assets", {
            projectId: id,
            title: "雨夜霓虹参考素材",
            payload: {
              类型: "图片参考",
              权利状态: "已核验",
              来源: "示例项目内置文字资产",
            },
          });
          media.create("visual-assets", {
            projectId: id,
            title: "林晚·雨夜服装设定",
            payload: {
              资产类型: "角色",
              关联对象: "林晚",
              资产版本: "v1",
              采用状态: "已采用",
              锁定状态: "未锁定",
              权利状态: "已核验",
              费用状态: "已知",
              服务状态: "无需服务",
              预览说明: "冷色雨衣、湿发与暖色室内光形成反差。",
            },
          });
          media.create("shot-stills", {
            projectId: id,
            parentId: firstShot.id,
            title: "门缝雨夜静帧候选 A",
            payload: {
              采用状态: "已采用",
              类型: "首帧",
              预览说明: "当前只保留归档元数据，不伪造缩略图。",
            },
          });
          media.create("audio", {
            projectId: id,
            parentId: episode.id,
            title: "第 1 集雨声氛围候选",
            payload: { 类型: "环境音", 采用状态: "候选" },
          });
          media.create("animatics", {
            projectId: id,
            parentId: episode.id,
            title: "第 1 集动态分镜草案",
            payload: { 状态: "草稿", 版本: "v1" },
          });
          creativeQuality.create("quality", {
            projectId: id,
            parentId: episode.id,
            value: {
              title: "第 1 集质量检查",
              关联分集: episode.title,
              严重程度: "提示",
              问题描述: "示例项目中的音轨和最终渲染尚未完成。",
              返工方案: "补充正式音轨与渲染后重新检查。",
            },
          });
          review?.create("compliance", {
            projectId: id,
            parentId: episode.id,
            value: {
              title: "第 1 集合规预检",
              规则来源: "内置示例规则",
              检查状态: "待人工核验",
              风险与依据: "示例内容不包含真实平台或法务结论。",
              处理说明: "实际发行前必须按地区和平台要求复核。",
            },
          });
          review?.create("review", {
            projectId: id,
            parentId: episode.id,
            value: {
              title: "第 1 集审片包",
              审片方式: "本地示例审阅",
              审片状态: "待确认",
              评论: "确认雨夜氛围和身份揭示镜头节奏。",
              决策与跟进: "补全音轨与渲染后进入交付预检。",
            },
          });
          delivery?.create("localization", {
            projectId: id,
            parentId: episode.id,
            value: {
              title: "第 1 集简体中文字幕",
              目标语言: "简体中文",
              关联分集: episode.title,
              字幕与译文: "你还记得我吗？\n你不该出现在这里。",
              采用状态: "已采用",
            },
          });
          delivery?.create("delivery", {
            projectId: id,
            parentId: episode.id,
            value: {
              title: "第 1 集平台交付清单",
              目标平台: "待选择",
              交付状态: "待预检",
              预检结果: "示例项目仅用于展示交付清单结构。",
              交付说明: "可在审核交付工作区导出本地 JSON 交付清单。",
            },
          });
        } catch {
          context.uow.execute((transaction) =>
            transaction.run("DELETE FROM projects WHERE id = ?", id),
          );
          return problem(
            requestContext,
            409,
            "DEMO_INITIALIZATION_FAILED",
            "示例项目初始化失败。",
          );
        }
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(created, 201);
      },
    ),
    route(
      {
        id: "workspace:projects-list",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects",
        operationId: "projects.list",
      },
      listDeclaration,
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<ProjectRow>(
                `${projectSelect} WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
              )
              .map(project),
          ),
        ),
    ),
    route(
      {
        id: "workspace:projects-create",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/projects",
        operationId: "projects.create",
      },
      createDeclaration,
      async (requestContext) => {
        const idempotencyKey = requestContext.req
          .header("Idempotency-Key")
          ?.trim();
        if (
          !idempotencyKey ||
          idempotencyKey.length < 8 ||
          idempotencyKey.length > 200
        )
          return problem(
            requestContext,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "创建项目必须提供有效的 Idempotency-Key。",
          );
        const replay = context.uow.execute((transaction) =>
          transaction.get<{ response_json: string }>(
            "SELECT response_json FROM workspace_project_create_idempotency WHERE idempotency_key = ?",
            idempotencyKey,
          ),
        );
        if (replay) {
          const value = JSON.parse(replay.response_json);
          requestContext.header("Idempotency-Replayed", "true");
          return requestContext.json(value, 201);
        }
        const parsed = ProjectInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目名称或模式化创建信息无效。",
          );
        if (!modeConfigFor(parsed.data))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目模式与模式配置必须匹配。",
          );
        const created = createProjectRecord(context, parsed.data);
        const value = {
          project: created,
          initialization: initialization(context, created.id),
        };
        context.uow.execute((transaction) =>
          transaction.run(
            "INSERT INTO workspace_project_create_idempotency(idempotency_key, response_json, created_at) VALUES (?, ?, ?)",
            idempotencyKey,
            JSON.stringify(value),
            new Date().toISOString(),
          ),
        );
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "workspace:projects-initialization",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects/{id}/initialization",
        operationId: "projects.initialization",
      },
      initializationDeclaration,
      (requestContext) => {
        const id = requestContext.req.param("id");
        if (!getProject(id))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(initialization(context, id));
      },
    ),
    route(
      {
        id: "workspace:projects-initialization-retry",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/projects/{id}/initialization/retry",
        operationId: "projects.retryInitialization",
      },
      retryInitializationDeclaration,
      (requestContext) => {
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ProjectRow>(
            `${projectSelect} WHERE p.id = ?`,
            id,
          );
          if (!current) return false;
          const now = timestamp();
          for (const step of initializationPlan(current.mode)) {
            transaction.run(
              `INSERT INTO project_initialization_steps(
                project_id, step_key, plugin_id, status, message, error_message, attempts, updated_at
              ) VALUES (?, ?, ?, 'ready', ?, NULL, 1, ?)
              ON CONFLICT(project_id, step_key) DO UPDATE SET
                status = 'ready', message = excluded.message, error_message = NULL,
                attempts = project_initialization_steps.attempts + 1, updated_at = excluded.updated_at`,
              id,
              step.key,
              step.pluginId,
              step.message,
              now,
            );
          }
          transaction.run(
            "UPDATE projects SET lifecycle_status = 'ready', updated_at = ? WHERE id = ?",
            now,
            id,
          );
          transaction.append({
            type: "workspace.project-initialization-retried.v1",
            pluginId: "workspace",
            aggregateType: "project-initialization",
            aggregateId: id,
            aggregateVersion: current.version,
            payload: { projectId: id, status: "ready", updatedAt: now },
          });
          return true;
        });
        return result
          ? requestContext.json(initialization(context, id))
          : problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
      },
    ),
    route(
      {
        id: "workspace:projects-derivation-preview",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/projects/{id}/derivations/preview",
        operationId: "projects.previewDerivation",
      },
      derivationPreviewDeclaration,
      async (requestContext) => {
        const sourceId = requestContext.req.param("id");
        const source = getProject(sourceId);
        if (!source)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const parsed = ProjectDerivationInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "派生参数无效。",
          );
        const transformation = supportedDerivation(
          source.mode,
          parsed.data.targetMode,
        );
        if (!transformation)
          return problem(
            requestContext,
            409,
            "UNSUPPORTED_OPERATION",
            "这两个创作模式不能直接派生；请新建项目或选择支持的派生路径。",
          );
        if (
          source.mode === "series_longform" &&
          parsed.data.targetMode === "single_season" &&
          !parsed.data.seasonId
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "从系列长篇派生单季短剧时必须选择一个季。",
          );
        const targetModeConfig =
          parsed.data.targetModeConfig ??
          defaultModeConfig(parsed.data.targetMode);
        if (targetModeConfig.mode !== parsed.data.targetMode)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "目标模式与模式配置不匹配。",
          );
        const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
        const preview = {
          id: crypto.randomUUID(),
          sourceProjectId: sourceId,
          targetMode: parsed.data.targetMode,
          targetModeConfig,
          title:
            parsed.data.title?.trim() ||
            `${source.title} · ${
              parsed.data.targetMode === "series_longform"
                ? "系列长篇"
                : parsed.data.targetMode === "single_season"
                  ? "单季短剧"
                  : parsed.data.targetMode === "personal_theater"
                    ? "我的小剧场"
                    : "博主内容工作室"
            }`,
          supported: true,
          expiresAt,
        };
        context.uow.execute((transaction) =>
          transaction.run(
            `INSERT INTO project_derivation_previews(
              id, source_project_id, target_mode, target_mode_config_json, title,
              transformation, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            preview.id,
            preview.sourceProjectId,
            preview.targetMode,
            JSON.stringify(preview.targetModeConfig),
            preview.title,
            transformation,
            preview.expiresAt,
            new Date().toISOString(),
          ),
        );
        return requestContext.json(preview, 201);
      },
    ),
    route(
      {
        id: "workspace:projects-derivation-commit",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/projects/{id}/derivations",
        operationId: "projects.commitDerivation",
      },
      derivationCommitDeclaration,
      async (requestContext) => {
        const sourceId = requestContext.req.param("id");
        const idempotencyKey = requestContext.req
          .header("Idempotency-Key")
          ?.trim();
        if (
          !idempotencyKey ||
          idempotencyKey.length < 8 ||
          idempotencyKey.length > 200
        )
          return problem(
            requestContext,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "提交派生项目必须提供有效的 Idempotency-Key。",
          );
        const replay = context.uow.execute((transaction) =>
          transaction.get<{ response_json: string }>(
            "SELECT response_json FROM workspace_project_create_idempotency WHERE idempotency_key = ?",
            idempotencyKey,
          ),
        );
        if (replay) {
          requestContext.header("Idempotency-Replayed", "true");
          return requestContext.json(JSON.parse(replay.response_json), 201);
        }
        const parsed = ProjectDerivationCommitInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "派生预览无效。",
          );
        const preview = context.uow.execute((transaction) =>
          transaction.get<{
            id: string;
            source_project_id: string;
            target_mode: ProjectMode;
            target_mode_config_json: string;
            title: string;
            transformation: string;
            expires_at: string;
          }>(
            "SELECT * FROM project_derivation_previews WHERE id = ? AND source_project_id = ?",
            parsed.data.previewId,
            sourceId,
          ),
        );
        if (!preview || Date.parse(preview.expires_at) <= Date.now())
          return problem(
            requestContext,
            409,
            "PREVIEW_EXPIRED",
            "派生预览已过期，请重新预览后再提交。",
          );
        const source = getProject(sourceId);
        if (!source)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const targetModeConfig = ProjectModeConfigSchema.safeParse(
          JSON.parse(preview.target_mode_config_json),
        );
        if (
          !targetModeConfig.success ||
          targetModeConfig.data.mode !== preview.target_mode ||
          !supportedDerivation(source.mode, preview.target_mode)
        )
          return problem(
            requestContext,
            409,
            "UNSUPPORTED_OPERATION",
            "派生预览不再适用于当前项目。",
          );
        const created = createProjectRecord(
          context,
          {
            title: preview.title,
            shortDramaType: source.short_drama_type || undefined,
            mode: preview.target_mode,
            modeConfig: targetModeConfig.data,
            targetAudience: source.target_audience ?? undefined,
            synopsis: source.synopsis,
          },
          { derivedFromProjectId: sourceId },
        );
        const derivationId = crypto.randomUUID();
        context.uow.execute((transaction) => {
          transaction.run(
            "INSERT INTO project_derivations(id, source_project_id, target_project_id, transformation, created_at) VALUES (?, ?, ?, ?, ?)",
            derivationId,
            sourceId,
            created.id,
            preview.transformation,
            new Date().toISOString(),
          );
          transaction.run(
            "DELETE FROM project_derivation_previews WHERE id = ?",
            preview.id,
          );
        });
        const value = {
          project: created,
          initialization: initialization(context, created.id),
          derivationId,
        };
        context.uow.execute((transaction) =>
          transaction.run(
            "INSERT INTO workspace_project_create_idempotency(idempotency_key, response_json, created_at) VALUES (?, ?, ?)",
            idempotencyKey,
            JSON.stringify(value),
            new Date().toISOString(),
          ),
        );
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "workspace:projects-get",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects/{id}",
        operationId: "projects.get",
      },
      getDeclaration,
      (requestContext) => {
        const row = getProject(requestContext.req.param("id"));
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const value = project(row);
        requestContext.header("ETag", `"${value.version}"`);
        return requestContext.json(value);
      },
    ),
    route(
      {
        id: "workspace:projects-update",
        pluginId: "workspace",
        method: "patch",
        path: "/api/v2/projects/{id}",
        operationId: "projects.update",
      },
      updateDeclaration,
      async (requestContext) => {
        const raw = await requestContext.req.json<Record<string, unknown>>();
        if (
          "mode" in raw ||
          "modeConfig" in raw ||
          "derivedFromProjectId" in raw
        )
          return problem(
            requestContext,
            409,
            "IMMUTABLE_PROJECT_MODE",
            "项目模式不可原地切换；请使用派生项目。",
          );
        const parsed = ProjectPatchSchema.safeParse(raw);
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目修改内容无效。",
          );
        const ifMatch = requestContext.req.header("If-Match")?.trim();
        if (ifMatch !== `"${parsed.data.version}"`)
          return problem(
            requestContext,
            409,
            "VERSION_PRECONDITION_FAILED",
            "修改项目必须携带与版本一致的 If-Match。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ProjectRow>(
            `${projectSelect} WHERE p.id = ?`,
            id,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== parsed.data.version)
            return { state: "conflict" as const };
          const input = parsed.data;
          transaction.run(
            `UPDATE projects SET
              title = ?, short_drama_type = ?, target_audience = ?,
              target_word_count = ?, target_episode_count = ?, core_hook = ?,
              emotional_core = ?, core_selling_point = ?, synopsis = ?,
              style_guide = ?, visual_style_direction = ?, genre_opportunity = ?,
              production_brief = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
            input.title?.trim() ?? current.title,
            input.shortDramaType?.trim() ?? current.short_drama_type,
            input.targetAudience ?? current.target_audience,
            input.targetWordCount ?? current.target_word_count,
            input.targetEpisodeCount ?? current.target_episode_count,
            input.coreHook ?? current.core_hook,
            input.emotionalCore ?? current.emotional_core,
            input.coreSellingPoint ?? current.core_selling_point,
            input.synopsis ?? current.synopsis,
            input.styleGuide ?? current.style_guide,
            input.visualStyleDirection ?? current.visual_style_direction,
            input.genreOpportunity ?? current.genre_opportunity,
            input.productionBrief ?? current.production_brief,
            timestamp(),
            id,
            current.version,
          );
          const value = project(
            transaction.get<ProjectRow>(`${projectSelect} WHERE p.id = ?`, id)!,
          );
          appendProjectEvent(transaction, "updated", value);
          return { state: "updated" as const, value };
        });
        if (result.state === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "项目已在其他操作中更新，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.value.version}"`);
        return requestContext.json(result.value);
      },
    ),
    route(
      {
        id: "workspace:projects-trash-list",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects/trash",
        operationId: "projects.listTrash",
      },
      trashListDeclaration,
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<ProjectRow>(
                `${projectSelect} WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`,
              )
              .map(project),
          ),
        ),
    ),
    ...transitions,
    route(
      {
        id: "workspace:projects-purge",
        pluginId: "workspace",
        method: "delete",
        path: "/api/v2/projects/{id}",
        operationId: "projects.purge",
      },
      purgeDeclaration,
      async (requestContext) => {
        const parsed = ProjectPurgeSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请输入项目名称确认永久删除。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ProjectRow>(
            `${projectSelect} WHERE p.id = ?`,
            id,
          );
          if (!current) return "missing" as const;
          if (!current.deleted_at) return "active" as const;
          if (parsed.data.confirmationTitle !== current.title)
            return "confirmation" as const;
          transaction.run("DELETE FROM projects WHERE id = ?", id);
          appendProjectEvent(transaction, "purged", { id });
          return "purged" as const;
        });
        if (result === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        if (result === "active")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "请先将项目移入回收站。",
          );
        if (result === "confirmation")
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目名称确认不一致。",
          );
        return requestContext.body(null, 204);
      },
    ),
  ];
}

const workspaceMigrations = [
  {
    id: "workspace.0001.projects-and-series",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["foundation.0001.runtime-ledger"],
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        short_drama_type TEXT NOT NULL,
        target_audience TEXT,
        target_word_count INTEGER,
        target_episode_count INTEGER,
        core_hook TEXT,
        emotional_core TEXT,
        core_selling_point TEXT,
        synopsis TEXT NOT NULL DEFAULT '',
        style_guide TEXT,
        visual_style_direction TEXT,
        genre_opportunity TEXT,
        production_brief TEXT,
        current_adaptation_id TEXT,
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_updated_at
        ON projects(deleted_at, updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS series (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_series (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        series_id TEXT NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
        joined_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_series_series
        ON project_series(series_id, project_id);
    `,
  },
  {
    id: "workspace.0005.project-modes",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0004.maintenance"],
    sql: `
      ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL
        DEFAULT 'series_longform'
        CHECK(mode IN ('series_longform', 'single_season', 'personal_theater', 'creator_channel'));
      ALTER TABLE projects ADD COLUMN mode_config_json TEXT NOT NULL
        DEFAULT '{"mode":"series_longform","targetChapterCount":300,"targetSeasonCount":5}';
      ALTER TABLE projects ADD COLUMN lifecycle_status TEXT NOT NULL
        DEFAULT 'ready'
        CHECK(lifecycle_status IN ('initializing', 'ready', 'failed'));
      ALTER TABLE projects ADD COLUMN derived_from_project_id TEXT
        REFERENCES projects(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS projects_mode_updated_at
        ON projects(mode, deleted_at, updated_at DESC, id);
      CREATE INDEX IF NOT EXISTS projects_derived_from
        ON projects(derived_from_project_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS project_initialization_steps (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        step_key TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'ready', 'failed')),
        message TEXT,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, step_key)
      );
      CREATE TABLE IF NOT EXISTS project_derivation_previews (
        id TEXT PRIMARY KEY,
        source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_mode TEXT NOT NULL CHECK(target_mode IN ('series_longform', 'single_season', 'personal_theater', 'creator_channel')),
        target_mode_config_json TEXT NOT NULL,
        title TEXT NOT NULL,
        transformation TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_derivation_previews_expiry
        ON project_derivation_previews(expires_at);
      CREATE TABLE IF NOT EXISTS project_derivations (
        id TEXT PRIMARY KEY,
        source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        transformation TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_project_create_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
] as const;

export function createWorkspacePlugin(host?: DesktopHostClient) {
  return defineFirstPartyPlugin({
    descriptor: {
      id: "workspace",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "system"],
      provides: ["workspace.projects"],
      stability: "internal",
    },
    ui: [
      {
        id: "workspace.route.home",
        pluginId: "workspace",
        kind: "route",
        metadata: { path: "/", title: "项目" },
      },
      {
        id: "workspace.route.project",
        pluginId: "workspace",
        kind: "route",
        metadata: { path: "/projects/:projectId", title: "项目工作区" },
      },
      {
        id: "workspace.route.project-tools",
        pluginId: "workspace",
        kind: "route",
        metadata: {
          path: "/projects/:projectId/tools/:toolKey?",
          title: "项目工具",
        },
      },
      {
        id: "workspace.route.search",
        pluginId: "workspace",
        kind: "route",
        metadata: { path: "/search", title: "搜索" },
      },
      {
        id: "workspace.navigation.home",
        pluginId: "workspace",
        kind: "navigation",
        metadata: { section: "main", order: 10, label: "项目", to: "/" },
      },
      {
        id: "workspace.navigation.search",
        pluginId: "workspace",
        kind: "navigation",
        metadata: {
          section: "secondary",
          order: 20,
          label: "搜索",
          to: "/search",
        },
      },
    ],
    migrations: [
      ...workspaceMigrations.slice(0, 1),
      ...seriesMigrations,
      ...sourceImportMigrations.slice(0, 1),
      ...workspaceMaintenanceMigrations,
      ...workspaceMigrations.slice(1),
      ...sourceImportMigrations.slice(1),
    ],
    activate: (context) => {
      const service: WorkspaceProjectService = {
        create: (input) => createProjectRecord(context, input),
        get: (id, options) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<ProjectRow>(
              `${projectSelect} WHERE p.id = ?${options?.includeDeleted ? "" : " AND p.deleted_at IS NULL"}`,
              id,
            );
            return row ? project(row) : undefined;
          }),
        list: (options) =>
          context.uow.execute((transaction) =>
            transaction
              .all<ProjectRow>(
                `${projectSelect}${options?.includeDeleted ? "" : " WHERE p.deleted_at IS NULL"} ORDER BY p.updated_at DESC, p.id`,
              )
              .map(project),
          ),
        update: (id, patch) => updateProjectRecord(context, id, patch),
        setCurrentAdaptation: (projectId, adaptationId) =>
          context.uow.execute((transaction) => {
            const current = transaction.get<ProjectRow>(
              `${projectSelect} WHERE p.id = ? AND p.deleted_at IS NULL`,
              projectId,
            );
            if (!current) return undefined;
            transaction.run(
              "UPDATE projects SET current_adaptation_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
              adaptationId,
              new Date().toISOString(),
              projectId,
            );
            const value = project(
              transaction.get<ProjectRow>(
                `${projectSelect} WHERE p.id = ?`,
                projectId,
              )!,
            );
            appendProjectEvent(
              transaction,
              "current-adaptation-updated",
              value,
            );
            return value;
          }),
      };
      context.effect(`service:${WORKSPACE_PROJECT_SERVICE}`, () =>
        context.services.provide(WORKSPACE_PROJECT_SERVICE, service),
      );
      for (const contribution of [
        ...projectRoutes(context),
        ...seriesRoutes(context),
        ...sourceImportRoutes(context, host, service),
        ...workspaceMaintenanceRoutes(context, host, service),
      ])
        context.effect(`route:${contribution.id}`, () =>
          context.http.register(contribution),
        );
    },
  });
}

export const workspacePlugin = createWorkspacePlugin();
