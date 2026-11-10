/**
 * The shapes the storyboard attribution operations declare.
 *
 * @module @dramaip/production-production/wire/storyboard-attribution
 */

/** Input of `production/storyboardAttributionCreate` (`storyboardAttribution.create`). */
export type StoryboardAttributionCreateInput = {
  storyboard: {
    id: string;
    version: number;
  };
  sourceFingerprint: string;
  baseAttributionId: string | null;
  selections: {
    sceneId: string;
    shotId: string;
    blockIds: string[];
    evidenceId: string;
    matchIndex: number;
    storyNode?: {
      id: string;
      version: number;
    };
    rationale: string;
  }[];
};

/** Answer of `production/storyboardAttributionCreate` (`storyboardAttribution.create`). */
export type StoryboardAttributionCreateResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  origin: "human-declared";
  input: {
    storyboard: {
      id: string;
      version: number;
    };
    sourceFingerprint: string;
    baseAttributionId: string | null;
    selections: {
      sceneId: string;
      shotId: string;
      blockIds: string[];
      evidenceId: string;
      matchIndex: number;
      storyNode?: {
        id: string;
        version: number;
      };
      rationale: string;
    }[];
  };
  source: {
    format: "exact-shot-attribution-source-v1";
    projectId: string;
    episodeId: string;
    storyboard: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    outline: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    script: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    document: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    originalScriptDocument?: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    chapters: {
      id: string;
      version: number;
      contentHash: string;
    }[];
    scriptBlocks: {
      id: string;
      index: number;
      type:
        | "scene_heading"
        | "action"
        | "character"
        | "dialogue"
        | "parenthetical"
        | "transition"
        | "note"
        | "page_break";
    }[];
    shots: {
      sceneId: string;
      shotId: string;
      sceneRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      shotRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      sourceBlockIds: string[];
    }[];
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      matches: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      }[];
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
    }[];
    sourceFingerprint: string;
    baseAttributionId: string | null;
    semanticVerification: "unverified";
  };
  links: {
    sceneId: string;
    shotId: string;
    blockIds: string[];
    evidenceId: string;
    matchIndex: number;
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
      match: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      };
    };
    storyNode?: {
      node: {
        id: string;
        version: number;
      };
      declaration: {
        id: string;
        version: number;
      };
      referenceHash: string;
      linkKind:
        | "chapter-position"
        | "screenplay-block"
        | "adopted-fact-record-not-original-quote-position";
      semanticVerification: "unverified";
    };
    attribution: "human-declared";
    matchVerification: "rule";
    semanticVerification: "unverified";
  }[];
  coverage: {
    totalShots: number;
    associatedShots: number;
    nodeAssociatedShots: number;
    associatedBlockCount: number;
    unassociatedShotIds: string[];
  };
  associationFingerprint: string;
  isCurrent: boolean;
  sourceState: "current" | "stale" | "unavailable";
  sourceReasons: string[];
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
};

/** Input of `production/storyboardAttributionDecide` (`storyboardAttribution.decide`). */
export type StoryboardAttributionDecideInput = {
  version: number;
  sourceFingerprint: string;
  associationFingerprint: string;
  action: "adopt" | "discard";
  actualSourcesReviewed: true;
  exactShotLinksReviewed: true;
  unverifiedSemanticsAcknowledged: true;
};

