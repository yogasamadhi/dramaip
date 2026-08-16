import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { Service, type Context, type Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  installRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { problemDetailsSchema } from "@dramaip/contracts";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import {
  defineDramaPlugin,
  type CanonicalTimelineReference,
  type TimelinePreflightResult,
  type TimelineReadService,
  type RouteContribution,
} from "@dramaip/plugin-api";

const clipSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  track: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  offsetMs: z.number().int().nonnegative(),
});
const timelineData = z.object({
  durationMs: z.number().int().nonnegative(),
  frameRate: z.number().positive(),
  clips: z.array(clipSchema),
  canonical: z.boolean().default(false),
  locked: z.boolean().default(false),
});
const commandData = z.object({
  timelineId: z.uuid(),
  type: z.enum(["insert", "move", "trim", "remove", "split"]),
  payload: z.record(z.string(), z.unknown()),
  inverse: z.record(z.string(), z.unknown()),
});
const historyData = z.object({
  timelineId: z.uuid(),
  undoCommandIds: z.array(z.uuid()),
  redoCommandIds: z.array(z.uuid()),
});
const previewData = z.object({
  timelineId: z.uuid(),
  quality: z.enum(["draft", "full"]),
  outputAssetId: z.uuid().optional(),
});
const exportData = z.object({
  timelineId: z.uuid(),
  format: z.string(),
  preset: z.string(),
  outputAssetId: z.uuid().optional(),
});

export const timelineResources = [
  { kind: "timeline", path: "timelines", data: timelineData },
  { kind: "command", path: "commands", data: commandData },
  { kind: "history", path: "histories", data: historyData },
  {
    kind: "preview",
    path: "previews",
    data: previewData,
    createRequiresIdempotency: true,
  },
  {
    kind: "export",
    path: "exports",
    data: exportData,
    createRequiresIdempotency: true,
  },
] satisfies readonly NodeResourceDefinition<any>[];

interface TimelineRow {
  id: string;
  project_id: string;
  title: string;
  data_json: string;
  version: number;
  updated_at: string;
}

class TimelineReadServiceImpl extends Service implements TimelineReadService {
  static provide = "timelineRead";

  constructor(
    ctx: Context,
    private readonly read: Context["uow"],
  ) {
    super(ctx, "timelineRead");
  }

  private row(id: string): TimelineRow | undefined {
    return this.read.execute((tx) =>
      tx.get<TimelineRow>(
        "SELECT id, project_id, title, data_json, version, updated_at FROM timeline_timeline WHERE id = ?",
        id,
      ),
    );
  }

  canonical(projectId: string): CanonicalTimelineReference | undefined {
    const rows = this.read.execute((tx) =>
      tx.all<TimelineRow>(
        "SELECT id, project_id, title, data_json, version, updated_at FROM timeline_timeline WHERE project_id = ? ORDER BY updated_at DESC",
        projectId,
      ),
    );
    const selected =
      rows.find(
        (row) => timelineData.parse(JSON.parse(row.data_json)).canonical,
      ) ?? rows[0];
    if (!selected) return undefined;
    const data = timelineData.parse(JSON.parse(selected.data_json));
    return {
      id: selected.id,
      projectId: selected.project_id,
      title: selected.title,
      durationMs: data.durationMs,
      version: selected.version,
      locked: data.locked,
      updatedAt: selected.updated_at,
    };
  }

