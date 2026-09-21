import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { PRODUCTION_RECORD_SERVICE } from "@dramaip/contracts/production";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  AGENT_TASK_RUNNER_SERVICE,
  ProblemDetailsSchema,
} from "@dramaip/contracts";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import {
  CreationInputSchema,
  CreationWorkflowSchema,
  CreationActionSchema,
  CreationMergeSchema,
  CREATION_QUALITY_SERVICE,
  CREATION_REVIEW_SERVICE,
  CREATION_INSIGHTS_SERVICE,
  parseCreationContent,
  CREATION_WORKFLOW_SERVICE,
  CREATION_WRITING_SERVICE,
  CREATION_PRODUCTION_SERVICE,
  CREATION_DELIVERY_SERVICE,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationWorkflow,
  type CreationInput,
  type CreationAdapter,
} from "@dramaip/contracts/creation";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";

export const creationMigrations: PluginMigration[] = [
  {
    id: "automation.0007.creation-workflows",
    pluginId: "automation",
    version: "3.0.0-alpha.4",
    dependsOn: ["automation.0006.task-attention"],
    sql: `CREATE TABLE automation_creation_workflows (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_id TEXT, stage TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
    request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX automation_creation_target ON automation_creation_workflows(project_id, target_id, created_at DESC, id);
  CREATE INDEX automation_creation_stage ON automation_creation_workflows(stage, created_at, id);`,
  },
];

const ACTIVE = [
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
];
const CONTENT_FORMAT = `只返回 JSON，不要 Markdown 围栏。结构为 {"title":"标题","content":"完整正文或方案","items":[{"ref":"候选内部唯一标识","parentRef":"可选父项 ref","kind":"业务条目类型","title":"条目名称","data":{}}]}。仅使用任务要求的条目类型。正文放 content，结构化资料放 items；brief 放一段供用户审阅的任务书，概括剧情推进、人物动机、视角、节奏、事实约束、伏笔与字数目标，不包含推理过程。严禁把计划当作已经发生的事实。`;

function adapter(
  context: PluginContext,
  input: CreationInput,
): CreationAdapter {
  const contract = [
    "chapter",
    "characters",
    "book-outline",
    "chapter-outline",
    "story-arc",
    "creator-content",
  ].includes(input.operation)
    ? CREATION_WRITING_SERVICE
    : ["chapter-memory", "knowledge-plan"].includes(input.operation)
      ? CREATION_KNOWLEDGE_SERVICE
      : ["delivery-copy", "localization"].includes(input.operation)
        ? CREATION_DELIVERY_SERVICE
        : CREATION_PRODUCTION_SERVICE;
  const service = optionalService(context, contract);
  if (!service) throw new Error("当前业务插件未启用，无法执行该创作操作。");
  return service;
}

