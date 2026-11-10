import type { AuthorIntentsPreviewInput } from "@dramaip/workspace-workspace/types";

/** The eight author intent fields, in the order the editor shows them. */
export const INTENT_FIELDS = [
  "themeStatement",
  "emotionalPromise",
  "targetAudience",
  "mustKeep",
  "mayChange",
  "mustAvoid",
  "endingContract",
  "toneAndVoice",
] as const satisfies readonly (keyof AuthorIntentContent)[];

/** The fields edited one constraint per line. */
export const LIST_FIELDS: ReadonlySet<IntentField> = new Set([
  "mustKeep",
  "mayChange",
  "mustAvoid",
]);

export type AuthorIntentContent = AuthorIntentsPreviewInput["content"];
export type IntentField = (typeof INTENT_FIELDS)[number];
export type AuthorIntentEditFields = Record<IntentField, string>;

/** What the local editor keeps per project: the text and its frozen basis. */
export interface AuthorIntentEdit {
  fields: AuthorIntentEditFields;
  basisVersion: number;
  baseAdoptedId?: string | undefined;
  sourceKind: "manual" | "legacy-project";
}

interface DraftRecord extends AuthorIntentEdit {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
}

/** Why a local draft could not be read, saved or cleared. */
export type DraftError = "restore" | "unavailable" | "conflict";

export type AuthorIntentDraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export type AuthorIntentDraftStore = () => AuthorIntentDraftStorage;

const key = (projectId: string) => `dramaip-author-intent-edit:v1:${projectId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "basisVersion",
  "baseAdoptedId",
  "sourceKind",
  "fields",
  "updatedAt",
]);
const MAX_FIELD = 40_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored record exactly as this version writes it, or undefined. */
function parseRecord(value: unknown): DraftRecord | undefined {
  if (!isObject(value)) return undefined;
  if (Object.keys(value).some((name) => !RECORD_KEYS.has(name))) return;
  const { schemaVersion, projectId, basisVersion, baseAdoptedId } = value;
  const { sourceKind, fields, updatedAt } = value;
  if (schemaVersion !== 1) return;
  if (typeof projectId !== "string" || !UUID.test(projectId)) return;
  if (!Number.isInteger(basisVersion) || (basisVersion as number) < 0) return;
  if (
    baseAdoptedId !== undefined &&
    (typeof baseAdoptedId !== "string" || !UUID.test(baseAdoptedId))
  )
    return;
  if (sourceKind !== "manual" && sourceKind !== "legacy-project") return;
  if (
    typeof updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(updatedAt) ||
    Number.isNaN(Date.parse(updatedAt))
  )
    return;
  if (
    !isObject(fields) ||
    Object.keys(fields).length !== INTENT_FIELDS.length ||
    INTENT_FIELDS.some(
      (name) =>
        typeof fields[name] !== "string" ||
        (fields[name] as string).length > MAX_FIELD,
    )
  )
    return;
  return value as unknown as DraftRecord;
}

/** An empty editor frozen to a project version. */
export function emptyAuthorIntentEdit(basisVersion: number): AuthorIntentEdit {
  return {
    basisVersion,
    sourceKind: "manual",
    fields: Object.fromEntries(
      INTENT_FIELDS.map((name) => [name, ""]),
    ) as AuthorIntentEditFields,
  };
}

/**
 * The local draft of a project. A record this version cannot read is kept
 * as it is, never removed, overwritten or shown.
 */
export function readAuthorIntentDraft(
  projectId: string,
  store: AuthorIntentDraftStore,
): { raw: string | null; record?: AuthorIntentEdit; error?: DraftError } {
  let raw: string | null = null;
  try {
    raw = store().getItem(key(projectId));
    if (raw === null) return { raw };
    const record = parseRecord(JSON.parse(raw));
    if (!record || record.projectId !== projectId)
      return { raw, error: "restore" };
    const { fields, basisVersion, baseAdoptedId, sourceKind } = record;
    return {
      raw,
      record: {
        fields,
        basisVersion,
        sourceKind,
        ...(baseAdoptedId === undefined ? {} : { baseAdoptedId }),
      },
    };
  } catch {
    return { raw, error: "restore" };
  }
}

/** Save the editor unless another window changed the stored draft. */
export function saveAuthorIntentDraft(
  projectId: string,
  edit: AuthorIntentEdit,
  expectedRaw: string | null,
  store: AuthorIntentDraftStore,
): { raw?: string; error?: DraftError } {
  try {
    const storage = store();
    if (storage.getItem(key(projectId)) !== expectedRaw)
      return { error: "conflict" };
    const record = parseRecord({
      schemaVersion: 1,
      projectId,
      basisVersion: edit.basisVersion,
      ...(edit.baseAdoptedId === undefined
        ? {}
        : { baseAdoptedId: edit.baseAdoptedId }),
      sourceKind: edit.sourceKind,
      fields: edit.fields,
      updatedAt: new Date().toISOString(),
    });
    if (!record) return { error: "unavailable" };
    const raw = JSON.stringify(record);
    storage.setItem(key(projectId), raw);
    return { raw };
  } catch {
    return { error: "unavailable" };
  }
}

/** Clear the stored draft unless another window changed it. */
export function clearAuthorIntentDraft(
  projectId: string,
  expectedRaw: string | null,
  store: AuthorIntentDraftStore,
): { cleared: boolean; error?: DraftError } {
  try {
    const storage = store();
    if (storage.getItem(key(projectId)) !== expectedRaw)
      return { cleared: false, error: "conflict" };
    storage.removeItem(key(projectId));
    return { cleared: true };
  } catch {
    return { cleared: false, error: "unavailable" };
  }
}

/**
 * The content the editor's text makes, one constraint per line, or
 * undefined when a required field is empty or a length limit is passed.
 */
export function intentContent(
  fields: AuthorIntentEditFields,
): AuthorIntentContent | undefined {
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const required = (text: string) => {
    const trimmed = text.trim();
    return trimmed.length >= 1 && trimmed.length <= 4_000 ? trimmed : undefined;
  };
  const list = (text: string) => {
    const items = lines(text);
    return items.length <= 100 && items.every((item) => item.length <= 1_000)
      ? items
      : undefined;
  };
  const content = {
    themeStatement: required(fields.themeStatement),
    emotionalPromise: required(fields.emotionalPromise),
    targetAudience: required(fields.targetAudience),
    mustKeep: list(fields.mustKeep),
    mayChange: list(fields.mayChange),
    mustAvoid: list(fields.mustAvoid),
    endingContract:
      fields.endingContract.trim().length <= 4_000
        ? fields.endingContract.trim()
        : undefined,
    toneAndVoice: required(fields.toneAndVoice),
  };
  return Object.values(content).every((item) => item !== undefined)
    ? (content as AuthorIntentContent)
    : undefined;
}
