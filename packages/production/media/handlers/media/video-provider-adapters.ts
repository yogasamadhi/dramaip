import type { ConfiguredProvider } from "@dramaip/contracts";
import type { VideoGenerationInput } from "@dramaip/contracts/media";

export type MediaVideoProviderKind = "seedance" | "minimax_h3_cloud";

export interface MediaVideoProviderCapabilities {
  providerKind: MediaVideoProviderKind;
  cancellation: "unsupported" | "queued_only" | "supported";
  nativeAudio: boolean;
  durationSeconds: number[] | { minimum: number; maximum: number };
  resolutions: string[];
  aspectRatios: string[];
}

export interface MediaProviderRequestDraft {
  method: "GET" | "POST" | "DELETE";
  suffix: string;
  body?: Record<string, unknown>;
}

export interface NormalizedVideoProviderTask {
  remoteJobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  outputUrl?: string;
  modelRevision?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface MediaVideoProviderAdapter {
  readonly kind: MediaVideoProviderKind;
  readonly capabilities: MediaVideoProviderCapabilities;
  create(
    provider: ConfiguredProvider,
    input: VideoGenerationInput,
  ): MediaProviderRequestDraft;
  poll(remoteJobId: string): MediaProviderRequestDraft;
  cancel(remoteJobId: string): MediaProviderRequestDraft | undefined;
  parseCreate(value: unknown): NormalizedVideoProviderTask;
  parsePoll(value: unknown): NormalizedVideoProviderTask;
}

/** Validate the configured adapter's declaration, not live Provider guarantees. */
export function videoProviderInputIssues(
  capabilities: MediaVideoProviderCapabilities,
  input: VideoGenerationInput,
): string[] {
  const issues: string[] = [];
  const seconds = input.seconds ?? 5;
  const durations = capabilities.durationSeconds;
  if (
    Array.isArray(durations)
      ? !durations.includes(seconds)
      : seconds < durations.minimum || seconds > durations.maximum
  )
    issues.push("请求时长超出服务商声明能力；不缩短或替换后提交。");
  if (
    input.size !== undefined &&
    !capabilities.resolutions.some(
      (resolution) => resolution.toLowerCase() === input.size!.toLowerCase(),
    )
  )
    issues.push("请求分辨率不在服务商声明能力中；不替换为默认分辨率。");
  return issues;
}

function assertVideoInput(
  capabilities: MediaVideoProviderCapabilities,
  input: VideoGenerationInput,
) {
  const issues = videoProviderInputIssues(capabilities, input);
  if (issues.length) throw new Error(issues.join(" "));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredId(value: unknown, provider: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new Error(`${provider} 未返回异步任务标识。`);
  return id;
}

function status(value: unknown): NormalizedVideoProviderTask["status"] {
  const normalized = String(value ?? "queued").toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized))
    return "succeeded";
  if (["failed", "error", "cancel_failed"].includes(normalized))
    return "failed";
  if (["canceled", "cancelled"].includes(normalized)) return "canceled";
  if (["running", "processing", "in_progress"].includes(normalized))
    return "running";
  return "queued";
}

function cleanError(value: unknown): {
  errorCode?: string;
  errorMessage?: string;
} {
  const error = object(value);
  const code = error.code ?? error.type;
  const message = error.message;
  return {
    ...(typeof code === "string" || typeof code === "number"
      ? { errorCode: String(code).slice(0, 120) }
      : {}),
    ...(typeof message === "string"
      ? {
          errorMessage: message
            .replace(/https?:\/\/\S+/giu, "[remote-url]")
            .slice(0, 1_000),
        }
      : {}),
  };
}

