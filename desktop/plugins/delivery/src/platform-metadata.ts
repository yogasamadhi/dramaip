import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z, type ZodType } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  PlatformMetadataVariantInputSchema,
  PlatformMetadataVariantSchema,
  PlatformMetadataProfileSchema,
  PlatformMetadataAdoptInputSchema,
  PlatformMetadataPreflightInputSchema,
  PlatformMetadataPreflightSchema,
  PlatformMetadataArchiveInputSchema,
  PlatformMetadataArchiveSchema,
  PlatformMetadataArchiveEntrySchema,
  PlatformMetadataLegacyArchiveSchema,
  PlatformMetadataReceiptSchema,
  type DeliveryRecordService,
  type DeliveryRecord,
  type PlatformMetadataReceipt,
  type PlatformMetadataPreflightInput,
  type PlatformMetadataPreflight,
} from "@dramaip/contracts/delivery";
import type { ProductionRecordService } from "@dramaip/contracts/production";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import type { MediaRecordService } from "@dramaip/contracts/media";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const platformMetadataMigration: PluginMigration = {
  id: "delivery.0005.platform-metadata",
  pluginId: "delivery",
  version: "3.0.0-alpha.5",
  dependsOn: ["delivery.0001.records"],
  sql: `CREATE TABLE delivery_variant_adopted_heads (
    adaptation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL, variant_version INTEGER NOT NULL, content_hash TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE delivery_platform_requests (
    request_key TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK(operation IN ('adopt','archive')), aggregate_id TEXT NOT NULL,
    request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX delivery_platform_requests_project ON delivery_platform_requests(project_id,created_at,request_key);`,
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const boundary = {
  scope: "submission-metadata-only",
  releaseReady: false,
  unknowns: [
    "CONTENT_QUALITY_UNVERIFIED",
    "LEGAL_RIGHTS_UNVERIFIED",
    "SETTLEMENT_UNKNOWN",
    "CURRENT_FILES_NOT_READ",
    "PLATFORM_RULES_NOT_VERIFIED",
  ],
};
class MetadataError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
type HttpContext = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    queries(name: string): string[] | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
};
type Head = {
  adaptation_id: string;
  project_id: string;
  variant_id: string;
  variant_version: number;
  content_hash: string;
  revision: number;
  updated_at: string;
};
type RequestRow = {
  request_key: string;
  project_id: string;
  operation: string;
  aggregate_id: string;
  request_hash: string;
  result_json: string;
  created_at: string;
};
/** Submission metadata only. Public owner reads, Delivery-only writes; no Host/media bytes, login or distribution. */
export function platformMetadataRoutes(
  context: PluginContext,
  records: DeliveryRecordService,
  production: ProductionRecordService,
  workspace: WorkspaceProjectService,
  media: MediaRecordService,
  profiles: readonly unknown[],
): RouteContribution[] {
  const internalProfiles = z
    .array(PlatformMetadataProfileSchema)
    .parse(profiles);
  const parent = (adaptationId: string, projectId?: string) => {
    const adaptation = production.get(adaptationId),
      project = workspace.get(projectId ?? adaptation?.projectId ?? "");
    if (
      !adaptation ||
      adaptation.kind !== "adaptations" ||
      !project ||
      adaptation.projectId !== project.id
    )
      throw new MetadataError(404, "NOT_FOUND");
    return { adaptation, project };
  };
  const episodeScope = (episodeId: string, projectId: string) => {
    const episode = production.get(episodeId);
    if (
      !episode ||
      episode.kind !== "episodes" ||
      episode.projectId !== projectId ||
      !episode.parentId
    )
      throw new MetadataError(404, "NOT_FOUND");
    return { ...parent(episode.parentId, projectId), episode };
  };
  const head = (adaptationId: string, projectId: string) => {
    const h = context.uow.execute((tx) =>
      tx.get<Head>(
        "SELECT * FROM delivery_variant_adopted_heads WHERE adaptation_id=?",
        adaptationId,
      ),
    );
    if (
      h &&
      (h.project_id !== projectId ||
        !Number.isSafeInteger(h.revision) ||
        h.revision < 1 ||
        !z.string().uuid().safeParse(h.variant_id).success ||
        !Number.isSafeInteger(h.variant_version) ||
        h.variant_version < 0 ||
        !/^[a-f0-9]{64}$/.test(h.content_hash))
    )
      throw new MetadataError(503, "METADATA_HISTORY_INVALID");
    return h;
  };
  const variant = (r: DeliveryRecord) => {
    const { project, adaptation } = parent(r.parentId ?? "", r.projectId),
      h = head(adaptation.id, project.id);
    const input = PlatformMetadataVariantInputSchema.parse({
      label: r.value["label"],
      title: r.value["title"],
      description: r.value["description"],
      tags: r.value["tags"],
      ...(r.value["coverAssetId"]
        ? { coverAssetId: r.value["coverAssetId"] }
        : {}),
      source: r.value["source"],
    });
    return PlatformMetadataVariantSchema.parse({
      ...input,
      id: r.id,
      projectId: project.id,
      adaptationId: adaptation.id,
      version: r.version,
      versionNumber: r.value["versionNumber"],
      status: r.value["status"],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      contentFingerprint: hash(r),
      projectVersion: project.version,
      adaptationVersion: adaptation.version,
      headRevision: h?.revision ?? 0,
      adoptionVerified:
        !!h &&
        h.variant_id === r.id &&
        h.variant_version === r.version &&
        h.content_hash === hash(r),
    });
  };
  const preflight = (
    episodeId: string,
    input: PlatformMetadataPreflightInput,
  ): PlatformMetadataPreflight => {
    const scope = episodeScope(episodeId, input.projectId),
      profile = internalProfiles.find((p) => p.id === input.profileId);
    const r = records.get(input.creativeVariantId),
      blockers: string[] = [];
    const own =
      r?.kind === "delivery-variant" &&
      r.projectId === input.projectId &&
      r.parentId === scope.adaptation.id;
    const v = own ? variant(r) : undefined;
    if (!profile) blockers.push("未找到内部交付档案。");
    if (!v) blockers.push("候选不属于当前项目与改编，或已不可用。");
    else if (!v.adoptionVerified)
      blockers.push("原候选版本尚无有效的明确采用记录；旧状态标记不代替采用。");
    if (!input.manualFieldsConfirmed)
      blockers.push("请明确核对人工字段；这只是用户声明，不是授权或发行批准。");
    let cover;
    if (v?.coverAssetId) {
      const m = media.get(v.coverAssetId);
      if (!m || m.projectId !== input.projectId)
        blockers.push("所选封面不属于当前项目或已不可用。");
      else {
        cover = media.deliveryEvidence?.(m.id, input.projectId, m.version);
        if (!cover || cover.archive?.kind !== "image" || cover.blockers.length)
          blockers.push("所选封面缺少有效图片归档或存在来源／负面声明阻断。");
      }
    }
    const anchor = (a: { id: string; version: number }) => ({
      id: a.id,
      version: a.version,
      fingerprint: hash(a),
    });
    const snapshot =
      v && profile
        ? {
            project: anchor(scope.project),
            adaptation: anchor(scope.adaptation),
            episode: anchor(scope.episode),
            profile,
            variant: v,
            ...(cover ? { cover } : {}),
          }
        : undefined;
    const finalBaseName = `${profile?.filenamePrefix ?? "dramaip"}-episode-${episodeId}`;
    const result = PlatformMetadataPreflightSchema.parse({
      ...boundary,
      episodeId,
      input,
      ok: blockers.length === 0,
      ...(profile ? { profile } : {}),
      ...(snapshot ? { snapshot } : {}),
      blockers,
      warnings: [
        "内部档案不是目标平台当前规格；预期附件未生成、未附加、未读取，也未批准发行。",
      ],
      expectedFiles: [
        `${finalBaseName}.mp4`,
        `${finalBaseName}.srt`,
        `${finalBaseName}.json`,
      ],
      finalBaseName,
      sourceFingerprint: hash({
        episodeId,
        input,
        snapshot: snapshot ?? null,
        blockers,
        profile: profile ?? null,
      }),
    });
    return result;
  };
  const receiptHash = (
    operation: string,
    aggregateId: string,
    input: unknown,
  ) => hash({ operation, aggregateId, input });
  const readReceipt = (
    key: string,
    projectId: string,
    transaction?: UnitOfWorkTransaction,
  ) => {
    const read = (tx: UnitOfWorkTransaction) =>
      tx.get<RequestRow>(
        "SELECT * FROM delivery_platform_requests WHERE request_key=?",
        key,
      );
    const row = transaction ? read(transaction) : context.uow.execute(read);
    if (!row || row.project_id !== projectId)
      throw new MetadataError(404, "NOT_FOUND");
    const r = PlatformMetadataReceiptSchema.parse(JSON.parse(row.result_json));
    if (
      r.requestKey !== row.request_key ||
      r.projectId !== row.project_id ||
      r.operation !== row.operation ||
      r.aggregateId !== row.aggregate_id ||
      r.createdAt !== row.created_at ||
      r.requestHash !== row.request_hash ||
      receiptHash(r.operation, r.aggregateId, r.input) !== r.requestHash ||
      r.input.projectId !== r.projectId ||
      r.result.projectId !== r.projectId ||
      (r.operation === "adopt"
        ? r.result.id !== r.aggregateId ||
          r.result.adaptationId !== r.input.adaptationId
        : r.result.episodeId !== r.aggregateId)
    )
      throw new MetadataError(503, "METADATA_HISTORY_INVALID");
    return r;
  };
  const replay = (
    key: string,
    projectId: string,
    operation: string,
    aggregateId: string,
    input: unknown,
    transaction?: UnitOfWorkTransaction,
  ) => {
    const read = (tx: UnitOfWorkTransaction) =>
      tx.get<RequestRow>(
        "SELECT * FROM delivery_platform_requests WHERE request_key=?",
        key,
      );
    const exists = transaction ? read(transaction) : context.uow.execute(read);
    if (!exists) return;
    if (
      exists.project_id !== projectId ||
      exists.request_hash !== receiptHash(operation, aggregateId, input)
    )
      throw new MetadataError(409, "IDEMPOTENCY_CONFLICT");
    return readReceipt(key, projectId, transaction);
  };
  const store = (r: PlatformMetadataReceipt, tx: UnitOfWorkTransaction) => {
    PlatformMetadataReceiptSchema.parse(r);
    tx.run(
      "INSERT INTO delivery_platform_requests(request_key,project_id,operation,aggregate_id,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
      r.requestKey,
      r.projectId,
      r.operation,
      r.aggregateId,
      r.requestHash,
      JSON.stringify(r),
      r.createdAt,
    );
  };
  const ownRecord = (
    tx: UnitOfWorkTransaction,
    id: string,
  ): DeliveryRecord | undefined => {
    const row = tx.get<{
      id: string;
      kind: DeliveryRecord["kind"];
      project_id: string;
      parent_id: string | null;
      value_json: string;
      version: number;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM delivery_records WHERE id=?", id);
    return row
      ? {
          id: row.id,
          kind: row.kind,
          projectId: row.project_id,
          ...(row.parent_id ? { parentId: row.parent_id } : {}),
          value: JSON.parse(row.value_json),
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : undefined;
  };
  const queryProject = (c: HttpContext) => {
    if (c.req.queries("projectId")?.length !== 1)
      throw new MetadataError(400, "VALIDATION_ERROR");
    return z.string().uuid().parse(c.req.query("projectId"));
  };
  const key = (c: HttpContext) => {
    const parsed = z.string().uuid().safeParse(c.req.header("Idempotency-Key"));
    if (!parsed.success) throw new MetadataError(400, "VALIDATION_ERROR");
    return parsed.data;
  };
  const readArchive = (r: DeliveryRecord) => {
    if (r.value["scope"] !== "submission-metadata-only")
      return PlatformMetadataLegacyArchiveSchema.parse({
        scope: "legacy-submission-metadata-unverified",
        releaseReady: false,
        id: r.id,
        projectId: r.projectId,
        episodeId: r.parentId,
        createdAt: r.createdAt,
        deliveryVersion: r.value["deliveryVersion"],
        profileId: r.value["profileId"],
        ...(r.value["adaptationId"]
          ? { adaptationId: r.value["adaptationId"] }
          : {}),
        ...(r.value["creativeVariantId"]
          ? { creativeVariantId: r.value["creativeVariantId"] }
          : {}),
        ...(r.value["profileVersion"]
          ? { profileVersion: r.value["profileVersion"] }
          : {}),
        ...(/^[a-f0-9]{64}$/.test(String(r.value["sourceFingerprint"] ?? ""))
          ? { sourceFingerprint: r.value["sourceFingerprint"] }
          : {}),
      });
    const a = PlatformMetadataArchiveSchema.parse(r.value),
      p = a.preflight;
    if (
      a.id !== r.id ||
      a.projectId !== r.projectId ||
      a.episodeId !== r.parentId ||
      a.createdAt !== r.createdAt ||
      p.sourceFingerprint !==
        hash({
          episodeId: p.episodeId,
          input: p.input,
          snapshot: p.snapshot ?? null,
          blockers: p.blockers,
          profile: p.profile ?? null,
        })
    )
      throw new MetadataError(503, "METADATA_HISTORY_INVALID");
    return a;
  };
  const match = (c: HttpContext, value: string | number) => {
    if (c.req.header("If-Match") !== `"${value}"`)
      throw new MetadataError(412, "METADATA_PRECONDITION_CHANGED");
  };
  const routes: RouteContribution[] = [];
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    schema: ZodType,
    fn: (c: HttpContext) => unknown | Promise<unknown>,
    body?: ZodType,
    write = false,
    status: 200 | 201 = 200,
  ) => {
    routes.push(
      defineRouteContribution({
        id: `delivery:${operationId}`,
        pluginId: "delivery",
        method,
        path,
        operationId,
        policy: {
          idempotency: write ? "required" : "forbidden",
          ...(write
            ? {
                idempotencyReplay: "handler" as const,
                concurrency: "if-match-required" as const,
              }
            : {}),
        },
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["delivery"],
          request: {
            ...(path.includes("{id}")
              ? { params: z.object({ id: z.string().uuid() }) }
              : {}),
            ...(method === "get" &&
            path !== "/api/v2/platform-delivery/profiles"
              ? { query: z.object({ projectId: z.string().uuid() }).strict() }
              : {}),
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
              description: "Submission metadata, never release approval",
              content: { "application/json": { schema } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428, 503].map((s) => [
                s,
                {
                  description: "Metadata request cannot be completed",
                  content: {
                    "application/problem+json": {
                      schema: ProblemDetailsSchema,
                    },
                  },
                },
              ]),
            ),
          },
        } as never),
        handler: async (c: HttpContext) => {
          try {
            const result = schema.parse(await fn(c));
            return new Response(JSON.stringify(result), {
              status,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                ETag: `"${hash(result)}"`,
              },
            });
          } catch (e) {
            const status = e instanceof MetadataError ? e.status : 503,
              code =
                e instanceof MetadataError ? e.code : "METADATA_UNAVAILABLE";
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/platform-metadata",
                title: "提交资料未完成核对。",
                detail: "请保留原请求并重新核对；未替换为最新版本。",
                status,
                code,
                traceId: crypto.randomUUID(),
              }),
              {
                status,
                headers: {
                  "Content-Type": "application/problem+json",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
        },
      }),
    );
  };
  const parseBody = async <T>(c: HttpContext, schema: z.ZodType<T>) => {
    try {
      return schema.parse(await c.req.json());
    } catch {
      throw new MetadataError(400, "VALIDATION_ERROR");
    }
  };
  add(
    "get",
    "/api/v2/platform-delivery/profiles",
    "platform-delivery.listProfiles",
    z.array(PlatformMetadataProfileSchema),
    () => internalProfiles,
  );
  add(
    "get",
    "/api/v2/adaptations/{id}/delivery-variants",
    "platform-delivery.listVariants",
    z.array(PlatformMetadataVariantSchema),
    (c) => {
      const scope = parent(c.req.param("id"), queryProject(c));
      return records
        .list("delivery-variant", {
          projectId: scope.project.id,
          parentId: scope.adaptation.id,
        })
        .map(variant);
    },
  );
  add(
    "post",
    "/api/v2/adaptations/{id}/delivery-variants",
    "platform-delivery.createVariant",
    PlatformMetadataVariantSchema,
    async (c) => {
      const input = await parseBody(c, PlatformMetadataVariantInputSchema),
        scope = parent(c.req.param("id"));
      return variant(
        records.create("delivery-variant", {
          projectId: scope.project.id,
          parentId: scope.adaptation.id,
          value: { ...input, status: "candidate", versionNumber: 1 },
        }),
      );
    },
    PlatformMetadataVariantInputSchema,
    false,
    201,
  );
  add(
    "post",
    "/api/v2/delivery-variants/{id}/adopt",
    "platform-delivery.adoptVariant",
    PlatformMetadataReceiptSchema,
    async (c) => {
      const input = await parseBody(c, PlatformMetadataAdoptInputSchema),
        id = c.req.param("id"),
        requestKey = key(c);
      match(c, input.variantVersion);
      const replayed = replay(requestKey, input.projectId, "adopt", id, input);
      if (replayed) return replayed;
      // Public owner reads are synchronous and finish before the Delivery-only transaction. No await or peer SQL between validation and CAS.
      const original = records.get(id),
        scope = parent(input.adaptationId, input.projectId),
        originalHead = head(input.adaptationId, input.projectId);
      if (
        !original ||
        original.kind !== "delivery-variant" ||
        original.projectId !== input.projectId ||
        original.parentId !== input.adaptationId
      )
        throw new MetadataError(404, "NOT_FOUND");
      const projection = variant(original);
      return context.uow.execute((tx) => {
        const previous = replay(
          requestKey,
          input.projectId,
          "adopt",
          id,
          input,
          tx,
        );
        if (previous) return previous;
        const r = ownRecord(tx, id),
          h = tx.get<Head>(
            "SELECT * FROM delivery_variant_adopted_heads WHERE adaptation_id=?",
            input.adaptationId,
          );
        if (
          !r ||
          r.kind !== "delivery-variant" ||
          r.projectId !== input.projectId ||
          r.parentId !== input.adaptationId
        )
          throw new MetadataError(404, "NOT_FOUND");
        if (
          r.version !== input.variantVersion ||
          hash(r) !== input.contentFingerprint ||
          scope.project.version !== input.projectVersion ||
          scope.adaptation.version !== input.adaptationVersion ||
          (h?.revision ?? 0) !== input.expectedHeadRevision ||
          hash(h ?? null) !== hash(originalHead ?? null)
        )
          throw new MetadataError(412, "METADATA_PRECONDITION_CHANGED");
        const now = new Date().toISOString(),
          value = {
            ...r.value,
            status: "adopted",
            versionNumber: Number(r.value["versionNumber"]) + 1,
          };
        tx.run(
          "UPDATE delivery_records SET value_json=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          JSON.stringify(value),
          now,
          id,
          r.version,
        );
        const adopted = ownRecord(tx, id)!;
        tx.run(
          "INSERT INTO delivery_variant_adopted_heads(adaptation_id,project_id,variant_id,variant_version,content_hash,revision,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(adaptation_id) DO UPDATE SET variant_id=excluded.variant_id,variant_version=excluded.variant_version,content_hash=excluded.content_hash,revision=excluded.revision,updated_at=excluded.updated_at",
          input.adaptationId,
          input.projectId,
          id,
          adopted.version,
          hash(adopted),
          (h?.revision ?? 0) + 1,
          now,
        );
        const receipt = PlatformMetadataReceiptSchema.parse({
          requestKey,
          operation: "adopt",
          projectId: input.projectId,
          aggregateId: id,
          requestHash: receiptHash("adopt", id, input),
          createdAt: now,
          input,
          result: PlatformMetadataVariantSchema.parse({
            ...projection,
            status: "adopted",
            version: adopted.version,
            versionNumber: value.versionNumber,
            updatedAt: now,
            contentFingerprint: hash(adopted),
            headRevision: (h?.revision ?? 0) + 1,
            adoptionVerified: true,
          }),
        });
        store(receipt, tx);
        tx.append({
          type: "delivery.platform-variant-adopted.v1",
          pluginId: "delivery",
          aggregateType: "delivery-variant",
          aggregateId: id,
          aggregateVersion: adopted.version,
          payload: {
            projectId: input.projectId,
            requestKey,
            headRevision: (h?.revision ?? 0) + 1,
          },
        });
        return receipt;
      });
    },
    PlatformMetadataAdoptInputSchema,
    true,
  );
  add(
    "post",
    "/api/v2/episodes/{id}/platform-delivery/preflight",
    "platform-delivery.preflight",
    PlatformMetadataPreflightSchema,
    async (c) =>
      preflight(
        c.req.param("id"),
        await parseBody(c, PlatformMetadataPreflightInputSchema),
      ),
    PlatformMetadataPreflightInputSchema,
  );
  add(
    "post",
    "/api/v2/episodes/{id}/platform-deliveries",
    "platform-delivery.createArchive",
    PlatformMetadataReceiptSchema,
    async (c) => {
      const input = await parseBody(c, PlatformMetadataArchiveInputSchema),
        id = c.req.param("id"),
        requestKey = key(c);
      match(c, input.sourceFingerprint);
      const replayed = replay(
        requestKey,
        input.projectId,
        "archive",
        id,
        input,
      );
      if (replayed) return replayed;
      const { sourceFingerprint, ...base } = input,
        check = preflight(id, base);
      if (!check.ok) throw new MetadataError(409, "PREFLIGHT_FAILED");
      if (check.sourceFingerprint !== sourceFingerprint)
        throw new MetadataError(412, "METADATA_PRECONDITION_CHANGED");
      return context.uow.execute((tx) => {
        const previous = replay(
          requestKey,
          input.projectId,
          "archive",
          id,
          input,
          tx,
        );
        if (previous) return previous;
        const v = check.snapshot!.variant,
          raw = ownRecord(tx, v.id),
          h = tx.get<Head>(
            "SELECT * FROM delivery_variant_adopted_heads WHERE adaptation_id=?",
            check.snapshot!.adaptation.id,
          );
        if (
          !raw ||
          hash(raw) !== v.contentFingerprint ||
          h?.variant_id !== v.id ||
          h.variant_version !== v.version ||
          h.content_hash !== v.contentFingerprint ||
          h.revision !== v.headRevision
        )
          throw new MetadataError(412, "METADATA_PRECONDITION_CHANGED");
        const now = new Date().toISOString(),
          archiveId = crypto.randomUUID();
        const archive = PlatformMetadataArchiveSchema.parse({
          ...boundary,
          id: archiveId,
          projectId: input.projectId,
          adaptationId: check.snapshot!.adaptation.id,
          episodeId: id,
          profileId: input.profileId,
          profileVersion: check.profile!.version,
          creativeVariantId: input.creativeVariantId,
          deliveryVersion:
            tx.get<{ count: number }>(
              "SELECT COUNT(*) AS count FROM delivery_records WHERE kind='platform-archive' AND project_id=? AND parent_id=?",
              input.projectId,
              id,
            )!.count + 1,
          sourceFingerprint,
          createdAt: now,
          preflight: check,
        });
        tx.run(
          "INSERT INTO delivery_records(id,kind,project_id,parent_id,value_json,version,created_at,updated_at) VALUES(?,'platform-archive',?,?,?,0,?,?)",
          archiveId,
          input.projectId,
          id,
          JSON.stringify(archive),
          now,
          now,
        );
        const receipt = PlatformMetadataReceiptSchema.parse({
          requestKey,
          operation: "archive",
          projectId: input.projectId,
          aggregateId: id,
          requestHash: receiptHash("archive", id, input),
          createdAt: now,
          input,
          result: archive,
        });
        store(receipt, tx);
        tx.append({
          type: "delivery.platform-metadata-archived.v1",
          pluginId: "delivery",
          aggregateType: "platform-archive",
          aggregateId: archiveId,
          aggregateVersion: 0,
          payload: {
            projectId: input.projectId,
            requestKey,
            sourceFingerprint,
          },
        });
        return receipt;
      });
    },
    PlatformMetadataArchiveInputSchema,
    true,
    201,
  );
  add(
    "get",
    "/api/v2/platform-delivery/requests/{id}",
    "platform-delivery.recoverRequest",
    PlatformMetadataReceiptSchema,
    (c) => readReceipt(c.req.param("id"), queryProject(c)),
  );
  add(
    "get",
    "/api/v2/episodes/{id}/platform-deliveries",
    "platform-delivery.listArchives",
    z.array(PlatformMetadataArchiveEntrySchema),
    (c) => {
      const scope = episodeScope(c.req.param("id"), queryProject(c));
      // Old ID-only archives remain visible but are never upgraded into frozen evidence.
      return records
        .list("platform-archive", {
          projectId: scope.project.id,
          parentId: scope.episode.id,
        })
        .map(readArchive);
    },
  );
  add(
    "get",
    "/api/v2/platform-deliveries/{id}/export",
    "platform-delivery.exportArchive",
    z
      .object({
        fileName: z.string(),
        mimeType: z.literal("application/json; charset=utf-8"),
        content: z.string(),
      })
      .strict(),
    (c) => {
      const r = records.get(c.req.param("id")),
        projectId = queryProject(c);
      if (
        !workspace.get(projectId) ||
        !r ||
        r.kind !== "platform-archive" ||
        r.projectId !== projectId
      )
        throw new MetadataError(404, "NOT_FOUND");
      const archive = readArchive(r);
      return {
        fileName: `platform-delivery-${r.id}.json`,
        mimeType: "application/json; charset=utf-8",
        content: JSON.stringify(archive, null, 2),
      };
    },
  );
  return routes;
}
