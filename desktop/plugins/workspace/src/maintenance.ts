import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  CREATIVE_QUALITY_SERVICE,
  type CreativeQualityRecordKind,
  type CreativeQualityRecordService,
} from "@dramaip/contracts/creative-quality";
import {
  DELIVERY_RECORD_SERVICE,
  type DeliveryRecordKind,
  type DeliveryRecordService,
} from "@dramaip/contracts/delivery";
import {
  FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
  type DatabaseMaintenanceService,
} from "@dramaip/contracts/foundation";
import {
  MEDIA_RECORD_SERVICE,
  type MediaRecordKind,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_SEASON_SERVICE,
  SeasonSchema,
  type ProductionRecordKind,
  type ProductionRecordService,
  type ProductionSeasonService,
} from "@dramaip/contracts/production";
import {
  REVIEW_RECORD_SERVICE,
  type ReviewRecordKind,
  type ReviewRecordService,
} from "@dramaip/contracts/review";
import {
  GlobalSearchResponseSchema,
  ProjectInputSchema,
  ProjectPackageCommitInputSchema,
  ProjectPackageCommitResultSchema,
  ProjectPackagePreviewInputSchema,
  ProjectPackagePreviewSchema,
  WorkspaceBackupRecordSchema,
  WorkspaceExportDocumentSchema,
  type ProjectInput,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  CREATOR_CONTENT_KINDS,
  CREATOR_CONTENT_SERVICE,
  CreatorContentRecordSchema,
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
  WRITING_VOLUME_SERVICE,
  WritingVolumeSchema,
  type CreatorContentService,
  type WritingChapterService,
  type WritingResourceKind,
  type WritingResourceService,
  type WritingVolumeService,
} from "@dramaip/contracts/writing";
import {
  KNOWLEDGE_RESEARCH_SERVICE,
  type KnowledgeResearchService,
} from "@dramaip/contracts/knowledge";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface RouteContext {
  req: {
    param(name: string): string;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

interface BackupRow {
  id: string;
  file_name: string;
  size: number;
  sha256: string;
  created_at: string;
}

interface PackageRow {
  id: string;
  source_name: string;
  snapshot_json: string;
  expires_at: string;
}

const idParams = z.object({ id: z.string().uuid() });
const exportParams = idParams.extend({
  format: z.enum([
    "json",
    "markdown",
    "submission-markdown",
    "submission-json",
    "script",
    "storyboard",
    "delivery",
  ]),
});
const searchParams = z.object({ query: z.string() });

const packageResourceSchema = z.object({
  id: z.string().uuid(),
  owner: z.enum([
    "writing",
    "production",
    "media",
    "creative-quality",
    "review",
    "delivery",
  ]),
  kind: z.string(),
  parentId: z.string().uuid().optional(),
  title: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});

const projectPackageSchema = z.object({
  format: z.literal("dramaip-project-package"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().datetime(),
  project: ProjectInputSchema,
  chapters: z.array(
    z.object({
      id: z.string().uuid(),
      volumeId: z.string().uuid().optional(),
      title: z.string(),
      summary: z.string().optional(),
      outline: z.string().optional(),
      content: z.string().optional(),
      mainConflict: z.string().optional(),
      hook: z.string().optional(),
      highlight: z.string().optional(),
      reversal: z.string().optional(),
      cliffhanger: z.string().optional(),
      shortDramaNote: z.string().optional(),
      aiVideoNote: z.string().optional(),
    }),
  ),
  resources: z.array(packageResourceSchema),
  structure: z
    .object({
      volumes: z.array(z.unknown()).default([]),
      seasons: z.array(z.unknown()).default([]),
      creatorContent: z.array(z.unknown()).default([]),
      researchTopics: z.array(z.unknown()).default([]),
    })
    .optional(),
  warnings: z.array(z.string()),
});
type ProjectPackage = z.infer<typeof projectPackageSchema>;

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

function declaration(input: {
  method: "delete" | "get" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 204;
}) {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["workspace"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: input.body } },
            },
          }
        : {}),
    },
    responses: {
      [status]:
        status === 204
          ? { description: "No content" }
          : {
              description: "Success",
              content: { "application/json": { schema: input.response } },
            },
      400: {
        description: "Invalid request",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      409: {
        description: "Conflict",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  openapi: unknown,
  handler: (context: RouteContext) => Response | Promise<Response>,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
  });
}

