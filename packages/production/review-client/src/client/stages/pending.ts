/**
 * The original write requests a stage keeps on this machine until their
 * outcome is known. A record is read back only when every field has its
 * exact shape and it belongs to the scope that reads it; anything else is
 * invalid and blocks new writes until the author checks it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === "string" && UUID.test(value);
const sha = (value: unknown) => typeof value === "string" && SHA.test(value);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Exactly these keys, each passing its check. */
const exact = (
  value: unknown,
  checks: Record<string, (field: unknown) => boolean>,
): value is Record<string, unknown> =>
  isObject(value) &&
  Object.keys(value).length === Object.keys(checks).length &&
  Object.entries(checks).every(
    ([key, check]) => Object.hasOwn(value, key) && check(value[key]),
  );

/** The input of an original adoption of a creative variant. */
export interface PlatformAdoptInput {
  projectId: string;
  adaptationId: string;
  projectVersion: number;
  adaptationVersion: number;
  variantVersion: number;
  contentFingerprint: string;
  expectedHeadRevision: number;
}

/** The input of an original archive of a passed preflight. */
export interface PlatformArchiveInput {
  projectId: string;
  profileId: string;
  creativeVariantId: string;
  manualFieldsConfirmed: boolean;
  sourceFingerprint: string;
}

interface PlatformPendingScope {
  key: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  aggregateId: string;
}

/** One original platform delivery write whose outcome is not known yet. */
export type PlatformPending = PlatformPendingScope &
  (
    | { operation: "adopt"; input: PlatformAdoptInput }
    | { operation: "archive"; input: PlatformArchiveInput }
  );

/** Where the platform stage keeps the original request of one scope. */
export const platformPendingKey = (
  projectId: string,
  adaptationId: string,
  episodeId: string,
) => `dramaip:platform-metadata:${projectId}:${adaptationId}:${episodeId}`;

const adoptChecks = {
  projectId: uuid,
  adaptationId: uuid,
  projectVersion: count,
  adaptationVersion: count,
  variantVersion: count,
  contentFingerprint: sha,
  expectedHeadRevision: count,
};

const archiveChecks = {
  projectId: uuid,
  profileId: uuid,
  creativeVariantId: uuid,
  manualFieldsConfirmed: (value: unknown) => typeof value === "boolean",
  sourceFingerprint: sha,
};

/**
 * Validate one stored platform request against the scope reading it.
 * @throws when the record is malformed or belongs to another scope.
 */
export function parsePlatformPending(
  value: unknown,
  scope: { projectId: string; adaptationId: string; episodeId: string },
): PlatformPending {
  const operation = isObject(value) ? value["operation"] : undefined;
  const input =
    operation === "adopt"
      ? adoptChecks
      : operation === "archive"
        ? archiveChecks
        : undefined;
  if (
    !input ||
    !exact(value, {
      operation: () => true,
      key: uuid,
      projectId: uuid,
      adaptationId: uuid,
      episodeId: uuid,
      aggregateId: uuid,
      input: (field) => exact(field, input),
    })
  )
    throw new Error("Pending record malformed");
  const pending = value as unknown as PlatformPending;
  if (
    pending.input.projectId !== pending.projectId ||
    (pending.operation === "adopt"
      ? pending.input.adaptationId !== pending.adaptationId
      : pending.aggregateId !== pending.episodeId) ||
    pending.projectId !== scope.projectId ||
    pending.adaptationId !== scope.adaptationId ||
    pending.episodeId !== scope.episodeId
  )
    throw new Error("Pending scope mismatch");
  return pending;
}

/** One original whole-package media review request whose outcome is not known yet. */
export interface MediaPending {
  requestKey: string;
  episodeId: string;
  input: { projectId: string; sourceFingerprint: string };
}

/** Where the media review keeps the original request of one episode. */
export const mediaPendingKey = (projectId: string, episodeId: string) =>
  `dramaip:media-review:${projectId}:${episodeId}`;

/**
 * Validate one stored media review request against the episode reading it.
 * @throws when the record is malformed or belongs to another scope.
 */
export function parseMediaPending(
  value: unknown,
  scope: { projectId: string; episodeId: string },
): MediaPending {
  if (
    !exact(value, {
      requestKey: uuid,
      episodeId: uuid,
      input: (field) =>
        exact(field, { projectId: uuid, sourceFingerprint: sha }),
    })
  )
    throw new Error("Pending record malformed");
  const pending = value as unknown as MediaPending;
  if (
    pending.episodeId !== scope.episodeId ||
    pending.input.projectId !== scope.projectId
  )
    throw new Error("Pending scope mismatch");
  return pending;
}

/**
 * The machine-local store of original requests. Storage that refuses a
 * write is reported to the caller; a missing store reads as empty.
 */
export const pendingStore = {
  read(key: string): unknown {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  },
  write(key: string, value: unknown | undefined): void {
    if (value === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  },
};
