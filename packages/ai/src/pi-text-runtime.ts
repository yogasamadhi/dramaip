/** Provider settings shared by the Pi agent and the text-only model caller. */
export interface PiTextProvider {
  /** Native Pi provider id; absent only for a manually configured endpoint. */
  piProviderId?: string;
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
}

/** One model request with no tools, filesystem access, or session state. */
export interface PiTextRequest {
  provider: PiTextProvider;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  onTextDelta?(delta: string): void;
}

/** Pi's native response accounting keeps cached input separate. */
export interface PiTextResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    inputAccounting: "excludes-cache";
  };
}

/** Pi's compaction result without exposing the private conversation summary. */
export interface PiCompactionResult {
  compacted: boolean;
  tokensBefore?: number;
  usage?: PiTextResponse["usage"];
}
