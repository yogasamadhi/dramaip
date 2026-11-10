/**
 * Requests the workbench keeps on this machine until their receipt is
 * checked: a script merge and a storyboard redo start. Each keeps only
 * identities, choices, hashes and the original idempotency key, so a resend
 * repeats the original request and never a rebuilt one.
 */
import { canonical, sameFrozenSnapshot, sha256Hex } from "./owner.ts";
import {
  value,
  type AutomationRemote,
  type CreationInput,
  type CreationMerge,
  type CreationRebaseRequest,
  type CreationWorkflow,
} from "./remote.ts";

/** Copy keys of the failures the recovery raises. */
export type RecoveryProblem =
  | "recovery.merge.invalid"
  | "recovery.merge.foreign"
  | "recovery.merge.receipt"
  | "recovery.merge.foreignCompare"
  | "recovery.redo.invalid"
  | "recovery.redo.tooLarge"
  | "recovery.redo.foreign"
  | "recovery.redo.occupied"
  | "recovery.redo.unsaved"
  | "recovery.redo.uncleared"
  | "recovery.redo.unchecked"
  | "recovery.redo.receiptInvalid"
  | "recovery.redo.receiptKey"
  | "recovery.redo.receiptInput"
  | "recovery.redo.sendFailed";

/** A recovery failure, named by its copy key. */
export class RecoveryError extends Error {
  constructor(readonly problem: RecoveryProblem) {
    super(problem);
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isUuid = (item: unknown): item is string =>
  typeof item === "string" && UUID.test(item);
const isRecord = (item: unknown): item is Record<string, unknown> =>
  typeof item === "object" && item !== null && !Array.isArray(item);
const LIMIT = 2 * 1024 * 1024;

/** A script merge sent but not yet confirmed by its receipt. */
export interface ScriptMergeRequest {
  format: "script-merge-request-v1";
  projectId: string;
  targetId: string;
  workflowId: string;
  key: string;
  input: CreationRebaseRequest;
}

/**
 * Where a script's unconfirmed merge is kept.
 * @param projectId - the project.
 * @param targetId - the script.
 */
export const scriptMergeStorageKey = (projectId: string, targetId: string) =>
  `dramaip-script-merge-request:${projectId}:${targetId}`;

function checkScriptMerge(raw: unknown): ScriptMergeRequest {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some(
      (key) =>
        ![
          "format",
          "projectId",
          "targetId",
          "workflowId",
          "key",
          "input",
        ].includes(key),
    ) ||
    raw.format !== "script-merge-request-v1" ||
    !isUuid(raw.projectId) ||
    !isUuid(raw.targetId) ||
    !isUuid(raw.workflowId) ||
    !isUuid(raw.key) ||
    !isRecord(raw.input) ||
    typeof raw.input.baseVersion !== "number" ||
    !isRecord(raw.input.choices) ||
    Object.entries(raw.input.choices).some(
      ([id, choice]) =>
        !isUuid(id) || (choice !== "main" && choice !== "branch"),
    )
  )
    throw new RecoveryError("recovery.merge.invalid");
  const basis = raw.input.basis;
  if (
    !isRecord(basis) ||
    basis.projectId !== raw.projectId ||
    basis.workflowId !== raw.workflowId ||
    !isRecord(basis.target) ||
    basis.target.scriptId !== raw.targetId ||
    basis.target.version !== raw.input.baseVersion
  )
    throw new RecoveryError("recovery.merge.invalid");
  return raw as unknown as ScriptMergeRequest;
}

/**
 * The script's unconfirmed merge kept on this machine, if any.
 * @param raw - what storage holds.
 * @param projectId - the project it must belong to.
 * @param targetId - the script it must belong to.
 * @throws RecoveryError when it is damaged or belongs elsewhere.
 */
export function parseScriptMergeRequest(
  raw: string | null,
  projectId: string,
  targetId: string,
): ScriptMergeRequest | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RecoveryError("recovery.merge.invalid");
  }
  const request = checkScriptMerge(parsed);
  if (request.projectId !== projectId || request.targetId !== targetId)
    throw new RecoveryError("recovery.merge.foreign");
  return request;
}

/**
 * Freeze a script merge under a fresh idempotency key.
 * @param projectId - the project.
 * @param targetId - the script.
 * @param workflowId - the draft being merged.
 * @param input - the author's choices over the comparison.
 */
export function freezeScriptMergeRequest(
  projectId: string,
  targetId: string,
  workflowId: string,
  input: CreationRebaseRequest,
): ScriptMergeRequest {
  return checkScriptMerge({
    format: "script-merge-request-v1",
    projectId,
    targetId,
    workflowId,
    key: crypto.randomUUID(),
    input,
  });
}

/**
 * Forget a kept merge, only if storage still holds exactly it.
 * @param storage - where it is kept.
 * @param request - the merge.
 * @returns whether it was the one kept.
 */