export function creationRuntime(context: PluginContext) {
  const get = (id: string): CreationWorkflow | undefined =>
    context.uow.execute((tx) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM automation_creation_workflows WHERE id = ?",
        id,
      );
      return row
        ? CreationWorkflowSchema.parse(JSON.parse(row.value_json))
        : undefined;
    });
  const save = (
    value: CreationWorkflow,
    patch: Partial<CreationWorkflow>,
  ): CreationWorkflow => {
    const next = CreationWorkflowSchema.parse({
      ...value,
      ...patch,
      version: value.version + 1,
      updatedAt: new Date().toISOString(),
    });
    context.uow.execute((tx) => {
      const current = tx.get<{ version: number }>(
        "SELECT version FROM automation_creation_workflows WHERE id = ?",
        value.id,
      );
      if (current?.version !== value.version)
        throw new Error("创作状态已变化，请刷新后继续。");
      tx.run(
        "UPDATE automation_creation_workflows SET stage = ?, version = ?, value_json = ?, updated_at = ? WHERE id = ? AND version = ?",
        next.stage,
        next.version,
        JSON.stringify(next),
        next.updatedAt,
        next.id,
        value.version,
      );
      const status =
        next.stage === "failed"
          ? "failed"
          : next.stage === "canceled"
            ? "canceled"
            : next.stage === "interrupted"
              ? "interrupted"
              : ACTIVE.includes(next.stage)
                ? "running"
                : "succeeded";
      tx.run(
        "UPDATE automation_tasks SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?",
        status,
        ["awaiting-review", "applied", "discarded"].includes(next.stage)
          ? 1
          : next.stage === "generating"
            ? 0.2
            : next.stage === "checking"
              ? 0.5
              : 0.75,
        JSON.stringify({
          creationWorkflowId: next.id,
          stage: next.stage,
          previewId: next.previewId,
          operation: next.input.operation,
          targetId: next.input.targetId,
          issues: next.issues,
        }),
        next.error ?? null,
        next.updatedAt,
        next.taskId,
      );
      if (
        next.sourceWorkflowId &&
        ["awaiting-review", "applied"].includes(next.stage)
      ) {
        tx.run(
          "UPDATE automation_tasks SET attention_status = 'acknowledged', updated_at = ? WHERE id IN (SELECT json_extract(value_json, '$.taskId') FROM automation_creation_workflows WHERE id = ?)",
          next.updatedAt,
          next.sourceWorkflowId,
        );
      }
      tx.append({
        type: "automation.task-updated.v1",
        pluginId: "automation",
        aggregateType: "task",
        aggregateId: next.taskId,
        aggregateVersion: next.version,
        payload: { id: next.taskId, status, projectId: next.input.projectId },
      });
      tx.append({
        type: "automation.creation-updated.v1",
        pluginId: "automation",
        aggregateType: "creation",
        aggregateId: next.id,
        aggregateVersion: next.version,
        payload: {
          id: next.id,
          projectId: next.input.projectId,
          stage: next.stage,
          taskId: next.taskId,
        },
      });
    });
    if (next.input.operation === "chapter-memory") {
      const parents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryWorkflowId') = ?",
          next.id,
        ),
      );
      const memoryState =
        next.stage === "applied"
          ? "synced"
          : next.stage === "awaiting-review"
            ? "review-required"
            : ACTIVE.includes(next.stage)
              ? "running"
              : "failed";
      for (const row of parents) {
        const parent = get(row.id);
        if (
          parent &&
          (parent.memoryState !== memoryState ||
            parent.memoryError !== next.error)
        )
          save(parent, { memoryState, memoryError: next.error });
      }
    }
    return next;
  };
  const start = (
    raw: CreationInput,
    key: string,
    sourceWorkflowId?: string,
    rebaseSource?: CreationWorkflow["rebaseSource"],
  ): CreationWorkflow => {
    const input = CreationInputSchema.parse(raw);
    if (!key) throw new Error("缺少幂等标识。");
    const hash = createHash("sha256")
      .update(JSON.stringify({ input, sourceWorkflowId, rebaseSource }))
      .digest("hex");
    const existing = context.uow.execute((tx) =>
      tx.get<{ request_hash: string; value_json: string }>(
        "SELECT request_hash, value_json FROM automation_creation_workflows WHERE request_key = ?",
        key,
      ),
    );
    if (existing) {
      if (existing.request_hash !== hash)
        throw new Error("同一幂等标识不能用于不同创作要求。");
      return CreationWorkflowSchema.parse(JSON.parse(existing.value_json));
    }
    const owner = adapter(context, input);
    if (!optionalService(context, CREATION_QUALITY_SERVICE))
      throw new Error("创作检查插件未启用。");
    const source = sourceWorkflowId ? get(sourceWorkflowId) : undefined;
    if (
      sourceWorkflowId &&
      (!source || source.input.projectId !== input.projectId)
    )
      throw new Error("原创作运行不存在。");
    const prepared = source
      ? { prompt: source.preparedPrompt, sources: source.sources }
      : owner.prepare(input);
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.prepareCreation)
      throw new Error("当前引擎执行器不支持冻结创作上下文。");
    const feedbackReferences = source
      ? []
      : [
          ...(input.reviewPackageId
            ? (optionalService(context, CREATION_REVIEW_SERVICE)?.references(
                input.projectId,
                input.reviewPackageId,
                input.targetId ?? "",
              ) ??
              (() => {
                throw new Error("审片插件未启用。");
              })())
            : []),
          ...(input.feedbackClusterId
            ? (optionalService(context, CREATION_INSIGHTS_SERVICE)?.references(
                input.projectId,
                input.feedbackClusterId,
                input.targetId ?? "",
              ) ??
              (() => {
                throw new Error("反馈插件未启用。");
              })())
            : []),
        ];
    const frozen = source
      ? undefined
      : runner.prepareCreation({
          projectId: input.projectId,
          conversationId: input.conversationId,
          chapterId:
            input.operation === "chapter" ||
            input.operation === "chapter-memory"
              ? input.targetId
              : undefined,
          engineKind: input.engineKind,
          model: input.model,
          prompt: prepared.prompt,
          references: [
            ...("references" in prepared ? (prepared.references ?? []) : []),
            ...feedbackReferences,
          ],
        });
    if (frozen) input.model = frozen.model;
    const task = { id: crypto.randomUUID() };
    const at = new Date().toISOString();
    const value = CreationWorkflowSchema.parse({
      id: crypto.randomUUID(),
      taskId: task.id,
      input,
      stage: "preparing",
      version: 0,
      sourceWorkflowId,
      rebaseSource,
      runIds: [],
      contextSnapshotIds: frozen
        ? [frozen.snapshot.id]
        : [...(source?.contextSnapshotIds ?? [])],
      sourceSnapshotId: frozen?.snapshot.id ?? source?.sourceSnapshotId,
      contextEntries:
        frozen?.snapshot.entries.map((entry) => ({
          title: String(
            (entry.value as { title?: string })?.title ?? entry.fieldPath,
          ),
          included: entry.included,
          reason: entry.reason,
        })) ??
        source?.contextEntries ??
        [],
      referenceVersions:
        source?.referenceVersions ??
        frozen?.snapshot.entries
          .filter(
            (entry) =>
              entry.included &&
              "references" in prepared &&
              prepared.references?.some(
                (reference) =>
                  reference.sourceId === entry.sourceId &&
                  reference.fieldPath === entry.fieldPath,
              ),
          )
          .map((entry) => ({
            sourceId: entry.sourceId,
            sourceVersion: entry.sourceVersion,
            fieldPath: entry.fieldPath,
          })) ??
        [],
      sources: frozen
        ? prepared.sources.filter((source) =>
            frozen.snapshot.entries.some(
              (entry) => entry.sourceId === source.id && entry.included,
            ),
          )
        : prepared.sources,
      baseText:
        source?.baseText ??
        ("references" in prepared
          ? (
              prepared.references?.find(
                (entry) => entry.sourceId === input.targetId,
              )?.value as { content?: string } | undefined
            )?.content
          : undefined),
      baseBlocks:
        source?.baseBlocks ??
        ("baseBlocks" in prepared ? prepared.baseBlocks : undefined),
      preparedPrompt: prepared.prompt,
      output: "checkContent" in prepared ? prepared.checkContent : undefined,
      issues: [],
      createdAt: at,
      updatedAt: at,
    });
    context.uow.execute((tx) => {
      tx.run(
        "INSERT INTO automation_tasks(id,kind,status,title,progress,project_id,parent_task_id,payload_json,result_json,error,created_at,updated_at) VALUES (?, 'creation.workflow', 'running', ?, 0, ?, ?, ?, ?, NULL, ?, ?)",
        task.id,
        `AI 创作 · ${input.instruction.slice(0, 60)}`,
        input.projectId,
        source?.taskId ?? null,
        JSON.stringify(input),
        JSON.stringify({
          creationWorkflowId: value.id,
          stage: value.stage,
          targetId: input.targetId,
        }),
        at,
        at,
      );
      tx.run(
        "INSERT INTO automation_creation_workflows(id, project_id, target_id, stage, version, request_key, request_hash, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
        value.id,
        input.projectId,
        input.targetId ?? null,
        value.stage,
        key,
        hash,
        JSON.stringify(value),
        at,
        at,
      );
      tx.append({
        type: "automation.creation-created.v1",
        pluginId: "automation",
        aggregateType: "creation",
        aggregateId: value.id,
        aggregateVersion: 0,
        payload: { id: value.id, projectId: input.projectId, taskId: task.id },
      });
    });
    if (source?.input.operation === "chapter-memory") {
      const parents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryWorkflowId') = ?",
          source.id,
        ),
      );
      for (const row of parents) {
        const parent = get(row.id);
        if (parent)
          save(parent, {
            memoryWorkflowId: value.id,
            memoryState: "running",
            memoryError: undefined,
          });
      }
    }
    return value;
  };
  const ready = (value: CreationWorkflow) => {
    if (!value.output) throw new Error("没有可审阅的候选。");
    if (value.input.operation === "review-check") {
      save(value, { stage: "applied" });
      return;
    }
    if (
      value.issues.some(
        (issue) => issue.source === "rule" && issue.severity === "error",
      )
    )
      throw new Error(
        "复检后候选仍有结构问题；内容与问题已保留，请补充要求后重试。",
      );
    if (
      value.input.operation === "chapter-memory" &&
      value.issues.length === 0
    ) {
      adapter(context, value.input).apply(value);
      save(value, { stage: "applied" });
      return;
    }
    const previews = optionalService(context, AUTOMATION_PREVIEW_SERVICE);
    if (!previews) throw new Error("候选预览服务未启用。");
    const existing = context.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM automation_change_previews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
        value.taskId,
      ),
    );
    if (existing) {
      save(value, { stage: "awaiting-review", previewId: existing.id });
      return;
    }
    const preview = previews.createChange({
      projectId: value.input.projectId,
      taskId: value.taskId,
      runId: value.runId,
      sessionId: value.sessionId,
      engineKind: value.input.engineKind,
      taskType: `creation.${value.input.operation}`,
      targets:
        value.input.operation === "chapter" &&
        value.input.targetId &&
        value.input.baseVersion !== undefined
          ? [
              {
                kind: "chapter",
                id: value.input.targetId,
                baseVersion: value.input.baseVersion,
                patch: { content: value.output.content },
                displayDiff: {
                  candidate: value.output.content,
                  before: value.baseText ?? "",
                  creationWorkflowId: value.id,
                },
              },
            ]
          : [
              {
                kind: "creation",
                id: value.id,
                baseVersion: value.version,
                patch: { workflowId: value.id },
                displayDiff: { candidate: value.output },
              },
            ],
      rationale: value.issues.length
        ? `已完成生成与检查，仍有 ${value.issues.length} 项审阅意见；请核对后采用。`
        : "已完成生成与检查，请审阅候选。",
    });
    save(value, {
      stage: "awaiting-review",
      previewId: preview.id,
      error: undefined,
    });
  };
  const dispatch = async (
    value: CreationWorkflow,
    stage: "generating" | "checking" | "revising" | "rechecking",
  ) => {
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.get || !runner.cancel)
      throw new Error("当前引擎执行器不支持可恢复创作工作流。");
    const quality = optionalService(context, CREATION_QUALITY_SERVICE);
    if (!quality) throw new Error("创作检查插件未启用。");
    const suffix =
      stage === "generating"
        ? CONTENT_FORMAT
        : stage === "revising"
          ? `${CONTENT_FORMAT}\n仅修正列出的问题，保留其他内容及候选 ref。问题：${JSON.stringify(value.issues)}\n候选：${JSON.stringify(value.output)}`
          : `${quality.prompt}\n候选：${JSON.stringify(value.output)}`;
    const runId = crypto.randomUUID();
    const pending = save(value, {
      stage,
      runId,
      runIds: [...value.runIds, runId],
    });
    const started = await runner.start({
      projectId: value.input.projectId,
      chapterId:
        value.input.operation === "chapter" ||
        value.input.operation === "chapter-memory"
          ? value.input.targetId
          : undefined,
      baseVersion: value.input.baseVersion,
      taskType: `creation_${stage}`,
      managed: true,
      contextSnapshotId: value.sourceSnapshotId,
      deriveContext: true,
      runId,
      engineKind: value.input.engineKind,
      model: value.input.model,
      prompt: `${value.preparedPrompt}\n\n用户要求：${value.input.instruction}\n${value.input.wordGoal ? `目标字数：${value.input.wordGoal}，允许上下浮动 15%。` : ""}\n${suffix}`,
    });
    const current = get(value.id);
    if (!current || current.stage === "canceled") {
      await runner.cancel(started.runId);
      return;
    }
    if (current.version === pending.version)
      save(current, { sessionId: started.sessionId });
  };
  const step = async (id: string) => {
    let value = get(id);
    if (!value || !ACTIVE.includes(value.stage)) return;
    try {
      if (value.stage === "preparing") {
        await dispatch(
          value,
          value.input.operation === "review-check" ? "checking" : "generating",
        );
        return;
      }
      const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
      if (!runner?.get || !value.runId)
        throw new Error("缺少可恢复的引擎运行。");
      const run = runner.get(value.runId);
      if (!run) throw new Error("引擎提交在保存前中断，请重试当前创作操作。");
      if (
        [
          "failed",
          "canceled",
          "interrupted",
          "orphaned",
          "recoverable",
        ].includes(run.status)
      )
        throw new Error(run.error ?? "原运行已中断，请重试。");
      if (run.status !== "completed") return;
      value = save(value, {
        sessionId: run.sessionId,
        contextSnapshotIds:
          run.contextSnapshotId &&
          !value.contextSnapshotIds.includes(run.contextSnapshotId)
            ? [...value.contextSnapshotIds, run.contextSnapshotId]
            : value.contextSnapshotIds,
      });
      if (!run.content) throw new Error("引擎没有返回可验证的内容。");
      if (value.stage === "generating" || value.stage === "revising") {
        const output = parseCreationContent(run.content);
        const issues = adapter(context, value.input).validate(
          value.input,
          output,
        );
        const previousStage = value.stage;
        value = save(value, { output, issues });
        await dispatch(
          value,
          previousStage === "generating" ? "checking" : "rechecking",
        );
      } else {
        const quality = optionalService(context, CREATION_QUALITY_SERVICE);
        if (!quality) throw new Error("创作检查插件未启用。");
        const issues = quality.collect(
          run.content,
          adapter(context, value.input).validate(value.input, value.output!),
        );
        const stage = value.stage;
        value = save(value, { issues });
        if (
          stage === "checking" &&
          value.input.operation !== "review-check" &&
          issues.some((issue) => issue.severity !== "suggestion")
        )
          await dispatch(value, "revising");
        else ready(value);
      }
    } catch (error) {
      const current = get(id);
      if (current && ACTIVE.includes(current.stage))
        save(current, {
          stage: "failed",
          error:
            error instanceof Error
              ? error.message
              : "创作执行失败；已保存的候选仍保留。",
        });
    }
  };
  const apply = (
    id: string,
    chapterPatch?: {
      previewId: string;
      id: string;
      version: number;
      content: string;
    },
  ): "updated" | "conflict" | "unsupported" => {
    let value = get(id);
    if (!value) return "unsupported";
    if (value.stage === "applied")
      return chapterPatch && chapterPatch.previewId !== value.previewId
        ? "conflict"
        : "updated";
    if (value.stage !== "awaiting-review" || !value.output) return "conflict";
    try {
      if (chapterPatch) {
        if (
          value.input.operation !== "chapter" ||
          value.input.targetId !== chapterPatch.id
        )
          return "conflict";
        value = {
          ...value,
          input: { ...value.input, baseVersion: chapterPatch.version },
          output: { ...value.output!, content: chapterPatch.content },
          sources: value.sources.map((source) =>
            source.kind === "chapter" && source.id === chapterPatch.id
              ? { ...source, version: chapterPatch.version }
              : source,
          ),
          referenceVersions: value.referenceVersions.map((source) =>
            source.sourceId === chapterPatch.id
              ? { ...source, sourceVersion: chapterPatch.version }
              : source,
          ),
          previewId: chapterPatch.previewId,
        };
      }
      adapter(context, value.input).apply(value);
      save(value, { stage: "applied" });
      return "updated";
    } catch (error) {
      save(value, {
        error:
          error instanceof Error
            ? error.message
            : "采用未完成，请检查来源版本。",
      });
      return "conflict";
    }
  };
  const action = async (
    id: string,
    operation: "cancel" | "retry" | "continue",
    key: string,
  ): Promise<CreationWorkflow> => {
    const value = get(id);
    if (!value) throw new Error("创作运行不存在。");
    if (!key) throw new Error("缺少幂等标识。");
    if (operation === "cancel") {
      if (value.stage === "canceled") return value;
      if (!ACTIVE.includes(value.stage))
        throw new Error("当前运行已经结束；候选可单独放弃。");
      const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
      if (value.runId) {
        if (!runner?.cancel) throw new Error("执行器不支持取消。");
        await runner.cancel(value.runId);
      }
      const current = get(id)!;
      return ACTIVE.includes(current.stage)
        ? save(current, { stage: "canceled" })
        : current;
    }
    if (!["failed", "interrupted", "canceled"].includes(value.stage))
      throw new Error("当前运行无需重试。");
    if (operation === "continue" && !value.output)
      throw new Error("当前没有可继续检查的候选。");
    let continued = start(value.input, key, value.id);
    if (operation === "continue" && continued.stage === "preparing") {
      continued = save(continued, {
        output: value.output,
        issues: value.issues,
      });
      await dispatch(continued, "rechecking");
    }
    return get(continued.id)!;
  };
  const service = {
    start,
    get,
    apply,
    action,
    launch: async (id: string) => {
      await step(id);
      const value = get(id);
      if (!value) throw new Error("创作运行不存在。");
      return value;
    },
  };
  context.effect(
    () => provideService(context, CREATION_WORKFLOW_SERVICE, service),
    `service:${CREATION_WORKFLOW_SERVICE}`,
  );
  context.effect(() => {
    let disposed = false;
    const busy = new Map<string, Promise<void>>();
    const tick = () => {
      if (disposed) return;
      const rows = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage IN ('preparing','generating','checking','revising','rechecking') ORDER BY created_at LIMIT 20",
        ),
      );
      for (const { id } of rows)
        if (!busy.has(id)) {
          const work = step(id).finally(() => busy.delete(id));
          busy.set(id, work);
          void work.catch(() => undefined);
        }
      const revisions = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'script-revision' AND json_extract(value_json, '$.input.reviewPackageId') IS NOT NULL AND json_extract(value_json, '$.adoptionCheckId') IS NULL AND json_extract(value_json, '$.adoptionCheckError') IS NULL LIMIT 20",
        ),
      );
      for (const row of revisions) {
        const value = get(row.id)!;
        try {
          const target = optionalService(
            context,
            PRODUCTION_RECORD_SERVICE,
          )?.get(value.input.targetId!);
          if (!target) throw new Error("原剧本已删除。");
          const check = start(
            {
              ...value.input,
              operation: "review-check",
              baseVersion: target.version,
              instruction:
                "重新核对已采用版本与本次审片原问题，列出仍需用户处理的意见；不关闭问题。",
            },
            `adoption-check:${value.id}:${target.version}`,
          );
          save(value, { adoptionCheckId: check.id });
        } catch (error) {
          save(value, {
            adoptionCheckError:
              error instanceof Error ? error.message : "原问题复检未完成。",
          });
        }
      }
      const adopted = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'chapter' AND json_extract(value_json, '$.memoryState') IS NULL LIMIT 20",
        ),
      );
      for (const row of adopted) {
        const value = get(row.id)!;
        try {
          const chapter = optionalService(
            context,
            WRITING_CHAPTER_SERVICE,
          )?.get(value.input.targetId!);
          if (!chapter) throw new Error("章节已删除。");
          const memory = start(
            {
              projectId: chapter.projectId,
              operation: "chapter-memory",
              targetId: chapter.id,
              baseVersion: chapter.version,
              instruction:
                "从已采用正文提取摘要、事件、人物状态与伏笔，仅记录有原文证据的事实。",
              engineKind: value.input.engineKind,
              model: value.input.model,
              sourceIds: [],
            },
            `memory:${value.id}:${chapter.version}`,
          );
          save(value, { memoryState: "running", memoryWorkflowId: memory.id });
        } catch (error) {
          save(value, {
            memoryState: "failed",
            memoryError:
              error instanceof Error ? error.message : "派生资料更新未完成。",
          });
        }
      }
      const memoryParents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryState') = 'running' LIMIT 20",
        ),
      );
      for (const row of memoryParents) {
        const parent = get(row.id)!;
        const memory = parent.memoryWorkflowId
          ? get(parent.memoryWorkflowId)
          : undefined;
        if (memory && !ACTIVE.includes(memory.stage))
          save(parent, {
            memoryState:
              memory.stage === "applied"
                ? "synced"
                : memory.stage === "awaiting-review"
                  ? "review-required"
                  : "failed",
            memoryError: memory.error,
          });
      }
      const rebased = context.uow.execute((tx) =>
        tx.all<{ id: string; preview_id: string }>(
          "SELECT w.id, p.id AS preview_id FROM automation_creation_workflows w JOIN automation_change_previews p ON p.task_id = json_extract(w.value_json, '$.taskId') WHERE w.stage = 'awaiting-review' AND p.status = 'pending' AND p.id != json_extract(w.value_json, '$.previewId') AND p.created_at = (SELECT MAX(latest.created_at) FROM automation_change_previews latest WHERE latest.task_id = p.task_id)",
        ),
      );
      for (const row of rebased) {
        const value = get(row.id);
        if (value) save(value, { previewId: row.preview_id });
      }
      const reviewed = context.uow.execute((tx) =>
        tx.all<{ id: string; status: string }>(
          "SELECT w.id, p.status FROM automation_creation_workflows w JOIN automation_change_previews p ON p.id = json_extract(w.value_json, '$.previewId') WHERE w.stage = 'awaiting-review' AND p.status IN ('committed','discarded')",
        ),
      );
      for (const row of reviewed) {
        const value = get(row.id);
        if (value)
          save(value, {
            stage: row.status === "committed" ? "applied" : "discarded",
          });
      }
    };
    const timer = setInterval(tick, 500);
    return async () => {
      disposed = true;
      clearInterval(timer);
      await Promise.allSettled(busy.values());
    };
  }, "worker:creation-workflows");

  type Request = {
    req: {
      param(name: string): string;
      query(name: string): string | undefined;
      header(name: string): string | undefined;
      json(): Promise<unknown>;
    };
    json(value: unknown, status?: number): Response;
  };
  const errorResponse = (
    _request: Request,
    error: unknown,
    status = error instanceof z.ZodError ? 400 : 409,
  ) => {
    const code =
      status === 400
        ? "VALIDATION_ERROR"
        : status === 404
          ? "NOT_FOUND"
          : "CONFLICT";
    return new Response(
      JSON.stringify({
        type: `https://dramaip.local/problems/${code.toLowerCase()}`,
        title: "创作操作未完成",
        status,
        code,
        traceId: crypto.randomUUID(),
        detail:
          error instanceof Error ? error.message : "请检查当前对象后重试。",
      }),
      { status, headers: { "Content-Type": "application/problem+json" } },
    );
  };
  const routes: RouteContribution[] = [];
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operation: string,
    response: z.ZodType,
    handler: (request: Request) => unknown,
    body?: z.ZodType,
  ) => {
    const declaration = createRoute({
      method,
      path,
      operationId: `creation.${operation}`,
      tags: ["creation"],
      request: {
        ...(path.includes("{id}")
          ? { params: z.object({ id: z.string().uuid() }) }
          : {}),
        ...(body
          ? {
              body: {
                content: { "application/json": { schema: body } },
                required: true,
              },
            }
          : {}),
      },
      responses: {
        200: {
          description: "Success",
          content: { "application/json": { schema: response } },
        },
        409: {
          description: "Conflict",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      },
    });
    routes.push(
      defineRouteContribution({
        id: `automation:creation-${operation}`,
        pluginId: "automation",
        method,
        path,
        operationId: `creation.${operation}`,
        declaration,
        handler: handler as never,
      }),
    );
  };
  add(
    "post",
    "/api/v2/workflows/creation",
    "start",
    CreationWorkflowSchema,
    async (request) => {
      try {
        return request.json(
          start(
            CreationInputSchema.parse(await request.req.json()),
            request.req.header("Idempotency-Key") ?? "",
          ),
        );
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    CreationInputSchema,
  );
  add(
    "get",
    "/api/v2/workflows/creation",
    "list",
    z.object({
      items: z.array(CreationWorkflowSchema),
      nextCursor: z.string().optional(),
    }),
    (request) => {
      const projectId = request.req.query("projectId");
      const targetId = request.req.query("targetId");
      const cursor = request.req.query("cursor");
      const [cursorAt, cursorId] = cursor?.split("|") ?? [];
      if (
        !projectId ||
        !z.string().uuid().safeParse(projectId).success ||
        (targetId && !z.string().uuid().safeParse(targetId).success) ||
        (cursor &&
          (!z.string().datetime().safeParse(cursorAt).success ||
            !z.string().uuid().safeParse(cursorId).success))
      )
        return errorResponse(
          request,
          new Error("项目、对象或分页游标无效。"),
          400,
        );
      const rows = context.uow.execute((tx) =>
        tx.all<{ id: string; created_at: string; value_json: string }>(
          "SELECT id, created_at, value_json FROM automation_creation_workflows WHERE project_id = ? AND (? IS NULL OR target_id = ?) AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 26",
          projectId,
          targetId ?? null,
          targetId ?? null,
          cursorAt ?? null,
          cursorAt ?? null,
          cursorAt ?? null,
          cursorId ?? null,
        ),
      );
      return request.json({
        items: rows
          .slice(0, 25)
          .map((row) =>
            CreationWorkflowSchema.parse(JSON.parse(row.value_json)),
          ),
        ...(rows.length > 25
          ? { nextCursor: `${rows[24]!.created_at}|${rows[24]!.id}` }
          : {}),
      });
    },
  );
  add(
    "get",
    "/api/v2/workflows/creation/{id}",
    "get",
    CreationWorkflowSchema,
    (request) => {
      const value = get(request.req.param("id"));
      return value
        ? new Response(JSON.stringify(value), {
            headers: {
              "Content-Type": "application/json",
              ETag: `"${value.version}"`,
            },
          })
        : errorResponse(request, new Error("创作运行不存在。"), 404);
    },
  );
  add(
    "post",
    "/api/v2/workflows/creation/{id}/actions",
    "action",
    CreationWorkflowSchema,
    async (request) => {
      try {
        const { action } = CreationActionSchema.parse(await request.req.json());
        const match = request.req.header("If-Match");
        if (match && match !== `"${get(request.req.param("id"))?.version}"`)
          throw new Error("运行状态已更新，请刷新后重试当前操作。");
        return request.json(
          await service.action(
            request.req.param("id"),
            action,
            request.req.header("Idempotency-Key") ?? "",
          ),
        );
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    CreationActionSchema,
  );
  add(
    "get",
    "/api/v2/workflows/creation/{id}/merge",
    "merge",
    CreationMergeSchema,
    (request) => {
      try {
        const value = get(request.req.param("id"));
        if (!value)
          return errorResponse(request, new Error("候选不存在。"), 404);
        const merge = adapter(context, value.input).merge;
        if (!merge) throw new Error("该内容请使用所属领域的版本合并入口。");
        return request.json(merge(value));
      } catch (error) {
        return errorResponse(request, error);
      }
    },
  );
  const mergeInput = z.object({
    baseVersion: z.number().int().nonnegative(),
    choices: z.record(z.string(), z.enum(["main", "branch"])),
  });
  add(
    "post",
    "/api/v2/workflows/creation/{id}/rebase",
    "rebase",
    CreationWorkflowSchema,
    async (request) => {
      try {
        const input = mergeInput.parse(await request.req.json());
        const rebaseSource = { id: request.req.param("id"), ...input };
        const key = request.req.header("Idempotency-Key") ?? "";
        if (!key) throw new Error("缺少幂等标识。");
        const existing = context.uow.execute((tx) =>
          tx.get<{ value_json: string }>(
            "SELECT value_json FROM automation_creation_workflows WHERE request_key = ?",
            key,
          ),
        );
        if (existing) {
          const flow = CreationWorkflowSchema.parse(
            JSON.parse(existing.value_json),
          );
          if (
            JSON.stringify(flow.rebaseSource) !== JSON.stringify(rebaseSource)
          )
            throw new Error("同一幂等标识不能用于不同合并选择。");
          return request.json(flow);
        }
        const value = get(request.req.param("id"));
        if (!value || value.stage !== "awaiting-review")
          throw new Error("原候选已处理或不存在。");
        const merge = adapter(context, value.input).merge;
        if (!merge) throw new Error("当前业务不支持此合并方式。");
        const result = merge(value, input.choices);
        if (result.currentVersion !== input.baseVersion)
          throw new Error("合并期间版本再次变化，请重新打开比较。");
        if (!result.output) throw new Error("请明确选择全部冲突块。");
        let next = start(
          { ...value.input, baseVersion: result.currentVersion },
          key,
          undefined,
          rebaseSource,
        );
        if (next.stage === "preparing") {
          next = save(next, {
            sourceWorkflowId: value.id,
            output: result.output,
          });
          context.uow.execute((tx) =>
            tx.run(
              "UPDATE automation_tasks SET parent_task_id = ? WHERE id = ?",
              value.taskId,
              next.taskId,
            ),
          );
          await dispatch(next, "rechecking");
        }
        return request.json(get(next.id));
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    mergeInput,
  );
  return { routes, service, step };
}
