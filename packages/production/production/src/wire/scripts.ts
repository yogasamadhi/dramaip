/**
 * The shapes the script operations declare.
 *
 * @module @dramaip/production-production/wire/scripts
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/scriptsCreate` (`scripts.create`). */
export type ScriptsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `production/scriptsCreate` (`scripts.create`). */
export type ScriptsCreateResult = {
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

/** Answer of `production/scriptsGet` (`scripts.get`). */
export type ScriptsGetResult = {
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

/** Query of `production/scriptsList` (`scripts.list`). */
export type ScriptsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `production/scriptsList` (`scripts.list`). */
export type ScriptsListResult = {
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

/** Input of `production/scriptsUpdate` (`scripts.update`). */
export type ScriptsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `production/scriptsUpdate` (`scripts.update`). */
export type ScriptsUpdateResult = {
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
