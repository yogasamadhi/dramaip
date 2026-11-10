/**
 * The shapes the creation action operation declares.
 *
 * @module @dramaip/automation-automation/wire/creation-ops/actions
 */
import type { CreationRecord } from "./record.js";

/** Input of `automation/creationAction` (`creation.action`). */
export type CreationActionInput = {
  action: "cancel" | "retry" | "continue";
};

/** Answer of `automation/creationAction` (`creation.action`). */
export type CreationActionResult = CreationRecord;
