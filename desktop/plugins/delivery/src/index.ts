import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import {
  registerDeliveryCreation,
  deliveryCreationMigration,
} from "./creation.js";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  DELIVERY_RECORD_SERVICE,
  DeliveryRecordInputSchema,
  DeliveryRecordPatchSchema,
  type DeliveryRecord,
  type DeliveryRecordKind,
  type DeliveryRecordService,
} from "@dramaip/contracts/delivery";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  manuscriptMigration,
  manuscriptRoutes,
  type ManuscriptHost,
} from "./manuscript.js";
import { pilotMigration, pilotRoutes } from "./pilot.js";
import {
  platformMetadataMigration,
  platformMetadataRoutes,
} from "./platform-metadata.js";
import { TIMELINE_SERVICE } from "@dramaip/contracts/timeline";
import {
  MEDIA_RECORD_SERVICE,
  MEDIA_LIKENESS_SERVICE,
} from "@dramaip/contracts/media";

interface Row {
  id: string;
  kind: DeliveryRecordKind;
  project_id: string;
  parent_id: string | null;
  value_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;
const idParams = z.object({ id: z.string().uuid() });
const idFormatParams = z.object({
  id: z.string().uuid(),
  format: z.string().min(1),
});

const deliveryProfiles = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    version: "2026.08",
    title: "通用竖屏短剧交付",
    platform: "通用平台",
    region: "中国大陆",
    sourceUrl: "dramaip://profiles/general-vertical-drama",
    sourceStatus: "internal_master",
    checkedAt: "2026-08-11T00:00:00.000Z",
    filenamePrefix: "dramaip",
    video: {
      width: 1080,
      height: 1920,
      videoCodec: "H.264",
      audioCodec: "AAC",
    },
    duration: {
      status: "manual",
      note: "发行前按目标平台最新要求人工确认时长。",
    },
    subtitleSafeZone: {
      bottomMarginPx: 240,
      note: "保留移动端交互区与字幕安全边距。",
    },
    requiredListingFields: ["标题", "简介", "标签"],
    manualFields: ["平台版权声明", "发行地区"],
  },
] as const;

