import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { TimelineDeliveryManifestSchema } from "./timeline.js";
import { ReviewPackageSchema } from "./review.js";
import {
  MediaDeliveryEvidenceSchema,
  type MediaDeliveryEvidence,
} from "./media.js";

const uuid = z.string().uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const anchor = z
  .object({
    id: uuid,
    version: z.number().int().nonnegative(),
    fingerprint: sha,
  })
  .strict();
export const MediaReviewScopeSchema = z
  .object({ projectId: uuid, episodeId: uuid })
  .strict();
export const MediaReviewPreviewSchema = z
  .object({
    projectId: uuid,
    adaptationId: uuid,
    episodeId: uuid,
    scope: z.literal("original-nle-metadata-review"),
    releaseReady: z.literal(false),
    sourceFingerprint: sha,
    snapshot: z
      .object({
        episode: anchor,
        adaptation: anchor,
        nodes: z.array(
          anchor
            .extend({ kind: z.enum(["scripts", "scenes", "shots"]) })
            .strict(),
        ),
        media: z.array(anchor),
        delivery: TimelineDeliveryManifestSchema,
      })
      .strict(),
    shotIds: z.array(uuid),
  })
  .strict()
  .superRefine((v, ctx) => {
    const t = v.snapshot.delivery.timeline;
    if (
      t.projectId !== v.projectId ||
      t.adaptationId !== v.adaptationId ||
      t.episodeId !== v.episodeId ||
      v.snapshot.episode.id !== v.episodeId ||
      v.snapshot.adaptation.id !== v.adaptationId ||
      new Set(v.shotIds).size !== v.shotIds.length ||
      v.shotIds.some(
        (id) =>
          !v.snapshot.nodes.some((n) => n.kind === "shots" && n.id === id),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Original NLE scope does not match",
      });
  });
export const MediaReviewCreateInputSchema = z
  .object({ projectId: uuid, sourceFingerprint: sha })
  .strict();
export const MediaReviewReceiptSchema = z
  .object({
    requestKey: uuid,
    episodeId: uuid,
    projectId: uuid,
    requestHash: sha,
    input: MediaReviewCreateInputSchema,
    package: z.lazy(() => ReviewPackageSchema.strict()),
    original: MediaReviewPreviewSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.episodeId !== v.package.episodeId ||
      v.episodeId !== v.original.episodeId ||
      v.projectId !== v.package.projectId ||
      v.projectId !== v.original.projectId ||
      v.projectId !== v.input.projectId ||
      v.package.adaptationId !== v.original.adaptationId ||
      v.input.sourceFingerprint !== v.original.sourceFingerprint ||
      v.createdAt !== v.package.createdAt
    )
      ctx.addIssue({
        code: "custom",
        message: "Original review request does not match",
      });
  });
const base = z
  .object({
    packageId: uuid,
    projectId: uuid,
    episodeId: uuid,
    releaseReady: z.literal(false),
  })
  .strict();
const ownerAsset = z.discriminatedUnion("binding", [
  anchor
    .extend({
      binding: z.literal("exact"),
      evidence: MediaDeliveryEvidenceSchema,
      archiveBinding: z.enum([
        "matching-original-archive",
        "changed-original-archive",
        "not-originally-bound",
      ]),
    })
    .strict(),
  anchor.extend({ binding: z.literal("changed"), current: anchor }).strict(),
  anchor.extend({ binding: z.literal("missing") }).strict(),
  anchor.extend({ binding: z.literal("owner-unavailable") }).strict(),
]);
const ownerBlocker = z
  .object({
    recordId: uuid,
    code: z.enum([
      "MEDIA_RECORD_CHANGED",
      "MEDIA_RECORD_MISSING",
      "MEDIA_OWNER_UNAVAILABLE",
      "ORIGINAL_ARCHIVE_CHANGED",
      "ORIGINAL_ARCHIVE_UNBOUND",
      "DECLARED_RIGHTS_RESTRICTED",
      "DECLARED_PROVIDER_UNAVAILABLE",
      "SOURCE_STALE",
      "SOURCE_UNVERIFIED",
      "ARCHIVE_UNAVAILABLE",
    ]),
  })
  .strict();
