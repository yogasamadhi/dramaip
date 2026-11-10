import {
  validTimelineRenderAudioPlan,
  type HostTimelineRenderAudioPlan,
} from "./timeline-audio.js";
export { validTimelineRenderAudioPlan } from "./timeline-audio.js";
export type {
  HostTimelineRenderAudioPlan,
  HostTimelineRenderAudioClip,
} from "./timeline-audio.js";
import {
  validTimelineRenderSubtitlePlan,
  type HostTimelineRenderSubtitlePlan,
  type HostRendererFontDescriptor,
} from "./timeline-subtitles.js";
export {
  validTimelineRenderSubtitlePlan,
  validRendererFontRef,
  HOST_MAX_RENDER_SUBTITLE_CUES,
} from "./timeline-subtitles.js";
export type {
  HostTimelineRenderSubtitlePlan,
  HostTimelineRenderSubtitleCue,
  HostRendererFontRef,
  HostRendererFontDescriptor,
} from "./timeline-subtitles.js";
import type {
  NleCopyInput,
  NleCopyJob,
  HostWriteDirectoryGrant,
} from "./nle-copy.js";
export { NleCopyJobError, validNleCopyInput } from "./nle-copy.js";
export type {
  NleCopyInput,
  NleCopyReceipt,
  NleCopyJob,
  HostWriteDirectoryGrant,
} from "./nle-copy.js";
import type {
  AgentEngineDescriptor,
  AgentEngineKind,
  JsonValue,
  LocalModelDescriptor,
  LocalModelRuntime,
  LocalModelRuntimeKind,
} from "@dramaip/contracts";
import {
  AgentRuntimeError,
  normalizeAgentUsage,
  type AgentUsage,
  type AgentRunRef,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeHealth,
  type AgentSessionInput,
  type AgentSessionRef,
} from "@dramaip/agent-runtime";

export interface AgentProviderActivationInput {
  /** Native Pi provider id; custom endpoints leave this unset. */
  piProviderId?: string;
  providerId: string;
  runtimeProviderId: string;
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  authentication: "apiKey" | "none";
  localRuntimeKind?: LocalModelRuntimeKind;
  credentialRef?: string;
  environmentName?:
    "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
}

export interface AgentProviderActivationResult {
  available: boolean;
  message?: string;
}

export interface ProviderHttpRequest {
  credentialRef: string;
  url: string;
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  accept?: "json" | "binary";
  maximumBytes?: number;
  timeoutMs?: number;
  /** Opaque Host media references only; Runtime never receives source bytes. */
  mediaRefs?: readonly string[];
}

export interface ProviderHttpResponse {
  status: number;
  contentType: string;
  json?: unknown;
  base64?: string;
}

export interface HostArchiveRemoteMediaInput {
  credentialRef?: string;
  url: string;
  kind: "video";
  maximumBytes?: number;
  expectedSha256?: string;
}

/** Additive receipt fields: legacy Host implementations remain readable,
 * but a formal Delivery export requires every verified receipt field. */
export interface HostTextFileSaveResult {
  saved: boolean;
  artifactRef?: string;
  sha256?: string;
  byteSize?: number;
  savedAt?: string;
}

export interface HostArchivedMedia {
  mediaRef: string;
  kind: "video";
  mimeType: "video/mp4";
  extension: ".mp4";
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  durationFrames: number;
  frameRate: {
    numerator: number;
    denominator: number;
    dropFrame: boolean;
  };
  status: "archived";
}

export interface HostManagedMediaReadInput {
  mediaRef: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}
export class HostManagedMediaReadError extends Error {
  constructor(
    readonly status: 404 | 409 | 413 | 415 | 503,
    readonly code: string,
  ) {
    super("Managed media could not be read safely");
  }
}
export const HOST_MANAGED_MEDIA_EXTENSIONS: Readonly<Record<string, string>> =
  Object.freeze({
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  });
export function validManagedMediaReadInput(
  value: HostManagedMediaReadInput,
): boolean {
  return (
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      value.mediaRef,
    ) &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= 2 * 1024 * 1024 * 1024 &&
    Object.hasOwn(HOST_MANAGED_MEDIA_EXTENSIONS, value.mimeType)
  );
}

