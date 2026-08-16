import type { ProblemDetails } from "@dramaip/contracts";

export * from "./generated-client.ts";

export interface ClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: typeof globalThis.fetch;
}

export class ApiClientError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
    this.name = "ApiClientError";
  }
}

export class StudioClient {
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly authorization: string;

  constructor(private readonly config: ClientConfig) {
    this.fetchImplementation =
      config.fetch ?? globalThis.fetch.bind(globalThis);
    this.authorization = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }

  async request<T>(
    path: `/api/v2/${string}`,
    init: RequestInit = {},
  ): Promise<T> {
    return (await this.requestWithMetadata<T>(path, init)).data;
  }

  async requestWithMetadata<T>(
    path: `/api/v2/${string}`,
    init: RequestInit = {},
  ): Promise<{ data: T; response: Response }> {
    const headers = new Headers(init.headers);
    headers.set("authorization", this.authorization);
    if (init.body && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    const response = await this.fetchImplementation(
      new URL(path, this.config.baseUrl),
      { ...init, headers },
    );
    if (!response.ok)
      throw new ApiClientError((await response.json()) as ProblemDetails);
    if (response.status === 204) return { data: undefined as T, response };
    return { data: (await response.json()) as T, response };
  }

  async streamEvents(
    onEvent: (event: { id?: string; type: string; data: unknown }) => void,
    options: { signal?: AbortSignal; lastEventId?: string } = {},
  ): Promise<void> {
    const headers = new Headers({
      accept: "text/event-stream",
      authorization: this.authorization,
    });
    if (options.lastEventId) headers.set("last-event-id", options.lastEventId);
    const response = await this.fetchImplementation(
      new URL("/api/v2/events", this.config.baseUrl),
      { headers, signal: options.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`event stream failed with ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder
        .decode(result.value, { stream: true })
        .replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const fields = new Map<string, string[]>();
        for (const line of block.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          const separator = line.indexOf(":");
          const key = separator < 0 ? line : line.slice(0, separator);
          const value =
            separator < 0 ? "" : line.slice(separator + 1).replace(/^ /u, "");
          fields.set(key, [...(fields.get(key) ?? []), value]);
        }
        const data = (fields.get("data") ?? []).join("\n");
        if (data) {
          let parsed: unknown = data;
          try {
            parsed = JSON.parse(data) as unknown;
          } catch {
            // Non-JSON SSE payloads remain text.
          }
          onEvent({
            ...(fields.get("id")?.[0] ? { id: fields.get("id")![0] } : {}),
            type: fields.get("event")?.[0] ?? "message",
            data: parsed,
          });
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}