  preflight(timelineId: string): TimelinePreflightResult {
    const row = this.row(timelineId);
    if (!row) throw new ApiProblem(404, "TIMELINE_NOT_FOUND", "时间线不存在");
    const data = timelineData.parse(JSON.parse(row.data_json));
    const assetIds = [...new Set(data.clips.map((clip) => clip.assetId))];
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const assetId of assetIds) {
      try {
        this.ctx.mediaRead.assertUsable(assetId);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (!data.clips.length) warnings.push("时间线尚未包含片段");
    if (data.durationMs <= 0) errors.push("时间线时长必须大于零");
    return { ready: errors.length === 0, errors, warnings, assetIds };
  }

  deliveryManifest(timelineId: string) {
    const row = this.row(timelineId);
    if (!row) throw new ApiProblem(404, "TIMELINE_NOT_FOUND", "时间线不存在");
    const data = timelineData.parse(JSON.parse(row.data_json));
    const preflight = this.preflight(timelineId);
    return {
      timelineId,
      projectId: row.project_id,
      version: row.version,
      durationMs: data.durationMs,
      frameRate: data.frameRate,
      clipCount: data.clips.length,
      assetIds: [...preflight.assetIds],
      ready: preflight.ready,
    };
  }
}

const timelineServer: Plugin = {
  name: "dramaip-timeline",
  provide: "timelineRead",
  inject: ["http", "uow", "productionRead", "mediaRead", "fileCapabilities"],
  apply(ctx) {
    installRelationalPluginServer(ctx, {
      pluginId: "timeline",
      routeBase: "/api/v2/timeline",
      resources: timelineResources,
    });
    new TimelineReadServiceImpl(ctx, ctx.uow);
    installTimelineActions(ctx);
  },
};

function timelineVersion(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  return Number(/^"v(\d+)"$/.exec(value)?.[1] ?? Number.NaN);
}

function renderTimelineExport(
  format: "fcpxml" | "otio" | "edl" | "srt",
  title: string,
  data: z.infer<typeof timelineData>,
): string {
  if (format === "otio")
    return JSON.stringify(
      {
        OTIO_SCHEMA: "Timeline.1",
        name: title,
        global_start_time: null,
        tracks: { OTIO_SCHEMA: "Stack.1", children: data.clips },
      },
      null,
      2,
    );
  if (format === "edl")
    return [
      `TITLE: ${title}`,
      "FCM: NON-DROP FRAME",
      ...data.clips.map(
        (clip, index) =>
          `${String(index + 1).padStart(3, "0")}  AX V C ${clip.startMs} ${clip.startMs + clip.durationMs}`,
      ),
    ].join("\n");
  if (format === "srt")
    return data.clips
      .map(
        (clip, index) =>
          `${index + 1}\n${clip.startMs} --> ${clip.startMs + clip.durationMs}\n${clip.id}`,
      )
      .join("\n\n");
  return `<?xml version="1.0" encoding="UTF-8"?><fcpxml version="1.10"><resources/><library><event name="DramaIP"><project name="${title.replaceAll('"', "&quot;")}"><sequence duration="${data.durationMs}/1000s" format="r1"><spine>${data.clips.map((clip) => `<asset-clip name="${clip.id}" offset="${clip.startMs}/1000s" duration="${clip.durationMs}/1000s"/>`).join("")}</spine></sequence></project></event></library></fcpxml>`;
}

function mutateTimeline(
  data: z.infer<typeof timelineData>,
  type: z.infer<typeof commandData>["type"],
  payload: Record<string, unknown>,
) {
  const clips = data.clips.map((clip) => ({ ...clip }));
  if (type === "insert") clips.push(clipSchema.parse(payload.clip));
  else {
    const id = z.uuid().parse(payload.id);
    const index = clips.findIndex((clip) => clip.id === id);
    if (index < 0)
      throw new ApiProblem(404, "TIMELINE_CLIP_NOT_FOUND", "时间线片段不存在");
    const current = clips[index]!;
    if (type === "remove") clips.splice(index, 1);
    if (type === "move")
      clips[index] = {
        ...current,
        startMs: z.number().int().nonnegative().parse(payload.startMs),
        track: z.number().int().nonnegative().parse(payload.track),
      };
    if (type === "trim")
      clips[index] = {
        ...current,
        durationMs: z.number().int().positive().parse(payload.durationMs),
        offsetMs:
          payload.offsetMs === undefined
            ? current.offsetMs
            : z.number().int().nonnegative().parse(payload.offsetMs),
      };
    if (type === "split") {
      const atMs = z.number().int().positive().parse(payload.atMs);
      if (atMs >= current.durationMs)
        throw new ApiProblem(
          409,
          "INVALID_TIMELINE_SPLIT",
          "切分点必须位于片段内部",
        );
      clips[index] = { ...current, durationMs: atMs };
      clips.splice(index + 1, 0, {
        ...current,
        id: randomUUID(),
        startMs: current.startMs + atMs,
        offsetMs: current.offsetMs + atMs,
        durationMs: current.durationMs - atMs,
      });
    }
  }
  return timelineData.parse({
    ...data,
    clips,
    durationMs: clips.reduce(
      (maximum, clip) => Math.max(maximum, clip.startMs + clip.durationMs),
      0,
    ),
  });
}

function installTimelineActions(ctx: Context): void {
  const errors = {
    400: {
      content: { "application/problem+json": { schema: problemDetailsSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/problem+json": { schema: problemDetailsSchema } },
      description: "Not found",
    },
    409: {
      content: { "application/problem+json": { schema: problemDetailsSchema } },
      description: "Conflict",
    },
    412: {
      content: { "application/problem+json": { schema: problemDetailsSchema } },
      description: "Version conflict",
    },
    428: {
      content: { "application/problem+json": { schema: problemDetailsSchema } },
      description: "If-Match required",
    },
  } as const;
  const contribution: RouteContribution = {
    id: "timeline.actions.http.v2",
    pluginId: "timeline",
    install(app) {
      const command = createRoute({
        method: "post",
        path: "/api/v2/timeline/timelines/{id}/actions/apply-command",
        request: {
          params: z.object({ id: z.uuid() }),
          body: {
            content: {
              "application/json": {
                schema: z.object({
                  type: commandData.shape.type,
                  payload: z.record(z.string(), z.unknown()),
                }),
              },
            },
          },
        },
        responses: {
          200: { description: "Timeline command applied" },
          ...errors,
        },
      });
      app.openapi(
        command as never,
        (async (context: any) => {
          const id = context.req.valid("param").id;
          const input = context.req.valid("json");
          const expected = timelineVersion(context.req.raw);
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            `timeline.${id}.command`,
            input,
            async () => {
              const result = ctx.uow.execute((tx) => {
                const row = tx.get<TimelineRow>(
                  "SELECT id, project_id, title, data_json, version, updated_at FROM timeline_timeline WHERE id = ?",
                  id,
                );
                if (!row)
                  throw new ApiProblem(
                    404,
                    "TIMELINE_NOT_FOUND",
                    "时间线不存在",
                  );
                if (row.version !== expected)
                  throw new ApiProblem(
                    412,
                    "VERSION_CONFLICT",
                    "时间线版本已变化",
                  );
                const before = timelineData.parse(JSON.parse(row.data_json));
                if (before.locked)
                  throw new ApiProblem(
                    409,
                    "TIMELINE_LOCKED",
                    "时间线已人工锁定",
                  );
                const after = mutateTimeline(before, input.type, input.payload);
                const now = new Date().toISOString();
                tx.run(
                  "DELETE FROM timeline_operation_log WHERE timeline_id = ? AND state = 'undone'",
                  id,
                );
                tx.run(
                  "INSERT INTO timeline_operation_log (id, timeline_id, sequence, command_json, before_json, after_json, state, created_at) VALUES (?, ?, COALESCE((SELECT MAX(sequence) + 1 FROM timeline_operation_log WHERE timeline_id = ?), 0), ?, ?, ?, 'applied', ?)",
                  randomUUID(),
                  id,
                  id,
                  JSON.stringify(input),
                  JSON.stringify(before),
                  JSON.stringify(after),
                  now,
                );
                tx.run(
                  "UPDATE timeline_timeline SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                  JSON.stringify(after),
                  now,
                  id,
                  expected,
                );
                tx.append({
                  type: "timeline.command-applied.v1",
                  pluginId: "timeline",
                  aggregateType: "timeline",
                  aggregateId: id,
                  aggregateVersion: expected + 1,
                  payload: input,
                });
                return {
                  id,
                  title: row.title,
                  data: after,
                  version: expected + 1,
                  updatedAt: now,
                };
              });
              context.header("etag", `"v${result.version}"`);
              return context.json(result, 200);
            },
          );
        }) as never,
      );

      for (const verb of ["undo", "redo"] as const) {
        const route = createRoute({
          method: "post",
          path: `/api/v2/timeline/timelines/{id}/actions/${verb}`,
          request: { params: z.object({ id: z.uuid() }) },
          responses: { 200: { description: `Timeline ${verb}` }, ...errors },
        });
        app.openapi(
          route as never,
          ((context: any) => {
            const id = context.req.valid("param").id;
            const expected = timelineVersion(context.req.raw);
            const result = ctx.uow.execute((tx) => {
              const row = tx.get<TimelineRow>(
                "SELECT id, project_id, title, data_json, version, updated_at FROM timeline_timeline WHERE id = ?",
                id,
              );
              if (!row)
                throw new ApiProblem(404, "TIMELINE_NOT_FOUND", "时间线不存在");
              if (row.version !== expected)
                throw new ApiProblem(
                  412,
                  "VERSION_CONFLICT",
                  "时间线版本已变化",
                );
              const operation = tx.get<{
                id: string;
                before_json: string;
                after_json: string;
              }>(
                `SELECT id, before_json, after_json FROM timeline_operation_log WHERE timeline_id = ? AND state = ? ORDER BY sequence ${verb === "undo" ? "DESC" : "ASC"} LIMIT 1`,
                id,
                verb === "undo" ? "applied" : "undone",
              );
              if (!operation)
                throw new ApiProblem(
                  409,
                  verb === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO",
                  verb === "undo" ? "没有可撤销的命令" : "没有可重做的命令",
                );
              const data = timelineData.parse(
                JSON.parse(
                  verb === "undo"
                    ? operation.before_json
                    : operation.after_json,
                ),
              );
              const now = new Date().toISOString();
              tx.run(
                "UPDATE timeline_operation_log SET state = ? WHERE id = ?",
                verb === "undo" ? "undone" : "applied",
                operation.id,
              );
              tx.run(
                "UPDATE timeline_timeline SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                JSON.stringify(data),
                now,
                id,
                expected,
              );
              tx.append({
                type: `timeline.${verb}.v1`,
                pluginId: "timeline",
                aggregateType: "timeline",
                aggregateId: id,
                aggregateVersion: expected + 1,
                payload: { operationId: operation.id },
              });
              return {
                id,
                title: row.title,
                data,
                version: expected + 1,
                updatedAt: now,
              };
            });
            context.header("etag", `"v${result.version}"`);
            return context.json(result, 200);
          }) as never,
        );
      }

      const preflightRoute = createRoute({
        method: "get",
        path: "/api/v2/timeline/timelines/{id}/preflight",
        request: { params: z.object({ id: z.uuid() }) },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: z.object({
                  ready: z.boolean(),
                  errors: z.array(z.string()),
                  warnings: z.array(z.string()),
                  assetIds: z.array(z.uuid()),
                }),
              },
            },
            description: "Timeline preflight",
          },
          ...errors,
        },
      });
      app.openapi(
        preflightRoute as never,
        ((context: any) =>
          context.json(
            ctx.timelineRead.preflight(context.req.valid("param").id),
            200,
          )) as never,
      );

