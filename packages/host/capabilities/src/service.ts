/**
 * The `desktopHost` service: every Host capability business plugins call,
 * in-process (D8). It keeps the contract the HTTP client gave them: inputs
 * are checked as the Host routes checked them, values cross as JSON, and a
 * refused call throws the client's `Desktop Host request failed: <status>`.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentEngineKind,
  LocalModelRuntime,
  LocalModelRuntimeKind,
} from "@dramaip/contracts";
import {
  NleCopyJobError,
  discoverLocalModelRuntime,
  engineKind,
  isAgentProviderActivationInput,
  isHostEngineStreamEvent,
  providerHttpRequest,
  validManagedMediaReadInput,
  validNleCopyInput,
  validTimelineRenderInput,
  type AgentProviderActivationInput,
  type AgentProviderActivationResult,
  type CredentialCaptureRequest,
  type CredentialCaptureResult,
  type CredentialStorageStatus,
  type DesktopHost,
  type HostArchiveRemoteMediaInput,
  type HostArchivedMedia,
  type HostCapabilityDescriptor,
  type HostEngineStreamEvent,
  type HostFileGrant,
  type HostGrantedDocument,
  type HostManagedMedia,
  type HostManagedMediaReadInput,
  type HostTextFileSaveResult,
  type HostTimelineRenderAudioPlan,
  type HostTimelineRenderInput,
  type HostTimelineRenderJob,
  type HostTimelineRenderSubtitlePlan,
  type HostWriteDirectoryGrant,
  type NleCopyInput,
  type NleCopyJob,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type PublicWebPageResponse,
} from "@dramaip/host-contracts";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import type { EngineOperation, Engines } from "@dramaip/seams-engines";
import type { HostCredentials } from "./credentials.ts";
import type { HostFiles } from "./files.ts";
import type { HostMedia } from "./media.ts";
import { providerRequest, readWebPage } from "./web.ts";

/** A call the Host refused, with the status its route answered. */
export class HostRequestError extends Error {
  /** @param status - the HTTP status the Host route answered. */
  constructor(readonly status: number) {
    super(`Desktop Host request failed: ${status}`);
    this.name = "HostRequestError";
  }
}

const ENGINE_OPERATIONS: readonly EngineOperation[] = [
  "availability",
  "create",
  "run",
  "cancel",
  "steer",
  "resume",
  "fork",
  "recoverRun",
  "destroy",
  "health",
];

const MAXIMUM_GRANT_READ_BYTES = 32 * 1024 * 1024;

/** Values cross the boundary as JSON, exactly as they did over HTTP. */
function json<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A JSON object body, as the routes required one. */
function body(value: unknown): Record<string, unknown> {
  const parsed = json(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HostRequestError(400);
  return parsed as Record<string, unknown>;
}

function refuse(status: number): never {
  throw new HostRequestError(status);
}

function copyIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      value,
    )
  );
}

/** The status the NLE copy routes answered for a refused copy. */
function copyStatus(cause: unknown): number {
  const code =
    cause instanceof NleCopyJobError ? cause.code : "COPY_JOURNAL_UNAVAILABLE";
  return code === "INVALID_COPY_REQUEST"
    ? 400
    : code === "COPY_REQUEST_CONFLICT"
      ? 409
      : 503;
}

/** Settle with the caller's abort, as the HTTP request did. */
function bounded<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const bound = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  return new Promise<T>((resolvePromise, reject) => {
    const abort = (): void => reject(bound.reason as Error);
    if (bound.aborted) return abort();
    bound.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        bound.removeEventListener("abort", abort);
        resolvePromise(value);
      },
      (error: unknown) => {
        bound.removeEventListener("abort", abort);
        reject(error as Error);
      },
    );
  });
}

/** What the service is built from. */
export interface DesktopHostServiceParts {
  readonly shell: ShellBridge;
  readonly files: HostFiles;
  readonly credentials: HostCredentials;
  readonly media: HostMedia;
  /** The engine registry, when the seam is composed. */
  engines(): Engines | undefined;
}

/** The in-process Desktop Host. */
export class DesktopHostService implements DesktopHost {
  private readonly activeLocalModelRuntimes = new Set<LocalModelRuntimeKind>();

  /** @param parts - the capabilities behind it. */
  constructor(private readonly parts: DesktopHostServiceParts) {}

