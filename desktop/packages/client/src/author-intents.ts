import type {
  AuthorIntent,
  AuthorIntentCurrent,
  AuthorIntentPage,
  AuthorIntentPreviewInput,
  AuthorIntentSourceCatalog,
} from "@dramaip/contracts/workspace";

export interface AuthorIntentClient {
  sources(projectId: string): Promise<AuthorIntentSourceCatalog>;
  current(projectId: string): Promise<AuthorIntentCurrent>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<AuthorIntentPage>;
  get(id: string): Promise<AuthorIntent>;
  preview(
    projectId: string,
    input: AuthorIntentPreviewInput,
    key: string,
  ): Promise<AuthorIntent>;
  adopt(id: string, stateVersion: number, key: string): Promise<AuthorIntent>;
  discard(id: string, stateVersion: number, key: string): Promise<AuthorIntent>;
}
export function createAuthorIntentClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): AuthorIntentClient {
  const projectPath = (id: string) =>
    `/api/v2/projects/${encodeURIComponent(id)}`;
  const intentPath = (id: string) =>
    `/api/v2/author-intents/${encodeURIComponent(id)}`;
  const transition = (
    id: string,
    action: "adopt" | "discard",
    stateVersion: number,
    key: string,
  ): Promise<AuthorIntent> =>
    request(`${intentPath(id)}/${action}`, {
      method: "POST",
      headers: { "If-Match": `"${stateVersion}"`, "Idempotency-Key": key },
      body: JSON.stringify(action === "adopt" ? { confirmed: true } : {}),
    });
  return {
    sources: (id) => request(`${projectPath(id)}/author-intent-sources`),
    current: (id) => request(`${projectPath(id)}/author-intent`),
    list: (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return request(
        `${projectPath(id)}/author-intents${query.size ? `?${query}` : ""}`,
      );
    },
    get: (id) => request(intentPath(id)),
    preview: (id, input, key) =>
      request(`${projectPath(id)}/author-intents`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(input),
      }),
    adopt: (id, version, key) => transition(id, "adopt", version, key),
    discard: (id, version, key) => transition(id, "discard", version, key),
  };
}