function toRecord(row: Row): DeliveryRecord {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    value: JSON.parse(row.value_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function wire(record: DeliveryRecord): Record<string, unknown> {
  return {
    ...record.value,
    id: record.id,
    projectId: record.projectId,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function append(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: DeliveryRecord,
): void {
  transaction.append({
    type: `delivery.${action}.v1`,
    pluginId: "delivery",
    aggregateType: value.kind,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function makeService(context: PluginContext): DeliveryRecordService {
  return {
    create(kind, input) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      return context.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO delivery_records(
            id, kind, project_id, parent_id, value_json, version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          kind,
          input.projectId,
          input.parentId ?? null,
          JSON.stringify(input.value),
          now,
          now,
        );
        const value = toRecord(
          transaction.get<Row>(
            "SELECT * FROM delivery_records WHERE id = ?",
            id,
          )!,
        );
        append(transaction, `${kind}-created`, value);
        return value;
      });
    },
    list(kind, filter) {
      return context.uow.execute((transaction) => {
        const clauses = ["kind = ?"];
        const values: unknown[] = [kind];
        if (filter.projectId) {
          clauses.push("project_id = ?");
          values.push(filter.projectId);
        }
        if (filter.parentId) {
          clauses.push("parent_id = ?");
          values.push(filter.parentId);
        }
        return transaction
          .all<Row>(
            `SELECT * FROM delivery_records WHERE ${clauses.join(" AND ")} ORDER BY created_at, id`,
            ...values,
          )
          .map(toRecord);
      });
    },
    get(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM delivery_records WHERE id = ?",
          id,
        );
        return row ? toRecord(row) : undefined;
      });
    },
    update(id, patch) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM delivery_records WHERE id = ?",
          id,
        );
        if (!row) return undefined;
        transaction.run(
          "UPDATE delivery_records SET value_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
          JSON.stringify({
            ...(JSON.parse(row.value_json) as Record<string, unknown>),
            ...patch,
          }),
          new Date().toISOString(),
          id,
        );
        const value = toRecord(
          transaction.get<Row>(
            "SELECT * FROM delivery_records WHERE id = ?",
            id,
          )!,
        );
        append(transaction, `${value.kind}-updated`, value);
        return value;
      });
    },
    remove(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM delivery_records WHERE id = ?",
          id,
        );
        if (!row) return false;
        const value = toRecord(row);
        transaction.run("DELETE FROM delivery_records WHERE id = ?", id);
        append(transaction, `${value.kind}-removed`, value);
        return true;
      });
    },
  };
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
  body?: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["delivery"],
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
      [status]: {
        description: "Success",
        ...(status === 204
          ? {}
          : { content: { "application/json": { schema: z.unknown() } } }),
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

function contribution(
  method: "delete" | "get" | "patch" | "post",
  path: string,
  operationId: string,
  handler: Handler,
  options: { params?: ZodType; body?: ZodType; status?: 200 | 201 | 204 } = {},
): RouteContribution {
  return defineRouteContribution({
    id: `delivery:${operationId}`,
    pluginId: "delivery",
    method,
    path: path as `/api/v2/${string}`,
    operationId,
    declaration: openapi({ method, path, operationId, ...options }),
    handler,
  });
}

function exportDocument(fileName: string, value: unknown) {
  return {
    fileName,
    mimeType: "application/json; charset=utf-8",
    content: JSON.stringify(value, null, 2),
  };
}

function deliveryRoutes(records: DeliveryRecordService): RouteContribution[] {
  const routes: RouteContribution[] = [];
  const add = (...args: Parameters<typeof contribution>) =>
    routes.push(contribution(...args));

  add(
    "post",
    "/api/v2/localization/{id}/adopt",
    "localization.adopt",
    (context) => {
      const value = records.get(context.req.param("id"));
      if (!value || value.kind !== "localization")
        return problem(context, 404, "NOT_FOUND", "未找到本地化版本。");
      return context.json(
        wire(records.update(value.id, { 采用状态: "已采用" })!),
      );
    },
    { params: idParams },
  );
  add(
    "get",
    "/api/v2/localization/{id}/subtitles/{format}",
    "localization.subtitles",
    (context) => {
      const value = records.get(context.req.param("id"));
      const format = context.req.param("format");
      if (!value || value.kind !== "localization")
        return problem(context, 404, "NOT_FOUND", "未找到本地化版本。");
      if (!["srt", "vtt", "txt"].includes(format))
        return problem(context, 400, "VALIDATION_ERROR", "字幕格式无效。");
      const text = String(
        value.value["字幕与译文"] ?? value.value["content"] ?? "",
      );
      if (format === "txt")
        return context.json({
          fileName: `${String(value.value["title"] ?? "subtitle")}.draft.txt`,
          mimeType: "text/plain",
          content: `待对齐译文草稿（不含经过验证的时间信息）\n\n${text}\n`,
        });
      if (value.value["timingStatus"] === "unaligned")
        return problem(
          context,
          409,
          "TIMING_REQUIRED",
          "译文草稿已保存，尚无可靠时间信息。请先对齐音轨，或导出译文草稿 TXT。",
        );
      const sections = text
        .replace(/^WEBVTT[^\n]*\n+/u, "")
        .trim()
        .split(/\r?\n\s*\r?\n/u);
      const cues = sections.map((section) =>
        section.match(
          /^(?:\d+\r?\n)?(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})\r?\n([\s\S]+)$/u,
        ),
      );
      const seconds = (time: string) => {
        const parts = time.replace(",", ".").split(":").map(Number);
        return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
      };
      if (
        !cues.length ||
        cues.some((cue) => !cue || seconds(cue[2]!) <= seconds(cue[1]!))
      )
        return problem(
          context,
          409,
          "TIMING_REQUIRED",
          "没有可用的字幕时间段。请导入已对齐字幕，或先导出译文草稿 TXT。",
        );
      const content =
        (format === "vtt" ? "WEBVTT\n\n" : "") +
        cues
          .map(
            (cue, index) =>
              `${format === "srt" ? `${index + 1}\n` : ""}${cue![1]!.replace(/[,.]/u, format === "srt" ? "," : ".")} --> ${cue![2]!.replace(/[,.]/u, format === "srt" ? "," : ".")}\n${cue![3]}\n`,
          )
          .join("\n");
      return context.json({
        fileName: `${String(value.value["title"] ?? "subtitle")}.${format}`,
        mimeType: format === "vtt" ? "text/vtt" : "application/x-subrip",
        content,
      });
    },
    { params: idFormatParams },
  );
  add(
    "get",
    "/api/v2/delivery/{id}/export",
    "delivery.export",
    (context) => {
      const value = records.get(context.req.param("id"));
      return value?.kind === "delivery"
        ? context.json(exportDocument(`delivery-${value.id}.json`, wire(value)))
        : problem(context, 404, "NOT_FOUND", "未找到交付记录。");
    },
    { params: idParams },
  );

  for (const kind of ["localization", "delivery"] as const) {
    const path = `/api/v2/${kind}`;
    const itemPath = `/api/v2/${kind}/{id}`;
    add("get", path, `${kind}.records.list`, (context) => {
      const projectId = context.req.query("projectId");
      const parentId = context.req.query("parentId");
      if (!projectId && !parentId)
        return problem(
          context,
          400,
          "VALIDATION_ERROR",
          "缺少项目或上级标识。",
        );
      return context.json(
        records.list(kind, { projectId, parentId }).map(wire),
      );
    });
    add(
      "post",
      path,
      `${kind}.records.create`,
      async (context) => {
        const parsed = DeliveryRecordInputSchema.safeParse(
          await context.req.json(),
        );
        if (!parsed.success)
          return problem(context, 400, "VALIDATION_ERROR", "交付资料无效。");
        return context.json(
          wire(
            records.create(kind, {
              projectId: parsed.data.projectId,
              parentId: parsed.data.parentId,
              value: { title: parsed.data.title, ...parsed.data.payload },
            }),
          ),
          201,
        );
      },
      { body: DeliveryRecordInputSchema, status: 201 },
    );
    add(
      "get",
      itemPath,
      `${kind}.records.get`,
      (context) => {
        const value = records.get(context.req.param("id"));
        return value?.kind === kind
          ? context.json(wire(value))
          : problem(context, 404, "NOT_FOUND", "未找到交付资料。");
      },
      { params: idParams },
    );
    add(
      "patch",
      itemPath,
      `${kind}.records.update`,
      async (context) => {
        const parsed = DeliveryRecordPatchSchema.safeParse(
          await context.req.json(),
        );
        const current = records.get(context.req.param("id"));
        if (!parsed.success)
          return problem(
            context,
            400,
            "VALIDATION_ERROR",
            "交付资料更新无效。",
          );
        if (!current || current.kind !== kind)
          return problem(context, 404, "NOT_FOUND", "未找到交付资料。");
        if (current.version !== parsed.data.version)
          return problem(
            context,
            409,
            "CONFLICT",
            "交付资料已更新，请刷新后重试。",
          );
        return context.json(
          wire(
            records.update(current.id, {
              ...(parsed.data.title ? { title: parsed.data.title } : {}),
              ...parsed.data.payload,
            })!,
          ),
        );
      },
      { params: idParams, body: DeliveryRecordPatchSchema },
    );
    add(
      "delete",
      itemPath,
      `${kind}.records.remove`,
      (context) =>
        records.remove(context.req.param("id"))
          ? context.body(null, 204)
          : problem(context, 404, "NOT_FOUND", "未找到交付资料。"),
      { params: idParams, status: 204 },
    );
  }
  return routes;
}