/** Answer of `production/storyboardAttributionDecide` (`storyboardAttribution.decide`). */
export type StoryboardAttributionDecideResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  origin: "human-declared";
  input: {
    storyboard: {
      id: string;
      version: number;
    };
    sourceFingerprint: string;
    baseAttributionId: string | null;
    selections: {
      sceneId: string;
      shotId: string;
      blockIds: string[];
      evidenceId: string;
      matchIndex: number;
      storyNode?: {
        id: string;
        version: number;
      };
      rationale: string;
    }[];
  };
  source: {
    format: "exact-shot-attribution-source-v1";
    projectId: string;
    episodeId: string;
    storyboard: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    outline: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    script: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    document: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    originalScriptDocument?: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    chapters: {
      id: string;
      version: number;
      contentHash: string;
    }[];
    scriptBlocks: {
      id: string;
      index: number;
      type:
        | "scene_heading"
        | "action"
        | "character"
        | "dialogue"
        | "parenthetical"
        | "transition"
        | "note"
        | "page_break";
    }[];
    shots: {
      sceneId: string;
      shotId: string;
      sceneRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      shotRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      sourceBlockIds: string[];
    }[];
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      matches: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      }[];
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
    }[];
    sourceFingerprint: string;
    baseAttributionId: string | null;
    semanticVerification: "unverified";
  };
  links: {
    sceneId: string;
    shotId: string;
    blockIds: string[];
    evidenceId: string;
    matchIndex: number;
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
      match: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      };
    };
    storyNode?: {
      node: {
        id: string;
        version: number;
      };
      declaration: {
        id: string;
        version: number;
      };
      referenceHash: string;
      linkKind:
        | "chapter-position"
        | "screenplay-block"
        | "adopted-fact-record-not-original-quote-position";
      semanticVerification: "unverified";
    };
    attribution: "human-declared";
    matchVerification: "rule";
    semanticVerification: "unverified";
  }[];
  coverage: {
    totalShots: number;
    associatedShots: number;
    nodeAssociatedShots: number;
    associatedBlockCount: number;
    unassociatedShotIds: string[];
  };
  associationFingerprint: string;
  isCurrent: boolean;
  sourceState: "current" | "stale" | "unavailable";
  sourceReasons: string[];
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
};

/** Answer of `production/storyboardAttributionGet` (`storyboardAttribution.get`). */
export type StoryboardAttributionGetResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  origin: "human-declared";
  input: {
    storyboard: {
      id: string;
      version: number;
    };
    sourceFingerprint: string;
    baseAttributionId: string | null;
    selections: {
      sceneId: string;
      shotId: string;
      blockIds: string[];
      evidenceId: string;
      matchIndex: number;
      storyNode?: {
        id: string;
        version: number;
      };
      rationale: string;
    }[];
  };
  source: {
    format: "exact-shot-attribution-source-v1";
    projectId: string;
    episodeId: string;
    storyboard: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    outline: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    script: {
      id: string;
      version: number;
      contentHash: string;
      sourceSnapshotId: string;
    };
    document: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    originalScriptDocument?: {
      id: string;
      version: number;
      scriptId: string;
      scriptVersion: number;
      contentHash: string;
    };
    chapters: {
      id: string;
      version: number;
      contentHash: string;
    }[];
    scriptBlocks: {
      id: string;
      index: number;
      type:
        | "scene_heading"
        | "action"
        | "character"
        | "dialogue"
        | "parenthetical"
        | "transition"
        | "note"
        | "page_break";
    }[];
    shots: {
      sceneId: string;
      shotId: string;
      sceneRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      shotRecord: {
        id: string;
        version: number;
        contentHash: string;
      };
      sourceBlockIds: string[];
    }[];
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      matches: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      }[];
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
    }[];
    sourceFingerprint: string;
    baseAttributionId: string | null;
    semanticVerification: "unverified";
  };
  links: {
    sceneId: string;
    shotId: string;
    blockIds: string[];
    evidenceId: string;
    matchIndex: number;
    evidence: {
      sceneId: string;
      evidenceId: string;
      source: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      };
      valuePath: string;
      quoteHash: string;
      quoteCharacters: number;
      offsetUnit: "utf16-code-unit";
      paragraphId?: string;
      sourceBlockId?: string;
      attribution: "model-declared" | "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
      match: {
        start: number;
        end: number;
        chapterStart?: number;
        chapterEnd?: number;
      };
    };
    storyNode?: {
      node: {
        id: string;
        version: number;
      };
      declaration: {
        id: string;
        version: number;
      };
      referenceHash: string;
      linkKind:
        | "chapter-position"
        | "screenplay-block"
        | "adopted-fact-record-not-original-quote-position";
      semanticVerification: "unverified";
    };
    attribution: "human-declared";
    matchVerification: "rule";
    semanticVerification: "unverified";
  }[];
  coverage: {
    totalShots: number;
    associatedShots: number;
    nodeAssociatedShots: number;
    associatedBlockCount: number;
    unassociatedShotIds: string[];
  };
  associationFingerprint: string;
  isCurrent: boolean;
  sourceState: "current" | "stale" | "unavailable";
  sourceReasons: string[];
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
};

