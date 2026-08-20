import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  PilotPlanActionInputSchema,
  PilotPlanCreateInputSchema,
  PilotPlanSchema,
  type PilotPlan,
} from "@dramaip/contracts/automation";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  WRITING_CHAPTER_SERVICE,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import type {
  PluginContext,
  RouteContribution,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z } from "zod";

interface PilotRow {
  id: string;
  project_id: string;
  chapter_ids_json: string;
  chapter_versions_json: string;
  episode_count: number;
  status: PilotPlan["status"];
  source_confirmed: number;
  adaptation_id: string | null;
  episode_ids_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;

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

function route(
  metadata: Omit<RouteContribution, "install">,
  declaration: unknown,
  handler: Handler,
): RouteContribution {
  return {
    ...metadata,
    install: (app) => {
      const register = app.openapi as unknown as (
        value: unknown,
        routeHandler: Handler,
      ) => void;
      register.call(app, declaration, handler);
    },
  };
}

function signature(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    result = Math.imul(result ^ value.charCodeAt(index), 16777619) >>> 0;
  return result.toString(16).padStart(8, "0");
}

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function sourceVersions(
  writing: WritingChapterService,
  chapterIds: readonly string[],
): Array<{ id: string; version: number; signature: string }> {
  return chapterIds.flatMap((id) => {
    const chapter = writing.get(id);
    return chapter
      ? [
          {
            id,
            version: chapter.version,
            signature: signature(chapter.content),
          },
        ]
      : [];
  });
}

function staleReason(
  row: PilotRow,
  writing: WritingChapterService,
): string | undefined {
  const expected = JSON.parse(row.chapter_versions_json) as Array<{
    id: string;
    version: number;
    signature: string;
  }>;
  if (!expected.length) return "试制来源记录不完整，请重新确认来源。";
  for (const source of expected) {
    const chapter = writing.get(source.id);
    if (
      !chapter ||
      chapter.version !== source.version ||
      signature(chapter.content) !== source.signature
    )
      return "试制来源章节已更新，请重新确认后继续。";
  }
  return undefined;
}

function toPlan(
  row: PilotRow,
  writing: WritingChapterService,
  production: ProductionRecordService,
): PilotPlan {
  const chapterIds = parseIds(row.chapter_ids_json);
  const episodeIds = parseIds(row.episode_ids_json).filter(
    (id) => production.get(id)?.kind === "episodes",
  );
  const projectRecords = (
    kind: Parameters<ProductionRecordService["list"]>[0],
  ) => production.list(kind, { projectId: row.project_id });
  const scripts = projectRecords("scripts").filter((item) =>
    item.parentId ? episodeIds.includes(item.parentId) : false,
  );
  const scriptIds = new Set(scripts.map((item) => item.id));
  const scenes = projectRecords("scenes").filter((item) =>
    item.parentId ? scriptIds.has(item.parentId) : false,
  );
  const sceneIds = new Set(scenes.map((item) => item.id));
  const shots = projectRecords("shots").filter((item) =>
    item.parentId ? sceneIds.has(item.parentId) : false,
  );
  const coverage = {
    episodes: episodeIds.length,
    scripts: scripts.length,
    scenes: scenes.length,
    shots: shots.length,
    assets: 0,
  };
  const sourceConfirmed = row.source_confirmed === 1;
  const stale = sourceConfirmed ? staleReason(row, writing) : undefined;
  const canceled = row.status === "canceled";
  const stage: PilotPlan["stage"] =
    !sourceConfirmed || stale || canceled
      ? "confirm-source"
      : coverage.scripts < row.episode_count
        ? "script"
        : coverage.scenes < row.episode_count
          ? "scenes"
          : !coverage.shots
            ? "shots"
            : !coverage.assets
              ? "assets"
              : "review";
  const status: PilotPlan["status"] = canceled
    ? "canceled"
    : stale
      ? "stale"
      : stage === "review"
        ? "ready-for-review"
        : sourceConfirmed
          ? "active"
          : "draft";
  const blocker =
    stage === "confirm-source"
      ? (stale ??
        (canceled
          ? "试制已取消，可恢复后重新确认来源。"
          : "等待人工确认试制来源。"))
      : stage === "script"
        ? "每个试制分集都需要先采用剧本。"
        : stage === "scenes"
          ? "已采用剧本需要拆分为可制作场景。"
          : stage === "shots"
            ? "已采用场景需要建立分镜。"
            : stage === "assets"
              ? "制作前需至少归档一项视觉或道具资产。"
              : undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    chapterIds,
    episodeCount: row.episode_count,
    status,
    stage,
    sourceConfirmed,
    ...(row.adaptation_id ? { adaptationId: row.adaptation_id } : {}),
    episodeIds,
    coverage,
    ...(blocker ? { blocker } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function append(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: PilotPlan,
): void {
  transaction.append({
    type: `automation.pilot-${action}.v1`,
    pluginId: "automation",
    aggregateType: "pilot-plan",
    aggregateId: value.id,
    aggregateVersion: 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

export const pilotMigrations = [
  {
    id: "automation.0002.pilot-plans",
    pluginId: "automation",
    version: "3.0.0-alpha.3",
    dependsOn: ["automation.0001.tasks-and-revisions"],
    sql: `
      CREATE TABLE IF NOT EXISTS automation_pilot_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_ids_json TEXT NOT NULL,
        chapter_versions_json TEXT NOT NULL,
        episode_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        source_confirmed INTEGER NOT NULL DEFAULT 0,
        adaptation_id TEXT,
        episode_ids_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_pilot_plans_project
        ON automation_pilot_plans(project_id, updated_at DESC, id);
    `,
  },
] as const;

export function pilotRoutes(
  context: PluginContext,
): readonly RouteContribution[] {
  const getServices = () => ({
    writing: context.services.get<WritingChapterService>(
      WRITING_CHAPTER_SERVICE,
    ),
    production: context.services.get<ProductionRecordService>(
      PRODUCTION_RECORD_SERVICE,
    ),
  });
  const projectParams = z.object({ id: z.string().uuid() });
  const idParams = z.object({ id: z.string().uuid() });
  const listDeclaration = createRoute({
    method: "get",
    path: "/api/v2/projects/{id}/pilot-plans",
    operationId: "pilot-plans.list",
    tags: ["pilot-plans"],
    request: { params: projectParams },
    responses: {
      200: {
        description: "Pilot plans",
        content: { "application/json": { schema: z.array(PilotPlanSchema) } },
      },
    },
  });
  const createDeclaration = createRoute({
    method: "post",
    path: "/api/v2/pilot-plans",
    operationId: "pilot-plans.create",
    tags: ["pilot-plans"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: PilotPlanCreateInputSchema } },
      },
    },
    responses: {
      201: {
        description: "Created pilot plan",
        content: { "application/json": { schema: PilotPlanSchema } },
      },
      400: {
        description: "Invalid",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  });
  const actionDeclaration = createRoute({
    method: "post",
    path: "/api/v2/pilot-plans/{id}/action",
    operationId: "pilot-plans.action",
    tags: ["pilot-plans"],
    request: {
      params: idParams,
      body: {
        required: true,
        content: { "application/json": { schema: PilotPlanActionInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated pilot plan",
        content: { "application/json": { schema: PilotPlanSchema } },
      },
      409: {
        description: "Conflict",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  });

  return [
    route(
      {
        id: "automation:pilot-list",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/projects/{id}/pilot-plans",
        operationId: "pilot-plans.list",
      },
      listDeclaration,
      (requestContext) => {
        const { writing, production } = getServices();
        if (!writing || !production)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "试制服务不可用。",
          );
        const rows = context.uow.execute((transaction) =>
          transaction.all<PilotRow>(
            "SELECT * FROM automation_pilot_plans WHERE project_id = ? ORDER BY updated_at DESC",
            requestContext.req.param("id"),
          ),
        );
        return requestContext.json(
          rows.map((row) => toPlan(row, writing, production)),
        );
      },
    ),
    route(
      {
        id: "automation:pilot-create",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/pilot-plans",
        operationId: "pilot-plans.create",
      },
      createDeclaration,
      async (requestContext) => {
        const input = PilotPlanCreateInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const { writing, production } = getServices();
        if (
          !input.success ||
          input.data.episodeCount > input.data.chapterIds.length
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "试制范围无效。",
          );
        if (!writing || !production)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "试制服务不可用。",
          );
        const versions = sourceVersions(writing, input.data.chapterIds);
        if (versions.length !== input.data.chapterIds.length)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到试制来源章节。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value: PilotPlan = {
          id,
          projectId: input.data.projectId,
          chapterIds: [...input.data.chapterIds],
          episodeCount: input.data.episodeCount,
          status: "draft",
          stage: "confirm-source",
          sourceConfirmed: false,
          episodeIds: [],
          coverage: {
            episodes: 0,
            scripts: 0,
            scenes: 0,
            shots: 0,
            assets: 0,
          },
          blocker: "等待人工确认试制来源。",
          createdAt: now,
          updatedAt: now,
        };
        context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO automation_pilot_plans(
              id, project_id, chapter_ids_json, chapter_versions_json,
              episode_count, status, source_confirmed, adaptation_id,
              episode_ids_json, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'draft', 0, NULL, '[]', NULL, ?, ?)`,
            id,
            input.data.projectId,
            JSON.stringify(input.data.chapterIds),
            JSON.stringify(versions),
            input.data.episodeCount,
            now,
            now,
          );
          append(transaction, "created", value);
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "automation:pilot-action",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/pilot-plans/{id}/action",
        operationId: "pilot-plans.action",
      },
      actionDeclaration,
      async (requestContext) => {
        const input = PilotPlanActionInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const { writing, production } = getServices();
        const id = requestContext.req.param("id");
        const row = context.uow.execute((transaction) =>
          transaction.get<PilotRow>(
            "SELECT * FROM automation_pilot_plans WHERE id = ?",
            id,
          ),
        );
        if (!input.success || !row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到试制计划。");
        if (!writing || !production)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "试制服务不可用。",
          );
        const now = new Date().toISOString();
        if (input.data.action === "confirm-source") {
          const stale = staleReason(row, writing);
          if (stale) return problem(requestContext, 409, "CONFLICT", stale);
          let adaptationId = row.adaptation_id;
          if (!adaptationId)
            adaptationId = production.create("adaptations", {
              projectId: row.project_id,
              title: "试制改编方案",
              payload: {
                改编方向: "1–3 集试制",
                目标集数: row.episode_count,
                来源: "试制向导人工确认",
              },
            }).id;
          const episodeIds = parseIds(row.episode_ids_json);
          const chapters = parseIds(row.chapter_ids_json)
            .map((chapterId) => writing.get(chapterId))
            .filter((chapter): chapter is NonNullable<typeof chapter> =>
              Boolean(chapter),
            );
          while (episodeIds.length < row.episode_count) {
            const chapter = chapters[episodeIds.length % chapters.length]!;
            episodeIds.push(
              production.create("episodes", {
                projectId: row.project_id,
                parentId: adaptationId,
                title: `试制第 ${episodeIds.length + 1} 集·${chapter.title}`,
                payload: {
                  集数: episodeIds.length + 1,
                  分集简介: (chapter.summary || chapter.content).slice(0, 240),
                  试制来源章节: chapter.title,
                  审阅状态: "待采用剧本",
                },
              }).id,
            );
          }
          context.uow.execute((transaction) =>
            transaction.run(
              `UPDATE automation_pilot_plans SET status = 'active',
               source_confirmed = 1, adaptation_id = ?, episode_ids_json = ?,
               error_message = NULL, updated_at = ? WHERE id = ?`,
              adaptationId,
              JSON.stringify(episodeIds),
              now,
              id,
            ),
          );
        } else if (input.data.action === "cancel") {
          context.uow.execute((transaction) =>
            transaction.run(
              "UPDATE automation_pilot_plans SET status = 'canceled', updated_at = ? WHERE id = ?",
              now,
              id,
            ),
          );
        } else {
          const versions = sourceVersions(
            writing,
            parseIds(row.chapter_ids_json),
          );
          context.uow.execute((transaction) =>
            transaction.run(
              `UPDATE automation_pilot_plans SET status = 'draft',
               source_confirmed = 0, chapter_versions_json = ?, updated_at = ?
               WHERE id = ?`,
              JSON.stringify(versions),
              now,
              id,
            ),
          );
        }
        const updatedRow = context.uow.execute((transaction) =>
          transaction.get<PilotRow>(
            "SELECT * FROM automation_pilot_plans WHERE id = ?",
            id,
          ),
        )!;
        const value = toPlan(updatedRow, writing, production);
        context.uow.execute((transaction) =>
          append(transaction, "updated", value),
        );
        return requestContext.json(value);
      },
    ),
  ];
}