export function clearExactScriptMergeRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  request: ScriptMergeRequest,
): boolean {
  const key = scriptMergeStorageKey(request.projectId, request.targetId);
  if (storage.getItem(key) !== JSON.stringify(request)) return false;
  storage.removeItem(key);
  return true;
}

/**
 * Send a kept merge again under its original key and check that the receipt
 * merges exactly that draft with exactly those choices.
 * @param automation - the `automation` Remote namespace.
 * @param request - the merge.
 * @throws RecoveryError when the receipt answers another merge.
 */
export async function resendScriptMerge(
  automation: AutomationRemote,
  request: ScriptMergeRequest,
): Promise<CreationWorkflow> {
  const receipt = await value<CreationWorkflow>(
    automation.creationRebase(
      request.workflowId,
      request.input,
      undefined,
      request.key,
    ),
  );
  const source = receipt.rebaseSource;
  const sourceInput = source
    ? (({ id: _id, ...input }) => input)(source)
    : undefined;
  if (
    receipt.input.operation !== "script-revision" ||
    receipt.input.projectId !== request.projectId ||
    receipt.input.targetId !== request.targetId ||
    receipt.input.baseVersion !== request.input.baseVersion ||
    receipt.sourceWorkflowId !== request.workflowId ||
    !source ||
    source.id !== request.workflowId ||
    !sameFrozenSnapshot(sourceInput, request.input)
  )
    throw new RecoveryError("recovery.merge.receipt");
  return receipt;
}

/**
 * Check that a script comparison belongs to this project, draft and script.
 * @param merge - the comparison.
 * @param projectId - the project.
 * @param workflowId - the draft.
 * @param targetId - the script.
 * @throws RecoveryError when it answers another one.
 */
export function readScriptMerge(
  merge: CreationMerge,
  projectId: string,
  workflowId: string,
  targetId: string,
): CreationMerge {
  if (
    merge.basis &&
    (merge.basis.projectId !== projectId ||
      merge.basis.workflowId !== workflowId ||
      merge.basis.target.scriptId !== targetId)
  )
    throw new RecoveryError("recovery.merge.foreignCompare");
  return merge;
}

/**
 * The blocks a merge keeps, by the author's choice or the comparison's.
 * @param merge - the comparison.
 * @param choices - the author's choices.
 */
export function selectedScriptMergeIds(
  merge: CreationMerge,
  choices: Record<string, "main" | "branch">,
): string[] {
  return merge.units
    .filter((unit) => {
      const choice = choices[unit.id] ?? unit.choice;
      return (
        (choice === "main" ? unit.currentPresent : unit.candidatePresent) !==
        false
      );
    })
    .map((unit) => unit.id);
}

/**
 * A starting order for the kept blocks: the given order, then any kept block
 * it lacks. Only a starting point; the author confirms the order apart.
 * @param order - the starting order.
 * @param selected - the kept blocks.
 */
export function completeScriptMergeOrder(
  order: readonly string[],
  selected: readonly string[],
): string[] {
  const wanted = new Set(selected);
  return [...new Set([...order.filter((id) => wanted.has(id)), ...selected])];
}

/**
 * Move one block a place up or down.
 * @param order - the order.
 * @param id - the block.
 * @param direction - up (-1) or down (1).
 */
export function moveScriptMergeBlock(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const next = [...order];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** A storyboard redo start sent but not yet confirmed by its receipt. */
export interface StoryboardRedoStartRequest {
  format: "storyboard-source-redo-start-v1";
  key: string;
  input: CreationInput;
}

/**
 * Where an episode's unconfirmed redo start is kept.
 * @param projectId - the project.
 * @param episodeId - the episode.
 */
export const storyboardRedoStartStorageKey = (
  projectId: string,
  episodeId: string,
) => `dramaip-source-redo-start:${projectId}:${episodeId}`;

function checkRedoStart(raw: unknown): StoryboardRedoStartRequest {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !["format", "key", "input"].includes(key)) ||
    raw.format !== "storyboard-source-redo-start-v1" ||
    !isUuid(raw.key) ||
    !isRecord(raw.input)
  )
    throw new RecoveryError("recovery.redo.invalid");
  const input = raw.input as Partial<CreationInput>;
  const request = input.episodeDevelopmentRequest;
  if (
    input.operation !== "storyboard-package" ||
    !isUuid(input.projectId) ||
    !request?.redoSourceReview ||
    !request.redoShots ||
    !request.baseStoryboardId
  )
    throw new RecoveryError("recovery.redo.invalid");
  return raw as unknown as StoryboardRedoStartRequest;
}

/**
 * Freeze a redo start under a fresh idempotency key.
 * @param input - the complete start input.
 */
export function freezeStoryboardRedoStartRequest(
  input: CreationInput,
): StoryboardRedoStartRequest {
  return checkRedoStart({
    format: "storyboard-source-redo-start-v1",
    key: crypto.randomUUID(),
    input,
  });
}

/**
 * The episode's unconfirmed redo start kept on this machine, if any.
 * @param raw - what storage holds.
 * @param projectId - the project it must belong to.
 * @param episodeId - the episode it must belong to.
 * @throws RecoveryError when it is damaged, too large or belongs elsewhere.
 */
