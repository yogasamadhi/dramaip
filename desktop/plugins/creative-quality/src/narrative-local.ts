import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  NARRATIVE_LOCAL_QUALITY_SERVICE,
  NarrativeLocalQualityBasisSchema,
  NarrativeLocalQualitySourceSchema,
  NarrativeLocalQualityCreateSchema,
  NarrativeLocalQualityDecisionSchema,
  NarrativeLocalQualityDispositionSchema,
  NarrativeLocalQualityReviewSchema,
  NarrativeLocalQualityPageSchema,
  NarrativeLocalQualitySummarySchema,
  NarrativeLocalQualitySummaryPageSchema,
  NarrativeQualityRequestSchema,
  type NarrativeQualityRequest,
  type NarrativeLocalQualitySource,
  type NarrativeLocalQualityReview,
} from "@dramaip/contracts/creative-quality";
import {
  defineRouteContribution,
  provideService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  inspectLocalHumanContent,
  inspectLocalLiteralRepetition,
  localQualityDigest,
} from "./narrative-local-content.js";
import { assessLocalNarrativeReviews } from "./narrative-local-assessment.js";

export const narrativeLocalQualityMigration: PluginMigration = {
  id: "creative-quality.0005.local-reviews",
  pluginId: "creative-quality",
  version: "3.0.0-alpha.4",
  dependsOn: ["creative-quality.0004.narrative-reports"],
  sql: `CREATE TABLE narrative_local_quality_reviews (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL, target_id TEXT NOT NULL, value_json TEXT NOT NULL,
    version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX narrative_local_quality_page ON narrative_local_quality_reviews(project_id,created_at DESC,id DESC);
  CREATE TABLE narrative_local_quality_heads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    review_id TEXT NOT NULL REFERENCES narrative_local_quality_reviews(id) ON DELETE CASCADE,
    PRIMARY KEY(project_id,target_kind,target_id)
  ); CREATE TABLE narrative_local_quality_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    review_id TEXT NOT NULL REFERENCES narrative_local_quality_reviews(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );`,
};
export class LocalQualityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type HttpContext = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
};
type Hooks = {
  hasProject(projectId: string): boolean;
  collect(
    projectId: string,
    request: NarrativeQualityRequest,
  ): {
    basis: z.infer<typeof NarrativeLocalQualityBasisSchema>;
    references: NarrativeLocalQualitySource["references"];
  };
};
const issuesOf = (value: NarrativeLocalQualityReview) =>
  value.origin === "human-declared"
    ? value.content.issues
    : value.content.findings;
const sameTarget = (
  a: NarrativeQualityRequest["target"],
  b: NarrativeQualityRequest["target"],
) =>
  a.kind === b.kind &&
  a.id === b.id &&
  a.version === b.version &&
  a.sourceFingerprint === b.sourceFingerprint;

