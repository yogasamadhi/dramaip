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

function startPrompt(
  chapter: Chapter,
  input: z.infer<typeof ChapterAgentRunInputSchema>,
): string {
  const taskInstruction =
    input.taskType === "generate_chapter"
      ? "请生成完整章节候选稿。"
      : input.taskType === "continue_chapter"
        ? "请承接现有正文继续写作。"
        : "请按指定任务生成可审阅的章节候选稿。";
  return [
    taskInstruction,
    `章节：${chapter.title}`,
    chapter.summary ? `摘要：${chapter.summary}` : "",
    chapter.content ? `当前正文：\n${chapter.content.slice(-12_000)}` : "",
    input.wordGoal ? `目标字数：${input.wordGoal}` : "",
    input.prompt?.trim() ? `补充要求：${input.prompt.trim()}` : "",
    "只输出候选正文；系统会生成 Preview，未经用户确认不会提交。",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 80_000);
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
): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
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
        const runner = context.services.optional<AgentTaskRunnerService>(
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
          const started = await runner.start({
            projectId: chapter.projectId,
            chapterId: chapter.id,
            baseVersion: chapter.version,
            taskType: input.data.taskType,
            engineKind: input.data.engineKind,
            prompt: startPrompt(chapter, input.data),
            ...(input.data.model ? { model: input.data.model } : {}),
            ...(input.data.selection
              ? { selection: input.data.selection }
              : {}),
          });
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
        const next = chapters.create({
          projectId: source.projectId,
          title: `第 ${chapters.list(source.projectId).length + 1} 章`,
        });
        const runner = context.services.optional<AgentTaskRunnerService>(
          AGENT_TASK_RUNNER_SERVICE,
        );
        if (!runner) {
          chapters.remove(next.id);
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "Agent Runtime 尚未就绪。",
          );
        }
        try {
          const started = await runner.start({
            projectId: source.projectId,
            chapterId: next.id,
            baseVersion: next.version,
            taskType: "generate_chapter",
            engineKind: input.data.engineKind,
            prompt: [
              "请承接上一章结尾，生成下一章完整候选正文，不要复述上一章。",
              source.summary ? `上一章摘要：${source.summary}` : "",
              `上一章结尾：\n${source.content.trim().slice(-2_400)}`,
              input.data.prompt ? `补充要求：${input.data.prompt}` : "",
              input.data.wordGoal ? `目标字数：${input.data.wordGoal}` : "",
              "只输出候选正文；未经用户确认不会提交。",
            ]
              .filter(Boolean)
              .join("\n\n"),
            ...(input.data.model ? { model: input.data.model } : {}),
          });
          const response = {
            chapter: next,
            run: {
              ...started,
              chapterId: next.id,
              autoCommitWhenReady: false,
            },
          };
          recordReplay(context, "continue-chapter", idempotencyKey, response);
          return requestContext.json(response, 202);
        } catch (error) {
          chapters.remove(next.id);
          return problem(
            requestContext,
            409,
            "ENGINE_UNAVAILABLE",
            error instanceof Error ? error.message : "续写启动失败。",
          );
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
        const creative =
          context.services.optional<CreativeQualityRecordService>(
            CREATIVE_QUALITY_SERVICE,
          );
        const tasks = context.services.optional<AutomationTaskService>(
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
