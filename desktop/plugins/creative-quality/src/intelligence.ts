import { optionalService } from "@dramaip/plugin-api/internal";
import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import {
  CREATIVE_KNOWLEDGE_SERVICE,
  CreativeExperimentSchema,
  CreativeFingerprintDimensionKeySchema,
  CreativeFingerprintSchema,
  OriginalityRiskSchema,
  type CreativeExperiment,
  type CreativeFingerprint,
  type CreativeFingerprintDimension,
  type CreativeFingerprintDimensionKey,
  type CreativeVariant,
  type CreativeKnowledgeService,
  type OriginalityRisk,
  ProblemDetailsSchema,
} from "@dramaip/contracts";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

interface ExperimentRow {
  id: string;
  origin_type: CreativeExperiment["originType"];
  origin_id: string | null;
  project_id: string | null;
  prompt: string;
  strategy_version: string;
  status: CreativeExperiment["status"];
  variants_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const DIMENSIONS = CreativeFingerprintDimensionKeySchema.options;
const DEFAULT_DIMENSIONS: readonly CreativeFingerprintDimension[] =
  DIMENSIONS.map((key) => ({
    key,
    score: 0.5,
    confidence: 0,
    frozen: false,
    evidenceIds: [],
  }));

function fingerprint(context: PluginContext): CreativeFingerprint {
  return context.uow.execute((transaction) => {
    const settings = transaction.get<{
      enabled: number;
      consented_at: string | null;
      avoidances_json: string;
      goals_json: string;
      version: number;
      updated_at: string;
    }>("SELECT * FROM creative_fingerprint_settings WHERE id = 'local'");
    const dimensions = transaction
      .all<{
        dimension_key: CreativeFingerprintDimensionKey;
        score: number;
        confidence: number;
        frozen: number;
        evidence_ids_json: string;
      }>("SELECT * FROM creative_fingerprint_dimensions ORDER BY dimension_key")
      .map((row) => ({
        key: row.dimension_key,
        score: row.score,
        confidence: row.confidence,
        frozen: Boolean(row.frozen),
        evidenceIds: JSON.parse(row.evidence_ids_json),
      }));
    return {
      enabled: Boolean(settings?.enabled),
      ...(settings?.consented_at ? { consentedAt: settings.consented_at } : {}),
      dimensions:
        dimensions.length === DIMENSIONS.length
          ? dimensions
          : [...DEFAULT_DIMENSIONS],
      avoidances: settings ? JSON.parse(settings.avoidances_json) : [],
      goals: settings ? JSON.parse(settings.goals_json) : [],
      version: settings?.version ?? 0,
      updatedAt: settings?.updated_at ?? new Date(0).toISOString(),
    };
  });
}

function experiment(row: ExperimentRow): CreativeExperiment {
  return {
    id: row.id,
    originType: row.origin_type,
    ...(row.origin_id ? { originId: row.origin_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    prompt: row.prompt,
    strategyVersion: row.strategy_version,
    status: row.status,
    variants: JSON.parse(row.variants_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  operationId: string;
  body?: ZodType;
  params?: ZodType;
  response?: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["creative-intelligence"],
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
        ...(input.response && status !== 204
          ? { content: { "application/json": { schema: input.response } } }
          : {}),
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
  policy?: { idempotency?: "required"; concurrency?: "if-match-required" },
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
    ...(policy ? { policy } : {}),
  });
}

function score(prompt: string, lane: CreativeVariant["lane"], key: string) {
  const digest = createHash("sha256")
    .update(`${prompt}\0${lane}\0${key}`)
    .digest();
  return 45 + (digest[0]! % 51);
}

function variants(prompt: string): CreativeVariant[] {
  const configs: readonly [CreativeVariant["lane"], string, string][] = [
    [
      "conservative",
      "稳健延展",
      "保留核心设定，强化人物动机和因果闭环，减少额外世界规则。",
    ],
    [
      "balanced",
      "平衡重构",
      "保留情绪承诺，同时替换一个关键关系或冲突机制，制造可解释的新鲜感。",
    ],
    [
      "wild",
      "大胆异变",
      "反转核心假设，把最不可能成立的条件变成故事规则，再检查可读性和制作代价。",
    ],
  ];
  return configs.map(([lane, title, instruction]) => ({
    id: crypto.randomUUID(),
    lane,
    title,
    content: `${instruction}\n\n创意原点：${prompt}`,
    scores: Object.fromEntries(
      [
        "novelty",
        "coherence",
        "emotional_hook",
        "audience_surprise",
        "production_feasibility",
        "similarity_risk",
      ].map((key) => [key, score(prompt, lane, key)]),
    ),
    selected: false,
  }));
}

function updateFingerprintFromSelection(
  transaction: UnitOfWorkTransaction,
  experimentId: string,
  chosen: CreativeVariant,
  now: string,
): void {
  const settings = transaction.get<{ enabled: number }>(
    "SELECT enabled FROM creative_fingerprint_settings WHERE id = 'local'",
  );
  if (!settings?.enabled) return;
  const valueByDimension: Partial<
    Record<CreativeFingerprintDimensionKey, number>
  > = {
    novelty: (chosen.scores.novelty ?? 50) / 100,
    conflict: (chosen.scores.emotional_hook ?? 50) / 100,
    reversal: (chosen.scores.audience_surprise ?? 50) / 100,
    production_complexity:
      1 - (chosen.scores.production_feasibility ?? 50) / 100,
  };
  for (const [key, sample] of Object.entries(valueByDimension)) {
    const current = transaction.get<{
      score: number;
      confidence: number;
      frozen: number;
      evidence_ids_json: string;
    }>(
      "SELECT score, confidence, frozen, evidence_ids_json FROM creative_fingerprint_dimensions WHERE dimension_key = ?",
      key,
    );
    if (!current || current.frozen) continue;
    const evidence = [
      ...new Set<string>([
        ...(JSON.parse(current.evidence_ids_json) as string[]),
        experimentId,
      ]),
    ].slice(-100);
    const confidence = Math.min(1, current.confidence + 0.1);
    const scoreValue =
      current.confidence === 0
        ? sample!
        : current.score * 0.75 + sample! * 0.25;
    transaction.run(
      `UPDATE creative_fingerprint_dimensions SET score = ?, confidence = ?,
       evidence_ids_json = ?, updated_at = ? WHERE dimension_key = ?`,
      scoreValue,
      confidence,
      JSON.stringify(evidence),
      now,
      key,
    );
  }
  transaction.run(
    "UPDATE creative_fingerprint_settings SET version = version + 1, updated_at = ? WHERE id = 'local'",
    now,
  );
}

const fingerprintSettingsInput = z.object({ enabled: z.boolean() });
const fingerprintPatch = z.object({
  version: z.number().int().nonnegative(),
  dimensions: z
    .array(
      z.object({
        key: CreativeFingerprintDimensionKeySchema,
        score: z.number().min(0).max(1).optional(),
        frozen: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
  avoidances: z.array(z.string().max(500)).max(100).optional(),
  goals: z.array(z.string().max(500)).max(100).optional(),
});
const experimentInput = z.object({
  originType: z.enum(["inspiration", "corpus", "project"]),
  originId: z.string().max(200).optional(),
  projectId: z.string().uuid().optional(),
  prompt: z.string().trim().min(1).max(20_000),
});
const experimentReview = z.object({
  version: z.number().int().nonnegative(),
  selectedVariantId: z.string().uuid().optional(),
  rejected: z.boolean().default(false),
});
const idParams = z.object({ id: z.string().uuid() });

export function creativeIntelligenceQualityRoutes(
  context: PluginContext,
): readonly RouteContribution[] {
  const creativeKnowledge = optionalService<CreativeKnowledgeService>(
    context,
    CREATIVE_KNOWLEDGE_SERVICE,
  );
  if (!creativeKnowledge)
    throw new Error(
      "creative-quality requires knowledge.creative-intelligence.v1",
    );
  const routes: RouteContribution[] = [];
  routes.push(
    route(
      {
        id: "creative-quality:fingerprint-get",
        pluginId: "creative-quality",
        method: "get",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.get",
        response: CreativeFingerprintSchema,
      }),
      (requestContext) => requestContext.json(fingerprint(context)),
    ),
    route(
      {
        id: "creative-quality:fingerprint-settings",
        pluginId: "creative-quality",
        method: "put",
        path: "/api/v2/creative-fingerprint/settings",
        operationId: "creative-fingerprint.updateSettings",
      },
      declaration({
        method: "put",
        path: "/api/v2/creative-fingerprint/settings",
        operationId: "creative-fingerprint.updateSettings",
        body: fingerprintSettingsInput,
        response: CreativeFingerprintSchema,
      }),
      async (requestContext) => {
        const parsed = fingerprintSettingsInput.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意指纹授权设置无效。",
          );
        const now = new Date().toISOString();
        context.uow.execute((transaction) => {
          transaction.run(
            `UPDATE creative_fingerprint_settings SET enabled = ?,
             consented_at = CASE WHEN ? = 1 THEN COALESCE(consented_at, ?) ELSE consented_at END,
             version = version + 1, updated_at = ? WHERE id = 'local'`,
            parsed.data.enabled ? 1 : 0,
            parsed.data.enabled ? 1 : 0,
            now,
            now,
          );
        });
        return requestContext.json(fingerprint(context));
      },
    ),
    route(
      {
        id: "creative-quality:fingerprint-update",
        pluginId: "creative-quality",
        method: "patch",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.update",
      },
      declaration({
        method: "patch",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.update",
        body: fingerprintPatch,
        response: CreativeFingerprintSchema,
      }),
      async (requestContext) => {
        const parsed = fingerprintPatch.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意指纹修改无效。",
          );
        const current = fingerprint(context);
        if (current.version !== parsed.data.version)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "创意指纹已更新，请刷新后重试。",
          );
        const now = new Date().toISOString();
        context.uow.execute((transaction) => {
          for (const dimension of parsed.data.dimensions ?? [])
            transaction.run(
              `UPDATE creative_fingerprint_dimensions SET
               score = COALESCE(?, score), frozen = COALESCE(?, frozen), updated_at = ?
               WHERE dimension_key = ?`,
              dimension.score ?? null,
              dimension.frozen === undefined ? null : dimension.frozen ? 1 : 0,
              now,
              dimension.key,
            );
          transaction.run(
            `UPDATE creative_fingerprint_settings SET
             avoidances_json = COALESCE(?, avoidances_json),
             goals_json = COALESCE(?, goals_json),
             version = version + 1, updated_at = ? WHERE id = 'local'`,
            parsed.data.avoidances
              ? JSON.stringify(parsed.data.avoidances)
              : null,
            parsed.data.goals ? JSON.stringify(parsed.data.goals) : null,
            now,
          );
        });
        return requestContext.json(fingerprint(context));
      },
      { concurrency: "if-match-required" },
    ),
    route(
      {
        id: "creative-quality:fingerprint-clear",
        pluginId: "creative-quality",
        method: "delete",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.clear",
      },
      declaration({
        method: "delete",
        path: "/api/v2/creative-fingerprint",
        operationId: "creative-fingerprint.clear",
        status: 204,
      }),
      (requestContext) => {
        const now = new Date().toISOString();
        context.uow.execute((transaction) => {
          transaction.run(
            `UPDATE creative_fingerprint_settings SET enabled = 0,
             consented_at = NULL, avoidances_json = '[]', goals_json = '[]',
             version = version + 1, updated_at = ? WHERE id = 'local'`,
            now,
          );
          transaction.run(
            `UPDATE creative_fingerprint_dimensions SET score = 0.5,
             confidence = 0, frozen = 0, evidence_ids_json = '[]', updated_at = ?`,
            now,
          );
        });
        return requestContext.body(null, 204);
      },
    ),
  );

  routes.push(
    route(
      {
        id: "creative-quality:experiments-list",
        pluginId: "creative-quality",
        method: "get",
        path: "/api/v2/creative-experiments",
        operationId: "creative-experiments.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/creative-experiments",
        operationId: "creative-experiments.list",
        response: z.object({ items: z.array(CreativeExperimentSchema) }),
      }),
      (requestContext) => {
        const projectId = requestContext.req.query("projectId") ?? "";
        return requestContext.json({
          items: context.uow.execute((transaction) =>
            transaction
              .all<ExperimentRow>(
                `SELECT * FROM creative_experiments
                 WHERE (? = '' OR project_id = ?) ORDER BY updated_at DESC, id`,
                projectId,
                projectId,
              )
              .map(experiment),
          ),
        });
      },
    ),
    route(
      {
        id: "creative-quality:experiments-create",
        pluginId: "creative-quality",
        method: "post",
        path: "/api/v2/creative-experiments",
        operationId: "creative-experiments.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/creative-experiments",
        operationId: "creative-experiments.create",
        body: experimentInput,
        response: CreativeExperimentSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = experimentInput.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意实验参数无效。",
          );
        if (parsed.data.originType === "project" && !parsed.data.projectId)
          return problem(
            requestContext,
            400,
            "PROJECT_REQUIRED",
            "项目实验必须提供项目标识。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const candidates = variants(parsed.data.prompt);
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO creative_experiments(
              id, origin_type, origin_id, project_id, prompt, strategy_version,
              status, variants_json, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'creative-lab.v1', 'ready', ?, 0, ?, ?)`,
            id,
            parsed.data.originType,
            parsed.data.originId ?? null,
            parsed.data.projectId ?? null,
            parsed.data.prompt,
            JSON.stringify(candidates),
            now,
            now,
          );
          return experiment(
            transaction.get<ExperimentRow>(
              "SELECT * FROM creative_experiments WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    ),
    route(
      {
        id: "creative-quality:experiments-review",
        pluginId: "creative-quality",
        method: "post",
        path: "/api/v2/creative-experiments/{id}/review",
        operationId: "creative-experiments.review",
      },
      declaration({
        method: "post",
        path: "/api/v2/creative-experiments/{id}/review",
        operationId: "creative-experiments.review",
        params: idParams,
        body: experimentReview,
        response: CreativeExperimentSchema,
      }),
      async (requestContext) => {
        const parsed = experimentReview.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "实验评价无效。",
          );
        const result = context.uow.execute((transaction) => {
          const row = transaction.get<ExperimentRow>(
            "SELECT * FROM creative_experiments WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!row) return undefined;
          if (row.version !== parsed.data.version) return "conflict" as const;
          const values = JSON.parse(row.variants_json) as CreativeVariant[];
          const chosen = parsed.data.selectedVariantId
            ? values.find((value) => value.id === parsed.data.selectedVariantId)
            : undefined;
          if (!parsed.data.rejected && !chosen) return "selection" as const;
          const next = values.map((value) => ({
            ...value,
            selected: value.id === chosen?.id,
          }));
          const now = new Date().toISOString();
          transaction.run(
            `UPDATE creative_experiments SET status = ?, variants_json = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            parsed.data.rejected ? "rejected" : "completed",
            JSON.stringify(next),
            now,
            row.id,
            row.version,
          );
          if (chosen)
            updateFingerprintFromSelection(transaction, row.id, chosen, now);
          return experiment(
            transaction.get<ExperimentRow>(
              "SELECT * FROM creative_experiments WHERE id = ?",
              row.id,
            )!,
          );
        });
        if (result === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "实验已被评价，请刷新后重试。",
          );
        if (result === "selection")
          return problem(
            requestContext,
            400,
            "VARIANT_REQUIRED",
            "请选择候选或明确全部拒绝。",
          );
        return result
          ? requestContext.json(result)
          : problem(requestContext, 404, "NOT_FOUND", "未找到实验。");
      },
      { idempotency: "required" },
    ),
  );

  routes.push(
    route(
      {
        id: "creative-quality:originality-list",
        pluginId: "creative-quality",
        method: "get",
        path: "/api/v2/projects/{id}/originality-risks",
        operationId: "originality-risks.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/originality-risks",
        operationId: "originality-risks.list",
        params: idParams,
        response: z.object({ items: z.array(OriginalityRiskSchema) }),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const risks = (() => {
          const edges = creativeKnowledge
            .listProvenance(projectId)
            .map((value) => ({
              id: value.id,
              from_type: value.fromType,
              from_id: value.fromId,
              relation: value.relation,
              quote_excerpt: value.quoteExcerpt ?? null,
            }));
          const byTarget = new Map<string, typeof edges>();
          for (const edge of edges) {
            const key = `${edge.from_type}:${edge.from_id}`;
            byTarget.set(key, [...(byTarget.get(key) ?? []), edge]);
          }
          const now = new Date().toISOString();
          return [...byTarget.entries()].flatMap(([target, evidence]) => {
            const [targetType, ...id] = target.split(":");
            const quotedWithoutExcerpt = evidence.some(
              (value) =>
                value.relation === "quoted_from" && !value.quote_excerpt,
            );
            const singleSource =
              evidence.filter((value) => value.relation !== "generated_from")
                .length === 1;
            if (!quotedWithoutExcerpt && !singleSource) return [];
            const risk: OriginalityRisk = {
              id: crypto.randomUUID(),
              projectId,
              targetType: targetType ?? "asset",
              targetId: id.join(":"),
              severity: quotedWithoutExcerpt ? "high" : "review",
              reason: quotedWithoutExcerpt
                ? "存在未附短摘录说明的引用来源，需要人工复核。"
                : "该资产目前只记录了单一外部来源，需要检查是否过度依赖。",
              evidenceEdgeIds: evidence.map((value) => value.id),
              legalConclusion: false,
              createdAt: now,
            };
            return [risk];
          });
        })();
        return requestContext.json({ items: risks });
      },
    ),
  );
  return routes;
}