      const exportRoute = createRoute({
        method: "post",
        path: "/api/v2/timeline/timelines/{id}/actions/export",
        request: {
          params: z.object({ id: z.uuid() }),
          body: {
            content: {
              "application/json": {
                schema: z.object({
                  format: z.enum(["fcpxml", "otio", "edl", "srt"]),
                  capability: z.string().min(16),
                }),
              },
            },
          },
        },
        responses: { 200: { description: "Timeline exported" }, ...errors },
      });
      app.openapi(
        exportRoute as never,
        (async (context: any) => {
          const id = context.req.valid("param").id;
          const input = context.req.valid("json");
          timelineVersion(context.req.raw);
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            `timeline.${id}.export`,
            input,
            async () => {
              const capability = await ctx.fileCapabilities.resolve(
                input.capability,
              );
              if (!capability)
                throw new ApiProblem(
                  404,
                  "FILE_CAPABILITY_NOT_FOUND",
                  "保存位置授权无效或已过期",
                );
              const row = ctx.uow.execute((tx) =>
                tx.get<TimelineRow>(
                  "SELECT id, project_id, title, data_json, version, updated_at FROM timeline_timeline WHERE id = ?",
                  id,
                ),
              );
              if (!row)
                throw new ApiProblem(404, "TIMELINE_NOT_FOUND", "时间线不存在");
              const data = timelineData.parse(JSON.parse(row.data_json));
              await writeFile(
                capability.path,
                renderTimelineExport(input.format, row.title, data),
                "utf8",
              );
              return context.json(
                {
                  timelineId: id,
                  format: input.format,
                  filename: capability.name,
                  version: row.version,
                },
                200,
              );
            },
          );
        }) as never,
      );
    },
  };
  ctx.http.register(contribution);
}

