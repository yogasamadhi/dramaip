import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  PRODUCTION_QUALITY_SOURCE_SERVICE,
  PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
  ProductionQualitySourceSchema,
  ProductionQualitySourcePageSchema,
  ProductionRecordSchema,
  EpisodeDevelopmentBasisSchema,
  EpisodeDevelopmentResultSchema,
  type EpisodeScriptRevision,
  type EpisodeTopologyRevision,
  type EpisodeSourceRevision,
  type ProductionQualitySource,
} from "@dramaip/contracts/production";
import {
  defineRouteContribution,
  optionalService,
  provideService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  inspectEpisodeFormalAncestry,
  episodeAncestryPolicyDependencies,
  type FormalEpisodeResult,
} from "./episode-formal-ancestry.js";
import { frozenEpisodeResultReference } from "./episode-result-reference.js";

type EvidenceTable =
  | "production_episode_results"
  | "production_episode_script_revisions"
  | "production_episode_topology_revisions"
  | "production_episode_source_revisions";
interface EvidenceRow {
  table: EvidenceTable;
  id: string;
  valueJson: string;
  rowHash: string;
}

interface Row {
  id: string;
  kind: "adaptations" | "episodes" | "scripts" | "scenes";
  project_id: string;
  parent_id: string | null;
  title: string;
  payload_json: string;
  order_index: number;
  version: number;
  created_at: string;
  updated_at: string;
}
type Dependency = Extract<
  ProductionQualitySource["source"],
  { state: "available" }
>["policyDependencies"][number];
type Reason = Extract<
  ProductionQualitySource["source"],
  { state: "unavailable" }
>["reason"];
class ReadError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const query = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const parentKind = {
  scenes: "scripts",
  scripts: "episodes",
  episodes: "adaptations",
  adaptations: undefined,
} as const;

