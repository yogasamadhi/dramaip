/**
 * The wire types of the namespace, one module per operation family.
 *
 * Every family lives in its own module; this entry point re-exports
 * them, so an importer names the namespace and not the family.
 * @module @dramaip/production-production/wire
 */

export type {
  AdaptationsCreateInput,
  AdaptationsCreateResult,
  AdaptationsGetResult,
  AdaptationsListQuery,
  AdaptationsListResult,
  AdaptationsUpdateInput,
  AdaptationsUpdateResult,
} from "./wire/adaptations.js";

export type {
  AdaptationStrategiesAdoptInput,
  AdaptationStrategiesAdoptResult,
  AdaptationStrategiesDiscardInput,
  AdaptationStrategiesDiscardResult,
  AdaptationStrategiesGetResult,
  AdaptationStrategiesListQuery,
  AdaptationStrategiesListResult,
  AdaptationStrategiesSourcesResult,
  AdaptationStrategiesSummariesQuery,
  AdaptationStrategiesSummariesResult,
} from "./wire/adaptation-strategies.js";

export type {
  DiagnosesAdoptInput,
  DiagnosesAdoptResult,
  DiagnosesDiscardInput,
  DiagnosesDiscardResult,
  DiagnosesGetResult,
  DiagnosesListQuery,
  DiagnosesListResult,
  DiagnosesSourcesResult,
  DiagnosesSummariesQuery,
  DiagnosesSummariesResult,
} from "./wire/diagnoses.js";

export type {
  EpisodeDevelopmentsAdoptScriptRevisionInput,
  EpisodeDevelopmentsAdoptScriptRevisionResult,
  EpisodeDevelopmentsDiscardScriptRevisionInput,
  EpisodeDevelopmentsDiscardScriptRevisionResult,
  EpisodeDevelopmentsGetScriptRevisionResult,
  EpisodeDevelopmentsListScriptRevisionsQuery,
  EpisodeDevelopmentsListScriptRevisionsResult,
  EpisodeDevelopmentsPreviewScriptRevisionInput,
  EpisodeDevelopmentsPreviewScriptRevisionResult,
  EpisodeDevelopmentsScriptRevisionSummariesQuery,
  EpisodeDevelopmentsScriptRevisionSummariesResult,
} from "./wire/episode-development-script-revision.js";

export type {
  EpisodeDevelopmentsAdoptSourceRevisionInput,
  EpisodeDevelopmentsAdoptSourceRevisionResult,
  EpisodeDevelopmentsDiscardSourceRevisionInput,
  EpisodeDevelopmentsDiscardSourceRevisionResult,
  EpisodeDevelopmentsGetSourceRevisionResult,
  EpisodeDevelopmentsGetSourceRevisionContextResult,
  EpisodeDevelopmentsListSourceRevisionsQuery,
  EpisodeDevelopmentsListSourceRevisionsResult,
  EpisodeDevelopmentsPreviewSourceRevisionInput,
  EpisodeDevelopmentsPreviewSourceRevisionResult,
  EpisodeDevelopmentsSourceRevisionSummariesQuery,
  EpisodeDevelopmentsSourceRevisionSummariesResult,
} from "./wire/episode-development-source-revision.js";

export type {
  EpisodeDevelopmentsAdoptTopologyRevisionInput,
  EpisodeDevelopmentsAdoptTopologyRevisionResult,
  EpisodeDevelopmentsDiscardTopologyRevisionInput,
  EpisodeDevelopmentsDiscardTopologyRevisionResult,
  EpisodeDevelopmentsGetTopologyRevisionResult,
  EpisodeDevelopmentsListTopologyRevisionsQuery,
  EpisodeDevelopmentsListTopologyRevisionsResult,
  EpisodeDevelopmentsPreviewTopologyRevisionInput,
  EpisodeDevelopmentsPreviewTopologyRevisionResult,
  EpisodeDevelopmentsTopologyRevisionSummariesQuery,
  EpisodeDevelopmentsTopologyRevisionSummariesResult,
} from "./wire/episode-development-topology-revision.js";

export type {
  EpisodeDevelopmentsGetResult,
  EpisodeDevelopmentsImpactQuery,
  EpisodeDevelopmentsImpactResult,
  EpisodeDevelopmentsListQuery,
  EpisodeDevelopmentsListResult,
  EpisodeDevelopmentsSourcesResult,
  EpisodeDevelopmentsSummariesQuery,
  EpisodeDevelopmentsSummariesResult,
} from "./wire/episode-development.js";

