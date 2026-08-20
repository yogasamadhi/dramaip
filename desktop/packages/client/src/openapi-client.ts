import createClient from "openapi-fetch";
import type { RuntimeBootstrap } from "@dramaip/contracts";
import type { paths } from "./openapi.generated.js";

export function createGeneratedOpenApiClient(bootstrap: RuntimeBootstrap) {
  return createClient<paths>({
    baseUrl: bootstrap.baseUrl,
    headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
  });
}

type GeneratedClient = ReturnType<typeof createGeneratedOpenApiClient>;

export async function requestGeneratedApi(
  client: GeneratedClient,
  path: string,
  init: RequestInit = {},
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
  });
  return result;
}

export async function openGeneratedEventStream(
  bootstrap: RuntimeBootstrap,
  cursor: number,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(new URL(`/api/v2/events?cursor=${cursor}`, bootstrap.baseUrl), {
    headers: {
      Authorization: `Bearer ${bootstrap.accessToken}`,
      Accept: "text/event-stream",
      ...(cursor ? { "Last-Event-ID": String(cursor) } : {}),
    },
    signal,
  });
}
