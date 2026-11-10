/**
 * The shapes the revision operations declare.
 *
 * @module @dramaip/automation-automation/wire/revisions
 */

/** Input of `automation/revisionsCommit` (`revisions.commit`). */
export type RevisionsCommitInput = {
  version: number;
};

/** Answer of `automation/revisionsCommit` (`revisions.commit`). */
export type RevisionsCommitResult = {
  ok: true;
  revisionId: string;
};

/** Input of `automation/revisionsCreate` (`revisions.create`). */
export type RevisionsCreateInput = {
  chapterId: string;
  proposedContent: string;
  rationale?: string;
};

/** Answer of `automation/revisionsCreate` (`revisions.create`). */
export type RevisionsCreateResult = {
  id: string;
  chapterId: string;
  baseVersion: number;
  proposedContent: string;
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  createdAt: string;
  committedAt?: string;
};

/** Answer of `automation/revisionsDiscard` (`revisions.discard`). */
export type RevisionsDiscardResult = {
  id: string;
  chapterId: string;
  baseVersion: number;
  proposedContent: string;
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  createdAt: string;
  committedAt?: string;
};

/** Answer of `automation/revisionsGet` (`revisions.get`). */
export type RevisionsGetResult = {
  id: string;
  chapterId: string;
  baseVersion: number;
  proposedContent: string;
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  createdAt: string;
  committedAt?: string;
};

/** Query of `automation/revisionsList` (`revisions.list`). */
export type RevisionsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `automation/revisionsList` (`revisions.list`). */
export type RevisionsListResult = {
  items: {
    id: string;
    chapterId: string;
    baseVersion: number;
    status: "pending" | "committed" | "discarded" | "conflicted";
    createdAt: string;
    committedAt?: string;
  }[];
  nextCursor?: string;
};
