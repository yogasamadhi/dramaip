/**
 * The wire types of the namespace, one module per operation.
 *
 * Every operation lives in its own module; this entry point
 * re-exports them, so an importer names the namespace and not
 * the operation.
 * @module @dramaip/production-production/wire
 */

export type {
  EpisodeDevelopmentsGetResult,
} from "./episode-development-ops/get.js";

export type {
  EpisodeDevelopmentsListQuery,
  EpisodeDevelopmentsListResult,
} from "./episode-development-ops/list.js";

export type {
  EpisodeDevelopmentsSourcesResult,
} from "./episode-development-ops/sources.js";

export type {
  EpisodeDevelopmentsImpactQuery,
  EpisodeDevelopmentsImpactResult,
} from "./episode-development-ops/impact.js";

export type {
  EpisodeDevelopmentsSummariesQuery,
  EpisodeDevelopmentsSummariesResult,
} from "./episode-development-ops/summaries.js";
