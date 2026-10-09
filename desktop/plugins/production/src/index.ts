import { registerProductionProjectLineage } from "./project-lineage.js";
import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import { registerDiagnosis, diagnosisMigration } from "./diagnosis.js";
import { screenplayImportReceiptMigration } from "./screenplay-import-receipt.js";
import { episodeScriptRevisionMigration } from "./episode-script-revision.js";
import { episodeTopologyRevisionMigration } from "./episode-topology-revision.js";
import { episodeSourceRevisionMigration } from "./episode-source-revision.js";
import { storyboardAttributionMigration } from "./storyboard-attribution.js";
import { storyboardTopologyRetirementMigration } from "./storyboard-topology-retirement.js";
import { storyboardRecordRetirementMigration } from "./storyboard-record-retirement.js";
import { productionProjectPurgeRequestMigration } from "./project-purge-requests.js";
import {
  productionImportBatch,
  productionImportBatchMigration,
} from "./import-batches.js";
import {
  screenplayIntakeMigration,
  registerScreenplayIntakes,
} from "./screenplay-intake.js";
import { directScriptSourceContent } from "./direct-script-source.js";
import { registerScreenplaySources } from "./screenplay-sources.js";
import { registerProductionQualitySources } from "./quality-sources.js";
import { registerAuthorIntentSources } from "./author-intent-sources.js";
import { registerSeasonPlans, seasonPlanMigration } from "./season-plan.js";
import {
  registerAdaptationStrategies,
  adaptationStrategyMigration,
} from "./adaptation-strategy.js";
import {
  registerEpisodeDevelopment,
  episodeDevelopmentMigration,
} from "./episode-development.js";
import { CREATION_KNOWLEDGE_SERVICE } from "@dramaip/contracts/creation";
import {
  registerProductionCreation,
  productionCreationMigration,
} from "./creation.js";
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
  PRODUCTION_SEASON_SERVICE,
  ProductionGraphSchema,
  ProjectProgressSchema,
  ProductionImpactInputSchema,
  ProductionImpactSchema,
  ProductionRecordInputSchema,
  ProductionRecordPatchSchema,
  ProductionRecordSchema,
  ProductionReorderInputSchema,
  ProductionReorderResultSchema,
  SeasonChapterMappingInputSchema,
  SeasonChapterMappingSchema,
  SeasonInputSchema,
  SeasonPageSchema,
  SeasonPatchSchema,
  SeasonSchema,
  ScreenplayDocumentSchema,
  ScreenplayExportDocumentSchema,
  ScreenplayImportCommitSchema,
  ScreenplayImportPreviewInputSchema,
  ScreenplayImportPreviewSchema,
  ScreenplayImportReceiptSchema,
  ScreenplayImportTargetSchema,
  ScreenplayPatchSchema,
  type ProductionRecord,
  type ProductionRecordInput,
  type ProductionRecordKind,
  type ProductionRecordService,
  type ProductionSeasonService,
  type Season,
  type SeasonChapterMapping,
  type ScreenplayBlock,
  type ScreenplayDocument,
  type ScreenplayImportPreview,
  type ScreenplayLossReport,
} from "@dramaip/contracts/production";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  REVIEW_RECORD_SERVICE,
  type ReviewRecordService,
} from "@dramaip/contracts/review";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import {
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  exportFdx,
  exportFountain,
  parseFdx,
  parseFountain,
} from "./screenplay-codec.js";

interface ProductionRow {
  id: string;
  kind: ProductionRecordKind;
  project_id: string;
  parent_id: string | null;
  title: string;
  payload_json: string;
  order_index: number;
  version: number;
  created_at: string;
  updated_at: string;
  retired_result_id: string | null;
  retired_at: string | null;
  retired_reason:
    "author-scene-shot-plan" | "author-scene-topology-plan" | null;
}

interface SeasonRow {
  id: string;
  project_id: string;
  adaptation_id: string | null;
  title: string;
  outline: string;
  source_chapter_version: string | null;
  status: Season["status"];
  order_index: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SeasonChapterMappingRow {
  id: string;
  season_id: string;
  chapter_id: string;
  chapter_version: number;
  created_at: string;
}

interface ScreenplayDocumentRow {
  id: string;
  script_record_id: string;
  project_id: string;
  title: string;
  source_format: ScreenplayDocument["sourceFormat"];
  blocks_json: string;
  loss_report_json: string;
  legacy_payload_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ScreenplayImportPreviewRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  source_name: string;
  source_format: ScreenplayImportPreview["sourceFormat"];
  blocks_json: string;
  loss_report_json: string;
  etag: string;
  status: ScreenplayImportPreview["status"];
  created_at: string;
  target_json: string | null;
  commit_receipt_json: string | null;
}

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;
const idParams = z.object({ id: z.string().uuid() });
const projectIdParams = z.object({ projectId: z.string().uuid() });
const productionKinds: readonly ProductionRecordKind[] = [
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
];

function toRecord(row: ProductionRow): ProductionRecord {
  return {
    id: row.id,
    kind: row.kind,
    domain: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    orderIndex: row.order_index,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.retired_result_id && row.retired_at
      ? {
          retirement: {
            resultId: row.retired_result_id,
            retiredAt: row.retired_at,
            reason: row.retired_reason ?? "author-scene-shot-plan",
          },
        }
      : {}),
  };
}

function season(row: SeasonRow): Season {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.adaptation_id ? { adaptationId: row.adaptation_id } : {}),
    title: row.title,
    outline: row.outline,
    ...(row.source_chapter_version
      ? { sourceChapterVersion: row.source_chapter_version }
      : {}),
    status: row.status,
    orderIndex: row.order_index,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seasonMapping(row: SeasonChapterMappingRow): SeasonChapterMapping {
  return {
    id: row.id,
    seasonId: row.season_id,
    chapterId: row.chapter_id,
    chapterVersion: row.chapter_version,
    createdAt: row.created_at,
  };
}

function appendEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: ProductionRecord,
): void {
  transaction.append({
    type: `production.${action}.v1`,
    pluginId: "production",
    aggregateType: value.kind,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function syncScriptDocument(
  transaction: UnitOfWorkTransaction,
  value: ProductionRecord,
): void {
  if (value.kind !== "scripts") return;
  const content = String(value.payload["剧本内容"] ?? "");
  const existing = transaction.get<ScreenplayDocumentRow>(
    "SELECT * FROM screenplay_documents WHERE script_record_id = ?",
    value.id,
  );
  const parsed = parseFountain(content);
  if (existing) {
    const old = screenplayDocument(existing).blocks;
    if (exportFountain(old) === content && existing.title === value.title)
      return;
    const used = new Set<string>();
    for (const block of parsed.blocks) {
      const match = old.find(
        (item) =>
          !used.has(item.id) &&
          item.type === block.type &&
          ("text" in item ? item.text : "") ===
            ("text" in block ? block.text : ""),
      );
      if (match) {
        block.id = match.id;
        used.add(match.id);
      }
    }
  }
  transaction.run(
    "INSERT INTO screenplay_documents(id, script_record_id, project_id, title, source_format, blocks_json, loss_report_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'native', ?, ?, 0, ?, ?) ON CONFLICT(script_record_id) DO UPDATE SET title = excluded.title, blocks_json = excluded.blocks_json, loss_report_json = excluded.loss_report_json, version = screenplay_documents.version + 1, updated_at = excluded.updated_at",
    crypto.randomUUID(),
    value.id,
    value.projectId,
    value.title,
    JSON.stringify(parsed.blocks),
    JSON.stringify(parsed.lossReport),
    value.createdAt,
    value.updatedAt,
  );
}

function createRecord(
  context: PluginContext,
  kind: ProductionRecordKind,
  input: ProductionRecordInput,
  transaction?: UnitOfWorkTransaction,
): ProductionRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const create = (transaction: UnitOfWorkTransaction) => {
    if (input.parentId) {
      const parent = transaction.get<ProductionRow>(
        "SELECT * FROM production_records WHERE id = ? AND project_id = ?",
        input.parentId,
        input.projectId,
      );
      if (!parent || parent.retired_result_id)
        throw new Error(
          "上级制作条目已退役或归属不可核对，不能创建新的子条目。",
        );
    }
    const orderIndex =
      transaction.get<{ value: number }>(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS value
         FROM production_records
         WHERE kind = ? AND retired_result_id IS NULL AND ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))`,
        kind,
        input.parentId ?? null,
        input.parentId ?? null,
      )?.value ?? 0;
    transaction.run(
      `INSERT INTO production_records(
        id, kind, project_id, parent_id, title, payload_json, order_index,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      kind,
      input.projectId,
      input.parentId ?? null,
      input.title.trim(),
      JSON.stringify(input.payload ?? {}),
      orderIndex,
      now,
      now,
    );
    const value = toRecord(
      transaction.get<ProductionRow>(
        "SELECT * FROM production_records WHERE id = ?",
        id,
      )!,
    );
    syncScriptDocument(transaction, value);
    appendEvent(transaction, `${kind}-created`, value);
    return value;
  };
  return transaction ? create(transaction) : context.uow.execute(create);
}

function listRecords(
  context: PluginContext,
  kind: ProductionRecordKind,
  filter: { projectId?: string; parentId?: string },
): readonly ProductionRecord[] {
  return context.uow.execute((transaction) =>
    (filter.parentId
      ? transaction.all<ProductionRow>(
          "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? AND retired_result_id IS NULL ORDER BY order_index, created_at",
          kind,
          filter.parentId,
        )
      : transaction.all<ProductionRow>(
          "SELECT * FROM production_records WHERE kind = ? AND project_id = ? AND retired_result_id IS NULL ORDER BY order_index, created_at",
          kind,
          filter.projectId,
        )
    ).map(toRecord),
  );
}

function createSeason(
  context: PluginContext,
  input: z.infer<typeof SeasonInputSchema>,
): Season {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return context.uow.execute((transaction) => {
    const orderIndex =
      transaction.get<{ value: number }>(
        "SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM production_seasons WHERE project_id = ?",
        input.projectId,
      )?.value ?? 0;
    transaction.run(
      `INSERT INTO production_seasons(
        id, project_id, adaptation_id, title, outline, source_chapter_version,
        status, order_index, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, ?)`,
      id,
      input.projectId,
      input.adaptationId ?? null,
      input.title.trim(),
      input.outline ?? "",
      input.sourceChapterVersion ?? null,
      orderIndex,
      now,
      now,
    );
    const value = season(
      transaction.get<SeasonRow>(
        "SELECT * FROM production_seasons WHERE id = ?",
        id,
      )!,
    );
    transaction.append({
      type: "production.season-created.v1",
      pluginId: "production",
      aggregateType: "season",
      aggregateId: id,
      aggregateVersion: value.version,
      payload: JSON.parse(JSON.stringify(value)),
    });
    return value;
  });
}

function listSeasons(
  context: PluginContext,
  projectId: string,
  options: { cursor?: string; limit?: number } = {},
): { items: readonly Season[]; nextCursor?: string } {
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  const cursor = options.cursor ? Number(options.cursor) : -1;
  if (!Number.isInteger(cursor) || cursor < -1) return { items: [] };
  return context.uow.execute((transaction) => {
    const rows = transaction.all<SeasonRow>(
      `SELECT * FROM production_seasons
       WHERE project_id = ? AND order_index > ?
       ORDER BY order_index, id LIMIT ?`,
      projectId,
      cursor,
      limit + 1,
    );
    const values = rows.slice(0, limit).map(season);
    const last = values.at(-1);
    return {
      items: values,
      ...(rows.length > limit && last
        ? { nextCursor: String(last.orderIndex) }
        : {}),
    };
  });
}

function updateSeason(
  context: PluginContext,
  id: string,
  patch: z.infer<typeof SeasonPatchSchema>,
): Season | "conflict" | undefined {
  return context.uow.execute((transaction) => {
    const current = transaction.get<SeasonRow>(
      "SELECT * FROM production_seasons WHERE id = ?",
      id,
    );
    if (!current) return undefined;
    if (current.version !== patch.version) return "conflict" as const;
    const now = new Date().toISOString();
    transaction.run(
      `UPDATE production_seasons SET title = ?, outline = ?, status = ?,
       version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
      patch.title?.trim() ?? current.title,
      patch.outline ?? current.outline,
      patch.status ?? current.status,
      now,
      id,
      current.version,
    );
    const value = season(
      transaction.get<SeasonRow>(
        "SELECT * FROM production_seasons WHERE id = ?",
        id,
      )!,
    );
    transaction.append({
      type: "production.season-updated.v1",
      pluginId: "production",
      aggregateType: "season",
      aggregateId: id,
      aggregateVersion: value.version,
      payload: JSON.parse(JSON.stringify(value)),
    });
    return value;
  });
}

function mapSeasonChapter(
  context: PluginContext,
  input: z.infer<typeof SeasonChapterMappingInputSchema>,
): SeasonChapterMapping {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return context.uow.execute((transaction) => {
    transaction.run(
      `INSERT INTO production_season_chapter_mappings(
        id, season_id, chapter_id, chapter_version, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      id,
      input.seasonId,
      input.chapterId,
      input.chapterVersion,
      now,
    );
    const value = seasonMapping(
      transaction.get<SeasonChapterMappingRow>(
        "SELECT * FROM production_season_chapter_mappings WHERE id = ?",
        id,
      )!,
    );
    transaction.append({
      type: "production.season-chapter-mapped.v1",
      pluginId: "production",
      aggregateType: "season",
      aggregateId: input.seasonId,
      aggregateVersion: 0,
      payload: JSON.parse(JSON.stringify(value)),
    });
    return value;
  });
}

function screenplayDocument(row: ScreenplayDocumentRow): ScreenplayDocument {
  return {
    id: row.id,
    scriptId: row.script_record_id,
    projectId: row.project_id,
    title: row.title,
    sourceFormat: row.source_format,
    blocks: JSON.parse(row.blocks_json) as ScreenplayBlock[],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function screenplayPreview(
  row: ScreenplayImportPreviewRow,
): ScreenplayImportPreview {
  return {
    previewId: row.id,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    sourceName: row.source_name,
    sourceFormat: row.source_format,
    blocks: JSON.parse(row.blocks_json) as ScreenplayBlock[],
    lossReport: JSON.parse(row.loss_report_json) as ScreenplayLossReport,
    etag: row.etag,
    status: row.status,
    createdAt: row.created_at,
    ...(row.target_json
      ? {
          target: ScreenplayImportTargetSchema.parse(
            JSON.parse(row.target_json),
          ),
        }
      : {}),
    ...(row.commit_receipt_json
      ? {
          receipt: ScreenplayImportReceiptSchema.parse(
            JSON.parse(row.commit_receipt_json),
          ),
        }
      : {}),
  };
}

function screenplayRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  records: ProductionRecordService,
  host?: DesktopHostClient,
): readonly RouteContribution[] {
  const previewParams = z.object({ id: z.string().uuid() });
  const exportParams = z.object({
    id: z.string().uuid(),
    format: z.enum(["fountain", "fdx"]),
  });
  const targetMatches = (
    projectId: string,
    parentId: string | null | undefined,
    target?: ScreenplayImportPreview["target"],
  ) => {
    const project = workspace.get(projectId);
    const parent = parentId ? records.get(parentId) : undefined;
    if (!project || (parentId && parent?.projectId !== projectId)) return false;
    if (!target) return true; // Existing generic protocol remains compatible.
    return (
      project.version === target.projectVersion &&
      project.modeConfig.mode === "single_season" &&
      ["script", "inspiration"].includes(project.modeConfig.entryPath) &&
      parent?.kind === "episodes" &&
      parent.version === target.episodeVersion &&
      parent.parentId === project.currentAdaptationId
    );
  };
  return [
    route(
      {
        id: "production:screenplay-import-preview-create",
        pluginId: "production",
        method: "post",
        path: "/api/v2/screenplay-import-previews",
        operationId: "screenplayImport.createPreview",
      },
      openapi({
        method: "post",
        path: "/api/v2/screenplay-import-previews",
        operationId: "screenplayImport.createPreview",
        body: ScreenplayImportPreviewInputSchema,
        response: ScreenplayImportPreviewSchema,
        status: 201,
      }),
      async (requestContext) => {
        if (!host)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前模式无法读取本地剧本文件。",
          );
        const input = ScreenplayImportPreviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || !workspace.get(input.data.projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "剧本导入参数或项目无效。",
          );
        if (
          !targetMatches(
            input.data.projectId,
            input.data.parentId,
            input.data.target,
          )
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "剧本目标不属于当前实际分集，或确认的项目／分集版本已变化。",
          );
        const file = await host.readGrantedDocument(
          input.data.grantId,
          32 * 1024 * 1024,
        );
        if (file.format !== "fountain" && file.format !== "fdx")
          return problem(
            requestContext,
            422,
            "UNSUPPORTED_SCREENPLAY_FORMAT",
            "P1 当前仅支持 Fountain 与 FDX；扫描 PDF/OCR 明确不可用。",
          );
        let parsed;
        try {
          parsed =
            file.format === "fountain"
              ? parseFountain(file.content)
              : parseFdx(file.content);
        } catch {
          return problem(
            requestContext,
            400,
            "SCREENPLAY_PARSE_FAILED",
            "剧本文件无法安全解析。",
          );
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const etag = `"screenplay-import:${id}:0"`;
        const row = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO screenplay_import_previews(
              id, project_id, parent_id, title, source_name, source_format,
              blocks_json, loss_report_json, etag, status, created_at, target_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            id,
            input.data.projectId,
            input.data.parentId ?? null,
            input.data.title,
            file.name.slice(0, 240),
            file.format,
            JSON.stringify(parsed.blocks),
            JSON.stringify(parsed.lossReport),
            etag,
            now,
            input.data.target ? JSON.stringify(input.data.target) : null,
          );
          return transaction.get<ScreenplayImportPreviewRow>(
            "SELECT * FROM screenplay_import_previews WHERE id = ?",
            id,
          )!;
        });
        return requestContext.json(screenplayPreview(row), 201);
      },
    ),
    route(
      {
        id: "production:screenplay-import-preview-get",
        pluginId: "production",
        method: "get",
        path: "/api/v2/screenplay-import-previews/{id}",
        operationId: "screenplayImport.getPreview",
      },
      openapi({
        method: "get",
        path: "/api/v2/screenplay-import-previews/{id}",
        operationId: "screenplayImport.getPreview",
        params: previewParams,
        response: ScreenplayImportPreviewSchema,
      }),
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<ScreenplayImportPreviewRow>(
            "SELECT * FROM screenplay_import_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        return row
          ? requestContext.json(screenplayPreview(row))
          : problem(requestContext, 404, "NOT_FOUND", "未找到剧本导入预览。");
      },
    ),
    route(
      {
        id: "production:screenplay-import-commit",
        pluginId: "production",
        method: "post",
        path: "/api/v2/screenplay-import-previews/{id}/commit",
        operationId: "screenplayImport.commit",
      },
      openapi({
        method: "post",
        path: "/api/v2/screenplay-import-previews/{id}/commit",
        operationId: "screenplayImport.commit",
        params: previewParams,
        body: ScreenplayImportCommitSchema,
        response: ScreenplayDocumentSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = ScreenplayImportCommitSchema.safeParse(
          await requestContext.req.json(),
        );
        const id = requestContext.req.param("id");
        if (!input.success || input.data.previewId !== id)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "剧本导入提交参数无效。",
          );
        // Services own their read transactions. Preflight synchronously, with no
        // await before the write transaction; never nest a peer service's UoW.
        const checkedPreview = context.uow.execute((transaction) =>
          transaction.get<ScreenplayImportPreviewRow>(
            "SELECT * FROM screenplay_import_previews WHERE id = ?",
            id,
          ),
        );
        const targetCurrent = checkedPreview
          ? targetMatches(
              checkedPreview.project_id,
              checkedPreview.parent_id,
              checkedPreview.target_json
                ? ScreenplayImportTargetSchema.parse(
                    JSON.parse(checkedPreview.target_json),
                  )
                : undefined,
            )
          : false;
        const result = context.uow.execute((transaction) => {
          const preview = transaction.get<ScreenplayImportPreviewRow>(
            "SELECT * FROM screenplay_import_previews WHERE id = ?",
            id,
          );
          if (!preview) return { state: "missing" as const };
          if (preview.status !== "pending") return { state: "used" as const };
          if (requestContext.req.header("If-Match")?.trim() !== preview.etag)
            return { state: "conflict" as const };
          const target = preview.target_json
            ? ScreenplayImportTargetSchema.parse(
                JSON.parse(preview.target_json),
              )
            : undefined;
          if (
            !targetCurrent ||
            preview.target_json !== checkedPreview?.target_json ||
            preview.project_id !== checkedPreview.project_id ||
            preview.parent_id !== checkedPreview.parent_id
          )
            return { state: "target-changed" as const };
          if (
            target &&
            (!input.data.confirmation ||
              !directScriptSourceContent(undefined, {
                version: 0,
                blocks_json: preview.blocks_json,
                source_format: preview.source_format,
                loss_report_json: preview.loss_report_json,
              }))
          )
            return { state: "unconfirmed" as const };
          const scriptId = crypto.randomUUID();
          const documentId = crypto.randomUUID();
          const now = new Date().toISOString();
          const orderIndex =
            transaction.get<{ value: number }>(
              `SELECT COALESCE(MAX(order_index), -1) + 1 AS value
               FROM production_records
               WHERE kind = 'scripts' AND ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))`,
              preview.parent_id,
              preview.parent_id,
            )?.value ?? 0;
          transaction.run(
            `INSERT INTO production_records(
              id, kind, project_id, parent_id, title, payload_json,
              order_index, version, created_at, updated_at
            ) VALUES (?, 'scripts', ?, ?, ?, '{}', ?, 0, ?, ?)`,
            scriptId,
            preview.project_id,
            preview.parent_id,
            preview.title,
            orderIndex,
            now,
            now,
          );
          transaction.run(
            `INSERT INTO screenplay_documents(
              id, script_record_id, project_id, title, source_format,
              blocks_json, loss_report_json, legacy_payload_json,
              version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
            documentId,
            scriptId,
            preview.project_id,
            preview.title,
            preview.source_format,
            preview.blocks_json,
            preview.loss_report_json,
            now,
            now,
          );
          const document = screenplayDocument(
            transaction.get<ScreenplayDocumentRow>(
              "SELECT * FROM screenplay_documents WHERE id = ?",
              documentId,
            )!,
          );
          const receipt = ScreenplayImportReceiptSchema.parse({
            scriptId: document.scriptId,
            scriptVersion: transaction.get<{ version: number }>(
              "SELECT version FROM production_records WHERE id = ?",
              scriptId,
            )!.version,
            documentId: document.id,
            documentVersion: document.version,
            committedAt: now,
            confirmation: input.data.confirmation,
          });
          transaction.run(
            "UPDATE screenplay_import_previews SET status = 'committed', commit_receipt_json = ? WHERE id = ? AND status = 'pending'",
            JSON.stringify(receipt),
            id,
          );
          transaction.append({
            type: "production.screenplay-imported.v1",
            pluginId: "production",
            aggregateType: "screenplay",
            aggregateId: document.id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(document)),
          });
          return { state: "created" as const, document };
        });
        if (result.state === "missing")
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到剧本导入预览。",
          );
        if (result.state !== "created")
          return problem(
            requestContext,
            409,
            "SCREENPLAY_IMPORT_CONFLICT",
            result.state === "target-changed"
              ? "确认的项目／实际分集已变化，未导入原稿；请重新预览。"
              : result.state === "unconfirmed"
                ? "请明确确认来源使用权及格式损失，并提供含真实动作／对白的原稿。"
                : "导入预览已使用或版本已变化；请读取同一预览核验，不重复导入。",
          );
        return requestContext.json(result.document, 201);
      },
    ),
    route(
      {
        id: "production:screenplay-import-discard",
        pluginId: "production",
        method: "delete",
        path: "/api/v2/screenplay-import-previews/{id}",
        operationId: "screenplayImport.discard",
      },
      openapi({
        method: "delete",
        path: "/api/v2/screenplay-import-previews/{id}",
        operationId: "screenplayImport.discard",
        params: previewParams,
        response: ScreenplayImportPreviewSchema,
      }),
      (requestContext) => {
        const result = context.uow.execute((transaction) => {
          const preview = transaction.get<ScreenplayImportPreviewRow>(
            "SELECT * FROM screenplay_import_previews WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!preview) return { state: "missing" as const };
          if (
            preview.etag !== requestContext.req.header("If-Match")?.trim() ||
            preview.status !== "pending"
          )
            return { state: "conflict" as const };
          transaction.run(
            "UPDATE screenplay_import_previews SET status = 'discarded' WHERE id = ? AND status = 'pending'",
            preview.id,
          );
          return {
            state: "discarded" as const,
            preview: screenplayPreview({ ...preview, status: "discarded" }),
          };
        });
        if (result.state === "missing")
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到同一剧本导入预览。",
          );
        if (result.state !== "discarded")
          return problem(
            requestContext,
            409,
            "SCREENPLAY_IMPORT_CONFLICT",
            "预览已提交或版本已变化；请核验原回执，不能取消已导入原稿。",
          );
        return requestContext.json(result.preview);
      },
    ),
    route(
      {
        id: "production:screenplay-get",
        pluginId: "production",
        method: "get",
        path: "/api/v2/scripts/{id}/screenplay",
        operationId: "screenplays.get",
      },
      openapi({
        method: "get",
        path: "/api/v2/scripts/{id}/screenplay",
        operationId: "screenplays.get",
        params: idParams,
        response: ScreenplayDocumentSchema,
      }),
      (requestContext) => {
        context.uow.execute((transaction) => {
          const id = requestContext.req.param("id");
          if (
            !transaction.get(
              "SELECT id FROM screenplay_documents WHERE script_record_id = ?",
              id,
            )
          ) {
            const record = transaction.get<ProductionRow>(
              "SELECT * FROM production_records WHERE id = ? AND kind = 'scripts'",
              id,
            );
            if (record) syncScriptDocument(transaction, toRecord(record));
          }
        });
        const row = context.uow.execute((transaction) =>
          transaction.get<ScreenplayDocumentRow>(
            "SELECT * FROM screenplay_documents WHERE script_record_id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到结构化剧本。",
          );
        requestContext.header("ETag", `"${row.version}"`);
        return requestContext.json(screenplayDocument(row));
      },
    ),
    route(
      {
        id: "production:screenplay-update",
        pluginId: "production",
        method: "patch",
        path: "/api/v2/scripts/{id}/screenplay",
        operationId: "screenplays.update",
      },
      openapi({
        method: "patch",
        path: "/api/v2/scripts/{id}/screenplay",
        operationId: "screenplays.update",
        params: idParams,
        body: ScreenplayPatchSchema,
        response: ScreenplayDocumentSchema,
      }),
      async (requestContext) => {
        const input = ScreenplayPatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "结构化剧本更新参数无效。",
          );
        if (
          requestContext.req.header("If-Match")?.trim() !==
          `"${input.data.version}"`
        )
          return problem(
            requestContext,
            428,
            "PRECONDITION_REQUIRED",
            "更新结构化剧本必须携带与版本一致的 If-Match。",
          );
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ScreenplayDocumentRow>(
            "SELECT * FROM screenplay_documents WHERE script_record_id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== input.data.version)
            return { state: "conflict" as const };
          const now = new Date().toISOString();
          const title = input.data.title ?? current.title;
          transaction.run(
            `UPDATE screenplay_documents
             SET title = ?, blocks_json = ?, source_format = 'native',
                 version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
            title,
            JSON.stringify(input.data.blocks),
            now,
            current.id,
            current.version,
          );
          transaction.run(
            `UPDATE production_records
             SET title = ?, payload_json = json_set(payload_json, '$.剧本内容', ?), version = version + 1, updated_at = ?
             WHERE id = ?`,
            title,
            exportFountain(input.data.blocks),
            now,
            current.script_record_id,
          );
          const document = screenplayDocument(
            transaction.get<ScreenplayDocumentRow>(
              "SELECT * FROM screenplay_documents WHERE id = ?",
              current.id,
            )!,
          );
          transaction.append({
            type: "production.screenplay-updated.v1",
            pluginId: "production",
            aggregateType: "screenplay",
            aggregateId: document.id,
            aggregateVersion: document.version,
            payload: JSON.parse(JSON.stringify(document)),
          });
          return { state: "updated" as const, document };
        });
        if (result.state === "missing")
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到结构化剧本。",
          );
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "SCREENPLAY_VERSION_CONFLICT",
            "剧本主稿已经变化，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.document.version}"`);
        return requestContext.json(result.document);
      },
    ),
    route(
      {
        id: "production:screenplay-export",
        pluginId: "production",
        method: "get",
        path: "/api/v2/scripts/{id}/screenplay/export/{format}",
        operationId: "screenplays.export",
      },
      openapi({
        method: "get",
        path: "/api/v2/scripts/{id}/screenplay/export/{format}",
        operationId: "screenplays.export",
        params: exportParams,
        response: ScreenplayExportDocumentSchema,
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
            "不支持的剧本导出格式。",
          );
        const row = context.uow.execute((transaction) =>
          transaction.get<ScreenplayDocumentRow>(
            "SELECT * FROM screenplay_documents WHERE script_record_id = ?",
            params.data.id,
          ),
        );
        if (!row)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到结构化剧本。",
          );
        const document = screenplayDocument(row);
        const lossReport = JSON.parse(
          row.loss_report_json,
        ) as ScreenplayLossReport;
        return requestContext.json({
          fileName: `${document.title}.${params.data.format}`,
          mimeType:
            params.data.format === "fdx"
              ? "application/xml"
              : "text/plain; charset=utf-8",
          content:
            params.data.format === "fdx"
              ? exportFdx(document.blocks)
              : exportFountain(document.blocks),
          lossReport,
        });
      },
    ),
  ];
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

function openapi(input: {
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["production"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.query ? { query: input.query } : {}),
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
      [status]: {
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

function productionResourceRoutes(
  workspace: WorkspaceProjectService,
  records: ProductionRecordService,
): readonly RouteContribution[] {
  const result: RouteContribution[] = [];
  for (const kind of productionKinds) {
    const collectionPath = `/api/v2/${kind}` as `/api/v2/${string}`;
    const itemPath = `/api/v2/${kind}/{id}` as `/api/v2/${string}`;
    result.push(
      route(
        {
          id: `production:${kind}-list`,
          pluginId: "production",
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
        },
        openapi({
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
          response: z.array(ProductionRecordSchema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.query("projectId");
          const parentId = requestContext.req.query("parentId");
          if (!projectId || !workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(
            records.list(kind, parentId ? { parentId } : { projectId }),
          );
        },
      ),
      route(
        {
          id: `production:${kind}-get`,
          pluginId: "production",
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
        },
        openapi({
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
          params: idParams,
          response: ProductionRecordSchema,
        }),
        (requestContext) => {
          const value = records.get(requestContext.req.param("id"));
          return value?.kind === kind
            ? requestContext.json(value)
            : problem(requestContext, 404, "NOT_FOUND", "未找到制作条目。");
        },
      ),
      route(
        {
          id: `production:${kind}-create`,
          pluginId: "production",
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
        },
        openapi({
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
          body: ProductionRecordInputSchema,
          response: ProductionRecordSchema,
          status: 201,
        }),
        async (requestContext) => {
          const input = ProductionRecordInputSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success || !workspace.get(input.data.projectId))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "制作条目内容无效。",
            );
          if (input.data.parentId) {
            const parent = records.get(input.data.parentId);
            if (!parent || parent.projectId !== input.data.projectId)
              return problem(
                requestContext,
                404,
                "NOT_FOUND",
                "未找到上级制作条目。",
              );
            if (parent.retirement)
              return problem(
                requestContext,
                409,
                "CONFLICT",
                "上级制作条目已退役，保留历史但不能创建新子条目。",
              );
          }
          return requestContext.json(records.create(kind, input.data), 201);
        },
      ),
      route(
        {
          id: `production:${kind}-update`,
          pluginId: "production",
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
        },
        openapi({
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
          params: idParams,
          body: ProductionRecordPatchSchema,
          response: ProductionRecordSchema,
        }),
        async (requestContext) => {
          const input = ProductionRecordPatchSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "制作条目修改无效。",
            );
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到制作条目。",
            );
          const value = records.update(current.id, input.data);
          return value === "conflict"
            ? problem(
                requestContext,
                409,
                "CONFLICT",
                "制作条目已更新，请刷新后重试。",
              )
            : requestContext.json(value);
        },
      ),
      route(
        {
          id: `production:${kind}-remove`,
          pluginId: "production",
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
        },
        openapi({
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
          params: idParams,
          response: z.unknown(),
          status: 204,
        }),
        (requestContext) => {
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到制作条目。",
            );
          return records.remove(current.id)
            ? requestContext.body(null, 204)
            : problem(requestContext, 409, "CONFLICT", "制作条目无法删除。");
        },
      ),
    );
  }
  return result;
}

function seasonRoutes(
  workspace: WorkspaceProjectService,
  writing: WritingChapterService,
  seasons: ProductionSeasonService,
): readonly RouteContribution[] {
  const projectParams = z.object({ projectId: z.string().uuid() });
  const chapterMappingParams = z.object({ id: z.string().uuid() });
  return [
    route(
      {
        id: "production:seasons-list",
        pluginId: "production",
        method: "get",
        path: "/api/v2/projects/{projectId}/seasons",
        operationId: "seasons.list",
      },
      openapi({
        method: "get",
        path: "/api/v2/projects/{projectId}/seasons",
        operationId: "seasons.list",
        params: projectParams,
        response: SeasonPageSchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          seasons.list(projectId, {
            cursor: requestContext.req.query("cursor"),
            limit: Number(requestContext.req.query("limit") ?? "40"),
          }),
        );
      },
    ),
    route(
      {
        id: "production:seasons-create",
        pluginId: "production",
        method: "post",
        path: "/api/v2/projects/{projectId}/seasons",
        operationId: "seasons.create",
      },
      openapi({
        method: "post",
        path: "/api/v2/projects/{projectId}/seasons",
        operationId: "seasons.create",
        params: projectParams,
        body: SeasonInputSchema.omit({ projectId: true }),
        response: SeasonSchema,
        status: 201,
      }),
      async (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        const parsed = SeasonInputSchema.omit({ projectId: true }).safeParse(
          await requestContext.req.json(),
        );
        if (!workspace.get(projectId) || !parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "季信息无效。",
          );
        return requestContext.json(
          seasons.create({ ...parsed.data, projectId }),
          201,
        );
      },
    ),
    route(
      {
        id: "production:seasons-update",
        pluginId: "production",
        method: "patch",
        path: "/api/v2/seasons/{id}",
        operationId: "seasons.update",
      },
      openapi({
        method: "patch",
        path: "/api/v2/seasons/{id}",
        operationId: "seasons.update",
        params: chapterMappingParams,
        body: SeasonPatchSchema,
        response: SeasonSchema,
      }),
      async (requestContext) => {
        const parsed = SeasonPatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "季修改无效。",
          );
        const value = seasons.update(
          requestContext.req.param("id"),
          parsed.data,
        );
        return value === undefined
          ? problem(requestContext, 404, "NOT_FOUND", "未找到季。")
          : value === "conflict"
            ? problem(
                requestContext,
                409,
                "CONFLICT",
                "季已更新，请刷新后重试。",
              )
            : requestContext.json(value);
      },
    ),
    route(
      {
        id: "production:seasons-map-chapter",
        pluginId: "production",
        method: "post",
        path: "/api/v2/seasons/{id}/chapter-mappings",
        operationId: "seasons.mapChapter",
      },
      openapi({
        method: "post",
        path: "/api/v2/seasons/{id}/chapter-mappings",
        operationId: "seasons.mapChapter",
        params: chapterMappingParams,
        body: SeasonChapterMappingInputSchema.omit({ seasonId: true }),
        response: SeasonChapterMappingSchema,
        status: 201,
      }),
      async (requestContext) => {
        const seasonId = requestContext.req.param("id");
        const parsed = SeasonChapterMappingInputSchema.omit({
          seasonId: true,
        }).safeParse(await requestContext.req.json());
        const current = seasons.get(seasonId);
        const chapter = parsed.success
          ? writing.get(parsed.data.chapterId)
          : undefined;
        if (
          !current ||
          !parsed.success ||
          !chapter ||
          chapter.projectId !== current.projectId ||
          chapter.version !== parsed.data.chapterVersion
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节映射无效。",
          );
        return requestContext.json(
          seasons.mapChapter({ seasonId, ...parsed.data }),
          201,
        );
      },
    ),
  ];
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: RouteHandler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function productionRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  writing: WritingChapterService,
  records: ProductionRecordService,
  seasons: ProductionSeasonService,
  host?: DesktopHostClient,
): readonly RouteContribution[] {
  const graphDeclaration = openapi({
    method: "get",
    path: "/api/v2/projects/{id}/production-graph",
    operationId: "production.graph",
    params: idParams,
    response: ProductionGraphSchema,
  });
  const progressQuery = z.object({
    episodeIds: z.string().max(2_000).optional(),
  });
  const progressDeclaration = openapi({
    method: "get",
    path: "/api/v2/projects/{id}/progress",
    operationId: "projects.progress",
    params: idParams,
    query: progressQuery,
    response: ProjectProgressSchema,
  });
  const impactDeclaration = openapi({
    method: "post",
    path: "/api/v2/production/impact",
    operationId: "production.impact",
    body: ProductionImpactInputSchema,
    response: ProductionImpactSchema,
  });
  const selectDeclaration = openapi({
    method: "post",
    path: "/api/v2/projects/{projectId}/current-adaptation",
    operationId: "production-structure.selectCurrentAdaptation",
    params: projectIdParams,
    body: z.object({ adaptationId: z.string().uuid() }),
    response: z.unknown(),
  });
  const result: RouteContribution[] = [
    ...productionResourceRoutes(workspace, records),
    ...seasonRoutes(workspace, writing, seasons),
    ...screenplayRoutes(context, workspace, records, host),
    route(
      {
        id: "production:project-progress",
        pluginId: "production",
        method: "get",
        path: "/api/v2/projects/{id}/progress",
        operationId: "projects.progress",
      },
      progressDeclaration,
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const project = workspace.get(projectId);
        if (!project)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const requestedIds = (requestContext.req.query("episodeIds") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (requestedIds.some((id) => !z.string().uuid().safeParse(id).success))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "分集范围无效。",
          );
        const all = productionKinds.flatMap((kind) =>
          records.list(kind, { projectId }),
        );
        const episodes = all.filter((item) => item.kind === "episodes");
        const selectedEpisodes = requestedIds.length
          ? episodes.filter((item) => requestedIds.includes(item.id))
          : episodes;
        if (
          requestedIds.length &&
          selectedEpisodes.length !== requestedIds.length
        )
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "试制范围包含不属于当前项目的分集。",
          );
        const episodeIds = new Set(selectedEpisodes.map((item) => item.id));
        const scripts = all.filter(
          (item) =>
            item.kind === "scripts" &&
            item.parentId &&
            episodeIds.has(item.parentId),
        );
        const scriptIds = new Set(scripts.map((item) => item.id));
        const scenes = all.filter(
          (item) =>
            item.kind === "scenes" &&
            item.parentId &&
            scriptIds.has(item.parentId),
        );
        const sceneIds = new Set(scenes.map((item) => item.id));
        const shots = all.filter(
          (item) =>
            item.kind === "shots" &&
            item.parentId &&
            sceneIds.has(item.parentId),
        );
        const shotIds = new Set(shots.map((item) => item.id));
        const media = optionalService<MediaRecordService>(
          context,
          MEDIA_RECORD_SERVICE,
        );
        const adoptedShotIds = new Set(
          (media?.list("shot-stills", { projectId }) ?? [])
            .filter(
              (item) =>
                item.parentId &&
                shotIds.has(item.parentId) &&
                item.payload["采用状态"] === "已采用",
            )
            .map((item) => item.parentId!),
        );
        const review = optionalService<ReviewRecordService>(
          context,
          REVIEW_RECORD_SERVICE,
        );
        const reviewedEpisodeIds = new Set(
          (["compliance", "review"] as const)
            .flatMap((kind) => review?.list(kind, { projectId }) ?? [])
            .filter((item) => item.parentId && episodeIds.has(item.parentId))
            .map((item) => item.parentId!),
        );
        const contextQuery = new URLSearchParams({ projectId });
        const requiredEpisodes = Math.max(1, selectedEpisodes.length);
        const values = [
          {
            id: "source" as const,
            label: "来源正文",
            current: Math.min(1, writing.list(projectId).length),
            required: 1,
            target: `/projects/${projectId}`,
          },
          {
            id: "script" as const,
            label: "分集剧本",
            current: scripts.length,
            required: requiredEpisodes,
            target: `/adapt?${contextQuery}&stage=scripts`,
          },
          {
            id: "scenes" as const,
            label: "制作场景",
            current: scenes.length,
            required: Math.max(1, scripts.length),
            target: `/adapt?${contextQuery}&stage=scenes`,
          },
          {
            id: "shots" as const,
            label: "分镜",
            current: shots.length,
            required: Math.max(1, scenes.length),
            target: `/adapt?${contextQuery}&stage=shots`,
          },
          {
            id: "assets" as const,
            label: "已采用镜头静帧",
            current: adoptedShotIds.size,
            required: Math.max(1, shots.length),
            target: `/produce?${contextQuery}&stage=storyboard`,
          },
          {
            id: "review" as const,
            label: "分集审核",
            current: reviewedEpisodeIds.size,
            required: requiredEpisodes,
            target: `/review?${contextQuery}&stage=review`,
          },
        ];
        const steps = values.map((step) => ({
          ...step,
          complete: step.current >= step.required,
        }));
        const next = steps.find((step) => !step.complete) ?? steps.at(-1)!;
        const completion =
          steps.reduce(
            (total, step) =>
              total + Math.min(1, step.current / Math.max(1, step.required)),
            0,
          ) / steps.length;
        return requestContext.json({
          projectId,
          scope: {
            kind: requestedIds.length ? "episodes" : "project",
            episodeIds: selectedEpisodes.map((item) => item.id),
          },
          sourceVersion: project.version,
          completion,
          steps,
          blockers: next.complete
            ? []
            : [
                {
                  code: `MISSING_${next.id.toUpperCase()}`,
                  message: `${next.label}尚未覆盖当前范围（${next.current}/${next.required}）。`,
                  target: next.target,
                },
              ],
          nextAction: {
            label: next.complete ? "查看审核交付" : `继续${next.label}`,
            target: next.target,
          },
        });
      },
    ),
    route(
      {
        id: "production:graph",
        pluginId: "production",
        method: "get",
        path: "/api/v2/projects/{id}/production-graph",
        operationId: "production.graph",
      },
      graphDeclaration,
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const project = workspace.get(projectId);
        if (!project)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const chapters = writing.list(projectId);
        const production = productionKinds.flatMap((kind) =>
          records.list(kind, { projectId }),
        );
        const media = optionalService<MediaRecordService>(
          context,
          MEDIA_RECORD_SERVICE,
        );
        const mediaKinds = [
          "assets",
          "visual-assets",
          "shot-stills",
          "audio",
          "video",
          "animatics",
          "renders",
          "rights",
          "image",
        ] as const;
        const mediaRecords = media
          ? mediaKinds.flatMap((kind) => media.list(kind, { projectId }))
          : [];
        const creativeQuality = optionalService<CreativeQualityRecordService>(
          context,
          CREATIVE_QUALITY_SERVICE,
        );
        const qualityRecords =
          creativeQuality?.list("quality", { projectId }) ?? [];
        const review = optionalService<ReviewRecordService>(
          context,
          REVIEW_RECORD_SERVICE,
        );
        const reviewRecords = review
          ? (["compliance", "review"] as const).flatMap((kind) =>
              review.list(kind, { projectId }),
            )
          : [];
        const delivery = optionalService<DeliveryRecordService>(
          context,
          DELIVERY_RECORD_SERVICE,
        );
        const deliveryRecords = delivery
          ? (["localization", "delivery"] as const).flatMap((kind) =>
              delivery.list(kind, { projectId }),
            )
          : [];
        const nodes = [
          {
            id: project.id,
            kind: "project",
            title: project.title,
            status: "项目",
          },
          ...chapters.map((item) => ({
            id: item.id,
            kind: "chapter",
            title: item.title,
            status: "章节",
          })),
          ...production.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: String(
              item.payload["采用状态"] ??
                item.payload["审阅状态"] ??
                item.payload["交付状态"] ??
                "待完善",
            ),
          })),
          ...mediaRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: String(
              item.payload["采用状态"] ?? item.payload["审阅状态"] ?? "待完善",
            ),
          })),
          ...qualityRecords.map((item) => ({
            id: item.id,
            kind: "quality",
            title: String(item.value["title"] ?? "质量检查"),
            status: "待完善",
          })),
          ...reviewRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: String(item.value["title"] ?? "审查资料"),
            status: String(
              item.value["检查状态"] ?? item.value["审片状态"] ?? "待完善",
            ),
          })),
          ...deliveryRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: String(item.value["title"] ?? "交付资料"),
            status: String(
              item.value["采用状态"] ?? item.value["交付状态"] ?? "待完善",
            ),
          })),
        ];
        const ids = new Set(nodes.map((node) => node.id));
        const edges = [
          ...chapters.map((item) => ({
            sourceId: projectId,
            targetId: item.id,
            relation: "包含",
          })),
          ...production.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...mediaRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...qualityRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...reviewRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...deliveryRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
        ];
        const count = (kind: ProductionRecordKind) =>
          production.filter((item) => item.kind === kind).length;
        const assets = mediaRecords.filter((item) =>
          ["assets", "visual-assets"].includes(item.kind),
        );
        const stills = mediaRecords.filter(
          (item) => item.kind === "shot-stills",
        );
        return requestContext.json({
          projectId,
          nodes,
          edges,
          coverage: {
            episodes: count("episodes"),
            scripts: count("scripts"),
            scenes: count("scenes"),
            shots: count("shots"),
            assets: assets.length,
            stills: stills.length,
            adoptedStills: stills.filter(
              (item) => item.payload["采用状态"] === "已采用",
            ).length,
          },
        });
      },
    ),
    route(
      {
        id: "production:impact",
        pluginId: "production",
        method: "post",
        path: "/api/v2/production/impact",
        operationId: "production.impact",
      },
      impactDeclaration,
      async (requestContext) => {
        const parsed = ProductionImpactInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "影响分析参数无效。",
          );
        const source = records.get(parsed.data.sourceId);
        if (!source || source.projectId !== parsed.data.projectId)
          return problem(requestContext, 404, "NOT_FOUND", "未找到制作来源。");
        const all = productionKinds.flatMap((kind) =>
          records.list(kind, { projectId: source.projectId }),
        );
        const affected: ProductionRecord[] = [];
        const pending = [source.id];
        while (pending.length) {
          const parentId = pending.shift()!;
          for (const candidate of all) {
            if (
              candidate.parentId === parentId &&
              !affected.some((item) => item.id === candidate.id)
            ) {
              affected.push(candidate);
              pending.push(candidate.id);
            }
          }
        }
        return requestContext.json({
          sourceId: source.id,
          affected: affected.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: "建议复核",
          })),
          summary: affected.length
            ? `「${source.title}」变更后，建议复核 ${affected.length} 个下游制作条目。`
            : `「${source.title}」当前没有记录到直接下游依赖。`,
        });
      },
    ),
    route(
      {
        id: "production:current-adaptation",
        pluginId: "production",
        method: "post",
        path: "/api/v2/projects/{projectId}/current-adaptation",
        operationId: "production-structure.selectCurrentAdaptation",
      },
      selectDeclaration,
      async (requestContext) => {
        const parsed = z
          .object({ adaptationId: z.string().uuid() })
          .safeParse(await requestContext.req.json());
        const projectId = requestContext.req.param("projectId");
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "改编方案参数无效。",
          );
        const adaptation = records.get(parsed.data.adaptationId);
        if (
          !adaptation ||
          adaptation.kind !== "adaptations" ||
          adaptation.projectId !== projectId
        )
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "改编方案不属于当前项目。",
          );
        const value = workspace.setCurrentAdaptation(projectId, adaptation.id);
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
      },
    ),
  ];

  for (const [kind, parentKind, path, operationId] of [
    [
      "episodes",
      "adaptations",
      "/api/v2/adaptations/{id}/episodes/reorder",
      "production-structure.reorderEpisodes",
    ],
    [
      "scenes",
      "scripts",
      "/api/v2/scripts/{id}/scenes/reorder",
      "production-structure.reorderScenes",
    ],
    [
      "shots",
      "scenes",
      "/api/v2/scenes/{id}/shots/reorder",
      "production-structure.reorderShots",
    ],
  ] as const) {
    const declaration = openapi({
      method: "post",
      path,
      operationId,
      params: idParams,
      body: ProductionReorderInputSchema,
      response: ProductionReorderResultSchema,
    });
    result.push(
      route(
        {
          id: `production:${kind}-reorder`,
          pluginId: "production",
          method: "post",
          path,
          operationId,
        },
        declaration,
        async (requestContext) => {
          const parsed = ProductionReorderInputSchema.safeParse(
            await requestContext.req.json(),
          );
          const parentId = requestContext.req.param("id");
          const parent = records.get(parentId);
          if (!parent || parent.kind !== parentKind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到上级制作条目。",
            );
          if (parent.retirement)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "上级制作条目已退役，不能重新排序历史子条目。",
            );
          if (!parsed.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "排序内容无效。",
            );
          const reordered = context.uow.execute((transaction) => {
            const current = transaction
              .all<ProductionRow>(
                "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? AND retired_result_id IS NULL ORDER BY order_index, created_at",
                kind,
                parentId,
              )
              .map(toRecord);
            if (
              current.length !== parsed.data.items.length ||
              new Set(parsed.data.items.map((item) => item.id)).size !==
                current.length ||
              current.some(
                (item) =>
                  !parsed.data.items.some(
                    (candidate) =>
                      candidate.id === item.id &&
                      candidate.version === item.version,
                  ),
              )
            )
              return undefined;
            const now = new Date().toISOString();
            parsed.data.items.forEach((item, index) =>
              transaction.run(
                "UPDATE production_records SET order_index = ?, version = version + 1, updated_at = ? WHERE id = ? AND parent_id = ? AND kind = ?",
                index,
                now,
                item.id,
                parentId,
                kind,
              ),
            );
            const values = transaction
              .all<ProductionRow>(
                "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? AND retired_result_id IS NULL ORDER BY order_index, created_at",
                kind,
                parentId,
              )
              .map(toRecord);
            transaction.append({
              type: `production.${kind}-reordered.v1`,
              pluginId: "production",
              aggregateType: kind,
              aggregateId: parentId,
              aggregateVersion: Math.max(
                0,
                ...values.map((item) => item.version),
              ),
              payload: JSON.parse(
                JSON.stringify({ parentId, records: values }),
              ),
            });
            return values;
          });
          return reordered
            ? requestContext.json({ records: reordered })
            : problem(
                requestContext,
                409,
                "CONFLICT",
                "制作顺序已变化，请刷新后重试。",
              );
        },
      ),
    );
  }
  return result;
}

const productionMigrations = [
  {
    id: "production.0001.records",
    pluginId: "production",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS production_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('adaptations', 'episodes', 'scripts', 'scenes', 'shots')),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES production_records(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        order_index INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS production_records_project_kind
        ON production_records(project_id, kind, order_index, id);
      CREATE INDEX IF NOT EXISTS production_records_parent_kind
        ON production_records(parent_id, kind, order_index, id);
    `,
  },
  {
    id: "production.0002.seasons",
    pluginId: "production",
    version: "3.0.0-alpha.3",
    dependsOn: ["production.0001.records", "workspace.0005.project-modes"],
    sql: `
      CREATE TABLE IF NOT EXISTS production_seasons (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        adaptation_id TEXT REFERENCES production_records(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        outline TEXT NOT NULL DEFAULT '',
        source_chapter_version TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'ready', 'review_required', 'archived')),
        order_index INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS production_seasons_project_order
        ON production_seasons(project_id, order_index, id);
      CREATE TABLE IF NOT EXISTS production_season_chapter_mappings (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL REFERENCES production_seasons(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(season_id, chapter_id)
      );
      CREATE INDEX IF NOT EXISTS production_season_chapter_mappings_chapter
        ON production_season_chapter_mappings(chapter_id, season_id);
      INSERT OR IGNORE INTO production_seasons(
        id, project_id, adaptation_id, title, outline, status, order_index,
        version, created_at, updated_at
      )
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6))),
        r.project_id,
        r.id,
        '第1季', '', 'ready', 0, 0, r.created_at, r.updated_at
      FROM production_records r
      WHERE r.kind = 'adaptations'
        AND NOT EXISTS (
          SELECT 1 FROM production_records earlier
          WHERE earlier.project_id = r.project_id AND earlier.kind = 'adaptations'
            AND (earlier.order_index < r.order_index OR (earlier.order_index = r.order_index AND earlier.id < r.id))
        )
        AND NOT EXISTS (
          SELECT 1 FROM production_seasons s WHERE s.project_id = r.project_id
        );
    `,
  },
  {
    id: "production.0003.screenplay-ast-and-script-branches",
    pluginId: "production",
    version: "3.0.0-alpha.4",
    dependsOn: ["production.0002.seasons"],
    sql: `
      CREATE TABLE IF NOT EXISTS screenplay_documents (
        id TEXT PRIMARY KEY,
        script_record_id TEXT NOT NULL UNIQUE
          REFERENCES production_records(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source_format TEXT NOT NULL
          CHECK(source_format IN ('native','fountain','fdx','pdf')),
        blocks_json TEXT NOT NULL,
        loss_report_json TEXT NOT NULL,
        legacy_payload_json TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS screenplay_documents_project
        ON screenplay_documents(project_id, updated_at DESC, id);

      CREATE TABLE IF NOT EXISTS screenplay_import_previews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES production_records(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_format TEXT NOT NULL CHECK(source_format IN ('fountain','fdx','pdf')),
        blocks_json TEXT NOT NULL,
        loss_report_json TEXT NOT NULL,
        etag TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','committed','discarded')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS script_branches (
        id TEXT PRIMARY KEY,
        script_record_id TEXT NOT NULL REFERENCES production_records(id) ON DELETE CASCADE,
        owner_ref TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','archived')),
        base_main_version INTEGER NOT NULL,
        head_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS script_branches_script_owner
        ON script_branches(script_record_id, owner_ref, status, created_at);

      CREATE TABLE IF NOT EXISTS script_branch_versions (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES script_branches(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        blocks_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(branch_id, version)
      );

      CREATE TABLE IF NOT EXISTS script_merge_previews (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES script_branches(id) ON DELETE CASCADE,
        base_main_version INTEGER NOT NULL,
        current_main_version INTEGER NOT NULL,
        branch_version INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','committed','expired')),
        etag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      );

      INSERT OR IGNORE INTO screenplay_documents(
        id, script_record_id, project_id, title, source_format, blocks_json,
        loss_report_json, legacy_payload_json, version, created_at, updated_at
      )
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
        '4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
        record.id, record.project_id, record.title, 'native',
        json_array(json_object(
          'id', lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
            '4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) ||
            substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
          'type', 'action',
          'text', coalesce(
            json_extract(record.payload_json, '$.content'),
            json_extract(record.payload_json, '$.正文'),
            record.title
          )
        )),
        json_object(
          'unsupported', json_array('legacy_unstructured_payload'),
          'warnings', json_array('旧通用剧本记录已映射为单个 Action block；原 payload 保留只读备份。'),
          'preserved', json_array('legacy_payload_backup')
        ),
        record.payload_json, 0, record.created_at, record.updated_at
      FROM production_records record
      WHERE record.kind = 'scripts';
    `,
  },
] as const;

export function createProductionPlugin(host?: DesktopHostClient) {
  return definePlugin({
    inject: [
      WORKSPACE_PROJECT_SERVICE.id,
      WORKSPACE_AUTHOR_INTENT_SERVICE.id,
      WRITING_CHAPTER_SERVICE.id,
      WRITING_RESOURCE_SERVICE.id,
      AGENT_CONTEXT_SERVICE.id,
      CREATION_WORKFLOW_SERVICE.id,
      CREATION_KNOWLEDGE_SERVICE.id,
    ],
    descriptor: {
      id: "production",
      version: "3.0.0-alpha.4",
      apiVersion: "2",
      requires: [
        "foundation",
        "workspace",
        "automation",
        "writing",
        "knowledge",
      ],
      provides: [
        "production.records",
        "production.screenplay-sources",
        "production.quality-sources",
      ],
      stability: "internal",
    },
    ui: [
      {
        id: "production.panel.adaptation-strategy",
        pluginId: "production",
        kind: "panel",
        metadata: {
          slot: "project.tools",
          title: "独立改编策略",
          toolKey: "adaptation-strategy",
        },
      },
      {
        id: "production.panel.episode-development",
        pluginId: "production",
        kind: "panel",
        metadata: {
          slot: "project.tools",
          title: "单集开发",
          toolKey: "episode-development",
        },
      },
      {
        id: "production.panel.season-plan",
        pluginId: "production",
        kind: "panel",
        metadata: {
          slot: "project.tools",
          title: "整季方案",
          toolKey: "season-plan",
        },
      },
      {
        id: "production.route.workspace",
        pluginId: "production",
        kind: "route",
        metadata: { path: "/adapt", title: "改编" },
      },
      {
        id: "production.navigation.workspace",
        pluginId: "production",
        kind: "navigation",
        metadata: { section: "main", order: 30, label: "改编", to: "/adapt" },
      },
      {
        id: "production.editor.script",
        pluginId: "production",
        kind: "editor",
        metadata: { target: "script", title: "剧本编辑器" },
      },
      {
        id: "production.panel.diagnosis",
        pluginId: "production",
        kind: "panel",
        metadata: {
          slot: "project.tools",
          title: "改编诊断",
          toolKey: "adaptation-diagnosis",
        },
      },
    ],
    migrations: [
      ...productionMigrations,
      productionCreationMigration,
      diagnosisMigration,
      seasonPlanMigration,
      episodeDevelopmentMigration,
      screenplayImportReceiptMigration,
      screenplayIntakeMigration,
      episodeScriptRevisionMigration,
      adaptationStrategyMigration,
      storyboardRecordRetirementMigration,
      productionImportBatchMigration,
      productionProjectPurgeRequestMigration,
      episodeTopologyRevisionMigration,
      storyboardTopologyRetirementMigration,
      storyboardAttributionMigration,
      episodeSourceRevisionMigration,
    ],
    apply: (context) => {
      registerProductionProjectLineage(context);
      registerScreenplaySources(context);
      registerProductionQualitySources(context);
      registerProductionCreation(context);
      registerAuthorIntentSources(context);
      registerDiagnosis(context);
      registerAdaptationStrategies(context);
      registerSeasonPlans(context);
      registerEpisodeDevelopment(context);
      registerScreenplayIntakes(context, host);
      const workspace = optionalService<WorkspaceProjectService>(
        context,
        WORKSPACE_PROJECT_SERVICE,
      );
      const writing = optionalService<WritingChapterService>(
        context,
        WRITING_CHAPTER_SERVICE,
      );
      if (!workspace || !writing)
        throw new Error("production requires workspace and writing services");
      const service: ProductionRecordService = {
        importBatch: productionImportBatch(
          context,
          (tx, kind, input) => createRecord(context, kind, input, tx),
          (id) => !!workspace.get(id),
        ),
        create: (kind, input) => createRecord(context, kind, input),
        list: (kind, filter) => listRecords(context, kind, filter),
        get: (id) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<ProductionRow>(
              "SELECT * FROM production_records WHERE id = ?",
              id,
            );
            return row ? toRecord(row) : undefined;
          }),
        update: (id, patch) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<ProductionRow>(
              "SELECT * FROM production_records WHERE id = ?",
              id,
            );
            if (!row) return undefined;
            if (row.retired_result_id) return "conflict" as const;
            if (row.version !== patch.version) return "conflict" as const;
            transaction.run(
              `UPDATE production_records SET title = ?, payload_json = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
              patch.title?.trim() ?? row.title,
              JSON.stringify(patch.payload ?? JSON.parse(row.payload_json)),
              new Date().toISOString(),
              id,
              row.version,
            );
            const value = toRecord(
              transaction.get<ProductionRow>(
                "SELECT * FROM production_records WHERE id = ?",
                id,
              )!,
            );
            syncScriptDocument(transaction, value);
            appendEvent(transaction, `${row.kind}-updated`, value);
            return value;
          }),
        remove: (id, expectedVersion) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<ProductionRow>(
              "SELECT * FROM production_records WHERE id = ?",
              id,
            );
            if (
              !row ||
              row.retired_result_id ||
              (expectedVersion !== undefined && row.version !== expectedVersion)
            )
              return false;
            const value = toRecord(row);
            const retiredDescendant = transaction.get<{ id: string }>(
              "WITH RECURSIVE descendants(id) AS (SELECT id FROM production_records WHERE parent_id = ? UNION ALL SELECT child.id FROM production_records child JOIN descendants parent ON child.parent_id = parent.id) SELECT record.id FROM production_records record JOIN descendants ON descendants.id = record.id WHERE record.retired_result_id IS NOT NULL LIMIT 1",
              id,
            );
            if (retiredDescendant) return false;
            transaction.run("DELETE FROM production_records WHERE id = ?", id);
            transaction.append({
              type: `production.${row.kind}-removed.v1`,
              pluginId: "production",
              aggregateType: row.kind,
              aggregateId: id,
              aggregateVersion: row.version,
              payload: JSON.parse(JSON.stringify(value)),
            });
            return true;
          }),
      };
      const seasonService: ProductionSeasonService = {
        create: (input) => createSeason(context, input),
        get: (id) =>
          context.uow.execute((transaction) => {
            const row = transaction.get<SeasonRow>(
              "SELECT * FROM production_seasons WHERE id = ?",
              id,
            );
            return row ? season(row) : undefined;
          }),
        list: (projectId, options) => listSeasons(context, projectId, options),
        update: (id, patch) => updateSeason(context, id, patch),
        mapChapter: (input) => mapSeasonChapter(context, input),
      };
      context.effect(
        () => provideService(context, PRODUCTION_RECORD_SERVICE, service),
        `service:${PRODUCTION_RECORD_SERVICE}`,
      );
      context.effect(
        () => provideService(context, PRODUCTION_SEASON_SERVICE, seasonService),
        `service:${PRODUCTION_SEASON_SERVICE}`,
      );
      context.effect(
        () =>
          context.domainEvents.registerConsumer({
            id: "production:season-chapter-staleness.v1",
            pluginId: "production",
            critical: false,
            eventTypes: [
              "writing.chapter-updated.v1",
              "writing.chapter-content-replaced.v1",
              "writing.chapter-summary-updated.v1",
            ],
            handle: (event) => {
              const now = new Date().toISOString();
              context.uow.execute((transaction) => {
                const affected = transaction.all<SeasonRow>(
                  `SELECT s.* FROM production_seasons s
               JOIN production_season_chapter_mappings m ON m.season_id = s.id
               WHERE m.chapter_id = ? AND m.chapter_version <> ?
                 AND s.status <> 'archived'`,
                  event.aggregateId,
                  event.aggregateVersion,
                );
                for (const current of affected) {
                  transaction.run(
                    `UPDATE production_seasons
                 SET status = 'review_required', version = version + 1, updated_at = ?
                 WHERE id = ?`,
                    now,
                    current.id,
                  );
                  transaction.append({
                    type: "production.season-review-required.v1",
                    pluginId: "production",
                    aggregateType: "season",
                    aggregateId: current.id,
                    aggregateVersion: current.version + 1,
                    payload: {
                      seasonId: current.id,
                      sourceChapterId: event.aggregateId,
                      sourceChapterVersion: event.aggregateVersion,
                      reason: "来源章节已更新，需要重新核对季纲与分集。",
                    },
                  });
                }
              });
            },
          }),
        "event:season-chapter-staleness",
      );
      for (const contribution of productionRoutes(
        context,
        workspace,
        writing,
        service,
        seasonService,
        host,
      ))
        context.effect(
          () => context.http.register(contribution),
          `route:${contribution.id}`,
        );
    },
  });
}

export const productionPlugin = createProductionPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "production-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createProductionPlugin(
        ctx.pluginEnvironment.host as Parameters<
          typeof createProductionPlugin
        >[0],
      ),
      config,
    );
  },
};
