import { optionalService } from "@dramaip/plugin-api/internal";
import {
  CREATION_WORKFLOW_SERVICE,
  type CreationInput,
} from "@dramaip/contracts/creation";
import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import {
  AGENT_TASK_RUNNER_SERVICE,
  ProblemDetailsSchema,
  type AgentTaskRunnerService,
} from "@dramaip/contracts";
import {
  AUTOMATION_TASK_SERVICE,
  type AutomationTaskService,
} from "@dramaip/contracts/automation";
import {
  CREATIVE_QUALITY_SERVICE,
  type CreativeQualityRecordService,
} from "@dramaip/contracts/creative-quality";
import {
  ChapterAgentRunInputSchema,
  ChapterAgentRunStartSchema,
  ChapterAnalysisRunResultSchema,
  ContentVersionRestoreResultSchema,
  ContentVersionSchema,
  ContinueChapterAgentRunInputSchema,
  ContinueChapterAgentRunStartSchema,
  type Chapter,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
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
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

interface VersionRow {
  id: string;
  chapter_id: string;
  version_number: number;
  snapshot_json: string;
  created_at: string;
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

function declaration(input: {
  method: "get" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 202;
}) {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["writing"],
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
    ...(metadata.id === "writing:continue-chapter"
      ? { policy: { idempotencyReplay: "handler" as const } }
      : {}),
    declaration: openapi,
    handler,
  });
}

function key(context: RouteContext): string | undefined {
  const value = context.req.header("Idempotency-Key")?.trim();
  return value && value.length >= 8 && value.length <= 200 ? value : undefined;
}

function replay(
  context: PluginContext,
  scope: string,
  idempotencyKey: string,
): unknown | undefined {
  return context.uow.execute((transaction) => {
    const found = transaction.get<{ response_json: string }>(
      "SELECT response_json FROM writing_idempotency WHERE scope = ? AND idempotency_key = ?",
      scope,
      idempotencyKey,
    );
    return found ? JSON.parse(found.response_json) : undefined;
  });
}

function recordReplay(
  context: PluginContext,
  scope: string,
  idempotencyKey: string,
  response: unknown,
): void {
  context.uow.execute((transaction) =>
    transaction.run(
      "INSERT INTO writing_idempotency(scope, idempotency_key, response_json, created_at) VALUES (?, ?, ?, ?)",
      scope,
      idempotencyKey,
      JSON.stringify(response),
      new Date().toISOString(),
    ),
  );
}

function score(value: number, threshold: number): number {
  return Math.max(
    1,
    Math.min(10, Math.round((value / Math.max(1, threshold)) * 7 + 3)),
  );
}

export const writingAdvancedMigrations: readonly PluginMigration[] = [
  {
    id: "writing.0003.idempotency",
    pluginId: "writing",
    version: "3.0.0-alpha.3",
    dependsOn: ["writing.0002.resources"],
    sql: `
      CREATE TABLE IF NOT EXISTS writing_idempotency (
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, idempotency_key)
      );
    `,
  },
];

