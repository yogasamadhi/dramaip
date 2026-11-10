/**
 * The shapes the adaptation operations declare.
 *
 * @module @dramaip/production-production/wire/adaptations
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/adaptationsCreate` (`adaptations.create`). */
export type AdaptationsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `production/adaptationsCreate` (`adaptations.create`). */
export type AdaptationsCreateResult = {
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

/** Answer of `production/adaptationsGet` (`adaptations.get`). */
export type AdaptationsGetResult = {
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

/** Query of `production/adaptationsList` (`adaptations.list`). */
export type AdaptationsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `production/adaptationsList` (`adaptations.list`). */
export type AdaptationsListResult = {
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

/** Input of `production/adaptationsUpdate` (`adaptations.update`). */
export type AdaptationsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `production/adaptationsUpdate` (`adaptations.update`). */
export type AdaptationsUpdateResult = {
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
