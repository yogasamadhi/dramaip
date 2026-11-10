/**
 * The shapes the season plan operations declare.
 *
 * @module @dramaip/production-production/wire/season-plans
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/seasonPlansAdopt` (`seasonPlans.adopt`). */
export type SeasonPlansAdoptInput = {
  confirmed: true;
};

/** Answer of `production/seasonPlansAdopt` (`seasonPlans.adopt`). */
export type SeasonPlansAdoptResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  sourcePlanId?: string;
  origin: "model" | "human-reorder";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    theme: string;
    mainConflict: string;
    emotionalPromise: string;
    episodes: {
      id: string;
      orderIndex: number;
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      sourceChapters: {
        id: string;
        version: number;
        adaptationAction: "preserve" | "merge" | "reorder" | "restructure";
        rationale: string;
      }[];
      characterProgress: {
        character: string;
        before: string;
        after: string;
        relationshipChange: string;
      }[];
      plantedForeshadowing: string[];
      paidOffForeshadowing: string[];
      estimatedScenes: number;
      estimatedCharacters: number;
      durationSeconds: number;
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
    omittedSources: {
      id: string;
      version: number;
      reason: string;
    }[];
    risks: string[];
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
      strategyId: string;
    };
    diagnosisContentHash: string;
    strategy?: {
      id: string;
      version: number;
      optionId: string;
    };
    strategyContentHash?: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  coverage: {
    chapterId: string;
    chapterVersion: number;
    episodeIds: string[];
    disposition: "used" | "omitted" | "unaccounted";
    omissionReason?: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `production/seasonPlansDiscard` (`seasonPlans.discard`). */
export type SeasonPlansDiscardInput = Record<string, JsonValue>;

/** Answer of `production/seasonPlansDiscard` (`seasonPlans.discard`). */
export type SeasonPlansDiscardResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  sourcePlanId?: string;
  origin: "model" | "human-reorder";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    theme: string;
    mainConflict: string;
    emotionalPromise: string;
    episodes: {
      id: string;
      orderIndex: number;
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      sourceChapters: {
        id: string;
        version: number;
        adaptationAction: "preserve" | "merge" | "reorder" | "restructure";
        rationale: string;
      }[];
      characterProgress: {
        character: string;
        before: string;
        after: string;
        relationshipChange: string;
      }[];
      plantedForeshadowing: string[];
      paidOffForeshadowing: string[];
      estimatedScenes: number;
      estimatedCharacters: number;
      durationSeconds: number;
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
    omittedSources: {
      id: string;
      version: number;
      reason: string;
    }[];
    risks: string[];
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
      strategyId: string;
    };
    diagnosisContentHash: string;
    strategy?: {
      id: string;
      version: number;
      optionId: string;
    };
    strategyContentHash?: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  coverage: {
    chapterId: string;
    chapterVersion: number;
    episodeIds: string[];
    disposition: "used" | "omitted" | "unaccounted";
    omissionReason?: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `production/seasonPlansGet` (`seasonPlans.get`). */
export type SeasonPlansGetResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  sourcePlanId?: string;
  origin: "model" | "human-reorder";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    theme: string;
    mainConflict: string;
    emotionalPromise: string;
    episodes: {
      id: string;
      orderIndex: number;
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      sourceChapters: {
        id: string;
        version: number;
        adaptationAction: "preserve" | "merge" | "reorder" | "restructure";
        rationale: string;
      }[];
      characterProgress: {
        character: string;
        before: string;
        after: string;
        relationshipChange: string;
      }[];
      plantedForeshadowing: string[];
      paidOffForeshadowing: string[];
      estimatedScenes: number;
      estimatedCharacters: number;
      durationSeconds: number;
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
    omittedSources: {
      id: string;
      version: number;
      reason: string;
    }[];
    risks: string[];
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
      strategyId: string;
    };
    diagnosisContentHash: string;
    strategy?: {
      id: string;
      version: number;
      optionId: string;
    };
    strategyContentHash?: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  coverage: {
    chapterId: string;
    chapterVersion: number;
    episodeIds: string[];
    disposition: "used" | "omitted" | "unaccounted";
    omissionReason?: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `production/seasonPlansList` (`seasonPlans.list`). */
export type SeasonPlansListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/seasonPlansList` (`seasonPlans.list`). */
export type SeasonPlansListResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    sourcePlanId?: string;
    origin: "model" | "human-reorder";
    content: {
      reviewedSources?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      theme: string;
      mainConflict: string;
      emotionalPromise: string;
      episodes: {
        id: string;
        orderIndex: number;
        title: string;
        logline: string;
        goal: string;
        mainConflict: string;
        turningPoint: string;
        endingHook: string;
        sourceChapters: {
          id: string;
          version: number;
          adaptationAction: "preserve" | "merge" | "reorder" | "restructure";
          rationale: string;
        }[];
        characterProgress: {
          character: string;
          before: string;
          after: string;
          relationshipChange: string;
        }[];
        plantedForeshadowing: string[];
        paidOffForeshadowing: string[];
        estimatedScenes: number;
        estimatedCharacters: number;
        durationSeconds: number;
        productionRisk: "low" | "medium" | "high" | "unknown";
        productionNotes: string;
      }[];
      omittedSources: {
        id: string;
        version: number;
        reason: string;
      }[];
      risks: string[];
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
        strategyId: string;
      };
      diagnosisContentHash: string;
      strategy?: {
        id: string;
        version: number;
        optionId: string;
      };
      strategyContentHash?: string;
      authorIntent: {
        id: string;
        version: number;
      };
      baseAdoptedId?: string;
    };
    coverage: {
      chapterId: string;
      chapterVersion: number;
      episodeIds: string[];
      disposition: "used" | "omitted" | "unaccounted";
      omissionReason?: string;
    }[];
    sourceSnapshotId: string;
    runIds: string[];
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

/** Input of `production/seasonPlansReorder` (`seasonPlans.reorder`). */
export type SeasonPlansReorderInput = {
  episodeIds: string[];
  confirmed: true;
};

/** Answer of `production/seasonPlansReorder` (`seasonPlans.reorder`). */
export type SeasonPlansReorderResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  sourcePlanId?: string;
  origin: "model" | "human-reorder";
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    theme: string;
    mainConflict: string;
    emotionalPromise: string;
    episodes: {
      id: string;
      orderIndex: number;
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      sourceChapters: {
        id: string;
        version: number;
        adaptationAction: "preserve" | "merge" | "reorder" | "restructure";
        rationale: string;
      }[];
      characterProgress: {
        character: string;
        before: string;
        after: string;
        relationshipChange: string;
      }[];
      plantedForeshadowing: string[];
      paidOffForeshadowing: string[];
      estimatedScenes: number;
      estimatedCharacters: number;
      durationSeconds: number;
      productionRisk: "low" | "medium" | "high" | "unknown";
      productionNotes: string;
    }[];
    omittedSources: {
      id: string;
      version: number;
      reason: string;
    }[];
    risks: string[];
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
      strategyId: string;
    };
    diagnosisContentHash: string;
    strategy?: {
      id: string;
      version: number;
      optionId: string;
    };
    strategyContentHash?: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  coverage: {
    chapterId: string;
    chapterVersion: number;
    episodeIds: string[];
    disposition: "used" | "omitted" | "unaccounted";
    omissionReason?: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `production/seasonPlansSources` (`seasonPlans.sources`). */
export type SeasonPlansSourcesResult = {
  projectId: string;
  diagnosis?: {
    id: string;
    version: number;
    strategyId: string;
  };
  strategy?: {
    id: string;
    version: number;
    optionId: string;
  };
  strategyPath?: "independent" | "legacy-diagnosis";
  adoptedPlanId?: string;
};

/** Query of `production/seasonPlansSummaries` (`seasonPlans.summaries`). */
export type SeasonPlansSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/seasonPlansSummaries` (`seasonPlans.summaries`). */
export type SeasonPlansSummariesResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    sourcePlanId?: string;
    origin: "model" | "human-reorder";
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};