function backup(row: BackupRow) {
  return {
    id: row.id,
    name: row.file_name,
    size: row.size,
    createdAt: row.created_at,
  };
}

function projectInput(
  project: ReturnType<WorkspaceProjectService["get"]>,
): ProjectInput {
  if (!project) throw new Error("project is required");
  return {
    title: project.title,
    shortDramaType: project.shortDramaType,
    mode: project.mode,
    modeConfig: project.modeConfig,
    ...(project.targetAudience
      ? { targetAudience: project.targetAudience }
      : {}),
    ...(project.targetWordCount
      ? { targetWordCount: project.targetWordCount }
      : {}),
    ...(project.targetEpisodeCount
      ? { targetEpisodeCount: project.targetEpisodeCount }
      : {}),
    ...(project.coreHook ? { coreHook: project.coreHook } : {}),
    ...(project.emotionalCore ? { emotionalCore: project.emotionalCore } : {}),
    ...(project.coreSellingPoint
      ? { coreSellingPoint: project.coreSellingPoint }
      : {}),
    synopsis: project.synopsis,
    ...(project.styleGuide ? { styleGuide: project.styleGuide } : {}),
    ...(project.visualStyleDirection
      ? { visualStyleDirection: project.visualStyleDirection }
      : {}),
    ...(project.genreOpportunity
      ? { genreOpportunity: project.genreOpportunity }
      : {}),
    ...(project.productionBrief
      ? { productionBrief: project.productionBrief }
      : {}),
  };
}

function services(context: PluginContext) {
  return {
    chapters: context.services.optional<WritingChapterService>(
      WRITING_CHAPTER_SERVICE,
    ),
    writing: context.services.optional<WritingResourceService>(
      WRITING_RESOURCE_SERVICE,
    ),
    production: context.services.optional<ProductionRecordService>(
      PRODUCTION_RECORD_SERVICE,
    ),
    media: context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE),
    creative: context.services.optional<CreativeQualityRecordService>(
      CREATIVE_QUALITY_SERVICE,
    ),
    review: context.services.optional<ReviewRecordService>(
      REVIEW_RECORD_SERVICE,
    ),
    delivery: context.services.optional<DeliveryRecordService>(
      DELIVERY_RECORD_SERVICE,
    ),
  };
}

const productionKinds: readonly ProductionRecordKind[] = [
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
];
const mediaKinds: readonly MediaRecordKind[] = [
  "shot-stills",
  "visual-assets",
  "assets",
  "rights",
  "image",
  "audio",
  "video",
  "animatics",
  "renders",
];
const writingKinds: readonly WritingResourceKind[] = [
  "characters",
  "outlines",
  "story-arcs",
];
const creativeKinds: readonly CreativeQualityRecordKind[] = [
  "quality",
  "episode-analysis",
  "case-study",
  "diagnostic",
  "acknowledgement",
];
const reviewKinds: readonly ReviewRecordKind[] = [
  "compliance",
  "review",
  "script-review",
  "shot-review",
  "prompt-version",
  "cloud-binding",
  "cloud-connection",
];
const deliveryKinds: readonly DeliveryRecordKind[] = [
  "localization",
  "delivery",
  "delivery-variant",
  "platform-archive",
];

function collectCursorPages<T>(
  list: (cursor?: string) => { items: readonly T[]; nextCursor?: string },
): T[] {
  const values: T[] = [];
  let cursor: string | undefined;
  // Export does not use an unbounded `list all` endpoint. The hard stop is a
  // corruption guard, not a product content limit.
  for (let page = 0; page < 10_000; page += 1) {
    const current = list(cursor);
    values.push(...current.items);
    if (!current.nextCursor) break;
    cursor = current.nextCursor;
  }
  return values;
}

