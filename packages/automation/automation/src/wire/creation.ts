/**
 * The wire types of the namespace, one module per operation.
 *
 * Every operation lives in its own module; this entry point
 * re-exports them, so an importer names the namespace and not
 * the operation.
 * @module @dramaip/automation-automation/wire
 */

export type {
  CreationRecord,
} from "./creation-ops/record.js";

export type {
  CreationActionInput,
  CreationActionResult,
} from "./creation-ops/actions.js";

export type {
  CreationGetResult,
} from "./creation-ops/get.js";

export type {
  CreationExecutionQuery,
  CreationExecutionResult,
} from "./creation-ops/executions.js";

export type {
  CreationListQuery,
  CreationListResult,
} from "./creation-ops/list.js";

export type {
  CreationMergeResult,
  CreationRecordMergeResult,
} from "./creation-ops/merge.js";

export type {
  CreationRebaseInput,
  CreationRebaseResult,
  CreationRecordRebaseInput,
  CreationRecordRebaseResult,
} from "./creation-ops/rebase.js";

export type {
  CreationStartInput,
  CreationStartResult,
} from "./creation-ops/start.js";
