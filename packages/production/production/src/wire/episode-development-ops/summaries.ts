/**
 * The shapes the episode development summaries operation declares.
 *
 * @module @dramaip/production-production/wire/episode-development-ops/summaries
 */
/** Query of `production/episodeDevelopmentsSummaries` (`episodeDevelopments.summaries`). */
export type EpisodeDevelopmentsSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/episodeDevelopmentsSummaries` (`episodeDevelopments.summaries`). */
export type EpisodeDevelopmentsSummariesResult = {
  items: {
    id: string;
    projectId: string;
    workflowId?: string;
    origin:
      | "model"
      | "human-script-revision"
      | "human-topology-revision"
      | "human-source-revision";
    episodeId: string;
    operation: "episode-outline" | "episode-script" | "storyboard-package";
    version: number;
    adoptedAt: string;
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasonCount: number;
  }[];
  nextCursor?: string;
};