const minimaxH3: MediaVideoProviderAdapter = {
  kind: "minimax_h3_cloud",
  capabilities: {
    providerKind: "minimax_h3_cloud",
    cancellation: "queued_only",
    nativeAudio: true,
    durationSeconds: { minimum: 4, maximum: 15 },
    resolutions: ["768P", "2K"],
    aspectRatios: ["9:16", "16:9", "1:1", "adaptive"],
  },
  create(provider, input) {
    assertVideoInput(minimaxH3.capabilities, input);
    const resolution =
      input.size === undefined
        ? "768P"
        : minimaxH3.capabilities.resolutions.find(
            (value) => value.toLowerCase() === input.size!.toLowerCase(),
          )!;
    return {
      method: "POST",
      suffix: "/v2/video_generation",
      body: {
        model: provider.model,
        content: [{ type: "text", text: input.prompt }],
        resolution,
        duration: input.seconds ?? 5,
        ratio: "9:16",
      },
    };
  },
  poll(remoteJobId) {
    return {
      method: "GET",
      suffix: `/v2/query/video_generation/${encodeURIComponent(remoteJobId)}`,
    };
  },
  cancel(remoteJobId) {
    return {
      method: "DELETE",
      suffix: `/v2/video_generation/${encodeURIComponent(remoteJobId)}`,
    };
  },
  parseCreate(value) {
    const response = object(value);
    const task = object(response.task);
    const remoteJobId = requiredId(response.task_id ?? task.id, "MiniMax H3");
    return {
      remoteJobId,
      status: status(task.status ?? response.status),
      modelRevision: typeof task.model === "string" ? task.model : undefined,
      ...cleanError(response.error ?? task.error),
    };
  },
  parsePoll(value) {
    const task = object(object(value).task);
    const content = object(task.content);
    return {
      remoteJobId: requiredId(task.id, "MiniMax H3"),
      status: status(task.status),
      ...(typeof content.url === "string" ? { outputUrl: content.url } : {}),
      ...(typeof task.model === "string" ? { modelRevision: task.model } : {}),
      ...cleanError(task.error),
    };
  },
};

const seedance: MediaVideoProviderAdapter = {
  kind: "seedance",
  capabilities: {
    providerKind: "seedance",
    // The product keeps cancellation unavailable until the selected Ark model
    // advertises a cancellable operation. We never convert a local flag into a
    // claim that the paid provider task was cancelled.
    cancellation: "unsupported",
    nativeAudio: false,
    durationSeconds: { minimum: 1, maximum: 60 },
    resolutions: ["720p", "1080p"],
    aspectRatios: ["9:16", "16:9", "1:1"],
  },
  create(provider, input) {
    assertVideoInput(seedance.capabilities, input);
    return {
      method: "POST",
      suffix: "/contents/generations/tasks",
      body: {
        model: provider.model,
        content: [{ type: "text", text: input.prompt }],
        duration: input.seconds ?? 5,
        ratio: "9:16",
        ...(input.size === undefined
          ? {}
          : {
              resolution: seedance.capabilities.resolutions.find(
                (value) => value.toLowerCase() === input.size!.toLowerCase(),
              )!,
            }),
      },
    };
  },
  poll(remoteJobId) {
    return {
      method: "GET",
      suffix: `/contents/generations/tasks/${encodeURIComponent(remoteJobId)}`,
    };
  },
  cancel() {
    return undefined;
  },
  parseCreate(value) {
    const response = object(value);
    return {
      remoteJobId: requiredId(response.id, "Seedance"),
      status: status(response.status),
      ...(typeof response.model === "string"
        ? { modelRevision: response.model }
        : {}),
      ...cleanError(response.error),
    };
  },
  parsePoll(value) {
    const response = object(value);
    const content = object(response.content);
    const output = object(response.output);
    const outputUrl =
      typeof content.video_url === "string"
        ? content.video_url
        : typeof content.url === "string"
          ? content.url
          : typeof output.url === "string"
            ? output.url
            : undefined;
    return {
      remoteJobId: requiredId(response.id, "Seedance"),
      status: status(response.status),
      ...(outputUrl ? { outputUrl } : {}),
      ...(typeof response.model === "string"
        ? { modelRevision: response.model }
        : {}),
      ...cleanError(response.error),
    };
  },
};

export function videoProviderAdapter(
  provider: ConfiguredProvider,
): MediaVideoProviderAdapter | undefined {
  const protocol = provider.protocol?.trim().toLowerCase() ?? "";
  const model = provider.model.trim().toLowerCase();
  if (
    ["seedance", "volcengine-ark-contents-generation"].includes(protocol) ||
    model.includes("seedance")
  )
    return seedance;
  if (
    ["minimax-h3-cloud", "minimax h3"].includes(protocol) ||
    model === "minimax-h3" ||
    model === "minimax-h3-max"
  )
    return minimaxH3;
  return undefined;
}
