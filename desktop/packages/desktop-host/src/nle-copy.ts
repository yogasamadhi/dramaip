import {
  validManagedMediaReadInput,
  type HostManagedMediaReadInput,
} from "./index.js";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const sha = /^[a-f0-9]{64}$/u;
const documentNames = new Set([
  "timeline.fcpxml",
  "timeline.otio",
  "timeline.edl",
  "subtitles.srt",
  "subtitles.vtt",
  "relink.json",
  "timeline-manifest.json",
]);
const maximumFiles = 1000;
const maximumMediaBytes = 8 * 1024 * 1024 * 1024;
const maximumDocumentBytes = 16 * 1024 * 1024;
type Media = HostManagedMediaReadInput & {
  assetId: string;
  recordVersion: number;
  artifactId: string;
};
export type NleCopyInput = {
  projectId: string;
  episodeId: string;
  timelineId: string;
  timelineVersion: number;
  sourceFingerprint: string;
  media: readonly Media[];
  documents: readonly { relativePath: string; content: string }[];
};
type ReceiptFile = {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  kind: "media" | "document";
  source?: { assetId: string; recordVersion: number; artifactId: string };
};
export type NleCopyReceipt = {
  format: "dramaip-nle-media-copy-receipt";
  schemaVersion: 1;
  packageRef: string;
  projectId: string;
  episodeId: string;
  timelineId: string;
  timelineVersion: number;
  sourceFingerprint: string;
  verifiedAt: string;
  evidence: "complete-copy-and-destination-re-read-at-recorded-time";
  qualityState: "unverified";
  rightsState: "unverified";
  billingState: "unknown";
  files: readonly ReceiptFile[];
};
const exact = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const identity = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const version = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export function validNleCopyInput(value: unknown): value is NleCopyInput {
  if (
    !exact(value, [
      "projectId",
      "episodeId",
      "timelineId",
      "timelineVersion",
      "sourceFingerprint",
      "media",
      "documents",
    ]) ||
    !identity(value.projectId) ||
    !identity(value.episodeId) ||
    !identity(value.timelineId) ||
    !version(value.timelineVersion) ||
    typeof value.sourceFingerprint !== "string" ||
    !sha.test(value.sourceFingerprint) ||
    !Array.isArray(value.media) ||
    value.media.length === 0 ||
    value.media.length > maximumFiles ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    value.documents.length > documentNames.size
  )
    return false;
  let totalBytes = 0;
  const assets = new Set<string>();
  for (const item of value.media) {
    if (
      !exact(item, [
        "assetId",
        "recordVersion",
        "artifactId",
        "mediaRef",
        "sha256",
        "sizeBytes",
        "mimeType",
      ]) ||
      !identity(item.assetId) ||
      !identity(item.artifactId) ||
      !version(item.recordVersion) ||
      !identity(item.mediaRef) ||
      typeof item.sha256 !== "string" ||
      typeof item.sizeBytes !== "number" ||
      typeof item.mimeType !== "string" ||
      !validManagedMediaReadInput({
        mediaRef: item.mediaRef,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        mimeType: item.mimeType,
      }) ||
      assets.has(item.assetId)
    )
      return false;
    assets.add(item.assetId);
    totalBytes += Number(item.sizeBytes);
    if (totalBytes > maximumMediaBytes) return false;
  }
  let documentBytes = 0;
  const documents = new Set<string>();
  for (const item of value.documents) {
    if (
      !exact(item, ["relativePath", "content"]) ||
      typeof item.relativePath !== "string" ||
      !documentNames.has(item.relativePath) ||
      documents.has(item.relativePath) ||
      typeof item.content !== "string"
    )
      return false;
    documents.add(item.relativePath);
    documentBytes += Buffer.byteLength(item.content, "utf8");
    if (documentBytes > maximumDocumentBytes) return false;
  }
  return true;
}

type Scope = Pick<
  NleCopyInput,
  | "projectId"
  | "episodeId"
  | "timelineId"
  | "timelineVersion"
  | "sourceFingerprint"
>;
export type NleCopyJob = {
  id: string;
  version: number;
  status:
    "queued" | "running" | "completed" | "failed" | "canceled" | "interrupted";
  requestSha256: string;
  scope: Scope;
  createdAt: string;
  updatedAt: string;
  copy?: {
    /** Absent on legacy observations; never invent a recoverable output capability. */
    artifactRef?: string;
    receipt: NleCopyReceipt;
    receiptSha256: string;
    receiptBytes: number;
  };
  failureCode?:
    | "COPY_ABORTED"
    | "COPY_INTERRUPTED"
    | "COPY_FAILED"
    | "COPY_JOURNAL_UNAVAILABLE";
  scratchState?: "not-created" | "cleaned" | "retained-unpublished";
};

export class NleCopyJobError extends Error {
  readonly name = "NleCopyJobError";
  constructor(
    readonly code:
      | "INVALID_COPY_REQUEST"
      | "COPY_REQUEST_CONFLICT"
      | "COPY_BUSY"
      | "COPY_GRANT_UNAVAILABLE"
      | "COPY_JOURNAL_UNAVAILABLE",
  ) {
    super("原媒体复制请求不可核对或暂不可执行；不自动换源、换授权或重试。");
  }
}

export interface HostWriteDirectoryGrant {
  grantId: string;
  permission: "write-directory";
  displayName: string;
  expiresAt: string;
  generation: number;
}
