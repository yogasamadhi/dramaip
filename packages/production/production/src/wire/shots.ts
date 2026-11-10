/**
 * The shapes the shot operations declare.
 *
 * @module @dramaip/production-production/wire/shots
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/shotsCreate` (`shots.create`). */
export type ShotsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `production/shotsCreate` (`shots.create`). */
export type ShotsCreateResult = {
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

/** Answer of `production/shotsGet` (`shots.get`). */
export type ShotsGetResult = {
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

/** Query of `production/shotsList` (`shots.list`). */
export type ShotsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `production/shotsList` (`shots.list`). */
export type ShotsListResult = {
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

/** Input of `production/shotsUpdate` (`shots.update`). */
export type ShotsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `production/shotsUpdate` (`shots.update`). */
export type ShotsUpdateResult = {
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
