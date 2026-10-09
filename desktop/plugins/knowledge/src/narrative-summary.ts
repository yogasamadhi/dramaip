import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AGENT_CONTEXT_SERVICE,
  type AgentContextReference,
} from "@dramaip/contracts/agent-context";
import {
  creationReference,
  type CreationAdapter,
  type CreationContent,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
  NarrativeSummaryRequestSchema,
  NarrativeSummarySchema,
  NarrativeSummaryPageSchema,
  NarrativeSummaryStatusSchema,
  NarrativeSummaryStatusPageSchema,
  NarrativeSummaryScopesSchema,
  type NarrativeSummary,
  type NarrativeSummaryRequest,
  type NarrativeSummaryBasis,
  type NarrativeIndexCatalog,
  type NarrativeSummaryScope,
} from "@dramaip/contracts/knowledge";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  summaryHash as hash,
  inspectNarrativeSummary,
} from "./narrative-summary-content.js";

export const narrativeSummaryMigration: PluginMigration = {
  id: "knowledge.0008.narrative-summaries",
  pluginId: "knowledge",
  version: "3.0.0-alpha.4",
  dependsOn: ["knowledge.0007.narrative-index-receipts"],
  sql: `CREATE TABLE knowledge_narrative_summaries (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL UNIQUE, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    value_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX knowledge_narrative_summary_page ON knowledge_narrative_summaries(project_id, created_at DESC, id DESC);
  CREATE TABLE knowledge_narrative_summary_heads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    summary_id TEXT NOT NULL REFERENCES knowledge_narrative_summaries(id),
    PRIMARY KEY(project_id,target_kind,target_id)
  );`,
};
type Stored = Omit<
  NarrativeSummary,
  "isHead" | "isCurrent" | "sourceState" | "staleReasons" | "contextEligibility"
>;
class SummaryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new SummaryError(409, message);
}
type Group = NarrativeIndexCatalog["groups"][number];
const directory = (group: Group, catalog: NarrativeIndexCatalog) => {
  const ids = new Set(group.chapterIds);
  return catalog.chapters
    .filter((chapter) => ids.has(chapter.id))
    .map(({ id, version, orderIndex, contentHash, hasContent }) => ({
      id,
      version,
      orderIndex,
      contentHash,
      hasContent,
    }));
};
const fingerprint = (group: Group, catalog: NarrativeIndexCatalog) =>
  hash({
    target: { id: group.id, version: group.version, kind: group.kind },
    state: group.state,
    chapterIds: group.chapterIds,
    directory: directory(group, catalog),
  });
type HttpContext = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
};