export const creativeIntelligenceQualityMigrations: readonly PluginMigration[] =
  [
    {
      id: "creative-quality.0003.intelligence",
      pluginId: "creative-quality",
      version: "3.0.0-alpha.3",
      dependsOn: [
        "creative-quality.0002.resources",
        "knowledge.0005.story-intelligence",
      ],
      sql: `
      CREATE TABLE IF NOT EXISTS creative_fingerprint_settings (
        id TEXT PRIMARY KEY CHECK(id = 'local'),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
        consented_at TEXT,
        avoidances_json TEXT NOT NULL DEFAULT '[]',
        goals_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO creative_fingerprint_settings(
        id, enabled, avoidances_json, goals_json, version, updated_at
      ) VALUES ('local', 0, '[]', '[]', 0, '1970-01-01T00:00:00.000Z');
      CREATE TABLE IF NOT EXISTS creative_fingerprint_dimensions (
        dimension_key TEXT PRIMARY KEY CHECK(dimension_key IN (
          'humor','genre','tone','pace','conflict','reversal',
          'emotional_intensity','visuality','novelty','production_complexity'
        )),
        score REAL NOT NULL DEFAULT 0.5 CHECK(score >= 0 AND score <= 1),
        confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
        frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0,1)),
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO creative_fingerprint_dimensions(dimension_key, updated_at)
      VALUES
        ('humor','1970-01-01T00:00:00.000Z'),
        ('genre','1970-01-01T00:00:00.000Z'),
        ('tone','1970-01-01T00:00:00.000Z'),
        ('pace','1970-01-01T00:00:00.000Z'),
        ('conflict','1970-01-01T00:00:00.000Z'),
        ('reversal','1970-01-01T00:00:00.000Z'),
        ('emotional_intensity','1970-01-01T00:00:00.000Z'),
        ('visuality','1970-01-01T00:00:00.000Z'),
        ('novelty','1970-01-01T00:00:00.000Z'),
        ('production_complexity','1970-01-01T00:00:00.000Z');
      CREATE TABLE IF NOT EXISTS creative_experiments (
        id TEXT PRIMARY KEY,
        origin_type TEXT NOT NULL CHECK(origin_type IN ('inspiration','corpus','project')),
        origin_id TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','ready','completed','rejected')),
        variants_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS creative_experiments_project
        ON creative_experiments(project_id, updated_at DESC, id);
    `,
    },
  ];