/** Exact original anchors and current owner metadata; never file, rights or settlement approval. */
export const MediaReviewOwnerEvidenceSchema = z
  .object({
    scope: z.literal("original-package-media-owner-metadata"),
    state: z.enum(["blocked", "unverified", "no-media"]),
    assets: z.array(ownerAsset),
    blockers: z.array(ownerBlocker),
    releaseReady: z.literal(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    const expected = v.assets.flatMap((a) =>
      a.binding === "exact"
        ? [
            ...a.evidence.blockers.map((code) => ({ recordId: a.id, code })),
            ...(a.archiveBinding === "matching-original-archive"
              ? []
              : [
                  {
                    recordId: a.id,
                    code:
                      a.archiveBinding === "changed-original-archive"
                        ? "ORIGINAL_ARCHIVE_CHANGED"
                        : "ORIGINAL_ARCHIVE_UNBOUND",
                  },
                ]),
          ]
        : [
            {
              recordId: a.id,
              code:
                a.binding === "changed"
                  ? "MEDIA_RECORD_CHANGED"
                  : a.binding === "missing"
                    ? "MEDIA_RECORD_MISSING"
                    : "MEDIA_OWNER_UNAVAILABLE",
            },
          ],
    );
    if (
      new Set(v.assets.map((a) => a.id)).size !== v.assets.length ||
      JSON.stringify(v.blockers) !== JSON.stringify(expected) ||
      v.state !==
        (!v.assets.length
          ? "no-media"
          : expected.length
            ? "blocked"
            : "unverified") ||
      v.assets.some((a) =>
        a.binding === "exact"
          ? a.evidence.recordId !== a.id ||
            a.evidence.recordVersion !== a.version
          : a.binding === "changed" &&
            (a.current.id !== a.id ||
              (a.current.version === a.version &&
                a.current.fingerprint === a.fingerprint)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Original media anchors and negative owner facts must be preserved.",
      });
  });
export type MediaReviewOwnerEvidence = z.infer<
  typeof MediaReviewOwnerEvidenceSchema
>;
export function mediaReviewArchiveBinding(
  original: z.infer<
    typeof TimelineDeliveryManifestSchema
  >["media"][number]["archive"],
  current: MediaDeliveryEvidence["archive"],
): Extract<
  MediaReviewOwnerEvidence["assets"][number],
  { binding: "exact" }
>["archiveBinding"] {
  if (!original) return "not-originally-bound";
  if (!current) return "changed-original-archive";
  return JSON.stringify([
    original.artifactRef,
    original.kind,
    original.mimeType,
    original.extension,
    original.sizeBytes,
    original.sha256,
  ]) ===
    JSON.stringify([
      current.artifactId,
      current.kind,
      current.mimeType,
      current.extension,
      current.sizeBytes,
      current.sha256,
    ])
    ? "matching-original-archive"
    : "changed-original-archive";
}
export const MediaReviewEvidenceSchema = z
  .discriminatedUnion("kind", [
    base
      .extend({
        kind: z.literal("legacy-unbound"),
        reviewState: z.literal("unverified"),
        scope: z.literal("legacy-review-not-bound-to-nle"),
      })
      .strict(),
    base
      .extend({
        kind: z.literal("source-bound"),
        scope: z.literal("original-nle-metadata-review"),
        original: MediaReviewPreviewSchema,
        sourceState: z.enum(["current", "changed", "missing"]),
        reviewState: z.enum(["pending", "blocked", "approved", "stale"]),
        mediaOwnerEvidence: MediaReviewOwnerEvidenceSchema,
        decisionFingerprint: sha,
        decisions: z.array(
          z
            .object({
              id: uuid,
              shotId: uuid.optional(),
              decision: z.enum([
                "approve",
                "return",
                "request_changes",
                "note",
              ]),
              createdAt: z.string().datetime(),
              effective: z.boolean(),
            })
            .strict(),
        ),
        comments: z.array(
          z
            .object({
              id: uuid,
              shotId: uuid.optional(),
              resolved: z.boolean(),
              createdAt: z.string().datetime(),
              updatedAt: z.string().datetime(),
            })
            .strict(),
        ),
        blockers: z.array(
          z.enum([
            "SOURCE_CHANGED",
            "SOURCE_MISSING",
            "SOURCE_BLOCKED",
            "UNRESOLVED_COMMENT",
            "RETURN_DECISION",
            "PACKAGE_APPROVAL_MISSING",
            "INVALID_FEEDBACK_SCOPE",
          ]),
        ),
        unknowns: z.tuple([
          z.literal("CONTENT_QUALITY_UNVERIFIED"),
          z.literal("LEGAL_RIGHTS_UNVERIFIED"),
          z.literal("SETTLEMENT_UNKNOWN"),
          z.literal("CURRENT_FILES_NOT_READ"),
          z.literal("RENDER_AND_FONT_NOT_REVIEWED"),
        ]),
      })
      .strict(),
  ])
  .superRefine((v, ctx) => {
    if (
      v.kind === "source-bound" &&
      (v.original.projectId !== v.projectId ||
        v.original.episodeId !== v.episodeId ||
        v.mediaOwnerEvidence.assets.length !==
          v.original.snapshot.media.length ||
        v.mediaOwnerEvidence.assets.some((a, i) => {
          const original = v.original.snapshot.media[i];
          return (
            !original ||
            a.id !== original.id ||
            a.version !== original.version ||
            a.fingerprint !== original.fingerprint ||
            (a.binding === "exact" &&
              (a.evidence.projectId !== v.projectId ||
                a.archiveBinding !==
                  mediaReviewArchiveBinding(
                    v.original.snapshot.delivery.media.find(
                      (m) => m.assetId === a.id,
                    )?.archive,
                    a.evidence.archive,
                  )))
          );
        }) ||
        (v.reviewState === "approved" &&
          (v.sourceState !== "current" || v.blockers.length !== 0)))
    )
      ctx.addIssue({
        code: "custom",
        message: "Review evidence scope or approval does not match",
      });
  });
export type MediaReviewPreview = z.infer<typeof MediaReviewPreviewSchema>;
export type MediaReviewReceipt = z.infer<typeof MediaReviewReceiptSchema>;
export type MediaReviewEvidence = z.infer<typeof MediaReviewEvidenceSchema>;
export type MediaReviewCreateInput = z.infer<
  typeof MediaReviewCreateInputSchema
>;
export type MediaReviewScope = z.infer<typeof MediaReviewScopeSchema>;
export const MediaReviewExportSchema = z
  .object({
    package: z.lazy(() => ReviewPackageSchema.strict()),
    original: MediaReviewPreviewSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.package.projectId !== v.original.projectId ||
      v.package.episodeId !== v.original.episodeId ||
      v.package.adaptationId !== v.original.adaptationId
    )
      ctx.addIssue({
        code: "custom",
        message: "Original review export scope does not match",
      });
  });
export interface MediaReviewService {
  evidence(packageId: string, scope: MediaReviewScope): MediaReviewEvidence;
}
export const REVIEW_MEDIA_SERVICE = defineServiceContract<MediaReviewService>({
  id: "review.media-evidence.v1",
  owner: "review",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
