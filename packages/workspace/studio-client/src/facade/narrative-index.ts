import type {
  NarrativeIndexCatalog,
  NarrativeIndexDetail,
} from "@dramaip/contracts/knowledge";

export interface NarrativeIndexClient {
  catalog(projectId: string): Promise<NarrativeIndexCatalog>;
  chapter(projectId: string, chapterId: string): Promise<NarrativeIndexDetail>;
}
export function createNarrativeIndexClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): NarrativeIndexClient {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}/narrative-context-index`;
  return {
    catalog: (id) => request(path(id)),
    chapter: (id, chapterId) =>
      request(`${path(id)}/chapters/${encodeURIComponent(chapterId)}`),
  };
}
