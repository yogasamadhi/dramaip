import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z, type ZodType } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MediaReviewCreateInputSchema,
  MediaReviewPreviewSchema,
  MediaReviewReceiptSchema,
  MediaReviewScopeSchema,
  MediaReviewEvidenceSchema,
  MediaReviewExportSchema,
  MediaReviewOwnerEvidenceSchema,
  mediaReviewArchiveBinding,
  ReviewPackageSchema,
  ReviewDecisionSchema,
  ReviewCommentSchema,
  type MediaReviewService,
  type MediaReviewReceipt,
  type MediaReviewPreview,
  type MediaReviewEvidence,
  type MediaReviewOwnerEvidence,
} from "@dramaip/contracts/review";
import type { TimelineService } from "@dramaip/contracts/timeline";
import type { ProductionRecordService } from "@dramaip/contracts/production";
import {
  MediaDeliveryEvidenceSchema,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const mediaReviewMigration: PluginMigration = {
  id: "review.0003.media-packages",
  pluginId: "review",
  version: "3.0.0-alpha.5",
  dependsOn: ["review.0001.offline-packages"],
  sql: `CREATE TABLE review_media_packages (
    package_id TEXT PRIMARY KEY REFERENCES review_packages(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL, package_hash TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX review_media_packages_project ON review_media_packages(project_id,created_at,package_id);`,
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
class ReviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
type PackageRow = {
  id: string;
  project_id: string;
  adaptation_id: string;
  episode_id: string;
  title: string;
  manifest_json: string;
  created_at: string;
  updated_at: string;
};
type BindingRow = {
  package_id: string;
  project_id: string;
  request_key: string;
  request_hash: string;
  receipt_json: string;
  package_hash: string;
  created_at: string;
};
type C = {
  req: {
    param(n: string): string;
    query(n: string): string | undefined;
    queries(n: string): string[] | undefined;
    header(n: string): string | undefined;
    json(): Promise<unknown>;
  };
};
const packageValue = (r: PackageRow) =>
  ReviewPackageSchema.parse({
    id: r.id,
    projectId: r.project_id,
    adaptationId: r.adaptation_id,
    episodeId: r.episode_id,
    title: r.title,
    manifest: JSON.parse(r.manifest_json),
    kind: "offline",
    status: "exported",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

function mediaReviewReceipt(
  r: BindingRow,
  tx: UnitOfWorkTransaction,
): MediaReviewReceipt {
  const v = MediaReviewReceiptSchema.parse(JSON.parse(r.receipt_json));
  const p = tx.get<PackageRow>(
    "SELECT * FROM review_packages WHERE id=?",
    r.package_id,
  );
  const original = v.original;
  if (
    !p ||
    v.package.id !== r.package_id ||
    v.projectId !== r.project_id ||
    v.requestKey !== r.request_key ||
    v.requestHash !== r.request_hash ||
    v.createdAt !== r.created_at ||
    hash(v.package) !== r.package_hash ||
    hash(packageValue(p)) !== r.package_hash ||
    hash({ episodeId: v.episodeId, input: v.input }) !== r.request_hash ||
    hash({
      projectId: original.projectId,
      episodeId: original.episodeId,
      snapshot: original.snapshot,
      shotIds: original.shotIds,
    }) !== original.sourceFingerprint
  )
    throw new ReviewError(503, "ORIGINAL_REVIEW_CORRUPT");
  return v;
}

/** Validate within the feedback write UoW against the frozen package, never today's shot list. */
export function reviewFeedbackRejection(
  tx: UnitOfWorkTransaction,
  packageId: string,
  entries: readonly { shotId?: string }[],
):
  | { feedbackError: { status: 404 | 409 | 503; code: string; title: string } }
  | undefined {
  const p = tx.get<PackageRow>(
    "SELECT * FROM review_packages WHERE id=?",
    packageId,
  );
  if (!p)
    return {
      feedbackError: {
        status: 404,
        code: "NOT_FOUND",
        title: "未找到审片包。",
      },
    };
  let shotIds: readonly string[];
  try {
    const binding = tx.get<BindingRow>(
      "SELECT * FROM review_media_packages WHERE package_id=?",
      packageId,
    );
    shotIds = binding
      ? mediaReviewReceipt(binding, tx).original.shotIds
      : packageValue(p).manifest.clips.map((clip) => clip.shotId);
  } catch {
    return {
      feedbackError: {
        status: 503,
        code: "ORIGINAL_REVIEW_CORRUPT",
        title: "原审片包无法核对，未写入反馈；不会换用旧包或当前镜头。",
      },
    };
  }
  const allowed = new Set(shotIds);
  if (
    entries.some(
      (entry) => entry.shotId !== undefined && !allowed.has(entry.shotId),
    )
  )
    return {
      feedbackError: {
        status: 409,
        code: "INVALID_FEEDBACK_SCOPE",
        title: "反馈镜头不属于原审片包，未写入任何反馈。",
      },
    };
  return undefined;
}

/** Full original NLE owner metadata and manual review decisions; no file reads, model, cloud, rights or release approval. */
export function createMediaReview(
  context: PluginContext,
  timeline: TimelineService,
  production: ProductionRecordService,
  media: MediaRecordService,
): { service: MediaReviewService; routes: RouteContribution[] } {
  const preview = (
    episodeId: string,
    projectId: string,
  ): MediaReviewPreview => {
    const episode = production.get(episodeId),
      adaptation = episode?.parentId
        ? production.get(episode.parentId)
        : undefined;
    if (
      !episode ||
      episode.kind !== "episodes" ||
      episode.projectId !== projectId ||
      !adaptation ||
      adaptation.kind !== "adaptations" ||
      adaptation.projectId !== projectId
    )
      throw new ReviewError(404, "NOT_FOUND");
    const delivery = timeline.deliveryManifest?.(episodeId);
    if (!delivery) throw new ReviewError(404, "TIMELINE_NOT_FOUND");
    if (
      delivery.timeline.projectId !== projectId ||
      delivery.timeline.adaptationId !== adaptation.id ||
      delivery.timeline.episodeId !== episodeId
    )
      throw new ReviewError(503, "SOURCE_SCOPE_INVALID");
    const shotIds = [
      ...new Set(
        delivery.timeline.tracks.flatMap((t) =>
          t.clips.flatMap((c) => (c.shotId ? [c.shotId] : [])),
        ),
      ),
    ].sort();
    const nodes = new Map<
      string,
      MediaReviewPreview["snapshot"]["nodes"][number]
    >();
    for (const id of shotIds) {
      const shot = production.get(id),
        scene = shot?.parentId ? production.get(shot.parentId) : undefined,
        script =
          scene?.parentId !== episodeId && scene?.parentId
            ? production.get(scene.parentId)
            : undefined;
      if (
        !shot ||
        shot.kind !== "shots" ||
        shot.projectId !== projectId ||
        !scene ||
        scene.kind !== "scenes" ||
        scene.projectId !== projectId ||
        (scene.parentId !== episodeId &&
          (!script ||
            script.kind !== "scripts" ||
            script.projectId !== projectId ||
            script.parentId !== episodeId))
      )
        throw new ReviewError(409, "SHOT_SCOPE_INVALID");
      for (const r of [shot, scene, ...(script ? [script] : [])])
        nodes.set(r.id, {
          id: r.id,
          version: r.version,
          fingerprint: hash(r),
          kind: r.kind as "scripts" | "scenes" | "shots",
        });
    }
    const anchors = delivery.media
      .map((item) => {
        const r = media.get(item.assetId);
        if (!r || r.projectId !== projectId)
          throw new ReviewError(409, "MEDIA_SCOPE_INVALID");
        return { id: r.id, version: r.version, fingerprint: hash(r) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = {
      episode: {
        id: episode.id,
        version: episode.version,
        fingerprint: hash(episode),
      },
      adaptation: {
        id: adaptation.id,
        version: adaptation.version,
        fingerprint: hash(adaptation),
      },
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      media: anchors,
      delivery,
    };
    return MediaReviewPreviewSchema.parse({
      projectId,
      adaptationId: adaptation.id,
      episodeId,
      scope: "original-nle-metadata-review",
      releaseReady: false,
      sourceFingerprint: hash({ projectId, episodeId, snapshot, shotIds }),
      snapshot,
      shotIds,
    });
  };
  const receipt = mediaReviewReceipt;
  const recover = (key: string, projectId: string) =>
    context.uow.execute((tx) => {
      const r = tx.get<BindingRow>(
        "SELECT * FROM review_media_packages WHERE request_key=?",
        key,
      );
      if (!r || r.project_id !== projectId)
        throw new ReviewError(404, "NOT_FOUND");
      return receipt(r, tx);
    });
  const feedback = (packageId: string) =>
    context.uow.execute((tx) => {
      const ds = tx.all<{
        id: string;
        shot_id: string | null;
        decision: string;
        author_alias: string | null;
        note: string | null;
        created_at: string;
      }>(
        "SELECT * FROM review_decisions WHERE package_id=? ORDER BY rowid",
        packageId,
      );
      const cs = tx.all<{
        id: string;
        shot_id: string | null;
        timecode_seconds: number | null;
        author_alias: string | null;
        body: string;
        resolved: number;
        created_at: string;
        updated_at: string;
      }>(
        "SELECT * FROM review_comments WHERE package_id=? ORDER BY rowid",
        packageId,
      );
      const effective = new Map<string, string>();
      for (const d of ds)
        if (d.decision !== "note") effective.set(d.shot_id ?? "package", d.id);
      return {
        decisionFingerprint: hash({ ds, cs }),
        decisions: ds.map((d) => {
          ReviewDecisionSchema.parse({
            id: d.id,
            packageId,
            ...(d.shot_id ? { shotId: d.shot_id } : {}),
            decision: d.decision,
            createdAt: d.created_at,
          });
          return {
            id: d.id,
            ...(d.shot_id ? { shotId: d.shot_id } : {}),
            decision: d.decision,
            createdAt: d.created_at,
            effective: effective.get(d.shot_id ?? "package") === d.id,
          };
        }),
        comments: cs.map((c) => {
          if (c.resolved !== 0 && c.resolved !== 1)
            throw new ReviewError(503, "FEEDBACK_CORRUPT");
          ReviewCommentSchema.parse({
            id: c.id,
            packageId,
            ...(c.shot_id ? { shotId: c.shot_id } : {}),
            body: c.body,
            resolved: !!c.resolved,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          });
          return {
            id: c.id,
            ...(c.shot_id ? { shotId: c.shot_id } : {}),
            resolved: !!c.resolved,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          };
        }),
      };
    });
  const service: MediaReviewService = {
    evidence(packageId, scope) {
      MediaReviewScopeSchema.parse(scope);
      const found = context.uow.execute((tx) => {
        const p = tx.get<PackageRow>(
          "SELECT * FROM review_packages WHERE id=?",
          packageId,
        );
        if (
          !p ||
          p.project_id !== scope.projectId ||
          p.episode_id !== scope.episodeId
        )
          throw new ReviewError(404, "NOT_FOUND");
        const r = tx.get<BindingRow>(
          "SELECT * FROM review_media_packages WHERE package_id=?",
          packageId,
        );
        return r ? receipt(r, tx) : undefined;
      });
      const base = { packageId, ...scope, releaseReady: false };
      if (!found)
        return MediaReviewEvidenceSchema.parse({
          ...base,
          kind: "legacy-unbound",
          scope: "legacy-review-not-bound-to-nle",
          reviewState: "unverified",
        });
      const original = found.original;
      let current: MediaReviewPreview | undefined;
      try {
        current = preview(scope.episodeId, scope.projectId);
      } catch (e) {
        if (!(e instanceof ReviewError) || e.status === 503) throw e;
      }
      const sourceState = !current
        ? "missing"
        : current.sourceFingerprint === original.sourceFingerprint
          ? "current"
          : "changed";
      const assets: MediaReviewOwnerEvidence["assets"] =
        original.snapshot.media.map((anchor) => {
          const record = media.get(anchor.id);
          if (!record || record.projectId !== scope.projectId)
            return { ...anchor, binding: "missing" as const };
          const fingerprint = hash(record);
          if (
            record.version !== anchor.version ||
            fingerprint !== anchor.fingerprint
          )
            return {
              ...anchor,
              binding: "changed" as const,
              current: { id: record.id, version: record.version, fingerprint },
            };
          if (!media.deliveryEvidence)
            return { ...anchor, binding: "owner-unavailable" as const };
          const evidence = MediaDeliveryEvidenceSchema.parse(
            media.deliveryEvidence(anchor.id, scope.projectId, anchor.version),
          );
          if (
            evidence.recordId !== anchor.id ||
            evidence.projectId !== scope.projectId ||
            evidence.recordVersion !== anchor.version
          )
            throw new ReviewError(503, "MEDIA_EVIDENCE_CORRUPT");
          const after = media.get(anchor.id);
          if (!after || hash(after) !== fingerprint)
            throw new ReviewError(409, "MEDIA_CHANGED_DURING_READ");
          return {
            ...anchor,
            binding: "exact" as const,
            evidence,
            archiveBinding: mediaReviewArchiveBinding(
              original.snapshot.delivery.media.find(
                (m) => m.assetId === anchor.id,
              )?.archive,
              evidence.archive,
            ),
          };
        });
      const ownerBlockers: MediaReviewOwnerEvidence["blockers"] =
        assets.flatMap<MediaReviewOwnerEvidence["blockers"][number]>((a) =>
          a.binding === "exact"
            ? [
                ...a.evidence.blockers.map((code) => ({
                  recordId: a.id,
                  code,
                })),
                ...(a.archiveBinding === "matching-original-archive"
                  ? []
                  : [
                      {
                        recordId: a.id,
                        code:
                          a.archiveBinding === "changed-original-archive"
                            ? ("ORIGINAL_ARCHIVE_CHANGED" as const)
                            : ("ORIGINAL_ARCHIVE_UNBOUND" as const),
                      },
                    ]),
              ]
            : [
                {
                  recordId: a.id,
                  code:
                    a.binding === "changed"
                      ? ("MEDIA_RECORD_CHANGED" as const)
                      : a.binding === "missing"
                        ? ("MEDIA_RECORD_MISSING" as const)
                        : ("MEDIA_OWNER_UNAVAILABLE" as const),
                },
              ],
        );
      const mediaOwnerEvidence = MediaReviewOwnerEvidenceSchema.parse({
        scope: "original-package-media-owner-metadata",
        state: !assets.length
          ? "no-media"
          : ownerBlockers.length
            ? "blocked"
            : "unverified",
        assets,
        blockers: ownerBlockers,
        releaseReady: false,
      });
      const f = feedback(packageId),
        blockers: Extract<
          MediaReviewEvidence,
          { kind: "source-bound" }
        >["blockers"] = [];
      if (sourceState !== "current")
        blockers.push(
          sourceState === "missing" ? "SOURCE_MISSING" : "SOURCE_CHANGED",
        );
      if (original.snapshot.delivery.sourceBlockers.length)
        blockers.push("SOURCE_BLOCKED");
      if (f.comments.some((c) => !c.resolved))
        blockers.push("UNRESOLVED_COMMENT");
      if (
        [...f.decisions, ...f.comments].some(
          (x) => x.shotId && !original.shotIds.includes(x.shotId),
        )
      )
        blockers.push("INVALID_FEEDBACK_SCOPE");
      if (
        f.decisions.some(
          (d) =>
            d.effective && ["return", "request_changes"].includes(d.decision),
        )
      )
        blockers.push("RETURN_DECISION");
      if (
        !f.decisions.some(
          (d) => d.effective && !d.shotId && d.decision === "approve",
        )
      )
        blockers.push("PACKAGE_APPROVAL_MISSING");
      const reviewState =
        sourceState !== "current"
          ? "stale"
          : blockers.some((b) => b !== "PACKAGE_APPROVAL_MISSING")
            ? "blocked"
            : blockers.length
              ? "pending"
              : "approved";
      if (current) {
        try {
          if (
            preview(scope.episodeId, scope.projectId).sourceFingerprint !==
            current.sourceFingerprint
          )
            throw new ReviewError(409, "SOURCE_CHANGED_DURING_READ");
        } catch (e) {
          if (!(e instanceof ReviewError) || e.status === 503) throw e;
          throw new ReviewError(409, "SOURCE_CHANGED_DURING_READ");
        }
      }
      return MediaReviewEvidenceSchema.parse({
        ...base,
        kind: "source-bound",
        scope: "original-nle-metadata-review",
        original,
        sourceState,
        reviewState,
        mediaOwnerEvidence,
        ...f,
        blockers,
        unknowns: [
          "CONTENT_QUALITY_UNVERIFIED",
          "LEGAL_RIGHTS_UNVERIFIED",
          "SETTLEMENT_UNKNOWN",
          "CURRENT_FILES_NOT_READ",
          "RENDER_AND_FONT_NOT_REVIEWED",
        ],
      });
    },
  };
  const routes: RouteContribution[] = [];
  const query = (c: C) => {
    if (c.req.queries("projectId")?.length !== 1)
      throw new ReviewError(400, "VALIDATION_ERROR");
    const p = z.string().uuid().safeParse(c.req.query("projectId"));
    if (!p.success) throw new ReviewError(400, "VALIDATION_ERROR");
    return p.data;
  };
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    schema: ZodType,
    fn: (c: C) => unknown | Promise<unknown>,
    write = false,
  ) =>
    routes.push(
      defineRouteContribution({
        id: `review:${operationId}`,
        pluginId: "review",
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
          tags: ["review"],
          request: {
            params: z.object({ id: z.string().uuid() }),
            ...(write
              ? {
                  body: {
                    required: true,
                    content: {
                      "application/json": {
                        schema: MediaReviewCreateInputSchema,
                      },
                    },
                  },
                }
              : {
                  query: z
                    .object({
                      projectId: z.string().uuid(),
                      ...([
                        "review-media.evidence",
                        "review-media.exportOriginal",
                      ].includes(operationId)
                        ? { episodeId: z.string().uuid() }
                        : {}),
                    })
                    .strict(),
                }),
          },
          responses: {
            [write ? 201 : 200]: {
              description: "Original NLE metadata review, not release approval",
              content: { "application/json": { schema } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428, 503].map((s) => [
                s,
                {
                  description: "Review could not be verified",
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
        handler: async (c: C) => {
          try {
            const value = schema.parse(await fn(c));
            return new Response(JSON.stringify(value), {
              status: write ? 201 : 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                ETag: `"${hash(value)}"`,
              },
            });
          } catch (e) {
            const status = e instanceof ReviewError ? e.status : 503;
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/media-review",
                title: "原审片资料未完成核对。",
                detail: "未替换原包或升级为发行批准。",
                status,
                code: e instanceof ReviewError ? e.code : "REVIEW_UNAVAILABLE",
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
  add(
    "get",
    "/api/v2/episodes/{id}/media-review-preview",
    "review-media.preview",
    MediaReviewPreviewSchema,
    (c) => preview(c.req.param("id"), query(c)),
  );
  add(
    "post",
    "/api/v2/episodes/{id}/media-review-packages",
    "review-media.createPackage",
    MediaReviewReceiptSchema,
    async (c) => {
      const parsed = MediaReviewCreateInputSchema.safeParse(await c.req.json()),
        k = z.string().uuid().safeParse(c.req.header("Idempotency-Key"));
      if (!parsed.success || !k.success)
        throw new ReviewError(400, "VALIDATION_ERROR");
      const input = parsed.data,
        requestKey = k.data,
        episodeId = c.req.param("id"),
        requestHash = hash({ episodeId, input });
      if (c.req.header("If-Match") !== `"${input.sourceFingerprint}"`)
        throw new ReviewError(412, "PRECONDITION_FAILED");
      const replay = context.uow.execute((tx) => {
        const r = tx.get<BindingRow>(
          "SELECT * FROM review_media_packages WHERE request_key=?",
          requestKey,
        );
        if (!r) return undefined;
        if (r.project_id !== input.projectId || r.request_hash !== requestHash)
          throw new ReviewError(409, "IDEMPOTENCY_CONFLICT");
        return receipt(r, tx);
      });
      if (replay) return replay;
      const original = preview(episodeId, input.projectId);
      if (original.sourceFingerprint !== input.sourceFingerprint)
        throw new ReviewError(412, "SOURCE_CHANGED");
      if (!original.shotIds.length) throw new ReviewError(409, "EMPTY_REVIEW");
      const t = original.snapshot.delivery.timeline,
        fps = t.profile.frameRate.numerator / t.profile.frameRate.denominator;
      if (![24, 25, 30].includes(fps))
        throw new ReviewError(409, "REVIEW_PROFILE_UNSUPPORTED");
      const manifest = {
        format: "dramaip-editor-timeline",
        version: 1,
        projectId: t.projectId,
        adaptationId: t.adaptationId,
        episodeId,
        title: "原NLE审片时间线",
        frameRate: fps,
        width: t.profile.width,
        height: t.profile.height,
        createdAt: t.createdAt,
        clips: t.tracks
          .filter((tr) => tr.kind === "video")
          .flatMap((tr) => tr.clips)
          .flatMap((clip, orderIndex) =>
            clip.shotId
              ? [
                  {
                    id: clip.id,
                    shotId: clip.shotId,
                    orderIndex,
                    name: clip.name,
                    startSeconds: clip.startFrame / fps,
                    durationSeconds: clip.durationFrames / fps,
                    transition: "cut",
                    mediaKind: !clip.assetId
                      ? "slate"
                      : original.snapshot.delivery.media.find(
                            (m) => m.assetId === clip.assetId,
                          )?.archive?.kind === "image"
                        ? "still"
                        : "video",
                    mediaStatus: clip.assetId ? "referenced" : "needs_relink",
                  },
                ]
              : [],
          ),
      };
      return context.uow.execute((tx) => {
        const prior = tx.get<BindingRow>(
          "SELECT * FROM review_media_packages WHERE request_key=?",
          requestKey,
        );
        if (prior) {
          if (
            prior.request_hash !== requestHash ||
            prior.project_id !== input.projectId
          )
            throw new ReviewError(409, "IDEMPOTENCY_CONFLICT");
          return receipt(prior, tx);
        }
        const now = new Date().toISOString(),
          id = crypto.randomUUID(),
          p = ReviewPackageSchema.parse({
            id,
            projectId: input.projectId,
            adaptationId: t.adaptationId,
            episodeId,
            kind: "offline",
            status: "exported",
            title: "原NLE整包审片",
            manifest,
            createdAt: now,
            updatedAt: now,
          });
        tx.run(
          "INSERT INTO review_packages(id,project_id,adaptation_id,episode_id,title,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          id,
          p.projectId,
          p.adaptationId,
          p.episodeId,
          p.title,
          JSON.stringify(p.manifest),
          now,
          now,
        );
        const result = MediaReviewReceiptSchema.parse({
          requestKey,
          episodeId,
          projectId: input.projectId,
          requestHash,
          input,
          package: p,
          original,
          createdAt: now,
        });
        tx.run(
          "INSERT INTO review_media_packages(package_id,project_id,request_key,request_hash,receipt_json,package_hash,created_at) VALUES(?,?,?,?,?,?,?)",
          id,
          p.projectId,
          requestKey,
          requestHash,
          JSON.stringify(result),
          hash(p),
          now,
        );
        tx.append({
          type: "review.media-package-created.v1",
          pluginId: "review",
          aggregateType: "review-package",
          aggregateId: id,
          aggregateVersion: 0,
          payload: {
            projectId: p.projectId,
            episodeId,
            requestKey,
            sourceFingerprint: original.sourceFingerprint,
          },
        });
        return result;
      });
    },
    true,
  );
  add(
    "get",
    "/api/v2/media-review-requests/{id}",
    "review-media.recoverRequest",
    MediaReviewReceiptSchema,
    (c) => recover(c.req.param("id"), query(c)),
  );
  add(
    "get",
    "/api/v2/review-packages/{id}/delivery-evidence",
    "review-media.evidence",
    MediaReviewEvidenceSchema,
    (c) => {
      if (c.req.queries("episodeId")?.length !== 1)
        throw new ReviewError(400, "VALIDATION_ERROR");
      const scope = MediaReviewScopeSchema.safeParse({
        projectId: query(c),
        episodeId: c.req.query("episodeId"),
      });
      if (!scope.success) throw new ReviewError(400, "VALIDATION_ERROR");
      return service.evidence(c.req.param("id"), scope.data);
    },
  );
  add(
    "get",
    "/api/v2/review-packages/{id}/media-review-export",
    "review-media.exportOriginal",
    z
      .object({
        fileName: z.string(),
        mimeType: z.literal("application/json; charset=utf-8"),
        content: z.string(),
      })
      .strict(),
    (c) => {
      if (c.req.queries("episodeId")?.length !== 1)
        throw new ReviewError(400, "VALIDATION_ERROR");
      const scope = MediaReviewScopeSchema.safeParse({
        projectId: query(c),
        episodeId: c.req.query("episodeId"),
      });
      if (!scope.success) throw new ReviewError(400, "VALIDATION_ERROR");
      const value = context.uow.execute((tx) => {
        const r = tx.get<BindingRow>(
          "SELECT * FROM review_media_packages WHERE package_id=?",
          c.req.param("id"),
        );
        if (!r || r.project_id !== scope.data.projectId)
          throw new ReviewError(404, "NOT_FOUND");
        const v = receipt(r, tx);
        if (v.episodeId !== scope.data.episodeId)
          throw new ReviewError(404, "NOT_FOUND");
        return MediaReviewExportSchema.parse({
          package: v.package,
          original: v.original,
        });
      });
      return {
        fileName: `review-${value.package.id}-original-nle.json`,
        mimeType: "application/json; charset=utf-8",
        content: JSON.stringify(value, null, 2),
      };
    },
  );
  return { service, routes };
}
