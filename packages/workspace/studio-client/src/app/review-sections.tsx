/**
 * Transitional: what this app still owns of the review and delivery page.
 * The review client's page frame reads its project, adaptation and episode
 * scope from here until the native session state replaces it; the stages
 * themselves are native `review.stage` entries of the review client.
 */
export {
  type EpisodeRoute,
  type EpisodeScope,
  type ProductionScope,
  type ScopeRecord,
  useEpisodeScope,
  useProductionScope,
} from "./production-scope";
