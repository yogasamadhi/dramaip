/**
 * The shapes the screenplay operations declare.
 *
 * @module @dramaip/production-production/wire/screenplays
 */

/** Answer of `production/screenplaysExport` (`screenplays.export`). */
export type ScreenplaysExportResult = {
  fileName: string;
  mimeType: string;
  content: string;
  lossReport: {
    unsupported: string[];
    warnings: string[];
    preserved: string[];
  };
};

/** Answer of `production/screenplaysGet` (`screenplays.get`). */
export type ScreenplaysGetResult = {
  id: string;
  scriptId: string;
  projectId: string;
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
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `production/screenplaysUpdate` (`screenplays.update`). */
export type ScreenplaysUpdateInput = {
  title?: string;
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
  version: number;
};

/** Answer of `production/screenplaysUpdate` (`screenplays.update`). */
export type ScreenplaysUpdateResult = {
  id: string;
  scriptId: string;
  projectId: string;
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
  version: number;
  createdAt: string;
  updatedAt: string;
};
