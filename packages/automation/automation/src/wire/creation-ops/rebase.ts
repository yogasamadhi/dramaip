/**
 * The shapes the creation rebase operations declare.
 *
 * @module @dramaip/automation-automation/wire/creation-ops/rebase
 */
import type { JsonValue } from "@dramaip/infra-values";
import type { CreationRecord } from "./record.js";

/** Input of `automation/creationRebase` (`creation.rebase`). */
export type CreationRebaseInput = {
  baseVersion: number;
  choices: Record<string, "main" | "branch">;
  basis?: {
    format: "stable-screenplay-merge-v1";
    projectId: string;
    workflowId: string;
    baseBlocksHash: string;
    candidateHash: string;
    contextHash: string;
    target: {
      scriptId: string;
      version: number;
      documentId: string;
      documentVersion: number;
      blocksHash: string;
    };
  };
  blockOrder?: string[];
};

/** Answer of `automation/creationRebase` (`creation.rebase`). */
export type CreationRebaseResult = CreationRecord;

/** Input of `automation/creationRecordRebase` (`creation.recordRebase`). */
export type CreationRecordRebaseInput =
  | {
      format: "storyboard-record-field-merge-request-v1";
      projectId: string;
      episodeId: string;
      workflow: {
        id: string;
        version: number;
      };
      base: {
        id: string;
        version: number;
      };
      comparisonHash: string;
      choices: JsonValue;
      reviewed: true;
      modelDisclosureConfirmed: true;
    }

/** Answer of `automation/creationRecordRebase` (`creation.recordRebase`). */
export type CreationRecordRebaseResult = CreationRecord;
