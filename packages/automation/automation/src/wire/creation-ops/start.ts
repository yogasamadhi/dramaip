/**
 * The shapes the creation start operation declares.
 *
 * @module @dramaip/automation-automation/wire/creation-ops/start
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/creationStart` (`creation.start`). */
export type CreationStartInput = {
  projectId: string;
  operation:
    | "author-intent"
    | "chapter"
    | "characters"
    | "book-outline"
    | "chapter-outline"
    | "story-arc"
    | "episode"
    | "adaptation-diagnosis"
    | "adaptation-strategy"
    | "quality-review"
    | "season-plan"
    | "episode-outline"
    | "episode-script"
    | "storyboard-package"
    | "script-revision"
    | "review-check"
    | "shot-prompt"
    | "delivery-copy"
    | "localization"
    | "creator-content"
    | "chapter-memory"
    | "knowledge-plan"
    | "narrative-summary";
  targetId?: string;
  conversationId?: string;
  baseVersion?: number;
  instruction: string;
  engineKind: "pi";
  model?: Record<string, JsonValue>;
  wordGoal?: number;
  sourceIds?: string[];
  language?: string;
  reviewPackageId?: string;
  feedbackClusterId?: string;
  diagnosisRequest?: {
    scope: "whole-book" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
    }[];
    inventoryFingerprint: string;
    authorIntent: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
    rightsDeclared: true;
    target: {
      format: "short-drama" | "motion-comic";
      episodeCount: number;
      durationSeconds: number;
    };
    context?: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
  };
  adaptationStrategyRequest?: {
    diagnosis: {
      id: string;
      version: number;
    };
    baseAdoptedId?: string;
  };
  seasonPlanRequest?: {
    diagnosis: {
      id: string;
      version: number;
      strategyId: string;
    };
    strategy?: {
      id: string;
      version: number;
      optionId: string;
    };
    baseAdoptedId?: string;
  };
  episodeDevelopmentRequest?: {
    seasonPlan?: {
      id: string;
      version: number;
    };
    inheritSeasonNarrative?: true;
    episodeNarrativeContext?: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
    sourceEvidenceFormat?: "exact-expression-quotes-v1";
    direct?: {
      entryPath: "inspiration" | "script";
      project: {
        id: string;
        version: number;
      };
      authorIntent: {
        id: string;
        version: number;
      };
      episode: {
        id: string;
        version: number;
      };
      sourceScript?: {
        id: string;
        version: number;
        documentVersion: number | null;
      };
      durationSeconds: number;
    };
    episodeId: string;
    outline?: {
      id: string;
      version: number;
    };
    baseOutlineId?: string;
    baseScriptId?: string;
    baseScriptDocumentVersion?: number;
    script?: {
      id: string;
      version: number;
    };
    baseStoryboardId?: string;
    redoShots?: {
      shotId: string;
      recordId: string;
      version: number;
    }[];
    redoSourceReview?: {
      format: "explicit-storyboard-source-review-v1";
      attribution: {
        id: string;
        version: number;
      };
      impactHash: string;
      shots: {
        sceneId: string;
        shotId: string;
        record: {
          id: string;
          version: number;
        };
        observedState:
          "affected" | "no-observed-change" | "unassociated" | "unresolved";
        decision: "redo" | "retain";
      }[];
      confirmation: {
        originalAttributionReviewed: true;
        currentImpactReviewed: true;
        completeScopeReviewed: true;
        unassociatedScopeReviewed: true;
        unverifiedSemanticsAcknowledged: true;
      };
    };
    redoMode?:
      "confirmed-block-structure" | "scene-shot-plan" | "scene-topology-plan";
    redoShotPlan?: {
      format: "author-scene-shot-plan-v1";
      scenePlans: {
        recordId: string;
        version: number;
        sceneId: string;
        shots: {
          id: string;
          orderIndex: number;
          durationSeconds: number;
          assetIds: string[];
          retains?: {
            recordId: string;
            version: number;
          };
        }[];
      }[];
    };
    redoTopologyPlan?: {
      format: "author-scene-topology-plan-v1";
      scenes: {
        sceneId: string;
        orderIndex: number;
        durationSeconds: number;
        mode: "retain" | "generate";
        retains?: {
          recordId: string;
          version: number;
        };
        shots: {
          id: string;
          orderIndex: number;
          durationSeconds: number;
          assetIds: string[];
          retains?: {
            recordId: string;
            version: number;
          };
        }[];
      }[];
      retiredScenes: {
        recordId: string;
        version: number;
        sceneId: string;
      }[];
      retiredShots: {
        recordId: string;
        version: number;
        shotId: string;
      }[];
    };
  };
  qualityReviewRequest?: {
    target: {
      id: string;
      version: number;
      kind:
        | "chapter"
        | "chapter-set"
        | "diagnosis"
        | "season-plan"
        | "episode-result"
        | "script"
        | "scene";
      sourceFingerprint?: string;
    };
    dimensions: (
      | "author-intent"
      | "character-knowledge"
      | "relationships"
      | "timeline"
      | "causality"
      | "foreshadowing"
      | "repetition"
      | "pacing"
      | "dialogue"
      | "production-risk"
    )[];
    chapterScope?: {
      mode: "selection" | "full";
      chapters: {
        id: string;
        version: number;
      }[];
      directoryFingerprint?: string;
    };
    context?: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
  };
  narrativeContextRequest?: {
    format: "narrative-context-v1";
    chapters: (
      | {
          id: string;
          version: number;
          representation: "original";
        }
      | {
          id: string;
          version: number;
          representation: "summary";
          record: {
            id: string;
            version: number;
          };
        }
      | {
          id: string;
          version: number;
          representation: "paragraphs";
          paragraphIds: string[];
        }
    )[];
    summaries?: {
      id: string;
      version: number;
    }[];
    story?: {
      id: string;
      version: number;
      kind: "declaration" | "assertion";
    }[];
  };
  narrativePlanningRequest?: {
    format: "narrative-planning-v1";
    chapterScope:
      | {
          mode: "none";
          chapters: {
            id: string;
            version: number;
          }[];
        }
      | {
          mode: "selection";
          chapters: {
            id: string;
            version: number;
          }[];
        }
      | {
          mode: "full";
          chapters: {
            id: string;
            version: number;
          }[];
          directoryFingerprint: string;
        };
    context: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
  };
  productionNarrativeRequest?: {
    format: "production-narrative-v1";
    chapterScope:
      | {
          mode: "none";
          chapters: {
            id: string;
            version: number;
          }[];
        }
      | {
          mode: "selection";
          chapters: {
            id: string;
            version: number;
          }[];
        }
      | {
          mode: "full";
          chapters: {
            id: string;
            version: number;
          }[];
          directoryFingerprint: string;
        };
    context: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
  };
  narrativeSummaryRequest?: {
    target: {
      id: string;
      version: number;
      kind: "book" | "volume" | "story-arc";
    };
    scopeFingerprint: string;
    expectedHead: string | null;
    chapters: (
      | {
          id: string;
          version: number;
          representation: "original";
        }
      | {
          id: string;
          version: number;
          representation: "summary";
          record: {
            id: string;
            version: number;
          };
        }
    )[];
  };
  authorIntentRequest?: {
    projectVersion: number;
    baseAdoptedId?: string;
    sources: (
      | {
          kind: "chapter";
          id: string;
          version: number;
          contentHash: string;
        }
      | {
          kind: "script";
          id: string;
          version: number;
          contentHash: string;
          documentVersion: number | null;
        }
    )[];
    context?: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
  };
};

