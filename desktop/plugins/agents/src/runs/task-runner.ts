import { optionalService } from "@dramaip/plugin-api/internal";
import {
  type AgentContextService,
  type AgentTaskRunnerService,
} from "@dramaip/contracts";
import {
  AUTOMATION_PREVIEW_SERVICE,
  type AutomationPreviewService,
} from "@dramaip/contracts/automation";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import { type PluginContext } from "@dramaip/plugin-api/internal";
import {
  activeAgentProviderId,
  configuredProvider,
  engineDefinitions,
  findProvider,
  hostEngineHealth,
  modelSelection,
  isAgentEngineKind,
  projectAgentSettings,
  restoreActiveAgentProvider,
} from "../providers/routes.js";
import { engineResponseText } from "../sessions/routes.js";
import { AGENT_TASK_CATALOG, taskPrompt } from "../task-catalog.js";
import { recordAgentUsage, readAgentUsagePage } from "./usage.js";
import { readAgentRunExecution } from "./execution.js";
const MODEL_REQUIRED =
  "请在 AI 连接中选择本次使用的模型，工作流会固定这一选择。";
export function createAgentTaskRunner(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  agentContext: AgentContextService,
): AgentTaskRunnerService {
  const active = new Map<string, () => Promise<void>>();
  let disposed = false;
  pluginContext.effect(
    () => async () => {
      disposed = true;
      await Promise.allSettled([...active.values()].map((stop) => stop()));
      active.clear();
    },
    "worker:managed-agent-runs",
  );
  const readRun = (id: string) =>
    pluginContext.uow.execute((transaction) => {
      const row = transaction.get<{
        status: string;
        task_id: string;
        session_id: string;
        context_snapshot_id: string | null;
        error: string | null;
      }>(
        "SELECT status, task_id, session_id, context_snapshot_id, error FROM agent_assistant_runs WHERE id = ?",
        id,
      );
      if (!row) return undefined;
      const item = transaction.get<{ content: string }>(
        "SELECT content FROM agent_assistant_items WHERE run_id = ? AND type = 'message' AND status = 'completed' ORDER BY sequence DESC LIMIT 1",
        id,
      );
      return {
        taskId: row.task_id,
        status: row.status,
        sessionId: row.session_id,
        content: item?.content,
        error: row.error ?? undefined,
        contextSnapshotId: row.context_snapshot_id ?? undefined,
      };
    });
  const prepare = (
    input: import("@dramaip/contracts").AgentCreationContextInput,
  ) => {
    if (input.conversationId) {
      const session = pluginContext.uow.execute((tx) =>
        tx.get<{ project_id: string | null; chapter_id: string | null }>(
          "SELECT project_id, chapter_id FROM agent_assistant_sessions WHERE id = ?",
          input.conversationId!,
        ),
      );
      if (
        !session ||
        session.project_id !== input.projectId ||
        (session.chapter_id && session.chapter_id !== input.chapterId)
      )
        throw new Error(
          "创作对象与原对话绑定不一致，请进入对应对象或新建对话。",
        );
    }
    const chosen =
      input.model === undefined
        ? projectAgentSettings(pluginContext, input.projectId).defaultModel
        : input.model;
    const selected = chosen === undefined ? undefined : modelSelection(chosen);
    if (chosen !== undefined && !selected) {
      if (
        chosen !== null &&
        typeof chosen === "object" &&
        !Array.isArray(chosen) &&
        Object.keys(chosen).length === 0
      )
        throw new Error(MODEL_REQUIRED);
      throw new Error(
        "模型配置无效；仅支持 providerId、modelId、profileId，不会忽略其他参数。",
      );
    }
    const providerId = activeAgentProviderId(pluginContext);
    const entity = providerId
      ? findProvider(pluginContext, providerId)
      : undefined;
    const provider = entity ? configuredProvider(entity) : undefined;
    const model = {
      ...selected,
      ...(input.engineKind !== "codex"
        ? {
            providerId: selected?.providerId ?? providerId,
            modelId: selected?.modelId ?? provider?.model,
          }
        : {}),
    };
    if (!model.modelId) throw new Error(MODEL_REQUIRED);
    const contextInput = {
      projectId: input.projectId,
      chapterId: input.chapterId,
      runIntent: "creation",
      basePrompt: input.prompt,
      tokenBudget: 64000,
      destination: {
        kind:
          provider?.authentication === "none"
            ? ("local" as const)
            : ("cloud" as const),
        provider:
          input.engineKind === "codex"
            ? "codex"
            : (providerId ?? "unconfigured"),
        model: model.modelId,
      },
      temporaryOverrides: [],
    };
    return { model, contextInput };
  };
  return {
    configuration: (projectId) => {
      const settings = projectAgentSettings(pluginContext, projectId);
      if (!isAgentEngineKind(settings.defaultEngineKind))
        throw new Error("项目引擎设置无效。");
      return {
        engineKind: settings.defaultEngineKind,
        model: modelSelection(settings.defaultModel)
          ? { ...modelSelection(settings.defaultModel) }
          : undefined,
      };
    },
    previewCreation: (input) => {
      const { model, contextInput } = prepare(input);
      if (!agentContext.previewCreation)
        throw new Error("上下文服务不支持无写入创作预检。");
      return {
        model,
        preview: agentContext.previewCreation(contextInput, input.references),
      };
    },
    prepareCreation: (input) => {
      const { model, contextInput } = prepare(input);
      if (!agentContext.prepareCreation)
        throw new Error("上下文服务不支持冻结业务资料。");
      return {
        model,
        snapshot: agentContext.prepareCreation(contextInput, input.references),
      };
    },
    get: readRun,
    usage: (runId, projectId, cursor, limit = 25) =>
      pluginContext.uow.execute((tx) =>
        readAgentUsagePage(tx, runId, projectId, cursor, limit),
      ),
    execution: (runId, projectId) =>
      pluginContext.uow.execute((tx) =>
        readAgentRunExecution(tx, runId, projectId),
      ),
    cancel: async (id) => {
      const stop = active.get(id);
      if (stop) await stop();
      else {
        const run = readRun(id);
        if (
          run &&
          !["completed", "failed", "canceled", "interrupted"].includes(
            run.status,
          )
        )
          throw new Error("原引擎运行尚未恢复，无法确认取消。请先恢复连接。");
      }
    },
    start: async (input) => {
      if (disposed) throw new Error("引擎执行器正在关闭。");
      if (input.runId) {
        const existing = readRun(input.runId);
        if (existing)
          return {
            taskId: existing.taskId,
            sessionId: existing.sessionId,
            runId: input.runId,
          };
      }
      const model =
        input.model === undefined ? undefined : modelSelection(input.model);
      if (input.model !== undefined && !model)
        throw new Error(
          "模型配置无效；仅支持 providerId、modelId、profileId，不会忽略其他参数。",
        );
      if (!host)
        throw new Error(
          "当前 Runtime 未连接 Desktop Host，无法调用本地智能引擎。",
        );
      let health = hostEngineHealth(
        await host.engineHealth(input.engineKind).catch(() => undefined),
      );
      if (!health.available || !health.healthy)
        throw new Error(
          `${engineDefinitions[input.engineKind].name} 引擎当前不可用。`,
        );
      const activeProvider = activeAgentProviderId(pluginContext);
      if (
        (input.engineKind === "codex" && !health.authenticated) ||
        (input.engineKind !== "codex" && !activeProvider)
      )
        throw new Error(
          input.engineKind === "codex"
            ? "请先完成 Codex 认证。"
            : "请先将一项模型服务设为智能助手模型。",
        );
      if (model?.providerId && model.providerId !== activeProvider)
        throw new Error("所选模型不属于当前启用的智能模型服务商。");
      // A healthy transport can precede saved provider reconciliation after
      // Desktop restart. Restore only the explicitly active provider before
      // creating a session; never switch engines/models or invoke an
      // unconfigured sidecar while waiting for the periodic reconciler.
      if (input.engineKind !== "codex" && !health.configured) {
        if (!(await restoreActiveAgentProvider(pluginContext, host)))
          throw new Error(
            "已保存模型配置尚未恢复到引擎，请检查凭据与引擎状态后重试。",
          );
        health = hostEngineHealth(
          await host.engineHealth(input.engineKind).catch(() => undefined),
        );
        if (!health.available || !health.healthy || !health.configured)
          throw new Error(
            "所选引擎尚未接受已保存模型配置，不会换用其他引擎或模型。",
          );
      }
      const sessionId = crypto.randomUUID();
      const runId = input.runId ?? crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const turnId = crypto.randomUUID();
      const capabilityGrantId = crypto.randomUUID();
      const runtime = createHostAgentRuntime(host, input.engineKind);
      const basePrompt = taskPrompt(input.taskType, input.prompt);
      const providerEntity = activeProvider
        ? findProvider(pluginContext, activeProvider)
        : undefined;
      const provider = providerEntity
        ? configuredProvider(providerEntity)
        : undefined;
      const loopback =
        provider?.authentication === "none" &&
        Boolean(provider.localRuntimeKind);
      const contextPreview = input.contextSnapshotId
        ? undefined
        : agentContext.createPreview({
            projectId: input.projectId,
            ...(input.chapterId ? { chapterId: input.chapterId } : {}),
            runIntent: input.taskType,
            basePrompt,
            ...(input.selection === undefined
              ? {}
              : { selection: JSON.parse(JSON.stringify(input.selection)) }),
            tokenBudget: 64_000,
            destination: {
              kind: loopback ? "local" : "cloud",
              provider:
                input.engineKind === "codex" ? "codex" : activeProvider!,
              ...(model?.modelId ? { model: model.modelId } : {}),
            },
            temporaryOverrides: [],
          });
      const contextSnapshot = input.contextSnapshotId
        ? input.deriveContext
          ? agentContext.deriveCreation?.(input.contextSnapshotId, basePrompt)
          : agentContext.getSnapshot(input.contextSnapshotId)
        : agentContext.freeze(contextPreview!.id, contextPreview!.version);
      if (!contextSnapshot) throw new Error("AI 上下文预览在模型调用前失效。");
      if (contextSnapshot.projectId !== input.projectId)
        throw new Error("上下文快照不属于当前项目。");
      const engineSession = await runtime.createSession({
        sessionId,
        title: input.taskType,
        projectId: input.projectId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(model ? { model } : {}),
      });
      if (disposed) {
        await runtime.dispose(engineSession);
        throw new Error("引擎执行器已经关闭。");
      }
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      pluginContext.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO agent_assistant_sessions(
            id, engine_session_id, engine_kind, project_id, surface, chapter_id,
            task_type, title, model_json, status, archived_at, last_opened_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'novel', ?, ?, ?, ?, 'running', NULL, ?, ?, ?)`,
          sessionId,
          engineSession.engineSessionId,
          input.engineKind,
          input.projectId,
          input.chapterId ?? null,
          input.taskType,
          input.taskType,
          model ? JSON.stringify(model) : null,
          now,
          now,
          now,
        );
        transaction.run(
          `INSERT INTO agent_assistant_turns(
            id, session_id, run_id, user_message, project_id, chapter_id,
            selection_json, route_json, status, error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
          turnId,
          sessionId,
          runId,
          input.prompt,
          input.projectId,
          input.chapterId ?? null,
          input.selection === undefined
            ? null
            : JSON.stringify(input.selection),
          JSON.stringify({
            kind: "task",
            taskType: input.taskType,
            source: "typed-service",
          }),
          now,
          now,
        );
        transaction.run(
          `INSERT INTO agent_assistant_runs(
            id, session_id, task_id, task_type, engine_kind, status, model_json,
            turn_id, chapter_id, context_snapshot_id, error, started_at,
            completed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
          runId,
          sessionId,
          taskId,
          input.taskType,
          input.engineKind,
          model ? JSON.stringify(model) : null,
          turnId,
          input.chapterId ?? null,
          contextSnapshot.id,
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
          expiresAt,
          JSON.stringify(["mcp.readonly"]),
          now,
        );
        transaction.append({
          type: "agents.run-started.v1",
          pluginId: "agents",
          aggregateType: "agent-run",
          aggregateId: runId,
          aggregateVersion: 1,
          payload: {
            sessionId,
            runId,
            taskId,
            taskType: input.taskType,
            contextSnapshotId: contextSnapshot.id,
            contextManifestSha256: contextSnapshot.manifestSha256,
          },
        });
      });
      let engineRun: Awaited<ReturnType<typeof runtime.prompt>>;
      try {
        const engineHealth = await runtime.health();
        engineRun = await runtime.prompt(
          { sessionId, engineSessionId: engineSession.engineSessionId },
          {
            runId,
            prompt: contextSnapshot.finalPrompt,
            responseMode: "structured",
            capabilityGrant: {
              endpoint: "",
              token: capabilityGrantId,
              expiresAt,
            },
          },
        );
        pluginContext.uow.execute((transaction) =>
          transaction.run(
            `UPDATE agent_assistant_runs
             SET status = 'running', engine_run_id = ?, engine_generation = ?,
                 recovery_error = NULL, updated_at = ? WHERE id = ?`,
            engineRun.engineRunId ?? engineRun.runId,
            engineHealth.generation,
            new Date().toISOString(),
            runId,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "智能引擎拒绝了运行。";
        pluginContext.uow.execute((transaction) => {
          const failedAt = new Date().toISOString();
          transaction.run(
            "UPDATE agent_assistant_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            message,
            failedAt,
            failedAt,
            runId,
          );
          transaction.run(
            "UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            message,
            failedAt,
            turnId,
          );
          transaction.run(
            "UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?",
            failedAt,
            sessionId,
          );
          transaction.run(
            "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
            failedAt,
            capabilityGrantId,
          );
        });
        throw error;
      }
      let canceled = false;
      const stop = async () => {
        if (
          ["completed", "failed", "canceled"].includes(
            readRun(runId)?.status ?? "",
          )
        )
          return;
        canceled = true;
        try {
          await runtime.abort(engineRun);
        } catch (error) {
          pluginContext.uow.execute((tx) =>
            tx.run(
              "UPDATE agent_assistant_runs SET status = 'interrupted', error = ?, updated_at = ? WHERE id = ?",
              "取消请求未确认，迟到结果已隔离，请恢复连接后重试。",
              new Date().toISOString(),
              runId,
            ),
          );
          throw error;
        }
        pluginContext.uow.execute((transaction) => {
          const at = new Date().toISOString();
          transaction.run(
            "UPDATE agent_assistant_runs SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?",
            at,
            at,
            runId,
          );
          transaction.run(
            "UPDATE agent_assistant_turns SET status = 'canceled', updated_at = ? WHERE id = ?",
            at,
            turnId,
          );
          transaction.run(
            "UPDATE agent_assistant_sessions SET status = 'idle', updated_at = ? WHERE id = ?",
            at,
            sessionId,
          );
          transaction.run(
            "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
            at,
            capabilityGrantId,
          );
          transaction.run(
            "UPDATE agent_assistant_items SET status = 'failed', updated_at = ? WHERE run_id = ? AND status IN ('started', 'streaming')",
            at,
            runId,
          );
          transaction.append({
            type: "agents.run-canceled.v1",
            pluginId: "agents",
            aggregateType: "agent-run",
            aggregateId: runId,
            aggregateVersion: 1,
            payload: { sessionId, runId },
          });
        });
      };
      active.set(runId, stop);
      const finish = async () => {
        let content = "";
        let output: unknown;
        const itemId = crypto.randomUUID();
        const activityId = crypto.randomUUID();
        let thinking = false;
        let lastActivityAt = 0;
        const toolItems = new Map<string, { id: string; sequence: number }>();
        try {
          for await (const event of runtime.subscribe(engineRun)) {
            if (canceled) return;
            const occurredAt = new Date().toISOString();
            if (event.type === "activity" && Date.now() - lastActivityAt < 1000)
              continue;
            if (
              event.type === "activity" ||
              (thinking && event.type === "content.delta")
            ) {
              thinking = event.type === "activity";
              lastActivityAt = Date.now();
              const activity = thinking
                ? "模型正在分析创作要求"
                : "模型已开始返回内容";
              const status = thinking ? "started" : "completed";
              pluginContext.uow.execute((tx) =>
                tx.run(
                  `INSERT INTO agent_assistant_items(id, run_id, sequence, type, status, content, created_at, updated_at)
                 VALUES (?, ?, 2, 'stage', ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET status = excluded.status, content = excluded.content, updated_at = excluded.updated_at`,
                  activityId,
                  runId,
                  status,
                  activity,
                  occurredAt,
                  occurredAt,
                ),
              );
              pluginContext.domainEvents.publishLive({
                type: thinking
                  ? "agents.assistant-item-started.v1"
                  : "agents.assistant-item-completed.v1",
                payload: {
                  sessionId,
                  runId,
                  itemId: activityId,
                  type: "stage",
                  status,
                  content: activity,
                  occurredAt,
                },
              });
            }
            if (event.type === "content.delta")
              content = `${content}${event.delta}`.slice(0, 500_000);
            pluginContext.uow.execute((transaction) => {
              if (event.type === "usage") {
                recordAgentUsage(transaction, {
                  runId,
                  engineRunId: engineRun.engineRunId ?? engineRun.runId,
                  engineKind: input.engineKind,
                  cursor: event.cursor,
                  usage: event.usage,
                  recordedAt: occurredAt,
                });
                return;
              }
              transaction.run(
                `UPDATE agent_assistant_runs
                 SET last_engine_cursor = ?, updated_at = ? WHERE id = ?`,
                event.cursor,
                occurredAt,
                runId,
              );
              if (event.type === "content.delta")
                transaction.run(
                  `INSERT INTO agent_assistant_items(
                    id, run_id, sequence, type, status, content, created_at, updated_at
                  ) VALUES (?, ?, 1, 'message', 'streaming', ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
                  itemId,
                  runId,
                  content,
                  occurredAt,
                  occurredAt,
                );
            });
            if (event.type === "content.delta") {
              pluginContext.domainEvents.publishLive({
                type: "agents.assistant-item-delta.v1",
                payload: {
                  sessionId,
                  runId,
                  itemId,
                  delta: event.delta,
                  content,
                  occurredAt,
                },
              });
            }
            if (event.type === "tool") {
              const toolKey = event.itemId ?? event.tool;
              const item = toolItems.get(toolKey) ?? {
                id: crypto.randomUUID(),
                sequence: toolItems.size + 3,
              };
              toolItems.set(toolKey, item);
              const activity =
                event.status === "started"
                  ? "正在读取项目资料"
                  : event.status === "completed"
                    ? "项目资料读取完成"
                    : "项目资料读取失败";
              pluginContext.uow.execute((tx) =>
                tx.run(
                  `INSERT INTO agent_assistant_items(
                  id, run_id, sequence, type, status, content, created_at, updated_at
                ) VALUES (?, ?, ?, 'stage', ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status, content = excluded.content, updated_at = excluded.updated_at`,
                  item.id,
                  runId,
                  item.sequence,
                  event.status,
                  activity,
                  occurredAt,
                  occurredAt,
                ),
              );
              pluginContext.domainEvents.publishLive({
                type:
                  event.status === "started"
                    ? "agents.assistant-item-started.v1"
                    : "agents.assistant-item-completed.v1",
                payload: {
                  sessionId,
                  runId,
                  itemId: item.id,
                  type: "stage",
                  status: event.status,
                  content: activity,
                  occurredAt,
                },
              });
            }
            if (event.type === "result") output = event.result;
            if (event.type === "error") throw new Error(event.message);
          }
          const response = engineResponseText(output) ?? content.trim();
          if (canceled) return;
          if (!response) throw new Error("智能引擎未返回可验证的文本结果。");
          const completedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) =>
            transaction.run(
              `UPDATE agent_assistant_runs
               SET status = 'committing', checkpoint_json = ?, updated_at = ?
               WHERE id = ?`,
              JSON.stringify({ itemId, response }),
              completedAt,
              runId,
            ),
          );
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_assistant_items(
                id, run_id, sequence, type, status, content, payload_json,
                created_at, updated_at
              ) VALUES (?, ?, 1, 'message', 'completed', ?, NULL, ?, ?)
              ON CONFLICT(id) DO UPDATE SET status = 'completed', content = excluded.content, updated_at = excluded.updated_at`,
              itemId,
              runId,
              response,
              completedAt,
              completedAt,
            );
            transaction.run(
              "UPDATE agent_assistant_runs SET status = 'completed', completed_at = ?, recovery_error = NULL, updated_at = ? WHERE id = ?",
              completedAt,
              completedAt,
              runId,
            );
            transaction.run(
              "UPDATE agent_assistant_turns SET status = 'succeeded', updated_at = ? WHERE id = ?",
              completedAt,
              turnId,
            );
            transaction.run(
              "UPDATE agent_assistant_sessions SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?",
              completedAt,
              completedAt,
              sessionId,
            );
            transaction.run(
              "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
              completedAt,
              capabilityGrantId,
            );
            transaction.append({
              type: "agents.run-completed.v1",
              pluginId: "agents",
              aggregateType: "agent-run",
              aggregateId: runId,
              aggregateVersion: 1,
              payload: { sessionId, runId, itemId },
            });
          });
          const descriptor = AGENT_TASK_CATALOG.find(
            (candidate) => candidate.id === input.taskType,
          );
          if (
            !input.managed &&
            descriptor?.writePolicy === "change-preview" &&
            input.chapterId &&
            input.baseVersion !== undefined
          )
            optionalService<AutomationPreviewService>(
              pluginContext,
              AUTOMATION_PREVIEW_SERVICE,
            )?.createChange({
              projectId: input.projectId,
              sessionId,
              runId,
              taskId,
              engineKind: input.engineKind,
              taskType: input.taskType,
              targets: [
                {
                  kind: "chapter",
                  id: input.chapterId,
                  baseVersion: input.baseVersion,
                  patch: { content: response },
                  displayDiff: { candidate: response },
                },
              ],
              rationale: "Agent 输出已转换为待人工确认的章节变更预览。",
            });
          pluginContext.domainEvents.publishLive({
            type: "agents.run-completed.v1",
            payload: { sessionId, runId, itemId },
          });
        } catch (error) {
          if (canceled) return;
          const message =
            error instanceof Error ? error.message : "智能引擎运行失败。";
          const failedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              "UPDATE agent_assistant_items SET status = 'failed', updated_at = ? WHERE run_id = ? AND status IN ('started', 'streaming')",
              failedAt,
              runId,
            );
            transaction.run(
              "UPDATE agent_assistant_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
              message,
              failedAt,
              failedAt,
              runId,
            );
            transaction.run(
              "UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
              message,
              failedAt,
              turnId,
            );
            transaction.run(
              "UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?",
              failedAt,
              sessionId,
            );
            transaction.run(
              "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
              failedAt,
              capabilityGrantId,
            );
            transaction.append({
              type: "agents.run-failed.v1",
              pluginId: "agents",
              aggregateType: "agent-run",
              aggregateId: runId,
              aggregateVersion: 1,
              payload: { sessionId, runId, error: message },
            });
          });
          pluginContext.domainEvents.publishLive({
            type: "agents.run-failed.v1",
            payload: { sessionId, runId, error: message },
          });
        }
      };
      if (disposed) {
        await stop();
        throw new Error("引擎执行器已经关闭。");
      }
      const done = finish().finally(() => active.delete(runId));
      void done.catch(() => undefined);
      return { taskId, sessionId, runId };
    },
  };
}
