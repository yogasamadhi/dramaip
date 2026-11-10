/**
 * The shapes the adaptation strategy operations declare.
 *
 * @module @dramaip/production-production/wire/adaptation-strategies
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/adaptationStrategiesAdopt` (`adaptationStrategies.adopt`). */
export type AdaptationStrategiesAdoptInput = {
  confirmed: true;
  optionId: string;
};

/** Answer of `production/adaptationStrategiesAdopt` (`adaptationStrategies.adopt`). */
export type AdaptationStrategiesAdoptResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    options: {
      id: string;
      title: string;
      rationale: string;
      preserve: string[];
      merge: string[];
      remove: string[];
      reorder: string[];
      restructure: string[];
      rhythm: string;
      findingIds: string[];
      risks: string[];
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
  };
  basis: {
    scope: "whole-book" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    omittedChapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    rightsDeclared: true;
    target: {
      format: "short-drama" | "motion-comic";
      episodeCount: number;
      durationSeconds: number;
    };
    sourceBasis?: {
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
            contentHash: string;
          }
      )[];
      summaries?: {
        id: string;
        version: number;
        target: {
          id: string;
          version: number;
          kind: "book" | "volume" | "story-arc";
        };
        scopeTitle: string;
        scopeFingerprint: string;
        scopeState: "current" | "stale";
        chapters: {
          id: string;
          version: number;
          contentHash: string;
        }[];
      }[];
      story?: {
        selection: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        };
        sourceFingerprint: string;
        record: {
          kind: "node" | "edge" | "cognition";
          id: string;
          version: number;
        };
        sourceChapters: {
          id: string;
          version: number;
        }[];
        sourceScripts: {
          id: string;
          version: number;
        }[];
        contentHash: string;
      }[];
      omitted: {
        id: string;
        version: number;
        reason: "not-selected" | "empty";
      }[];
      references: {
        sourceKind: "chapter" | "knowledge";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      }[];
      kind: "author-selected-narrative-sources";
      projectId: string;
    };
    diagnosis: {
      id: string;
      version: number;
    };
    diagnosisContentHash: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  selectedOptionId?: string;
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `production/adaptationStrategiesDiscard` (`adaptationStrategies.discard`). */
export type AdaptationStrategiesDiscardInput = Record<string, JsonValue>;