export const timelineModule = defineDramaPlugin({
  descriptor: {
    id: "timeline",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "production", "media"],
    provides: [
      "timeline.editing",
      "timeline.history",
      "timeline.export",
      "timelineRead",
    ],
    critical: true,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("timeline"), data: timelineData }),
      z.object({ kind: z.literal("command"), data: commandData }),
      z.object({ kind: z.literal("history"), data: historyData }),
      z.object({ kind: z.literal("preview"), data: previewData }),
      z.object({ kind: z.literal("export"), data: exportData }),
    ]),
  },
  server: timelineServer,
  migrations: [
    createNodeMigration("timeline", timelineResources),
    createRelationalMigration("timeline", timelineResources),
    {
      id: "timeline-0003",
      pluginId: "timeline",
      version: "3.0.0",
      dependsOn: ["timeline-0002"],
      sql: `
        CREATE TABLE timeline_operation_log (
          id TEXT PRIMARY KEY,
          timeline_id TEXT NOT NULL REFERENCES timeline_timeline(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          command_json TEXT NOT NULL CHECK (json_valid(command_json)),
          before_json TEXT NOT NULL CHECK (json_valid(before_json)),
          after_json TEXT NOT NULL CHECK (json_valid(after_json)),
          state TEXT NOT NULL CHECK (state IN ('applied', 'undone')),
          created_at TEXT NOT NULL,
          UNIQUE (timeline_id, sequence)
        );
        CREATE INDEX timeline_operation_log_state_idx ON timeline_operation_log (timeline_id, state, sequence);
      `,
    },
  ],
});
