import type { RuntimeTransport } from "../connection/index";

/** The Runtime routes the facade calls, reached over the transport's fetch. */
export interface RuntimeApi {
  baseUrl: string;
  fetch: typeof fetch;
}

export function createRuntimeApi(transport: RuntimeTransport): RuntimeApi {
  return { baseUrl: transport.baseUrl, fetch: transport.fetch };
}

/**
 * Sends one request. A 204 or empty answer has no data, a successful answer
 * is read as JSON (or handed back as a stream), and a failed one carries its
 * parsed body (or its text) as the error.
 */
export async function requestRuntimeApi(
  api: RuntimeApi,
  path: string,
  init: RequestInit = {},
  parseAs?: "stream",
): Promise<{ response: Response; data?: unknown; error?: unknown }> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await api.fetch(
    new Request(`${api.baseUrl.replace(/\/$/u, "")}${path}`, {
      ...init,
      method: String(init.method ?? "GET").toUpperCase(),
      headers,
    }),
  );
  if (response.status === 204 || response.headers.get("content-length") === "0")
    return response.ok
      ? { response, data: undefined }
      : { response, error: undefined };
  if (response.ok) {
    if (parseAs === "stream") return { response, data: response.body };
    return { response, data: await response.json() };
  }
  const text = await response.text();
  try {
    return { response, error: JSON.parse(text) as unknown };
  } catch {
    return { response, error: text };
  }
}

export async function openRuntimeEventStream(
  transport: RuntimeTransport,
  cursor: number,
  signal: AbortSignal,
): Promise<Response> {
  return transport.openEventStream(cursor, signal);
}