export function parseStoryboardRedoStartRequest(
  raw: string | null,
  projectId: string,
  episodeId: string,
): StoryboardRedoStartRequest | undefined {
  if (raw === null) return undefined;
  if (raw.length > LIMIT) throw new RecoveryError("recovery.redo.tooLarge");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RecoveryError("recovery.redo.invalid");
  }
  const value = checkRedoStart(parsed);
  if (
    value.input.projectId !== projectId ||
    value.input.episodeDevelopmentRequest?.episodeId !== episodeId
  )
    throw new RecoveryError("recovery.redo.foreign");
  return value;
}

/**
 * Keep a redo start before it is sent; refuse to overwrite another.
 * @param storage - where it is kept.
 * @param request - the start.
 * @throws RecoveryError when another is kept, it is too large or unsaved.
 */
export function saveStoryboardRedoStartRequest(
  storage: Pick<Storage, "getItem" | "setItem">,
  request: StoryboardRedoStartRequest,
): void {
  const key = storyboardRedoStartStorageKey(
    request.input.projectId,
    request.input.episodeDevelopmentRequest!.episodeId,
  );
  const raw = JSON.stringify(checkRedoStart(request));
  if (raw.length > LIMIT || storage.getItem(key) !== null)
    throw new RecoveryError("recovery.redo.occupied");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new RecoveryError("recovery.redo.unsaved");
}

/**
 * Forget a kept redo start, only if storage still holds exactly it.
 * @param storage - where it is kept.
 * @param request - the start.
 * @returns whether it was the one kept.
 * @throws RecoveryError when it stays after removal.
 */
export function clearExactStoryboardRedoStartRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  request: StoryboardRedoStartRequest,
): boolean {
  const key = storyboardRedoStartStorageKey(
    request.input.projectId,
    request.input.episodeDevelopmentRequest!.episodeId,
  );
  if (storage.getItem(key) !== JSON.stringify(request)) return false;
  storage.removeItem(key);
  if (storage.getItem(key) !== null)
    throw new RecoveryError("recovery.redo.uncleared");
  return true;
}

/**
 * A value laid out in the member order of a template, so it serializes as
 * the owner serialized the template; members the template lacks follow.
 */
function orderedLike(item: unknown, template: unknown): unknown {
  if (Array.isArray(item))
    return item.map((entry, index) =>
      orderedLike(entry, Array.isArray(template) ? template[index] : undefined),
    );
  if (!isRecord(item)) return item;
  const shape = isRecord(template) ? Object.keys(template) : [];
  const keys = [
    ...shape.filter((key) => key in item),
    ...Object.keys(item).filter((key) => !shape.includes(key)),
  ];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      orderedLike(item[key], isRecord(template) ? template[key] : undefined),
    ]),
  );
}

/**
 * Send a kept redo start again under its original key and check the receipt:
 * its key, the hash of the original input and the input and source review it
 * actually froze. The resolved model is the owner's, so it is not compared.
 * @param automation - the `automation` Remote namespace.
 * @param request - the start.
 * @throws RecoveryError when it cannot be sent or the receipt answers another.
 */
export async function resendStoryboardRedoStart(
  automation: AutomationRemote,
  request: StoryboardRedoStartRequest,
): Promise<CreationWorkflow> {
  let original: StoryboardRedoStartRequest;
  try {
    original = checkRedoStart(request);
  } catch {
    throw new RecoveryError("recovery.redo.unchecked");
  }
  let receipt: CreationWorkflow;
  try {
    receipt = await value<CreationWorkflow>(
      automation.creationStart(original.input, undefined, original.key),
    );
  } catch {
    throw new RecoveryError("recovery.redo.sendFailed");
  }
  if (!isRecord(receipt) || !isRecord(receipt.input))
    throw new RecoveryError("recovery.redo.receiptInvalid");
  const requestHash = await sha256Hex(
    JSON.stringify({ input: orderedLike(original.input, receipt.input) }),
  );
  if (
    receipt.creationRequestReceipt?.key !== original.key ||
    receipt.creationRequestReceipt?.requestHash !== requestHash
  )
    throw new RecoveryError("recovery.redo.receiptKey");
  const { model: _resolvedModel, ...actualInput } = receipt.input;
  const { model: _requestedModel, ...originalInput } = original.input;
  if (
    !sameFrozenSnapshot(canonical(actualInput), canonical(originalInput)) ||
    !sameFrozenSnapshot(
      receipt.episodeDevelopmentBasis?.request,
      original.input.episodeDevelopmentRequest,
    ) ||
    !sameFrozenSnapshot(
      receipt.episodeDevelopmentBasis?.storyboardRedo?.sourceReview?.review,
      original.input.episodeDevelopmentRequest!.redoSourceReview,
    )
  )
    throw new RecoveryError("recovery.redo.receiptInput");
  return receipt;
}
