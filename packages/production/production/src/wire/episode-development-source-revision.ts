/**
 * The shapes the source revision operations of an episode development declare.
 *
 * @module @dramaip/production-production/wire/episode-development-source-revision
 */
import type { JsonValue } from "@dramaip/infra-values";












/** Input of `production/episodeDevelopmentsAdoptSourceRevision` (`episodeDevelopments.adoptSourceRevision`). */
export type EpisodeDevelopmentsAdoptSourceRevisionInput = {
  stateVersion: number;
  confirmation: {
    currentSourcesReviewed: true;
    outlineReviewed: true;
    actualDocumentReviewed: true;
    sceneMappingReviewed: true;
    retainedManuscriptReviewed: true;
  };
};

/**
 * The shape the operations of this kind answer with.
 *
 * Adopting, discarding, reading and previewing all describe
 * the same record, so the shape is written once and the
 * operations name it.
 */
export type EpisodeDevelopmentSourceRevision = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceScript: {
    id: string;
    version: number;
  };
  sourceOutline: {
    id: string;
    version: number;
  };
  document: {
    id: string;
    scriptId: string;
    version: number;
  };
  scriptRecordVersion: number;
  scriptRecordHash: string;
  title: string;
  input: {
    sourceVersion: number;
    outline: {
      id: string;
      version: number;
    };
    documentVersion: number;
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
    tokenBudget: number;
    outlineContent: {
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      scenes: {
        id: string;
        orderIndex: number;
        location: string;
        timeOfDay: string;
        goal: string;
        conflict: string;
        outcome: string;
        characters: string[];
        durationSeconds: number;
        sourceChapters: {
          id: string;
          version: number;
        }[];
        sourceReferences?: {
          sourceKind:
            | "author_intent"
            | "production"
            | "chapter"
            | "knowledge"
            | "project";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        sourceEvidence?: {
          id: string;
          source: {
            sourceKind: "chapter" | "knowledge" | "project" | "production";
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          };
          valuePath: string;
          quote: string;
          rationale: string;
        }[];
        beats: {
          id: string;
          action: string;
          causalLink: string;
        }[];
      }[];
    };
    sceneLinks: {
      sceneId: string;
      blockIds: string[];
    }[];
  };
  outlineContent: {
    title: string;
    logline: string;
    goal: string;
    mainConflict: string;
    turningPoint: string;
    endingHook: string;
    scenes: {
      id: string;
      orderIndex: number;
      location: string;
      timeOfDay: string;
      goal: string;
      conflict: string;
      outcome: string;
      characters: string[];
      durationSeconds: number;
      sourceChapters: {
        id: string;
        version: number;
      }[];
      sourceReferences?: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      sourceEvidence?: {
        id: string;
        source: {
          sourceKind: "chapter" | "knowledge" | "project" | "production";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        };
        valuePath: string;
        quote: string;
        rationale: string;
      }[];
      beats: {
        id: string;
        action: string;
        causalLink: string;
      }[];
    }[];
  };
  scriptContent: {
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
    sceneLinks: {
      sceneId: string;
      blockIds: string[];
    }[];
  };
  outlineContentHash: string;
  scriptContentHash: string;
  sourceBasisHash: string;
  outlineBasis: {
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
  sourceSnapshotId: string;
  sourceManifestHash: string;
  sourcePromptHash: string;
  policyDependencies: {
    sourceId: string;
    sourceVersion: number;
    fieldPath: string;
  }[];
  sourceEvidence?: {
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
  status: "pending" | "adopted" | "discarded";
  stateVersion: number;
  results?: {
    outline: {
      id: string;
      version: number;
    };
    script: {
      id: string;
      version: number;
    };
  };
  confirmation?: {
    currentSourcesReviewed: true;
    outlineReviewed: true;
    actualDocumentReviewed: true;
    sceneMappingReviewed: true;
    retainedManuscriptReviewed: true;
  };
  sourceState: "current" | "stale";
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

/** Answer of `production/episodeDevelopmentsAdoptSourceRevision` (`episodeDevelopments.adoptSourceRevision`). */
export type EpisodeDevelopmentsAdoptSourceRevisionResult = EpisodeDevelopmentSourceRevision;

/** Input of `production/episodeDevelopmentsDiscardSourceRevision` (`episodeDevelopments.discardSourceRevision`). */
export type EpisodeDevelopmentsDiscardSourceRevisionInput = {
  stateVersion: number;
};

/** Answer of `production/episodeDevelopmentsDiscardSourceRevision` (`episodeDevelopments.discardSourceRevision`). */
export type EpisodeDevelopmentsDiscardSourceRevisionResult = EpisodeDevelopmentSourceRevision;

/** Answer of `production/episodeDevelopmentsGetSourceRevision` (`episodeDevelopments.getSourceRevision`). */
export type EpisodeDevelopmentsGetSourceRevisionResult = EpisodeDevelopmentSourceRevision;

/** Answer of `production/episodeDevelopmentsGetSourceRevisionContext` (`episodeDevelopments.getSourceRevisionContext`). */
export type EpisodeDevelopmentsGetSourceRevisionContextResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceScript: {
    id: string;
    version: number;
  };
  sourceOutline: {
    id: string;
    version: number;
  };
  document: {
    id: string;
    scriptId: string;
    version: number;
  };
  stateVersion: number;
  status: "pending" | "adopted" | "discarded";
  sourceBasisHash: string;
  sourceSnapshotId: string;
  sourceManifestHash: string;
  sourcePromptHash: string;
  tokenBudget: number;
  entries: {
    sourceKind:
      "author_intent" | "production" | "chapter" | "knowledge" | "project";
    sourceId: string;
    sourceVersion: number;
    fieldPath: string;
    contentHash: string;
    value?: JsonValue;
  }[];
};

/** Query of `production/episodeDevelopmentsListSourceRevisions` (`episodeDevelopments.listSourceRevisions`). */
export type EpisodeDevelopmentsListSourceRevisionsQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/episodeDevelopmentsListSourceRevisions` (`episodeDevelopments.listSourceRevisions`). */
export type EpisodeDevelopmentsListSourceRevisionsResult = {
  items: {
    id: string;
    projectId: string;
    episodeId: string;
    sourceScript: {
      id: string;
      version: number;
    };
    sourceOutline: {
      id: string;
      version: number;
    };
    document: {
      id: string;
      scriptId: string;
      version: number;
    };
    scriptRecordVersion: number;
    scriptRecordHash: string;
    title: string;
    input: {
      sourceVersion: number;
      outline: {
        id: string;
        version: number;
      };
      documentVersion: number;
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
          | "confirmed-block-structure"
          | "scene-shot-plan"
          | "scene-topology-plan";
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
      tokenBudget: number;
      outlineContent: {
        title: string;
        logline: string;
        goal: string;
        mainConflict: string;
        turningPoint: string;
        endingHook: string;
        scenes: {
          id: string;
          orderIndex: number;
          location: string;
          timeOfDay: string;
          goal: string;
          conflict: string;
          outcome: string;
          characters: string[];
          durationSeconds: number;
          sourceChapters: {
            id: string;
            version: number;
          }[];
          sourceReferences?: {
            sourceKind:
              | "author_intent"
              | "production"
              | "chapter"
              | "knowledge"
              | "project";
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
          sourceEvidence?: {
            id: string;
            source: {
              sourceKind: "chapter" | "knowledge" | "project" | "production";
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
            };
            valuePath: string;
            quote: string;
            rationale: string;
          }[];
          beats: {
            id: string;
            action: string;
            causalLink: string;
          }[];
        }[];
      };
      sceneLinks: {
        sceneId: string;
        blockIds: string[];
      }[];
    };
    outlineContent: {
      title: string;
      logline: string;
      goal: string;
      mainConflict: string;
      turningPoint: string;
      endingHook: string;
      scenes: {
        id: string;
        orderIndex: number;
        location: string;
        timeOfDay: string;
        goal: string;
        conflict: string;
        outcome: string;
        characters: string[];
        durationSeconds: number;
        sourceChapters: {
          id: string;
          version: number;
        }[];
        sourceReferences?: {
          sourceKind:
            | "author_intent"
            | "production"
            | "chapter"
            | "knowledge"
            | "project";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        sourceEvidence?: {
          id: string;
          source: {
            sourceKind: "chapter" | "knowledge" | "project" | "production";
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          };
          valuePath: string;
          quote: string;
          rationale: string;
        }[];
        beats: {
          id: string;
          action: string;
          causalLink: string;
        }[];
      }[];
    };
    scriptContent: {
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
      sceneLinks: {
        sceneId: string;
        blockIds: string[];
      }[];
    };
    outlineContentHash: string;
    scriptContentHash: string;
    sourceBasisHash: string;
    outlineBasis: {
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
          | "confirmed-block-structure"
          | "scene-shot-plan"
          | "scene-topology-plan";
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
              adaptationAction:
                "preserve" | "merge" | "reorder" | "restructure";
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
    sourceSnapshotId: string;
    sourceManifestHash: string;
    sourcePromptHash: string;
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    sourceEvidence?: {
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
    status: "pending" | "adopted" | "discarded";
    stateVersion: number;
    results?: {
      outline: {
        id: string;
        version: number;
      };
      script: {
        id: string;
        version: number;
      };
    };
    confirmation?: {
      currentSourcesReviewed: true;
      outlineReviewed: true;
      actualDocumentReviewed: true;
      sceneMappingReviewed: true;
      retainedManuscriptReviewed: true;
    };
    sourceState: "current" | "stale";
    staleReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `production/episodeDevelopmentsPreviewSourceRevision` (`episodeDevelopments.previewSourceRevision`). */
export type EpisodeDevelopmentsPreviewSourceRevisionInput = {
  sourceVersion: number;
  outline: {
    id: string;
    version: number;
  };
  documentVersion: number;
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
  tokenBudget: number;
  outlineContent: {
    title: string;
    logline: string;
    goal: string;
    mainConflict: string;
    turningPoint: string;
    endingHook: string;
    scenes: {
      id: string;
      orderIndex: number;
      location: string;
      timeOfDay: string;
      goal: string;
      conflict: string;
      outcome: string;
      characters: string[];
      durationSeconds: number;
      sourceChapters: {
        id: string;
        version: number;
      }[];
      sourceReferences?: {
        sourceKind:
          "author_intent" | "production" | "chapter" | "knowledge" | "project";
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      sourceEvidence?: {
        id: string;
        source: {
          sourceKind: "chapter" | "knowledge" | "project" | "production";
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        };
        valuePath: string;
        quote: string;
        rationale: string;
      }[];
      beats: {
        id: string;
        action: string;
        causalLink: string;
      }[];
    }[];
  };
  sceneLinks: {
    sceneId: string;
    blockIds: string[];
  }[];
};

/** Answer of `production/episodeDevelopmentsPreviewSourceRevision` (`episodeDevelopments.previewSourceRevision`). */
export type EpisodeDevelopmentsPreviewSourceRevisionResult = EpisodeDevelopmentSourceRevision;

/** Query of `production/episodeDevelopmentsSourceRevisionSummaries` (`episodeDevelopments.sourceRevisionSummaries`). */
export type EpisodeDevelopmentsSourceRevisionSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `production/episodeDevelopmentsSourceRevisionSummaries` (`episodeDevelopments.sourceRevisionSummaries`). */
export type EpisodeDevelopmentsSourceRevisionSummariesResult = {
  items: {
    id: string;
    projectId: string;
    episodeId: string;
    sourceScript: {
      id: string;
      version: number;
    };
    sourceOutline: {
      id: string;
      version: number;
    };
    document: {
      id: string;
      scriptId: string;
      version: number;
    };
    status: "pending" | "adopted" | "discarded";
    stateVersion: number;
    results?: {
      outline: {
        id: string;
        version: number;
      };
      script: {
        id: string;
        version: number;
      };
    };
    sourceState: "current" | "stale";
    staleReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};
