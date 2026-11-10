import type { EpisodeDevelopmentRequest } from "@dramaip/contracts/production";

/** A saved confirmation is not permission to rebind to another adopted plan. */
export function seasonNarrativeRequestMatches(
  plan: { id: string; version: number } | undefined,
  hasMixedNarrative: boolean,
  request: EpisodeDevelopmentRequest,
): boolean {
  return (
    Boolean(plan) &&
    !request.direct &&
    plan!.id === request.seasonPlan?.id &&
    plan!.version === request.seasonPlan.version &&
    (request.episodeNarrativeContext
      ? !request.inheritSeasonNarrative
      : hasMixedNarrative === Boolean(request.inheritSeasonNarrative))
  );
}
