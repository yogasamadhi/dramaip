/**
 * The shapes the production quality source operations declare.
 *
 * @module @dramaip/production-production/wire/quality-sources
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `production/productionQualitySourcesGet` (`productionQualitySources.get`). */
export type ProductionQualitySourcesGetResult = {
  projectId: string;
  id: string;
  kind: "script" | "scene";
  version: number;
  title: string;
  parentId?: string;
  source:
    | {
        state: "available";
        contentHash: string;
        recordContentHash: string;
        record: {
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
        document?: {
          id: string;
          version: number;
          title: string;
          sourceFormat: "native" | "fountain" | "fdx" | "pdf";
          blocks: (
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "scene_heading";
                text: string;
                sceneNumber?: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "action";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "character";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "dialogue";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "parenthetical";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "transition";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "note";
                text: string;
              }
            | {
                id: string;
                sourceLocation?: {
                  line: number;
                  column?: number;
                };
                type: "page_break";
              }
          )[];
          lossReport: {
            unsupported: string[];
            warnings: string[];
            preserved: string[];
          };
        };
        documentContentHash?: string;
        ancestors: {
          id: string;
          kind: "adaptations" | "episodes" | "scripts";
          version: number;
          contentHash: string;
          document?: {
            id: string;
            version: number;
            contentHash: string;
          };
        }[];
        policyDependencies: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
      }
    | {
        state: "unavailable";
        reason:
          | "invalid-record"
          | "invalid-parent"
          | "empty-source"
          | "saved-document-missing"
          | "invalid-saved-document"
          | "lineage-unavailable";
      };
};

/** Query of `production/productionQualitySourcesList` (`productionQualitySources.list`). */
export type ProductionQualitySourcesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/productionQualitySourcesList` (`productionQualitySources.list`). */
export type ProductionQualitySourcesListResult = {
  projectId: string;
  items: {
    projectId: string;
    id: string;
    kind: "script" | "scene";
    version: number;
    title: string;
    parentId?: string;
    state: "available" | "unavailable";
  }[];
  nextCursor?: string;
};