export interface HostTimelineRenderInput {
  /** Absence preserves the explicit legacy silent P0 policy; never infer a mix. */
  audioPlan?: HostTimelineRenderAudioPlan;
  /** Absence preserves the historical no-burn policy; an explicit policy is never inferred. */
  subtitlePlan?: HostTimelineRenderSubtitlePlan;
  jobId: string;
  timelineId: string;
  durationFrames: number;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  clips: readonly {
    mediaRef: string;
    sha256: string;
    sizeBytes: number;
    mimeType: "video/mp4";
    startFrame: number;
    durationFrames: number;
    sourceOffsetFrame: number;
  }[];
}

export interface HostTimelineRenderJob {
  jobId: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progress: number;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  output?: HostArchivedMedia;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

/** Host-side shape check; paths, extra keys and unbound file metadata are never accepted. */
export function validTimelineRenderInput(
  input: HostTimelineRenderInput,
): boolean {
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  const nonnegative = (value: number) =>
    Number.isSafeInteger(value) && value >= 0;
  return Boolean(
    input &&
    uuid.test(input.jobId) &&
    uuid.test(input.timelineId) &&
    positive(input.durationFrames) &&
    input.profile &&
    positive(input.profile.width) &&
    positive(input.profile.height) &&
    positive(input.profile.audioSampleRate) &&
    positive(input.profile.channels) &&
    input.profile.frameRate &&
    positive(input.profile.frameRate.numerator) &&
    positive(input.profile.frameRate.denominator) &&
    typeof input.profile.frameRate.dropFrame === "boolean" &&
    Array.isArray(input.clips) &&
    input.clips.length > 0 &&
    input.clips.length <= 10_000 &&
    input.clips.every(
      (clip) =>
        clip &&
        Object.keys(clip).length === 7 &&
        clip.mimeType === "video/mp4" &&
        validManagedMediaReadInput(clip) &&
        nonnegative(clip.startFrame) &&
        positive(clip.durationFrames) &&
        nonnegative(clip.sourceOffsetFrame) &&
        Number.isSafeInteger(clip.startFrame + clip.durationFrames) &&
        Number.isSafeInteger(clip.sourceOffsetFrame + clip.durationFrames) &&
        clip.startFrame + clip.durationFrames <= input.durationFrames,
    ) &&
    (!Object.hasOwn(input, "audioPlan") ||
      validTimelineRenderAudioPlan(
        input.audioPlan,
        input.durationFrames,
        input.clips,
      )) &&
    (!Object.hasOwn(input, "subtitlePlan") ||
      (Object.hasOwn(input, "audioPlan") &&
        validTimelineRenderSubtitlePlan(
          input.subtitlePlan,
          input.durationFrames,
        ))),
  );
}

export interface CredentialStorageStatus {
  available: boolean;
  storage: "local_file" | "os_safe_storage" | "master_password" | "unavailable";
  backend: string;
  locked: boolean;
  migrationState: "none" | "migrating" | "complete" | "failed";
  message?: string;
}

type HostFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const LOCAL_MODEL_ENDPOINTS: Record<
  LocalModelRuntimeKind,
  { root: string; endpointRef: string }
> = {
  ollama: {
    root: "http://127.0.0.1:11434",
    endpointRef: "local-model-runtime:ollama",
  },
  lm_studio: {
    root: "http://127.0.0.1:1234",
    endpointRef: "local-model-runtime:lm-studio",
  },
};

async function localJson(
  request: HostFetch,
  url: string,
): Promise<{ response: Response; value: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await request(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("local runtime redirects are forbidden");
    if (!response.ok)
      throw new Error(`local runtime returned ${response.status}`);
    const content = await response.text();
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024)
      throw new Error("local runtime response exceeds 2 MiB");
    return { response, value: JSON.parse(content) };
  } finally {
    clearTimeout(timer);
  }
}

function ollamaModels(value: unknown): LocalModelDescriptor[] {
  if (!value || typeof value !== "object") return [];
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const id = typeof item.name === "string" ? item.name : item.model;
    if (typeof id !== "string" || !id.trim()) return [];
    return [
      {
        id,
        displayName: id,
        ...(typeof item.size === "number" && item.size >= 0
          ? { sizeBytes: Math.floor(item.size) }
          : {}),
        ...(typeof item.digest === "string" ? { digest: item.digest } : {}),
      },
    ];
  });
}

