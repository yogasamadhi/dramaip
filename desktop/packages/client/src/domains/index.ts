import type { StudioClient } from "../generated.js";

export type WorkspaceClient = Pick<
  StudioClient,
  "projects" | "series" | "search" | "sourceImports"
>;
export type WritingClient = Pick<
  StudioClient,
  "chapters" | "novelWorkspace" | "storyBible" | "resources"
>;
export type AgentsClient = Pick<
  StudioClient,
  | "agentSessions"
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
>;
export type MediaClient = Pick<
  StudioClient,
  | "episodeMedia"
  | "imageGeneration"
  | "ttsGeneration"
  | "videoGeneration"
  | "assetCenter"
>;
export type ReviewDeliveryClient = Pick<
  StudioClient,
  | "reviewEditor"
  | "cloudReview"
  | "compliance"
  | "delivery"
  | "platformDelivery"
>;
