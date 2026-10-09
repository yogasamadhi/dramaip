import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";

export function productionReferencesForEpisodeResult(
  value: EpisodeDevelopmentResult | undefined,
  projectId: string,
): { episodeId?: string; scriptId?: string } | undefined {
  if (!value || value.projectId !== projectId || !value.episodeRecordId)
    return undefined;
  // Formal episodeId is a stable narrative key, not the owner record UUID.
  return {
    episodeId: value.episodeRecordId,
    ...(value.scriptId ? { scriptId: value.scriptId } : {}),
  };
}

// An exact result link is an identity, not a request to find a latest workflow
// or repair the saved generation basis.
export function matchesExactEpisodeResult(
  value: EpisodeDevelopmentResult | undefined,
  requested: {
    projectId: string;
    resultId: string;
    episodeId?: string | null;
    operation?: string | null;
    workflowId?: string | null;
  },
): value is EpisodeDevelopmentResult {
  return Boolean(
    value &&
    value.id === requested.resultId &&
    value.projectId === requested.projectId &&
    (!requested.episodeId || value.episodeId === requested.episodeId) &&
    (!requested.operation || value.operation === requested.operation) &&
    (!requested.workflowId || value.workflowId === requested.workflowId),
  );
}
