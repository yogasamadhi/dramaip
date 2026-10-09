import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AuthorIntentContentSchema,
  AuthorIntentSourceSchema,
} from "@dramaip/contracts/workspace";
import {
  WORKSPACE_PROJECT_LINEAGE_SERVICE,
  WorkspaceProjectLineageReceiptSchema,
  WorkspaceProjectLineagePageSchema,
} from "@dramaip/contracts/creation-project-lineage";
import {
  provideService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

interface Row {
  id: string;
  project_id: string;
  version: number;
  state_version: number;
  status: string;
  content_json: string;
  source_json: string;
  base_adopted_id: string | null;
  adopted_at: string | null;
  created_at: string;
  updated_at: string;
}
const sourceSchema = z.discriminatedUnion("kind", [
  AuthorIntentSourceSchema.options[0].strict(),
  AuthorIntentSourceSchema.options[1],
]);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function receipt(tx: UnitOfWorkTransaction, row: Row) {
  AuthorIntentContentSchema.strict().parse(JSON.parse(row.content_json));
  const source = sourceSchema.parse(JSON.parse(row.source_json));
  if (row.base_adopted_id) {
    const base = tx.get<Row>(
      "SELECT * FROM workspace_author_intents WHERE id=?",
      row.base_adopted_id,
    );
    if (
      !base ||
      base.project_id !== row.project_id ||
      base.version >= row.version ||
      base.status !== "adopted"
    )
      throw Error("Invalid original intent comparison parent");
  }
  if (source.kind === "ai-generated") {
    const basis = source.creation.basis;
    if (basis.sourceBasis && basis.sourceBasis.projectId !== row.project_id)
      throw Error("Foreign original intent source basis");
    const projects = basis.references.filter(
      (ref) => ref.sourceKind === "project",
    );
    if (
      projects.length !== 1 ||
      projects[0]!.sourceId !== row.project_id ||
      projects[0]!.sourceVersion !== source.projectVersion
    )
      throw Error("Original project reference differs");
    const intents = basis.references.filter(
      (ref) => ref.sourceKind === "author_intent",
    );
    if (row.base_adopted_id) {
      const base = tx.get<Row>(
        "SELECT * FROM workspace_author_intents WHERE id=?",
        row.base_adopted_id,
      )!;
      if (
        intents.length !== 1 ||
        intents[0]!.sourceId !== base.id ||
        intents[0]!.sourceVersion !== base.version
      )
        throw Error("Original author comparison reference differs");
    } else if (intents.length)
      throw Error("Unexpected original author comparison reference");
    for (const selected of basis.request.sources)
      if (
        (!basis.request.context || selected.kind === "script") &&
        !basis.references.some(
          (ref) =>
            ref.sourceKind ===
              (selected.kind === "chapter" ? "chapter" : "production") &&
            ref.sourceId === selected.id &&
            ref.sourceVersion === selected.version &&
            ref.contentHash === selected.contentHash,
        )
      )
        throw Error("Original selected full source differs");
  }
  return WorkspaceProjectLineageReceiptSchema.parse({
    kind: "author-intent",
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    stateVersion: row.state_version,
    status: row.status,
    source:
      source.kind === "ai-generated"
        ? {
            kind: source.kind,
            projectVersion: source.projectVersion,
            creation: {
              workflowId: source.creation.workflowId,
              sourceSnapshotId: source.creation.sourceSnapshotId,
              runIds: source.creation.runIds,
              engineKind: source.creation.engineKind,
              request: source.creation.basis.request,
              references: source.creation.basis.references,
            },
          }
        : { kind: source.kind, projectVersion: source.projectVersion },
    ...(row.base_adopted_id ? { baseAdoptedId: row.base_adopted_id } : {}),
    ...(row.adopted_at ? { adoptedAt: row.adopted_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fingerprints: {
      content: {
        format: "derived-original-intent-content-json-bytes-v1",
        sha256: sha(row.content_json),
      },
      source: {
        format: "derived-original-intent-source-json-bytes-v1",
        sha256: sha(row.source_json),
      },
    },
    observation: "saved-author-intent-row-not-full-state-history",
    semanticVerification: "unverified",
  });
}
export function registerWorkspaceProjectLineage(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, WORKSPACE_PROJECT_LINEAGE_SERVICE, {
        list(projectId, options) {
          z.string().uuid().parse(projectId);
          z.number().int().min(1).max(100).parse(options.limit);
          if (options.cursor) z.string().uuid().parse(options.cursor);
          return context.uow.execute((tx) => {
            const cursor = options.cursor
              ? tx.get<Row>(
                  "SELECT * FROM workspace_author_intents WHERE project_id=? AND id=?",
                  projectId,
                  options.cursor,
                )
              : undefined;
            if (options.cursor && !cursor) throw Error("Unknown owner cursor");
            const rows = tx.all<Row>(
              `SELECT * FROM workspace_author_intents WHERE project_id=?${cursor ? " AND version<?" : ""} ORDER BY version DESC LIMIT ?`,
              projectId,
              ...(cursor ? [cursor.version] : []),
              options.limit + 1,
            );
            const items = rows
              .slice(0, options.limit)
              .map((row) => receipt(tx, row));
            return WorkspaceProjectLineagePageSchema.parse({
              items,
              ...(rows.length > options.limit
                ? { nextCursor: items.at(-1)!.id }
                : {}),
            });
          });
        },
      }),
    `service:${WORKSPACE_PROJECT_LINEAGE_SERVICE}`,
  );
}