/** Answer of `production/adaptationStrategiesDiscard` (`adaptationStrategies.discard`). */
export type AdaptationStrategiesDiscardResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    options: {
      id: string;
      title: string;
      rationale: string;
      preserve: string[];
      merge: string[];
      remove: string[];
      reorder: string[];
      restructure: string[];
      rhythm: string;
      findingIds: string[];
      risks: string[];
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
  };
  basis: {
    scope: "whole-book" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    omittedChapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    rightsDeclared: true;
    target: {
      format: "short-drama" | "motion-comic";
      episodeCount: number;
      durationSeconds: number;
    };
    sourceBasis?: {
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
            contentHash: string;
          }
      )[];
      summaries?: {
        id: string;
        version: number;
        target: {
          id: string;
          version: number;
          kind: "book" | "volume" | "story-arc";
        };
        scopeTitle: string;
        scopeFingerprint: string;
        scopeState: "current" | "stale";
        chapters: {
          id: string;
          version: number;
          contentHash: string;
        }[];
      }[];
      story?: {
        selection: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        };
        sourceFingerprint: string;
        record: {
          kind: "node" | "edge" | "cognition";
          id: string;
          version: number;
        };
        sourceChapters: {
          id: string;
          version: number;
        }[];
        sourceScripts: {
          id: string;
          version: number;
        }[];
        contentHash: string;
      }[];
      omitted: {
        id: string;
        version: number;
        reason: "not-selected" | "empty";
      }[];
      references: {
        sourceKind: "chapter" | "knowledge";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      }[];
      kind: "author-selected-narrative-sources";
      projectId: string;
    };
    diagnosis: {
      id: string;
      version: number;
    };
    diagnosisContentHash: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  selectedOptionId?: string;
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `production/adaptationStrategiesGet` (`adaptationStrategies.get`). */
export type AdaptationStrategiesGetResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    options: {
      id: string;
      title: string;
      rationale: string;
      preserve: string[];
      merge: string[];
      remove: string[];
      reorder: string[];
      restructure: string[];
      rhythm: string;
      findingIds: string[];
      risks: string[];
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
  };
  basis: {
    scope: "whole-book" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    omittedChapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    rightsDeclared: true;
    target: {
      format: "short-drama" | "motion-comic";
      episodeCount: number;
      durationSeconds: number;
    };
    sourceBasis?: {
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
            contentHash: string;
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
            contentHash: string;
          }
      )[];
      summaries?: {
        id: string;
        version: number;
        target: {
          id: string;
          version: number;
          kind: "book" | "volume" | "story-arc";
        };
        scopeTitle: string;
        scopeFingerprint: string;
        scopeState: "current" | "stale";
        chapters: {
          id: string;
          version: number;
          contentHash: string;
        }[];
      }[];
      story?: {
        selection: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        };
        sourceFingerprint: string;
        record: {
          kind: "node" | "edge" | "cognition";
          id: string;
          version: number;
        };
        sourceChapters: {
          id: string;
          version: number;
        }[];
        sourceScripts: {
          id: string;
          version: number;
        }[];
        contentHash: string;
      }[];
      omitted: {
        id: string;
        version: number;
        reason: "not-selected" | "empty";
      }[];
      references: {
        sourceKind: "chapter" | "knowledge";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        contentHash: string;
      }[];
      kind: "author-selected-narrative-sources";
      projectId: string;
    };
    diagnosis: {
      id: string;
      version: number;
    };
    diagnosisContentHash: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  selectedOptionId?: string;
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `production/adaptationStrategiesList` (`adaptationStrategies.list`). */
export type AdaptationStrategiesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/adaptationStrategiesList` (`adaptationStrategies.list`). */
export type AdaptationStrategiesListResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    content: {
      reviewedSources?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      summary: string;
      options: {
        id: string;
        title: string;
        rationale: string;
        preserve: string[];
        merge: string[];
        remove: string[];
        reorder: string[];
        restructure: string[];
        rhythm: string;
        findingIds: string[];
        risks: string[];
        productionRisk: "low" | "medium" | "high" | "unknown";
        productionNotes: string;
      }[];
    };
    basis: {
      scope: "whole-book" | "selected-chapters";
      chapters: {
        id: string;
        version: number;
        title: string;
        orderIndex: number;
        contentHash: string;
        narrativeContentHash?: string;
        characters: number;
      }[];
      omittedChapters: {
        id: string;
        version: number;
        title: string;
        orderIndex: number;
        contentHash: string;
        narrativeContentHash?: string;
        characters: number;
      }[];
      rightsDeclared: true;
      target: {
        format: "short-drama" | "motion-comic";
        episodeCount: number;
        durationSeconds: number;
      };
      sourceBasis?: {
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
              contentHash: string;
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
              contentHash: string;
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
              contentHash: string;
            }
        )[];
        summaries?: {
          id: string;
          version: number;
          target: {
            id: string;
            version: number;
            kind: "book" | "volume" | "story-arc";
          };
          scopeTitle: string;
          scopeFingerprint: string;
          scopeState: "current" | "stale";
          chapters: {
            id: string;
            version: number;
            contentHash: string;
          }[];
        }[];
        story?: {
          selection: {
            id: string;
            version: number;
            kind: "declaration" | "assertion";
          };
          sourceFingerprint: string;
          record: {
            kind: "node" | "edge" | "cognition";
            id: string;
            version: number;
          };
          sourceChapters: {
            id: string;
            version: number;
          }[];
          sourceScripts: {
            id: string;
            version: number;
          }[];
          contentHash: string;
        }[];
        omitted: {
          id: string;
          version: number;
          reason: "not-selected" | "empty";
        }[];
        references: {
          sourceKind: "chapter" | "knowledge";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          contentHash: string;
        }[];
        kind: "author-selected-narrative-sources";
        projectId: string;
      };
      diagnosis: {
        id: string;
        version: number;
      };
      diagnosisContentHash: string;
      authorIntent: {
        id: string;
        version: number;
      };
      baseAdoptedId?: string;
    };
    selectedOptionId?: string;
    sourceSnapshotId: string;
    runIds: string[];
    engineKind: "pi";
    model?: Record<string, JsonValue>;
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    adoptedAt?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Answer of `production/adaptationStrategiesSources` (`adaptationStrategies.sources`). */
export type AdaptationStrategiesSourcesResult = {
  projectId: string;
  diagnosis?: {
    id: string;
    version: number;
  };
  adoptedStrategyId?: string;
};

/** Query of `production/adaptationStrategiesSummaries` (`adaptationStrategies.summaries`). */
export type AdaptationStrategiesSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/adaptationStrategiesSummaries` (`adaptationStrategies.summaries`). */
export type AdaptationStrategiesSummariesResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};
