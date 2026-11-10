/**
 * The shapes the screenplay source operations declare.
 *
 * @module @dramaip/production-production/wire/screenplay-sources
 */

/** Answer of `production/screenplaySourcesGet` (`screenplaySources.get`). */
export type ScreenplaySourcesGetResult = {
  projectId: string;
  scriptId: string;
  scriptVersion: number;
  parentId?: string;
  title: string;
  source:
    | {
        state: "available";
        contentHash: string;
        document: {
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
        policyDependencies: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
      }
    | {
        state: "unavailable";
        reason:
          | "saved-document-missing"
          | "invalid-saved-document"
          | "lineage-unavailable";
      };
};

/** Query of `production/screenplaySourcesList` (`screenplaySources.list`). */
export type ScreenplaySourcesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/screenplaySourcesList` (`screenplaySources.list`). */
export type ScreenplaySourcesListResult = {
  projectId: string;
  items: {
    projectId: string;
    scriptId: string;
    scriptVersion: number;
    parentId?: string;
    title: string;
    state: "available" | "unavailable";
  }[];
  nextCursor?: string;
};