/** Answer of `automation/creationStart` (`creation.start`). */
export type CreationStartResult = {
  creationRequestReceipt?: {
    format: "creation-request-receipt-v1";
    key: string;
    requestHash: string;
  };
  id: string;
  taskId: string;
  input: {
    projectId: string;
    operation:
      | "author-intent"
      | "chapter"
      | "characters"
      | "book-outline"
      | "chapter-outline"
      | "story-arc"
      | "episode"
      | "adaptation-diagnosis"
      | "adaptation-strategy"
      | "quality-review"
      | "season-plan"
      | "episode-outline"
      | "episode-script"
      | "storyboard-package"
      | "script-revision"
      | "review-check"
      | "shot-prompt"
      | "delivery-copy"
      | "localization"
      | "creator-content"
      | "chapter-memory"
      | "knowledge-plan"
      | "narrative-summary";
    targetId?: string;
    conversationId?: string;
    baseVersion?: number;
    instruction: string;
    engineKind: "pi";
    model?: Record<string, JsonValue>;
    wordGoal?: number;
    sourceIds?: string[];
    language?: string;
    reviewPackageId?: string;
    feedbackClusterId?: string;
    diagnosisRequest?: {
      scope: "whole-book" | "selected-chapters";
      chapters: {
        id: string;
        version: number;
      }[];
      inventoryFingerprint: string;
      authorIntent: {
        id: string;
        version: number;
      };
      baseAdoptedId?: string;
      rightsDeclared: true;
      target: {
        format: "short-drama" | "motion-comic";
        episodeCount: number;
        durationSeconds: number;
      };
      context?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    adaptationStrategyRequest?: {
      diagnosis: {
        id: string;
        version: number;
      };
      baseAdoptedId?: string;
    };
    seasonPlanRequest?: {
      diagnosis: {
        id: string;
        version: number;
        strategyId: string;
      };
      strategy?: {
        id: string;
        version: number;
        optionId: string;
      };
      baseAdoptedId?: string;
    };
    episodeDevelopmentRequest?: {
      seasonPlan?: {
        id: string;
        version: number;
      };
      inheritSeasonNarrative?: true;
      episodeNarrativeContext?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
      sourceEvidenceFormat?: "exact-expression-quotes-v1";
      direct?: {
        entryPath: "inspiration" | "script";
        project: {
          id: string;
          version: number;
        };
        authorIntent: {
          id: string;
          version: number;
        };
        episode: {
          id: string;
          version: number;
        };
        sourceScript?: {
          id: string;
          version: number;
          documentVersion: number | null;
        };
        durationSeconds: number;
      };
      episodeId: string;
      outline?: {
        id: string;
        version: number;
      };
      baseOutlineId?: string;
      baseScriptId?: string;
      baseScriptDocumentVersion?: number;
      script?: {
        id: string;
        version: number;
      };
      baseStoryboardId?: string;
      redoShots?: {
        shotId: string;
        recordId: string;
        version: number;
      }[];
      redoSourceReview?: {
        format: "explicit-storyboard-source-review-v1";
        attribution: {
          id: string;
          version: number;
        };
        impactHash: string;
        shots: {
          sceneId: string;
          shotId: string;
          record: {
            id: string;
            version: number;
          };
          observedState:
            "affected" | "no-observed-change" | "unassociated" | "unresolved";
          decision: "redo" | "retain";
        }[];
        confirmation: {
          originalAttributionReviewed: true;
          currentImpactReviewed: true;
          completeScopeReviewed: true;
          unassociatedScopeReviewed: true;
          unverifiedSemanticsAcknowledged: true;
        };
      };
      redoMode?:
        "confirmed-block-structure" | "scene-shot-plan" | "scene-topology-plan";
      redoShotPlan?: {
        format: "author-scene-shot-plan-v1";
        scenePlans: {
          recordId: string;
          version: number;
          sceneId: string;
          shots: {
            id: string;
            orderIndex: number;
            durationSeconds: number;
            assetIds: string[];
            retains?: {
              recordId: string;
              version: number;
            };
          }[];
        }[];
      };
      redoTopologyPlan?: {
        format: "author-scene-topology-plan-v1";
        scenes: {
          sceneId: string;
          orderIndex: number;
          durationSeconds: number;
          mode: "retain" | "generate";
          retains?: {
            recordId: string;
            version: number;
          };
          shots: {
            id: string;
            orderIndex: number;
            durationSeconds: number;
            assetIds: string[];
            retains?: {
              recordId: string;
              version: number;
            };
          }[];
        }[];
        retiredScenes: {
          recordId: string;
          version: number;
          sceneId: string;
        }[];
        retiredShots: {
          recordId: string;
          version: number;
          shotId: string;
        }[];
      };
    };
    qualityReviewRequest?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      dimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      chapterScope?: {
        mode: "selection" | "full";
        chapters: {
          id: string;
          version: number;
        }[];
        directoryFingerprint?: string;
      };
      context?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    narrativeContextRequest?: {
      format: "narrative-context-v1";
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
        | {
            id: string;
            version: number;
            representation: "paragraphs";
            paragraphIds: string[];
          }
      )[];
      summaries?: {
        id: string;
        version: number;
      }[];
      story?: {
        id: string;
        version: number;
        kind: "declaration" | "assertion";
      }[];
    };
    narrativePlanningRequest?: {
      format: "narrative-planning-v1";
      chapterScope:
        | {
            mode: "none";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "selection";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "full";
            chapters: {
              id: string;
              version: number;
            }[];
            directoryFingerprint: string;
          };
      context: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    productionNarrativeRequest?: {
      format: "production-narrative-v1";
      chapterScope:
        | {
            mode: "none";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "selection";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "full";
            chapters: {
              id: string;
              version: number;
            }[];
            directoryFingerprint: string;
          };
      context: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    narrativeSummaryRequest?: {
      target: {
        id: string;
        version: number;
        kind: "book" | "volume" | "story-arc";
      };
      scopeFingerprint: string;
      expectedHead: string | null;
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
      )[];
    };
    authorIntentRequest?: {
      projectVersion: number;
      baseAdoptedId?: string;
      sources: (
        | {
            kind: "chapter";
            id: string;
            version: number;
            contentHash: string;
          }
        | {
            kind: "script";
            id: string;
            version: number;
            contentHash: string;
            documentVersion: number | null;
          }
      )[];
      context?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
  };
  stage:
    | "preparing"
    | "generating"
    | "checking"
    | "revising"
    | "rechecking"
    | "awaiting-review"
    | "applied"
    | "discarded"
    | "failed"
    | "canceled"
    | "interrupted";
  version: number;
  recordMergeSource?: {
    format:
      | "storyboard-record-field-merge-v1"
      | "storyboard-record-field-merge-v2"
      | "storyboard-record-field-merge-v3"
      | "storyboard-record-field-merge-v4";
    request:
      | {
          format: "storyboard-record-field-merge-request-v1";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          comparisonHash: string;
          choices: JsonValue;
          reviewed: true;
          modelDisclosureConfirmed: true;
        }
      | {
          format: "storyboard-record-field-merge-request-v2";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          comparisonHash: string;
          choices: JsonValue;
          reviewed: true;
          modelDisclosureConfirmed: true;
          structureHash: string;
        }
      | {
          format: "storyboard-record-field-merge-request-v3";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          comparisonHash: string;
          choices: JsonValue;
          reviewed: true;
          modelDisclosureConfirmed: true;
          structureHash: string;
        }
      | {
          format: "storyboard-record-field-merge-request-v4";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          comparisonHash: string;
          choices: JsonValue;
          reviewed: true;
          modelDisclosureConfirmed: true;
          structureHash: string;
        };
    comparison:
      | {
          format: "storyboard-record-field-comparison-v1";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          candidateHash: string;
          frozenBasisHash: string;
          contextHash: string;
          records: {
            id: string;
            kind: "scenes" | "shots";
            stableId: string;
            frozenVersion: number;
            currentVersion: number;
            frozenHash: string;
            currentHash: string;
            parentId: string;
            orderIndex: number;
            editable: boolean;
          }[];
          units: {
            id: string;
            recordId: string;
            kind: "scenes" | "shots";
            field:
              | "title"
              | "场景动作"
              | "镜头描述"
              | "构图"
              | "机位"
              | "运镜"
              | "生成提示"
              | "负面提示"
              | "声音";
            base:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            current:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            candidate:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            conflict: boolean;
            defaultChoice: "main" | "branch";
          }[];
          comparisonHash: string;
          semanticVerification: "unverified";
          automaticCommit: false;
        }
      | {
          format: "storyboard-record-field-comparison-v2";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          candidateHash: string;
          frozenBasisHash: string;
          contextHash: string;
          records: {
            id: string;
            kind: "scenes" | "shots";
            stableId: string;
            frozenVersion: number;
            currentVersion: number;
            frozenHash: string;
            currentHash: string;
            parentId: string;
            orderIndex: number;
            editable: boolean;
          }[];
          units: {
            id: string;
            recordId: string;
            kind: "scenes" | "shots";
            field:
              | "title"
              | "场景动作"
              | "镜头描述"
              | "构图"
              | "机位"
              | "运镜"
              | "生成提示"
              | "负面提示"
              | "声音";
            base:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            current:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            candidate:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            conflict: boolean;
            defaultChoice: "main" | "branch";
          }[];
          comparisonHash: string;
          semanticVerification: "unverified";
          automaticCommit: false;
          structure: {
            receipt: {
              base: {
                id: string;
                version: number;
              };
              baseContentHash: string;
              shots: {
                shotId: string;
                recordId: string;
                version: number;
              }[];
              previousScript: {
                id: string;
                version: number;
              };
              scope: "confirmed-block-structure-fixed-shots-duration-assets-v1";
              semanticVerification: "unverified";
              sourceReview?: {
                format: "frozen-storyboard-source-review-v1";
                projectId: string;
                episodeId: string;
                storyboard: {
                  id: string;
                  version: number;
                };
                review: {
                  format: "explicit-storyboard-source-review-v1";
                  attribution: {
                    id: string;
                    version: number;
                  };
                  impactHash: string;
                  shots: {
                    sceneId: string;
                    shotId: string;
                    record: {
                      id: string;
                      version: number;
                    };
                    observedState:
                      | "affected"
                      | "no-observed-change"
                      | "unassociated"
                      | "unresolved";
                    decision: "redo" | "retain";
                  }[];
                  confirmation: {
                    originalAttributionReviewed: true;
                    currentImpactReviewed: true;
                    completeScopeReviewed: true;
                    unassociatedScopeReviewed: true;
                    unverifiedSemanticsAcknowledged: true;
                  };
                };
                sourceFingerprint: string;
                associationFingerprint: string;
                impactContentHash: string;
                scopeHash: string;
                semanticVerification: "unverified";
              };
              sceneMappings: {
                sceneId: string;
                previousBlockIds: string[];
                currentBlockIds: string[];
              }[];
            };
            script: {
              id: string;
              version: number;
            };
            scriptRecordId: string;
            documentVersion: number;
          };
          structureHash: string;
        }
      | {
          format: "storyboard-record-field-comparison-v3";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          candidateHash: string;
          frozenBasisHash: string;
          contextHash: string;
          records: {
            id: string;
            kind: "scenes" | "shots";
            stableId: string;
            frozenVersion: number;
            currentVersion: number;
            frozenHash: string;
            currentHash: string;
            parentId: string;
            orderIndex: number;
            editable: boolean;
          }[];
          units: {
            id: string;
            recordId: string;
            kind: "scenes" | "shots";
            field:
              | "title"
              | "场景动作"
              | "镜头描述"
              | "构图"
              | "机位"
              | "运镜"
              | "生成提示"
              | "负面提示"
              | "声音";
            base:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            current:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            candidate:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            conflict: boolean;
            defaultChoice: "main" | "branch";
          }[];
          comparisonHash: string;
          semanticVerification: "unverified";
          automaticCommit: false;
          structure: {
            receipt: {
              base: {
                id: string;
                version: number;
              };
              baseContentHash: string;
              shots: {
                shotId: string;
                recordId: string;
                version: number;
              }[];
              previousScript: {
                id: string;
                version: number;
              };
              scope: "author-frozen-scene-shot-plan-v1";
              semanticVerification: "unverified";
              sourceReview?: {
                format: "frozen-storyboard-source-review-v1";
                projectId: string;
                episodeId: string;
                storyboard: {
                  id: string;
                  version: number;
                };
                review: {
                  format: "explicit-storyboard-source-review-v1";
                  attribution: {
                    id: string;
                    version: number;
                  };
                  impactHash: string;
                  shots: {
                    sceneId: string;
                    shotId: string;
                    record: {
                      id: string;
                      version: number;
                    };
                    observedState:
                      | "affected"
                      | "no-observed-change"
                      | "unassociated"
                      | "unresolved";
                    decision: "redo" | "retain";
                  }[];
                  confirmation: {
                    originalAttributionReviewed: true;
                    currentImpactReviewed: true;
                    completeScopeReviewed: true;
                    unassociatedScopeReviewed: true;
                    unverifiedSemanticsAcknowledged: true;
                  };
                };
                sourceFingerprint: string;
                associationFingerprint: string;
                impactContentHash: string;
                scopeHash: string;
                semanticVerification: "unverified";
              };
              sceneMappings: {
                sceneId: string;
                previousBlockIds: string[];
                currentBlockIds: string[];
              }[];
              scenePlans: {
                recordId: string;
                version: number;
                sceneId: string;
                shots: {
                  id: string;
                  orderIndex: number;
                  durationSeconds: number;
                  assetIds: string[];
                  retains?: {
                    recordId: string;
                    version: number;
                  };
                }[];
              }[];
            };
            script: {
              id: string;
              version: number;
            };
            scriptRecordId: string;
            documentVersion: number;
          };
          structureHash: string;
        }
      | {
          format: "storyboard-record-field-comparison-v4";
          projectId: string;
          episodeId: string;
          workflow: {
            id: string;
            version: number;
          };
          base: {
            id: string;
            version: number;
          };
          candidateHash: string;
          frozenBasisHash: string;
          contextHash: string;
          records: {
            id: string;
            kind: "scenes" | "shots";
            stableId: string;
            frozenVersion: number;
            currentVersion: number;
            frozenHash: string;
            currentHash: string;
            parentId: string;
            orderIndex: number;
            editable: boolean;
          }[];
          units: {
            id: string;
            recordId: string;
            kind: "scenes" | "shots";
            field:
              | "title"
              | "场景动作"
              | "镜头描述"
              | "构图"
              | "机位"
              | "运镜"
              | "生成提示"
              | "负面提示"
              | "声音";
            base:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            current:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            candidate:
              | {
                  state: "text";
                  text: string;
                  hash: string;
                }
              | {
                  state: "absent" | "unsupported";
                  hash: string;
                };
            conflict: boolean;
            defaultChoice: "main" | "branch";
          }[];
          comparisonHash: string;
          semanticVerification: "unverified";
          automaticCommit: false;
          structure: {
            receipt: {
              base: {
                id: string;
                version: number;
              };
              baseContentHash: string;
              shots: {
                shotId: string;
                recordId: string;
                version: number;
              }[];
              previousScript: {
                id: string;
                version: number;
              };
              scope: "author-frozen-scene-topology-plan-v1";
              semanticVerification: "unverified";
              sourceReview?: {
                format: "frozen-storyboard-source-review-v1";
                projectId: string;
                episodeId: string;
                storyboard: {
                  id: string;
                  version: number;
                };
                review: {
                  format: "explicit-storyboard-source-review-v1";
                  attribution: {
                    id: string;
                    version: number;
                  };
                  impactHash: string;
                  shots: {
                    sceneId: string;
                    shotId: string;
                    record: {
                      id: string;
                      version: number;
                    };
                    observedState:
                      | "affected"
                      | "no-observed-change"
                      | "unassociated"
                      | "unresolved";
                    decision: "redo" | "retain";
                  }[];
                  confirmation: {
                    originalAttributionReviewed: true;
                    currentImpactReviewed: true;
                    completeScopeReviewed: true;
                    unassociatedScopeReviewed: true;
                    unverifiedSemanticsAcknowledged: true;
                  };
                };
                sourceFingerprint: string;
                associationFingerprint: string;
                impactContentHash: string;
                scopeHash: string;
                semanticVerification: "unverified";
              };
              previousOutline: {
                id: string;
                version: number;
              };
              script: {
                id: string;
                version: number;
              };
              outline: {
                id: string;
                version: number;
              };
              topologyPlan: {
                format: "author-scene-topology-plan-v1";
                scenes: {
                  sceneId: string;
                  orderIndex: number;
                  durationSeconds: number;
                  mode: "retain" | "generate";
                  retains?: {
                    recordId: string;
                    version: number;
                  };
                  shots: {
                    id: string;
                    orderIndex: number;
                    durationSeconds: number;
                    assetIds: string[];
                    retains?: {
                      recordId: string;
                      version: number;
                    };
                  }[];
                }[];
                retiredScenes: {
                  recordId: string;
                  version: number;
                  sceneId: string;
                }[];
                retiredShots: {
                  recordId: string;
                  version: number;
                  shotId: string;
                }[];
              };
              selectedScenes: {
                recordId: string;
                version: number;
                sceneId: string;
              }[];
              ancestry: {
                sourceKind: "production";
                sourceId: string;
                sourceVersion: number;
                fieldPath: string;
                contentHash: string;
              }[];
              topologySteps: number;
            };
            script: {
              id: string;
              version: number;
            };
            scriptRecordId: string;
            documentVersion: number;
          };
          structureHash: string;
        };
    outputHash: string;
  };
  rebaseSource?: {
    id: string;
    baseVersion: number;
    choices: Record<string, "main" | "branch">;
    basis?: {
      format: "stable-screenplay-merge-v1";
      projectId: string;
      workflowId: string;
      baseBlocksHash: string;
      candidateHash: string;
      contextHash: string;
      target: {
        scriptId: string;
        version: number;
        documentId: string;
        documentVersion: number;
        blocksHash: string;
      };
    };
    blockOrder?: string[];
  };
  sourceWorkflowId?: string;
  continuationBasis?: {
    workflowPath: "novel" | "adaptation";
    source: {
      targetKey: string;
      position: number;
      id: string;
      version: number;
      kind: "chapter" | "episode-script";
    };
    target: {
      targetKey: string;
      position: number;
    };
  };
  authorIntent?:
    | {
        state: "none";
        projectId: string;
      }
    | {
        state: "adopted";
        projectId: string;
        id: string;
        version: number;
      };
  authorIntentBasis?: {
    request: {
      projectVersion: number;
      baseAdoptedId?: string;
      sources: (
        | {
            kind: "chapter";
            id: string;
            version: number;
            contentHash: string;
          }
        | {
            kind: "script";
            id: string;
            version: number;
            contentHash: string;
            documentVersion: number | null;
          }
      )[];
      context?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
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
    chapters?: {
      id: string;
      version: number;
      title: string;
    }[];
    references: {
      sourceKind:
        "project" | "author_intent" | "chapter" | "production" | "knowledge";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
    }[];
  };
  authorIntentId?: string;
  diagnosisBasis?: {
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
  diagnosisId?: string;
  adaptationStrategyBasis?: {
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
  adaptationStrategyId?: string;
  seasonPlanBasis?: {
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
  seasonPlanId?: string;
  episodeDevelopmentBasis?: {
    request: {
      seasonPlan?: {
        id: string;
        version: number;
      };
      inheritSeasonNarrative?: true;
      episodeNarrativeContext?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
      sourceEvidenceFormat?: "exact-expression-quotes-v1";
      direct?: {
        entryPath: "inspiration" | "script";
        project: {
          id: string;
          version: number;
        };
        authorIntent: {
          id: string;
          version: number;
        };
        episode: {
          id: string;
          version: number;
        };
        sourceScript?: {
          id: string;
          version: number;
          documentVersion: number | null;
        };
        durationSeconds: number;
      };
      episodeId: string;
      outline?: {
        id: string;
        version: number;
      };
      baseOutlineId?: string;
      baseScriptId?: string;
      baseScriptDocumentVersion?: number;
      script?: {
        id: string;
        version: number;
      };
      baseStoryboardId?: string;
      redoShots?: {
        shotId: string;
        recordId: string;
        version: number;
      }[];
      redoSourceReview?: {
        format: "explicit-storyboard-source-review-v1";
        attribution: {
          id: string;
          version: number;
        };
        impactHash: string;
        shots: {
          sceneId: string;
          shotId: string;
          record: {
            id: string;
            version: number;
          };
          observedState:
            "affected" | "no-observed-change" | "unassociated" | "unresolved";
          decision: "redo" | "retain";
        }[];
        confirmation: {
          originalAttributionReviewed: true;
          currentImpactReviewed: true;
          completeScopeReviewed: true;
          unassociatedScopeReviewed: true;
          unverifiedSemanticsAcknowledged: true;
        };
      };
      redoMode?:
        "confirmed-block-structure" | "scene-shot-plan" | "scene-topology-plan";
      redoShotPlan?: {
        format: "author-scene-shot-plan-v1";
        scenePlans: {
          recordId: string;
          version: number;
          sceneId: string;
          shots: {
            id: string;
            orderIndex: number;
            durationSeconds: number;
            assetIds: string[];
            retains?: {
              recordId: string;
              version: number;
            };
          }[];
        }[];
      };
      redoTopologyPlan?: {
        format: "author-scene-topology-plan-v1";
        scenes: {
          sceneId: string;
          orderIndex: number;
          durationSeconds: number;
          mode: "retain" | "generate";
          retains?: {
            recordId: string;
            version: number;
          };
          shots: {
            id: string;
            orderIndex: number;
            durationSeconds: number;
            assetIds: string[];
            retains?: {
              recordId: string;
              version: number;
            };
          }[];
        }[];
        retiredScenes: {
          recordId: string;
          version: number;
          sceneId: string;
        }[];
        retiredShots: {
          recordId: string;
          version: number;
          shotId: string;
        }[];
      };
    };
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
    authorIntent: {
      id: string;
      version: number;
    };
    episode:
      | {
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
        }
      | {
          sourcePath: "direct-script";
          id: string;
          version: number;
          title: string;
          orderIndex: number;
          durationSeconds: number;
        };
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
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
    contextChapters?: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      narrativeContentHash?: string;
      characters: number;
    }[];
    references: {
      sourceKind:
        "author_intent" | "production" | "chapter" | "knowledge" | "project";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
    }[];
    storyboardRedo?:
      | {
          base: {
            id: string;
            version: number;
          };
          baseContentHash: string;
          shots: {
            shotId: string;
            recordId: string;
            version: number;
          }[];
          previousScript: {
            id: string;
            version: number;
          };
          scope: "stable-mapping-fixed-duration-existing-assets-v1";
          semanticVerification: "unverified";
          sourceReview?: {
            format: "frozen-storyboard-source-review-v1";
            projectId: string;
            episodeId: string;
            storyboard: {
              id: string;
              version: number;
            };
            review: {
              format: "explicit-storyboard-source-review-v1";
              attribution: {
                id: string;
                version: number;
              };
              impactHash: string;
              shots: {
                sceneId: string;
                shotId: string;
                record: {
                  id: string;
                  version: number;
                };
                observedState:
                  | "affected"
                  | "no-observed-change"
                  | "unassociated"
                  | "unresolved";
                decision: "redo" | "retain";
              }[];
              confirmation: {
                originalAttributionReviewed: true;
                currentImpactReviewed: true;
                completeScopeReviewed: true;
                unassociatedScopeReviewed: true;
                unverifiedSemanticsAcknowledged: true;
              };
            };
            sourceFingerprint: string;
            associationFingerprint: string;
            impactContentHash: string;
            scopeHash: string;
            semanticVerification: "unverified";
          };
        }
      | {
          base: {
            id: string;
            version: number;
          };
          baseContentHash: string;
          shots: {
            shotId: string;
            recordId: string;
            version: number;
          }[];
          previousScript: {
            id: string;
            version: number;
          };
          scope: "confirmed-block-structure-fixed-shots-duration-assets-v1";
          semanticVerification: "unverified";
          sourceReview?: {
            format: "frozen-storyboard-source-review-v1";
            projectId: string;
            episodeId: string;
            storyboard: {
              id: string;
              version: number;
            };
            review: {
              format: "explicit-storyboard-source-review-v1";
              attribution: {
                id: string;
                version: number;
              };
              impactHash: string;
              shots: {
                sceneId: string;
                shotId: string;
                record: {
                  id: string;
                  version: number;
                };
                observedState:
                  | "affected"
                  | "no-observed-change"
                  | "unassociated"
                  | "unresolved";
                decision: "redo" | "retain";
              }[];
              confirmation: {
                originalAttributionReviewed: true;
                currentImpactReviewed: true;
                completeScopeReviewed: true;
                unassociatedScopeReviewed: true;
                unverifiedSemanticsAcknowledged: true;
              };
            };
            sourceFingerprint: string;
            associationFingerprint: string;
            impactContentHash: string;
            scopeHash: string;
            semanticVerification: "unverified";
          };
          sceneMappings: {
            sceneId: string;
            previousBlockIds: string[];
            currentBlockIds: string[];
          }[];
        }
      | {
          base: {
            id: string;
            version: number;
          };
          baseContentHash: string;
          shots: {
            shotId: string;
            recordId: string;
            version: number;
          }[];
          previousScript: {
            id: string;
            version: number;
          };
          scope: "author-frozen-scene-shot-plan-v1";
          semanticVerification: "unverified";
          sourceReview?: {
            format: "frozen-storyboard-source-review-v1";
            projectId: string;
            episodeId: string;
            storyboard: {
              id: string;
              version: number;
            };
            review: {
              format: "explicit-storyboard-source-review-v1";
              attribution: {
                id: string;
                version: number;
              };
              impactHash: string;
              shots: {
                sceneId: string;
                shotId: string;
                record: {
                  id: string;
                  version: number;
                };
                observedState:
                  | "affected"
                  | "no-observed-change"
                  | "unassociated"
                  | "unresolved";
                decision: "redo" | "retain";
              }[];
              confirmation: {
                originalAttributionReviewed: true;
                currentImpactReviewed: true;
                completeScopeReviewed: true;
                unassociatedScopeReviewed: true;
                unverifiedSemanticsAcknowledged: true;
              };
            };
            sourceFingerprint: string;
            associationFingerprint: string;
            impactContentHash: string;
            scopeHash: string;
            semanticVerification: "unverified";
          };
          sceneMappings: {
            sceneId: string;
            previousBlockIds: string[];
            currentBlockIds: string[];
          }[];
          scenePlans: {
            recordId: string;
            version: number;
            sceneId: string;
            shots: {
              id: string;
              orderIndex: number;
              durationSeconds: number;
              assetIds: string[];
              retains?: {
                recordId: string;
                version: number;
              };
            }[];
          }[];
        }
      | {
          base: {
            id: string;
            version: number;
          };
          baseContentHash: string;
          shots: {
            shotId: string;
            recordId: string;
            version: number;
          }[];
          previousScript: {
            id: string;
            version: number;
          };
          scope: "author-frozen-scene-topology-plan-v1";
          semanticVerification: "unverified";
          sourceReview?: {
            format: "frozen-storyboard-source-review-v1";
            projectId: string;
            episodeId: string;
            storyboard: {
              id: string;
              version: number;
            };
            review: {
              format: "explicit-storyboard-source-review-v1";
              attribution: {
                id: string;
                version: number;
              };
              impactHash: string;
              shots: {
                sceneId: string;
                shotId: string;
                record: {
                  id: string;
                  version: number;
                };
                observedState:
                  | "affected"
                  | "no-observed-change"
                  | "unassociated"
                  | "unresolved";
                decision: "redo" | "retain";
              }[];
              confirmation: {
                originalAttributionReviewed: true;
                currentImpactReviewed: true;
                completeScopeReviewed: true;
                unassociatedScopeReviewed: true;
                unverifiedSemanticsAcknowledged: true;
              };
            };
            sourceFingerprint: string;
            associationFingerprint: string;
            impactContentHash: string;
            scopeHash: string;
            semanticVerification: "unverified";
          };
          previousOutline: {
            id: string;
            version: number;
          };
          script: {
            id: string;
            version: number;
          };
          outline: {
            id: string;
            version: number;
          };
          topologyPlan: {
            format: "author-scene-topology-plan-v1";
            scenes: {
              sceneId: string;
              orderIndex: number;
              durationSeconds: number;
              mode: "retain" | "generate";
              retains?: {
                recordId: string;
                version: number;
              };
              shots: {
                id: string;
                orderIndex: number;
                durationSeconds: number;
                assetIds: string[];
                retains?: {
                  recordId: string;
                  version: number;
                };
              }[];
            }[];
            retiredScenes: {
              recordId: string;
              version: number;
              sceneId: string;
            }[];
            retiredShots: {
              recordId: string;
              version: number;
              shotId: string;
            }[];
          };
          selectedScenes: {
            recordId: string;
            version: number;
            sceneId: string;
          }[];
          ancestry: {
            sourceKind: "production";
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            contentHash: string;
          }[];
          topologySteps: number;
        };
    baseStoryboardRecords?: {
      id: string;
      version: number | null;
    }[];
  };
  episodeResultId?: string;
  narrativeQualityBasis?: {
    request: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      dimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      chapterScope?: {
        mode: "selection" | "full";
        chapters: {
          id: string;
          version: number;
        }[];
        directoryFingerprint?: string;
      };
      context?: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    baseReportId: string | null;
    references: {
      sourceKind: "chapter" | "author_intent" | "production" | "knowledge";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
    }[];
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
    productionSourceBasis?: {
      projectId: string;
      id: string;
      kind: "script" | "scene";
      version: number;
      contentHash: string;
      recordContentHash: string;
      document?: {
        id: string;
        version: number;
        contentHash: string;
        blocks: {
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
      };
      ancestors: {
        id: string;
        version: number;
        kind: "adaptations" | "episodes" | "scripts";
        contentHash: string;
        document?: {
          id: string;
          version: number;
          contentHash: string;
        };
      }[];
    };
    chapterCoverage?: {
      mode: "selection" | "full";
      included: {
        id: string;
        version: number;
        title: string;
        representations?: (
          "original" | "summary" | "paragraphs" | "hierarchical-summary"
        )[];
      }[];
      excluded: {
        id: string;
        version: number;
        reason: "not-selected" | "empty";
      }[];
      totalChapterCount: number;
      nonEmptyChapterCount: number;
    };
  };
  narrativeContextBasis?: {
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
    kind: "author-selected-novel-context";
    target: {
      id: string;
      version: number;
    };
    contextBudget?: {
      source: "estimate";
      tokenBudget: number;
      estimatedTokens: number;
    };
  };
  narrativePlanningBasis?: {
    kind: "author-selected-narrative-planning";
    projectId: string;
    request: {
      format: "narrative-planning-v1";
      chapterScope:
        | {
            mode: "none";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "selection";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "full";
            chapters: {
              id: string;
              version: number;
            }[];
            directoryFingerprint: string;
          };
      context: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    sourceBasis: {
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
    coverage: {
      included: {
        id: string;
        version: number;
        title: string;
        representations: (
          "original" | "summary" | "paragraphs" | "hierarchical-summary"
        )[];
      }[];
      excluded: {
        id: string;
        version: number;
        reason: "not-selected" | "empty";
      }[];
      totalChapterCount: number;
      nonEmptyChapterCount: number;
    };
    operation:
      | "characters"
      | "book-outline"
      | "chapter-outline"
      | "story-arc"
      | "knowledge-plan";
    references: {
      sourceKind:
        | "intent"
        | "author_intent"
        | "project"
        | "chapter"
        | "selection"
        | "story_bible"
        | "writing_resource"
        | "production"
        | "knowledge";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
      policyDependencies?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    }[];
    contextBudget?: {
      source: "estimate";
      tokenBudget: number;
      estimatedTokens: number;
    };
  };
  productionNarrativeBasis?: {
    kind: "author-selected-production-narrative";
    projectId: string;
    request: {
      format: "production-narrative-v1";
      chapterScope:
        | {
            mode: "none";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "selection";
            chapters: {
              id: string;
              version: number;
            }[];
          }
        | {
            mode: "full";
            chapters: {
              id: string;
              version: number;
            }[];
            directoryFingerprint: string;
          };
      context: {
        format: "narrative-context-v1";
        chapters: (
          | {
              id: string;
              version: number;
              representation: "original";
            }
          | {
              id: string;
              version: number;
              representation: "summary";
              record: {
                id: string;
                version: number;
              };
            }
          | {
              id: string;
              version: number;
              representation: "paragraphs";
              paragraphIds: string[];
            }
        )[];
        summaries?: {
          id: string;
          version: number;
        }[];
        story?: {
          id: string;
          version: number;
          kind: "declaration" | "assertion";
        }[];
      };
    };
    sourceBasis: {
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
    coverage:
      | {
          directoryState: "not-read";
          included: {
            id: string;
            version: number;
            title: string;
            representations: (
              "original" | "summary" | "paragraphs" | "hierarchical-summary"
            )[];
          }[];
          excluded: {
            id: string;
            version: number;
            reason: "not-selected" | "empty";
          }[];
          totalChapterCount: null;
          nonEmptyChapterCount: null;
        }
      | {
          directoryState: "read";
          included: {
            id: string;
            version: number;
            title: string;
            representations: (
              "original" | "summary" | "paragraphs" | "hierarchical-summary"
            )[];
          }[];
          excluded: {
            id: string;
            version: number;
            reason: "not-selected" | "empty";
          }[];
          totalChapterCount: number;
          nonEmptyChapterCount: number;
        };
    operation: "episode" | "script-revision" | "review-check" | "shot-prompt";
    references: {
      sourceKind:
        | "intent"
        | "author_intent"
        | "project"
        | "chapter"
        | "selection"
        | "story_bible"
        | "writing_resource"
        | "production"
        | "knowledge";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
      policyDependencies?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    }[];
    contextBudget?: {
      source: "estimate";
      tokenBudget: number;
      estimatedTokens: number;
    };
  };
  narrativeReportId?: string;
  narrativeSummaryBasis?: {
    request: {
      target: {
        id: string;
        version: number;
        kind: "book" | "volume" | "story-arc";
      };
      scopeFingerprint: string;
      expectedHead: string | null;
      chapters: (
        | {
            id: string;
            version: number;
            representation: "original";
          }
        | {
            id: string;
            version: number;
            representation: "summary";
            record: {
              id: string;
              version: number;
            };
          }
      )[];
    };
    scopeTitle: string;
    directory: {
      id: string;
      version: number;
      orderIndex: number;
      contentHash: string;
      hasContent: boolean;
    }[];
    references: {
      chapter: {
        id: string;
        version: number;
      };
      representation: "original" | "summary";
      sourceKind: "chapter" | "knowledge";
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      contentHash: string;
    }[];
  };
  narrativeSummaryId?: string;
  runId?: string;
  sessionId?: string;
  runIds: string[];
  contextSnapshotIds: string[];
  referenceVersions?: {
    sourceId: string;
    sourceVersion: number;
    fieldPath: string;
  }[];
  sources: {
    kind: string;
    id: string;
    version: number;
  }[];
  preparedPrompt: string;
  baseText?: string;
  baseBlocks?: Record<string, JsonValue>[];
  sourceSnapshotId?: string;
  sourceContextIntegrity?: {
    snapshotId: string;
    manifestSha256: string;
    finalPromptSha256: string;
  };
  contextEntries?: {
    title: string;
    included: boolean;
    reason: string;
    estimatedTokens?: number;
    fieldPath?: string;
    sourceId?: string;
    sourceVersion?: number;
  }[];
  output?: {
    title?: string;
    brief?: string;
    content?: string;
    items?: {
      ref: string;
      parentRef?: string;
      kind: string;
      title: string;
      data: Record<string, JsonValue>;
    }[];
  };
  issues: {
    severity: "error" | "warning" | "suggestion";
    message: string;
    evidence: string;
    location: string;
    suggestion: string;
    source: "rule" | "model";
    candidateEvidence?: {
      candidateSha256: string;
      matches: {
        valuePath: string;
        start: number;
        end: number;
      }[];
    };
  }[];
  previewId?: string;
  error?: string;
  adoptionCheckId?: string;
  adoptionCheckError?: string;
  memoryState?: "running" | "synced" | "review-required" | "failed";
  memoryWorkflowId?: string;
  memoryError?: string;
  createdAt: string;
  updatedAt: string;
};
