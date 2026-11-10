/**
 * The shapes the structure operations declare.
 *
 * @module @dramaip/production-production/wire/structure
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/structureReorderEpisodes` (`production-structure.reorderEpisodes`). */
export type StructureReorderEpisodesInput = {
  items: {
    id: string;
    version: number;
  }[];
};

/** Answer of `production/structureReorderEpisodes` (`production-structure.reorderEpisodes`). */
export type StructureReorderEpisodesResult = {
  records: {
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
};

/** Input of `production/structureReorderScenes` (`production-structure.reorderScenes`). */
export type StructureReorderScenesInput = {
  items: {
    id: string;
    version: number;
  }[];
};

/** Answer of `production/structureReorderScenes` (`production-structure.reorderScenes`). */
export type StructureReorderScenesResult = {
  records: {
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
};

/** Input of `production/structureReorderShots` (`production-structure.reorderShots`). */
export type StructureReorderShotsInput = {
  items: {
    id: string;
    version: number;
  }[];
};

/** Answer of `production/structureReorderShots` (`production-structure.reorderShots`). */
export type StructureReorderShotsResult = {
  records: {
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
};

/** Input of `production/structureSelectCurrentAdaptation` (`production-structure.selectCurrentAdaptation`). */
export type StructureSelectCurrentAdaptationInput = {
  adaptationId: string;
};

/** Answer of `production/structureSelectCurrentAdaptation` (`production-structure.selectCurrentAdaptation`). */
export type StructureSelectCurrentAdaptationResult = JsonValue;
