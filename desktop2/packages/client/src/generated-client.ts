import createClient from "openapi-fetch";

import type { paths } from "./generated/schema.ts";

export interface GeneratedClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: typeof globalThis.fetch;
}

export function createGeneratedClient(config: GeneratedClientConfig) {
  const authorization = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  return createClient<paths>({
    baseUrl: config.baseUrl,
    fetch: config.fetch,
    headers: { authorization },
  });
}
