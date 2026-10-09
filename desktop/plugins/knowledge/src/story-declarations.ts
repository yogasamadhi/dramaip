import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  ProblemDetailsSchema,
  type AgentContextReference,
} from "@dramaip/contracts";
import {
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  KNOWLEDGE_STORY_DECLARATION_SERVICE,
  KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE,
  StoryNodeObservationSchema,
  StoryNodeObservationSelectionSchema,
  canonicalStoryNodeReferenceJSON,
  StoryDeclarationInputSchema,
  StoryDeclarationSchema,
  StoryDeclarationPageSchema,
  StoryDeclarationSummarySchema,
  StoryDeclarationAdoptInputSchema,
  StoryDeclarationBasisSchema,
  StorySourceWithdrawInputSchema,
  StorySourceReplaceInputSchema,
  type StoryDeclaration,
  type StoryDeclarationInput,
  type StoryDeclarationBasis,
  type StoryNodeObservation,
  type StoryNodeObservationSelection,
} from "@dramaip/contracts/knowledge";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import { PRODUCTION_SCREENPLAY_SOURCE_SERVICE } from "@dramaip/contracts/production";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import {
  defineRouteContribution,
  optionalService,
  provideService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const SOURCE_ANCHORED_NODE_TYPE = "source-anchored-declaration-v1";
export { SourceError } from "./story-source-lifecycle.js";
import {
  SourceError,
  sourceLifecycle,
  sourceRetirementEvidence,
  retireStorySource,
} from "./story-source-lifecycle.js";
export const storyDeclarationMigration: PluginMigration = {
  id: "knowledge.0009.source-anchored-declarations",
  pluginId: "knowledge",
  version: "3.0.0-alpha.4",
  dependsOn: ["knowledge.0008.narrative-summaries"],
  sql: `CREATE TABLE knowledge_story_declarations (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    input_json TEXT NOT NULL, basis_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','adopted','discarded')),
    version INTEGER NOT NULL DEFAULT 0,
    adopted_node_id TEXT UNIQUE REFERENCES knowledge_causal_nodes(id),
    adopted_node_version INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX knowledge_story_declarations_project ON knowledge_story_declarations(project_id, created_at DESC, id DESC);
  CREATE TABLE knowledge_story_declaration_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    declaration_id TEXT NOT NULL REFERENCES knowledge_story_declarations(id) ON DELETE CASCADE,
    response_row_json TEXT NOT NULL, response_status INTEGER NOT NULL CHECK(response_status IN (200,201))
  );`,
};
interface Row {
  id: string;
  project_id: string;
  input_json: string;
  basis_json: string;
  status: StoryDeclaration["status"];
  version: number;
  adopted_node_id: string | null;
  adopted_node_version: number | null;
  created_at: string;
  updated_at: string;
}
interface Http {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
}
interface WriteReceipt {
  key: string;
  hash: string;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const basisHash = (value: Omit<StoryDeclarationBasis, "fingerprint">) =>
  textHash(canonical(value));

export function compileStoryDeclarationBasis(
  context: PluginContext,
  projectId: string,
  input: Pick<StoryDeclarationInput, "sources">,
): StoryDeclarationBasis {
  const project = (id: string) => {
    const projects = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!projects) throw new SourceError(503, "项目读取服务暂不可用。");
    if (!projects.get(id)) throw new SourceError(404, "当前实际项目不存在。");
  };
  project(projectId);
  const index = optionalService(context, KNOWLEDGE_NARRATIVE_INDEX_SERVICE);
  const writing = optionalService(context, WRITING_CHAPTER_SERVICE);
  if (
    input.sources.some((source) => source.kind !== "screenplay-blocks") &&
    (!index || !writing)
  )
    throw new SourceError(503, "正式来源读取服务暂不可用，不生成虚构锚点。");
  const dependencies = new Map<
    string,
    StoryDeclarationBasis["policyDependencies"][number]
  >();
  const dependency = (
    sourceId: string,
    sourceVersion: number,
    fieldPath: string,
  ) => {
    const old = dependencies.get(fieldPath);
    if (
      old &&
      (old.sourceId !== sourceId || old.sourceVersion !== sourceVersion)
    )
      throw new SourceError(409, "本轮来源版本互相冲突，不自动替换。");
    dependencies.set(fieldPath, { sourceId, sourceVersion, fieldPath });
  };
  const sources = input.sources.map((selection) => {
    if (selection.kind === "screenplay-blocks") {
      const production = optionalService(
        context,
        PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
      );
      if (!production)
        throw new SourceError(
          503,
          "正式剧本来源读取服务暂不可用，不初始化或重解析原稿。",
        );
      let snapshot;
      try {
        snapshot = production.get(projectId, selection.scriptId);
      } catch {
        throw new SourceError(503, "原剧本来源读取失败，不替换为最新正文。");
      }
      if (
        !snapshot ||
        snapshot.projectId !== projectId ||
        snapshot.scriptId !== selection.scriptId
      )
        throw new SourceError(404, "原剧本不存在或不属于本项目。");
      if (snapshot.source.state !== "available")
        throw new SourceError(
          503,
          "原已保存剧本文档缺失或损坏；只读路径不自动初始化、重解析或生成块 ID。",
        );
      const { document, contentHash } = snapshot.source;
      for (const original of snapshot.source.policyDependencies)
        dependency(
          original.sourceId,
          original.sourceVersion,
          original.fieldPath,
        );
      if (
        snapshot.scriptVersion !== selection.scriptVersion ||
        document.id !== selection.documentId ||
        document.version !== selection.documentVersion ||
        contentHash !== selection.documentContentHash
      )
        throw new SourceError(
          409,
          "原剧本记录或已保存块版本已变化，不换成新原稿。",
        );
      const selected = selection.blockIds.map((id) => {
        const blockIndex = document.blocks.findIndex(
            (block) => block.id === id,
          ),
          block = document.blocks[blockIndex];
        if (!block || block.type === "page_break" || !block.text.trim())
          throw new SourceError(
            409,
            "所选实际剧本块不存在或没有可引用文本，不生成虚构位置。",
          );
        return { block, blockIndex };
      });
      if (
        selected.some(
          (item, position) =>
            position > 0 &&
            item.blockIndex <= selected[position - 1]!.blockIndex,
        )
      )
        throw new SourceError(409, "所选剧本块顺序与实际已保存原稿不符。");
      dependency(
        snapshot.scriptId,
        snapshot.scriptVersion,
        `/production/${snapshot.scriptId}`,
      );
      dependency(
        snapshot.scriptId,
        snapshot.scriptVersion,
        `/production/${snapshot.scriptId}/payload/剧本内容`,
      );
      dependency(document.id, document.version, `/screenplays/${document.id}`);
      dependency(
        snapshot.scriptId,
        snapshot.scriptVersion,
        `/scripts/${snapshot.scriptId}`,
      );
      for (const { block, blockIndex } of selected) {
        dependency(
          document.id,
          document.version,
          `/screenplays/${document.id}/blocks/${block.id}`,
        );
        dependency(
          snapshot.scriptId,
          snapshot.scriptVersion,
          `/scripts/${snapshot.scriptId}/blocks/${block.id}`,
        );
        dependency(
          document.id,
          document.version,
          `/screenplays/${document.id}/blocks/${blockIndex}`,
        );
      }
      const text = selected.map(({ block }) => block.text).join("\n\n");
      return {
        selection,
        text,
        quote: text,
        quoteHash: textHash(text),
        anchors: selected.map(({ block, blockIndex }) => ({
          blockId: block.id,
          blockIndex,
          blockType: block.type,
          ...(block.sourceLocation
            ? { sourceLocation: block.sourceLocation }
            : {}),
        })),
      };
    }
    const chapter = writing!.get(selection.chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new SourceError(404, "原章节不存在或不属于本项目。");
    if (
      chapter.version !== selection.chapterVersion ||
      !chapter.content.trim() ||
      hash(chapter.content) !== selection.chapterContentHash
    )
      throw new SourceError(409, "原章节版本或内容已变化，不换成新正文。");
    const detail = index!.chapter(projectId, chapter.id);
    if (
      !detail ||
      detail.projectId !== projectId ||
      detail.chapter.id !== chapter.id ||
      detail.chapter.version !== chapter.version ||
      detail.chapter.contentHash !== selection.chapterContentHash
    )
      throw new SourceError(503, "实际章节与叙事索引无法核对，不编造段落。");
    dependency(chapter.id, chapter.version, `/chapters/${chapter.id}`);
    const paragraphDependency = (id: string) => {
      const paragraph = detail.paragraphs.find((value) => value.id === id);
      if (!paragraph)
        throw new SourceError(
          503,
          "实际引文段落依赖无法核对，不绕过禁止路径。",
        );
      const base = `/chapters/${chapter.id}/paragraphs/`;
      // Match the Writing compiler's canonical encoded path and its legacy
      // content-hash denial alias, as well as the raw declaration path.
      for (const identity of new Set([
        id,
        encodeURIComponent(id),
        paragraph.contentHash,
      ]))
        dependency(chapter.id, chapter.version, `${base}${identity}`);
    };
    if (selection.kind === "paragraphs") {
      const selected = selection.paragraphIds.map((id) => {
        const paragraph = detail.paragraphs.find((value) => value.id === id);
        if (!paragraph)
          throw new SourceError(
            409,
            "所选实际段落不存在于原版本，不替换成完整正文。",
          );
        return paragraph;
      });
      if (
        selected.some(
          (paragraph, position) =>
            position > 0 && paragraph.start <= selected[position - 1]!.start,
        )
      )
        throw new SourceError(409, "所选段落顺序与实际原文不符。");
      for (const paragraph of selected) paragraphDependency(paragraph.id);
      const text = selected
        .map((paragraph) =>
          chapter.content.slice(paragraph.start, paragraph.end),
        )
        .join("\n\n");
      return {
        selection,
        text,
        quote: text,
        quoteHash: textHash(text),
        anchors: selected.map((paragraph) => ({
          start: paragraph.start,
          end: paragraph.end,
          paragraphIds: [paragraph.id],
        })),
      };
    }
    const fact = detail.facts.find((value) => value.id === selection.recordId);
    if (
      !fact ||
      fact.version !== selection.recordVersion ||
      fact.sourceWorkflowId !== selection.workflowId
    )
      throw new SourceError(
        409,
        "所选叙事资料不是该版本的精确采用记录，不接受候选、复制标记或最新替代。",
      );
    const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      fact.sourceWorkflowId,
    );
    if (
      !workflow ||
      workflow.stage !== "applied" ||
      workflow.input.projectId !== projectId ||
      workflow.input.operation !== "chapter-memory" ||
      workflow.input.targetId !== chapter.id ||
      workflow.input.baseVersion !== chapter.version
    )
      throw new SourceError(
        503,
        "原采用工作流身份无法核对，不把缺证据的资料当作正式来源。",
      );
    dependency(fact.id, fact.version, `/knowledge/${fact.id}`);
    for (const reference of workflow.referenceVersions)
      dependency(
        reference.sourceId,
        reference.sourceVersion,
        reference.fieldPath,
      );
    for (const match of fact.evidence.matches)
      for (const paragraphId of match.paragraphIds)
        paragraphDependency(paragraphId);
    return {
      selection,
      text: fact.text,
      quote: fact.evidence.quote,
      quoteHash: textHash(fact.evidence.quote),
      anchors: fact.evidence.matches,
    };
  });
  if (
    sources.reduce(
      (total, source) =>
        total +
        Buffer.byteLength(source.text, "utf8") +
        Buffer.byteLength(source.quote, "utf8"),
      0,
    ) > 1_048_576
  )
    throw new SourceError(
      400,
      "本次声明来源超过 1 MiB，请明确缩小选择，不静默裁剪。",
    );
  const basis = {
    format: "source-anchored-story-declaration-v1" as const,
    projectId,
    evidencePolicy: "exact-source-identity-not-semantic-verification" as const,
    sources,
    policyDependencies: [...dependencies.values()].sort((a, b) =>
      a.fieldPath.localeCompare(b.fieldPath),
    ),
  };
  const parsed = StoryDeclarationBasisSchema.safeParse({
    ...basis,
    fingerprint: basisHash(basis),
  });
  if (!parsed.success || dependencies.size > 1999)
    throw new SourceError(
      400,
      "精确来源或隐私依赖超出单次声明容量，请缩小选择，不静默裁剪。",
    );
  return parsed.data;
}

export function registerStoryDeclarations(context: PluginContext) {
  const project = (id: string) => {
    const projects = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!projects) throw new SourceError(503, "项目读取服务暂不可用。");
    if (!projects.get(id)) throw new SourceError(404, "当前实际项目不存在。");
  };
  const compile = (projectId: string, input: StoryDeclarationInput) =>
    compileStoryDeclarationBasis(context, projectId, input);
  const getRow = (projectId: string, id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>(
        "SELECT * FROM knowledge_story_declarations WHERE id = ? AND project_id = ?",
        id,
        projectId,
      ),
    );
  const state = (row: Row): StoryDeclaration["sourceStatus"] => {
    try {
      const input = StoryDeclarationInputSchema.parse(
        JSON.parse(row.input_json),
      );
      const basis = StoryDeclarationBasisSchema.parse(
        JSON.parse(row.basis_json),
      );
      return compile(row.project_id, input).fingerprint === basis.fingerprint
        ? { state: "current", reasons: [] }
        : { state: "stale", reasons: ["原声明来源身份或锚点已变化。"] };
    } catch (cause) {
      return {
        state:
          cause instanceof SourceError && cause.status !== 503
            ? "stale"
            : "unavailable",
        reasons: [
          cause instanceof SourceError
            ? cause.message
            : "原来源暂不可核对，不视作已核验。",
        ],
      };
    }
  };
  const value = (row: Row): StoryDeclaration => {
    const body = {
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      status: row.status,
      input: StoryDeclarationInputSchema.parse(JSON.parse(row.input_json)),
      basis: StoryDeclarationBasisSchema.parse(JSON.parse(row.basis_json)),
      ...(row.adopted_node_id && row.adopted_node_version !== null
        ? {
            adoptedNode: {
              id: row.adopted_node_id,
              version: row.adopted_node_version,
            },
          }
        : {}),
      sourceStatus: state(row),
      ...(row.status === "adopted" &&
      row.adopted_node_id &&
      row.adopted_node_version !== null
        ? {
            lifecycle: context.uow.execute((tx) =>
              sourceLifecycle(tx, row.project_id, "declaration", row.id, {
                kind: "node",
                id: row.adopted_node_id!,
                version: row.adopted_node_version!,
              }),
            ),
          }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return StoryDeclarationSchema.parse({ ...body, etag: `"${hash(body)}"` });
  };
  const currentNode = (
    projectId: string,
    nodeId: string,
    nodeVersion: number,
  ) => {
    const row = context.uow.execute((tx) =>
      tx.get<Row>(
        "SELECT * FROM knowledge_story_declarations WHERE project_id = ? AND status = 'adopted' AND adopted_node_id = ? AND adopted_node_version = ?",
        projectId,
        nodeId,
        nodeVersion,
      ),
    );
    if (!row) return undefined;
    const node = context.uow.execute((tx) =>
      tx.get<{
        kind: string;
        title: string;
        summary: string;
        source_type: string;
        source_id: string;
        source_version: number;
        confirmed: number;
      }>(
        "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
        nodeId,
        projectId,
        nodeVersion,
      ),
    );
    if (!node) return undefined;
    const declaration = value(row);
    if (
      !node ||
      !node.confirmed ||
      node.source_type !== SOURCE_ANCHORED_NODE_TYPE ||
      node.source_id !== row.id ||
      node.source_version !== row.version ||
      node.kind !== declaration.input.kind ||
      node.title !== declaration.input.title ||
      node.summary !== declaration.input.statement
    )
      return undefined;
    if (declaration.sourceStatus.state === "unavailable")
      throw new SourceError(
        503,
        "正式声明的原来源暂不可核对，不创建缺项快照或发送上下文。",
      );
    return declaration.sourceStatus.state === "current"
      ? declaration
      : undefined;
  };
  const reference = (declaration: StoryDeclaration): AgentContextReference => ({
    sourceKind: "knowledge",
    sourceId: declaration.id,
    sourceVersion: declaration.version,
    fieldPath: `/story-declarations/${declaration.id}`,
    sensitivity: "project",
    policyDependencies: [
      ...declaration.basis.policyDependencies,
      {
        sourceId: declaration.adoptedNode!.id,
        sourceVersion: declaration.adoptedNode!.version,
        fieldPath: `/story-declarations/nodes/${declaration.adoptedNode!.id}`,
      },
    ],
    value: {
      id: declaration.id,
      projectId: declaration.projectId,
      version: declaration.version,
      kind: declaration.input.kind,
      title: declaration.input.title,
      statement: declaration.input.statement,
      ...(declaration.input.eventTimeline
        ? { eventTimeline: declaration.input.eventTimeline }
        : {}),
      evidenceBasis:
        "human-adopted-source-anchored-declaration-not-semantic-proof",
      sourceFingerprint: declaration.basis.fingerprint,
      sourceAnchors: declaration.basis.sources.map(
        ({ selection, quoteHash, anchors }) => ({
          selection,
          quoteHash,
          anchors,
        }),
      ),
    },
  });
  const observeNode = (
    projectId: string,
    selection: StoryNodeObservationSelection,
  ): StoryNodeObservation => {
    const requested = StoryNodeObservationSelectionSchema.parse(selection);
    try {
      project(projectId);
      // Capture only our rows/lifecycle in one own transaction. Compilation
      // invokes public source owners afterwards, outside our write/read UOW.
      // This is an observation, never commit authority or a distributed lock.
      const { row, node, lifecycle } = context.uow.execute((tx) => {
        const row = tx.get<Row>(
          "SELECT * FROM knowledge_story_declarations WHERE id = ? AND project_id = ?",
          requested.declaration.id,
          projectId,
        );
        const node = tx.get<{
          id: string;
          project_id: string;
          version: number;
          kind: string;
          title: string;
          summary: string;
          source_type: string;
          source_id: string;
          source_version: number;
          confirmed: number;
          retired_at: string | null;
        }>(
          "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ?",
          requested.node.id,
          projectId,
        );
        const lifecycle =
          row?.status === "adopted" &&
          row.adopted_node_id &&
          row.adopted_node_version !== null
            ? sourceLifecycle(tx, projectId, "declaration", row.id, {
                kind: "node",
                id: row.adopted_node_id,
                version: row.adopted_node_version,
              })
            : null;
        return { row, node, lifecycle };
      });
      const declaration = row ? value(row) : undefined;
      const reasonCodes: StoryNodeObservation["reasonCodes"] = [];
      if (!row) reasonCodes.push("declaration-missing");
      else {
        if (row.status !== "adopted")
          reasonCodes.push("declaration-not-adopted");
        if (row.version !== requested.declaration.version)
          reasonCodes.push("declaration-version-changed");
        if (
          row.adopted_node_id !== requested.node.id ||
          row.adopted_node_version !== requested.node.version
        )
          reasonCodes.push("declaration-node-binding-changed");
        if (declaration!.sourceStatus.state !== "current")
          reasonCodes.push(
            declaration!.sourceStatus.state === "stale"
              ? "declaration-source-stale"
              : "declaration-source-unavailable",
          );
      }
      if (!node) reasonCodes.push("node-missing");
      else {
        if (node.version !== requested.node.version)
          reasonCodes.push("node-version-changed");
        if (
          declaration &&
          (node.source_type !== SOURCE_ANCHORED_NODE_TYPE ||
            node.source_id !== declaration.id ||
            node.source_version !== declaration.version ||
            node.kind !== declaration.input.kind ||
            node.title !== declaration.input.title ||
            node.summary !== declaration.input.statement)
        )
          reasonCodes.push("node-fields-changed");
        if (node.confirmed !== 1) reasonCodes.push("node-unconfirmed");
        if (node.retired_at !== null) reasonCodes.push("node-retired");
      }
      if (lifecycle?.state === "withdrawn")
        reasonCodes.push("node-lifecycle-withdrawn");
      if (lifecycle?.state === "replaced")
        reasonCodes.push("node-lifecycle-replaced");
      const lifecycleSummary = lifecycle
        ? {
            state: lifecycle.state,
            version: lifecycle.version,
            record: lifecycle.record,
            ...(lifecycle.replacementId
              ? { replacementId: lifecycle.replacementId }
              : {}),
          }
        : null;
      return StoryNodeObservationSchema.parse({
        format: "exact-story-node-owner-observation-v1",
        projectId,
        requested,
        declaration:
          row && declaration
            ? {
                id: row.id,
                version: row.version,
                status: row.status,
                adoptedNode: declaration.adoptedNode ?? null,
                sourceState: declaration.sourceStatus.state,
                contentHash: hash(row),
              }
            : null,
        node: node
          ? {
              id: node.id,
              version: node.version,
              retired: node.retired_at !== null,
              confirmed: node.confirmed === 1,
              contentHash: hash(node),
            }
          : null,
        lifecycle: lifecycleSummary,
        referenceHash:
          reasonCodes.length === 0
            ? createHash("sha256")
                .update(
                  canonicalStoryNodeReferenceJSON(reference(declaration!)),
                )
                .digest("hex")
            : null,
        reasonCodes,
        semanticVerification: "unverified",
      });
    } catch (cause) {
      if (cause instanceof SourceError && cause.status === 404) throw cause;
      throw new SourceError(
        503,
        "原故事节点本次元数据读取未核全；不使用旧缓存或替代节点。",
      );
    }
  };
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE, {
        observe: observeNode,
      }),
    `service:${KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE.id}`,
  );
  const emit = (
    tx: UnitOfWorkTransaction,
    action: "created" | "adopted" | "discarded",
    row: Row,
  ) =>
    tx.append({
      type: `knowledge.story-declaration-${action}.v1`,
      pluginId: "knowledge",
      aggregateType: "story-declaration",
      aggregateId: row.id,
      aggregateVersion: row.version,
      payload: {
        id: row.id,
        projectId: row.project_id,
        version: row.version,
        status: row.status,
        ...(row.adopted_node_id ? { nodeId: row.adopted_node_id } : {}),
      },
    });
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_STORY_DECLARATION_SERVICE, {
        indexRecords: (projectId) => {
          project(projectId);
          const rows = context.uow.execute((tx) =>
            tx.all<Row>(
              "SELECT * FROM knowledge_story_declarations WHERE project_id = ? ORDER BY created_at, id LIMIT 20001",
              projectId,
            ),
          );
          if (rows.length > 20000)
            throw new SourceError(
              503,
              "来源声明超过本地索引容量，未返回截断目录。",
            );
          return rows.map(value);
        },
        isCurrentNode: (projectId, nodeId, nodeVersion) =>
          Boolean(currentNode(projectId, nodeId, nodeVersion)),
        nodeReference: (projectId, nodeId, nodeVersion) => {
          const declaration = currentNode(projectId, nodeId, nodeVersion);
          return declaration ? reference(declaration) : undefined;
        },
        references: (projectId) => {
          project(projectId);
          return context.uow
            .execute((tx) =>
              tx.all<Row>(
                "SELECT * FROM knowledge_story_declarations WHERE project_id = ? AND status = 'adopted' ORDER BY created_at, id",
                projectId,
              ),
            )
            .flatMap((row): AgentContextReference[] => {
              if (!row.adopted_node_id || row.adopted_node_version === null)
                return [];
              const declaration = currentNode(
                projectId,
                row.adopted_node_id,
                row.adopted_node_version,
              );
              if (!declaration) return [];
              return [reference(declaration)];
            });
        },
      }),
    `service:${KNOWLEDGE_STORY_DECLARATION_SERVICE}`,
  );

  const basePath = "/api/v2/projects/{projectId}/story-declarations";
  const pagination = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const remember = (
    tx: UnitOfWorkTransaction,
    receipt: WriteReceipt,
    row: Row,
    status: 200 | 201,
  ) =>
    tx.run(
      "INSERT INTO knowledge_story_declaration_requests(request_key, request_hash, declaration_id, response_row_json, response_status) VALUES (?, ?, ?, ?, ?)",
      receipt.key,
      receipt.hash,
      row.id,
      JSON.stringify(row),
      status,
    );
  const params = z.object({ projectId: z.string().uuid() });
  const oneParams = params.extend({ declarationId: z.string().uuid() });
  const register = (
    name: string,
    method: "get" | "post",
    path: string,
    response: z.ZodType,
    handler: (
      http: Http,
      receipt?: WriteReceipt,
    ) => Promise<Response> | Response,
    body?: z.ZodType,
    status: 200 | 201 = 200,
  ) => {
    const route = defineRouteContribution({
      id: `knowledge:story-declarations-${name}`,
      pluginId: "knowledge",
      method,
      path: path as `/api/v2/${string}`,
      operationId: `storyDeclarations.${name}`,
      declaration: createRoute({
        method,
        path,
        operationId: `storyDeclarations.${name}`,
        tags: ["story-declarations"],
        request: {
          params: path === basePath ? params : oneParams,
          ...(name === "list" ? { query: pagination } : {}),
          ...(body
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: body } },
                },
              }
            : {}),
        },
        responses: {
          [status]: {
            description:
              "Source-anchored human declaration, not semantic proof",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 428, 503].map((code) => [
              code,
              {
                description: "Declaration rejected",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      }),
      policy: {
        idempotency: method === "post" ? "required" : "forbidden",
        ...(method === "post" ? { idempotencyReplay: "handler" as const } : {}),
        concurrency: ["adopt", "discard", "withdraw", "replace"].includes(name)
          ? "if-match-required"
          : "optional",
      },
      handler: async (http: Http) => {
        try {
          project(http.req.param("projectId"));
          let receipt: WriteReceipt | undefined;
          if (method === "post") {
            const key = http.req.header("Idempotency-Key");
            if (!key || !key.trim() || key.length > 200)
              throw new SourceError(428, "须提供并保留本次声明请求键。");
            receipt = {
              key,
              hash: textHash(
                canonical({
                  operation: name,
                  projectId: http.req.param("projectId"),
                  declarationId:
                    path === basePath ? null : http.req.param("declarationId"),
                  body: await http.req.json(),
                  ifMatch: http.req.header("If-Match") ?? null,
                }),
              ),
            };
            const prior = context.uow.execute((tx) =>
              tx.get<{
                request_hash: string;
                response_row_json: string;
                response_status: 200 | 201;
              }>(
                "SELECT * FROM knowledge_story_declaration_requests WHERE request_key = ?",
                key,
              ),
            );
            if (prior) {
              if (prior.request_hash !== receipt.hash)
                throw new SourceError(
                  409,
                  "原请求键已绑定不同声明或审阅输入，不能替换。",
                );
              // Replay the original action receipt, refreshing only its live
              // source projection. Never execute another write or adopt latest.
              return respond(
                http,
                JSON.parse(prior.response_row_json) as Row,
                prior.response_status,
              );
            }
          }
          return await handler(http, receipt);
        } catch (cause) {
          if (!(cause instanceof SourceError)) throw cause;
          return Response.json(
            {
              type: "https://dramaip.local/problems/story-declaration",
              title: "Story declaration rejected",
              detail: cause.message,
              code: "STORY_DECLARATION",
              status: cause.status,
              traceId: crypto.randomUUID(),
            },
            {
              status: cause.status,
              headers: { "Content-Type": "application/problem+json" },
            },
          );
        }
      },
    });
    context.effect(() => context.http.register(route), `route:${route.id}`);
  };
  const respond = (http: Http, row: Row, status = 200) => {
    const result = value(row);
    http.header("ETag", result.etag);
    return http.json(result, status);
  };
  register(
    "create",
    "post",
    basePath,
    StoryDeclarationSchema,
    async (http, receipt) => {
      const parsed = StoryDeclarationInputSchema.safeParse(
        await http.req.json(),
      );
      if (!parsed.success)
        throw new SourceError(400, "声明和精确来源选择格式无效。");
      const projectId = http.req.param("projectId"),
        basis = compile(projectId, parsed.data),
        now = new Date().toISOString();
      const row: Row = {
        id: crypto.randomUUID(),
        project_id: projectId,
        input_json: JSON.stringify(parsed.data),
        basis_json: JSON.stringify(basis),
        status: "pending",
        version: 0,
        adopted_node_id: null,
        adopted_node_version: null,
        created_at: now,
        updated_at: now,
      };
      context.uow.execute((tx) => {
        tx.run(
          "INSERT INTO knowledge_story_declarations(id, project_id, input_json, basis_json, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
          row.id,
          projectId,
          row.input_json,
          row.basis_json,
          now,
          now,
        );
        emit(tx, "created", row);
        remember(tx, receipt!, row, 201);
      });
      return respond(http, row, 201);
    },
    StoryDeclarationInputSchema,
    201,
  );
  register(
    "get",
    "get",
    `${basePath}/{declarationId}`,
    StoryDeclarationSchema,
    (http) => {
      const row = getRow(
        http.req.param("projectId"),
        http.req.param("declarationId"),
      );
      if (!row) throw new SourceError(404, "未找到本项目的原声明候选。");
      return respond(http, row);
    },
  );
  register("list", "get", basePath, StoryDeclarationPageSchema, (http) => {
    const parsed = pagination.safeParse({
      cursor: http.req.query("cursor"),
      limit: http.req.query("limit"),
    });
    if (!parsed.success) throw new SourceError(400, "声明分页参数无效。");
    const projectId = http.req.param("projectId"),
      cursor = parsed.data.cursor
        ? getRow(projectId, parsed.data.cursor)
        : undefined;
    if (parsed.data.cursor && !cursor)
      throw new SourceError(400, "分页游标不属于本项目的实际声明。");
    const rows = context.uow.execute((tx) =>
      tx.all<Row>(
        "SELECT * FROM knowledge_story_declarations WHERE project_id = ? AND (? = '' OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
        projectId,
        cursor?.id ?? "",
        cursor?.created_at ?? "",
        cursor?.created_at ?? "",
        cursor?.id ?? "",
        parsed.data.limit + 1,
      ),
    );
    const items = rows.slice(0, parsed.data.limit).map((row) => {
      const { input, basis, etag: _etag, lifecycle, ...result } = value(row);
      return StoryDeclarationSummarySchema.parse({
        ...result,
        ...(lifecycle
          ? {
              lifecycle: {
                state: lifecycle.state,
                version: lifecycle.version,
                record: lifecycle.record,
                ...(lifecycle.replacementId
                  ? { replacementId: lifecycle.replacementId }
                  : {}),
              },
            }
          : {}),
        title: input.title,
        kind: input.kind,
        sourceFingerprint: basis.fingerprint,
      });
    });
    return http.json({
      projectId,
      items,
      ...(rows.length > parsed.data.limit
        ? { nextCursor: items.at(-1)!.id }
        : {}),
    });
  });
  for (const action of ["adopt", "discard"] as const)
    register(
      action,
      "post",
      `${basePath}/{declarationId}/${action}`,
      StoryDeclarationSchema,
      async (http, receipt) => {
        const body = await http.req.json();
        const adoption =
          action === "adopt"
            ? StoryDeclarationAdoptInputSchema.safeParse(body)
            : undefined;
        if (
          (adoption && !adoption.success) ||
          (action === "discard" &&
            !z.object({}).strict().safeParse(body).success)
        )
          throw new SourceError(
            400,
            "须明确核对原来源和声明解释，不接受自动采用或任意确认。",
          );
        const expected = http.req.header("If-Match");
        if (!expected)
          throw new SourceError(428, "处理原声明须提供原审阅 ETag。");
        const projectId = http.req.param("projectId"),
          id = http.req.param("declarationId");
        const originalRow = getRow(projectId, id);
        if (!originalRow) throw new SourceError(404, "未找到本项目原声明。");
        // Cross-owner reads are synchronous preflight, outside the write UoW.
        // There is no await before the transaction; recheck the exact owner row
        // inside it and append its durable event atomically with the adoption.
        const current = value(originalRow);
        if (current.etag !== expected)
          throw new SourceError(
            412,
            "原声明或来源读取状态已变化，请重查原 ID，不替换来源。",
          );
        const result = context.uow.execute((tx) => {
          const row = tx.get<Row>(
            "SELECT * FROM knowledge_story_declarations WHERE id = ? AND project_id = ?",
            id,
            projectId,
          );
          if (!row) throw new SourceError(404, "未找到本项目原声明。");
          if (JSON.stringify(row) !== JSON.stringify(originalRow))
            throw new SourceError(
              412,
              "原声明或来源读取状态已变化，请重查原 ID，不替换来源。",
            );
          if (row.status !== "pending")
            throw new SourceError(
              409,
              "原声明已处理，不能重复采用或放弃正式内容。",
            );
          if (action === "adopt") {
            if (current.sourceStatus.state === "unavailable")
              throw new SourceError(
                503,
                "原声明来源暂不可核对，不采用旧缓存或缺失文档。",
              );
            if (
              !adoption?.success ||
              adoption.data.sourceFingerprint !== current.basis.fingerprint ||
              current.sourceStatus.state !== "current"
            )
              throw new SourceError(
                409,
                "原来源已失效或未核同一冻结指纹，不能采用旧候选。",
              );
            const nodeId = crypto.randomUUID(),
              now = new Date().toISOString();
            tx.run(
              "INSERT INTO knowledge_causal_nodes(id, project_id, kind, title, summary, source_type, source_id, source_version, confirmed, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)",
              nodeId,
              projectId,
              current.input.kind,
              current.input.title,
              current.input.statement,
              SOURCE_ANCHORED_NODE_TYPE,
              id,
              now,
              now,
            );
            tx.run(
              "UPDATE knowledge_story_declarations SET status = 'adopted', version = version + 1, adopted_node_id = ?, adopted_node_version = 0, updated_at = ? WHERE id = ?",
              nodeId,
              now,
              id,
            );
          } else
            tx.run(
              "UPDATE knowledge_story_declarations SET status = 'discarded', version = version + 1, updated_at = ? WHERE id = ?",
              new Date().toISOString(),
              id,
            );
          const updated = tx.get<Row>(
            "SELECT * FROM knowledge_story_declarations WHERE id = ?",
            id,
          )!;
          emit(tx, action === "adopt" ? "adopted" : "discarded", updated);
          remember(tx, receipt!, updated, 200);
          return updated;
        });
        return respond(http, result);
      },
      action === "adopt"
        ? StoryDeclarationAdoptInputSchema
        : z.object({}).strict(),
    );
  for (const action of ["withdraw", "replace"] as const)
    register(
      action,
      "post",
      `${basePath}/{declarationId}/${action}`,
      StoryDeclarationSchema,
      async (http, receipt) => {
        const parsed = (
          action === "replace"
            ? StorySourceReplaceInputSchema
            : StorySourceWithdrawInputSchema
        ).safeParse(await http.req.json());
        if (!parsed.success)
          throw new SourceError(
            400,
            "须明确核对原图记录、撤回理由及指定新候选的两项审阅。",
          );
        const expected = http.req.header("If-Match");
        if (!expected) throw new SourceError(428, "须保留原声明的审阅 ETag。");
        const projectId = http.req.param("projectId"),
          id = http.req.param("declarationId"),
          row = getRow(projectId, id);
        if (!row) throw new SourceError(404, "未找到本项目原来源声明。");
        const original = value(row);
        if (original.etag !== expected)
          throw new SourceError(412, "原来源声明已变，请重查原 ID。");
        if (row.status !== "adopted" || !original.adoptedNode)
          throw new SourceError(409, "只能明确撤回或替换已独立采用的原声明。");
        const adopted = { kind: "node" as const, ...original.adoptedNode };
        const fields = {
          kind: original.input.kind,
          title: original.input.title,
          summary: original.input.statement,
          source_type: SOURCE_ANCHORED_NODE_TYPE,
          source_id: id,
          source_version: row.version,
          confirmed: 1,
        };
        const evidence = context.uow.execute((tx) =>
          sourceRetirementEvidence(
            tx,
            projectId,
            "declaration",
            id,
            adopted,
            parsed.data,
            fields,
          ),
        );
        const replacementInput =
          action === "replace"
            ? StorySourceReplaceInputSchema.parse(parsed.data).replacement
            : undefined;
        const nextRow = replacementInput
          ? getRow(projectId, replacementInput.id)
          : undefined;
        if (replacementInput && !nextRow)
          throw new SourceError(404, "指定新候选不存在或不属于本项目。");
        const next = nextRow ? value(nextRow) : undefined;
        if (next && replacementInput) {
          if (next.etag !== replacementInput.etag)
            throw new SourceError(412, "新候选或来源已变化，请重审指定 ID。");
          if (next.sourceStatus.state === "unavailable")
            throw new SourceError(503, "新来源不可核对，不采用缺项候选。");
          if (
            next.status !== "pending" ||
            next.id === id ||
            next.input.kind !== original.input.kind ||
            next.sourceStatus.state !== "current" ||
            next.basis.fingerprint !== replacementInput.sourceFingerprint
          )
            throw new SourceError(
              409,
              "新来源必须是同类、当前且单独审阅的本项目未采用候选。",
            );
        }
        context.uow.execute((tx) => {
          const actual = tx.get<Row>(
            "SELECT * FROM knowledge_story_declarations WHERE id = ? AND project_id = ?",
            id,
            projectId,
          );
          if (JSON.stringify(actual) !== JSON.stringify(row))
            throw new SourceError(412, "原声明在提交前变化。");
          if (
            nextRow &&
            JSON.stringify(
              tx.get<Row>(
                "SELECT * FROM knowledge_story_declarations WHERE id = ? AND project_id = ?",
                nextRow.id,
                projectId,
              ),
            ) !== JSON.stringify(nextRow)
          )
            throw new SourceError(412, "指定新候选在提交前变化。");
          retireStorySource(
            tx,
            projectId,
            "declaration",
            id,
            adopted,
            parsed.data,
            fields,
            evidence,
            next?.id,
          );
          if (next) {
            const now = new Date().toISOString(),
              nodeId = crypto.randomUUID();
            tx.run(
              "INSERT INTO knowledge_causal_nodes(id,project_id,kind,title,summary,source_type,source_id,source_version,confirmed,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)",
              nodeId,
              projectId,
              next.input.kind,
              next.input.title,
              next.input.statement,
              SOURCE_ANCHORED_NODE_TYPE,
              next.id,
              now,
              now,
            );
            tx.run(
              "UPDATE knowledge_story_declarations SET status = 'adopted', version = version + 1, adopted_node_id = ?, adopted_node_version = 0, updated_at = ? WHERE id = ?",
              nodeId,
              now,
              next.id,
            );
            emit(
              tx,
              "adopted",
              tx.get<Row>(
                "SELECT * FROM knowledge_story_declarations WHERE id = ?",
                next.id,
              )!,
            );
          }
          remember(tx, receipt!, row, 200);
        });
        return respond(http, row);
      },
      action === "replace"
        ? StorySourceReplaceInputSchema
        : StorySourceWithdrawInputSchema,
    );
}