export function registerNarrativeSummaries(
  context: PluginContext,
): CreationAdapter {
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM knowledge_narrative_summaries WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const stored = (id: string) => context.uow.execute((tx) => read(tx, id));
  const head = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    target: NarrativeSummaryRequest["target"],
  ) =>
    tx.get<{ summary_id: string }>(
      "SELECT summary_id FROM knowledge_narrative_summary_heads WHERE project_id = ? AND target_kind = ? AND target_id = ?",
      projectId,
      target.kind,
      target.id,
    )?.summary_id;
  const index = () => {
    const service = optionalService(context, KNOWLEDGE_NARRATIVE_INDEX_SERVICE);
    if (!service)
      throw new SummaryError(503, "可信来源索引未启用，不生成卷或全书摘要。");
    return service;
  };
  const scopes = (projectId: string) => {
    const catalog = index().catalog(projectId);
    const values: NarrativeSummaryScope[] = catalog.groups.map((group) => ({
      target: { id: group.id, version: group.version, kind: group.kind },
      title: group.title,
      scopeFingerprint: fingerprint(group, catalog),
      state: group.state,
      reasons: group.reasons,
      chapters: catalog.chapters.filter((chapter) =>
        group.chapterIds.includes(chapter.id),
      ),
      head: context.uow.execute((tx) => {
        const id = head(tx, projectId, group);
        const value = id ? read(tx, id) : undefined;
        return value ? { id: value.id, version: value.version } : null;
      }),
    }));
    return NarrativeSummaryScopesSchema.parse({
      projectId,
      scopes: values,
      unavailable: catalog.unavailable,
    });
  };
  // Read peer sources outside Knowledge transactions. A stored coverage range
  // is validated independently of the current larger scope, never expanded.
  const collectSources = (
    projectId: string,
    request: NarrativeSummaryRequest,
    required: NarrativeSummaryBasis["directory"],
    scopeTitle: string,
  ) => {
    const actual = required
      .filter((chapter) => chapter.hasContent)
      .map(({ id, version }) => ({ id, version }));
    if (
      hash(request.chapters.map(({ id, version }) => ({ id, version }))) !==
      hash(actual)
    )
      fail(
        "必须按目录顺序明确选择范围内全部非空章节；不能以局部来源代表卷、故事弧或全书。",
      );
    const writing = optionalService(context, WRITING_CHAPTER_SERVICE);
    if (!writing) throw new SummaryError(503, "正文服务暂不可用。");
    const originals = new Map(
      writing.list(projectId).map((chapter) => [chapter.id, chapter]),
    );
    const summaryIds = request.chapters
      .filter((chapter) => chapter.representation === "summary")
      .map((chapter) => chapter.id);
    const details = new Map(
      (
        index().details?.(projectId, summaryIds) ??
        summaryIds.flatMap((id) => {
          const value = index().chapter(projectId, id);
          return value ? [value] : [];
        })
      ).map((value) => [value.chapter.id, value]),
    );
    const references: AgentContextReference[] = request.chapters.map(
      (selection) => {
        const chapter = originals.get(selection.id);
        if (
          !chapter ||
          chapter.version !== selection.version ||
          hash(chapter.content) !==
            required.find((item) => item.id === selection.id)?.contentHash
        )
          fail("摘要章节正文或版本已变化，不能按旧身份读取新内容。");
        if (selection.representation === "original") {
          const { id, version, title, orderIndex, content } = chapter;
          return creationReference("chapter", {
            id,
            version,
            title,
            orderIndex,
            content,
          });
        }
        const detail = details.get(chapter.id);
        const summary = detail?.summaries.find(
          (value) =>
            value.id === selection.record.id &&
            value.version === selection.record.version,
        );
        if (
          !summary ||
          detail?.chapter.version !== chapter.version ||
          detail.chapter.contentHash !== hash(chapter.content)
        )
          fail(
            "所选章节摘要没有当前有效的精确采用来源，不用旧摘要或新记录替代。",
          );
        return {
          sourceKind: "knowledge",
          sourceId: summary.id,
          sourceVersion: summary.version,
          fieldPath: `/knowledge/${summary.id}`,
          sensitivity: "project",
          policyDependencies: [
            {
              sourceId: chapter.id,
              sourceVersion: chapter.version,
              fieldPath: `/chapters/${chapter.id}`,
            },
          ],
          value: {
            id: summary.id,
            version: summary.version,
            title: `${chapter.title} · 已采用派生摘要`,
            sourceChapter: { id: chapter.id, version: chapter.version },
            sourceWorkflowId: summary.sourceWorkflowId,
            summary: summary.text,
          },
        };
      },
    );
    const basis: NarrativeSummaryBasis = {
      request,
      scopeTitle,
      directory: required,
      references: references.map((reference, position) => ({
        chapter: actual[position]!,
        representation: request.chapters[position]!.representation,
        sourceKind: reference.sourceKind as "chapter" | "knowledge",
        sourceId: reference.sourceId,
        sourceVersion: reference.sourceVersion,
        fieldPath: reference.fieldPath,
        contentHash: hash(reference.value),
      })),
    };
    return { basis, references };
  };
  const collect = (projectId: string, raw: NarrativeSummaryRequest) => {
    const request = NarrativeSummaryRequestSchema.parse(raw);
    const catalog = index().catalog(projectId);
    const group = catalog.groups.find(
      (item) =>
        item.kind === request.target.kind && item.id === request.target.id,
    );
    if (
      !group ||
      group.version !== request.target.version ||
      group.state !== "current" ||
      fingerprint(group, catalog) !== request.scopeFingerprint
    )
      fail(
        "摘要范围目录、卷归属或故事弧版本已变化／未明确绑定，请重新确认，不自动换源。",
      );
    if (catalog.unavailable.length)
      throw new SummaryError(503, "摘要所需完整来源索引未核全。");
    return collectSources(
      projectId,
      request,
      directory(group, catalog),
      group.title,
    );
  };
  const reasons = (value: Stored) => {
    try {
      const current = collect(value.projectId, value.basis.request);
      return hash(current.basis) === hash(value.basis)
        ? []
        : ["所选原文、摘要或范围身份已变化。"];
    } catch (error) {
      return [
        error instanceof Error
          ? error.message
          : "摘要来源未核全，不能证明仍有效。",
      ];
    }
  };
  const decode = (value: Stored): NarrativeSummary => {
    const staleReasons = reasons(value);
    const isHead =
      context.uow.execute((tx) =>
        head(tx, value.projectId, value.basis.request.target),
      ) === value.id;
    const contextReasons: string[] = [];
    if (value.status !== "adopted" || !isHead)
      contextReasons.push("不是当前明确采用的摘要头，不作为小说上下文来源。");
    else {
      try {
        const source = collectSources(
          value.projectId,
          value.basis.request,
          value.basis.directory,
          value.basis.scopeTitle,
        );
        if (hash(source.basis) !== hash(value.basis))
          fail("已采用摘要的实际来源值已变化，不用新资料替代。");
        inspectNarrativeSummary(value.content, value.basis, source.references);
      } catch (error) {
        contextReasons.push(
          error instanceof Error ? error.message : "摘要来源未核全。",
        );
      }
    }
    return NarrativeSummarySchema.parse({
      ...value,
      isHead,
      isCurrent: isHead && value.status === "adopted" && !staleReasons.length,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
      contextEligibility: {
        state: contextReasons.length ? "ineligible" : "eligible",
        reasons: contextReasons,
      },
    });
  };
  const append = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: "knowledge.narrative-summary-changed.v1",
      pluginId: "knowledge",
      aggregateType: "narrative-summary",
      aggregateId: value.id,
      aggregateVersion: value.version,
      payload: {
        id: value.id,
        projectId: value.projectId,
        workflowId: value.workflowId,
        status: value.status,
        target: value.basis.request.target,
      },
    });
  const persist = (tx: UnitOfWorkTransaction, value: Stored) => {
    tx.run(
      "UPDATE knowledge_narrative_summaries SET value_json = ?, version = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(value),
      value.version,
      value.updatedAt,
      value.id,
    );
    append(tx, value);
  };
  const inspect = (workflow: CreationWorkflow, output: CreationContent) => {
    const basis = workflow.narrativeSummaryBasis;
    const snapshot = workflow.sourceSnapshotId
      ? optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
          workflow.sourceSnapshotId,
        )
      : undefined;
    if (
      !basis ||
      !snapshot ||
      snapshot.projectId !== workflow.input.projectId ||
      hash(basis.request) !== hash(workflow.input.narrativeSummaryRequest)
    )
      fail("摘要缺少实际冻结范围和来源快照。");
    const references = snapshot.entries.filter(
      (entry) =>
        entry.included &&
        basis.references.some(
          (source) =>
            source.sourceKind === entry.sourceKind &&
            source.sourceId === entry.sourceId &&
            source.sourceVersion === entry.sourceVersion &&
            source.fieldPath === entry.fieldPath &&
            source.contentHash === hash(entry.value),
        ),
    );
    if (references.length !== basis.references.length)
      fail("摘要所选来源未完整冻结。");
    if (
      output.items.length !== 1 ||
      output.items[0]?.kind !== "narrative-summary"
    )
      fail("候选只能包含一个独立摘要，不能创建或改写正文／设定。");
    return inspectNarrativeSummary(output.items[0].data, basis, references);
  };
  const candidate = (workflow: CreationWorkflow): Stored => {
    const content = inspect(workflow, workflow.output!);
    const existing = context.uow.execute((tx) => {
      const row = tx.get<{ id: string }>(
        "SELECT id FROM knowledge_narrative_summaries WHERE workflow_id = ?",
        workflow.id,
      );
      return row ? read(tx, row.id) : undefined;
    });
    if (existing) {
      if (
        hash(existing.content) !== hash(content) ||
        hash(existing.basis) !== hash(workflow.narrativeSummaryBasis)
      )
        fail("同一运行的已持久摘要候选不可重写。");
      return existing;
    }
    const snapshot = optionalService(
      context,
      AGENT_CONTEXT_SERVICE,
    )?.getSnapshot(workflow.sourceSnapshotId!);
    if (!snapshot) fail("摘要冻结快照不存在。");
    const now = new Date().toISOString();
    const value: Stored = {
      id: crypto.randomUUID(),
      projectId: workflow.input.projectId,
      workflowId: workflow.id,
      version: 0,
      status: "awaiting-review",
      basis: workflow.narrativeSummaryBasis!,
      content,
      sourceSnapshotId: snapshot.id,
      runIds: workflow.runIds,
      engineKind: workflow.input.engineKind,
      contextBudget: {
        source: "estimate",
        tokenBudget: snapshot.tokenBudget,
        estimatedTokens: snapshot.estimatedTokens,
      },
      usage: { state: "unknown" },
      createdAt: now,
      updatedAt: now,
    };
    context.uow.execute((tx) => {
      tx.run(
        "INSERT INTO knowledge_narrative_summaries(id,project_id,workflow_id,target_kind,target_id,value_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
        value.id,
        value.projectId,
        value.workflowId,
        value.basis.request.target.kind,
        value.basis.request.target.id,
        JSON.stringify(value),
        now,
        now,
      );
      append(tx, value);
    });
    return value;
  };
  const adapter: CreationAdapter = {
    prepare(input) {
      if (!input.narrativeSummaryRequest)
        fail("请明确确认摘要范围与全部逐章来源表达。");
      const source = collect(input.projectId, input.narrativeSummaryRequest);
      const target = source.basis.request.target;
      if (input.targetId !== target.id || input.baseVersion !== target.version)
        fail("摘要目标与运行输入版本不一致。");
      if (
        (context.uow.execute((tx) => head(tx, input.projectId, target)) ??
          null) !== source.basis.request.expectedHead
      )
        fail("当前采用摘要已变化，请重新确认，不覆盖竞争采用头。");
      return {
        narrativeSummaryBasis: source.basis,
        references: source.references,
        sources: source.references.map((entry) => ({
          kind: entry.sourceKind,
          id: entry.sourceId,
          version: entry.sourceVersion,
        })),
        prompt: `独立卷／故事弧／全书叙事摘要。只概括本轮冻结的完整非空来源范围，不改写正文、不新增设定、不自动采用；规划故事弧的名称不证明未来情节已发生。章节采用摘要是派生概括而非原文，概括可能误差累积。目录范围与逐字依据不保证语义质量。目标：${JSON.stringify(target)}。必须按本轮实际来源顺序覆盖全部非空章节；空章不算已读。仅一个 items 条目，kind=narrative-summary，data={summary,coveredChapters:[{id,version}],evidence:[{chapter:{id,version},sourceId,sourceVersion,fieldPath,quote}]}。每个非空章节至少一个逐字来自所选正文 content 或采用摘要 summary 的依据，不能引用标题、其他元数据或未纳入原文。实际完整来源及引用标识在冻结上下文中；不要声称了解范围以外的情节。`,
      };
    },
    validate(_input, output, workflow) {
      try {
        if (!workflow) fail("缺少摘要冻结运行。");
        inspect(workflow, output);
        return [];
      } catch (error) {
        return [
          {
            severity: "error",
            source: "rule",
            message:
              error instanceof Error ? error.message : "摘要结构或依据无效。",
            evidence: "",
            location: "narrative-summary/items",
            suggestion:
              "仅修正摘要结构、完整范围和所选来源逐字依据，不修改正文。",
          },
        ];
      }
    },
    review(workflow) {
      return { narrativeSummaryId: candidate(workflow).id };
    },
    reviewState(workflow) {
      const value = workflow.narrativeSummaryId
        ? stored(workflow.narrativeSummaryId)
        : undefined;
      return value?.status === "adopted" || value?.status === "discarded"
        ? value.status
        : undefined;
    },
    discard(workflow) {
      if (!workflow.narrativeSummaryId) return;
      context.uow.execute((tx) => {
        const value = read(tx, workflow.narrativeSummaryId!);
        if (!value || value.status === "discarded") return;
        if (value.status !== "awaiting-review")
          fail("正式摘要不能作为未采用候选放弃。");
        persist(tx, {
          ...value,
          status: "discarded",
          version: value.version + 1,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    apply(workflow) {
      const value = candidate(workflow);
      if (value.status === "adopted") return;
      if (value.status !== "awaiting-review" || reasons(value).length)
        fail("摘要来源已变化或候选已放弃，不能采用为当前摘要。");
      context.uow.execute((tx) => {
        const actual = read(tx, value.id)!;
        if (actual.status === "adopted") return;
        if (
          actual.status !== "awaiting-review" ||
          actual.version !== value.version ||
          (head(tx, value.projectId, value.basis.request.target) ?? null) !==
            value.basis.request.expectedHead
        )
          fail("摘要状态或当前采用头已变化，请明确重新生成；不覆盖竞争采用。");
        const now = new Date().toISOString();
        persist(tx, {
          ...actual,
          status: "adopted",
          version: actual.version + 1,
          adoptedAt: now,
          updatedAt: now,
        });
        tx.run(
          "INSERT INTO knowledge_narrative_summary_heads(project_id,target_kind,target_id,summary_id) VALUES (?,?,?,?) ON CONFLICT(project_id,target_kind,target_id) DO UPDATE SET summary_id=excluded.summary_id",
          value.projectId,
          value.basis.request.target.kind,
          value.basis.request.target.id,
          value.id,
        );
      });
    },
  };
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE, {
        get(projectId, id) {
          const value = stored(id);
          return value?.projectId === projectId ? decode(value) : undefined;
        },
        current(projectId, target) {
          if (
            !optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(projectId)
          )
            return undefined;
          const value = context.uow.execute((tx) => {
            const currentId = head(tx, projectId, target);
            return currentId ? read(tx, currentId) : undefined;
          });
          return value?.projectId === projectId &&
            value.status === "adopted" &&
            value.basis.request.target.kind === target.kind &&
            value.basis.request.target.id === target.id
            ? { id: value.id, version: value.version }
            : undefined;
        },
      }),
    `service:${KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE}`,
  );
  const projectParams = z.object({ projectId: z.string().uuid() });
  for (const route of [
    {
      path: "/api/v2/projects/{projectId}/narrative-summaries/scopes",
      operationId: "narrativeSummaries.scopes",
      params: projectParams,
      schema: NarrativeSummaryScopesSchema,
      kind: "scopes",
    },
    {
      path: "/api/v2/projects/{projectId}/narrative-summaries",
      operationId: "narrativeSummaries.list",
      params: projectParams,
      schema: NarrativeSummaryPageSchema,
      kind: "list",
    },
    {
      path: "/api/v2/projects/{projectId}/narrative-summaries/summaries",
      operationId: "narrativeSummaries.summaries",
      params: projectParams,
      schema: NarrativeSummaryStatusPageSchema,
      kind: "summaries",
    },
    {
      path: "/api/v2/projects/{projectId}/narrative-summaries/{summaryId}",
      operationId: "narrativeSummaries.get",
      params: projectParams.extend({ summaryId: z.string().uuid() }),
      schema: NarrativeSummarySchema,
      kind: "get",
    },
  ] as const) {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().max(2000).optional(),
    });
    const declaration = createRoute({
      method: "get",
      path: route.path,
      operationId: route.operationId,
      tags: ["knowledge"],
      request: {
        params: route.params,
        ...(route.kind === "list" || route.kind === "summaries"
          ? { query }
          : {}),
      },
      responses: {
        200: {
          description: "实际分层摘要与来源投影",
          content: { "application/json": { schema: route.schema } },
        },
        304: { description: "来源未变化" },
        ...Object.fromEntries(
          [400, 404, 409, 503].map((status) => [
            status,
            {
              description: "明确错误",
              content: {
                "application/problem+json": { schema: ProblemDetailsSchema },
              },
            },
          ]),
        ),
      },
    });
    context.effect(
      () =>
        context.http.register(
          defineRouteContribution({
            id: `knowledge:${route.operationId}`,
            pluginId: "knowledge",
            method: "get",
            path: route.path,
            operationId: route.operationId,
            declaration,
            policy: { idempotency: "forbidden", concurrency: "optional" },
            handler(raw) {
              const http = raw as HttpContext;
              try {
                const projectId = http.req.param("projectId");
                let value: unknown;
                if (route.kind === "scopes") value = scopes(projectId);
                else if (route.kind === "get") {
                  const source = stored(http.req.param("summaryId"));
                  if (!source || source.projectId !== projectId)
                    throw new SummaryError(404, "未找到本项目摘要。");
                  value = decode(source);
                } else {
                  // Resolve project before returning an empty list for a missing project.
                  index().catalog(projectId);
                  const parsed = query.parse({
                    limit: http.req.query("limit"),
                    cursor: http.req.query("cursor"),
                  });
                  let cursor: { at: string; id: string } | undefined;
                  if (parsed.cursor) {
                    try {
                      cursor = z
                        .object({
                          at: z.string().datetime(),
                          id: z.string().uuid(),
                        })
                        .strict()
                        .parse(
                          JSON.parse(
                            Buffer.from(parsed.cursor, "base64url").toString(
                              "utf8",
                            ),
                          ),
                        );
                    } catch {
                      throw new SummaryError(400, "摘要分页游标无效。");
                    }
                  }
                  if (cursor) {
                    const prior = stored(cursor.id);
                    if (
                      !prior ||
                      prior.projectId !== projectId ||
                      prior.createdAt !== cursor.at
                    )
                      throw new SummaryError(
                        400,
                        "摘要分页游标不属于本项目或实际记录。",
                      );
                  }
                  const limit = parsed.limit ?? 50;
                  const rows = context.uow.execute((tx) =>
                    cursor
                      ? tx.all<{ value_json: string }>(
                          "SELECT value_json FROM knowledge_narrative_summaries WHERE project_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
                          projectId,
                          cursor.at,
                          cursor.at,
                          cursor.id,
                          limit + 1,
                        )
                      : tx.all<{ value_json: string }>(
                          "SELECT value_json FROM knowledge_narrative_summaries WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
                          projectId,
                          limit + 1,
                        ),
                  );
                  const items = rows
                    .slice(0, limit)
                    .map((row) => decode(JSON.parse(row.value_json) as Stored));
                  const last = items.at(-1);
                  const page = {
                    items:
                      route.kind === "summaries"
                        ? items.map((item) =>
                            NarrativeSummaryStatusSchema.parse({
                              id: item.id,
                              projectId: item.projectId,
                              workflowId: item.workflowId,
                              version: item.version,
                              status: item.status,
                              target: item.basis.request.target,
                              isHead: item.isHead,
                              isCurrent: item.isCurrent,
                              sourceState: item.sourceState,
                              staleReasonCount: item.staleReasons.length,
                              contextEligibility: {
                                state: item.contextEligibility.state,
                                reasonCount:
                                  item.contextEligibility.reasons.length,
                              },
                              coveredChapterCount:
                                item.content.coveredChapters.length,
                              createdAt: item.createdAt,
                              updatedAt: item.updatedAt,
                              adoptedAt: item.adoptedAt,
                            }),
                          )
                        : items,
                    nextCursor:
                      rows.length > limit && last
                        ? Buffer.from(
                            JSON.stringify({ at: last.createdAt, id: last.id }),
                          ).toString("base64url")
                        : undefined,
                  };
                  value =
                    route.kind === "summaries"
                      ? NarrativeSummaryStatusPageSchema.parse(page)
                      : NarrativeSummaryPageSchema.parse(page);
                }
                const etag = `"${hash(value)}"`;
                http.header("ETag", etag);
                if (http.req.header("If-None-Match") === etag)
                  return http.body(null, 304);
                return http.json(value);
              } catch (error) {
                const status =
                  error instanceof SummaryError
                    ? error.status
                    : error instanceof z.ZodError
                      ? 400
                      : 503;
                http.header("Content-Type", "application/problem+json");
                return http.json(
                  {
                    type: "https://dramaip.local/problems/narrative-summary",
                    code: "NARRATIVE_SUMMARY",
                    traceId: crypto.randomUUID(),
                    title: "分层摘要读取失败",
                    status,
                    detail:
                      error instanceof Error
                        ? error.message
                        : "来源服务未就绪。",
                  },
                  status,
                );
              }
            },
          }),
        ),
      `route:${route.operationId}`,
    );
  }
  return adapter;
}
