import type { StudioClient } from "../studio-client.js";

export type WorkspaceClient = Pick<
  StudioClient,
  "projects" | "series" | "search" | "sourceImports" | "authorIntents"
>;
export type WritingClient = Pick<
  StudioClient,
  | "chapters"
  | "novelWorkspace"
  | "storyBible"
  | "resources"
  | "narrativeIndex"
  | "narrativeSummaries"
>;
export type AgentsClient = Pick<
  StudioClient,
  | "agentSessions"
  | "agentUsage"
  | "assistantConversations"
  | "agentEngines"
  | "agentExperiments"
>;
export type ProductionClient = Pick<
  StudioClient,
  | "production"
  | "productionStructure"
  | "productionReviews"
  | "adaptationAnalysis"
  | "diagnoses"
  | "adaptationStrategies"
  | "seasonPlans"
  | "episodeDevelopments"
  | "screenplayImports"
  | "screenplayIntakes"
  | "screenplays"
>;
export type MediaClient = Pick<
  StudioClient,
  | "episodeMedia"
  | "imageGeneration"
  | "ttsGeneration"
  | "videoGeneration"
  | "assetCenter"
  | "mediaSources"
  | "audioRevisions"
  | "audioResolutions"
>;
export type ReviewDeliveryClient = Pick<
  StudioClient,
  | "reviewEditor"
  | "cloudReview"
  | "compliance"
  | "delivery"
  | "manuscripts"
  | "pilotPackages"
  | "platformDelivery"
>;
