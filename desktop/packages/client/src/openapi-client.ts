import createClient from "openapi-fetch";
import type { RuntimeTransport } from "@dramaip/server-connection";
import type { paths } from "./openapi.generated.js";

export function createGeneratedOpenApiClient(transport: RuntimeTransport) {
  return createClient<paths>({
    baseUrl: transport.baseUrl,
    fetch: transport.fetch,
  });
}

type GeneratedClient = ReturnType<typeof createGeneratedOpenApiClient>;

export async function requestGeneratedApi(
  client: GeneratedClient,
  path: string,
  init: RequestInit = {},
  parseAs?: "stream",
): Promise<{ response: Response; data?: unknown; error?: unknown }> {
  const method = String(init.method ?? "GET").toLowerCase();
  const body =
    typeof init.body === "string" && init.body
      ? (JSON.parse(init.body) as unknown)
      : undefined;
  const result = await (
    client.request as unknown as (
      method: string,
      path: string,
      options: Record<string, unknown>,
    ) => Promise<{ response: Response; data?: unknown; error?: unknown }>
  )(method, path, {
    ...(body === undefined ? {} : { body }),
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
    ...(parseAs ? { parseAs } : {}),
  });
  return result;
}

export async function openGeneratedEventStream(
  transport: RuntimeTransport,
  cursor: number,
  signal: AbortSignal,
): Promise<Response> {
  return transport.openEventStream(cursor, signal);
}