export function registerNarrativeLocalQuality(
  context: PluginContext,
  hooks: Hooks,
) {
  const read = (tx: UnitOfWorkTransaction, id: string) => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM narrative_local_quality_reviews WHERE id = ?",
      id,
    );
    return row
      ? NarrativeLocalQualityReviewSchema.parse(JSON.parse(row.value_json))
      : undefined;
  };
  const stored = (id: string) => context.uow.execute((tx) => read(tx, id));
  const head = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    target: NarrativeQualityRequest["target"],
  ) =>
    tx.get<{ review_id: string }>(
      "SELECT review_id FROM narrative_local_quality_heads WHERE project_id = ? AND target_kind = ? AND target_id = ?",
      projectId,
      target.kind,
      target.id,
    )?.review_id;
  const preview = (
    projectId: string,
    request: NarrativeQualityRequest,
  ): NarrativeLocalQualitySource => {
    const raw = hooks.collect(projectId, request);
    const basis = NarrativeLocalQualityBasisSchema.parse(raw.basis);
    const data = { projectId, basis, references: raw.references };
    return NarrativeLocalQualitySourceSchema.parse({
      ...data,
      format: "narrative-local-review-source-v1",
      sourceFingerprint: localQualityDigest(data),
      baseReviewId:
        context.uow.execute((tx) => head(tx, projectId, request.target)) ??
        null,
    });
  };
  const validity = (
    value: NarrativeLocalQualityReview,
  ): Pick<NarrativeLocalQualityReview, "sourceState" | "sourceReasons"> => {
    try {
      const current = preview(value.projectId, value.source.basis.request);
      return current.sourceFingerprint === value.source.sourceFingerprint
        ? { sourceState: "current", sourceReasons: [] }
        : {
            sourceState: "stale",
            sourceReasons: [
              "实际目标、正式意图、可信知识或冻结表达已变化；未换用新源。",
            ],
          };
    } catch (error) {
      const status =
        error instanceof Error && "status" in error ? error.status : undefined;
      return {
        sourceState: status === 404 || status === 409 ? "stale" : "unverified",
        sourceReasons: [
          status === 404 || status === 409
            ? "原目标／范围或来源版本已不可用，请另行明确确认新来源。"
            : "来源读取未完成；不能把旧缓存当成当前核验。",
        ],
      };
    }
  };
  const decode = (
    value: NarrativeLocalQualityReview,
  ): NarrativeLocalQualityReview =>
    NarrativeLocalQualityReviewSchema.parse({
      ...value,
      ...validity(value),
      isCurrent:
        value.status === "adopted" &&
        context.uow.execute((tx) =>
          head(tx, value.projectId, value.source.basis.request.target),
        ) === value.id,
      blockers: issuesOf(value)
        .filter(
          (issue) =>
            issue.severity === "error" &&
            !value.dispositions.some(
              (decision) =>
                decision.issueId === issue.id && decision.state !== "open",
            ),
        )
        .map((issue) => issue.id),
    });
  const append = (
    tx: UnitOfWorkTransaction,
    value: NarrativeLocalQualityReview,
  ) =>
    tx.append({
      type: "creative-quality.local-review-changed.v1",
      pluginId: "creative-quality",
      aggregateType: "local-quality-review",
      aggregateId: value.id,
      aggregateVersion: value.version,
      payload: {
        id: value.id,
        projectId: value.projectId,
        origin: value.origin,
        status: value.status,
        target: value.source.basis.request.target,
        sourceFingerprint: value.source.sourceFingerprint,
        issueCount: issuesOf(value).length,
        qualityState: "unverified",
      },
    });
  const persist = (
    tx: UnitOfWorkTransaction,
    value: NarrativeLocalQualityReview,
  ) => {
    tx.run(
      "UPDATE narrative_local_quality_reviews SET value_json = ?,version = ?,updated_at = ? WHERE id = ?",
      JSON.stringify(value),
      value.version,
      value.updatedAt,
      value.id,
    );
    append(tx, value);
  };
  const replay = (key: string, requestHash: string) =>
    context.uow.execute((tx) => {
      const receipt = tx.get<{ request_hash: string; review_id: string }>(
        "SELECT request_hash,review_id FROM narrative_local_quality_requests WHERE request_key = ?",
        key,
      );
      if (!receipt) return undefined;
      if (receipt.request_hash !== requestHash)
        throw new LocalQualityError(
          409,
          "本地评议幂等标识已用于不同的原请求。",
        );
      const value = read(tx, receipt.review_id);
      if (!value)
        throw new LocalQualityError(
          409,
          "原本地评议记录不可用；未创建替代对象。",
        );
      return value;
    });
  const receipt = (
    tx: UnitOfWorkTransaction,
    key: string,
    requestHash: string,
    value: NarrativeLocalQualityReview,
  ) =>
    tx.run(
      "INSERT INTO narrative_local_quality_requests(request_key,request_hash,review_id,created_at) VALUES (?,?,?,?)",
      key,
      requestHash,
      value.id,
      new Date().toISOString(),
    );
  const requireKey = (http: HttpContext) => {
    const key = http.req.header("Idempotency-Key");
    if (!key)
      throw new LocalQualityError(400, "需要本地评议原请求的幂等标识。");
    return key;
  };
  const summary = (storedValue: NarrativeLocalQualityReview) => {
    const value = decode(storedValue),
      issues = issuesOf(value);
    const decided = (state: "accepted-risk" | "resolved") =>
      issues.filter((issue) =>
        value.dispositions.some(
          (decision) =>
            decision.issueId === issue.id && decision.state === state,
        ),
      ).length;
    const acceptedRiskCount = decided("accepted-risk"),
      resolvedIssueCount = decided("resolved");
    return NarrativeLocalQualitySummarySchema.parse({
      id: value.id,
      projectId: value.projectId,
      version: value.version,
      origin: value.origin,
      status: value.status,
      request: value.source.basis.request,
      sourceFingerprint: value.source.sourceFingerprint,
      qualityState: value.qualityState,
      isCurrent: value.isCurrent,
      sourceState: value.sourceState,
      sourceReasonCount: value.sourceReasons.length,
      issueCount: issues.length,
      openIssueCount: issues.length - acceptedRiskCount - resolvedIssueCount,
      blockerCount: value.blockers.length,
      acceptedRiskCount,
      resolvedIssueCount,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  };
  const listPage = (http: HttpContext) => {
    const projectId = http.req.param("id");
    if (!hooks.hasProject(projectId))
      throw new LocalQualityError(404, "本地评议项目不存在。");
    const cursor = http.req.query("cursor"),
      limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(http.req.query("limit") ?? 30);
    const values = context.uow.execute((tx) => {
      const anchor = cursor
        ? read(tx, z.string().uuid().parse(cursor))
        : undefined;
      if (cursor && (!anchor || anchor.projectId !== projectId))
        throw new LocalQualityError(400, "本地评议游标不属于明确项目。");
      return tx
        .all<{ value_json: string }>(
          `SELECT value_json FROM narrative_local_quality_reviews WHERE project_id = ?${anchor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
          projectId,
          ...(anchor ? [anchor.createdAt, anchor.createdAt, anchor.id] : []),
          limit + 1,
        )
        .map((row) =>
          NarrativeLocalQualityReviewSchema.parse(JSON.parse(row.value_json)),
        );
    });
    return {
      items: values.slice(0, limit),
      ...(values.length > limit ? { nextCursor: values[limit - 1]!.id } : {}),
    };
  };
  const requireVersion = (http: HttpContext, version: number) => {
    if (http.req.header("If-Match") !== `"${version}"`)
      throw new LocalQualityError(412, "需要本地评议原版本 If-Match。");
  };
  const route = (
    method: "get" | "post",
    path: `/${string}`,
    operationId: string,
    schema: z.ZodType,
    handler: (http: HttpContext) => unknown,
    body?: z.ZodType,
    write = false,
    status: 200 | 201 = 200,
  ) =>
    defineRouteContribution({
      id: `creative-quality:${operationId}`,
      pluginId: "creative-quality",
      method,
      path: `/api/v2${path}`,
      operationId,
      declaration: createRoute({
        method,
        path: `/api/v2${path}`,
        operationId,
        tags: ["creative-quality"],
        request: {
          params: z.object({ id: z.string().uuid() }),
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
              "Local declaration or exact structural rule; no semantic certification",
            content: { "application/json": { schema } },
          },
          409: {
            description: "Original source or version conflict",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      policy: {
        idempotency: write ? "required" : "forbidden",
        concurrency: write ? "if-match-required" : "optional",
        ...(write ? { idempotencyReplay: "handler" as const } : {}),
      },
      handler: async (http: HttpContext) => {
        http.header("Cache-Control", "no-store");
        try {
          return await handler(http);
        } catch (error) {
          const known = error instanceof LocalQualityError;
          const inherited =
            error instanceof Error &&
            "status" in error &&
            [404, 409, 503].includes(Number(error.status));
          const status =
            known || inherited
              ? Number((error as { status: number }).status)
              : error instanceof z.ZodError
                ? 400
                : 500;
          const detail = known
            ? error.message
            : inherited
              ? "本地评议原来源不可用或已变化，请重新明确读取；未替换旧记录。"
              : status === 400
                ? "本地评议请求不符合契约，不能伪造来源或运行。"
                : "本地评议处理未完成；未声明质量通过。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/local-quality",
              status,
              title: detail,
              detail,
              code: "LOCAL_QUALITY",
              traceId: crypto.randomUUID(),
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
  const contributions = [
    route(
      "post",
      "/projects/{id}/narrative-local-review-sources",
      "narrativeLocalQuality.preview",
      NarrativeLocalQualitySourceSchema,
      async (http) => {
        const source = preview(
          http.req.param("id"),
          NarrativeQualityRequestSchema.parse(await http.req.json()),
        );
        http.header("ETag", `"${source.sourceFingerprint}"`);
        http.header("Cache-Control", "no-store");
        return http.json(source);
      },
      NarrativeQualityRequestSchema,
    ),
    route(
      "post",
      "/projects/{id}/narrative-local-reviews",
      "narrativeLocalQuality.create",
      NarrativeLocalQualityReviewSchema,
      async (http) => {
        const projectId = http.req.param("id"),
          input = NarrativeLocalQualityCreateSchema.parse(
            await http.req.json(),
          ),
          key = requireKey(http);
        const requestHash = localQualityDigest({
          action: "create",
          projectId,
          input,
        });
        const original = replay(key, requestHash);
        if (original) {
          http.header("ETag", `"${original.version}"`);
          return http.json(decode(original), 201);
        }
        if (http.req.header("If-Match") !== `"${input.sourceFingerprint}"`)
          throw new LocalQualityError(
            412,
            "需要明确读取的本地来源指纹 If-Match。",
          );
        const source = preview(projectId, input.request);
        if (source.sourceFingerprint !== input.sourceFingerprint)
          throw new LocalQualityError(
            409,
            "实际本地来源已变化；不能用旧确认创建新源报告。",
          );
        if (source.baseReviewId !== input.baseReviewId)
          throw new LocalQualityError(
            409,
            "明确确认的本地采用位置已经变化；不在创建时静默换头。",
          );
        let content;
        try {
          content =
            input.origin === "human-declared"
              ? inspectLocalHumanContent(input.content, source)
              : inspectLocalLiteralRepetition(source);
        } catch {
          throw new LocalQualityError(
            400,
            "本地意见范围或引用不是实际完整冻结的原文字段；未创建记录。",
          );
        }
        const now = new Date().toISOString();
        const value = NarrativeLocalQualityReviewSchema.parse({
          id: crypto.randomUUID(),
          projectId,
          version: 0,
          status: "awaiting-review",
          origin: input.origin,
          source,
          content,
          dispositions: [],
          qualityState: "unverified",
          isCurrent: false,
          sourceState: "current",
          sourceReasons: [],
          blockers: [],
          createdAt: now,
          updatedAt: now,
        });
        context.uow.execute((tx) => {
          tx.run(
            "INSERT INTO narrative_local_quality_reviews(id,project_id,target_kind,target_id,value_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            value.id,
            projectId,
            input.request.target.kind,
            input.request.target.id,
            JSON.stringify(value),
            0,
            now,
            now,
          );
          receipt(tx, key, requestHash, value);
          append(tx, value);
        });
        http.header("ETag", `"${value.version}"`);
        return http.json(decode(value), 201);
      },
      NarrativeLocalQualityCreateSchema,
      true,
      201,
    ),
    route(
      "get",
      "/narrative-local-reviews/{id}",
      "narrativeLocalQuality.get",
      NarrativeLocalQualityReviewSchema,
      (http) => {
        const value = stored(http.req.param("id"));
        if (!value) throw new LocalQualityError(404, "本地原评议不存在。");
        http.header("ETag", `"${value.version}"`);
        http.header("Cache-Control", "no-store");
        return http.json(decode(value));
      },
    ),
    route(
      "get",
      "/projects/{id}/narrative-local-reviews",
      "narrativeLocalQuality.list",
      NarrativeLocalQualityPageSchema,
      (http) => {
        const page = listPage(http);
        http.header("Cache-Control", "no-store");
        return http.json({
          ...page,
          items: page.items.map(decode),
        });
      },
    ),
    route(
      "get",
      "/projects/{id}/narrative-local-review-summaries",
      "narrativeLocalQuality.summaries",
      NarrativeLocalQualitySummaryPageSchema,
      (http) => {
        const page = listPage(http);
        return http.json(
          NarrativeLocalQualitySummaryPageSchema.parse({
            ...page,
            projectId: http.req.param("id"),
            items: page.items.map(summary),
          }),
        );
      },
    ),
  ];
  contributions.push(
    route(
      "post",
      "/narrative-local-reviews/{id}/decision",
      "narrativeLocalQuality.decide",
      NarrativeLocalQualityReviewSchema,
      async (http) => {
        const id = http.req.param("id"),
          input = NarrativeLocalQualityDecisionSchema.parse(
            await http.req.json(),
          ),
          key = requireKey(http);
        const requestHash = localQualityDigest({
          action: "decision",
          id,
          input,
        });
        const original = replay(key, requestHash);
        if (original) {
          http.header("ETag", `"${original.version}"`);
          return http.json(decode(original));
        }
        requireVersion(http, input.version);
        const value = stored(id);
        if (!value) throw new LocalQualityError(404, "本地原评议不存在。");
        if (
          value.status !== "awaiting-review" ||
          value.version !== input.version
        )
          throw new LocalQualityError(
            409,
            "只能明确决定本地原候选及其实际版本。",
          );
        if (
          input.action === "adopt" &&
          validity(value).sourceState !== "current"
        )
          throw new LocalQualityError(
            409,
            "原来源未核对或已变化；不能采用旧确认。",
          );
        const changed = context.uow.execute((tx) => {
          const actual = read(tx, id);
          if (
            !actual ||
            actual.status !== "awaiting-review" ||
            actual.version !== input.version
          )
            throw new LocalQualityError(
              409,
              "本地原评议已经变化，未覆盖当前决定。",
            );
          if (
            input.action === "adopt" &&
            (head(tx, actual.projectId, actual.source.basis.request.target) ??
              null) !== actual.source.baseReviewId
          )
            throw new LocalQualityError(
              409,
              "本地评议的采用位置已经变化；请另行确认原来源。",
            );
          const now = new Date().toISOString();
          const next = NarrativeLocalQualityReviewSchema.parse({
            ...actual,
            status: input.action === "adopt" ? "adopted" : "discarded",
            version: actual.version + 1,
            updatedAt: now,
            ...(input.action === "adopt" ? { adoptedAt: now } : {}),
          });
          persist(tx, next);
          if (input.action === "adopt")
            tx.run(
              "INSERT INTO narrative_local_quality_heads(project_id,target_kind,target_id,review_id) VALUES (?,?,?,?) ON CONFLICT(project_id,target_kind,target_id) DO UPDATE SET review_id = excluded.review_id",
              next.projectId,
              next.source.basis.request.target.kind,
              next.source.basis.request.target.id,
              next.id,
            );
          receipt(tx, key, requestHash, next);
          return next;
        });
        http.header("ETag", `"${changed.version}"`);
        return http.json(decode(changed));
      },
      NarrativeLocalQualityDecisionSchema,
      true,
    ),
    route(
      "post",
      "/narrative-local-reviews/{id}/dispositions",
      "narrativeLocalQuality.disposition",
      NarrativeLocalQualityReviewSchema,
      async (http) => {
        const id = http.req.param("id"),
          input = NarrativeLocalQualityDispositionSchema.parse(
            await http.req.json(),
          ),
          key = requireKey(http);
        const requestHash = localQualityDigest({
          action: "disposition",
          id,
          input,
        });
        const original = replay(key, requestHash);
        if (original) {
          http.header("ETag", `"${original.version}"`);
          return http.json(decode(original));
        }
        requireVersion(http, input.version);
        const value = stored(id);
        if (!value) throw new LocalQualityError(404, "本地原评议不存在。");
        if (
          value.status !== "adopted" ||
          value.version !== input.version ||
          validity(value).sourceState !== "current"
        )
          throw new LocalQualityError(
            409,
            "需要来源当前且已采用的本地原评议版本，不能重新认证旧来源。",
          );
        const issue = issuesOf(value).find((item) => item.id === input.issueId);
        if (!issue) throw new LocalQualityError(404, "本地原评议没有此问题。");
        const recheck = input.recheckReviewId
          ? stored(input.recheckReviewId)
          : undefined;
        if (input.state === "resolved") {
          if (
            !recheck ||
            recheck.id === value.id ||
            recheck.projectId !== value.projectId ||
            recheck.origin !== value.origin ||
            recheck.status !== "adopted" ||
            !sameTarget(
              recheck.source.basis.request.target,
              value.source.basis.request.target,
            ) ||
            localQualityDigest(recheck.source.basis.request) !==
              localQualityDigest(value.source.basis.request) ||
            recheck.source.sourceFingerprint !==
              value.source.sourceFingerprint ||
            validity(recheck).sourceState !== "current" ||
            context.uow.execute((tx) =>
              head(tx, value.projectId, value.source.basis.request.target),
            ) !== recheck.id ||
            issuesOf(recheck).some(
              (item) =>
                item.category === issue.category &&
                (item.id === issue.id ||
                  localQualityDigest(item.evidence) ===
                    localQualityDigest(issue.evidence)),
            )
          )
            throw new LocalQualityError(
              409,
              "解决声明需要同来源、同范围、同入口的当前已采用复检且问题不再出现；不能凭勾选或换范围冒充复检。",
            );
        } else if (input.recheckReviewId)
          throw new LocalQualityError(400, "只有解决声明可附带原复检记录。");
        const changed = context.uow.execute((tx) => {
          const actual = read(tx, id);
          if (
            !actual ||
            actual.status !== "adopted" ||
            actual.version !== input.version
          )
            throw new LocalQualityError(
              409,
              "本地评议决定已经变化；未覆盖新版本。",
            );
          if (
            input.state === "resolved" &&
            (!recheck ||
              head(tx, value.projectId, value.source.basis.request.target) !==
                recheck.id ||
              read(tx, recheck.id)?.version !== recheck.version)
          )
            throw new LocalQualityError(409, "复检原采用位置或版本已变化。");
          const now = new Date().toISOString();
          const next = NarrativeLocalQualityReviewSchema.parse({
            ...actual,
            version: actual.version + 1,
            updatedAt: now,
            dispositions: [
              ...actual.dispositions.filter(
                (item) => item.issueId !== issue.id,
              ),
              {
                issueId: issue.id,
                state: input.state,
                source: "human-declared",
                note: input.note,
                ...(input.recheckReviewId
                  ? { recheckReviewId: input.recheckReviewId }
                  : {}),
                decidedAt: now,
              },
            ],
          });
          persist(tx, next);
          receipt(tx, key, requestHash, next);
          return next;
        });
        http.header("ETag", `"${changed.version}"`);
        return http.json(decode(changed));
      },
      NarrativeLocalQualityDispositionSchema,
      true,
    ),
  );
  context.effect(
    () =>
      provideService(context, NARRATIVE_LOCAL_QUALITY_SERVICE, {
        get(id) {
          const value = stored(id);
          return value ? decode(value) : undefined;
        },
        assess(projectId, target, dimensions) {
          const values = context.uow.execute((tx) =>
            tx
              .all<{ value_json: string }>(
                "SELECT value_json FROM narrative_local_quality_reviews WHERE project_id = ? AND target_kind = ? AND target_id = ? ORDER BY created_at,id",
                projectId,
                target.kind,
                target.id,
              )
              .map((row) =>
                NarrativeLocalQualityReviewSchema.parse(
                  JSON.parse(row.value_json),
                ),
              ),
          );
          // Peer source reads remain outside this owner's write transaction.
          return assessLocalNarrativeReviews(
            target,
            dimensions,
            values.map(decode),
          );
        },
      }),
    `service:${NARRATIVE_LOCAL_QUALITY_SERVICE}`,
  );
  for (const contribution of contributions)
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
}
