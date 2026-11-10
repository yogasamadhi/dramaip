/**
 * The shapes the scene operations declare.
 *
 * @module @dramaip/production-production/wire/scenes
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/scenesCreate` (`scenes.create`). */
export type ScenesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `production/scenesCreate` (`scenes.create`). */
export type ScenesCreateResult = {
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

/** Answer of `production/scenesGet` (`scenes.get`). */
export type ScenesGetResult = {
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

/** Query of `production/scenesList` (`scenes.list`). */
export type ScenesListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `production/scenesList` (`scenes.list`). */
export type ScenesListResult = {
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

/** Input of `production/scenesUpdate` (`scenes.update`). */
export type ScenesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `production/scenesUpdate` (`scenes.update`). */
export type ScenesUpdateResult = {
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
