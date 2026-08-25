import { type AgentEngineKind } from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import { type PluginContext } from "@dramaip/plugin-api/internal";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  AgentRouteContext,
  AgentRouteDraft,
  AgentRouteHandler,
  problem,
} from "../internal/shared.js";
import {
  activeAgentProviderId,
  engineDefinitions,
  globalAgentSettings,
  hostEngineHealth,
  isAgentEngineKind,
  isRecord,
  modelSelection,
  text,
} from "../providers/routes.js";
export interface AssistantSessionRow {
  id: string;
  engine_session_id: string;
  engine_kind: string;
  project_id: string | null;
  surface: string;
  chapter_id: string | null;
  task_type: string | null;
  title: string | null;
  model_json: string | null;
  status: string;
  archived_at: string | null;
  last_opened_at: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantTurnRow {
  id: string;
  session_id: string;
  run_id: string | null;
  user_message: string;
  project_id: string | null;
  chapter_id: string | null;
  selection_json: string | null;
  route_json: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantRunRow {
  id: string;
  session_id: string;
  task_id: string;
  task_type: string;
  engine_kind: string;
  status: string;
  model_json: string | null;
  turn_id: string | null;
  chapter_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  engine_run_id?: string | null;
  last_engine_cursor?: number;
  engine_generation?: number | null;
  checkpoint_json?: string | null;
  recovery_attempts?: number;
  recovery_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantItemRow {
  id: string;
  run_id: string;
  sequence: number;
  type: string;
  status: string;
  content: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export function jsonValue(value: string | null): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function assistantSession(
  row: AssistantSessionRow,
): Record<string, unknown> {
  const model = modelSelection(jsonValue(row.model_json));
  return {
    id: row.id,
    engineSessionId: row.engine_session_id,
    engineKind: row.engine_kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    surface: row.surface,
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(row.task_type ? { taskType: row.task_type } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(model ? { model } : {}),
    status: row.status,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assistantTurn(row: AssistantTurnRow): Record<string, unknown> {
  const selection = jsonValue(row.selection_json);
  const route = jsonValue(row.route_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    userMessage: row.user_message,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(selection === undefined ? {} : { selection }),
    ...(isRecord(route) ? { route } : {}),
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assistantRun(row: AssistantRunRow): Record<string, unknown> {
  const model = modelSelection(jsonValue(row.model_json));
  const checkpoint = jsonValue(row.checkpoint_json ?? null);
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    taskType: row.task_type,
    engineKind: row.engine_kind,
    status: row.status,
    ...(model ? { model } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.engine_run_id ? { engineRunId: row.engine_run_id } : {}),
    lastEngineCursor: Number(row.last_engine_cursor ?? 0),
    ...(typeof row.engine_generation === "number"
      ? { engineGeneration: row.engine_generation }
      : {}),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    recoveryAttempts: Number(row.recovery_attempts ?? 0),
    ...(row.recovery_error ? { recoveryError: row.recovery_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assistantItem(row: AssistantItemRow): Record<string, unknown> {
  const payload = jsonValue(row.payload_json);
  return {
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.type,
    status: row.status,
    ...(row.content ? { content: row.content } : {}),
    ...(payload === undefined ? {} : { payload }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assistantSurface(
  value: unknown,
): "global" | "novel" | "legacy" | undefined {
  return ["global", "novel", "legacy"].includes(String(value))
    ? (value as "global" | "novel" | "legacy")
    : undefined;
}

export function assistantTaskType(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,100}$/u.test(value)
    ? value
    : undefined;
}

export function assistantMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  return message && message.length <= 200_000 ? message : undefined;
}

export function engineResponseText(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 8 || value === null || typeof value === "undefined")
    return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const fragments = value
      .map((item) => engineResponseText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return fragments.length ? fragments.join("\n") : undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const field of ["text", "content", "output", "response"] as const) {
    const extracted = engineResponseText(value[field], depth + 1);
    if (extracted) return extracted;
  }
  const parts = engineResponseText(value.parts, depth + 1);
  if (parts) return parts;
  const message = isRecord(value.message)
    ? engineResponseText(value.message, depth + 1)
    : undefined;
  return message;
}

export function assistantConversationRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly AgentRouteDraft[] {
  const find = (id: string): AssistantSessionRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantSessionRow>(
        `SELECT id, engine_session_id, engine_kind, project_id, surface,
                chapter_id, task_type, title, model_json, status, archived_at,
                last_opened_at, created_at, updated_at
         FROM agent_assistant_sessions WHERE id = ?`,
        id,
      ),
    );
  return [
    {
      id: "agents:assistant-conversations-list",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/assistant-conversations", (context) => {
          const surface = context.req.query("surface");
          const projectId = context.req.query("projectId");
          const archived = context.req.query("archived") === "true";
          const conversations = pluginContext.uow.execute((transaction) =>
            transaction
              .all<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions
                 WHERE (${archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"})
                   AND (? IS NULL OR surface = ?)
                   AND (? IS NULL OR project_id = ?)
                 ORDER BY last_opened_at DESC, id DESC`,
                surface ?? null,
                surface ?? null,
                projectId ?? null,
                projectId ?? null,
              )
              .map(assistantSession),
          );
          return context.json(conversations);
        }),
    },
    {
      id: "agents:assistant-conversations-create",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/assistant-conversations", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "智能会话配置无效。",
            );
          const surface = assistantSurface(body.surface) ?? "global";
          const projectId = text(body.projectId);
          const chapterId = text(body.chapterId);
          if (surface !== "global" && !projectId)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "此智能会话必须绑定项目。",
            );
          const kind = isAgentEngineKind(body.engineKind)
            ? body.engineKind
            : globalAgentSettings(pluginContext).defaultEngineKind;
          const model =
            typeof body.model === "undefined"
              ? undefined
              : modelSelection(body.model);
          if (typeof body.model !== "undefined" && !model)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型配置格式无效。",
            );
          const activeProvider = activeAgentProviderId(pluginContext);
          if (model?.providerId && model.providerId !== activeProvider)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "所选模型不属于当前启用的智能模型服务商。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法创建本地智能会话。",
            );
          const health = hostEngineHealth(
            await host.engineHealth(kind).catch(() => undefined),
          );
          if (!health.available || !health.healthy)
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              `${engineDefinitions[kind].name} 引擎当前不可用。`,
            );
          if (
            (kind === "codex" && !health.authenticated) ||
            (kind !== "codex" && !activeProvider)
          )
            return problem(
              context,
              409,
              "CONFLICT",
              kind === "codex"
                ? "请先在设置中心完成 Codex 认证。"
                : "请先将一项智能模型设为智能助手模型。",
            );
          const title = text(body.title)?.slice(0, 200) ?? "新对话";
          const conversationId = crypto.randomUUID();
          let engineSession: { engineSessionId: string };
          try {
            engineSession = await createHostAgentRuntime(
              host,
              kind,
            ).createSession({
              sessionId: conversationId,
              title,
              ...(projectId ? { projectId } : {}),
              ...(chapterId ? { chapterId } : {}),
              ...(model ? { model } : {}),
            });
          } catch {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              "智能引擎无法创建会话，请检查引擎状态后重试。",
            );
          }
          const conversation = pluginContext.uow.execute((transaction) => {
            const id = conversationId;
            const now = new Date().toISOString();
            transaction.run(
              `INSERT INTO agent_assistant_sessions(
                id, engine_session_id, engine_kind, project_id, surface, chapter_id,
                task_type, title, model_json, status, archived_at, last_opened_at,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
              id,
              engineSession.engineSessionId,
              kind,
              projectId ?? null,
              surface,
              chapterId ?? null,
              assistantTaskType(body.taskType) ?? null,
              title,
              model ? JSON.stringify(model) : null,
              now,
              now,
              now,
            );
            transaction.append({
              type: "agents.assistant-session-created.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: id,
              aggregateVersion: 1,
              payload: { sessionId: id, engineKind: kind },
            });
            return assistantSession(
              transaction.get<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions WHERE id = ?`,
                id,
              )!,
            );
          });
          return context.json(conversation, 201);
        }),
    },
    {
      id: "agents:assistant-conversations-get",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/assistant-conversations/:id", (context) => {
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          const detail = pluginContext.uow.execute((transaction) => ({
            conversation: assistantSession(session),
            turns: transaction
              .all<AssistantTurnRow>(
                `SELECT id, session_id, run_id, user_message, project_id, chapter_id,
                        selection_json, route_json, status, error, created_at, updated_at
                 FROM agent_assistant_turns WHERE session_id = ?
                 ORDER BY created_at, id`,
                session.id,
              )
              .map(assistantTurn),
            runs: transaction
              .all<AssistantRunRow>(
                `SELECT id, session_id, task_id, task_type, engine_kind, status,
                        model_json, turn_id, chapter_id, error, started_at, completed_at,
                        created_at, updated_at
                 FROM agent_assistant_runs WHERE session_id = ? ORDER BY created_at, id`,
                session.id,
              )
              .map(assistantRun),
            items: transaction
              .all<AssistantItemRow>(
                `SELECT item.id, item.run_id, item.sequence, item.type, item.status,
                        item.content, item.payload_json, item.created_at, item.updated_at
                 FROM agent_assistant_items item
                 JOIN agent_assistant_runs run ON run.id = item.run_id
                 WHERE run.session_id = ? ORDER BY run.created_at, item.sequence, item.id`,
                session.id,
              )
              .map(assistantItem),
            changePreviews: [],
            providerActionPreviews: [],
          }));
          return context.json(detail);
        }),
    },
    {
      id: "agents:assistant-conversations-update",
      pluginId: "agents",
      bind: (routes) =>
        routes.patch("/api/v2/assistant-conversations/:id", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "智能会话更新无效。",
            );
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          const title =
            typeof body.title === "string"
              ? text(body.title)?.slice(0, 200)
              : undefined;
          if (typeof body.title !== "undefined" && !title)
            return problem(context, 400, "VALIDATION_ERROR", "会话标题无效。");
          if (
            typeof body.archived !== "undefined" &&
            typeof body.archived !== "boolean"
          )
            return problem(context, 400, "VALIDATION_ERROR", "归档状态无效。");
          const updated = pluginContext.uow.execute((transaction) => {
            const now = new Date().toISOString();
            transaction.run(
              `UPDATE agent_assistant_sessions
               SET title = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
              title ?? session.title,
              body.archived === true
                ? now
                : body.archived === false
                  ? null
                  : session.archived_at,
              now,
              session.id,
            );
            transaction.append({
              type: "agents.assistant-session-updated.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
            return assistantSession(
              transaction.get<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions WHERE id = ?`,
                session.id,
              )!,
            );
          });
          return context.json(updated);
        }),
    },
    {
      id: "agents:assistant-conversations-bind-project",
      pluginId: "agents",
      bind: (routes) =>
        routes.post(
          "/api/v2/assistant-conversations/:id/bind-project",
          async (context) => {
            const body = await context.req.json().catch(() => undefined);
            const projectId = isRecord(body) ? text(body.projectId) : undefined;
            if (!projectId)
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                "项目编号无效。",
              );
            const session = find(context.req.param("id"));
            if (!session)
              return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
            const updated = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET project_id = ?, updated_at = ?, last_opened_at = ? WHERE id = ?`,
                projectId,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.assistant-session-project-bound.v1",
                pluginId: "agents",
                aggregateType: "assistant-session",
                aggregateId: session.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, projectId },
              });
              return assistantSession(
                transaction.get<AssistantSessionRow>(
                  `SELECT id, engine_session_id, engine_kind, project_id, surface,
                          chapter_id, task_type, title, model_json, status, archived_at,
                          last_opened_at, created_at, updated_at
                   FROM agent_assistant_sessions WHERE id = ?`,
                  session.id,
                )!,
              );
            });
            return context.json(updated);
          },
        ),
    },
    {
      id: "agents:assistant-conversations-send-message",
      pluginId: "agents",
      bind: (routes) =>
        routes.post(
          "/api/v2/assistant-conversations/:id/messages",
          async (context) => {
            const body = await context.req.json().catch(() => undefined);
            const message = isRecord(body)
              ? assistantMessage(body.message)
              : undefined;
            if (!message)
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                "消息内容不能为空或过长。",
              );
            const session = find(context.req.param("id"));
            if (!session || session.archived_at)
              return problem(
                context,
                404,
                "NOT_FOUND",
                "未找到可用的智能会话。",
              );
            if (!host)
              return problem(
                context,
                503,
                "CAPABILITY_UNAVAILABLE",
                "当前 Runtime 未连接 Desktop Host，无法调用本地智能引擎。",
              );
            if (session.engine_kind === "codex") {
              const health = hostEngineHealth(
                await host.engineHealth("codex").catch(() => undefined),
              );
              if (!health.available || !health.healthy)
                return problem(
                  context,
                  503,
                  "ENGINE_UNAVAILABLE",
                  "Codex 引擎当前不可用。",
                );
              if (!health.authenticated)
                return problem(
                  context,
                  409,
                  "CONFLICT",
                  "请先在设置中心完成 Codex 认证。",
                );
            }
            const activeRun = pluginContext.uow.execute((transaction) =>
              transaction.get<{ id: string }>(
                `SELECT id FROM agent_assistant_runs
                 WHERE session_id = ? AND status IN (
                   'created', 'queued', 'preparing', 'running',
                   'waiting_approval', 'committing', 'recoverable'
                 )
                 LIMIT 1`,
                session.id,
              ),
            );
            if (activeRun)
              return problem(
                context,
                409,
                "CONFLICT",
                "当前对话已有正在执行的智能任务，请等待完成或先停止运行。",
              );
            const taskType =
              (isRecord(body) && assistantTaskType(body.taskType)) ??
              "chat_project";
            const route = {
              kind: "chat",
              taskType,
              confidence: 1,
              source: "deterministic",
              explanation: session.project_id
                ? "已将消息交由当前项目的智能会话处理。"
                : "未绑定项目，按通用聊天处理。",
            };
            const started = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              const turnId = crypto.randomUUID();
              const runId = crypto.randomUUID();
              const capabilityGrantId = crypto.randomUUID();
              const capabilityGrantExpiresAt = new Date(
                Date.now() + 5 * 60_000,
              ).toISOString();
              transaction.run(
                `INSERT INTO agent_assistant_turns(
                  id, session_id, run_id, user_message, project_id, chapter_id,
                  selection_json, route_json, status, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
                turnId,
                session.id,
                runId,
                message,
                session.project_id,
                session.chapter_id,
                isRecord(body) && typeof body.selection !== "undefined"
                  ? JSON.stringify(body.selection)
                  : null,
                JSON.stringify(route),
                now,
                now,
              );
              transaction.run(
                `INSERT INTO agent_assistant_runs(
                  id, session_id, task_id, task_type, engine_kind, status, model_json,
                  turn_id, chapter_id, error, started_at, completed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, ?, NULL, ?, NULL, ?, ?)`,
                runId,
                session.id,
                crypto.randomUUID(),
                taskType,
                session.engine_kind,
                session.model_json,
                turnId,
                session.chapter_id,
                now,
                now,
                now,
              );
              transaction.run(
                `INSERT INTO agent_capability_grants(
                  id, run_id, expires_at, consumed_at, capabilities_json, created_at
                ) VALUES (?, ?, ?, NULL, ?, ?)`,
                capabilityGrantId,
                runId,
                capabilityGrantExpiresAt,
                JSON.stringify(["mcp.readonly"]),
                now,
              );
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET status = 'running', last_opened_at = ?, updated_at = ? WHERE id = ?`,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.assistant-turn-started.v1",
                pluginId: "agents",
                aggregateType: "assistant-turn",
                aggregateId: turnId,
                aggregateVersion: 1,
                payload: { sessionId: session.id, turnId, runId },
              });
              return {
                conversation: assistantSession(
                  transaction.get<AssistantSessionRow>(
                    `SELECT id, engine_session_id, engine_kind, project_id, surface,
                            chapter_id, task_type, title, model_json, status, archived_at,
                            last_opened_at, created_at, updated_at
                     FROM agent_assistant_sessions WHERE id = ?`,
                    session.id,
                  )!,
                ),
                turn: assistantTurn(
                  transaction.get<AssistantTurnRow>(
                    `SELECT id, session_id, run_id, user_message, project_id, chapter_id,
                            selection_json, route_json, status, error, created_at, updated_at
                     FROM agent_assistant_turns WHERE id = ?`,
                    turnId,
                  )!,
                ),
                run: assistantRun(
                  transaction.get<AssistantRunRow>(
                    `SELECT id, session_id, task_id, task_type, engine_kind, status,
                            model_json, turn_id, chapter_id, error, started_at, completed_at,
                            created_at, updated_at FROM agent_assistant_runs WHERE id = ?`,
                    runId,
                  )!,
                ),
                turnId,
                runId,
                capabilityGrant: {
                  // Pi resolves the private Runtime MCP endpoint retained by
                  // the Host; only this short-lived opaque token crosses the
                  // Host boundary.
                  endpoint: "",
                  token: capabilityGrantId,
                  expiresAt: capabilityGrantExpiresAt,
                },
              };
            });
            const completeRun = async () => {
              let streamedItemId: string | undefined;
              let streamedContent = "";
              const recordDelta = (delta: string) => {
                if (!delta) return;
                const emitted = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  if (!streamedItemId) {
                    streamedItemId = crypto.randomUUID();
                    streamedContent = delta.slice(0, 500_000);
                    transaction.run(
                      `INSERT INTO agent_assistant_items(
                        id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                      ) VALUES (?, ?, 1, 'message', 'streaming', ?, NULL, ?, ?)`,
                      streamedItemId,
                      started.runId,
                      streamedContent,
                      now,
                      now,
                    );
                    return { itemId: streamedItemId, now, started: true };
                  }
                  streamedContent = `${streamedContent}${delta}`.slice(
                    0,
                    500_000,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_items
                     SET content = ?, updated_at = ? WHERE id = ?`,
                    streamedContent,
                    now,
                    streamedItemId,
                  );
                  return { itemId: streamedItemId, now, started: false };
                });
                pluginContext.events.publishLive({
                  type: emitted.started
                    ? "agents.assistant-item-started.v1"
                    : "agents.assistant-item-delta.v1",
                  payload: {
                    sessionId: session.id,
                    runId: started.runId,
                    itemId: emitted.itemId,
                    ...(emitted.started ? { sequence: 1 } : {}),
                    ...(emitted.started
                      ? { content: streamedContent }
                      : { delta }),
                    status: "streaming",
                    occurredAt: emitted.now,
                  },
                });
              };
              try {
                const runtime = createHostAgentRuntime(
                  host,
                  session.engine_kind as AgentEngineKind,
                );
                const engineHealth = await runtime.health();
                const engineSession = {
                  sessionId: session.id,
                  engineSessionId: session.engine_session_id,
                };
                const engineRun = await runtime.prompt(engineSession, {
                  runId: started.runId,
                  prompt: session.project_id
                    ? message
                    : [
                        "你是 DramaIP 的中文创作智能助手。",
                        "当前未绑定项目，只能进行通用问答；不得声称读取了项目、文件或工具。",
                        "请使用简体中文直接回答，不要展示隐藏思维过程。",
                        `用户消息：${message}`,
                      ].join("\n"),
                  responseMode: session.project_id ? "structured" : "text",
                  capabilityGrant: started.capabilityGrant,
                });
                pluginContext.uow.execute((transaction) =>
                  transaction.run(
                    `UPDATE agent_assistant_runs
                     SET status = 'running', engine_run_id = ?, engine_generation = ?,
                         recovery_error = NULL, updated_at = ? WHERE id = ?`,
                    engineRun.engineRunId ?? engineRun.runId,
                    engineHealth.generation,
                    new Date().toISOString(),
                    started.runId,
                  ),
                );
                let output: unknown;
                for await (const event of runtime.subscribe(engineRun)) {
                  pluginContext.uow.execute((transaction) =>
                    transaction.run(
                      `UPDATE agent_assistant_runs
                       SET last_engine_cursor = ?, updated_at = ? WHERE id = ?`,
                      event.cursor,
                      new Date().toISOString(),
                      started.runId,
                    ),
                  );
                  if (event.type === "content.delta") recordDelta(event.delta);
                  if (event.type === "result") output = event.result;
                  if (event.type === "error") throw new Error(event.message);
                }
                const response =
                  engineResponseText(output) ?? streamedContent.trim();
                if (!response)
                  throw new Error("智能引擎未返回可显示的文本结果");
                pluginContext.uow.execute((transaction) =>
                  transaction.run(
                    `UPDATE agent_assistant_runs
                     SET status = 'committing', checkpoint_json = ?, updated_at = ?
                     WHERE id = ?`,
                    JSON.stringify({ response }),
                    new Date().toISOString(),
                    started.runId,
                  ),
                );
                const completed = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  transaction.run(
                    `UPDATE agent_assistant_turns SET status = 'succeeded', updated_at = ? WHERE id = ?`,
                    now,
                    started.turnId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_runs
                   SET status = 'completed', completed_at = ?, recovery_error = NULL, updated_at = ? WHERE id = ?`,
                    now,
                    now,
                    started.runId,
                  );
                  const itemId = streamedItemId ?? crypto.randomUUID();
                  if (streamedItemId)
                    transaction.run(
                      `UPDATE agent_assistant_items
                       SET status = 'completed', content = ?, updated_at = ?
                       WHERE id = ?`,
                      response.slice(0, 500_000),
                      now,
                      itemId,
                    );
                  else
                    transaction.run(
                      `INSERT INTO agent_assistant_items(
                        id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                      ) VALUES (?, ?, 1, 'message', 'completed', ?, NULL, ?, ?)`,
                      itemId,
                      started.runId,
                      response.slice(0, 500_000),
                      now,
                      now,
                    );
                  transaction.run(
                    `UPDATE agent_assistant_sessions
                   SET status = 'idle', last_opened_at = ?, updated_at = ? WHERE id = ?`,
                    now,
                    now,
                    session.id,
                  );
                  transaction.run(
                    "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
                    now,
                    started.capabilityGrant.token,
                  );
                  transaction.append({
                    type: "agents.assistant-run-completed.v1",
                    pluginId: "agents",
                    aggregateType: "assistant-run",
                    aggregateId: started.runId,
                    aggregateVersion: 1,
                    payload: { sessionId: session.id, runId: started.runId },
                  });
                  return { itemId, now };
                });
                pluginContext.events.publishLive({
                  type: "agents.assistant-item-completed.v1",
                  payload: {
                    sessionId: session.id,
                    runId: started.runId,
                    itemId: completed.itemId,
                    content: response.slice(0, 500_000),
                    status: "completed",
                    occurredAt: completed.now,
                  },
                });
                pluginContext.events.publishLive({
                  type: "agents.assistant-run-completed.v1",
                  payload: { sessionId: session.id, runId: started.runId },
                });
              } catch {
                const failed = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  const error =
                    "智能引擎调用失败，请检查模型配置和引擎状态后重试。";
                  transaction.run(
                    `UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
                    error,
                    now,
                    started.turnId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_runs
                   SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
                    error,
                    now,
                    now,
                    started.runId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?`,
                    now,
                    session.id,
                  );
                  if (streamedItemId)
                    transaction.run(
                      `UPDATE agent_assistant_items
                       SET status = 'failed', updated_at = ? WHERE id = ?`,
                      now,
                      streamedItemId,
                    );
                  transaction.run(
                    "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
                    now,
                    started.capabilityGrant.token,
                  );
                  transaction.append({
                    type: "agents.assistant-run-failed.v1",
                    pluginId: "agents",
                    aggregateType: "assistant-run",
                    aggregateId: started.runId,
                    aggregateVersion: 1,
                    payload: { sessionId: session.id, runId: started.runId },
                  });
                  return { now };
                });
                if (streamedItemId)
                  pluginContext.events.publishLive({
                    type: "agents.assistant-item-failed.v1",
                    payload: {
                      sessionId: session.id,
                      runId: started.runId,
                      itemId: streamedItemId,
                      content: streamedContent,
                      status: "failed",
                      occurredAt: failed.now,
                    },
                  });
                pluginContext.events.publishLive({
                  type: "agents.assistant-run-failed.v1",
                  payload: { sessionId: session.id, runId: started.runId },
                });
              }
            };
            void completeRun().catch(() => undefined);
            return context.json({
              conversation: started.conversation,
              turn: started.turn,
              run: started.run,
            });
          },
        ),
    },
    {
      id: "agents:assistant-conversations-delete",
      pluginId: "agents",
      bind: (routes) =>
        routes.delete("/api/v2/assistant-conversations/:id", (context) => {
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `DELETE FROM agent_assistant_items WHERE run_id IN (
                 SELECT id FROM agent_assistant_runs WHERE session_id = ?
               )`,
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_runs WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_turns WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_sessions WHERE id = ?",
              session.id,
            );
            transaction.append({
              type: "agents.assistant-session-deleted.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
          });
          return context.body(null, 204);
        }),
    },
  ];
}

export function typedAgentSessionRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  assistantHandlers: {
    create: AgentRouteHandler;
    sendMessage: AgentRouteHandler;
  },
): readonly AgentRouteDraft[] {
  const findSession = (id: string): AssistantSessionRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantSessionRow>(
        `SELECT id, engine_session_id, engine_kind, project_id, surface,
                chapter_id, task_type, title, model_json, status, archived_at,
                last_opened_at, created_at, updated_at
         FROM agent_assistant_sessions WHERE id = ?`,
        id,
      ),
    );
  const findRun = (id: string): AssistantRunRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantRunRow>(
        `SELECT id, session_id, task_id, task_type, engine_kind, status,
                model_json, turn_id, chapter_id, error, started_at, completed_at,
                created_at, updated_at
         FROM agent_assistant_runs WHERE id = ?`,
        id,
      ),
    );
  const invokeAssistant = (
    handler: AgentRouteHandler,
    context: AgentRouteContext,
    body: unknown,
    parameters: Readonly<Record<string, string>> = {},
  ): Response | Promise<Response> =>
    handler(
      new Proxy(context, {
        get(target, property, receiver) {
          if (property !== "req")
            return Reflect.get(target, property, receiver);
          return new Proxy(target.req, {
            get(request, requestProperty, requestReceiver) {
              if (requestProperty === "json") return async () => body;
              if (requestProperty === "param")
                return (name: string) =>
                  parameters[name] ?? request.param(name);
              return Reflect.get(request, requestProperty, requestReceiver);
            },
          });
        },
      }),
    );
  const stopRun = async (
    run: AssistantRunRow,
    status: "interrupted" | "aborted",
  ): Promise<Record<string, unknown>> => {
    const session = findSession(run.session_id);
    if (!session)
      throw new Error("Agent session disappeared while stopping its run.");
    if (!host)
      throw new Error(
        "当前 Runtime 未连接 Desktop Host，无法停止本地智能引擎。",
      );
    const runtime = createHostAgentRuntime(
      host,
      session.engine_kind as AgentEngineKind,
    );
    await runtime.abort({ runId: run.id });
    return pluginContext.uow.execute((transaction) => {
      const now = new Date().toISOString();
      transaction.run(
        `UPDATE agent_assistant_runs
         SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        status,
        now,
        now,
        run.id,
      );
      transaction.run(
        `UPDATE agent_assistant_turns SET status = ?, updated_at = ? WHERE run_id = ?`,
        status === "aborted" ? "canceled" : status,
        now,
        run.id,
      );
      transaction.run(
        `UPDATE agent_assistant_sessions
         SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?`,
        now,
        now,
        session.id,
      );
      transaction.run(
        "UPDATE agent_capability_grants SET consumed_at = COALESCE(consumed_at, ?) WHERE run_id = ?",
        now,
        run.id,
      );
      transaction.append({
        type: "agents.run-interrupted.v1",
        pluginId: "agents",
        aggregateType: "agent-run",
        aggregateId: run.id,
        aggregateVersion: 1,
        payload: { sessionId: session.id, runId: run.id, status },
      });
      return assistantRun(
        transaction.get<AssistantRunRow>(
          `SELECT id, session_id, task_id, task_type, engine_kind, status,
                  model_json, turn_id, chapter_id, error, started_at, completed_at,
                  created_at, updated_at
           FROM agent_assistant_runs WHERE id = ?`,
          run.id,
        )!,
      );
    });
  };
  return [
    {
      id: "agents:typed-sessions-create",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-sessions", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(context, 400, "VALIDATION_ERROR", "会话配置无效。");
          return invokeAssistant(assistantHandlers.create, context, body);
        }),
    },
    {
      id: "agents:typed-sessions-get",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-sessions/:id", (context) => {
          const session = findSession(context.req.param("id"));
          return session
            ? context.json(assistantSession(session))
            : problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
        }),
    },
    {
      id: "agents:typed-sessions-run",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-sessions/:id/runs", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const prompt = isRecord(body)
            ? assistantMessage(body.prompt)
            : undefined;
          if (!prompt)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "运行提示不能为空或过长。",
            );
          const response = await invokeAssistant(
            assistantHandlers.sendMessage,
            context,
            {
              message: prompt,
              ...(isRecord(body) && body.taskType
                ? { taskType: body.taskType }
                : {}),
            },
            { id: context.req.param("id") },
          );
          if (!response.ok) return response;
          const started = (await response.json()) as unknown;
          const run =
            isRecord(started) && isRecord(started.run)
              ? started.run
              : undefined;
          if (
            !run ||
            typeof run.taskId !== "string" ||
            typeof run.sessionId !== "string" ||
            typeof run.id !== "string"
          )
            return problem(
              context,
              500,
              "INTERNAL_ERROR",
              "Agent 运行未返回规范化标识。",
            );
          return context.json({
            taskId: run.taskId,
            sessionId: run.sessionId,
            runId: run.id,
          });
        }),
    },
    {
      id: "agents:typed-runs-get",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-runs/:id", (context) => {
          const run = findRun(context.req.param("id"));
          return run
            ? context.json(assistantRun(run))
            : problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
        }),
    },
    {
      id: "agents:typed-run-items-list",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-runs/:id/items", (context) => {
          if (!findRun(context.req.param("id")))
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          const items = pluginContext.uow.execute((transaction) =>
            transaction
              .all<AssistantItemRow>(
                `SELECT id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                 FROM agent_assistant_items WHERE run_id = ?
                 ORDER BY sequence, id`,
                context.req.param("id"),
              )
              .map(assistantItem),
          );
          return context.json(items);
        }),
    },
    {
      id: "agents:typed-run-events",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-runs/:id/events", async (context) => {
          const runId = context.req.param("id");
          if (!findRun(runId))
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          const headerCursor = Number(
            context.req.header("Last-Event-ID") ?? "0",
          );
          const queryCursor = Number(context.req.query("cursor") ?? "0");
          const afterCursor =
            Number.isFinite(headerCursor) && headerCursor > 0
              ? headerCursor
              : Number.isFinite(queryCursor) && queryCursor > 0
                ? queryCursor
                : 0;
          const isForRun = (event: { payload: unknown }): boolean =>
            isRecord(event.payload) && event.payload.runId === runId;
          return streamSSE(context as unknown as Context, async (stream) => {
            for (const event of pluginContext.events.replay(afterCursor)) {
              if (!isForRun(event)) continue;
              await stream.writeSSE({
                event: event.type,
                id: String(event.cursor),
                data: JSON.stringify(event),
              });
            }
            await new Promise<void>((resolve) => {
              const unsubscribe = pluginContext.events.subscribeLive(
                (event) => {
                  if (!isForRun(event)) return;
                  void stream.writeSSE({
                    event: event.type,
                    id: event.id,
                    data: JSON.stringify(event),
                  });
                },
              );
              stream.onAbort(() => {
                void unsubscribe();
                resolve();
              });
            });
          });
        }),
    },
    {
      id: "agents:typed-runs-steer",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-runs/:id/steer", async (context) => {
          const run = findRun(context.req.param("id"));
          const session = run ? findSession(run.session_id) : undefined;
          const body = await context.req.json().catch(() => undefined);
          const prompt = isRecord(body)
            ? assistantMessage(body.prompt)
            : undefined;
          if (!run || !session)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          if (!prompt)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "引导消息不能为空或过长。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法引导本地智能引擎。",
            );
          try {
            await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).steer({ runId: run.id }, prompt);
            const now = new Date().toISOString();
            pluginContext.uow.execute((transaction) => {
              transaction.append({
                type: "agents.run-steered.v1",
                pluginId: "agents",
                aggregateType: "agent-run",
                aggregateId: run.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, runId: run.id },
              });
            });
            pluginContext.events.publishLive({
              type: "agents.run-steered.v1",
              payload: {
                sessionId: session.id,
                runId: run.id,
                occurredAt: now,
              },
            });
            return context.body(null, 204);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "无法引导 Agent 运行。";
            const unsupported = /does not support|unsupported/i.test(message);
            return problem(
              context,
              unsupported ? 422 : 503,
              unsupported ? "UNSUPPORTED_OPERATION" : "ENGINE_UNAVAILABLE",
              message,
            );
          }
        }),
    },
    {
      id: "agents:typed-runs-interrupt",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-runs/:id/interrupt", async (context) => {
          const run = findRun(context.req.param("id"));
          if (!run)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          try {
            return context.json(await stopRun(run, "interrupted"));
          } catch (error) {
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              error instanceof Error ? error.message : "无法停止 Agent 运行。",
            );
          }
        }),
    },
    {
      id: "agents:typed-runs-resume",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-runs/:id/resume", async (context) => {
          const run = findRun(context.req.param("id"));
          const session = run ? findSession(run.session_id) : undefined;
          if (!run || !session)
            return problem(
              context,
              404,
              "NOT_FOUND",
              "未找到可恢复的 Agent 运行。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法恢复本地智能引擎。",
            );
          try {
            const restored = await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).resume({
              sessionId: session.id,
              engineSessionId: session.engine_session_id,
            });
            const resumed = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET engine_session_id = ?, status = 'idle', updated_at = ?, last_opened_at = ?
                 WHERE id = ?`,
                restored.engineSessionId,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.run-resumed.v1",
                pluginId: "agents",
                aggregateType: "agent-run",
                aggregateId: run.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, runId: run.id },
              });
              return assistantRun(
                transaction.get<AssistantRunRow>(
                  `SELECT id, session_id, task_id, task_type, engine_kind, status,
                          model_json, turn_id, chapter_id, error, started_at, completed_at,
                          created_at, updated_at FROM agent_assistant_runs WHERE id = ?`,
                  run.id,
                )!,
              );
            });
            return context.json(resumed);
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法恢复 Agent 会话。",
            );
          }
        }),
    },
    {
      id: "agents:typed-sessions-fork",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-sessions/:id/fork", async (context) => {
          const source = findSession(context.req.param("id"));
          if (!source)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法复制本地智能会话。",
            );
          try {
            const id = crypto.randomUUID();
            const forkedEngineSession = await createHostAgentRuntime(
              host,
              source.engine_kind as AgentEngineKind,
            ).fork(
              {
                sessionId: source.id,
                engineSessionId: source.engine_session_id,
              },
              { sessionId: id },
            );
            const fork = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `INSERT INTO agent_assistant_sessions(
                  id, engine_session_id, engine_kind, project_id, surface, chapter_id,
                  task_type, title, model_json, status, archived_at, last_opened_at,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
                id,
                forkedEngineSession.engineSessionId,
                source.engine_kind,
                source.project_id,
                source.surface,
                source.chapter_id,
                source.task_type,
                source.title,
                source.model_json,
                now,
                now,
                now,
              );
              transaction.append({
                type: "agents.session-forked.v1",
                pluginId: "agents",
                aggregateType: "agent-session",
                aggregateId: id,
                aggregateVersion: 1,
                payload: { sourceSessionId: source.id, sessionId: id },
              });
              return assistantSession(
                transaction.get<AssistantSessionRow>(
                  `SELECT id, engine_session_id, engine_kind, project_id, surface,
                          chapter_id, task_type, title, model_json, status, archived_at,
                          last_opened_at, created_at, updated_at
                   FROM agent_assistant_sessions WHERE id = ?`,
                  id,
                )!,
              );
            });
            return context.json(fork, 201);
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法复制 Agent 会话。",
            );
          }
        }),
    },
    {
      id: "agents:typed-sessions-dispose",
      pluginId: "agents",
      bind: (routes) =>
        routes.delete("/api/v2/agent-sessions/:id", async (context) => {
          const session = findSession(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法释放本地智能会话。",
            );
          try {
            await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).dispose({
              sessionId: session.id,
              engineSessionId: session.engine_session_id,
            });
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法释放 Agent 会话。",
            );
          }
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `DELETE FROM agent_assistant_items WHERE run_id IN (
                 SELECT id FROM agent_assistant_runs WHERE session_id = ?
               )`,
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_runs WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_turns WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_sessions WHERE id = ?",
              session.id,
            );
            transaction.append({
              type: "agents.session-disposed.v1",
              pluginId: "agents",
              aggregateType: "agent-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
          });
          return context.body(null, 204);
        }),
    },
    {
      id: "agents:typed-sessions-abort",
      pluginId: "agents",
      bind: (routes) =>
        routes.post("/api/v2/agent-sessions/:id/abort", async (context) => {
          const run = pluginContext.uow.execute((transaction) =>
            transaction.get<AssistantRunRow>(
              `SELECT id, session_id, task_id, task_type, engine_kind, status,
                      model_json, turn_id, chapter_id, error, started_at, completed_at,
                      created_at, updated_at
               FROM agent_assistant_runs
               WHERE session_id = ? AND status IN (
                 'created', 'queued', 'preparing', 'running',
                 'waiting_approval', 'committing', 'recoverable'
               )
               ORDER BY created_at DESC LIMIT 1`,
              context.req.param("id"),
            ),
          );
          if (!run) return context.json({ ok: true });
          try {
            await stopRun(run, "aborted");
            return context.json({ ok: true });
          } catch (error) {
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              error instanceof Error ? error.message : "无法停止 Agent 会话。",
            );
          }
        }),
    },
  ];
}
