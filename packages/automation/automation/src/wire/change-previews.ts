/**
 * The shapes the change preview operations declare.
 *
 * @module @dramaip/automation-automation/wire/change-previews
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `automation/changePreviewsCommit` (`change-previews.commit`). */
export type ChangePreviewsCommitResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  engineKind?: "pi";
  taskType?: string;
  targets: {
    kind:
      | "creation"
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch: Record<string, JsonValue>;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
  committedAt?: string;
};

/** Answer of `automation/changePreviewsDiscard` (`change-previews.discard`). */
export type ChangePreviewsDiscardResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  engineKind?: "pi";
  taskType?: string;
  targets: {
    kind:
      | "creation"
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch: Record<string, JsonValue>;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
  committedAt?: string;
};

/** Answer of `automation/changePreviewsGet` (`change-previews.get`). */
export type ChangePreviewsGetResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  engineKind?: "pi";
  taskType?: string;
  targets: {
    kind:
      | "creation"
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch: Record<string, JsonValue>;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
  committedAt?: string;
};

/** Answer of `automation/changePreviewsMerge` (`change-previews.merge`). */
export type ChangePreviewsMergeResult = {
  previewId: string;
  chapterId: string;
  currentVersion: number;
  segments: {
    id: string;
    base: string;
    current: string;
    candidate: string;
    conflict: boolean;
    content: string;
  }[];
};

/** Input of `automation/changePreviewsRebase` (`change-previews.rebase`). */
export type ChangePreviewsRebaseInput = {
  baseVersion: number;
  content: string;
};

/** Answer of `automation/changePreviewsRebase` (`change-previews.rebase`). */
export type ChangePreviewsRebaseResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  engineKind?: "pi";
  taskType?: string;
  targets: {
    kind:
      | "creation"
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch: Record<string, JsonValue>;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
  committedAt?: string;
};

/** Query of `automation/changePreviewsRevisionEffort` (`change-previews.revisionEffort`). */
export type ChangePreviewsRevisionEffortQuery = {
  projectId: string;
  contentHash: string;
};

/** Answer of `automation/changePreviewsRevisionEffort` (`change-previews.revisionEffort`). */
export type ChangePreviewsRevisionEffortResult = {
  format: "chapter-preview-revision-effort-v1";
  projectId: string;
  previewId: string;
  chapterId: string;
  taskId?: string;
  rootPreviewId: string;
  contentHash: string;
  candidateSha256: string;
  journalSha256: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  coverage: "complete" | "partial" | "untracked";
  observedContentUpdates: number;
  observedRebases: number;
  observedContentChangingRebases: number;
  localRevisionCount: number | null;
  scope: "exact-chapter-preview-chain";
  qualityStatus: "unverified";
};

/** Input of `automation/changePreviewsUpdateContent` (`change-previews.updateContent`). */
export type ChangePreviewsUpdateContentInput = {
  content: string;
};

/** Answer of `automation/changePreviewsUpdateContent` (`change-previews.updateContent`). */
export type ChangePreviewsUpdateContentResult = {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  engineKind?: "pi";
  taskType?: string;
  targets: {
    kind:
      | "creation"
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch: Record<string, JsonValue>;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
  committedAt?: string;
};
