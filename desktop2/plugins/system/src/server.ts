import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { backup } from "node:sqlite";

import type { Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import { pageQuerySchema, problemDetailsSchema } from "@dramaip/contracts";
import { ApiProblem, idempotentResponse } from "@dramaip/http";
import type {
  MigrationDefinition,
  RouteContribution,
} from "@dramaip/plugin-api";

import {
  backupPageSchema,
  backupSchema,
  bootstrapSchema,
  diagnosticsSchema,
  healthSchema,
  searchPageSchema,
  restoreBackupSchema,
} from "./contracts.ts";

export const migrations: readonly MigrationDefinition[] = [
  {
    id: "system-0001",
    pluginId: "system",
    version: "1.0.0",
    dependsOn: ["foundation-0001"],
    sql: `
      CREATE TABLE system_search_index (
        plugin_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        title TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (aggregate_type, aggregate_id)
      );
      CREATE INDEX system_search_text_idx ON system_search_index (title);
    `,
  },
] as const;

export interface SystemRuntimeConfig {
  backupDirectory: string;
  databaseFile?: string;
  profileName: string;
  pluginIds: readonly string[];
  restoreDatabase?: (backupFile: string) => Promise<void>;
}

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const problemResponses = {
  400: jsonResponse(problemDetailsSchema, "Invalid request"),
  401: jsonResponse(problemDetailsSchema, "Authentication required"),
  403: jsonResponse(problemDetailsSchema, "Origin forbidden"),
  409: jsonResponse(problemDetailsSchema, "Conflict"),
  500: jsonResponse(problemDetailsSchema, "Internal error"),
} as const;

export function createSystemServer(config: SystemRuntimeConfig): Plugin {
  return {
    name: "dramaip-system",
    inject: ["database", "eventRuntime", "http", "uow"],
    apply(ctx) {
      const disposeConsumer = ctx.eventRuntime.registerConsumer({
        id: "system.search-index",
        pluginId: "system",
        critical: false,
        handle(event) {
          const payload = event.payload as Record<string, unknown>;
          const title = String(
            payload.name ?? payload.title ?? event.aggregateId,
          );
          ctx.uow.execute((tx) => {
            tx.run(
              `INSERT INTO system_search_index
               (plugin_id, aggregate_type, aggregate_id, title, searchable_text, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE SET
                 plugin_id = excluded.plugin_id,
                 title = excluded.title,
                 searchable_text = excluded.searchable_text,
                 updated_at = excluded.updated_at`,
              event.pluginId,
              event.aggregateType,
              event.aggregateId,
              title,
              JSON.stringify(event.payload),
              event.occurredAt,
            );
          });
        },
      });
      ctx.effect(() => disposeConsumer, "system.search-consumer");

      const routes: RouteContribution = {
        id: "system.http.v2",
        pluginId: "system",
        install(app) {
          const healthRoute = createRoute({
            method: "get",
            path: "/api/v2/system/health",
            responses: {
              200: jsonResponse(healthSchema, "System is healthy"),
              503: jsonResponse(
                healthSchema,
                "A critical consumer is degraded",
              ),
              ...problemResponses,
            },
          });
          app.openapi(healthRoute, (context) => {
            ctx.database.sqlite.prepare("SELECT 1").get();
            const criticalDegraded = ctx.eventRuntime
              .diagnostics()
              .some(
                (diagnostic) =>
                  diagnostic.critical && diagnostic.status === "degraded",
              );
            const body = {
              status: criticalDegraded
                ? ("degraded" as const)
                : ("healthy" as const),
              apiVersion: "2" as const,
              database: "available" as const,
              criticalConsumers: criticalDegraded
                ? ("degraded" as const)
                : ("healthy" as const),
              time: new Date().toISOString(),
            };
            return context.json(body, criticalDegraded ? 503 : 200);
          });

          const bootstrapRoute = createRoute({
            method: "get",
            path: "/api/v2/system/bootstrap",
            responses: {
              200: jsonResponse(bootstrapSchema, "Application bootstrap"),
              ...problemResponses,
            },
          });
          app.openapi(bootstrapRoute, (context) =>
            context.json({
              apiVersion: "2" as const,
              productName: "DramaIP Studio" as const,
              appId: "com.sdns.dramaip.next" as const,
              profile: config.profileName,
              plugins: [...config.pluginIds],
              capabilities: {
                agentEngines: true as const,
                mediaRemoteExecution: false as const,
                cloudReviewSync: false as const,
                localMediaLibrary: true as const,
                localReviewPackages: true as const,
              },
            }),
          );

          const diagnosticsRoute = createRoute({
            method: "get",
            path: "/api/v2/system/diagnostics",
            responses: {
              200: jsonResponse(diagnosticsSchema, "Plugin diagnostics"),
              ...problemResponses,
            },
          });
          app.openapi(diagnosticsRoute, (context) =>
            context.json({
              items: ctx.eventRuntime.diagnostics().map((diagnostic) => ({
                pluginId: diagnostic.pluginId,
                component: diagnostic.id,
                status: diagnostic.status,
                critical: diagnostic.critical,
                ...(diagnostic.lastError
                  ? { detail: diagnostic.lastError }
                  : {}),
              })),
            }),
          );

          const searchRoute = createRoute({
            method: "get",
            path: "/api/v2/system/search",
            request: {
              query: pageQuerySchema.extend({
                q: z.string().trim().min(1).max(200),
              }),
            },
            responses: {
              200: jsonResponse(searchPageSchema, "Search results"),
              ...problemResponses,
            },
          });
          app.openapi(searchRoute, (context) => {
            const query = context.req.valid("query");
            const offset = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
            const items = ctx.uow.execute((tx) =>
              tx.all<{
                plugin_id: string;
                aggregate_type: string;
                aggregate_id: string;
                title: string;
                updated_at: string;
              }>(
                `SELECT plugin_id, aggregate_type, aggregate_id, title, updated_at
                   FROM system_search_index
                  WHERE title LIKE ? OR searchable_text LIKE ?
                  ORDER BY updated_at DESC, aggregate_id ASC
                  LIMIT ? OFFSET ?`,
                `%${query.q}%`,
                `%${query.q}%`,
                query.limit + 1,
                offset,
              ),
            );
            const hasMore = items.length > query.limit;
            return context.json({
              items: items.slice(0, query.limit).map((item) => ({
                pluginId: item.plugin_id,
                aggregateType: item.aggregate_type,
                aggregateId: item.aggregate_id,
                title: item.title,
                updatedAt: item.updated_at,
              })),
              ...(hasMore ? { nextCursor: String(offset + query.limit) } : {}),
            });
          });

          const listBackupsRoute = createRoute({
            method: "get",
            path: "/api/v2/system/backups",
            responses: {
              200: jsonResponse(backupPageSchema, "Database backups"),
              ...problemResponses,
            },
          });
          app.openapi(listBackupsRoute, async (context) => {
            await mkdir(config.backupDirectory, { recursive: true });
            const entries = await readdir(config.backupDirectory, {
              withFileTypes: true,
            });
            const items = await Promise.all(
              entries
                .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
                .map(async (entry) => {
                  const info = await stat(
                    join(config.backupDirectory, entry.name),
                  );
                  return {
                    id: entry.name.slice(0, -3),
                    filename: entry.name,
                    size: info.size,
                    createdAt: info.birthtime.toISOString(),
                  };
                }),
            );
            return context.json({
              items: items.sort((left, right) =>
                right.createdAt.localeCompare(left.createdAt),
              ),
            });
          });

          const createBackupRoute = createRoute({
            method: "post",
            path: "/api/v2/system/backups",
            responses: {
              201: jsonResponse(backupSchema, "Backup created"),
              ...problemResponses,
            },
          });
          app.openapi(createBackupRoute, async (context) => {
            return (await idempotentResponse(
              ctx.uow,
              context.req.raw,
              "system.backups.create",
              {},
              async () => {
                await mkdir(config.backupDirectory, { recursive: true });
                const id = `${Date.now()}-${crypto.randomUUID()}`;
                const filename = `${id}.db`;
                const target = join(config.backupDirectory, filename);
                if (basename(target) !== filename)
                  throw new Error("invalid backup target");
                await backup(ctx.database.sqlite, target);
                const info = await stat(target);
                return context.json(
                  {
                    id,
                    filename,
                    size: info.size,
                    createdAt: info.birthtime.toISOString(),
                  },
                  201,
                );
              },
            )) as never;
          });

          const restoreRoute = createRoute({
            method: "post",
            path: "/api/v2/system/backups/{id}/actions/restore",
            request: {
              params: z.object({ id: z.string().regex(/^[A-Za-z0-9-]+$/) }),
              body: {
                content: {
                  "application/json": { schema: restoreBackupSchema },
                },
              },
            },
            responses: {
              202: jsonResponse(backupSchema, "Backup restore queued"),
              ...problemResponses,
            },
          });
          app.openapi(restoreRoute, async (context) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              "system.backups.restore",
              context.req.valid("json"),
              async () => {
                if (!config.restoreDatabase)
                  throw new ApiProblem(
                    409,
                    "RESTORE_UNAVAILABLE",
                    "当前运行模式不支持数据库恢复",
                  );
                const id = context.req.valid("param").id;
                const filename = `${id}.db`;
                if (context.req.valid("json").confirmation !== filename)
                  throw new ApiProblem(
                    409,
                    "BACKUP_CONFIRMATION_MISMATCH",
                    `请输入 ${filename} 确认恢复`,
                  );
                const backupFile = join(config.backupDirectory, filename);
                const source = await realpath(backupFile).catch(
                  () => undefined,
                );
                const root = await realpath(config.backupDirectory);
                if (!source || !source.startsWith(`${root}/`))
                  throw new ApiProblem(
                    404,
                    "BACKUP_NOT_FOUND",
                    "备份不存在或不是受信任文件",
                  );
                const info = await stat(source);
                if (!info.isFile() || info.size < 4096)
                  throw new ApiProblem(400, "BACKUP_INVALID", "备份文件不完整");
                await config.restoreDatabase(source);
                return context.json(
                  {
                    id,
                    filename,
                    size: info.size,
                    createdAt: info.birthtime.toISOString(),
                  },
                  202,
                );
              },
            ),
          );

          app.get("/api/v2/events", (context) => {
            const rawId = context.req.header("last-event-id");
            let cursor = rawId && /^\d+$/.test(rawId) ? Number(rawId) : 0;
            return streamSSE(context, async (stream) => {
              const liveQueue: Array<{ type: string; payload: unknown }> = [];
              const unsubscribe = ctx.eventRuntime.subscribeLive((event) => {
                liveQueue.push({ type: event.type, payload: event.payload });
              });
              try {
                while (!stream.aborted) {
                  for (const event of ctx.eventRuntime.replay(cursor, 200)) {
                    cursor = event.cursor;
                    await stream.writeSSE({
                      id: String(event.cursor),
                      event: event.type,
                      data: JSON.stringify(event),
                    });
                  }
                  for (const event of liveQueue.splice(0)) {
                    await stream.writeSSE({
                      event: event.type,
                      data: JSON.stringify(event.payload),
                    });
                  }
                  await stream.sleep(250);
                }
              } finally {
                unsubscribe();
              }
            });
          });
        },
      };
      ctx.http.register(routes);
    },
  };
}