function lmStudioModels(value: unknown): LocalModelDescriptor[] {
  if (!value || typeof value !== "object") return [];
  const source = value as { data?: unknown; models?: unknown };
  const models = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : [];
  return models.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const id = item.id ?? item.key ?? item.model;
    if (typeof id !== "string" || !id.trim()) return [];
    const displayName =
      typeof item.display_name === "string"
        ? item.display_name
        : typeof item.name === "string"
          ? item.name
          : id;
    return [{ id, displayName }];
  });
}

export async function discoverLocalModelRuntime(
  kind: LocalModelRuntimeKind,
  active = false,
  request: HostFetch = fetch,
): Promise<LocalModelRuntime> {
  const endpoint = LOCAL_MODEL_ENDPOINTS[kind];
  const checkedAt = new Date().toISOString();
  try {
    if (kind === "ollama") {
      const tags = await localJson(request, `${endpoint.root}/api/tags`);
      let version: string | undefined;
      try {
        const versionResponse = await localJson(
          request,
          `${endpoint.root}/api/version`,
        );
        const raw = versionResponse.value as { version?: unknown };
        if (typeof raw.version === "string") version = raw.version;
      } catch {
        // Model discovery is authoritative; version reporting is optional.
      }
      return {
        kind,
        endpointRef: endpoint.endpointRef,
        state: active ? "active" : "inactive",
        ...(version ? { version } : {}),
        models: ollamaModels(tags.value),
        lastHealthAt: checkedAt,
      };
    }
    let response: { response: Response; value: unknown };
    try {
      response = await localJson(request, `${endpoint.root}/api/v0/models`);
    } catch {
      response = await localJson(request, `${endpoint.root}/v1/models`);
    }
    return {
      kind,
      endpointRef: endpoint.endpointRef,
      state: active ? "active" : "inactive",
      models: lmStudioModels(response.value),
      lastHealthAt: checkedAt,
    };
  } catch {
    return {
      kind,
      endpointRef: endpoint.endpointRef,
      state: "unavailable",
      models: [],
      lastHealthAt: checkedAt,
      limitation: "固定 loopback 端点当前不可达或返回了不安全响应。",
    };
  }
}

export interface HostGrantedDocument {
  name: string;
  format:
    "txt" | "markdown" | "docx" | "epub" | "script-json" | "fountain" | "fdx";
  content: string;
  size: number;
}

export interface PublicWebPageResponse {
  title: string;
  url: string;
  content: string;
  contentType: string;
  retrievedAt: string;
  truncated: boolean;
}

export interface CredentialCaptureRequest {
  purpose: string;
  label?: string;
  policyId?: string;
  allowedOrigin?: string;
}

export interface CredentialCaptureResult {
  captureSessionId: string;
  status: "pending" | "completed" | "canceled" | "expired";
  credentialRef?: string;
  expiresAt: string;
}

/**
 * A vendor-neutral, transient engine event.  The Desktop Host is the only
 * process that sees vendor transports; Core Runtime receives this narrow
 * serializable projection over its private Host HTTP connection.
 */
export type HostEngineStreamEvent =
  | { type: "activity"; activity: "thinking" }
  | { type: "content.delta"; delta: string }
  | {
      type: "tool";
      status: "started" | "completed" | "failed";
      tool: string;
      itemId?: string;
      detail?: JsonValue;
    }
  | ({ type: "usage" } & AgentUsage)
  | { type: "result"; result: unknown }
  | { type: "error"; message: string };

/**
 * The local capabilities the Desktop Host offers business plugins: files,
 * media, rendering, engines, credentials and public web access. The Host's
 * capability service implements it in process.
 */