export function writingAdvancedRoutes(
  context: PluginContext,
  chapters: WritingChapterService,
  createContinuation: (proposal: Chapter) => Chapter,
): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  const continuations = new Map<
    string,
    { hash: string; response: Promise<Response> }
  >();
  let disposed = false;
  context.effect(
    () => () => {
      disposed = true;
      continuations.clear();
    },
    "requests:continue-chapter",
  );
  return [
    route(
      {
        id: "writing:chapter-agent-run",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/chapters/{id}/agent-runs",
        operationId: "novel-workspace.runChapterAgent",
      },
      declaration({
        method: "post",
        path: "/api/v2/chapters/{id}/agent-runs",
        operationId: "novel-workspace.runChapterAgent",
        params: idParams,
        body: ChapterAgentRunInputSchema,
        response: ChapterAgentRunStartSchema,
        status: 202,
      }),
      async (requestContext) => {
        const input = ChapterAgentRunInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const idempotencyKey = key(requestContext);
        if (!input.success || !idempotencyKey)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "Agent 运行参数或 Idempotency-Key 无效。",
          );
        const previous = replay(context, "chapter-agent-run", idempotencyKey);
        if (previous) return requestContext.json(previous, 202);
        const chapter = chapters.get(requestContext.req.param("id"));
        if (!chapter)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        if (chapter.version !== input.data.baseVersion)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "章节已变化，请刷新后重试。",
          );
        const runner = optionalService<AgentTaskRunnerService>(
          context,
          AGENT_TASK_RUNNER_SERVICE,
        );
        if (!runner)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "Agent Runtime 尚未就绪。",
          );
        try {
          const workflowService = optionalService(
            context,
            CREATION_WORKFLOW_SERVICE,
          );
          if (!workflowService) throw new Error("创作工作流未启用。");
          const created = workflowService.start(
            {
              projectId: chapter.projectId,
              operation: "chapter",
              targetId: chapter.id,
              baseVersion: chapter.version,
              engineKind: input.data.engineKind,
              model: input.data.model,
              instruction:
                input.data.prompt || "根据当前章节目标生成完整候选正文。",
              wordGoal: input.data.wordGoal,
              sourceIds: [],
            },
            idempotencyKey,
          );
          const workflow = await workflowService.launch(created.id);
          if (
            !workflow.runId ||
            !workflow.sessionId ||
            workflow.stage === "failed"
          )
            throw new Error(workflow.error ?? "创作运行未成功启动。");
          const started = {
            taskId: workflow.taskId,
            runId: workflow.runId,
            sessionId: workflow.sessionId,
          };
          const response = {
            ...started,
            chapterId: chapter.id,
            autoCommitWhenReady: false,
          };
          recordReplay(context, "chapter-agent-run", idempotencyKey, response);
          return requestContext.json(response, 202);
        } catch (error) {
          return problem(
            requestContext,
            409,
            "ENGINE_UNAVAILABLE",
            error instanceof Error ? error.message : "Agent 运行启动失败。",
          );
        }
      },
    ),
    route(
      {
        id: "writing:continue-chapter",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/projects/{id}/chapters/continue",
        operationId: "novel-workspace.continueChapter",
      },
      declaration({
        method: "post",
        path: "/api/v2/projects/{id}/chapters/continue",
        operationId: "novel-workspace.continueChapter",
        params: idParams,
        body: ContinueChapterAgentRunInputSchema,
        response: ContinueChapterAgentRunStartSchema,
        status: 202,
      }),
      async (requestContext) => {
        const input = ContinueChapterAgentRunInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const idempotencyKey = key(requestContext);
        if (!input.success || !idempotencyKey)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "续写参数或 Idempotency-Key 无效。",
          );
        const requestHash = createHash("sha256")
          .update(
            JSON.stringify({
              projectId: requestContext.req.param("id"),
              input: input.data,
            }),
          )
          .digest("hex");
        const pending = continuations.get(idempotencyKey);
        if (pending) {
          if (pending.hash !== requestHash)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "同一续章幂等标识不能用于不同项目、来源或创作要求。",
            );
          return (await pending.response).clone();
        }
        const run = async (): Promise<Response> => {
          if (disposed)
            return problem(
              requestContext,
              409,
              "CAPABILITY_UNAVAILABLE",
              "写作服务正在关闭。",
            );
          const targetReplay = replay(
            context,
            "continue-target",
            idempotencyKey,
          ) as { id?: string; requestHash?: string } | undefined;
          if (targetReplay && targetReplay.requestHash !== requestHash)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              targetReplay.requestHash
                ? "同一续章幂等标识不能用于不同项目、来源或创作要求。"
                : "历史续章目标缺少完整请求绑定，请从运行历史继续；不会用旧标识创建新的章节。",
            );
          const previous = replay(context, "continue-chapter", idempotencyKey);
          if (previous) return requestContext.json(previous, 202);
          const source = chapters.get(input.data.sourceChapterId);
          if (!source || source.projectId !== requestContext.req.param("id"))
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到要承接的章节。",
            );
          if (source.version !== input.data.baseVersion)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "上一章已变化，请刷新后重试。",
            );
          if (!source.content.trim())
            return problem(
              requestContext,
              409,
              "TASK_REJECTED",
              "请先完成当前章节正文。",
            );
          const runner = optionalService<AgentTaskRunnerService>(
            context,
            AGENT_TASK_RUNNER_SERVICE,
          );
          const workflowService = optionalService(
            context,
            CREATION_WORKFLOW_SERVICE,
          );
          if (!runner || !workflowService?.preflight)
            return problem(
              requestContext,
              409,
              "CAPABILITY_UNAVAILABLE",
              "创作运行或无写入预检尚未就绪，不创建续章。",
            );
          const all = chapters.list(source.projectId);
          const at = new Date().toISOString();
          const proposal: Chapter = {
            id: crypto.randomUUID(),
            projectId: source.projectId,
            title: `第 ${all.length + 1} 章`,
            orderIndex:
              all.reduce(
                (max, chapter) => Math.max(max, chapter.orderIndex),
                -1,
              ) + 1,
            summary: "",
            content: "",
            version: 0,
            createdAt: at,
            updatedAt: at,
          };
          const target = targetReplay?.id
            ? chapters.get(targetReplay.id)
            : proposal;
          if (!target || target.projectId !== source.projectId)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "续章目标已失效，请从当前章节重新发起。",
            );
          const creation: CreationInput = {
            projectId: source.projectId,
            operation: "chapter",
            targetId: target.id,
            baseVersion: target.version,
            engineKind: input.data.engineKind,
            model: input.data.model,
            instruction:
              input.data.prompt ||
              "承接上一章结尾与全书规划，推进新的剧情，生成下一章完整候选正文。",
            wordGoal: input.data.wordGoal,
            sourceIds: [],
            narrativeContextRequest: input.data.narrativeContextRequest ?? {
              format: "narrative-context-v1",
              chapters: [
                {
                  id: source.id,
                  version: source.version,
                  representation: "original",
                },
              ],
            },
          };
          try {
            // No await between real allocation/source checks and Writing's
            // create + normal workflow start. Peer transactions stay separate.
            workflowService.preflight(
              creation,
              targetReplay ? undefined : { prospectiveChapter: target },
            );
          } catch (error) {
            return problem(
              requestContext,
              409,
              "CONTEXT_REJECTED",
              error instanceof Error
                ? error.message
                : "续章来源预检失败，不创建空章节。",
            );
          }
          try {
            const next = targetReplay ? target : createContinuation(target);
            if (!targetReplay)
              recordReplay(context, "continue-target", idempotencyKey, {
                id: next.id,
                requestHash,
              });
            // Recompile/freeze the actual persisted target in the normal path.
            // Post-start failures retain this exact target and workflow.
            const created = workflowService.start(creation, idempotencyKey);
            const workflow = await workflowService.launch(created.id);
            if (
              !workflow.runId ||
              !workflow.sessionId ||
              workflow.stage === "failed"
            )
              throw new Error(workflow.error ?? "创作运行未成功启动。");
            const response = {
              chapter: next,
              run: {
                taskId: workflow.taskId,
                runId: workflow.runId,
                sessionId: workflow.sessionId,
                chapterId: next.id,
                autoCommitWhenReady: false,
              },
            };
            recordReplay(context, "continue-chapter", idempotencyKey, response);
            return requestContext.json(response, 202);
          } catch (error) {
            return problem(
              requestContext,
              409,
              "ENGINE_UNAVAILABLE",
              error instanceof Error
                ? error.message
                : "续写启动失败，已创建的目标与运行保留在历史中。",
            );
          }
        };
        const response = Promise.resolve().then(run);
        continuations.set(idempotencyKey, { hash: requestHash, response });
        try {
          return (await response).clone();
        } finally {
          if (continuations.get(idempotencyKey)?.response === response)
            continuations.delete(idempotencyKey);
        }
      },
    ),
    route(
      {
        id: "writing:content-versions-list",
        pluginId: "writing",
        method: "get",
        path: "/api/v2/projects/{id}/content-versions",
        operationId: "content-versions.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/content-versions",
        operationId: "content-versions.list",
        params: idParams,
        response: z.array(ContentVersionSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const byId = new Map(
          chapters.list(projectId).map((chapter) => [chapter.id, chapter]),
        );
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<VersionRow>(
                `SELECT version.* FROM writing_chapter_versions version
                 JOIN chapters chapter ON chapter.id = version.chapter_id
                 WHERE chapter.project_id = ? ORDER BY version.created_at DESC, version.id`,
                projectId,
              )
              .flatMap((row) => {
                const source = byId.get(row.chapter_id);
                return source
                  ? [
                      {
                        id: row.id,
                        projectId,
                        chapterId: row.chapter_id,
                        chapterTitle: source.title,
                        versionNumber: row.version_number,
                        snapshot: JSON.parse(row.snapshot_json),
                        createdAt: row.created_at,
                      },
                    ]
                  : [];
              }),
          ),
        );
      },
    ),
    route(
      {
        id: "writing:content-version-restore",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/content-versions/{id}/restore",
        operationId: "content-versions.restore",
      },
      declaration({
        method: "post",
        path: "/api/v2/content-versions/{id}/restore",
        operationId: "content-versions.restore",
        params: idParams,
        response: ContentVersionRestoreResultSchema,
      }),
      (requestContext) => {
        const version = context.uow.execute((transaction) =>
          transaction.get<VersionRow>(
            "SELECT * FROM writing_chapter_versions WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!version)
          return problem(requestContext, 404, "NOT_FOUND", "未找到内容版本。");
        const current = chapters.get(version.chapter_id);
        const snapshot = JSON.parse(version.snapshot_json) as Chapter;
        if (!current)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "版本目标章节已不存在。",
          );
        const restored = chapters.update(current.id, {
          version: current.version,
          title: snapshot.title,
          summary: snapshot.summary,
          ...(snapshot.outline ? { outline: snapshot.outline } : {}),
          content: snapshot.content,
          ...(snapshot.mainConflict
            ? { mainConflict: snapshot.mainConflict }
            : {}),
          ...(snapshot.hook ? { hook: snapshot.hook } : {}),
          ...(snapshot.highlight ? { highlight: snapshot.highlight } : {}),
          ...(snapshot.reversal ? { reversal: snapshot.reversal } : {}),
          ...(snapshot.cliffhanger
            ? { cliffhanger: snapshot.cliffhanger }
            : {}),
        });
        return restored.state === "updated"
          ? requestContext.json({
              targetKind: "chapter",
              targetId: current.id,
              restoredFromId: version.id,
              chapter: restored.value,
            })
          : problem(
              requestContext,
              409,
              "CONFLICT",
              "章节已变化，无法恢复版本。",
            );
      },
    ),
    route(
      {
        id: "writing:chapter-analysis",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/chapters/{id}/analysis",
        operationId: "analysis.runChapter",
      },
      declaration({
        method: "post",
        path: "/api/v2/chapters/{id}/analysis",
        operationId: "analysis.runChapter",
        params: idParams,
        response: ChapterAnalysisRunResultSchema,
        status: 201,
      }),
      (requestContext) => {
        const chapter = chapters.get(requestContext.req.param("id"));
        if (!chapter)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        const content = chapter.content.trim();
        if (!content)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节正文为空，无法分析。",
          );
        const creative = optionalService<CreativeQualityRecordService>(
          context,
          CREATIVE_QUALITY_SERVICE,
        );
        const tasks = optionalService<AutomationTaskService>(
          context,
          AUTOMATION_TASK_SERVICE,
        );
        if (!creative || !tasks)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "创意质量或任务服务不可用。",
          );
        const punctuation = (content.match(/[？?！!]/gu) ?? []).length;
        const visual = (
          content.match(/雨|夜|光|门|车|街|窗|镜|火|血|海|风/gu) ?? []
        ).length;
        const evidence = {
          chapterId: chapter.id,
          chapterVersion: chapter.version,
          contentLength: content.length,
        };
        const records = [
          creative.create("quality", {
            projectId: chapter.projectId,
            parentId: chapter.id,
            value: {
              ...evidence,
              kind: "beats",
              score: score(punctuation, 3),
              finding: chapter.mainConflict || "建议明确章节核心冲突。",
            },
          }),
          creative.create("quality", {
            projectId: chapter.projectId,
            parentId: chapter.id,
            value: {
              ...evidence,
              kind: "highlights",
              score: score(punctuation + (chapter.highlight ? 3 : 0), 4),
              finding: chapter.highlight || chapter.hook || "建议补强高光。",
            },
          }),
          creative.create("quality", {
            projectId: chapter.projectId,
            parentId: chapter.id,
            value: {
              ...evidence,
              kind: "feasibility",
              score: score(visual, 4),
              finding:
                visual > 12
                  ? "视觉元素密集，需提前锁定场景与角色参考。"
                  : "适合先完成场景与分镜规划。",
            },
          }),
          creative.create("quality", {
            projectId: chapter.projectId,
            parentId: chapter.id,
            value: {
              ...evidence,
              kind: "evaluation",
              score: score(content.length, 500),
              finding: chapter.cliffhanger
                ? "已识别结尾悬念。"
                : "建议补充可验证的结尾悬念。",
            },
          }),
        ];
        const task = tasks.complete({
          kind: "analysis.chapter",
          title: `章节分析：${chapter.title}`,
          projectId: chapter.projectId,
          result: {
            chapterId: chapter.id,
            records: records.map(({ id }) => id),
          },
        });
        return requestContext.json({ task, records }, 201);
      },
    ),
  ];
}
