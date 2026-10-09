import { CREATION_PROJECT_LINEAGE_SERVICE } from "@dramaip/contracts/creation-project-lineage";
import { pilotWorkflowLineage } from "./pilot-workflow-lineage.js";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { CreativeOutcomeFactSchema } from "@dramaip/contracts/insights";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  PilotPackagePreviewInputSchema,
  PilotPackagePreviewSchema,
  PilotPackageRecordSchema,
  PilotPackagePageSchema,
  PilotPackageSaveInputSchema,
  ManuscriptReceiptSchema,
  type PilotPackagePreview,
  type PilotPackagePreviewInput,
  type PilotPackageManifest,
} from "@dramaip/contracts/delivery";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  NARRATIVE_QUALITY_SERVICE,
  NARRATIVE_LOCAL_QUALITY_SERVICE,
  NarrativeLocalQualityAssessmentSchema,
  NarrativeQualityDimensionSchema,
  type NarrativeQualityAssessment,
  type NarrativeLocalQualityAssessment,
} from "@dramaip/contracts/creative-quality";
import {
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_QUALITY_SOURCE_SERVICE,
  PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE,
  StoryboardAttributionSchema,
  StoryboardAttributionExportSchema,
  type StoryboardAttributionExport,
} from "@dramaip/contracts/production";
import { TIMELINE_SERVICE } from "@dramaip/contracts/timeline";
import {
  MEDIA_RECORD_SERVICE,
  MEDIA_LIKENESS_SERVICE,
} from "@dramaip/contracts/media";
import {
  optionalService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import type { ManuscriptHost } from "./manuscript.js";
import { pilotContentFiles, pilotHash, pilotArchive } from "./pilot-files.js";
import { pilotProductionQuality } from "./pilot-quality.js";

export const pilotMigration: PluginMigration = {
  id: "delivery.0004.pilot-packages",
  pluginId: "delivery",
  version: "3.0.0-alpha.4",
  dependsOn: ["delivery.0003.manuscripts"],
  sql: `CREATE TABLE delivery_pilot_packages (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    save_key TEXT, save_hash TEXT, version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX delivery_pilot_package_page ON delivery_pilot_packages(project_id, created_at DESC, id DESC);`,
};
type Stored = {
  preview: PilotPackagePreview;
  input: PilotPackagePreviewInput;
  sourceFingerprint: string;
  archiveBase64: string;
};
type Row = {
  id: string;
  project_id: string;
  request_key: string;
  request_hash: string;
  snapshot_json: string;
  save_key: string | null;
  save_hash: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
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
class PilotError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new PilotError(409, message);
}
const digest = (value: unknown) => pilotHash(JSON.stringify(value));
const sameQualityTarget = (
  left: NarrativeQualityAssessment["target"],
  right: NarrativeQualityAssessment["target"],
) =>
  left.kind === right.kind &&
  left.id === right.id &&
  left.version === right.version &&
  left.sourceFingerprint === right.sourceFingerprint;

export function pilotRoutes(
  context: PluginContext,
  host?: ManuscriptHost,
): RouteContribution[] {
  const read = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>("SELECT * FROM delivery_pilot_packages WHERE id = ?", id),
    );
  const episodes = () => {
    const service = optionalService(
      context,
      PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
    );
    if (!service) throw new PilotError(503, "正式单集结果服务未启用。");
    return service;
  };
  const collect = (projectId: string, input: PilotPackagePreviewInput) => {
    const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
      projectId,
    );
    if (!project) throw new PilotError(404, "项目不存在。");
    if (project.version !== input.projectVersion)
      fail("项目版本已变化，请重新确认试制包。");
    const service = episodes();
    const storyboard = service.get(input.storyboard.id);
    if (
      !storyboard ||
      storyboard.projectId !== projectId ||
      storyboard.version !== input.storyboard.version ||
      storyboard.content.kind !== "storyboard-package" ||
      !storyboard.isCurrent ||
      storyboard.sourceState !== "current"
    )
      fail("请使用当前且来源有效的已采用分镜方案，旧试制包不会静默换源。");
    const script = service.current(
      projectId,
      storyboard.episodeId,
      "episode-script",
    );
    const outline = service.current(
      projectId,
      storyboard.episodeId,
      "episode-outline",
    );
    if (
      !script ||
      !outline ||
      script.sourceState !== "current" ||
      outline.sourceState !== "current" ||
      script.id !== storyboard.basis.request.script?.id ||
      outline.id !== storyboard.basis.request.outline?.id ||
      script.content.kind !== "episode-script" ||
      outline.content.kind !== "episode-outline"
    )
      fail("正式剧本或大纲已变化。");
    const recordService = optionalService(context, PRODUCTION_RECORD_SERVICE);
    const scriptRecord = script.scriptId
      ? recordService?.get(script.scriptId)
      : undefined;
    if (
      !scriptRecord ||
      scriptRecord.kind !== "scripts" ||
      scriptRecord.projectId !== projectId ||
      typeof scriptRecord.payload["剧本内容"] !== "string"
    )
      fail("实际标准剧本不存在或不完整。");
    const records = (storyboard.productionRecords ?? []).map((binding) =>
      recordService?.get(binding.id),
    );
    if (
      !records.length ||
      records.some(
        (record, index) =>
          !record ||
          record.projectId !== projectId ||
          record.kind !== storyboard.productionRecords![index]!.kind ||
          record.version !== storyboard.productionRecords![index]!.version,
      )
    )
      fail("正式场景/分镜版本已变化或缺失。");
    let shotAttribution: StoryboardAttributionExport | undefined;
    if (input.shotAttribution) {
      const associations = optionalService(
        context,
        PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE,
      );
      if (!associations)
        throw new PilotError(503, "明确逐镜头关联读取服务不可用。");
      let raw;
      try {
        raw = associations.get(projectId, input.shotAttribution.id);
      } catch {
        throw new PilotError(503, "原关联本次读取失败，不用最新或缓存替换。");
      }
      const parsed = StoryboardAttributionSchema.safeParse(raw);
      if (!parsed.success) fail("明确逐镜头关联原身份或契约无法核对。");
      const value = parsed.data;
      if (
        value.projectId !== projectId ||
        value.id !== input.shotAttribution.id ||
        value.version !== input.shotAttribution.version ||
        value.status !== "adopted" ||
        !value.isCurrent ||
        value.sourceState !== "current" ||
        value.source.storyboard.id !== storyboard.id ||
        value.source.storyboard.version !== storyboard.version ||
        value.source.outline.id !== outline.id ||
        value.source.outline.version !== outline.version ||
        value.source.script.id !== script.id ||
        value.source.script.version !== script.version
      )
        fail(
          "所选关联不是此正式分镜链的当前已采用版本；保留原包，不自动附最新关联。",
        );
      shotAttribution = StoryboardAttributionExportSchema.parse({
        format: "confirmed-shot-attributions-v1",
        projectId,
        episodeId: storyboard.episodeId,
        attribution: { id: value.id, version: value.version },
        storyboard: { id: storyboard.id, version: storyboard.version },
        outline: { id: outline.id, version: outline.version },
        script: { id: script.id, version: script.version },
        sourceFingerprint: value.source.sourceFingerprint,
        associationFingerprint: value.associationFingerprint,
        links: value.links,
        coverage: value.coverage,
        origin: "human-declared",
        textIncluded: false,
        semanticVerification: "unverified",
      });
    }
    const media = optionalService(context, MEDIA_RECORD_SERVICE);
    const likeness = optionalService(context, MEDIA_LIKENESS_SERVICE);
    if (!media || !likeness)
      throw new PilotError(503, "权利与人物授权资料读取未完成。");
    const rights = media.list("rights", { projectId });
    const subjects = likeness.listSubjects(projectId);
    const blockedRights = rights.some((record) =>
      ["revoked", "expired", "restricted"].includes(
        String(record.payload["status"] ?? record.payload["rightsStatus"]),
      ),
    );
    const blockedSubjects = subjects.some(
      (subject) => subject.consentStatus !== "active",
    );
    const rightsBlockers = [
      ...(blockedRights ? ["权利台账含撤回、过期或受限标记。"] : []),
      ...(blockedSubjects
        ? ["项目存在未有效授权的人物，不能导出该试制包。"]
        : []),
    ];
    const qualityService = optionalService(context, NARRATIVE_QUALITY_SERVICE);
    const localQualityService = optionalService(
      context,
      NARRATIVE_LOCAL_QUALITY_SERVICE,
    );
    const dimensions = NarrativeQualityDimensionSchema.options;
    const qualityEvidence: NarrativeQualityAssessment[] = [
      outline,
      script,
      storyboard,
    ].map((value) => {
      const target = {
        kind: "episode-result" as const,
        id: value.id,
        version: value.version,
      };
      return (
        qualityService?.assess(projectId, target, dimensions) ?? {
          target,
          state: "unknown",
          requiredDimensions: dimensions,
          reviewedDimensions: [],
          missingDimensions: dimensions,
          reports: [],
          blockers: [],
          acceptedRiskCount: 0,
        }
      );
    });
    const assessLocal = (target: NarrativeQualityAssessment["target"]) => {
      const value = NarrativeLocalQualityAssessmentSchema.parse(
        localQualityService?.assess(projectId, target, dimensions) ?? {
          target,
          state: "unknown",
          qualityState: "unverified",
          requiredDimensions: dimensions,
          reviewedDimensions: [],
          missingDimensions: dimensions,
          reviews: [],
          blockers: [],
          acceptedRiskCount: 0,
        },
      );
      if (!sameQualityTarget(value.target, target))
        fail("本地质量评议目标与实际正式版本不符。");
      return value;
    };
    const localQualityEvidence: NarrativeLocalQualityAssessment[] =
      qualityEvidence.map((value) => assessLocal(value.target));
    const savedSources = optionalService(
      context,
      PRODUCTION_QUALITY_SOURCE_SERVICE,
    );
    if (!savedSources)
      throw new PilotError(503, "实际保存剧本／场景来源读取未启用。");
    try {
      qualityEvidence.push(
        ...pilotProductionQuality({
          projectId,
          script,
          storyboard,
          readSource: (id) => savedSources.get(projectId, id),
          assess: (target) =>
            qualityService?.assess(projectId, target, dimensions) ?? {
              target,
              state: "unknown",
              requiredDimensions: dimensions,
              reviewedDimensions: [],
              missingDimensions: dimensions,
              reports: [],
              blockers: [],
              acceptedRiskCount: 0,
            },
          onTarget: (target) => {
            const value = assessLocal(target);
            if (value.reviews.length) localQualityEvidence.push(value);
          },
        }),
      );
    } catch {
      fail("实际保存剧本／场景与正式试制内容无法精确核对。");
    }
    const qualityBlockers = [
      ...qualityEvidence.flatMap((value) =>
        value.blockers.map(
          (issue) =>
            `${value.target.kind === "episode-result" ? "正式版本" : value.target.kind === "script" ? "实际保存剧本" : "实际场景"} ${value.target.id} 的报告 ${issue.reportId} 仍有未处理错误 ${issue.issueId}。`,
        ),
      ),
      ...localQualityEvidence.flatMap((value) =>
        value.blockers.map(
          (issue) =>
            `实际版本 ${value.target.id} 的本地人工声明 ${issue.reviewId} 仍有未处理错误 ${issue.issueId}（未认证意见）。`,
        ),
      ),
    ];
    const blockers = [...rightsBlockers, ...qualityBlockers];
    const evidenceTargets = [
      ...new Map(
        [...qualityEvidence, ...localQualityEvidence].map((value) => [
          JSON.stringify([
            value.target.kind,
            value.target.id,
            value.target.version,
            value.target.sourceFingerprint,
          ]),
          value.target,
        ]),
      ).values(),
    ];
    const qualityUnknown = evidenceTargets.some((target) => {
      const model = qualityEvidence.find((value) =>
          sameQualityTarget(value.target, target),
        ),
        local = localQualityEvidence.find((value) =>
          sameQualityTarget(value.target, target),
        );
      return dimensions.some(
        (dimension) =>
          !model?.reviewedDimensions.includes(dimension) &&
          !local?.reviewedDimensions.includes(dimension),
      );
    });
    const acceptedRisks = [...qualityEvidence, ...localQualityEvidence].reduce(
      (count, value) => count + value.acceptedRiskCount,
      0,
    );
    const timelineService = optionalService(context, TIMELINE_SERVICE);
    const timeline =
      input.includeNle && script.episodeRecordId
        ? timelineService?.peek?.(script.episodeRecordId)
        : undefined;
    if (input.includeNle && timelineService && !timelineService.peek)
      throw new PilotError(503, "当前时间线服务不支持无写入预检。");
    const nle =
      timeline && script.episodeRecordId
        ? (
            [
              "manifest",
              "fcpxml",
              "otio",
              "edl",
              "srt",
              "vtt",
              "relink",
            ] as const
          ).map((format) => {
            const file = timelineService?.export?.(
              script.episodeRecordId!,
              format,
            );
            if (!file)
              throw new PilotError(
                503,
                "实际 NLE 导出未完成，不能以空列表代替。",
              );
            return file;
          })
        : [];
    const warnings = [
      qualityUnknown
        ? "正式大纲、剧本或分镜的叙事评议范围未核全；不代表语义质量通过。"
        : "已核对版本绑定的模型意见／人工声明范围与决定，不代表文学/专业制作质量保证；本地规则不提供语义覆盖。",
      ...(acceptedRisks
        ? [`作者明确接受 ${acceptedRisks} 项报告风险，不表示这些问题已修复。`]
        : []),
      "权利声明不是授权证明；用途、地区、期限及发行合规仍需核验。",
      "未核验媒体供应商报价，费用未知而非零。",
      ...(input.includeNle && !timeline
        ? ["尚无实际 canonical timeline，不生成或伪造 NLE 文件。"]
        : []),
    ];
    let workflowLineage: ReturnType<typeof pilotWorkflowLineage> | undefined;
    if (input.includeWorkflowLineage) {
      try {
        workflowLineage = pilotWorkflowLineage(
          project,
          [outline, script, storyboard],
          optionalService(context, CREATION_PROJECT_LINEAGE_SERVICE),
        );
      } catch {
        fail(
          "所选试制阶段的原工作流谱系暂不可完整核对，未导出部分记录或改动原包；请恢复来源后重试。",
        );
      }
    }
    const sourceFingerprint = digest({
      projectVersion: project.version,
      adopted: [storyboard.id, script.id, outline.id],
      refs: storyboard.basis.references,
      records: records.map((record) => ({
        id: record!.id,
        version: record!.version,
      })),
      rights: rights.map((record) => ({
        id: record.id,
        version: record.version,
        payload: record.payload,
      })),
      subjects,
      // Preserve old unreviewed package fingerprints; actual adopted report or
      // human decision changes invalidate previews and require a fresh manifest.
      ...(qualityEvidence.some((value) => value.reports.length)
        ? { qualityEvidence }
        : {}),
      ...(localQualityEvidence.some((value) => value.reviews.length)
        ? { localQualityEvidence }
        : {}),
      ...(input.includeNle ? { timeline, nle } : {}),
      ...(shotAttribution ? { shotAttribution } : {}),
      ...(workflowLineage ? { workflowLineage } : {}),
    });
    const manifest: Omit<PilotPackageManifest, "files"> = {
      schemaVersion: 1,
      purpose: "internal-pilot",
      projectId,
      projectVersion: project.version,
      projectTitle: project.title,
      episodeId: storyboard.episodeId,
      episodeTitle: storyboard.basis.episode.title,
      durationSeconds: storyboard.basis.episode.durationSeconds,
      adopted: {
        authorIntent: storyboard.basis.authorIntent,
        outline: { id: outline.id, version: outline.version },
        script: { id: script.id, version: script.version },
        storyboard: { id: storyboard.id, version: storyboard.version },
        ...(shotAttribution
          ? { shotAttribution: shotAttribution.attribution }
          : {}),
        ...(storyboard.basis.request.direct
          ? { directSource: storyboard.basis.request.direct }
          : {
              diagnosis: storyboard.basis.diagnosis!,
              ...(storyboard.basis.strategy
                ? { strategy: storyboard.basis.strategy }
                : {}),
              seasonPlan: storyboard.basis.request.seasonPlan!,
            }),
      },
      scriptRecordId: script.scriptId!,
      scriptDocumentVersion: script.scriptDocumentVersion!,
      productionRecords: storyboard.productionRecords!,
      lineage: storyboard.basis.references.map(
        ({ sourceKind, sourceId, sourceVersion }) => ({
          sourceKind,
          sourceId,
          sourceVersion,
        }),
      ),
      preflight: {
        blockers,
        warnings,
        checks: [
          ...(shotAttribution
            ? [
                {
                  id: "shot-attribution",
                  label: "明确逐镜头关联版本",
                  state: "passed" as const,
                  evidenceKind: "human" as const,
                  detail: `已核对明确采用关联 ${shotAttribution.attribution.id} v${shotAttribution.attribution.version}；实际关联 ${shotAttribution.coverage.associatedShots}/${shotAttribution.coverage.totalShots} 镜头，节点关联 ${shotAttribution.coverage.nodeAssociatedShots} 镜头；只证明实际身份／逐字位置与人工声明，不证明逐镜头语义正确或未关联镜头已审阅。`,
                },
              ]
            : []),
          {
            id: "sources",
            label: "正式来源与采用版本",
            state: "passed",
            evidenceKind: "rule",
            detail:
              "当前正式头、稳定块/场景/镜头版本与来源有效；不代表段落级语义正确。",
          },
          {
            id: "quality",
            label: "叙事与连续性评议证据",
            state: qualityBlockers.length
              ? "blocked"
              : qualityUnknown
                ? "unknown"
                : "passed",
            evidenceKind:
              acceptedRisks ||
              localQualityEvidence.some((value) =>
                value.reviews.some(
                  (review) => review.origin === "human-declared",
                ),
              )
                ? "human"
                : qualityEvidence.some((value) => value.reports.length)
                  ? "model"
                  : "rule",
            detail: `已绑定 ${qualityEvidence.reduce((count, value) => count + value.reports.length, 0)} 份模型报告与 ${localQualityEvidence.reduce((count, value) => count + value.reviews.length, 0)} 份独立本地记录；${qualityUnknown ? "大纲/剧本/分镜或已有保存稿件评议所需维度未全部覆盖" : "所需评议声明维度已覆盖"}，${qualityBlockers.length} 项未处理错误，${acceptedRisks} 项明确接受风险。人工声明未认证，本地规则不提供语义覆盖；保存剧本／场景只补充对应实际表达，不能代替三个正式阶段、旧序列化导出或整包覆盖。不保证语义正确或发行就绪。`,
          },
          {
            id: "rights",
            label: "权利与人物授权",
            state: rightsBlockers.length ? "blocked" : "unknown",
            evidenceKind: "rule",
            detail: rightsBlockers.length
              ? rightsBlockers.join(" ")
              : "未发现上述台账阻断；完整授权证明及范围仍未核验，保存需作者明确声明。",
          },
          {
            id: "media",
            label: "媒体依赖",
            state: "passed",
            evidenceKind: "rule",
            detail:
              "结构化内部试制包不要求媒体二进制，导出不生成媒体或授权费用。",
          },
          {
            id: "nle",
            label: "已有 NLE",
            state: timeline ? "passed" : "unknown",
            evidenceKind: "rule",
            detail: timeline
              ? "纳入实际时间线版本的既有导出；不是媒体完整交付。"
              : "未纳入实际时间线文件，不制造时间线。",
          },
        ],
      },
      qualityEvidence,
      ...(localQualityEvidence.some((value) => value.reviews.length)
        ? { localQualityEvidence }
        : {}),
      missingItems: [
        "媒体二进制、已采用静帧、声音与视觉资产锁尚未纳入此包。",
        "语义质量、完整授权证明和发行验收未完成。",
        ...(input.includeNle && !timeline
          ? ["NLE：缺少实际 canonical timeline。"]
          : []),
      ],
      externalDependencies: storyboard.content.value.externalDependencies,
      costs: {
        status: "unknown",
        explanation:
          "仅附模型提出的风险和实际运行引用；本包未核验 token、价格或媒体报价。",
      },
      media: { binaryIncluded: false, generatedByExport: false },
      timeline: timeline
        ? { id: timeline.id, version: timeline.version }
        : undefined,
      indexFile: "manifest.json",
      createdAt: new Date().toISOString(),
    };
    return {
      storyboard,
      script,
      outline,
      fountain: scriptRecord.payload["剧本内容"] as string,
      manifest,
      nle,
      sourceFingerprint,
      ...(workflowLineage ? { workflowLineage } : {}),
      ...(shotAttribution ? { shotAttribution } : {}),
    };
  };
  const decode = (row: Row) => {
    const stored = JSON.parse(row.snapshot_json) as Stored;
    const issues: string[] = [];
    try {
      if (
        collect(row.project_id, stored.input).sourceFingerprint !==
        stored.sourceFingerprint
      )
        issues.push("正式来源、实际 NLE、权利或人物授权资料已变化。");
    } catch (error) {
      issues.push(
        error instanceof PilotError
          ? error.message
          : "当前来源读取未完成，不能证明旧包仍有效。",
      );
    }
    return PilotPackagePreviewSchema.parse({
      ...stored.preview,
      version: row.version,
      updatedAt: row.updated_at,
      sourceState: issues.length ? "stale" : "current",
      sourceIssues: issues,
    });
  };
  const append = (tx: UnitOfWorkTransaction, preview: PilotPackagePreview) =>
    tx.append({
      type: "delivery.pilot-package-updated.v1",
      pluginId: "delivery",
      aggregateType: "pilot-package",
      aggregateId: preview.id,
      aggregateVersion: preview.version,
      payload: {
        id: preview.id,
        projectId: preview.manifest.projectId,
        episodeId: preview.manifest.episodeId,
        status: preview.status,
        archiveSha256: preview.archive.sha256,
        storyboardId: preview.manifest.adopted.storyboard.id,
      },
    });
  const respond = (c: HttpContext, row: Row) => {
    c.header("ETag", `"${row.version}"`);
    return c.json(decode(row));
  };
  const routes: RouteContribution[] = [];
  const pageQuery = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    schema: z.ZodType,
    handler: (c: HttpContext) => Response | Promise<Response>,
    body?: z.ZodType,
    paged = false,
  ) => {
    const params = path.includes("{projectId}")
      ? z.object({ projectId: z.string().uuid() })
      : z.object({ id: z.string().uuid() });
    routes.push(
      defineRouteContribution({
        id: `delivery:${operationId}`,
        pluginId: "delivery",
        method,
        path,
        operationId,
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["pilot-packages"],
          request: {
            params,
            ...(paged ? { query: pageQuery } : {}),
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
            200: {
              description: "Internal pilot package",
              content: { "application/json": { schema } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 428, 503].map((status) => [
                status,
                {
                  description: "Request cannot be completed",
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
        policy: {
          idempotency: method === "post" ? "required" : "forbidden",
          ...(method === "post"
            ? { idempotencyReplay: "handler" as const }
            : {}),
          concurrency:
            operationId === "pilotPackages.save"
              ? "if-match-required"
              : "optional",
          timeoutMs: operationId === "pilotPackages.save" ? 300_000 : 30_000,
        },
        handler: async (c: HttpContext) => {
          try {
            return await handler(c);
          } catch (error) {
            const status =
              error instanceof PilotError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 409;
            const detail =
              error instanceof PilotError
                ? error.message
                : "试制包参数或结构核对未完成。";
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/pilot-package",
                title: detail,
                detail,
                status,
                code:
                  status === 404
                    ? "NOT_FOUND"
                    : status === 503
                      ? "UNAVAILABLE"
                      : status === 400
                        ? "VALIDATION_ERROR"
                        : "CONFLICT",
                traceId: crypto.randomUUID(),
              }),
              {
                status,
                headers: { "Content-Type": "application/problem+json" },
              },
            );
          }
        },
      }),
    );
  };
  add(
    "post",
    "/api/v2/projects/{projectId}/pilot-packages",
    "pilotPackages.preview",
    PilotPackagePreviewSchema,
    async (c) => {
      const input = PilotPackagePreviewInputSchema.parse(await c.req.json());
      const projectId = c.req.param("projectId");
      const requestKey = `${projectId}:${c.req.header("Idempotency-Key")}`;
      const requestHash = digest(input);
      const previous = context.uow.execute((tx) =>
        tx.get<Row>(
          "SELECT * FROM delivery_pilot_packages WHERE request_key = ?",
          requestKey,
        ),
      );
      if (previous) {
        if (previous.request_hash !== requestHash)
          fail("同一预览幂等键不能用于不同试制基准。");
        return respond(c, previous);
      }
      const sources = collect(projectId, input);
      const built = pilotContentFiles(sources);
      const at = built.manifest.createdAt;
      const preview: PilotPackagePreview = {
        id: crypto.randomUUID(),
        version: 0,
        status: "awaiting-confirmation",
        sourceState: "current",
        sourceIssues: [],
        manifest: built.manifest,
        files: built.files,
        archive: {
          fileName: `DramaIP-pilot-${sources.storyboard.episodeId.replace(/[^a-zA-Z0-9_-]/gu, "-")}-v${sources.storyboard.version}.zip`,
          mimeType: "application/zip",
          sha256: built.archive.sha256,
          byteSize: built.archive.byteSize,
        },
        createdAt: at,
        updatedAt: at,
      };
      const stored: Stored = {
        preview,
        input,
        sourceFingerprint: sources.sourceFingerprint,
        archiveBase64: built.archive.base64,
      };
      context.uow.execute((tx) => {
        tx.run(
          "INSERT INTO delivery_pilot_packages(id,project_id,request_key,request_hash,snapshot_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          preview.id,
          projectId,
          requestKey,
          requestHash,
          JSON.stringify(stored),
          at,
          at,
        );
        append(tx, preview);
      });
      return respond(c, read(preview.id)!);
    },
    PilotPackagePreviewInputSchema,
  );
  add(
    "get",
    "/api/v2/pilot-packages/{id}",
    "pilotPackages.get",
    PilotPackagePreviewSchema,
    (c) => {
      const row = read(c.req.param("id"));
      if (!row) throw new PilotError(404, "试制包预览不存在。");
      return respond(c, row);
    },
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/pilot-packages",
    "pilotPackages.list",
    PilotPackagePageSchema,
    (c) => {
      const projectId = c.req.param("projectId");
      if (!optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(projectId))
        throw new PilotError(404, "项目不存在。");
      const query = pageQuery.parse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit"),
      });
      const rows = context.uow.execute((tx) => {
        const cursor = query.cursor
          ? tx.get<Row>(
              "SELECT * FROM delivery_pilot_packages WHERE id = ?",
              query.cursor,
            )
          : undefined;
        if (query.cursor && (!cursor || cursor.project_id !== projectId))
          throw new PilotError(400, "游标不属于本项目。");
        return cursor
          ? tx.all<Row>(
              "SELECT * FROM delivery_pilot_packages WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?",
              projectId,
              cursor.created_at,
              cursor.created_at,
              cursor.id,
              query.limit + 1,
            )
          : tx.all<Row>(
              "SELECT * FROM delivery_pilot_packages WHERE project_id = ? ORDER BY created_at DESC,id DESC LIMIT ?",
              projectId,
              query.limit + 1,
            );
      });
      const items = rows
        .slice(0, query.limit)
        .map((row) => PilotPackageRecordSchema.parse(decode(row)));
      return c.json({
        items,
        ...(rows.length > query.limit ? { nextCursor: items.at(-1)!.id } : {}),
      });
    },
    undefined,
    true,
  );
  add(
    "post",
    "/api/v2/pilot-packages/{id}/save",
    "pilotPackages.save",
    PilotPackagePreviewSchema,
    async (c) => {
      const input = PilotPackageSaveInputSchema.parse(await c.req.json());
      const row = read(c.req.param("id"));
      if (!row) throw new PilotError(404, "试制包不存在。");
      const key = c.req.header("Idempotency-Key")!;
      const saveHash = digest(input);
      if (row.save_key === key) {
        if (row.save_hash !== saveHash) fail("保存幂等键不能用于不同确认。");
        return respond(c, row);
      }
      const preview = decode(row);
      if (
        row.version !== input.version ||
        c.req.header("If-Match") !== `"${row.version}"`
      )
        fail("试制包状态已变化，请重新打开。");
      if (preview.status !== "awaiting-confirmation")
        fail("已尝试保存的试制包不可静默重做；请重新预览。");
      if (preview.sourceState !== "current")
        fail("来源已变化，旧试制包不能作为当前交付。");
      if (preview.manifest.preflight.blockers.length)
        fail("质量、权利或授权预检存在阻断，不能保存。");
      const archive = pilotArchive(preview.files);
      const stored = JSON.parse(row.snapshot_json) as Stored;
      if (
        input.archiveSha256 !== preview.archive.sha256 ||
        archive.sha256 !== preview.archive.sha256 ||
        archive.byteSize !== preview.archive.byteSize ||
        archive.base64 !== stored.archiveBase64
      )
        fail("文件或 ZIP 完整性不匹配。");
      if (!host?.saveBinaryFile)
        throw new PilotError(503, "当前 Host 不支持 ZIP 保存，预览仍保留。");
      const saving: PilotPackagePreview = {
        ...preview,
        status: "saving",
        rights: input.rights,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      };
      context.uow.execute((tx) => {
        tx.run(
          "UPDATE delivery_pilot_packages SET snapshot_json = ?, save_key = ?, save_hash = ?, version = ?, updated_at = ? WHERE id = ?",
          JSON.stringify({ ...stored, preview: saving }),
          key,
          saveHash,
          saving.version,
          saving.updatedAt,
          row.id,
        );
        append(tx, saving);
      });
      let final: PilotPackagePreview;
      try {
        const result = await host.saveBinaryFile({
          suggestedName: preview.archive.fileName,
          contentBase64: stored.archiveBase64,
          mimeType: "application/zip",
        });
        if (!result.saved) final = { ...saving, status: "canceled" };
        else {
          const receipt = ManuscriptReceiptSchema.safeParse(result);
          if (
            !receipt.success ||
            receipt.data.sha256 !== archive.sha256 ||
            receipt.data.byteSize !== archive.byteSize
          )
            throw new Error("invalid receipt");
          final = { ...saving, status: "saved", receipt: receipt.data };
        }
      } catch {
        final = {
          ...saving,
          status: "failed",
          error:
            "写入失败或回执未匹配；文件可能存在，但不能记录已交付，请核对后重新预览。",
        };
      }
      final = {
        ...final,
        version: saving.version + 1,
        updatedAt: new Date().toISOString(),
      };
      context.uow.execute((tx) => {
        tx.run(
          "UPDATE delivery_pilot_packages SET snapshot_json = ?, version = ?, updated_at = ? WHERE id = ?",
          JSON.stringify({ ...stored, preview: final }),
          final.version,
          final.updatedAt,
          row.id,
        );
        append(tx, final);
        if (final.status === "saved")
          tx.append({
            type: "delivery.pilot-package-exported.v1",
            pluginId: "delivery",
            aggregateType: "pilot-package",
            aggregateId: final.id,
            aggregateVersion: final.version,
            payload: CreativeOutcomeFactSchema.parse({
              eventVersion: 1,
              kind: "adaptation.pilot-package-exported",
              workflowPath: "adaptation",
              projectId: final.manifest.projectId,
              objectId: final.id,
              formalVersions: [
                { kind: "episode-outline", ...final.manifest.adopted.outline },
                { kind: "episode-script", ...final.manifest.adopted.script },
                { kind: "storyboard", ...final.manifest.adopted.storyboard },
                {
                  kind: "script-document",
                  id: final.manifest.scriptRecordId,
                  version: final.manifest.scriptDocumentVersion,
                },
                ...final.manifest.productionRecords.map(({ id, version }) => ({
                  kind: "production-record",
                  id,
                  version,
                })),
              ],
              sourceVersions: final.manifest.lineage.map(
                ({ sourceId, sourceVersion }) => ({
                  id: sourceId,
                  version: sourceVersion,
                }),
              ),
              evidenceKind: "rule",
              modelEvidence: "unknown",
              qualityState: "unverified",
              resultStatus: "saved",
              receipt: final.receipt,
            }),
          });
      });
      return respond(c, read(row.id)!);
    },
    PilotPackageSaveInputSchema,
  );
  return routes;
}
