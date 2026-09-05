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
} from "../providers/routes.js";
import { engineResponseText } from "../sessions/routes.js";
import { AGENT_TASK_CATALOG, taskPrompt } from "../task-catalog.js";
export function createAgentTaskRunner(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  agentContext: AgentContextService,
): AgentTaskRunnerService {
  return {
    start: async (input) => {
      if (!host)
        throw new Error(
          "当前 Runtime 未连接 Desktop Host，无法调用本地智能引擎。",
        );
      const health = hostEngineHealth(
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
      const model = input.model ? modelSelection(input.model) : undefined;
      if (input.model && !model) throw new Error("模型配置格式无效。");
      if (model?.providerId && model.providerId !== activeProvider)
        throw new Error("所选模型不属于当前启用的智能模型服务商。");
      const sessionId = crypto.randomUUID();
      const runId = crypto.randomUUID();
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
      const contextPreview = agentContext.createPreview({
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
          provider: input.engineKind === "codex" ? "codex" : activeProvider!,
          ...(model?.modelId ? { model: model.modelId } : {}),
        },
        temporaryOverrides: [],
      });
      const contextSnapshot = agentContext.freeze(
        contextPreview.id,
        contextPreview.version,
      );
      if (!contextSnapshot) throw new Error("AI 上下文预览在模型调用前失效。");
      const engineSession = await runtime.createSession({
        sessionId,
        title: input.taskType,
        projectId: input.projectId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(model ? { model } : {}),
      });
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
      const finish = async () => {
        let content = "";
        let output: unknown;
        try {
          for await (const event of runtime.subscribe(engineRun)) {
            pluginContext.uow.execute((transaction) =>
              transaction.run(
                `UPDATE agent_assistant_runs
                 SET last_engine_cursor = ?, updated_at = ? WHERE id = ?`,
                event.cursor,
                new Date().toISOString(),
                runId,
              ),
            );
            if (event.type === "content.delta") {
              content = `${content}${event.delta}`.slice(0, 500_000);
              pluginContext.events.publishLive({
                type: "agents.assistant-item-delta.v1",
                payload: { sessionId, runId, delta: event.delta },
              });
            }
            if (event.type === "result") output = event.result;
            if (event.type === "error") throw new Error(event.message);
          }
          const response = engineResponseText(output) ?? content.trim();
          if (!response) throw new Error("智能引擎未返回可验证的文本结果。");
          const itemId = crypto.randomUUID();
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
              ) VALUES (?, ?, 1, 'message', 'completed', ?, NULL, ?, ?)`,
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
            descriptor?.writePolicy === "change-preview" &&
            input.chapterId &&
            input.baseVersion !== undefined
          )
            pluginContext.services
              .optional<AutomationPreviewService>(AUTOMATION_PREVIEW_SERVICE)
              ?.createChange({
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
          pluginContext.events.publishLive({
            type: "agents.run-completed.v1",
            payload: { sessionId, runId, itemId },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "智能引擎运行失败。";
          const failedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
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
          pluginContext.events.publishLive({
            type: "agents.run-failed.v1",
            payload: { sessionId, runId, error: message },
          });
        }
      };
      void finish().catch(() => undefined);
      return { taskId, sessionId, runId };
    },
  };
}
