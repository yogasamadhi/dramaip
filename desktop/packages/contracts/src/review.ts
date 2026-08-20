import { z } from "zod";

export const REVIEW_RECORD_SERVICE = "review.records.v1" as const;

export const ReviewRecordKindSchema = z.enum([
  "compliance",
  "review",
  "script-review",
  "shot-review",
  "prompt-version",
  "cloud-binding",
  "cloud-connection",
]);
export type ReviewRecordKind = z.infer<typeof ReviewRecordKindSchema>;

export const ReviewRecordSchema = z.object({
  id: z.string().uuid(),
  kind: ReviewRecordKindSchema,
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  value: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

export interface ReviewRecordService {
  create(
    kind: ReviewRecordKind,
    input: {
      projectId?: string;
      parentId?: string;
      value: Record<string, unknown>;
    },
  ): ReviewRecord;
  list(
    kind: ReviewRecordKind,
    filter?: { projectId?: string; parentId?: string },
  ): readonly ReviewRecord[];
  get(id: string): ReviewRecord | undefined;
  update(id: string, patch: Record<string, unknown>): ReviewRecord | undefined;
  remove(id: string): boolean;
}

export const PromptVersionInputSchema = z.object({
  taskType: z.string(),
  videoPrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  imagePrompt: z.string().optional(),
  note: z.string().optional(),
});

export const CloudReviewConnectionInputSchema = z.object({
  baseUrl: z.string().url(),
  workspaceId: z.string().min(1),
  credentialRef: z.string().min(1),
});

export const CloudReviewPublishInputSchema = z.object({
  pin: z.string().optional(),
  media: z.array(
    z.object({
      id: z.string(),
      shotId: z.string().uuid(),
      relativePath: z.string(),
      mimeType: z.string(),
      capabilityToken: z.string(),
    }),
  ),
});

export const OfflineReviewImportInputSchema = z.object({
  capabilityToken: z.string().min(1),
});

export const CompliancePreflightInputSchema = z.object({
  title: z.string().trim().min(1),
  subtitleLanguage: z.string().trim().min(1),
  targetPlatform: z.string().optional(),
  targetRegion: z.string().optional(),
  deliveryDate: z.string().min(1),
  aigcDeclared: z.boolean(),
  manualContentReviewConfirmed: z.boolean(),
});

export const EditorTimelineClipSchema = z.object({
  id: z.string().uuid(),
  shotId: z.string().uuid(),
  orderIndex: z.number().int().nonnegative(),
  name: z.string(),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  subtitle: z.string().optional(),
  transition: z.enum(["cut", "dissolve", "fade"]),
  mediaKind: z.enum(["video", "still", "slate"]),
  mediaStatus: z.enum(["referenced", "needs_relink"]),
});

export const EditorTimelineManifestSchema = z.object({
  format: z.literal("dramaip-editor-timeline"),
  version: z.literal(1),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid(),
  episodeId: z.string().uuid(),
  title: z.string(),
  frameRate: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  clips: z.array(EditorTimelineClipSchema),
  createdAt: z.string().datetime(),
});

export const EditorExportPreflightSchema = z.object({
  canExport: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  referencedClipCount: z.number().int().nonnegative(),
  relinkRequiredCount: z.number().int().nonnegative(),
});

export const ReviewPackageSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  adaptationId: z.string().uuid(),
  episodeId: z.string().uuid(),
  kind: z.literal("offline"),
  status: z.literal("exported"),
  title: z.string(),
  manifest: EditorTimelineManifestSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ReviewCommentInputSchema = z.object({
  shotId: z.string().uuid().optional(),
  timecodeSeconds: z.number().nonnegative().optional(),
  authorAlias: z.string().optional(),
  body: z.string().min(1),
});

export const ReviewCommentSchema = ReviewCommentInputSchema.extend({
  id: z.string().uuid(),
  packageId: z.string().uuid(),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ReviewDecisionInputSchema = z.object({
  shotId: z.string().uuid().optional(),
  decision: z.enum(["approve", "return", "request_changes", "note"]),
  authorAlias: z.string().optional(),
  note: z.string().optional(),
});

export const ReviewDecisionSchema = ReviewDecisionInputSchema.extend({
  id: z.string().uuid(),
  packageId: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export const ReviewRevisionPreviewInputSchema = z.object({
  scriptId: z.string().uuid(),
  proposedContent: z.string().min(1),
});

export const ChangePreviewSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  targets: z.array(
    z.object({
      kind: z.enum([
        "project",
        "chapter",
        "character",
        "outline",
        "story_bible",
        "episode",
        "script",
        "scene",
        "shot",
      ]),
      id: z.string().uuid(),
      baseVersion: z.number().int().nonnegative(),
      patch: z.unknown(),
      displayDiff: z.unknown().optional(),
    }),
  ),
  rationale: z.string(),
  status: z.enum(["pending", "committed", "discarded", "conflicted"]),
  contentHash: z.string(),
  createdAt: z.string().datetime(),
});

export const CloudReviewConnectionSchema = z.object({
  baseUrl: z.string(),
  workspaceId: z.string(),
  configured: z.boolean(),
  updatedAt: z.string().datetime(),
});

export type EditorTimelineManifest = z.infer<
  typeof EditorTimelineManifestSchema
>;
export type ReviewPackage = z.infer<typeof ReviewPackageSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
