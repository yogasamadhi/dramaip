import type {
  SourceImportsCommitInput,
  SourceImportsGetCommitResult,
} from "@dramaip/workspace-workspace/types";

/** The preview a source import commits. */
export type SourceImportPreview = SourceImportsCommitInput["preview"];

/**
 * One import the author confirmed: its preview, the input it sends and the
 * replay key it sends it under, kept on this machine until the import is
 * verified so an unknown answer is recovered with the same key and input.
 */
export interface SourceImportAttempt {
  schemaVersion: 1;
  importId: string;
  requestKey: string;
  input: SourceImportsCommitInput;
}

/** Why an attempt or a preview was refused; the message names the rule. */
export type SourceImportRefusal = "foreign" | "invalid" | "mismatch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_KEYS = ["importId", "input", "requestKey", "schemaVersion"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a stored value is a whole attempt: the exact keys, ids, an
 * appended import whose rights were declared, and a preview with its rows.
 */
export function isSourceImportAttempt(
  value: unknown,
): value is SourceImportAttempt {
  if (!isObject(value)) return false;
  if (Object.keys(value).sort().join() !== ATTEMPT_KEYS.join()) return false;
  const { input } = value;
  if (
    value.schemaVersion !== 1 ||
    typeof value.importId !== "string" ||
    !UUID.test(value.importId) ||
    typeof value.requestKey !== "string" ||
    !UUID.test(value.requestKey) ||
    !isObject(input) ||
    typeof input.projectId !== "string" ||
    input.strategy !== "append" ||
    input.rightsConfirmed !== true ||
    input.destructiveConfirmed !== false
  )
    return false;
  const preview = input.preview;
  return (
    isObject(preview) &&
    typeof preview.fileName === "string" &&
    typeof preview.title === "string" &&
    Array.isArray(preview.chapters) &&
    Array.isArray(preview.episodes) &&
    Array.isArray(preview.warnings)
  );
}

/** Whether every row of an editable preview is one its owner accepts. */
function ownerAccepts(preview: SourceImportPreview): boolean {
  const unique = (keys: readonly string[]) =>
    new Set(keys).size === keys.length;
  const sized = (count: number) => count >= 1 && count <= 2000;
  const named = (title: string, max: number) => {
    const trimmed = title.trim();
    return trimmed.length >= 1 && trimmed.length <= max;
  };
  const keyed = (key: string) => key.length >= 1 && key.length <= 500;
  if (preview.contentKind === "script")
    return (
      named(preview.title, 200) &&
      sized(preview.episodes.length) &&
      unique(preview.episodes.map((episode) => episode.key)) &&
      preview.episodes.every(
        (episode) =>
          keyed(episode.key) &&
          Number.isInteger(episode.episodeNumber) &&
          episode.episodeNumber > 0 &&
          named(episode.title, 230) &&
          episode.scenes.length <= 2000 &&
          episode.scenes.every(
            (scene) =>
              typeof scene.title !== "string" ||
              scene.title.trim().length <= 240,
          ),
      )
    );
  return (
    sized(preview.chapters.length) &&
    unique(preview.chapters.map((chapter) => chapter.key)) &&
    preview.chapters.every(
      (chapter) => keyed(chapter.key) && named(chapter.title, 160),
    )
  );
}

/**
 * Freeze the import the author confirmed: the original attempt unchanged
 * when there is one, else a new one under a new replay key.
 * @throws `foreign` for a broken or another import's original; `invalid`
 *   for a preview its owner refuses or rights not declared, before any key
 *   is allocated.
 */
export function freezeSourceImportAttempt(
  importId: string,
  input: SourceImportsCommitInput,
  original?: SourceImportAttempt,
): SourceImportAttempt {
  if (original) {
    if (
      !isSourceImportAttempt(original) ||
      original.importId !== importId ||
      original.input.projectId !== input.projectId
    )
      throw new SourceImportError("foreign");
    return structuredClone(original);
  }
  const attempt: SourceImportAttempt = {
    schemaVersion: 1,
    importId,
    requestKey: crypto.randomUUID(),
    input,
  };
  if (!ownerAccepts(input.preview) || !isSourceImportAttempt(attempt))
    throw new SourceImportError("invalid");
  return structuredClone(attempt);
}

/** Canonical JSON of a request: keys sorted, undefined members dropped. */
export function canonicalRequestJSON(value: unknown): string {
  const normalize = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(normalize)
      : isObject(entry)
        ? Object.fromEntries(
            Object.entries(entry)
              .filter(([, child]) => child !== undefined)
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              .map(([key, child]) => [key, normalize(child)]),
          )
        : entry;
  return JSON.stringify(normalize(value));
}

/**
 * Check that a commit record the server holds is the frozen attempt's own:
 * the same import, project and canonical input.
 * @throws `mismatch` otherwise.
 */
export function checkSourceImportRecovery(
  attempt: SourceImportAttempt,
  recovery: SourceImportsGetCommitResult,
): void {
  if (
    recovery.importId !== attempt.importId ||
    recovery.projectId !== attempt.input.projectId ||
    canonicalRequestJSON(recovery.input) !== canonicalRequestJSON(attempt.input)
  )
    throw new SourceImportError("mismatch");
}

/** A refused attempt; the tool shows the refusal's copy. */
export class SourceImportError extends Error {
  readonly refusal: SourceImportRefusal;
  constructor(refusal: SourceImportRefusal) {
    super(refusal);
    this.name = "SourceImportError";
    this.refusal = refusal;
  }
}

const storageKey = (projectId: string) =>
  `dramaip-source-import-attempt:${projectId}`;

/**
 * The attempt this machine keeps for a project, as stored: a broken one is
 * kept rather than dropped, so the tool refuses it instead of replacing it.
 * @returns `undefined` with none stored, `null` for an unreadable one.
 */
export function readSourceImportAttempt(
  projectId: string,
): unknown | null | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(projectId));
    if (raw === null || raw === undefined) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Keep an attempt on this machine; a broken one is refused. */
export function persistSourceImportAttempt(attempt: SourceImportAttempt): void {
  if (!isSourceImportAttempt(attempt)) throw new SourceImportError("invalid");
  globalThis.localStorage?.setItem(
    storageKey(attempt.input.projectId),
    JSON.stringify(attempt),
  );
}

/** Forget the attempt of a project once its import is verified. */
export function clearSourceImportAttempt(projectId: string): void {
  globalThis.localStorage?.removeItem(storageKey(projectId));
}
