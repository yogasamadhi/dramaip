/**
 * The shapes the creation merge operations answer with.
 *
 * @module @dramaip/automation-automation/wire/creation-ops/merge
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `automation/creationMerge` (`creation.merge`). */
export type CreationMergeResult = {
  currentVersion: number;
  units: {
    id: string;
    current: string;
    candidate: string;
    conflict: boolean;
    choice: "main" | "branch";
    kind?:
      "unchanged" | "added" | "deleted" | "modified" | "moved" | "conflict";
    currentPresent?: boolean;
    candidatePresent?: boolean;
  }[];
  output?: {
    title?: string;
    brief?: string;
    content?: string;
    items?: {
      ref: string;
      parentRef?: string;
      kind: string;
      title: string;
      data: Record<string, JsonValue>;
    }[];
  };
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
  blockOrder?: {
    format: "stable-block-order-v1";
    base: string[];
    current: string[];
    candidate: string[];
    proposed: string[];
    conflict: boolean;
    reason?: "divergent-order" | "ambiguous-insertion" | "missing-position";
  };
};

/** Answer of `automation/creationRecordMerge` (`creation.recordMerge`). */
export type CreationRecordMergeResult =
  | {
      format: "storyboard-record-field-comparison-v1";
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
      candidateHash: string;
      frozenBasisHash: string;
      contextHash: string;
      records: {
        id: string;
        kind: "scenes" | "shots";
        stableId: string;
        frozenVersion: number;
        currentVersion: number;
        frozenHash: string;
        currentHash: string;
        parentId: string;
        orderIndex: number;
        editable: boolean;
      }[];
      units: {
        id: string;
        recordId: string;
        kind: "scenes" | "shots";
        field:
          | "title"
          | "场景动作"
          | "镜头描述"
          | "构图"
          | "机位"
          | "运镜"
          | "生成提示"
          | "负面提示"
          | "声音";
        base:
          | {
              state: "text";
              text: string;
              hash: string;
            }
          | {
              state: "absent" | "unsupported";
              hash: string;
            };
        current:
          | {
              state: "text";
              text: string;
              hash: string;
            }
          | {
              state: "absent" | "unsupported";
              hash: string;
            };
        candidate:
          | {
              state: "text";
              text: string;
              hash: string;
            }
          | {
              state: "absent" | "unsupported";
              hash: string;
            };
        conflict: boolean;
        defaultChoice: "main" | "branch";
      }[];
      comparisonHash: string;
      semanticVerification: "unverified";
      automaticCommit: false;
    }
