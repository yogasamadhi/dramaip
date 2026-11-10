/**
 * The shapes the screenplay import operations declare.
 *
 * @module @dramaip/production-production/wire/screenplay-import
 */

/** Input of `production/screenplayImportCommit` (`screenplayImport.commit`). */
export type ScreenplayImportCommitInput = {
  previewId: string;
  confirmation?: {
    rightsDeclared: true;
    lossReportReviewed: true;
  };
};

/** Answer of `production/screenplayImportCommit` (`screenplayImport.commit`). */
export type ScreenplayImportCommitResult = {
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

/** Input of `production/screenplayImportCreatePreview` (`screenplayImport.createPreview`). */
export type ScreenplayImportCreatePreviewInput = {
  projectId: string;
  parentId?: string;
  title: string;
  grantId: string;
  target?: {
    projectVersion: number;
    episodeVersion: number;
  };
};

/** Answer of `production/screenplayImportCreatePreview` (`screenplayImport.createPreview`). */
export type ScreenplayImportCreatePreviewResult = {
  previewId: string;
  projectId: string;
  parentId?: string;
  title: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "pdf";
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
  etag: string;
  status: "pending" | "committed" | "discarded";
  createdAt: string;
  target?: {
    projectVersion: number;
    episodeVersion: number;
  };
  receipt?: {
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    confirmation?: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
};

/** Answer of `production/screenplayImportDiscard` (`screenplayImport.discard`). */
export type ScreenplayImportDiscardResult = {
  previewId: string;
  projectId: string;
  parentId?: string;
  title: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "pdf";
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
  etag: string;
  status: "pending" | "committed" | "discarded";
  createdAt: string;
  target?: {
    projectVersion: number;
    episodeVersion: number;
  };
  receipt?: {
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    confirmation?: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
};

/** Answer of `production/screenplayImportGetPreview` (`screenplayImport.getPreview`). */
export type ScreenplayImportGetPreviewResult = {
  previewId: string;
  projectId: string;
  parentId?: string;
  title: string;
  sourceName: string;
  sourceFormat: "fountain" | "fdx" | "pdf";
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
  etag: string;
  status: "pending" | "committed" | "discarded";
  createdAt: string;
  target?: {
    projectVersion: number;
    episodeVersion: number;
  };
  receipt?: {
    scriptId: string;
    scriptVersion: number;
    documentId: string;
    documentVersion: number;
    committedAt: string;
    confirmation?: {
      rightsDeclared: true;
      lossReportReviewed: true;
    };
  };
};
