/**
 * The shapes the episode operations declare.
 *
 * @module @dramaip/production-production/wire/episodes
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/episodesCreate` (`episodes.create`). */
export type EpisodesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `production/episodesCreate` (`episodes.create`). */
export type EpisodesCreateResult = {
  id: string;
  kind: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  domain: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  retirement?: {
    resultId: string;
    retiredAt: string;
    reason: "author-scene-shot-plan" | "author-scene-topology-plan";
  };
};

/** Answer of `production/episodesGet` (`episodes.get`). */
export type EpisodesGetResult = {
  id: string;
  kind: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  domain: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  retirement?: {
    resultId: string;
    retiredAt: string;
    reason: "author-scene-shot-plan" | "author-scene-topology-plan";
  };
};

/** Query of `production/episodesList` (`episodes.list`). */
export type EpisodesListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `production/episodesList` (`episodes.list`). */
export type EpisodesListResult = {
  id: string;
  kind: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  domain: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  retirement?: {
    resultId: string;
    retiredAt: string;
    reason: "author-scene-shot-plan" | "author-scene-topology-plan";
  };
}[];

/** Input of `production/episodesUpdate` (`episodes.update`). */
export type EpisodesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `production/episodesUpdate` (`episodes.update`). */
export type EpisodesUpdateResult = {
  id: string;
  kind: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  domain: "adaptations" | "episodes" | "scripts" | "scenes" | "shots";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  retirement?: {
    resultId: string;
    retiredAt: string;
    reason: "author-scene-shot-plan" | "author-scene-topology-plan";
  };
};
