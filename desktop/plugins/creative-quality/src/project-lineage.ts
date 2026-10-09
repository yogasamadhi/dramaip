import { createHash } from "node:crypto";
import { z } from "zod";
import {
  NarrativeQualityReportSchema,
  NarrativeLocalQualityReviewSchema,
} from "@dramaip/contracts/creative-quality";
import {
  QUALITY_PROJECT_LINEAGE_SERVICE,
  QualityProjectLineageItemSchema,
  QualityProjectLineageCategorySchema,
  QualityProjectLineagePageSchema,
} from "@dramaip/contracts/creation-project-lineage";
import {
  provideService,
  type PluginContext,
} from "@dramaip/plugin-api/internal";
import { localQualityDigest } from "./narrative-local-content.js";
// Stored owner rows intentionally do not contain the four current-state fields.
// Zod disallows omit() on a refined object: retain its field validators and the
// original project/source refinement explicitly, without fabricating state.
const {
  isCurrent: _isCurrent,
  sourceState: _sourceState,
  staleReasons: _staleReasons,
  blockers: _blockers,
  ...storedReportFields
} = NarrativeQualityReportSchema.shape;
const storedReport = z
  .object(storedReportFields)
  .strict()
  .superRefine((value, check) => {
    if (
      value.basis.productionSourceBasis &&
      value.basis.productionSourceBasis.projectId !== value.projectId
    )
      check.addIssue({
        code: "custom",
        message: "普通报告的冻结来源不属于本项目。",
      });
  });
type Row = {
  id: string;
  project_id: string;
  workflow_id?: string;
  target_kind: string;
  target_id: string;
  value_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function convert(row: Row, category: "reports" | "localReviews") {
  const value =
      category === "reports"
        ? storedReport.parse(JSON.parse(row.value_json))
        : NarrativeLocalQualityReviewSchema.parse(JSON.parse(row.value_json)),
    basis = "basis" in value ? value.basis : value.source.basis;
  if (
    value.id !== row.id ||
    value.projectId !== row.project_id ||
    value.version !== row.version ||
    value.createdAt !== row.created_at ||
    value.updatedAt !== row.updated_at ||
    basis.request.target.kind !== row.target_kind ||
    basis.request.target.id !== row.target_id ||
    ("workflowId" in value && value.workflowId !== row.workflow_id) ||
    ("source" in value && value.source.projectId !== row.project_id) ||
    (basis.sourceBasis && basis.sourceBasis.projectId !== row.project_id)
  )
    throw Error("Original quality row binding differs");
  if (
    "source" in value &&
    value.source.sourceFingerprint !==
      localQualityDigest({
        projectId: value.projectId,
        basis: value.source.basis,
        references: value.source.references,
      })
  )
    throw Error("Original local source fingerprint differs");
  const content = value.content,
    issues = "issues" in content ? content.issues : content.findings;
  return QualityProjectLineageItemSchema.parse({
    id: value.id,
    projectId: value.projectId,
    version: value.version,
    status: value.status,
    basis: {
      request: basis.request,
      references: basis.references,
      ...(basis.chapterCoverage
        ? {
            chapterCoverage: {
              ...basis.chapterCoverage,
              included: basis.chapterCoverage.included.map(
                ({ title: _private, ...ref }) => ref,
              ),
            },
          }
        : {}),
      ...(basis.productionSourceBasis
        ? { productionSourceBasis: basis.productionSourceBasis }
        : {}),
    },
    ...("reviewedDimensions" in content
      ? { reviewedDimensions: content.reviewedDimensions }
      : {
          checkedRules: content.checkedRules,
          semanticCoverage: content.semanticCoverage,
        }),
    ...("reviewedChapters" in content && content.reviewedChapters
      ? { reviewedChapters: content.reviewedChapters }
      : {}),
    ...("reviewedSources" in content && content.reviewedSources
      ? { reviewedSources: content.reviewedSources }
      : {}),
    issues: issues.map(
      ({ id, category, severity, source, evidence, ...rest }) => ({
        id,
        category,
        severity,
        source,
        ...("ruleId" in rest ? { ruleId: rest.ruleId } : {}),
        evidence: evidence.map(({ quote, ...ref }) => ({
          ...ref,
          quoteHash: sha(quote),
          quoteCharacters: quote.length,
        })),
      }),
    ),
    dispositions: value.dispositions.map(
      ({ note: _private, ...decision }) => decision,
    ),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.adoptedAt ? { adoptedAt: value.adoptedAt } : {}),
    fingerprint: {
      format: "derived-original-quality-value-json-bytes-v1",
      sha256: sha(row.value_json),
    },
    observation: "saved-quality-owner-row-not-full-state-history",
    semanticVerification: "unverified",
    ...("workflowId" in value
      ? {
          kind: "model-report",
          workflowId: value.workflowId,
          baseReportId: value.basis.baseReportId,
          sourceSnapshotId: value.sourceSnapshotId,
          runIds: value.runIds,
          engineKind: value.engineKind,
          usage: value.usage,
          ...(value.contextBudget
            ? { contextBudget: value.contextBudget }
            : {}),
        }
      : {
          kind: "local-review",
          origin: value.origin,
          sourceFingerprint: value.source.sourceFingerprint,
          baseReviewId: value.source.baseReviewId,
          qualityState: value.qualityState,
        }),
  });
}
export function registerQualityProjectLineage(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, QUALITY_PROJECT_LINEAGE_SERVICE, {
        list(projectId, category, options) {
          z.string().uuid().parse(projectId);
          QualityProjectLineageCategorySchema.parse(category);
          z.number().int().min(1).max(100).parse(options.limit);
          if (options.cursor) z.string().uuid().parse(options.cursor);
          return context.uow.execute((tx) => {
            const table =
              category === "reports"
                ? "narrative_quality_reports"
                : "narrative_local_quality_reviews";
            if (
              options.cursor &&
              !tx.get(
                `SELECT id FROM ${table} WHERE project_id=? AND id=?`,
                projectId,
                options.cursor,
              )
            )
              throw Error("Unknown owner cursor");
            const rows = tx.all<Row>(
                `SELECT * FROM ${table} WHERE project_id=?${options.cursor ? " AND id>?" : ""} ORDER BY id LIMIT ?`,
                projectId,
                ...(options.cursor ? [options.cursor] : []),
                options.limit + 1,
              ),
              items = rows
                .slice(0, options.limit)
                .map((row) => convert(row, category));
            return QualityProjectLineagePageSchema.parse({
              category,
              items,
              ...(rows.length > options.limit
                ? { nextCursor: items.at(-1)!.id }
                : {}),
            });
          });
        },
      }),
    `service:${QUALITY_PROJECT_LINEAGE_SERVICE}`,
  );
}