function buildPackage(
  context: PluginContext,
  projects: WorkspaceProjectService,
  projectId: string,
): ProjectPackage | undefined {
  const project = projects.get(projectId);
  if (!project) return undefined;
  const values = services(context);
  if (!values.chapters || !values.writing)
    throw new Error("writing suite is unavailable");
  const resources: ProjectPackage["resources"] = [];
  const volumes = context.services.optional<WritingVolumeService>(
    WRITING_VOLUME_SERVICE,
  );
  const seasons = context.services.optional<ProductionSeasonService>(
    PRODUCTION_SEASON_SERVICE,
  );
  const creatorContent = context.services.optional<CreatorContentService>(
    CREATOR_CONTENT_SERVICE,
  );
  const research = context.services.optional<KnowledgeResearchService>(
    KNOWLEDGE_RESEARCH_SERVICE,
  );
  for (const kind of writingKinds)
    resources.push(
      ...values.writing.list(kind, projectId).map((record) => ({
        id: record.id,
        owner: "writing" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        title: record.title,
        payload: record.payload,
      })),
    );
  for (const kind of productionKinds)
    resources.push(
      ...(values.production?.list(kind, { projectId }).map((record) => ({
        id: record.id,
        owner: "production" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        title: record.title,
        payload: record.payload,
      })) ?? []),
    );
  for (const kind of mediaKinds)
    resources.push(
      ...(values.media?.list(kind, { projectId }).map((record) => ({
        id: record.id,
        owner: "media" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        title: record.title,
        payload: record.payload,
      })) ?? []),
    );
  for (const kind of creativeKinds)
    resources.push(
      ...(values.creative?.list(kind, { projectId }).map((record) => ({
        id: record.id,
        owner: "creative-quality" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        payload: record.value,
      })) ?? []),
    );
  for (const kind of reviewKinds)
    resources.push(
      ...(values.review?.list(kind, { projectId }).map((record) => ({
        id: record.id,
        owner: "review" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        payload: record.value,
      })) ?? []),
    );
  for (const kind of deliveryKinds)
    resources.push(
      ...(values.delivery?.list(kind, { projectId }).map((record) => ({
        id: record.id,
        owner: "delivery" as const,
        kind,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        payload: record.value,
      })) ?? []),
    );
  return {
    format: "dramaip-project-package",
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    project: projectInput(project),
    chapters: values.chapters.list(projectId).map((chapter) => ({
      id: chapter.id,
      ...(chapter.volumeId ? { volumeId: chapter.volumeId } : {}),
      title: chapter.title,
      summary: chapter.summary,
      ...(chapter.outline ? { outline: chapter.outline } : {}),
      content: chapter.content,
      ...(chapter.mainConflict ? { mainConflict: chapter.mainConflict } : {}),
      ...(chapter.hook ? { hook: chapter.hook } : {}),
      ...(chapter.highlight ? { highlight: chapter.highlight } : {}),
      ...(chapter.reversal ? { reversal: chapter.reversal } : {}),
      ...(chapter.cliffhanger ? { cliffhanger: chapter.cliffhanger } : {}),
      ...(chapter.shortDramaNote
        ? { shortDramaNote: chapter.shortDramaNote }
        : {}),
      ...(chapter.aiVideoNote ? { aiVideoNote: chapter.aiVideoNote } : {}),
    })),
    resources,
    structure: {
      volumes: volumes
        ? collectCursorPages((cursor) =>
            volumes.list(projectId, { cursor, limit: 100 }),
          )
        : [],
      seasons: seasons
        ? collectCursorPages((cursor) =>
            seasons.list(projectId, { cursor, limit: 100 }),
          )
        : [],
      creatorContent: creatorContent
        ? CREATOR_CONTENT_KINDS.flatMap((kind) =>
            collectCursorPages((cursor) =>
              creatorContent.list(kind, projectId, { cursor, limit: 100 }),
            ),
          )
        : [],
      researchTopics: research
        ? collectCursorPages((cursor) =>
            research.listTopics(projectId, { cursor, limit: 100 }),
          )
        : [],
    },
    warnings: [
      "安全凭据、绝对路径和本地媒体明文不进入项目包；导入后需重新授权。",
      "项目包 schema v2 保留模式、卷季结构、博主内容和研究专题；照片与授权需在导入后重新附加和确认。",
    ],
  };
}