  /**
   * Run one Host call: a refusal keeps its status, anything else the call
   * throws is a 400 as the routes' error handler answered it.
   */
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return json(await work());
    } catch (error) {
      if (error instanceof HostRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof Error && error.name === "TimeoutError") throw error;
      throw new HostRequestError(400);
    }
  }

  private engineKind(value: string): AgentEngineKind {
    return engineKind(value) ?? refuse(404);
  }

  /** The capabilities this Host offers. */
  capabilities(): HostCapabilityDescriptor[] {
    return [
      { id: "files", available: true },
      ...this.parts.media.capabilities(),
      { id: "credentials", available: true },
      { id: "window", available: true },
      { id: "shell", available: true },
      { id: "engines", available: this.parts.engines() !== undefined },
      { id: "agent-provider", available: true },
      { id: "provider-http", available: true },
      { id: "web-research", available: true },
      { id: "notifications", available: true },
      // D7: Level 2 ships no extension platform.
      { id: "extensions", available: false },
      { id: "updater", available: false },
    ];
  }

  readManagedMedia(
    input: HostManagedMediaReadInput,
    signal: AbortSignal,
  ): Promise<Response> {
    const value = json(input) as unknown as Record<string, unknown>;
    const checked: HostManagedMediaReadInput = {
      mediaRef: String(value.mediaRef ?? ""),
      sha256: String(value.sha256 ?? ""),
      sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : NaN,
      mimeType: String(value.mimeType ?? ""),
    };
    if (
      Object.keys(value).some(
        (key) => !["mediaRef", "sha256", "sizeBytes", "mimeType"].includes(key),
      ) ||
      !validManagedMediaReadInput(checked)
    )
      return Promise.resolve(
        Response.json(
          { code: "INVALID_MANAGED_MEDIA_READ", traceId: randomUUID() },
          { status: 400 },
        ),
      );
    return this.parts.media.readManagedMedia(checked, signal);
  }

  async health(): Promise<{
    healthy: boolean;
    capabilities: readonly HostCapabilityDescriptor[];
  }> {
    return json({ healthy: true, capabilities: this.capabilities() });
  }

  engineHealth(engine: AgentEngineKind): Promise<unknown> {
    return this.call(async () => {
      const kind = this.engineKind(engine);
      const engines = this.parts.engines() ?? refuse(503);
      return engines.health(kind);
    });
  }

  pickFiles(
    options: { multiple?: boolean; extensions?: readonly string[] } = {},
  ): Promise<readonly HostFileGrant[] | null> {
    return this.call(async () => {
      const input = body(options);
      return this.parts.files.pickFiles({
        multiple: input.multiple === true,
        extensions: Array.isArray(input.extensions)
          ? input.extensions.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [],
      });
    });
  }

  pickDirectory(): Promise<HostFileGrant | null> {
    return this.call(() => this.parts.files.pickDirectory());
  }

  pickNleCopyDirectory(
    signal?: AbortSignal,
  ): Promise<HostWriteDirectoryGrant | null> {
    return bounded(
      this.call(async () => {
        try {
          return await this.parts.files.pickNleCopyDirectory();
        } catch {
          return refuse(503);
        }
      }),
      signal,
      300_000,
    );
  }

  startNleMediaCopy(
    id: string,
    input: NleCopyInput,
    writeGrantRef: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob> {
    return bounded(
      this.call(async () => {
        const request = body({ id, input, writeGrantRef });
        if (
          Object.keys(request).length !== 3 ||
          !copyIdentity(request.id) ||
          !copyIdentity(request.writeGrantRef) ||
          !validNleCopyInput(request.input)
        )
          refuse(400);
        try {
          return await this.parts.media.startNleMediaCopy(
            request.id as string,
            request.input as NleCopyInput,
            request.writeGrantRef as string,
          );
        } catch (cause) {
          return refuse(copyStatus(cause));
        }
      }),
      signal,
      30_000,
    );
  }

  getNleMediaCopy(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob> {
    return bounded(
      this.call(async () => {
        if (!copyIdentity(id) || !copyIdentity(projectId)) refuse(400);
        let value: NleCopyJob | undefined;
        try {
          value = await this.parts.media.getNleMediaCopy(id, projectId);
        } catch (cause) {
          return refuse(copyStatus(cause));
        }
        return value ?? refuse(404);
      }),
      signal,
      30_000,
    );
  }

  cancelNleMediaCopy(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<NleCopyJob> {
    return bounded(
      this.call(async () => {
        if (!copyIdentity(id) || !copyIdentity(projectId)) refuse(400);
        let value: NleCopyJob | undefined;
        try {
          value = await this.parts.media.cancelNleMediaCopy(id, projectId);
        } catch (cause) {
          return refuse(copyStatus(cause));
        }
        return value ?? refuse(404);
      }),
      signal,
      30_000,
    );
  }

  revealNleMediaCopy(
    id: string,
    projectId: string,
    artifactRef: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return bounded(
      this.call(async () => {
        if (
          !copyIdentity(id) ||
          !copyIdentity(projectId) ||
          !copyIdentity(artifactRef)
        )
          refuse(400);
        let revealed: boolean;
        try {
          revealed = await this.parts.media.revealNleMediaCopy(
            id,
            projectId,
            artifactRef,
          );
        } catch (cause) {
          return refuse(copyStatus(cause));
        }
        if (!revealed) refuse(404);
      }),
      signal,
      30_000,
    );
  }

  private grantLimit(maximumBytes: unknown): number {
    const limit = Number(maximumBytes);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAXIMUM_GRANT_READ_BYTES
    )
      refuse(400);
    return limit;
  }

  readGrantedText(
    grantId: string,
    maximumBytes = 16 * 1024 * 1024,
  ): Promise<{ name: string; content: string; size: number }> {
    return this.call(() =>
      this.parts.files.readGrantedText(grantId, this.grantLimit(maximumBytes)),
    );
  }

  readGrantedDocument(
    grantId: string,
    maximumBytes = MAXIMUM_GRANT_READ_BYTES,
  ): Promise<HostGrantedDocument> {
    return this.call(() =>
      this.parts.files.readGrantedDocument(
        grantId,
        this.grantLimit(maximumBytes),
      ),
    );
  }

  importPortraitMedia(grantId: string): Promise<HostManagedMedia> {
    return this.call(async () => {
      if (typeof grantId !== "string" || !grantId) refuse(400);
      return this.parts.media.importPortraitMedia(grantId);
    });
  }

  archiveRemoteMedia(
    input: HostArchiveRemoteMediaInput,
  ): Promise<HostArchivedMedia> {
    return this.call(async () => {
      if (!this.parts.media.archiving) refuse(503);
      const request = body(input);
      const maximumBytes =
        typeof request.maximumBytes === "undefined"
          ? 512 * 1024 * 1024
          : Number(request.maximumBytes);
      if (
        (typeof request.credentialRef !== "undefined" &&
          (typeof request.credentialRef !== "string" ||
            !request.credentialRef)) ||
        typeof request.url !== "string" ||
        !request.url ||
        request.kind !== "video" ||
        !Number.isInteger(maximumBytes) ||
        maximumBytes < 1 ||
        maximumBytes > 2 * 1024 * 1024 * 1024 ||
        (typeof request.expectedSha256 !== "undefined" &&
          (typeof request.expectedSha256 !== "string" ||
            !/^[a-f0-9]{64}$/u.test(request.expectedSha256)))
      )
        refuse(400);
      return this.parts.media.archiveRemoteMedia({
        url: request.url as string,
        kind: "video",
        maximumBytes,
        ...(typeof request.credentialRef === "string"
          ? { credentialRef: request.credentialRef }
          : {}),
        ...(typeof request.expectedSha256 === "string"
          ? { expectedSha256: request.expectedSha256 }
          : {}),
      });
    });
  }

  startTimelineRender(
    input: HostTimelineRenderInput,
  ): Promise<HostTimelineRenderJob> {
    return this.call(async () => {
      if (!this.parts.media.rendering) refuse(503);
      const request = body(input);
      const profile = body(request.profile);
      const frameRate = body(profile.frameRate);
      const clips = Array.isArray(request.clips) ? request.clips : [];
      if (
        typeof request.jobId !== "string" ||
        typeof request.timelineId !== "string" ||
        !Number.isInteger(request.durationFrames) ||
        Number(request.durationFrames) < 1 ||
        !Number.isInteger(profile.width) ||
        !Number.isInteger(profile.height) ||
        !Number.isInteger(profile.audioSampleRate) ||
        !Number.isInteger(profile.channels) ||
        !Number.isInteger(frameRate.numerator) ||
        !Number.isInteger(frameRate.denominator) ||
        typeof frameRate.dropFrame !== "boolean" ||
        clips.length < 1 ||
        clips.length > 10_000
      )
        refuse(400);
      const checked: HostTimelineRenderInput = {
        jobId: request.jobId as string,
        timelineId: request.timelineId as string,
        durationFrames: Number(request.durationFrames),
        profile: {
          width: Number(profile.width),
          height: Number(profile.height),
          frameRate: {
            numerator: Number(frameRate.numerator),
            denominator: Number(frameRate.denominator),
            dropFrame: frameRate.dropFrame as boolean,
          },
          audioSampleRate: Number(profile.audioSampleRate),
          channels: Number(profile.channels),
        },
        clips: clips.map((value) =>
          body(value),
        ) as unknown as HostTimelineRenderInput["clips"],
        ...(Object.hasOwn(request, "audioPlan")
          ? { audioPlan: request.audioPlan as HostTimelineRenderAudioPlan }
          : {}),
        ...(Object.hasOwn(request, "subtitlePlan")
          ? {
              subtitlePlan:
                request.subtitlePlan as HostTimelineRenderSubtitlePlan,
            }
          : {}),
      };
      if (
        Object.keys(request).length !==
          5 +
            Number(Object.hasOwn(request, "audioPlan")) +
            Number(Object.hasOwn(request, "subtitlePlan")) ||
        Object.keys(profile).length !== 5 ||
        Object.keys(frameRate).length !== 3 ||
        !validTimelineRenderInput(checked)
      )
        refuse(400);
      return this.parts.media.startTimelineRender(checked);
    });
  }

  getTimelineRender(jobId: string): Promise<HostTimelineRenderJob> {
    return this.call(async () => {
      if (!this.parts.media.rendering) refuse(503);
      return (await this.parts.media.getTimelineRender(jobId)) ?? refuse(404);
    });
  }

  cancelTimelineRender(jobId: string): Promise<HostTimelineRenderJob> {
    return this.call(async () => {
      if (!this.parts.media.rendering) refuse(503);
      return (
        (await this.parts.media.cancelTimelineRender(jobId)) ?? refuse(404)
      );
    });
  }

  removeManagedMedia(mediaRef: string): Promise<void> {
    return this.call(async () => {
      if (!mediaRef) refuse(400);
      await this.parts.media.removeManagedMedia(mediaRef);
    });
  }

  readWebPage(input: {
    url: string;
    maxCharacters: number;
  }): Promise<PublicWebPageResponse> {
    return this.call(async () => {
      const request = body(input);
      if (
        typeof request.url !== "string" ||
        request.url.length > 4_000 ||
        !Number.isInteger(request.maxCharacters) ||
        Number(request.maxCharacters) < 1_000 ||
        Number(request.maxCharacters) > 50_000
      )
        refuse(400);
      let url: URL;
      try {
        url = new URL(request.url as string);
      } catch {
        return refuse(400);
      }
      if (url.protocol !== "https:" || url.username || url.password)
        refuse(400);
      return readWebPage({
        url: request.url as string,
        maxCharacters: Number(request.maxCharacters),
      });
    });
  }

  saveTextFile(input: {
    suggestedName: string;
    content: string;
  }): Promise<HostTextFileSaveResult> {
    return this.call(async () => {
      const request = body(input);
      if (
        typeof request.suggestedName !== "string" ||
        typeof request.content !== "string"
      )
        refuse(400);
      return this.parts.files.saveTextFile({
        suggestedName: request.suggestedName as string,
        content: request.content as string,
      });
    });
  }

  saveBinaryFile(input: {
    suggestedName: string;
    contentBase64: string;
    mimeType: "application/zip";
  }): Promise<HostTextFileSaveResult> {
    return this.call(async () => {
      const request = body(input);
      if (
        typeof request.suggestedName !== "string" ||
        !request.suggestedName.endsWith(".zip") ||
        request.mimeType !== "application/zip" ||
        typeof request.contentBase64 !== "string" ||
        request.contentBase64.length > 44_739_244 ||
        request.contentBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(request.contentBase64)
      )
        refuse(400);
      const contentBase64 = request.contentBase64 as string;
      const bytes = Buffer.from(contentBase64, "base64");
      if (
        bytes.length > 33_554_432 ||
        bytes.subarray(0, 4).toString("hex") !== "504b0304" ||
        bytes.toString("base64") !== contentBase64
      )
        refuse(400);
      return this.parts.files.saveBinaryFile({
        suggestedName: request.suggestedName as string,
        contentBase64,
        mimeType: "application/zip",
      });
    });
  }

  openExternal(url: string): Promise<void> {
    return this.call(async () => {
      if (typeof url !== "string") refuse(400);
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) refuse(400);
      await this.parts.shell.request("shell.openExternal", {
        url: parsed.toString(),
      });
    });
  }

  revealGrant(grantId: string): Promise<void> {
    return this.call(async () => {
      if (typeof grantId !== "string" || !grantId) refuse(400);
      await this.parts.files.revealGrant(grantId);
    });
  }

  revealArtifact(artifactRef: string): Promise<void> {
    return this.call(async () => {
      if (typeof artifactRef !== "string" || !artifactRef) refuse(400);
      await this.parts.files.revealArtifact(artifactRef);
    });
  }

  removeCredential(credentialRef: string): Promise<void> {
    return this.call(() =>
      this.parts.credentials.removeCredential(credentialRef),
    );
  }

  credentialStorageStatus(): Promise<CredentialStorageStatus> {
    return this.call(() => this.parts.credentials.credentialStorageStatus());
  }

  localModelRuntimes(): Promise<readonly LocalModelRuntime[]> {
    return this.call(() =>
      Promise.all(
        (["ollama", "lm_studio"] as const).map((kind) =>
          discoverLocalModelRuntime(
            kind,
            this.activeLocalModelRuntimes.has(kind),
          ),
        ),
      ),
    );
  }

  localModelRuntime(kind: LocalModelRuntimeKind): Promise<LocalModelRuntime> {
    return this.call(async () => {
      if (kind !== "ollama" && kind !== "lm_studio") refuse(404);
      return discoverLocalModelRuntime(
        kind,
        this.activeLocalModelRuntimes.has(kind),
      );
    });
  }

  activateLocalModelRuntime(
    kind: LocalModelRuntimeKind,
  ): Promise<LocalModelRuntime> {
    return this.call(async () => {
      if (kind !== "ollama" && kind !== "lm_studio") refuse(404);
      const discovered = await discoverLocalModelRuntime(kind, false);
      if (discovered.state === "unavailable") refuse(503);
      this.activeLocalModelRuntimes.add(kind);
      return { ...discovered, state: "active" as const };
    });
  }

  deactivateLocalModelRuntime(
    kind: LocalModelRuntimeKind,
  ): Promise<LocalModelRuntime> {
    return this.call(async () => {
      if (kind !== "ollama" && kind !== "lm_studio") refuse(404);
      this.activeLocalModelRuntimes.delete(kind);
      return discoverLocalModelRuntime(kind, false);
    });
  }

  createCredentialVaultUnlockSession(): Promise<CredentialCaptureResult> {
    return this.call(() =>
      this.parts.credentials.createCredentialVaultUnlockSession(),
    );
  }

  createCredentialCaptureSession(
    input: CredentialCaptureRequest,
  ): Promise<CredentialCaptureResult> {
    return this.call(async () => {
      const request = body(input);
      if (
        typeof request.purpose !== "string" ||
        !request.purpose.trim() ||
        (typeof request.label !== "undefined" &&
          typeof request.label !== "string") ||
        (typeof request.policyId !== "undefined" &&
          typeof request.policyId !== "string") ||
        (typeof request.allowedOrigin !== "undefined" &&
          typeof request.allowedOrigin !== "string")
      )
        refuse(400);
      return this.parts.credentials.createCredentialCaptureSession({
        purpose: request.purpose as string,
        ...(typeof request.label === "string" ? { label: request.label } : {}),
        ...(typeof request.policyId === "string"
          ? { policyId: request.policyId }
          : {}),
        ...(typeof request.allowedOrigin === "string"
          ? { allowedOrigin: request.allowedOrigin }
          : {}),
      });
    });
  }

  credentialCaptureStatus(
    captureSessionId: string,
  ): Promise<CredentialCaptureResult> {
    return this.call(
      async () =>
        (await this.parts.credentials.credentialCaptureStatus(
          captureSessionId,
        )) ?? refuse(404),
    );
  }

  activateAgentProvider(
    input: AgentProviderActivationInput,
  ): Promise<AgentProviderActivationResult> {
    return this.call(async () => {
      const configuration = body(input);
      if (!isAgentProviderActivationInput(configuration)) refuse(400);
      return this.activate(configuration as AgentProviderActivationInput);
    });
  }

  private async activate(
    configuration: AgentProviderActivationInput,
  ): Promise<AgentProviderActivationResult> {
    const defaultOrigins = {
      openai: "https://api.openai.com",
      anthropic: "https://api.anthropic.com",
      google: "https://generativelanguage.googleapis.com",
    } as const;
    let baseUrl = configuration.baseUrl;
    let secret: string;
    if (configuration.authentication === "none") {
      const kind = configuration.localRuntimeKind!;
      const runtime = await discoverLocalModelRuntime(kind);
      if (runtime.state === "unavailable")
        return { available: false, message: "本地模型运行时当前不可用" };
      baseUrl =
        kind === "ollama"
          ? "http://127.0.0.1:11434/v1"
          : "http://127.0.0.1:1234/v1";
      secret = "local-runtime-no-auth";
    } else {
      secret =
        (await this.parts.credentials.resolve(configuration.credentialRef!, {
          purpose: "provider-authentication",
          origin:
            configuration.baseUrl ?? defaultOrigins[configuration.providerKind],
        })) ?? "";
      if (!secret)
        return { available: false, message: "智能助手模型的安全凭据不可用" };
    }
    const answers =
      (await this.parts.engines()?.configure({
        ...(configuration.piProviderId
          ? { piProviderId: configuration.piProviderId }
          : {}),
        providerKind: configuration.providerKind,
        providerAdapter: configuration.providerAdapter,
        model: configuration.model,
        ...(baseUrl ? { baseUrl } : {}),
        secret,
      })) ?? {};
    const pi = answers.pi ?? { available: false, message: "Pi Runtime 未启动" };
    return pi.available
      ? { available: true }
      : {
          available: false,
          ...(pi.message ? { message: pi.message } : {}),
        };
  }

  providerRequest(input: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    return this.call(async () => {
      const request = providerHttpRequest(body(input)) ?? refuse(400);
      return providerRequest(this.parts.credentials, this.parts.media, request);
    });
  }

  setWindowTheme(theme: "light" | "dark"): Promise<void> {
    return this.call(async () => {
      if (theme !== "light" && theme !== "dark") refuse(400);
      await this.parts.shell.request("window.theme", { theme });
    });
  }

  notify(input: { title: string; body?: string }): Promise<void> {
    return this.call(async () => {
      const request = body(input);
      if (
        typeof request.title !== "string" ||
        (typeof request.body !== "undefined" &&
          typeof request.body !== "string")
      )
        refuse(400);
      await this.parts.shell.request("notify", {
        title: request.title as string,
        ...(typeof request.body === "string" ? { body: request.body } : {}),
      });
    });
  }

  // D7: Level 2 ships no extension platform; every extension call answers
  // as an unavailable capability.

  fetchExtensionRegistry(): Promise<unknown> {
    return this.call(async () => refuse(503));
  }

  stageExtensionPackage(): Promise<never> {
    return this.call(async () => refuse(503));
  }

  activateExtension(): Promise<void> {
    return this.call(async () => refuse(503));
  }

  invokeExtension(): Promise<unknown> {
    return this.call(async () => refuse(503));
  }

  stopExtension(): Promise<void> {
    return this.call(async () => refuse(503));
  }

  retryExtension(): Promise<void> {
    return this.call(async () => refuse(503));
  }

  extensionDiagnostics(): Promise<readonly Record<string, unknown>[]> {
    return this.call(async () => refuse(503));
  }

  extensionNetworkRequest(): Promise<never> {
    return this.call(async () => refuse(503));
  }

  engineOperation(
    engine: AgentEngineKind,
    operation: EngineOperation,
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.call(async () => {
      const kind = this.engineKind(engine);
      if (!ENGINE_OPERATIONS.includes(operation)) refuse(404);
      const engines = this.parts.engines() ?? refuse(503);
      return engines.operation(kind, operation, body(payload));
    });
  }

  async *engineStream(
    engine: AgentEngineKind,
    payload: Record<string, unknown> = {},
  ): AsyncIterable<HostEngineStreamEvent> {
    const kind = this.engineKind(engine);
    const engines = this.parts.engines() ?? refuse(503);
    const input = body(payload);
    const abort = new AbortController();
    const events = engines
      .stream(kind, input, abort.signal)
      [Symbol.asyncIterator]();
    let finished = false;
    try {
      while (true) {
        let next: IteratorResult<HostEngineStreamEvent>;
        try {
          next = await events.next();
        } catch {
          finished = true;
          yield { type: "error", message: "智能引擎流式连接中断，请重试。" };
          return;
        }
        if (next.done) {
          finished = true;
          return;
        }
        const crossed = json(next.value) as unknown;
        if (!isHostEngineStreamEvent(crossed))
          throw new Error("Desktop Host emitted an unsupported stream event");
        yield crossed;
      }
    } finally {
      if (!finished) {
        // The consumer stopped reading: interrupt the run, as closing the
        // response stream did, then let the engine's stream wind down.
        abort.abort();
        await events.return?.();
      }
    }
  }
}
