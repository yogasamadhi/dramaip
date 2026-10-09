import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  ProblemDetailsSchema,
  type AgentContextReference,
} from "@dramaip/contracts";
import {
  KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE,
  KNOWLEDGE_STORY_DECLARATION_SERVICE,
  KNOWLEDGE_STORY_ASSERTION_SERVICE,
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  NarrativeIndexCatalogSchema,
  NarrativeStoryHierarchySchema,
  NarrativeStoryIndexSchema,
  NarrativeStoryIndexEntrySchema,
  NarrativeStorySelectionsSchema,
  StoryDeclarationSchema,
  StoryAssertionSchema,
  type StoryDeclaration,
  type StoryAssertion,
  type NarrativeStoryIndexEntry,
  type NarrativeStorySelection,
  type NarrativeIndexCatalog,
  type NarrativeStoryHierarchy,
} from "@dramaip/contracts/knowledge";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
} from "@dramaip/plugin-api/internal";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const evidencePolicy =
  "source-anchored-human-interpretations-not-semantic-proof" as const;
type Source = StoryDeclaration | StoryAssertion;
class SourceProjectNotFound extends Error {}
export function storyIndexHierarchy(
  projectId: string,
  read: () => NarrativeIndexCatalog,
): NarrativeStoryHierarchy {
  try {
    const catalog = NarrativeIndexCatalogSchema.parse(read());
    if (catalog.projectId !== projectId || catalog.unavailable.length)
      throw new Error("Incomplete current structural directory");
    return NarrativeStoryHierarchySchema.parse({
      state: "available",
      projectId,
      projectVersion: catalog.projectVersion,
      fingerprint: catalog.fingerprint,
      membershipPolicy:
        "current-directory-not-frozen-membership-or-read-coverage",
      chapters: catalog.chapters.map(({ id, version, title, orderIndex }) => ({
        id,
        version,
        title,
        orderIndex,
      })),
      groups: catalog.groups.map(
        ({ id, version, kind, title, state, reasons, chapterIds }) => ({
          id,
          version,
          kind,
          title,
          state,
          reasons,
          chapterIds,
        }),
      ),
    });
  } catch {
    return {
      state: "unavailable",
      projectId,
      reason: "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。",
    };
  }
}
interface Http {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}
export function storySourceCoverage(source: Source) {
  const chapters = new Map<string, { id: string; version: number }>();
  const scripts = new Map<string, { id: string; version: number }>();
  for (const dependency of source.basis.policyDependencies) {
    const match = /^\/(chapters|scripts)\/([a-fA-F0-9-]{36})(?:\/|$)/u.exec(
      dependency.fieldPath,
    );
    if (!match) continue;
    if (match[2] !== dependency.sourceId)
      throw new Error("叙事来源依赖的身份与路径不符。");
    const map = match[1] === "chapters" ? chapters : scripts;
    const old = map.get(dependency.sourceId);
    if (old && old.version !== dependency.sourceVersion)
      throw new Error("叙事来源版本互相冲突。");
    map.set(dependency.sourceId, {
      id: dependency.sourceId,
      version: dependency.sourceVersion,
    });
  }
  const selections =
    "sourceBasis" in source.basis
      ? source.basis.sourceBasis.sources
      : source.basis.sources;
  for (const { selection } of selections) {
    const actual =
      selection.kind === "screenplay-blocks"
        ? scripts.get(selection.scriptId)
        : chapters.get(selection.chapterId);
    const expectedVersion =
      selection.kind === "screenplay-blocks"
        ? selection.scriptVersion
        : selection.chapterVersion;
    if (!actual || actual.version !== expectedVersion)
      throw new Error("叙事声明原来源没有完整继承禁止策略依赖。");
  }
  return {
    sourceChapters: [...chapters.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    sourceScripts: [...scripts.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
}
export function storyIndexEntry(
  projectId: string,
  kind: "declaration" | "assertion",
  raw: Source,
  currentRecord: () => boolean,
): NarrativeStoryIndexEntry {
  const source =
    kind === "declaration"
      ? StoryDeclarationSchema.parse(raw)
      : StoryAssertionSchema.parse(raw);
  if (
    source.projectId !== projectId ||
    source.basis.projectId !== projectId ||
    ("sourceBasis" in source.basis &&
      source.basis.sourceBasis.projectId !== projectId) ||
    ("nodes" in source.basis &&
      source.basis.nodes.some((node) => node.projectId !== projectId))
  )
    throw new Error("叙事索引声明或冻结来源跨项目，未返回另一项目资料。");
  const record =
    "adoptedNode" in source && source.adoptedNode
      ? { kind: "node" as const, ...source.adoptedNode }
      : "adoptedRecord" in source
        ? source.adoptedRecord
        : undefined;
  const reasons = [...source.sourceStatus.reasons];
  if (source.status !== "adopted")
    reasons.push("候选或已放弃声明不是正式采用来源。");
  if (source.sourceStatus.state !== "current")
    reasons.push("原来源已失效或当前不可核对。");
  if (source.lifecycle?.state !== "active")
    reasons.push("采用绑定未核全或已撤回／替换，保留历史，不升级为当前事实。");
  if (!record) reasons.push("没有实际采用记录。");
  if (!reasons.length) {
    try {
      if (!currentRecord())
        reasons.push("实际采用记录、端点版本或原输出不匹配。");
    } catch {
      reasons.push("实际采用记录或端点来源暂不可核对。");
    }
  }
  const cognition =
    source.input.kind === "cognition" ? source.input : undefined;
  const relationship =
    kind === "assertion" &&
    source.input.kind === "relationship" &&
    "relation" in source.input
      ? source.input
      : undefined;
  if ("nodes" in source.basis) {
    const nodes = source.basis.nodes;
    const expected = relationship
      ? [relationship.from, relationship.to]
      : cognition
        ? cognition.subject.kind === "character"
          ? [cognition.subject.node, cognition.target]
          : [cognition.target]
        : [];
    if (
      nodes.length !== new Set(expected.map((ref) => ref.id)).size ||
      new Set(nodes.map((node) => node.id)).size !== nodes.length ||
      expected.some(
        (ref) =>
          !nodes.some(
            (node) => node.id === ref.id && node.version === ref.version,
          ),
      )
    )
      throw new Error(
        "关系或认知的原端点身份／版本与冻结声明不符，未猜测方向或主体。",
      );
  }
  return NarrativeStoryIndexEntrySchema.parse({
    selection: { kind, id: source.id, version: source.version },
    projectId,
    title: source.input.title,
    statement: source.input.statement,
    classification: source.input.kind,
    ...("eventTimeline" in source.input && source.input.eventTimeline
      ? { eventTimeline: source.input.eventTimeline }
      : {}),
    status: source.status,
    sourceFingerprint: source.basis.fingerprint,
    sourceState: source.sourceStatus.state,
    ...(record ? { record } : {}),
    ...(source.lifecycle ? { retirement: source.lifecycle.state } : {}),
    interpretation:
      "interpretation" in source.input
        ? source.input.interpretation
        : "author-declared",
    eligibility: { state: reasons.length ? "ineligible" : "eligible", reasons },
    ...storySourceCoverage(source),
    endpoints:
      "nodes" in source.basis
        ? source.basis.nodes.map(({ id, version, title, kind }) => ({
            id,
            version,
            title,
            kind,
          }))
        : [],
    ...(cognition
      ? {
          storyOrder: cognition.storyOrder,
          knowledgeState: cognition.state,
          cognitionSubject: cognition.subject,
          cognitionTarget: cognition.target,
        }
      : {}),
    ...(relationship
      ? {
          relation: relationship.relation,
          relationshipEndpoints: {
            from: relationship.from,
            to: relationship.to,
          },
        }
      : {}),
  });
}
export function storyIndexReference(
  entry: NarrativeStoryIndexEntry,
  source: Source,
): AgentContextReference {
  if (
    entry.eligibility.state !== "eligible" ||
    !entry.record ||
    source.id !== entry.selection.id ||
    source.version !== entry.selection.version ||
    source.projectId !== entry.projectId
  )
    throw new Error(
      "只允许精确、当前且明确采用的叙事声明，不替换候选或最新记录。",
    );
  const ownerPath =
    entry.selection.kind === "declaration"
      ? "story-declarations"
      : "story-assertions";
  const recordPath =
    entry.record.kind === "node"
      ? "nodes"
      : entry.record.kind === "edge"
        ? "edges"
        : "cognition";
  const { sources: _sources, ...statement } = source.input;
  return {
    sourceKind: "knowledge",
    sourceId: source.id,
    sourceVersion: source.version,
    fieldPath: `/narrative-story-index/${entry.selection.kind}s/${source.id}`,
    sensitivity: "project",
    policyDependencies: [
      ...source.basis.policyDependencies,
      {
        sourceId: source.id,
        sourceVersion: source.version,
        fieldPath: `/${ownerPath}/${source.id}`,
      },
      {
        sourceId: entry.record.id,
        sourceVersion: entry.record.version,
        fieldPath: `/story-declarations/${recordPath}/${entry.record.id}`,
      },
    ],
    value: {
      id: source.id,
      projectId: source.projectId,
      version: source.version,
      representation: "source-anchored-story-interpretation",
      evidencePolicy,
      ...statement,
      record: entry.record,
      sourceFingerprint: entry.sourceFingerprint,
      // Names/versions are explicitly part of this selected representation;
      // endpoint summaries and frozen source quotes/text never accompany it.
      endpoints: entry.endpoints,
      sourceChapters: entry.sourceChapters,
      sourceScripts: entry.sourceScripts,
    },
  };
}

export function registerNarrativeStoryIndex(context: PluginContext) {
  const read = (projectId: string, includeHierarchy = false) => {
    const projects = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!projects) throw new Error("项目 owner 不可核对。");
    const project = projects.get(projectId);
    if (!project) throw new SourceProjectNotFound("叙事索引项目不存在。");
    if (project.id !== projectId) throw new Error("项目 owner 身份不符。");
    const declarations = optionalService(
      context,
      KNOWLEDGE_STORY_DECLARATION_SERVICE,
    );
    const assertions = optionalService(
      context,
      KNOWLEDGE_STORY_ASSERTION_SERVICE,
    );
    if (!declarations?.indexRecords || !assertions?.indexRecords)
      throw new Error("来源声明／关系／认知读取不可用，未返回空目录。");
    const records = [
      ...declarations
        .indexRecords(projectId)
        .map((source) => ({ kind: "declaration" as const, source })),
      ...assertions
        .indexRecords(projectId)
        .map((source) => ({ kind: "assertion" as const, source })),
    ];
    if (records.length > 20000)
      throw new Error("叙事索引超过完整目录容量，未静默截断。");
    const entries = records
      .map(({ kind, source }) =>
        storyIndexEntry(projectId, kind, source, () =>
          "adoptedNode" in source && source.adoptedNode
            ? declarations.isCurrentNode(
                projectId,
                source.adoptedNode.id,
                source.adoptedNode.version,
              )
            : "adoptedRecord" in source && source.adoptedRecord
              ? assertions.isCurrentRecord(
                  projectId,
                  source.adoptedRecord.kind,
                  source.adoptedRecord.id,
                  source.adoptedRecord.version,
                )
              : false,
        ),
      )
      .sort((a, b) =>
        `${a.selection.kind}:${a.selection.id}`.localeCompare(
          `${b.selection.kind}:${b.selection.id}`,
        ),
      );
    if (
      new Set(
        entries.map((item) => `${item.selection.kind}:${item.selection.id}`),
      ).size !== entries.length
    )
      throw new Error("叙事索引身份重复，目录未完成。");
    const hierarchy = includeHierarchy
      ? storyIndexHierarchy(projectId, () => {
          const basic = optionalService(
            context,
            KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
          );
          if (!basic) throw new Error("Basic directory owner unavailable");
          return basic.catalog(projectId);
        })
      : undefined;
    return {
      records,
      catalog: NarrativeStoryIndexSchema.parse({
        projectId,
        fingerprint: hierarchy ? hash({ entries, hierarchy }) : hash(entries),
        evidencePolicy,
        entries,
        ...(hierarchy ? { hierarchy } : {}),
      }),
    };
  };
  const service = {
    catalog: (projectId: string) => read(projectId, true).catalog,
    compile: (projectId: string, raw: readonly NarrativeStorySelection[]) => {
      const selections = NarrativeStorySelectionsSchema.parse(raw);
      if (!selections.length) return { basis: [], references: [] };
      const { records, catalog } = read(projectId);
      const basis = [],
        references = [];
      for (const selection of selections) {
        const entry = catalog.entries.find(
          (item) =>
            item.selection.kind === selection.kind &&
            item.selection.id === selection.id &&
            item.selection.version === selection.version,
        );
        const record = records.find(
          (item) =>
            item.kind === selection.kind &&
            item.source.id === selection.id &&
            item.source.version === selection.version,
        );
        if (
          !entry ||
          !record ||
          !entry.record ||
          entry.eligibility.state !== "eligible"
        )
          throw new Error(
            "所选叙事声明未正式采用、失效或版本不符，不换成最新来源。",
          );
        const reference = storyIndexReference(entry, record.source);
        references.push(reference);
        basis.push({
          selection,
          sourceFingerprint: entry.sourceFingerprint,
          record: entry.record,
          sourceChapters: entry.sourceChapters,
          sourceScripts: entry.sourceScripts,
          contentHash: hash(reference.value),
        });
      }
      return { basis, references };
    },
  };
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE, service),
    `service:${KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE}`,
  );
  const path = "/api/v2/projects/{projectId}/narrative-story-index";
  const contribution = defineRouteContribution({
    id: "knowledge:narrative-story-index",
    pluginId: "knowledge",
    method: "get",
    path,
    operationId: "narrativeStoryIndex.catalog",
    declaration: createRoute({
      method: "get",
      path,
      operationId: "narrativeStoryIndex.catalog",
      tags: ["narrative-story-index"],
      request: { params: z.object({ projectId: z.string().uuid() }) },
      responses: {
        200: {
          description:
            "Source-anchored human interpretations; no source text or semantic certification",
          content: {
            "application/json": { schema: NarrativeStoryIndexSchema },
          },
        },
        304: { description: "Unchanged index" },
        400: {
          description: "Invalid project identity",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
        404: {
          description: "Project not found",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
        503: {
          description: "Source index unavailable",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      },
    }),
    policy: { idempotency: "forbidden", concurrency: "optional" },
    handler: (http: Http) => {
      try {
        const value = service.catalog(http.req.param("projectId"));
        const etag = `"${value.fingerprint}"`;
        http.header("ETag", etag);
        if (http.req.header("If-None-Match") === etag)
          return http.body(null, 304);
        return http.json(value);
      } catch (error) {
        const missing = error instanceof SourceProjectNotFound;
        const status = missing ? 404 : 503;
        http.header("Content-Type", "application/problem+json");
        return http.json(
          {
            type: "https://dramaip.local/problems/narrative-story-index",
            code: missing
              ? "PROJECT_NOT_FOUND"
              : "NARRATIVE_STORY_INDEX_UNAVAILABLE",
            traceId: crypto.randomUUID(),
            title: missing ? "Project Not Found" : "Source Index Unavailable",
            status,
            detail: missing
              ? "当前项目不存在。"
              : "叙事来源索引暂不可完整核对，未返回空成功或其他项目资料。",
          },
          status,
        );
      }
    },
  });
  context.effect(
    () => context.http.register(contribution),
    `route:${contribution.id}`,
  );
}
