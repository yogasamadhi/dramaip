import { createHash } from "node:crypto";
import { z } from "zod";
import {
  KNOWLEDGE_PROJECT_LINEAGE_SERVICE,
  KnowledgeProjectLineageItemSchema,
  KnowledgeProjectLineagePageSchema,
  KnowledgeProjectLineageCategorySchema,
  KnowledgeProjectLineageCursorSchema,
  knowledgeProjectLineageIdentity,
} from "@dramaip/contracts/creation-project-lineage";
import {
  StoryDeclarationInputSchema,
  StoryDeclarationBasisSchema,
  StoryAssertionInputSchema,
  StoryAssertionBasisSchema,
  NarrativeSummarySchema,
} from "@dramaip/contracts/knowledge";
import {
  provideService,
  type PluginContext,
} from "@dramaip/plugin-api/internal";
type Row = Record<string, unknown>;
const identity = ({ id, version }: { id: string; version: number }) => ({
  id,
  version,
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const saved = (row: Row) => ({
  id: row.id,
  projectId: row.project_id,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  observation: "saved-owner-receipt-not-full-version-history",
  fingerprint: {
    format: "derived-from-saved-knowledge-receipt-v1",
    sha256: hash({
      inputJson: row.input_json,
      basisJson: row.basis_json,
      valueJson: row.value_json,
    }),
  },
  semanticVerification: "unverified",
});
const sourceBasis = (basis: z.infer<typeof StoryDeclarationBasisSchema>) => ({
  fingerprint: basis.fingerprint,
  sources: basis.sources.map(({ selection, quote, quoteHash, anchors }) => ({
    selection,
    quoteHash,
    quoteCharacters: quote.length,
    anchors,
  })),
  policyDependencies: basis.policyDependencies,
});
function declaration(row: Row) {
  const input = StoryDeclarationInputSchema.parse(
    JSON.parse(String(row.input_json)),
  );
  const basis = StoryDeclarationBasisSchema.parse(
    JSON.parse(String(row.basis_json)),
  );
  if (
    basis.projectId !== row.project_id ||
    !equal(
      input.sources,
      basis.sources.map((item) => item.selection),
    ) ||
    (row.status === "adopted") !== Boolean(row.adopted_node_id) ||
    (row.adopted_node_id === null) !== (row.adopted_node_version === null)
  )
    throw Error("Invalid original declaration");
  return KnowledgeProjectLineageItemSchema.parse({
    ...saved(row),
    kind: "declaration",
    status: row.status,
    nodeKind: input.kind,
    sourceBasis: sourceBasis(basis),
    ...(row.adopted_node_id
      ? {
          adoptedRecord: {
            kind: "node",
            id: row.adopted_node_id,
            version: row.adopted_node_version,
          },
        }
      : {}),
    origin: "human-declared-not-independent-semantic-proof",
  });
}
function assertion(row: Row) {
  const input = StoryAssertionInputSchema.parse(
    JSON.parse(String(row.input_json)),
  );
  const basis = StoryAssertionBasisSchema.parse(
    JSON.parse(String(row.basis_json)),
  );
  if (
    basis.projectId !== row.project_id ||
    basis.sourceBasis.projectId !== row.project_id ||
    !equal(
      input.sources,
      basis.sourceBasis.sources.map((item) => item.selection),
    ) ||
    basis.nodes.some((node) => node.projectId !== row.project_id) ||
    (row.status === "adopted") !== Boolean(row.adopted_id) ||
    (row.adopted_id === null) !== (row.adopted_version === null) ||
    (row.adopted_id === null) !== (row.adopted_kind === null)
  )
    throw Error("Invalid original assertion");
  const requested =
    input.kind === "relationship"
      ? [input.from, input.to]
      : [
          input.target,
          ...(input.subject.kind === "character" ? [input.subject.node] : []),
        ];
  const endpoints = [
    ...new Map(requested.map((node) => [node.id, node])).values(),
  ];
  if (
    !equal(endpoints, basis.nodes.map(identity)) ||
    (row.adopted_kind !== null &&
      row.adopted_kind !==
        (input.kind === "relationship" ? "edge" : "cognition"))
  )
    throw Error("Invalid original endpoint or adopted-kind binding");
  const interpretation =
    input.kind === "relationship"
      ? {
          kind: input.kind,
          from: input.from,
          to: input.to,
          relation: input.relation,
          confidence: input.confidence,
          interpretation: input.interpretation,
        }
      : {
          kind: input.kind,
          subject: input.subject,
          target: input.target,
          storyOrder: input.storyOrder,
          state: input.state,
          interpretation: input.interpretation,
        };
  return KnowledgeProjectLineageItemSchema.parse({
    ...saved(row),
    kind: "assertion",
    status: row.status,
    interpretation,
    sourceFingerprint: basis.fingerprint,
    sourceBasis: sourceBasis(basis.sourceBasis),
    endpointVersions: basis.nodes.map(identity),
    policyDependencies: basis.policyDependencies,
    ...(row.adopted_id
      ? {
          adoptedRecord: {
            kind: row.adopted_kind,
            id: row.adopted_id,
            version: row.adopted_version,
          },
        }
      : {}),
    origin: "human-declared-not-independent-semantic-proof",
  });
}
const storedSummary = NarrativeSummarySchema.omit({
  isHead: true,
  isCurrent: true,
  sourceState: true,
  staleReasons: true,
  contextEligibility: true,
}).strict();
function summary(row: Row) {
  const value = storedSummary.parse(JSON.parse(String(row.value_json)));
  if (
    value.id !== row.id ||
    value.projectId !== row.project_id ||
    value.version !== row.version ||
    value.workflowId !== row.workflow_id ||
    value.basis.request.target.kind !== row.target_kind ||
    value.basis.request.target.id !== row.target_id ||
    value.createdAt !== row.created_at ||
    value.updatedAt !== row.updated_at
  )
    throw Error("Invalid original summary");
  return KnowledgeProjectLineageItemSchema.parse({
    ...saved(row),
    kind: "summary",
    workflowId: value.workflowId,
    status: value.status,
    request: value.basis.request,
    directory: value.basis.directory,
    references: value.basis.references,
    coveredChapters: value.content.coveredChapters,
    evidence: value.content.evidence.map(({ quote, ...source }) => ({
      ...source,
      quoteHash: textHash(quote),
      quoteCharacters: quote.length,
    })),
    sourceSnapshotId: value.sourceSnapshotId,
    runIds: value.runIds,
    engineKind: value.engineKind,
    contextBudget: value.contextBudget,
    usage: value.usage,
    ...(value.adoptedAt ? { adoptedAt: value.adoptedAt } : {}),
  });
}
function transition(row: Row) {
  const raw = JSON.parse(String(row.original_record_json)) as Row;
  if (
    raw.id !== row.record_id ||
    raw.project_id !== row.project_id ||
    row.source_id !==
      (row.source_kind === "declaration"
        ? row.declaration_id
        : row.assertion_id) ||
    (row.source_kind === "declaration"
      ? row.assertion_id !== null
      : row.declaration_id !== null)
  )
    throw Error("Invalid original source transition");
  const original =
    row.record_kind === "node"
      ? { kind: "node", id: raw.id, version: raw.version, nodeKind: raw.kind }
      : row.record_kind === "edge"
        ? {
            kind: "edge",
            id: raw.id,
            version: raw.version,
            fromNodeId: raw.from_node_id,
            toNodeId: raw.to_node_id,
            relation: raw.relation,
          }
        : {
            kind: "cognition",
            id: raw.id,
            version: raw.version,
            subjectType: raw.subject_type,
            subjectId: raw.subject_id,
            targetNodeId: raw.knowledge_node_id,
            storyOrder: raw.story_order,
            state: raw.state,
          };
  return KnowledgeProjectLineageItemSchema.parse({
    kind: "source-transition",
    id: row.source_id,
    projectId: row.project_id,
    sourceKind: row.source_kind,
    version: row.version,
    action: row.action,
    record: {
      kind: row.record_kind,
      id: row.record_id,
      version: row.record_version,
    },
    original,
    ...(row.replacement_id ? { replacementId: row.replacement_id } : {}),
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    observation: "original-immutable-transition-row-not-current-source-state",
    fingerprint: {
      format: "derived-from-original-retired-row-v1",
      sha256: textHash(String(row.original_record_json)),
    },
    semanticVerification: "unverified",
  });
}
export function registerKnowledgeProjectLineage(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_PROJECT_LINEAGE_SERVICE, {
        list(projectId, category, options) {
          z.string().uuid().parse(projectId);
          KnowledgeProjectLineageCategorySchema.parse(category);
          z.number().int().min(1).max(100).parse(options.limit);
          if (options.cursor)
            KnowledgeProjectLineageCursorSchema.parse(options.cursor);
          return context.uow.execute((tx) => {
            const table = {
              declarations: "knowledge_story_declarations",
              assertions: "knowledge_story_assertions",
              summaries: "knowledge_narrative_summaries",
              transitions: "knowledge_story_source_transitions",
            }[category];
            const convert = {
              declarations: declaration,
              assertions: assertion,
              summaries: summary,
              transitions: transition,
            }[category];
            let rows: Row[];
            if (category === "transitions") {
              let kind: string | undefined,
                id: string | undefined,
                version: number | undefined;
              if (options.cursor) {
                const parts = options.cursor.split(":");
                [kind, id] = parts;
                version = Number(parts[2]);
                if (
                  !tx.get(
                    `SELECT source_id FROM ${table} WHERE project_id=? AND source_kind=? AND source_id=? AND version=?`,
                    projectId,
                    kind,
                    id,
                    version,
                  )
                )
                  throw Error("Unknown owner cursor");
              }
              rows = tx.all<Row>(
                `SELECT * FROM ${table} WHERE project_id=?${options.cursor ? " AND (source_kind,source_id,version)>(?,?,?)" : ""} ORDER BY source_kind,source_id,version LIMIT ?`,
                projectId,
                ...(options.cursor ? [kind, id, version] : []),
                options.limit + 1,
              );
            } else {
              if (
                options.cursor &&
                !tx.get(
                  `SELECT id FROM ${table} WHERE project_id=? AND id=?`,
                  projectId,
                  options.cursor,
                )
              )
                throw Error("Unknown owner cursor");
              rows = tx.all<Row>(
                `SELECT * FROM ${table} WHERE project_id=?${options.cursor ? " AND id>?" : ""} ORDER BY id LIMIT ?`,
                projectId,
                ...(options.cursor ? [options.cursor] : []),
                options.limit + 1,
              );
            }
            const items = rows.slice(0, options.limit).map(convert);
            return KnowledgeProjectLineagePageSchema.parse({
              category,
              items,
              ...(rows.length > options.limit
                ? { nextCursor: knowledgeProjectLineageIdentity(items.at(-1)!) }
                : {}),
            });
          });
        },
      }),
    `service:${KNOWLEDGE_PROJECT_LINEAGE_SERVICE}`,
  );
}