export function createDeliveryPlugin(host?: ManuscriptHost) {
  return definePlugin({
    inject: [
      PRODUCTION_RECORD_SERVICE.id,
      WORKSPACE_PROJECT_SERVICE.id,
      WRITING_CHAPTER_SERVICE.id,
      PRODUCTION_EPISODE_DEVELOPMENT_SERVICE.id,
      PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE.id,
      TIMELINE_SERVICE.id,
      MEDIA_RECORD_SERVICE.id,
      MEDIA_LIKENESS_SERVICE.id,
    ],
    descriptor: {
      id: "delivery",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: [
        "foundation",
        "workspace",
        "writing",
        "production",
        "media",
        "timeline",
        "review",
      ],
      provides: ["delivery.records", "delivery.platform-profiles"],
      stability: "internal",
    },
    ui: [
      {
        id: "delivery.panel.platform",
        pluginId: "delivery",
        kind: "panel",
        metadata: { slot: "review.delivery", title: "平台交付" },
      },
      {
        id: "delivery.command.export",
        pluginId: "delivery",
        kind: "command",
        metadata: { title: "导出交付包", command: "delivery.export" },
      },
    ],
    migrations: [
      deliveryCreationMigration,
      manuscriptMigration,
      pilotMigration,
      platformMetadataMigration,
      {
        id: "delivery.0001.records",
        pluginId: "delivery",
        version: "3.0.0-alpha.3",
        dependsOn: ["review.0002.owned-records"],
        sql: `
        CREATE TABLE IF NOT EXISTS delivery_records (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('localization', 'delivery', 'delivery-variant', 'platform-archive')),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          parent_id TEXT,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS delivery_records_kind_project
          ON delivery_records(kind, project_id, created_at, id);
        CREATE INDEX IF NOT EXISTS delivery_records_kind_parent
          ON delivery_records(kind, parent_id, created_at, id);
      `,
      },
    ],
    apply: (context) => {
      registerDeliveryCreation(context);
      const production = optionalService<ProductionRecordService>(
        context,
        PRODUCTION_RECORD_SERVICE,
      );
      if (!production) throw new Error("delivery requires production service");
      const workspace = optionalService<WorkspaceProjectService>(
        context,
        WORKSPACE_PROJECT_SERVICE,
      );
      const writing = optionalService<WritingChapterService>(
        context,
        WRITING_CHAPTER_SERVICE,
      );
      if (!workspace || !writing)
        throw new Error("delivery requires workspace and writing services");
      const records = makeService(context);
      context.effect(
        () => provideService(context, DELIVERY_RECORD_SERVICE, records),
        `service:${DELIVERY_RECORD_SERVICE}`,
      );
      for (const route of [
        ...deliveryRoutes(records),
        ...platformMetadataRoutes(
          context,
          records,
          production,
          workspace,
          optionalService(context, MEDIA_RECORD_SERVICE)!,
          deliveryProfiles,
        ),
        ...manuscriptRoutes(context, workspace, writing, host),
        ...pilotRoutes(context, host),
      ])
        context.effect(() => context.http.register(route), `route:${route.id}`);
    },
  });
}

export const deliveryPlugin = createDeliveryPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "delivery-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createDeliveryPlugin(
        ctx.pluginEnvironment.host as ManuscriptHost | undefined,
      ),
      config,
    );
  },
};