function exportPackageDocument(
  snapshot: ProjectPackage,
  format: z.infer<typeof exportParams>["format"],
) {
  const safeTitle = snapshot.project.title
    .replace(/[\\/:*?"<>|]/gu, "-")
    .slice(0, 80);
  if (format === "json")
    return {
      fileName: `${safeTitle}.json`,
      mimeType: "application/json",
      content: JSON.stringify(snapshot, null, 2),
    };
  const selected =
    format === "script"
      ? snapshot.resources.filter((record) => record.kind === "scripts")
      : format === "storyboard"
        ? snapshot.resources.filter((record) => record.kind === "shots")
        : format === "delivery"
          ? snapshot.resources.filter((record) =>
              ["delivery", "localization", "compliance", "review"].includes(
                record.kind,
              ),
            )
          : snapshot.resources;
  if (format === "submission-json" || format === "delivery")
    return {
      fileName: `${safeTitle}-${format}.json`,
      mimeType: "application/json",
      content: JSON.stringify(
        {
          ...snapshot,
          chapters: snapshot.chapters.slice(0, 10),
          resources: selected,
        },
        null,
        2,
      ),
    };
  const chapters = snapshot.chapters
    .map((chapter) => `## ${chapter.title}\n\n${chapter.content ?? ""}`)
    .join("\n\n");
  const records = selected
    .map(
      (record) =>
        `## ${record.title ?? record.kind}\n\n\`\`\`json\n${JSON.stringify(record.payload, null, 2)}\n\`\`\``,
    )
    .join("\n\n");
  return {
    fileName: `${safeTitle}-${format}.md`,
    mimeType: "text/markdown",
    content: `# ${snapshot.project.title}\n\n${snapshot.project.synopsis ?? ""}\n\n${chapters}\n\n${records}\n`,
  };
}

function importResources(
  context: PluginContext,
  projectId: string,
  snapshot: ProjectPackage,
): number {
  const value = services(context);
  const mapped = new Map<string, string>();
  let created = 0;
  for (const record of snapshot.resources) {
    const parentId = record.parentId ? mapped.get(record.parentId) : undefined;
    let id: string | undefined;
    if (record.owner === "writing" && value.writing)
      id = value.writing.create({
        kind: record.kind as WritingResourceKind,
        projectId,
        ...(parentId ? { parentId } : {}),
        title: record.title ?? record.kind,
        payload: record.payload,
      }).id;
    if (record.owner === "production" && value.production)
      id = value.production.create(record.kind as ProductionRecordKind, {
        projectId,
        ...(parentId ? { parentId } : {}),
        title: record.title ?? record.kind,
        payload: record.payload,
      }).id;
    if (record.owner === "media" && value.media)
      id = value.media.create(record.kind as MediaRecordKind, {
        projectId,
        ...(parentId ? { parentId } : {}),
        title: record.title ?? record.kind,
        payload: record.payload,
      }).id;
    if (record.owner === "creative-quality" && value.creative)
      id = value.creative.create(record.kind as CreativeQualityRecordKind, {
        projectId,
        ...(parentId ? { parentId } : {}),
        value: record.payload,
      }).id;
    if (record.owner === "review" && value.review)
      id = value.review.create(record.kind as ReviewRecordKind, {
        projectId,
        ...(parentId ? { parentId } : {}),
        value: record.payload,
      }).id;
    if (record.owner === "delivery" && value.delivery)
      id = value.delivery.create(record.kind as DeliveryRecordKind, {
        projectId,
        ...(parentId ? { parentId } : {}),
        value: record.payload,
      }).id;
    if (id) {
      mapped.set(record.id, id);
      created += 1;
    }
  }
  return created;
}

export const workspaceMaintenanceMigrations: readonly PluginMigration[] = [
  {
    id: "workspace.0004.maintenance",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0003.source-imports"],
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_backups (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_package_previews (
        id TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_package_previews_expiry
        ON project_package_previews(expires_at);
    `,
  },
];

export function workspaceMaintenanceRoutes(
  context: PluginContext,
  host: DesktopHostClient | undefined,
  projects: WorkspaceProjectService,
): readonly RouteContribution[] {
  return [
    route(
      {
        id: "workspace:backups-list",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/backups",
        operationId: "backups.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/backups",
        operationId: "backups.list",
        response: z.array(WorkspaceBackupRecordSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<BackupRow>(
                "SELECT * FROM workspace_backups ORDER BY created_at DESC, id",
              )
              .map(backup),
          ),
        ),
    ),
    route(
      {
        id: "workspace:backups-create",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/backups",
        operationId: "backups.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/backups",
        operationId: "backups.create",
        response: WorkspaceBackupRecordSchema,
        status: 201,
      }),
      (requestContext) => {
        const maintenance =
          context.services.optional<DatabaseMaintenanceService>(
            FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
          );
        if (!maintenance)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "数据库备份能力不可用。",
          );
        try {
          const snapshot = maintenance.createBackup();
          const id = crypto.randomUUID();
          const created = context.uow.execute((transaction) => {
            transaction.run(
              "INSERT INTO workspace_backups(id, file_name, size, sha256, created_at) VALUES (?, ?, ?, ?, ?)",
              id,
              snapshot.fileName,
              snapshot.size,
              snapshot.sha256,
              snapshot.createdAt,
            );
            transaction.append({
              type: "workspace.backup-created.v1",
              pluginId: "workspace",
              aggregateType: "backup",
              aggregateId: id,
              aggregateVersion: 0,
              payload: { id, name: snapshot.fileName, size: snapshot.size },
            });
            return {
              id,
              name: snapshot.fileName,
              size: snapshot.size,
              createdAt: snapshot.createdAt,
            };
          });
          return requestContext.json(created, 201);
        } catch (error) {
          return problem(
            requestContext,
            409,
            "BACKUP_FAILED",
            error instanceof Error ? error.message : "数据库备份失败。",
          );
        }
      },
    ),
    route(
      {
        id: "workspace:backups-restore",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/backups/{id}/restore",
        operationId: "backups.restore",
      },
      declaration({
        method: "post",
        path: "/api/v2/backups/{id}/restore",
        operationId: "backups.restore",
        params: idParams,
        response: WorkspaceBackupRecordSchema,
      }),
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<BackupRow>(
            "SELECT * FROM workspace_backups WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到备份。");
        const maintenance =
          context.services.optional<DatabaseMaintenanceService>(
            FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
          );
        if (!maintenance)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "数据库恢复能力不可用。",
          );
        try {
          maintenance.restoreBackup(row.file_name, row.sha256);
          context.uow.execute((transaction) => {
            transaction.run(
              "INSERT OR IGNORE INTO workspace_backups(id, file_name, size, sha256, created_at) VALUES (?, ?, ?, ?, ?)",
              row.id,
              row.file_name,
              row.size,
              row.sha256,
              row.created_at,
            );
            transaction.append({
              type: "workspace.backup-restored.v1",
              pluginId: "workspace",
              aggregateType: "backup",
              aggregateId: row.id,
              aggregateVersion: 0,
              payload: { id: row.id, name: row.file_name },
            });
          });
          return requestContext.json(backup(row));
        } catch (error) {
          return problem(
            requestContext,
            409,
            "RESTORE_FAILED",
            error instanceof Error ? error.message : "数据库恢复失败。",
          );
        }
      },
    ),
    route(
      {
        id: "workspace:project-export",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/exports/projects/{id}/{format}",
        operationId: "exports.project",
      },
      declaration({
        method: "get",
        path: "/api/v2/exports/projects/{id}/{format}",
        operationId: "exports.project",
        params: exportParams,
        response: WorkspaceExportDocumentSchema,
      }),
      (requestContext) => {
        const params = exportParams.safeParse({
          id: requestContext.req.param("id"),
          format: requestContext.req.param("format"),
        });
        if (!params.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目导出参数无效。",
          );
        try {
          const snapshot = buildPackage(context, projects, params.data.id);
          return snapshot
            ? requestContext.json(
                exportPackageDocument(snapshot, params.data.format),
              )
            : problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        } catch (error) {
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            error instanceof Error ? error.message : "项目导出不可用。",
          );
        }
      },
    ),
    route(
      {
        id: "workspace:project-package-preview",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/project-packages/preview",
        operationId: "project-packages.preview",
      },
      declaration({
        method: "post",
        path: "/api/v2/project-packages/preview",
        operationId: "project-packages.preview",
        body: ProjectPackagePreviewInputSchema,
        response: ProjectPackagePreviewSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ProjectPackagePreviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || !host)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "项目包读取能力不可用。",
          );
        try {
          const file = await host.readGrantedText(
            input.data.capabilityToken,
            32 * 1024 * 1024,
          );
          const snapshot = projectPackageSchema.parse(JSON.parse(file.content));
          const id = crypto.randomUUID();
          const expiresAt = new Date(
            Date.now() + 30 * 60 * 1_000,
          ).toISOString();
          context.uow.execute((transaction) => {
            transaction.run(
              "INSERT INTO project_package_previews(id, source_name, snapshot_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
              id,
              file.name,
              JSON.stringify(snapshot),
              expiresAt,
              new Date().toISOString(),
            );
            transaction.append({
              type: "workspace.project-package-previewed.v1",
              pluginId: "workspace",
              aggregateType: "project-package",
              aggregateId: id,
              aggregateVersion: 0,
              payload: { id, sourceName: file.name },
            });
          });
          return requestContext.json(
            {
              id,
              sourceName: file.name,
              projectTitle: snapshot.project.title,
              shortDramaType: snapshot.project.shortDramaType,
              chapterCount: snapshot.chapters.length,
              resourceCount: snapshot.resources.length,
              warnings: snapshot.warnings,
              expiresAt,
            },
            201,
          );
        } catch (error) {
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            error instanceof Error ? error.message : "项目包格式无效。",
          );
        }
      },
    ),
    route(
      {
        id: "workspace:project-package-commit",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/project-packages/{id}/commit",
        operationId: "project-packages.commit",
      },
      declaration({
        method: "post",
        path: "/api/v2/project-packages/{id}/commit",
        operationId: "project-packages.commit",
        params: idParams,
        body: ProjectPackageCommitInputSchema,
        response: ProjectPackageCommitResultSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ProjectPackageCommitInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const row = context.uow.execute((transaction) =>
          transaction.get<PackageRow>(
            "SELECT * FROM project_package_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!input.success || !row)
          return problem(
            requestContext,
            row ? 400 : 404,
            row ? "VALIDATION_ERROR" : "NOT_FOUND",
            row ? "项目包提交参数无效。" : "未找到项目包预览。",
          );
        if (Date.parse(row.expires_at) <= Date.now())
          return problem(requestContext, 409, "CONFLICT", "项目包预览已过期。");
        const writing = context.services.optional<WritingChapterService>(
          WRITING_CHAPTER_SERVICE,
        );
        if (!writing)
          return problem(requestContext, 409, "CONFLICT", "写作套件不可用。");
        const snapshot = projectPackageSchema.parse(
          JSON.parse(row.snapshot_json),
        );
        const project = projects.create({
          ...snapshot.project,
          ...(input.data.title ? { title: input.data.title } : {}),
        });
        const volumeIds = new Map<string, string>();
        const volumeService = context.services.optional<WritingVolumeService>(
          WRITING_VOLUME_SERVICE,
        );
        const seasonService =
          context.services.optional<ProductionSeasonService>(
            PRODUCTION_SEASON_SERVICE,
          );
        const creatorService = context.services.optional<CreatorContentService>(
          CREATOR_CONTENT_SERVICE,
        );
        for (const raw of snapshot.structure?.volumes ?? []) {
          const value = WritingVolumeSchema.safeParse(raw);
          if (!value.success || !volumeService) continue;
          const created = volumeService.create({
            projectId: project.id,
            title: value.data.title,
            outline: value.data.outline,
          });
          volumeIds.set(value.data.id, created.id);
        }
        for (const chapter of snapshot.chapters)
          writing.create({
            projectId: project.id,
            ...(chapter.volumeId && volumeIds.get(chapter.volumeId)
              ? { volumeId: volumeIds.get(chapter.volumeId) }
              : {}),
            title: chapter.title,
            ...(chapter.summary ? { summary: chapter.summary } : {}),
            ...(chapter.outline ? { outline: chapter.outline } : {}),
            ...(chapter.content ? { content: chapter.content } : {}),
            ...(chapter.mainConflict
              ? { mainConflict: chapter.mainConflict }
              : {}),
            ...(chapter.hook ? { hook: chapter.hook } : {}),
            ...(chapter.highlight ? { highlight: chapter.highlight } : {}),
            ...(chapter.reversal ? { reversal: chapter.reversal } : {}),
            ...(chapter.cliffhanger
              ? { cliffhanger: chapter.cliffhanger }
              : {}),
            ...(chapter.shortDramaNote
              ? { shortDramaNote: chapter.shortDramaNote }
              : {}),
            ...(chapter.aiVideoNote
              ? { aiVideoNote: chapter.aiVideoNote }
              : {}),
          });
        for (const raw of snapshot.structure?.seasons ?? []) {
          const value = SeasonSchema.safeParse(raw);
          if (!value.success || !seasonService) continue;
          seasonService.create({
            projectId: project.id,
            title: value.data.title,
            outline: value.data.outline,
            ...(value.data.sourceChapterVersion
              ? { sourceChapterVersion: value.data.sourceChapterVersion }
              : {}),
          });
        }
        for (const raw of snapshot.structure?.creatorContent ?? []) {
          const value = CreatorContentRecordSchema.safeParse(raw);
          if (!value.success || !creatorService) continue;
          creatorService.create(value.data.kind, {
            projectId: project.id,
            title: value.data.title,
            status: value.data.status,
            payload: value.data.payload,
          });
        }
        const resourcesCreated = importResources(context, project.id, snapshot);
        context.uow.execute((transaction) => {
          transaction.run(
            "DELETE FROM project_package_previews WHERE id = ?",
            row.id,
          );
          transaction.append({
            type: "workspace.project-package-committed.v1",
            pluginId: "workspace",
            aggregateType: "project",
            aggregateId: project.id,
            aggregateVersion: project.version,
            payload: {
              previewId: row.id,
              chaptersCreated: snapshot.chapters.length,
              resourcesCreated,
            },
          });
        });
        return requestContext.json(
          {
            project,
            chaptersCreated: snapshot.chapters.length,
            resourcesCreated,
          },
          201,
        );
      },
    ),
    route(
      {
        id: "workspace:project-package-discard",
        pluginId: "workspace",
        method: "delete",
        path: "/api/v2/project-packages/{id}",
        operationId: "project-packages.discard",
      },
      declaration({
        method: "delete",
        path: "/api/v2/project-packages/{id}",
        operationId: "project-packages.discard",
        params: idParams,
        response: z.null(),
        status: 204,
      }),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const removed = context.uow.execute((transaction) => {
          const found = transaction.get<{ id: string }>(
            "SELECT id FROM project_package_previews WHERE id = ?",
            id,
          );
          if (!found) return false;
          transaction.run(
            "DELETE FROM project_package_previews WHERE id = ?",
            id,
          );
          transaction.append({
            type: "workspace.project-package-discarded.v1",
            pluginId: "workspace",
            aggregateType: "project-package",
            aggregateId: id,
            aggregateVersion: 0,
            payload: { id },
          });
          return true;
        });
        return removed
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到项目包预览。");
      },
    ),
    route(
      {
        id: "workspace:search",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/search/{query}",
        operationId: "search.global",
      },
      declaration({
        method: "get",
        path: "/api/v2/search/{query}",
        operationId: "search.global",
        params: searchParams,
        response: GlobalSearchResponseSchema,
      }),
      (requestContext) => {
        const query = requestContext.req.param("query").trim();
        if (!query) return requestContext.json({ query: "", results: [] });
        const matches = (value: unknown) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase());
        const found: Array<
          z.infer<typeof GlobalSearchResponseSchema>["results"][number]
        > = [];
        const value = services(context);
        for (const project of projects.list()) {
          if (matches(project.title) || matches(project.synopsis))
            found.push({
              kind: "project",
              id: project.id,
              title: project.title,
              ...(project.synopsis
                ? { excerpt: project.synopsis.slice(0, 240) }
                : {}),
              updatedAt: project.updatedAt,
            });
          for (const chapter of value.chapters?.list(project.id) ?? [])
            if (
              matches(chapter.title) ||
              matches(chapter.summary) ||
              matches(chapter.content)
            )
              found.push({
                kind: "chapter",
                id: chapter.id,
                title: chapter.title,
                excerpt: (chapter.summary || chapter.content).slice(0, 240),
                projectId: project.id,
                updatedAt: chapter.updatedAt,
              });
          const snapshot = buildPackage(context, projects, project.id);
          for (const record of snapshot?.resources ?? [])
            if (
              matches(record.title) ||
              matches(JSON.stringify(record.payload))
            )
              found.push({
                kind: record.kind,
                id: record.id,
                title: record.title ?? record.kind,
                excerpt: JSON.stringify(record.payload).slice(0, 240),
                projectId: project.id,
                updatedAt: snapshot!.exportedAt,
              });
        }
        return requestContext.json({
          query,
          results: found
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt),
            )
            .slice(0, 60),
        });
      },
    ),
  ];
}