export interface DesktopHost {
  readManagedMedia(
    input: HostManagedMediaReadInput,
    signal: AbortSignal,
  ): Promise<Response>;
  health(): Promise<{
    healthy: boolean;
    capabilities: readonly HostCapabilityDescriptor[];
  }>;
  engineHealth(engine: AgentEngineKind): Promise<unknown>;
  pickFiles(options?: {
    multiple?: boolean;
    extensions?: readonly string[];
  }): Promise<readonly HostFileGrant[] | null>;
  pickDirectory(): Promise<HostFileGrant | null>;
  pickNleCopyDirectory(
    signal?: AbortSignal,
  ): Promise<HostWriteDirectoryGrant | null>;
  startNleMediaCopy(
    id: string,
    input: NleCopyInput,
    writeGrantRef: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob>;
  getNleMediaCopy(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob>;
  cancelNleMediaCopy(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob>;
  revealNleMediaCopy(
    id: string,
    projectId: string,
    artifactRef: string,
    signal?: AbortSignal,
  ): Promise<void>;
  readGrantedText(
    grantId: string,
    maximumBytes?: number,
  ): Promise<{ name: string; content: string; size: number }>;
  readGrantedDocument(
    grantId: string,
    maximumBytes?: number,
  ): Promise<HostGrantedDocument>;
  importPortraitMedia(grantId: string): Promise<HostManagedMedia>;
  archiveRemoteMedia(
    input: HostArchiveRemoteMediaInput,
  ): Promise<HostArchivedMedia>;
  startTimelineRender(
    input: HostTimelineRenderInput,
  ): Promise<HostTimelineRenderJob>;
  getTimelineRender(jobId: string): Promise<HostTimelineRenderJob>;
  cancelTimelineRender(jobId: string): Promise<HostTimelineRenderJob>;
  removeManagedMedia(mediaRef: string): Promise<void>;
  readWebPage(input: {
    url: string;
    maxCharacters: number;
  }): Promise<PublicWebPageResponse>;
  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<HostTextFileSaveResult>;
  saveBinaryFile(input: {
    suggestedName: string;
    contentBase64: string;
    mimeType: "application/zip";
  }): Promise<HostTextFileSaveResult>;
  openExternal(url: string): Promise<void>;
  revealGrant(grantId: string): Promise<void>;
  revealArtifact(artifactRef: string): Promise<void>;
  removeCredential(credentialRef: string): Promise<void>;
  credentialStorageStatus(): Promise<CredentialStorageStatus>;
  localModelRuntimes(): Promise<readonly LocalModelRuntime[]>;
  localModelRuntime(kind: LocalModelRuntimeKind): Promise<LocalModelRuntime>;
  activateLocalModelRuntime(
    kind: LocalModelRuntimeKind,
  ): Promise<LocalModelRuntime>;
  deactivateLocalModelRuntime(
    kind: LocalModelRuntimeKind,
  ): Promise<LocalModelRuntime>;
  createCredentialVaultUnlockSession(): Promise<CredentialCaptureResult>;
  createCredentialCaptureSession(
    input: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult>;
  credentialCaptureStatus(
    captureSessionId: string,
  ): Promise<CredentialCaptureResult>;
  activateAgentProvider(
    input: AgentProviderActivationInput,
  ): Promise<AgentProviderActivationResult>;
  providerRequest(input: ProviderHttpRequest): Promise<ProviderHttpResponse>;
  setWindowTheme(theme: "light" | "dark"): Promise<void>;
  notify(input: { title: string; body?: string }): Promise<void>;
  engineOperation(
    engine: AgentEngineKind,
    operation:
      | "availability"
      | "create"
      | "run"
      | "cancel"
      | "steer"
      | "resume"
      | "fork"
      | "recoverRun"
      | "destroy"
      | "health",
    payload?: Record<string, unknown>,
  ): Promise<unknown>;
  engineStream(
    engine: AgentEngineKind,
    payload?: Record<string, unknown>,
  ): AsyncIterable<HostEngineStreamEvent>;
}

export interface HostCapabilityDescriptor {
  id:
    | "files"
    | "media-library"
    | "media-archive"
    | "media-playback"
    | "renderer.ffmpeg-x264"
    | "renderer.ffmpeg-audio-mix-v1"
    | "renderer.ffmpeg-subtitles-v1"
    | "credentials"
    | "window"
    | "shell"
    | "engines"
    | "agent-provider"
    | "provider-http"
    | "web-research"
    | "notifications"
    | "extensions"
    | "updater";
  available: boolean;
  version?: string;
  /** Exact fonts exercised with the verified renderer; no paths or font bytes. */
  fonts?: readonly HostRendererFontDescriptor[];
}

export interface HostFileGrant {
  grantId: string;
  kind: "file" | "directory";
  displayName: string;
  expiresAt: string;
  generation: number;
}

/** Opaque reference to a Host-owned, EXIF-stripped portrait derivative. */
export interface HostManagedMedia {
  mediaRef: string;
  sha256: string;
  mimeType: "image/png";
  width: number;
  height: number;
  size: number;
}

export function engineKind(value: string): AgentEngineKind | undefined {
  return ["pi"].includes(value) ? (value as AgentEngineKind) : undefined;
}

export function localModelRuntimeKind(
  value: string,
): LocalModelRuntimeKind | undefined {
  return value === "ollama" || value === "lm_studio" ? value : undefined;
}

export function isAgentProviderActivationInput(
  value: Record<string, unknown>,
): value is Record<string, unknown> & AgentProviderActivationInput {
  if (
    typeof value.providerId !== "string" ||
    typeof value.runtimeProviderId !== "string" ||
    typeof value.model !== "string" ||
    !["apiKey", "none"].includes(String(value.authentication)) ||
    !["openai", "anthropic", "google"].includes(String(value.providerKind)) ||
    !["openai", "openai-compatible", "anthropic", "google"].includes(
      String(value.providerAdapter),
    )
  )
    return false;
  if (
    value.piProviderId !== undefined &&
    (typeof value.piProviderId !== "string" ||
      !value.piProviderId.trim() ||
      typeof value.baseUrl !== "string" ||
      !value.baseUrl.trim() ||
      value.authentication !== "apiKey")
  )
    return false;
  if (value.authentication === "apiKey") {
    if (
      typeof value.credentialRef !== "string" ||
      ![
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
      ].includes(String(value.environmentName))
    )
      return false;
  } else if (
    !["ollama", "lm_studio"].includes(String(value.localRuntimeKind)) ||
    value.providerKind !== "openai" ||
    value.providerAdapter !== "openai-compatible" ||
    value.baseUrl !== undefined ||
    value.credentialRef !== undefined
  )
    return false;
  if (typeof value.baseUrl !== "undefined") {
    if (typeof value.baseUrl !== "string") return false;
    try {
      const url = new URL(value.baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function providerHttpRequest(
  value: Record<string, unknown>,
): ProviderHttpRequest | undefined {
  if (
    typeof value.credentialRef !== "string" ||
    typeof value.url !== "string" ||
    !["GET", "POST", "DELETE"].includes(String(value.method))
  )
    return undefined;
  const url = new URL(value.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return undefined;
  if (
    typeof value.body !== "undefined" &&
    (!value.body || typeof value.body !== "object" || Array.isArray(value.body))
  )
    return undefined;
  const maximumBytes = Number(value.maximumBytes ?? 16 * 1024 * 1024);
  const timeoutMs = Number(value.timeoutMs ?? 90_000);
  const mediaRefs = Array.isArray(value.mediaRefs)
    ? value.mediaRefs
    : undefined;
  if (
    (value.idempotencyKey !== undefined &&
      (typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8 ||
        value.idempotencyKey.length > 200 ||
        /[\r\n]/u.test(value.idempotencyKey))) ||
    !Number.isInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 64 * 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 180_000
  )
    return undefined;
  if (
    mediaRefs &&
    (mediaRefs.length > 12 ||
      mediaRefs.some(
        (reference) =>
          typeof reference !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            reference,
          ),
      ))
  )
    return undefined;
  return {
    credentialRef: value.credentialRef,
    url: url.toString(),
    method: value.method as "GET" | "POST" | "DELETE",
    ...(value.body ? { body: value.body as Record<string, unknown> } : {}),
    ...(typeof value.idempotencyKey === "string"
      ? { idempotencyKey: value.idempotencyKey }
      : {}),
    accept: value.accept === "binary" ? "binary" : "json",
    maximumBytes,
    timeoutMs,
    ...(mediaRefs ? { mediaRefs } : {}),
  };
}

export function isHostEngineStreamEvent(
  value: unknown,
): value is HostEngineStreamEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === "activity") return event.activity === "thinking";
  if (event.type === "content.delta") return typeof event.delta === "string";
  if (event.type === "result") return "result" in event;
  if (event.type === "error") return typeof event.message === "string";
  if (event.type === "tool")
    return (
      typeof event.tool === "string" &&
      (event.status === "started" ||
        event.status === "completed" ||
        event.status === "failed") &&
      (event.detail === undefined ||
        typeof event.detail === "string" ||
        typeof event.detail === "number" ||
        typeof event.detail === "boolean" ||
        event.detail === null ||
        Array.isArray(event.detail) ||
        typeof event.detail === "object")
    );
  if (event.type === "usage") return true;
  return false;
}

export const AGENT_RUNTIME_DESCRIPTORS = {
  pi: {
    kind: "pi",
    role: "embedded-default",
    name: "Pi",
    version: "1.5.0",
    capabilities: {
      prompt: true,
      streaming: true,
      steer: true,
      abort: true,
      resume: true,
      fork: true,
      compaction: true,
      readOnlyTools: true,
    },
  },
} as const satisfies Readonly<Record<AgentEngineKind, AgentEngineDescriptor>>;

/**
 * Projects the private Host HTTP protocol onto the Core Runtime's stable
 * vendor-neutral contract.  It is intentionally not exported to Renderer.
 */
export function createHostAgentRuntime(
  host: DesktopHost,
  kind: AgentEngineKind,
): AgentRuntime {
  if (kind !== "pi")
    throw new AgentRuntimeError(
      "ENGINE_UNAVAILABLE",
      "原会话的引擎已停用，请新建 Pi 会话。",
    );
  const pendingRuns = new Map<string, Record<string, unknown>>();
  const recordedRuns = new Map<
    string,
    { events: AgentRuntimeEvent[]; complete: boolean }
  >();
  const descriptor = AGENT_RUNTIME_DESCRIPTORS[kind];
  const mustSessionId = (result: unknown): string => {
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as Record<string, unknown>).id !== "string"
    )
      throw new AgentRuntimeError(
        "ENGINE_UNAVAILABLE",
        "Agent engine did not return a session identifier.",
      );
    return (result as Record<string, unknown>).id as string;
  };
  return {
    descriptor,
    runRecoveryMode: "snapshot",
    async health(): Promise<AgentRuntimeHealth> {
      const raw = await host.engineHealth(kind).catch(() => undefined);
      const value = raw as Record<string, unknown> | undefined;
      return {
        available: value?.available === true,
        healthy: value?.healthy === true,
        configured: value?.configured === true,
        authenticated: true,
        generation:
          typeof value?.generation === "number" &&
          Number.isSafeInteger(value.generation)
            ? value.generation
            : 0,
        pendingRequestCount:
          typeof value?.pendingRequestCount === "number" &&
          Number.isSafeInteger(value.pendingRequestCount)
            ? value.pendingRequestCount
            : 0,
        ...(typeof value?.message === "string"
          ? { detail: value.message }
          : {}),
      };
    },
    async availability() {
      const health = await host.engineHealth(kind).catch(() => undefined);
      const value = health as Record<string, unknown> | undefined;
      return {
        available: value?.available === true && value.healthy === true,
        authenticated: true,
        configured: value?.configured === true,
        ...(typeof value?.message === "string"
          ? { detail: value.message }
          : {}),
      };
    },
    async createSession(input: AgentSessionInput): Promise<AgentSessionRef> {
      const result = await host.engineOperation(kind, "create", {
        title: input.title,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.capabilityGrant
          ? { capabilityGrant: input.capabilityGrant }
          : {}),
      });
      return {
        sessionId: input.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async prompt(session, input): Promise<AgentRunRef> {
      pendingRuns.set(input.runId, {
        engineSessionId: session.engineSessionId,
        runId: input.runId,
        prompt: input.prompt,
        ...(input.responseMode ? { responseMode: input.responseMode } : {}),
        ...(input.conversationTitle
          ? { conversationTitle: input.conversationTitle }
          : {}),
        ...(input.capabilityGrant
          ? { capabilityGrant: input.capabilityGrant }
          : {}),
      });
      return { runId: input.runId, engineRunId: input.runId };
    },
    async steer(run, prompt) {
      if (!descriptor.capabilities.steer)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          `${descriptor.name} does not support steering.`,
        );
      await host.engineOperation(kind, "steer", { runId: run.runId, prompt });
    },
    async abort(run) {
      await host.engineOperation(kind, "cancel", { runId: run.runId });
    },
    async resume(session) {
      if (!descriptor.capabilities.resume)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          "Resume unsupported.",
        );
      const result = await host.engineOperation(kind, "resume", {
        engineSessionId: session.engineSessionId,
      });
      return {
        sessionId: session.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async fork(session, input) {
      if (!descriptor.capabilities.fork)
        throw new AgentRuntimeError(
          "UNSUPPORTED_OPERATION",
          "Fork unsupported.",
        );
      const result = await host.engineOperation(kind, "fork", {
        engineSessionId: session.engineSessionId,
      });
      return {
        sessionId: input.sessionId,
        engineSessionId: mustSessionId(result),
      };
    },
    async *subscribe(run, options): AsyncIterable<AgentRuntimeEvent> {
      const after = options?.cursor ?? 0;
      const prior = recordedRuns.get(run.runId);
      if (prior?.complete) {
        yield* prior.events.filter((event) => event.cursor > after);
        return;
      }
      const payload = pendingRuns.get(run.runId);
      if (!payload)
        throw new AgentRuntimeError("CONTEXT_INVALID", "Run was not prepared.");
      pendingRuns.delete(run.runId);
      const record = prior ?? { events: [], complete: false };
      recordedRuns.set(run.runId, record);
      try {
        for await (const event of host.engineStream(kind, payload)) {
          const cursor = record.events.length + 1;
          const mapped: AgentRuntimeEvent =
            event.type === "activity"
              ? { cursor, type: "activity", activity: event.activity }
              : event.type === "content.delta"
                ? { cursor, type: "content.delta", delta: event.delta }
                : event.type === "tool"
                  ? {
                      cursor,
                      type: "tool",
                      status: event.status,
                      tool: event.tool,
                      ...(event.itemId ? { itemId: event.itemId } : {}),
                      ...(event.detail !== undefined
                        ? { detail: event.detail }
                        : {}),
                    }
                  : event.type === "usage"
                    ? {
                        cursor,
                        type: "usage",
                        usage: normalizeAgentUsage(event),
                      }
                    : event.type === "result"
                      ? {
                          cursor,
                          type: "result",
                          result: event.result as never,
                        }
                      : {
                          cursor,
                          type: "error",
                          code: "PROVIDER_REJECTED",
                          message: event.message,
                          retryable: false,
                        };
          record.events.push(mapped);
          if (mapped.cursor > after) yield mapped;
        }
      } catch {
        const interrupted: AgentRuntimeEvent = {
          cursor: record.events.length + 1,
          type: "error",
          code: "RUN_INTERRUPTED",
          message: "Agent engine stream was interrupted.",
          retryable: true,
        };
        record.events.push(interrupted);
        if (interrupted.cursor > after) yield interrupted;
      }
      record.complete = true;
    },
    async recoverRun(input) {
      const result = await host.engineOperation(kind, "recoverRun", {
        engineSessionId: input.session.engineSessionId,
        runId: input.run.runId,
        ...(input.run.engineRunId
          ? { engineRunId: input.run.engineRunId }
          : {}),
        afterCursor: input.afterCursor,
      });
      if (!result || typeof result !== "object")
        return { disposition: "missing" };
      const value = result as Record<string, unknown>;
      if (value.disposition === "completed")
        return {
          disposition: "completed",
          result: value.result as never,
          finalCursor:
            typeof value.finalCursor === "number"
              ? value.finalCursor
              : input.afterCursor + 1,
        };
      if (value.disposition === "resumed")
        return {
          disposition: "resumed",
          session: input.session,
          run: input.run,
        };
      return { disposition: "missing" };
    },
    async dispose(session) {
      await host.engineOperation(kind, "destroy", {
        engineSessionId: session.engineSessionId,
      });
    },
  };
}