/** Owner-only, read-only evidence. No editor GET, document sync, parsing or allocation. */
export function registerProductionQualitySources(context: PluginContext) {
  const project = (id: string) => {
    const service = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!service) throw new ReadError(503, "项目读取能力不可用。");
    if (!service.get(id)) throw new ReadError(404, "实际项目不存在。");
  };
  const read = (tx: UnitOfWorkTransaction, projectId: string, id: string) => {
    const row = tx.get<Row>(
      "SELECT * FROM production_records WHERE project_id = ? AND id = ? AND kind IN ('scripts','scenes')",
      projectId,
      id,
    );
    if (!row) return undefined;
    const ancestors: Row[] = [];
    let current = row;
    while (current.parent_id) {
      const parent = tx.get<Row>(
        "SELECT * FROM production_records WHERE project_id = ? AND id = ?",
        projectId,
        current.parent_id,
      );
      if (
        !parent ||
        parent.kind !== parentKind[current.kind] ||
        ancestors.some((item) => item.id === parent.id)
      )
        return { row, ancestors, reason: "invalid-parent" as const };
      ancestors.push(parent);
      current = parent;
    }
    const ids = [row.id, ...ancestors.map((ancestor) => ancestor.id)];
    const results = ids.flatMap((recordId) =>
      tx.all<{ id: string; project_id: string; value_json: string }>(
        "SELECT id,project_id,value_json FROM production_episode_results WHERE project_id = ? AND (json_extract(value_json,'$.scriptId') = ? OR EXISTS (SELECT 1 FROM json_each(value_json,'$.productionRecords') WHERE json_extract(value,'$.id') = ?))",
        projectId,
        recordId,
        recordId,
      ),
    );
    const related = [...ids, ...results.map((result) => result.id)];
    const receipts = related.flatMap((recordId) =>
      tx.all<{ workflow_id: string; result_json: string }>(
        "SELECT workflow_id,result_json FROM production_creation_adoptions WHERE EXISTS (SELECT 1 FROM json_each(result_json) WHERE value = ?)",
        recordId,
      ),
    );
    // Legacy revision receipts use an empty result map; only actual workflow targets bind them.
    receipts.push(
      ...tx.all<{ workflow_id: string; result_json: string }>(
        "SELECT workflow_id,result_json FROM production_creation_adoptions WHERE result_json = '{}'",
      ),
    );
    return { row, ancestors, results, receipts, related };
  };
  const get = (
    projectId: string,
    id: string,
  ): ProductionQualitySource | undefined => {
    project(projectId);
    const saved = context.uow.execute((tx) => read(tx, projectId, id));
    if (!saved) return undefined;
    const identity = {
      projectId,
      id: saved.row.id,
      kind:
        saved.row.kind === "scripts" ? ("script" as const) : ("scene" as const),
      version: saved.row.version,
      title: saved.row.title,
      ...(saved.row.parent_id ? { parentId: saved.row.parent_id } : {}),
    };
    const unavailable = (reason: Reason): ProductionQualitySource => ({
      ...identity,
      source: { state: "unavailable", reason },
    });
    if (saved.reason) return unavailable(saved.reason);
    let record;
    try {
      record = ProductionRecordSchema.parse({
        id,
        kind: saved.row.kind,
        domain: saved.row.kind,
        projectId,
        ...(saved.row.parent_id ? { parentId: saved.row.parent_id } : {}),
        title: saved.row.title,
        payload: JSON.parse(saved.row.payload_json),
        orderIndex: saved.row.order_index,
        version: saved.row.version,
        createdAt: saved.row.created_at,
        updatedAt: saved.row.updated_at,
      });
    } catch {
      return unavailable("invalid-record");
    }
    const dependencies = new Map<string, Dependency>();
    const add = (dependency: Dependency) => {
      const identity = {
        sourceId: dependency.sourceId,
        sourceVersion: dependency.sourceVersion,
        fieldPath: dependency.fieldPath,
      };
      dependencies.set(JSON.stringify(identity), identity);
    };
    const addTree = (
      sourceId: string,
      sourceVersion: number,
      fieldPath: string,
      value: unknown,
    ) => {
      add({ sourceId, sourceVersion, fieldPath });
      if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value))
          addTree(
            sourceId,
            sourceVersion,
            `${fieldPath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
            child,
          );
    };
    let document;
    let documentContentHash: string | undefined;
    const scriptDocuments = new Map<
      string,
      { id: string; version: number; contentHash: string }
    >();
    const materializedWorkflows = new Map<string, Set<string>>();
    const formalBindings = new Map<string, Map<string, string | undefined>>();
    const ancestryRows: EvidenceRow[] = [];
    try {
      // Peer reads occur only AFTER leaving this owner's synchronous transaction.
      const workflows = optionalService(context, CREATION_WORKFLOW_SERVICE);
      const snapshots = optionalService(context, AGENT_CONTEXT_SERVICE);
      const inheritSnapshot = (
        snapshotId: string | undefined,
        references: readonly (Dependency & { contentHash?: string })[],
      ) => {
        if (!snapshotId || !snapshots)
          throw new Error("Actual frozen source missing");
        const snapshot = snapshots.getSnapshot(snapshotId);
        if (!snapshot || snapshot.projectId !== projectId)
          throw new Error("Actual source identity missing");
        for (const reference of references) {
          add(reference);
          const matches = snapshot.entries.filter(
            (entry) =>
              entry.included &&
              entry.sourceId === reference.sourceId &&
              entry.sourceVersion === reference.sourceVersion &&
              entry.fieldPath === reference.fieldPath,
          );
          if (matches.length !== 1)
            throw new Error("Reference is not actual frozen evidence");
          if (
            reference.contentHash &&
            reference.contentHash !== hash(matches[0]!.value)
          )
            throw new Error("Actual frozen source hash mismatch");
          for (const dependency of matches[0]!.policyDependencies ?? [])
            add(dependency);
        }
      };
      for (const result of saved.results ?? []) {
        const value = JSON.parse(result.value_json) as {
          id: string;
          projectId: string;
          workflowId?: string;
          scriptId?: string;
          productionRecords?: { id: string }[];
          operation?: string;
          origin?: string;
          basis: unknown;
          sourceSnapshotId?: string;
        };
        if (value.id !== result.id || value.projectId !== projectId)
          throw new Error("Foreign formal receipt");
        for (const recordId of [
          value.scriptId,
          ...(value.productionRecords?.map((item) => item.id) ?? []),
        ].filter(
          (recordId): recordId is string => typeof recordId === "string",
        )) {
          if (
            ![saved.row, ...saved.ancestors].some((row) => row.id === recordId)
          )
            continue;
          const bindings =
            formalBindings.get(recordId) ??
            new Map<string, string | undefined>();
          bindings.set(value.id, value.workflowId);
          formalBindings.set(recordId, bindings);
        }
        const basis = EpisodeDevelopmentBasisSchema.parse(value.basis);
        // Capture immutable owner evidence before reading peer snapshots. The
        // shared inspector reproduces every real human adoption transform; it
        // does not accept a copied receipt, a current head or missing model refs.
        const ancestry = context.uow.execute((tx) => {
          const raw = <T>(table: EvidenceTable, id: string): T | undefined => {
            const row = tx.get<{
              id: string;
              project_id: string;
              version?: number;
              operation?: string;
              value_json: string;
            }>(`SELECT * FROM ${table} WHERE id=?`, id);
            if (!row) return undefined;
            if (row.id !== id || row.project_id !== projectId)
              throw new Error("Foreign formal ancestry");
            const parsed = JSON.parse(row.value_json);
            if (
              table === "production_episode_results" &&
              (parsed.id !== row.id ||
                parsed.projectId !== row.project_id ||
                parsed.version !== row.version ||
                parsed.operation !== row.operation)
            )
              throw new Error("Actual formal row binding mismatch");
            if (
              table === "production_episode_results" &&
              id === result.id &&
              row.value_json !== result.value_json
            )
              throw new Error("Actual formal result changed during read");
            ancestryRows.push({
              table,
              id,
              valueJson: row.value_json,
              rowHash: hash(row),
            });
            return parsed as T;
          };
          const formal = (id: string): FormalEpisodeResult | undefined => {
            const result = raw<FormalEpisodeResult>(
              "production_episode_results",
              id,
            );
            if (!result) return undefined;
            const parsed = EpisodeDevelopmentResultSchema.parse({
              ...result,
              isCurrent: false,
              sourceState: "stale",
              staleReasons: [],
            });
            if (parsed.id !== id || parsed.projectId !== projectId)
              throw new Error("Foreign formal ancestry value");
            return parsed;
          };
          const human = value.origin !== undefined && value.origin !== "model";
          if (!human && value.operation !== "episode-script") return undefined;
          const root = formal(value.id);
          if (!root || hash(root.basis) !== hash(basis))
            throw new Error("Actual formal result changed during read");
          const script =
            root.operation === "episode-script"
              ? root
              : formal(
                  root.sourceRevision?.results.script.id ??
                    root.topologyRevision?.results.script.id ??
                    "",
                );
          const outline =
            script?.basis.request.outline &&
            formal(script.basis.request.outline.id);
          if (!human && (!outline?.origin || outline.origin === "model"))
            return undefined;
          if (!script || !outline)
            throw new Error("Actual human formal pair missing");
          return inspectEpisodeFormalAncestry({
            script,
            outline,
            read: formal,
            readScriptRevision: (id) =>
              raw<EpisodeScriptRevision>(
                "production_episode_script_revisions",
                id,
              ),
            readTopologyRevision: (id) =>
              raw<EpisodeTopologyRevision>(
                "production_episode_topology_revisions",
                id,
              ),
            readSourceRevision: (id) =>
              raw<EpisodeSourceRevision>(
                "production_episode_source_revisions",
                id,
              ),
            formalReference: frozenEpisodeResultReference,
          });
        });
        if (ancestry) {
          if (!snapshots) throw new Error("Actual frozen source missing");
          for (const dependency of episodeAncestryPolicyDependencies(
            ancestry,
            (id) => snapshots.getSnapshot(id),
          ))
            add(dependency);
        } else inheritSnapshot(value.sourceSnapshotId, basis.references);
      }
      for (const receipt of new Map(
        (saved.receipts ?? []).map((item) => [item.workflow_id, item]),
      ).values()) {
        if (!workflows) throw new Error("Workflow owner unavailable");
        const values: unknown[] = Object.values(
          JSON.parse(receipt.result_json),
        );
        const workflow = workflows.get(receipt.workflow_id);
        const revisedId =
          workflow?.input.operation === "script-revision"
            ? workflow.input.targetId
            : undefined;
        const bound = new Set(
          (saved.related ?? []).filter(
            (recordId) => values.includes(recordId) || recordId === revisedId,
          ),
        );
        if (!bound.size) continue;
        if (
          !workflow ||
          workflow.stage !== "applied" ||
          workflow.input.projectId !== projectId
        )
          throw new Error("Unadopted or foreign workflow");
        materializedWorkflows.set(workflow.id, bound);
        inheritSnapshot(workflow.sourceSnapshotId, workflow.referenceVersions);
      }
      for (const row of [saved.row, ...saved.ancestors]) {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        if (
          payload.sourceWorkflowId !== undefined &&
          (typeof payload.sourceWorkflowId !== "string" ||
            (!materializedWorkflows
              .get(payload.sourceWorkflowId)
              ?.has(row.id) &&
              ![...(formalBindings.get(row.id) ?? [])].some(
                ([resultId, workflowId]) =>
                  typeof workflowId === "string" &&
                  workflowId === payload.sourceWorkflowId &&
                  materializedWorkflows.get(workflowId)?.has(resultId),
              )))
        )
          throw new Error("Copied workflow marker is not adoption");
        for (const name of ["episodeResultId", "storyboardResultId"] as const)
          if (
            payload[name] !== undefined &&
            !formalBindings.get(row.id)?.has(String(payload[name]))
          )
            throw new Error("Copied formal result marker");
        addTree(row.id, row.version, `/production/${row.id}`, {
          payload,
          title: row.title,
          orderIndex: row.order_index,
        });
        if (row.kind === "scenes")
          addTree(row.id, row.version, `/scenes/${row.id}`, { payload });
      }
      for (const row of [saved.row, ...saved.ancestors].filter(
        (item) => item.kind === "scripts",
      )) {
        const source = optionalService(
          context,
          PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
        )?.get(projectId, row.id);
        if (!source || source.source.state !== "available")
          return unavailable(
            source?.source.state === "unavailable"
              ? source.source.reason
              : "lineage-unavailable",
          );
        if (
          source.scriptVersion !== row.version ||
          source.title !== row.title ||
          source.parentId !== (row.parent_id ?? undefined)
        )
          throw new Error("Saved script changed during read");
        for (const dependency of source.source.policyDependencies)
          add(dependency);
        add({
          sourceId: row.id,
          sourceVersion: row.version,
          fieldPath: `/scripts/${row.id}`,
        });
        const savedDocument = source.source.document;
        scriptDocuments.set(row.id, {
          id: savedDocument.id,
          version: savedDocument.version,
          contentHash: source.source.contentHash,
        });
        addTree(
          savedDocument.id,
          savedDocument.version,
          `/screenplays/${savedDocument.id}`,
          savedDocument,
        );
        for (const [index, block] of savedDocument.blocks.entries()) {
          addTree(
            savedDocument.id,
            savedDocument.version,
            `/screenplays/${savedDocument.id}/blocks/${block.id}`,
            block,
          );
          addTree(
            row.id,
            row.version,
            `/scripts/${row.id}/blocks/${block.id}`,
            block,
          );
          addTree(
            row.id,
            row.version,
            `/scripts/${row.id}/blocks/${index}`,
            block,
          );
        }
        if (row.id === id) {
          document = savedDocument;
          documentContentHash = source.source.contentHash;
        }
      }
      if (
        identity.kind === "script"
          ? !document?.blocks.some(
              (block) =>
                ["action", "dialogue"].includes(block.type) &&
                "text" in block &&
                block.text.trim(),
            )
          : !["场景动作", "对白与备注"].some(
              (key) =>
                typeof record.payload[key] === "string" &&
                (record.payload[key] as string).trim(),
            )
      )
        return unavailable("empty-source");
      const unchanged = context.uow.execute(
        (tx) =>
          [saved.row, ...saved.ancestors].every(
            (row) =>
              hash(
                tx.get<Row>(
                  "SELECT * FROM production_records WHERE project_id = ? AND id = ?",
                  projectId,
                  row.id,
                ),
              ) === hash(row),
          ) &&
          ancestryRows.every(({ table, id, valueJson, rowHash }) => {
            const row = tx.get<{ value_json: string }>(
              `SELECT * FROM ${table} WHERE id=? AND project_id=?`,
              id,
              projectId,
            );
            return row?.value_json === valueJson && hash(row) === rowHash;
          }),
      );
      if (!unchanged) throw new Error("Actual source changed during read");
      const policyDependencies = [...dependencies.values()].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      const ancestors = saved.ancestors.map((row) => ({
        id: row.id,
        kind: row.kind as "adaptations" | "episodes" | "scripts",
        version: row.version,
        contentHash: hash(row),
        ...(scriptDocuments.has(row.id)
          ? { document: scriptDocuments.get(row.id) }
          : {}),
      }));
      const recordContentHash = hash(saved.row);
      return ProductionQualitySourceSchema.parse({
        ...identity,
        source: {
          state: "available",
          contentHash: hash({
            recordContentHash,
            documentContentHash: documentContentHash ?? null,
            ancestors,
            policyDependencies,
          }),
          recordContentHash,
          record,
          ...(document ? { document, documentContentHash } : {}),
          ancestors,
          policyDependencies,
        },
      });
    } catch {
      return unavailable("lineage-unavailable");
    }
  };
  const list = (
    projectId: string,
    options: { cursor?: string; limit?: number } = {},
  ) => {
    project(projectId);
    const parsed = query.safeParse(options);
    if (!parsed.success) throw new ReadError(400, "来源分页参数无效。");
    const rows = context.uow.execute((tx) => {
      const anchor = parsed.data.cursor
        ? tx.get<Row>(
            "SELECT * FROM production_records WHERE project_id = ? AND id = ? AND kind IN ('scripts','scenes')",
            projectId,
            parsed.data.cursor,
          )
        : undefined;
      if (parsed.data.cursor && !anchor)
        throw new ReadError(400, "来源游标不属于本项目实际剧本／场景。");
      return anchor
        ? tx.all<Row>(
            "SELECT * FROM production_records WHERE project_id = ? AND kind IN ('scripts','scenes') AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?",
            projectId,
            anchor.created_at,
            anchor.created_at,
            anchor.id,
            parsed.data.limit + 1,
          )
        : tx.all<Row>(
            "SELECT * FROM production_records WHERE project_id = ? AND kind IN ('scripts','scenes') ORDER BY created_at DESC,id DESC LIMIT ?",
            projectId,
            parsed.data.limit + 1,
          );
    });
    const items = rows.slice(0, parsed.data.limit).map((row) => {
      const value = get(projectId, row.id);
      if (
        !value ||
        value.version !== row.version ||
        value.kind !== (row.kind === "scripts" ? "script" : "scene") ||
        value.title !== row.title ||
        value.parentId !== (row.parent_id ?? undefined)
      )
        throw new ReadError(503, "目录来源发生变化，请重新核对。");
      const { source, ...identity } = value;
      return { ...identity, state: source.state };
    });
    return ProductionQualitySourcePageSchema.parse({
      projectId,
      items,
      ...(rows.length > parsed.data.limit
        ? { nextCursor: items.at(-1)!.id }
        : {}),
    });
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_QUALITY_SOURCE_SERVICE, { get, list }),
    `service:${PRODUCTION_QUALITY_SOURCE_SERVICE.id}`,
  );
  for (const action of ["list", "get"] as const) {
    const path =
      `/api/v2/projects/{projectId}/production-quality-sources${action === "get" ? "/{recordId}" : ""}` as const;
    const operationId = `productionQualitySources.${action}`;
    const response =
      action === "get"
        ? ProductionQualitySourceSchema
        : ProductionQualitySourcePageSchema;
    const contribution = defineRouteContribution({
      id: `production:quality-sources-${action}`,
      pluginId: "production",
      method: "get",
      path,
      operationId,
      declaration: createRoute({
        method: "get",
        path,
        operationId,
        tags: ["production"],
        request: {
          params: z.object({
            projectId: z.string().uuid(),
            ...(action === "get" ? { recordId: z.string().uuid() } : {}),
          }),
          ...(action === "list" ? { query } : {}),
        },
        responses: {
          200: {
            description:
              "Actual read-only saved evidence, not semantic quality",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 404, 503].map((status) => [
              status,
              {
                description: "Source read failed",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      }),
      policy: { idempotency: "forbidden", concurrency: "optional" },
      handler(http: {
        req: {
          param(name: string): string;
          query(name: string): string | undefined;
        };
        header(name: string, value: string): void;
        json(body: unknown, status?: number): Response;
      }) {
        try {
          const projectId = http.req.param("projectId");
          const value =
            action === "get"
              ? get(projectId, http.req.param("recordId"))
              : list(projectId, {
                  cursor: http.req.query("cursor"),
                  limit:
                    http.req.query("limit") === undefined
                      ? undefined
                      : Number(http.req.query("limit")),
                });
          if (!value)
            throw new ReadError(404, "实际剧本／场景不存在或不属于本项目。");
          http.header("ETag", `"${hash(value)}"`);
          return http.json(value);
        } catch (error) {
          const status = error instanceof ReadError ? error.status : 503;
          const message =
            error instanceof ReadError
              ? error.message
              : "实际来源未核全；未初始化、修复或更换原记录。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/production-quality-source",
              status,
              code: "PRODUCTION_QUALITY_SOURCE_READ_FAILED",
              title: message,
              detail: message,
              traceId: crypto.randomUUID(),
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
  }
}