export type {
  EpisodesCreateInput,
  EpisodesCreateResult,
  EpisodesGetResult,
  EpisodesListQuery,
  EpisodesListResult,
  EpisodesUpdateInput,
  EpisodesUpdateResult,
} from "./wire/episodes.js";

export type {
  StructureReorderEpisodesInput,
  StructureReorderEpisodesResult,
  StructureReorderScenesInput,
  StructureReorderScenesResult,
  StructureReorderShotsInput,
  StructureReorderShotsResult,
  StructureSelectCurrentAdaptationInput,
  StructureSelectCurrentAdaptationResult,
} from "./wire/structure.js";

export type {
  GraphResult,
} from "./wire/graph.js";

export type {
  ImpactInput,
  ImpactResult,
} from "./wire/impact.js";

export type {
  ProductionQualitySourcesGetResult,
  ProductionQualitySourcesListQuery,
  ProductionQualitySourcesListResult,
} from "./wire/quality-sources.js";

export type {
  ProjectsProgressQuery,
  ProjectsProgressResult,
} from "./wire/project-progress.js";

export type {
  ScenesCreateInput,
  ScenesCreateResult,
  ScenesGetResult,
  ScenesListQuery,
  ScenesListResult,
  ScenesUpdateInput,
  ScenesUpdateResult,
} from "./wire/scenes.js";

export type {
  ScreenplayImportCommitInput,
  ScreenplayImportCommitResult,
  ScreenplayImportCreatePreviewInput,
  ScreenplayImportCreatePreviewResult,
  ScreenplayImportDiscardResult,
  ScreenplayImportGetPreviewResult,
} from "./wire/screenplay-import.js";

export type {
  ScreenplayIntakesCommitInput,
  ScreenplayIntakesCommitResult,
  ScreenplayIntakesDiscardResult,
  ScreenplayIntakesGetResult,
  ScreenplayIntakesPreviewInput,
  ScreenplayIntakesPreviewResult,
} from "./wire/screenplay-intakes.js";

export type {
  ScreenplaySourcesGetResult,
  ScreenplaySourcesListQuery,
  ScreenplaySourcesListResult,
} from "./wire/screenplay-sources.js";

export type {
  ScreenplaysExportResult,
  ScreenplaysGetResult,
  ScreenplaysUpdateInput,
  ScreenplaysUpdateResult,
} from "./wire/screenplays.js";

export type {
  ScriptsCreateInput,
  ScriptsCreateResult,
  ScriptsGetResult,
  ScriptsListQuery,
  ScriptsListResult,
  ScriptsUpdateInput,
  ScriptsUpdateResult,
} from "./wire/scripts.js";

export type {
  SeasonPlansAdoptInput,
  SeasonPlansAdoptResult,
  SeasonPlansDiscardInput,
  SeasonPlansDiscardResult,
  SeasonPlansGetResult,
  SeasonPlansListQuery,
  SeasonPlansListResult,
  SeasonPlansReorderInput,
  SeasonPlansReorderResult,
  SeasonPlansSourcesResult,
  SeasonPlansSummariesQuery,
  SeasonPlansSummariesResult,
} from "./wire/season-plans.js";

export type {
  SeasonsCreateInput,
  SeasonsCreateResult,
  SeasonsListQuery,
  SeasonsListResult,
  SeasonsMapChapterInput,
  SeasonsMapChapterResult,
  SeasonsUpdateInput,
  SeasonsUpdateResult,
} from "./wire/seasons.js";

export type {
  ShotsCreateInput,
  ShotsCreateResult,
  ShotsGetResult,
  ShotsListQuery,
  ShotsListResult,
  ShotsUpdateInput,
  ShotsUpdateResult,
} from "./wire/shots.js";

export type {
  StoryboardAttributionCreateInput,
  StoryboardAttributionCreateResult,
  StoryboardAttributionDecideInput,
  StoryboardAttributionDecideResult,
  StoryboardAttributionGetResult,
  StoryboardAttributionListQuery,
  StoryboardAttributionListResult,
  StoryboardAttributionSourcesQuery,
  StoryboardAttributionSourcesResult,
  StoryboardAttributionSummariesQuery,
  StoryboardAttributionSummariesResult,
} from "./wire/storyboard-attribution.js";