/** Query of `production/storyboardAttributionList` (`storyboardAttribution.list`). */
export type StoryboardAttributionListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/storyboardAttributionList` (`storyboardAttribution.list`). */
export type StoryboardAttributionListResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    version: number;
    status: "pending" | "adopted" | "discarded";
    origin: "human-declared";
    input: {
      storyboard: {
        id: string;
        version: number;
      };
      sourceFingerprint: string;
      baseAttributionId: string | null;
      selections: {
        sceneId: string;
        shotId: string;
        blockIds: string[];
        evidenceId: string;
        matchIndex: number;
        storyNode?: {
          id: string;
          version: number;
        };
        rationale: string;
      }[];
    };
    source: {
      format: "exact-shot-attribution-source-v1";
      projectId: string;
      episodeId: string;
      storyboard: {
        id: string;
        version: number;
        contentHash: string;
        sourceSnapshotId: string;
      };
      outline: {
        id: string;
        version: number;
        contentHash: string;
        sourceSnapshotId: string;
      };
      script: {
        id: string;
        version: number;
        contentHash: string;
        sourceSnapshotId: string;
      };
      document: {
        id: string;
        version: number;
        scriptId: string;
        scriptVersion: number;
        contentHash: string;
      };
      originalScriptDocument?: {
        id: string;
        version: number;
        scriptId: string;
        scriptVersion: number;
        contentHash: string;
      };
      chapters: {
        id: string;
        version: number;
        contentHash: string;
      }[];
      scriptBlocks: {
        id: string;
        index: number;
        type:
          | "scene_heading"
          | "action"
          | "character"
          | "dialogue"
          | "parenthetical"
          | "transition"
          | "note"
          | "page_break";
      }[];
      shots: {
        sceneId: string;
        shotId: string;
        sceneRecord: {
          id: string;
          version: number;
          contentHash: string;
        };
        shotRecord: {
          id: string;
          version: number;
          contentHash: string;
        };
        sourceBlockIds: string[];
      }[];
      evidence: {
        sceneId: string;
        evidenceId: string;
        source: {
          sourceKind:
            | "author_intent"
            | "production"
            | "chapter"
            | "knowledge"
            | "project";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          contentHash: string;
        };
        valuePath: string;
        quoteHash: string;
        quoteCharacters: number;
        offsetUnit: "utf16-code-unit";
        matches: {
          start: number;
          end: number;
          chapterStart?: number;
          chapterEnd?: number;
        }[];
        paragraphId?: string;
        sourceBlockId?: string;
        attribution: "model-declared" | "human-declared";
        matchVerification: "rule";
        semanticVerification: "unverified";
      }[];
      sourceFingerprint: string;
      baseAttributionId: string | null;
      semanticVerification: "unverified";
    };
    links: {
      sceneId: string;
      shotId: string;
      blockIds: string[];
      evidenceId: string;
      matchIndex: number;
      evidence: {
        sceneId: string;
        evidenceId: string;
        source: {
          sourceKind:
            | "author_intent"
            | "production"
            | "chapter"
            | "knowledge"
            | "project";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          contentHash: string;
        };
        valuePath: string;
        quoteHash: string;
        quoteCharacters: number;
        offsetUnit: "utf16-code-unit";
        paragraphId?: string;
        sourceBlockId?: string;
        attribution: "model-declared" | "human-declared";
        matchVerification: "rule";
        semanticVerification: "unverified";
        match: {
          start: number;
          end: number;
          chapterStart?: number;
          chapterEnd?: number;
        };
      };
      storyNode?: {
        node: {
          id: string;
          version: number;
        };
        declaration: {
          id: string;
          version: number;
        };
        referenceHash: string;
        linkKind:
          | "chapter-position"
          | "screenplay-block"
          | "adopted-fact-record-not-original-quote-position";
        semanticVerification: "unverified";
      };
      attribution: "human-declared";
      matchVerification: "rule";
      semanticVerification: "unverified";
    }[];
    coverage: {
      totalShots: number;
      associatedShots: number;
      nodeAssociatedShots: number;
      associatedBlockCount: number;
      unassociatedShotIds: string[];
    };
    associationFingerprint: string;
    isCurrent: boolean;
    sourceState: "current" | "stale" | "unavailable";
    sourceReasons: string[];
    createdAt: string;
    updatedAt: string;
    adoptedAt?: string;
  }[];
  nextCursor?: string;
};

/** Query of `production/storyboardAttributionSources` (`storyboardAttribution.sources`). */
export type StoryboardAttributionSourcesQuery = {
  version: number;
};

/** Answer of `production/storyboardAttributionSources` (`storyboardAttribution.sources`). */
export type StoryboardAttributionSourcesResult = {
  format: "exact-shot-attribution-source-v1";
  projectId: string;
  episodeId: string;
  storyboard: {
    id: string;
    version: number;
    contentHash: string;
    sourceSnapshotId: string;
  };
  outline: {
    id: string;
    version: number;
    contentHash: string;
    sourceSnapshotId: string;
  };
  script: {
    id: string;
    version: number;
    contentHash: string;
    sourceSnapshotId: string;
  };
  document: {
    id: string;
    version: number;
    scriptId: string;
    scriptVersion: number;
    contentHash: string;
  };
  originalScriptDocument?: {
    id: string;
    version: number;
    scriptId: string;
    scriptVersion: number;
    contentHash: string;
  };
  chapters: {
    id: string;
    version: number;
    contentHash: string;
  }[];
  scriptBlocks: {
    id: string;
    index: number;
    type:
      | "scene_heading"
      | "action"
      | "character"
      | "dialogue"
      | "parenthetical"
      | "transition"
      | "note"
      | "page_break";
  }[];
  shots: {
    sceneId: string;
    shotId: string;
    sceneRecord: {
      id: string;
      version: number;
      contentHash: string;
    };
    shotRecord: {
      id: string;
      version: number;
      contentHash: string;
    };
    sourceBlockIds: string[];
  }[];
  evidence: {
    sceneId: string;
    evidenceId: string;
    source: {
      sourceKind:
        "author_intent" | "production" | "chapter" | "knowledge" | "project";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
    };
    valuePath: string;
    quoteHash: string;
    quoteCharacters: number;
    offsetUnit: "utf16-code-unit";
    matches: {
      start: number;
      end: number;
      chapterStart?: number;
      chapterEnd?: number;
    }[];
    paragraphId?: string;
    sourceBlockId?: string;
    attribution: "model-declared" | "human-declared";
    matchVerification: "rule";
    semanticVerification: "unverified";
  }[];
  sourceFingerprint: string;
  baseAttributionId: string | null;
  semanticVerification: "unverified";
};

/** Query of `production/storyboardAttributionSummaries` (`storyboardAttribution.summaries`). */
export type StoryboardAttributionSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/storyboardAttributionSummaries` (`storyboardAttribution.summaries`). */
export type StoryboardAttributionSummariesResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    episodeId: string;
    version: number;
    status: "pending" | "adopted" | "discarded";
    storyboard: {
      id: string;
      version: number;
    };
    outline: {
      id: string;
      version: number;
    };
    script: {
      id: string;
      version: number;
    };
    coverage: {
      totalShots: number;
      associatedShots: number;
      nodeAssociatedShots: number;
      associatedBlockCount: number;
      unassociatedShotIds: string[];
    };
    sourceFingerprint: string;
    associationFingerprint: string;
    isCurrent: boolean;
    sourceState: "current" | "stale" | "unavailable";
    sourceReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};
