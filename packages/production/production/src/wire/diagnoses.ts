/**
 * The shapes the adaptation diagnosis operations declare.
 *
 * @module @dramaip/production-production/wire/diagnoses
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `production/diagnosesAdopt` (`diagnoses.adopt`). */
export type DiagnosesAdoptInput = {
  confirmed: true;
  strategyId?: string;
};

/** Answer of `production/diagnosesAdopt` (`diagnoses.adopt`). */
export type DiagnosesAdoptResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  title: string;
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    theme: string;
    emotionalPromise: string;
    sellingPoints: string[];
    mainLine: string;
    characterArcs: string[];
    relationships: string[];
    findings: {
      id: string;
      kind: "hook" | "conflict" | "reversal" | "suspense" | "adaptation-risk";
      claim: string;
      evidence: {
        chapterId: string;
        chapterVersion: number;
        quote: string;
        source?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          valuePath: "/content" | "/summary";
        };
      }[];
      suggestion: string;
    }[];
    strategies: {
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
    baseAdoptedId?: string;
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
  };
  authorIntent: {
    id: string;
    version: number;
  };
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  assessmentSource: "model";
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  selectedStrategyId?: string;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `production/diagnosesDiscard` (`diagnoses.discard`). */
export type DiagnosesDiscardInput = Record<string, JsonValue>;

/** Answer of `production/diagnosesDiscard` (`diagnoses.discard`). */
export type DiagnosesDiscardResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  title: string;
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    theme: string;
    emotionalPromise: string;
    sellingPoints: string[];
    mainLine: string;
    characterArcs: string[];
    relationships: string[];
    findings: {
      id: string;
      kind: "hook" | "conflict" | "reversal" | "suspense" | "adaptation-risk";
      claim: string;
      evidence: {
        chapterId: string;
        chapterVersion: number;
        quote: string;
        source?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          valuePath: "/content" | "/summary";
        };
      }[];
      suggestion: string;
    }[];
    strategies: {
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
    baseAdoptedId?: string;
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
  };
  authorIntent: {
    id: string;
    version: number;
  };
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  assessmentSource: "model";
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  selectedStrategyId?: string;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `production/diagnosesGet` (`diagnoses.get`). */
export type DiagnosesGetResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  title: string;
  content: {
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    summary: string;
    theme: string;
    emotionalPromise: string;
    sellingPoints: string[];
    mainLine: string;
    characterArcs: string[];
    relationships: string[];
    findings: {
      id: string;
      kind: "hook" | "conflict" | "reversal" | "suspense" | "adaptation-risk";
      claim: string;
      evidence: {
        chapterId: string;
        chapterVersion: number;
        quote: string;
        source?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          valuePath: "/content" | "/summary";
        };
      }[];
      suggestion: string;
    }[];
    strategies: {
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
    baseAdoptedId?: string;
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
  };
  authorIntent: {
    id: string;
    version: number;
  };
  sourceSnapshotId: string;
  runIds: string[];
  model?: Record<string, JsonValue>;
  assessmentSource: "model";
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  selectedStrategyId?: string;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `production/diagnosesList` (`diagnoses.list`). */
export type DiagnosesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/diagnosesList` (`diagnoses.list`). */
export type DiagnosesListResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    title: string;
    content: {
      reviewedSources?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      summary: string;
      theme: string;
      emotionalPromise: string;
      sellingPoints: string[];
      mainLine: string;
      characterArcs: string[];
      relationships: string[];
      findings: {
        id: string;
        kind: "hook" | "conflict" | "reversal" | "suspense" | "adaptation-risk";
        claim: string;
        evidence: {
          chapterId: string;
          chapterVersion: number;
          quote: string;
          source?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: "/content" | "/summary";
          };
        }[];
        suggestion: string;
      }[];
      strategies: {
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
      baseAdoptedId?: string;
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
    };
    authorIntent: {
      id: string;
      version: number;
    };
    sourceSnapshotId: string;
    runIds: string[];
    model?: Record<string, JsonValue>;
    assessmentSource: "model";
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    selectedStrategyId?: string;
    adoptedAt?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Answer of `production/diagnosesSources` (`diagnoses.sources`). */
export type DiagnosesSourcesResult = {
  projectId: string;
  chapters: {
    id: string;
    version: number;
    title: string;
    orderIndex: number;
    contentHash: string;
    narrativeContentHash?: string;
    characters: number;
  }[];
  inventoryFingerprint: string;
  authorIntent?: {
    id: string;
    version: number;
  };
  adoptedDiagnosisId?: string;
};

/** Query of `production/diagnosesSummaries` (`diagnoses.summaries`). */
export type DiagnosesSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/diagnosesSummaries` (`diagnoses.summaries`). */
export type DiagnosesSummariesResult = {
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
