import type {
  EpisodeDevelopmentImpact,
  EpisodeDevelopmentResult,
  StoryboardAttributionImpactSelection,
} from "@dramaip/contracts/production";

export type EpisodeImpactReference = Pick<
  EpisodeDevelopmentResult,
  "id" | "version" | "projectId" | "episodeId"
>;

export function episodeImpactIdentityMatches(
  reference: EpisodeImpactReference,
  report: EpisodeDevelopmentImpact,
  attribution?: StoryboardAttributionImpactSelection,
): boolean {
  return (
    report.result.id === reference.id &&
    report.result.version === reference.version &&
    report.projectId === reference.projectId &&
    report.episodeId === reference.episodeId &&
    Boolean(report.attributionImpact) === Boolean(attribution) &&
    (!report.attributionImpact ||
      (report.attributionImpact.projectId === reference.projectId &&
        report.attributionImpact.episodeId === reference.episodeId &&
        report.attributionImpact.storyboard.id === reference.id &&
        report.attributionImpact.storyboard.version === reference.version &&
        report.attributionImpact.attribution.id === attribution?.id &&
        report.attributionImpact.attribution.version === attribution?.version))
  );
}

/** Cached comparisons never stand in for the explicit current owner read. */
export function currentEpisodeImpact(input: {
  reference: EpisodeImpactReference;
  report?: EpisodeDevelopmentImpact;
  opened: boolean;
  fetching: boolean;
  error: boolean;
  attribution?: StoryboardAttributionImpactSelection;
}): EpisodeDevelopmentImpact | undefined {
  return input.opened &&
    !input.fetching &&
    !input.error &&
    input.report &&
    episodeImpactIdentityMatches(
      input.reference,
      input.report,
      input.attribution,
    )
    ? input.report
    : undefined;
}
