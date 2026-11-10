/**
 * Wire types of the `workspace` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/workspace-workspace/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `workspace/authorIntentsAdopt` (`author-intents.adopt`). */
export type AuthorIntentsAdoptInput = {
  confirmed: true;
};

/** Answer of `workspace/authorIntentsAdopt` (`author-intents.adopt`). */
export type AuthorIntentsAdoptResult = {
  id: string;
  projectId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    themeStatement: string;
    emotionalPromise: string;
    targetAudience: string;
    mustKeep: string[];
    mayChange: string[];
    mustAvoid: string[];
    endingContract: string;
    toneAndVoice: string;
  };
  source:
    | {
        kind: "manual" | "legacy-project";
        projectVersion: number;
        legacyFields?: Record<string, string>;
      }
    | {
        kind: "ai-generated";
        projectVersion: number;
        creation: {
          workflowId: string;
          sourceSnapshotId: string;
          runIds: string[];
          engineKind: "pi";
          basis: {
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
                | "project"
                | "author_intent"
                | "chapter"
                | "production"
                | "knowledge";
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              contentHash: string;
            }[];
          };
        };
      };
  baseAdoptedId?: string;
  sourceState: "current" | "stale";
  isCurrent: boolean;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/authorIntentsCurrent` (`author-intents.current`). */
export type AuthorIntentsCurrentResult = {
  projectVersion: number;
  current?: {
    id: string;
    projectId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    content: {
      themeStatement: string;
      emotionalPromise: string;
      targetAudience: string;
      mustKeep: string[];
      mayChange: string[];
      mustAvoid: string[];
      endingContract: string;
      toneAndVoice: string;
    };
    source:
      | {
          kind: "manual" | "legacy-project";
          projectVersion: number;
          legacyFields?: Record<string, string>;
        }
      | {
          kind: "ai-generated";
          projectVersion: number;
          creation: {
            workflowId: string;
            sourceSnapshotId: string;
            runIds: string[];
            engineKind: "pi";
            basis: {
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
                  | "project"
                  | "author_intent"
                  | "chapter"
                  | "production"
                  | "knowledge";
                sourceId: string;
                sourceVersion: number;
                fieldPath: string;
                contentHash: string;
              }[];
            };
          };
        };
    baseAdoptedId?: string;
    sourceState: "current" | "stale";
    isCurrent: boolean;
    adoptedAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  legacyReviewRequired: boolean;
};

/** Input of `workspace/authorIntentsDiscard` (`author-intents.discard`). */
export type AuthorIntentsDiscardInput = Record<string, JsonValue>;

/** Answer of `workspace/authorIntentsDiscard` (`author-intents.discard`). */
export type AuthorIntentsDiscardResult = {
  id: string;
  projectId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    themeStatement: string;
    emotionalPromise: string;
    targetAudience: string;
    mustKeep: string[];
    mayChange: string[];
    mustAvoid: string[];
    endingContract: string;
    toneAndVoice: string;
  };
  source:
    | {
        kind: "manual" | "legacy-project";
        projectVersion: number;
        legacyFields?: Record<string, string>;
      }
    | {
        kind: "ai-generated";
        projectVersion: number;
        creation: {
          workflowId: string;
          sourceSnapshotId: string;
          runIds: string[];
          engineKind: "pi";
          basis: {
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
                | "project"
                | "author_intent"
                | "chapter"
                | "production"
                | "knowledge";
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              contentHash: string;
            }[];
          };
        };
      };
  baseAdoptedId?: string;
  sourceState: "current" | "stale";
  isCurrent: boolean;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/authorIntentsGet` (`author-intents.get`). */
export type AuthorIntentsGetResult = {
  id: string;
  projectId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    themeStatement: string;
    emotionalPromise: string;
    targetAudience: string;
    mustKeep: string[];
    mayChange: string[];
    mustAvoid: string[];
    endingContract: string;
    toneAndVoice: string;
  };
  source:
    | {
        kind: "manual" | "legacy-project";
        projectVersion: number;
        legacyFields?: Record<string, string>;
      }
    | {
        kind: "ai-generated";
        projectVersion: number;
        creation: {
          workflowId: string;
          sourceSnapshotId: string;
          runIds: string[];
          engineKind: "pi";
          basis: {
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
                | "project"
                | "author_intent"
                | "chapter"
                | "production"
                | "knowledge";
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              contentHash: string;
            }[];
          };
        };
      };
  baseAdoptedId?: string;
  sourceState: "current" | "stale";
  isCurrent: boolean;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `workspace/authorIntentsList` (`author-intents.list`). */
export type AuthorIntentsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `workspace/authorIntentsList` (`author-intents.list`). */
export type AuthorIntentsListResult = {
  items: {
    id: string;
    projectId: string;
    version: number;
    stateVersion: number;
    status: "pending" | "adopted" | "discarded" | "conflicted";
    baseAdoptedId?: string;
    sourceState: "current" | "stale";
    isCurrent: boolean;
    adoptedAt?: string;
    createdAt: string;
    updatedAt: string;
    sourceKind: "manual" | "legacy-project" | "ai-generated";
    sourceProjectVersion: number;
    workflowId?: string;
  }[];
  nextCursor?: string;
};

/** Input of `workspace/authorIntentsPreview` (`author-intents.preview`). */
export type AuthorIntentsPreviewInput = {
  projectVersion: number;
  baseAdoptedId?: string;
  sourceKind: "manual" | "legacy-project";
  content: {
    themeStatement: string;
    emotionalPromise: string;
    targetAudience: string;
    mustKeep: string[];
    mayChange: string[];
    mustAvoid: string[];
    endingContract: string;
    toneAndVoice: string;
  };
};

/** Answer of `workspace/authorIntentsPreview` (`author-intents.preview`). */
export type AuthorIntentsPreviewResult = {
  id: string;
  projectId: string;
  version: number;
  stateVersion: number;
  status: "pending" | "adopted" | "discarded" | "conflicted";
  content: {
    themeStatement: string;
    emotionalPromise: string;
    targetAudience: string;
    mustKeep: string[];
    mayChange: string[];
    mustAvoid: string[];
    endingContract: string;
    toneAndVoice: string;
  };
  source:
    | {
        kind: "manual" | "legacy-project";
        projectVersion: number;
        legacyFields?: Record<string, string>;
      }
    | {
        kind: "ai-generated";
        projectVersion: number;
        creation: {
          workflowId: string;
          sourceSnapshotId: string;
          runIds: string[];
          engineKind: "pi";
          basis: {
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
                | "project"
                | "author_intent"
                | "chapter"
                | "production"
                | "knowledge";
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              contentHash: string;
            }[];
          };
        };
      };
  baseAdoptedId?: string;
  sourceState: "current" | "stale";
  isCurrent: boolean;
  adoptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/authorIntentsSources` (`author-intents.sources`). */
export type AuthorIntentsSourcesResult = {
  projectVersion: number;
  baseAdoptedId?: string;
  chapterAvailable: boolean;
  scriptAvailable: boolean;
  items: {
    title: string;
    source:
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
        };
  }[];
};

/** Answer of `workspace/backupsCreate` (`backups.create`). */
export type BackupsCreateResult = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
};

/** Answer of `workspace/backupsList` (`backups.list`). */
export type BackupsListResult = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}[];

/** Answer of `workspace/backupsRestore` (`backups.restore`). */
export type BackupsRestoreResult = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
};

/** Answer of `workspace/desktopSupportCreateDemo` (`desktop-support.createDemo`). */
export type DesktopSupportCreateDemoResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/exportsProject` (`exports.project`). */
export type ExportsProjectResult = {
  fileName: string;
  mimeType: string;
  content: string;
};

/** Input of `workspace/importExtractionsAdopt` (`import-extractions.adopt`). */
export type ImportExtractionsAdoptInput = {
  candidateIds?: string[];
};

/** Answer of `workspace/importExtractionsAdopt` (`import-extractions.adopt`). */
export type ImportExtractionsAdoptResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  sourceTitle: string;
  status: "draft" | "applied" | "stale" | "discarded" | "failed";
  summary: string;
  candidates: {
    id: string;
    type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
    title: string;
    summary: string;
    confidence: number;
    sourceRefs: {
      sourceKey: string;
      chapterTitle: string;
      start: number;
      end: number;
      excerpt: string;
      sourceVersion: number;
      chapterId?: string;
    }[];
    status: "draft" | "rejected" | "adopted" | "conflict";
    conflictNote?: string;
  }[];
  appliedAt?: string;
  undoneAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/importExtractionsList` (`import-extractions.list`). */
export type ImportExtractionsListResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  sourceTitle: string;
  status: "draft" | "applied" | "stale" | "discarded" | "failed";
  summary: string;
  candidates: {
    id: string;
    type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
    title: string;
    summary: string;
    confidence: number;
    sourceRefs: {
      sourceKey: string;
      chapterTitle: string;
      start: number;
      end: number;
      excerpt: string;
      sourceVersion: number;
      chapterId?: string;
    }[];
    status: "draft" | "rejected" | "adopted" | "conflict";
    conflictNote?: string;
  }[];
  appliedAt?: string;
  undoneAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `workspace/importExtractionsUndo` (`import-extractions.undo`). */
export type ImportExtractionsUndoResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  sourceTitle: string;
  status: "draft" | "applied" | "stale" | "discarded" | "failed";
  summary: string;
  candidates: {
    id: string;
    type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
    title: string;
    summary: string;
    confidence: number;
    sourceRefs: {
      sourceKey: string;
      chapterTitle: string;
      start: number;
      end: number;
      excerpt: string;
      sourceVersion: number;
      chapterId?: string;
    }[];
    status: "draft" | "rejected" | "adopted" | "conflict";
    conflictNote?: string;
  }[];
  appliedAt?: string;
  undoneAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/importExtractionsUpdateCandidate` (`import-extractions.updateCandidate`). */
export type ImportExtractionsUpdateCandidateInput = {
  title?: string;
  summary?: string;
  status?: "draft" | "rejected";
};

/** Answer of `workspace/importExtractionsUpdateCandidate` (`import-extractions.updateCandidate`). */
export type ImportExtractionsUpdateCandidateResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  sourceTitle: string;
  status: "draft" | "applied" | "stale" | "discarded" | "failed";
  summary: string;
  candidates: {
    id: string;
    type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
    title: string;
    summary: string;
    confidence: number;
    sourceRefs: {
      sourceKey: string;
      chapterTitle: string;
      start: number;
      end: number;
      excerpt: string;
      sourceVersion: number;
      chapterId?: string;
    }[];
    status: "draft" | "rejected" | "adopted" | "conflict";
    conflictNote?: string;
  }[];
  appliedAt?: string;
  undoneAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/projectPackagesCommit` (`project-packages.commit`). */
export type ProjectPackagesCommitInput = {
  title?: string;
};

/** Answer of `workspace/projectPackagesCommit` (`project-packages.commit`). */
export type ProjectPackagesCommitResult = {
  project: {
    id: string;
    title: string;
    shortDramaType?: string;
    mode:
      | "series_longform"
      | "single_season"
      | "personal_theater"
      | "creator_channel";
    modeConfig:
      | {
          mode: "series_longform";
          targetChapterCount?: number;
          targetSeasonCount?: number;
          targetEpisodesPerSeason?: number;
        }
      | {
          mode: "single_season";
          entryPath: "novel" | "source-import" | "script" | "inspiration";
          targetEpisodeCount?: number;
        }
      | {
          mode: "personal_theater";
          storyMethod: "template" | "freeform";
          episodeCount?: number;
          episodeDurationMinutes?: number;
        }
      | {
          mode: "creator_channel";
          topic: string;
          positioning?: string;
          audience?: string;
          platforms?: string[];
          riskDomain?: "general" | "finance" | "health" | "legal";
        };
    lifecycleStatus: "initializing" | "ready" | "failed";
    derivedFromProjectId?: string;
    targetAudience?: string;
    targetWordCount?: number;
    targetEpisodeCount?: number;
    coreHook?: string;
    emotionalCore?: string;
    coreSellingPoint?: string;
    synopsis: string;
    styleGuide?: string;
    visualStyleDirection?: string;
    genreOpportunity?: string;
    productionBrief?: string;
    seriesId?: string;
    seriesTitle?: string;
    currentAdaptationId?: string;
    deletedAt?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  chaptersCreated: number;
  resourcesCreated: number;
};

/** Input of `workspace/projectPackagesPreview` (`project-packages.preview`). */
export type ProjectPackagesPreviewInput = {
  capabilityToken: string;
};

/** Answer of `workspace/projectPackagesPreview` (`project-packages.preview`). */
export type ProjectPackagesPreviewResult = {
  id: string;
  sourceName: string;
  projectTitle: string;
  shortDramaType: string;
  chapterCount: number;
  resourceCount: number;
  warnings: string[];
  expiresAt: string;
};

/** Input of `workspace/projectsCommitDerivation` (`projects.commitDerivation`). */
export type ProjectsCommitDerivationInput = {
  previewId: string;
};

/** Answer of `workspace/projectsCommitDerivation` (`projects.commitDerivation`). */
export type ProjectsCommitDerivationResult = {
  project: {
    id: string;
    title: string;
    shortDramaType?: string;
    mode:
      | "series_longform"
      | "single_season"
      | "personal_theater"
      | "creator_channel";
    modeConfig:
      | {
          mode: "series_longform";
          targetChapterCount?: number;
          targetSeasonCount?: number;
          targetEpisodesPerSeason?: number;
        }
      | {
          mode: "single_season";
          entryPath: "novel" | "source-import" | "script" | "inspiration";
          targetEpisodeCount?: number;
        }
      | {
          mode: "personal_theater";
          storyMethod: "template" | "freeform";
          episodeCount?: number;
          episodeDurationMinutes?: number;
        }
      | {
          mode: "creator_channel";
          topic: string;
          positioning?: string;
          audience?: string;
          platforms?: string[];
          riskDomain?: "general" | "finance" | "health" | "legal";
        };
    lifecycleStatus: "initializing" | "ready" | "failed";
    derivedFromProjectId?: string;
    targetAudience?: string;
    targetWordCount?: number;
    targetEpisodeCount?: number;
    coreHook?: string;
    emotionalCore?: string;
    coreSellingPoint?: string;
    synopsis: string;
    styleGuide?: string;
    visualStyleDirection?: string;
    genreOpportunity?: string;
    productionBrief?: string;
    seriesId?: string;
    seriesTitle?: string;
    currentAdaptationId?: string;
    deletedAt?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  initialization: {
    projectId: string;
    status: "initializing" | "ready" | "failed";
    steps: {
      key: string;
      pluginId: string;
      status: "pending" | "running" | "ready" | "failed";
      message?: string;
      error?: string;
      attempts: number;
      updatedAt: string;
    }[];
    updatedAt: string;
  };
  derivationId: string;
};

/** Input of `workspace/projectsCreate` (`projects.create`). */
export type ProjectsCreateInput = {
  title: string;
  shortDramaType?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis?: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  mode?:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig?:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  goalConfirmation?: {
    confirmed: true;
    goal: "novel-first" | "screenplay-first";
    material: "inspiration" | "source-import" | "script";
  };
};

/** Answer of `workspace/projectsCreate` (`projects.create`). */
export type ProjectsCreateResult = {
  project: {
    id: string;
    title: string;
    shortDramaType?: string;
    mode:
      | "series_longform"
      | "single_season"
      | "personal_theater"
      | "creator_channel";
    modeConfig:
      | {
          mode: "series_longform";
          targetChapterCount?: number;
          targetSeasonCount?: number;
          targetEpisodesPerSeason?: number;
        }
      | {
          mode: "single_season";
          entryPath: "novel" | "source-import" | "script" | "inspiration";
          targetEpisodeCount?: number;
        }
      | {
          mode: "personal_theater";
          storyMethod: "template" | "freeform";
          episodeCount?: number;
          episodeDurationMinutes?: number;
        }
      | {
          mode: "creator_channel";
          topic: string;
          positioning?: string;
          audience?: string;
          platforms?: string[];
          riskDomain?: "general" | "finance" | "health" | "legal";
        };
    lifecycleStatus: "initializing" | "ready" | "failed";
    derivedFromProjectId?: string;
    targetAudience?: string;
    targetWordCount?: number;
    targetEpisodeCount?: number;
    coreHook?: string;
    emotionalCore?: string;
    coreSellingPoint?: string;
    synopsis: string;
    styleGuide?: string;
    visualStyleDirection?: string;
    genreOpportunity?: string;
    productionBrief?: string;
    seriesId?: string;
    seriesTitle?: string;
    currentAdaptationId?: string;
    deletedAt?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  initialization: {
    projectId: string;
    status: "initializing" | "ready" | "failed";
    steps: {
      key: string;
      pluginId: string;
      status: "pending" | "running" | "ready" | "failed";
      message?: string;
      error?: string;
      attempts: number;
      updatedAt: string;
    }[];
    updatedAt: string;
  };
};

/** Answer of `workspace/projectsGet` (`projects.get`). */
export type ProjectsGetResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/projectsInitialization` (`projects.initialization`). */
export type ProjectsInitializationResult = {
  projectId: string;
  status: "initializing" | "ready" | "failed";
  steps: {
    key: string;
    pluginId: string;
    status: "pending" | "running" | "ready" | "failed";
    message?: string;
    error?: string;
    attempts: number;
    updatedAt: string;
  }[];
  updatedAt: string;
};

/** Answer of `workspace/projectsList` (`projects.list`). */
export type ProjectsListResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `workspace/projectsListTrash` (`projects.listTrash`). */
export type ProjectsListTrashResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `workspace/projectsPreviewDerivation` (`projects.previewDerivation`). */
export type ProjectsPreviewDerivationInput = {
  targetMode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  title?: string;
  seasonId?: string;
  targetModeConfig?:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
};

/** Answer of `workspace/projectsPreviewDerivation` (`projects.previewDerivation`). */
export type ProjectsPreviewDerivationResult = {
  id: string;
  sourceProjectId: string;
  targetMode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  targetModeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  title: string;
  supported: boolean;
  reason?: string;
  expiresAt: string;
};

/** Input of `workspace/projectsPurge` (`projects.purge`). */
export type ProjectsPurgeInput = {
  confirmationTitle: string;
};

/** Answer of `workspace/projectsRestore` (`projects.restore`). */
export type ProjectsRestoreResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/projectsRetryInitialization` (`projects.retryInitialization`). */
export type ProjectsRetryInitializationResult = {
  projectId: string;
  status: "initializing" | "ready" | "failed";
  steps: {
    key: string;
    pluginId: string;
    status: "pending" | "running" | "ready" | "failed";
    message?: string;
    error?: string;
    attempts: number;
    updatedAt: string;
  }[];
  updatedAt: string;
};

/** Answer of `workspace/projectsTrash` (`projects.trash`). */
export type ProjectsTrashResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/projectsUpdate` (`projects.update`). */
export type ProjectsUpdateInput = {
  title?: string;
  shortDramaType?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis?: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  version: number;
};

/** Answer of `workspace/projectsUpdate` (`projects.update`). */
export type ProjectsUpdateResult = {
  id: string;
  title: string;
  shortDramaType?: string;
  mode:
    | "series_longform"
    | "single_season"
    | "personal_theater"
    | "creator_channel";
  modeConfig:
    | {
        mode: "series_longform";
        targetChapterCount?: number;
        targetSeasonCount?: number;
        targetEpisodesPerSeason?: number;
      }
    | {
        mode: "single_season";
        entryPath: "novel" | "source-import" | "script" | "inspiration";
        targetEpisodeCount?: number;
      }
    | {
        mode: "personal_theater";
        storyMethod: "template" | "freeform";
        episodeCount?: number;
        episodeDurationMinutes?: number;
      }
    | {
        mode: "creator_channel";
        topic: string;
        positioning?: string;
        audience?: string;
        platforms?: string[];
        riskDomain?: "general" | "finance" | "health" | "legal";
      };
  lifecycleStatus: "initializing" | "ready" | "failed";
  derivedFromProjectId?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  seriesId?: string;
  seriesTitle?: string;
  currentAdaptationId?: string;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/searchGlobal` (`search.global`). */
export type SearchGlobalResult = {
  query: string;
  results: {
    kind: string;
    id: string;
    title: string;
    excerpt?: string;
    projectId?: string;
    updatedAt: string;
  }[];
};

/** Input of `workspace/seriesCreate` (`series.create`). */
export type SeriesCreateInput = {
  title: string;
  description?: string;
};

/** Answer of `workspace/seriesCreate` (`series.create`). */
export type SeriesCreateResult = {
  id: string;
  title: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/seriesCreateStoryBible` (`series.createStoryBible`). */
export type SeriesCreateStoryBibleInput = {
  title: string;
  payload?: JsonValue;
};

/** Answer of `workspace/seriesCreateStoryBible` (`series.createStoryBible`). */
export type SeriesCreateStoryBibleResult = {
  id: string;
  seriesId: string;
  title: string;
  payload?: JsonValue;
  version: number;
  overridden: boolean;
  sourceVersion: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `workspace/seriesLibrary` (`series.library`). */
export type SeriesLibraryResult = {
  projectId: string;
  series?: {
    id: string;
    title: string;
    description: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  storyBible: {
    id: string;
    seriesId: string;
    title: string;
    payload?: JsonValue;
    version: number;
    overridden: boolean;
    sourceVersion: number;
    createdAt: string;
    updatedAt: string;
  }[];
  assets: {
    id: string;
    seriesId: string;
    sourceAssetId: string;
    sourceVersion: number;
    targetProjectId: string;
    targetAssetId: string;
    mode: "copy" | "fork" | "link";
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Answer of `workspace/seriesList` (`series.list`). */
export type SeriesListResult = {
  id: string;
  title: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `workspace/seriesOverrideStoryBible` (`series.overrideStoryBible`). */
export type SeriesOverrideStoryBibleInput = {
  title: string;
  payload?: JsonValue;
  sourceVersion: number;
};

/** Answer of `workspace/seriesOverrideStoryBible` (`series.overrideStoryBible`). */
export type SeriesOverrideStoryBibleResult = {
  id: string;
  seriesId: string;
  title: string;
  payload?: JsonValue;
  version: number;
  overridden: boolean;
  sourceVersion: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/seriesSetProjectSeries` (`series.setProjectSeries`). */
export type SeriesSetProjectSeriesInput = {
  seriesId?: string;
};

/** Answer of `workspace/seriesSetProjectSeries` (`series.setProjectSeries`). */
export type SeriesSetProjectSeriesResult = Record<string, JsonValue>;

/** Input of `workspace/seriesTransferAsset` (`series.transferAsset`). */
export type SeriesTransferAssetInput = {
  sourceAssetId: string;
  sourceVersion: number;
  mode: "copy" | "fork" | "link";
};

/** Answer of `workspace/seriesTransferAsset` (`series.transferAsset`). */
export type SeriesTransferAssetResult = {
  id: string;
  seriesId: string;
  sourceAssetId: string;
  sourceVersion: number;
  targetProjectId: string;
  targetAssetId: string;
  mode: "copy" | "fork" | "link";
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/seriesUpgradeStoryBible` (`series.upgradeStoryBible`). */
export type SeriesUpgradeStoryBibleInput = {
  sourceVersion: number;
};

/** Answer of `workspace/seriesUpgradeStoryBible` (`series.upgradeStoryBible`). */
export type SeriesUpgradeStoryBibleResult = {
  id: string;
  seriesId: string;
  title: string;
  payload?: JsonValue;
  version: number;
  overridden: boolean;
  sourceVersion: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `workspace/sourceImportsCommit` (`source-imports.commit`). */
export type SourceImportsCommitInput = {
  projectId: string;
  strategy: "append" | "merge" | "replace";
  rightsConfirmed: boolean;
  destructiveConfirmed: boolean;
  preview: {
    fileName: string;
    sourceType: "txt" | "markdown" | "docx" | "epub" | "script-json" | "draft";
    contentKind: "novel" | "script" | "draft";
    title: string;
    charCount: number;
    chapters: {
      key: string;
      title: string;
      content: string;
      orderIndex: number;
      wordCount: number;
      warning?: string;
    }[];
    episodes: {
      key: string;
      episodeNumber: number;
      title: string;
      content: string;
      scenes: Record<string, JsonValue>[];
    }[];
    warnings: string[];
  };
};

/** Answer of `workspace/sourceImportsCommit` (`source-imports.commit`). */
export type SourceImportsCommitResult = {
  createdChapters: number;
  updatedChapters: number;
  createdEpisodes: number;
  createdScripts: number;
  updatedScripts: number;
  createdScenes: number;
  adaptationProjectId?: string;
  checkpointCount: number;
  extractionChangeSet?: {
    id: string;
    projectId: string;
    sourceFingerprint: string;
    sourceTitle: string;
    status: "draft" | "applied" | "stale" | "discarded" | "failed";
    summary: string;
    candidates: {
      id: string;
      type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
      title: string;
      summary: string;
      confidence: number;
      sourceRefs: {
        sourceKey: string;
        chapterTitle: string;
        start: number;
        end: number;
        excerpt: string;
        sourceVersion: number;
        chapterId?: string;
      }[];
      status: "draft" | "rejected" | "adopted" | "conflict";
      conflictNote?: string;
    }[];
    appliedAt?: string;
    undoneAt?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
  };
};

/** Query of `workspace/sourceImportsGetCommit` (`source-imports.getCommit`). */
export type SourceImportsGetCommitQuery = {
  projectId: string;
  requestKey: string;
};

/** Answer of `workspace/sourceImportsGetCommit` (`source-imports.getCommit`). */
export type SourceImportsGetCommitResult = {
  importId: string;
  projectId: string;
  state: "pending" | "committed";
  input: {
    projectId: string;
    strategy: "append" | "merge" | "replace";
    rightsConfirmed: boolean;
    destructiveConfirmed: boolean;
    preview: {
      fileName: string;
      sourceType:
        "txt" | "markdown" | "docx" | "epub" | "script-json" | "draft";
      contentKind: "novel" | "script" | "draft";
      title: string;
      charCount: number;
      chapters: {
        key: string;
        title: string;
        content: string;
        orderIndex: number;
        wordCount: number;
        warning?: string;
      }[];
      episodes: {
        key: string;
        episodeNumber: number;
        title: string;
        content: string;
        scenes: Record<string, JsonValue>[];
      }[];
      warnings: string[];
    };
  };
  result?: {
    createdChapters: number;
    updatedChapters: number;
    createdEpisodes: number;
    createdScripts: number;
    updatedScripts: number;
    createdScenes: number;
    adaptationProjectId?: string;
    checkpointCount: number;
    extractionChangeSet?: {
      id: string;
      projectId: string;
      sourceFingerprint: string;
      sourceTitle: string;
      status: "draft" | "applied" | "stale" | "discarded" | "failed";
      summary: string;
      candidates: {
        id: string;
        type: "character" | "scene" | "prop" | "chapter-summary" | "adaptation";
        title: string;
        summary: string;
        confidence: number;
        sourceRefs: {
          sourceKey: string;
          chapterTitle: string;
          start: number;
          end: number;
          excerpt: string;
          sourceVersion: number;
          chapterId?: string;
        }[];
        status: "draft" | "rejected" | "adopted" | "conflict";
        conflictNote?: string;
      }[];
      appliedAt?: string;
      undoneAt?: string;
      errorMessage?: string;
      createdAt: string;
      updatedAt: string;
    };
  };
  createdAt: string;
  committedAt?: string;
};

/** Input of `workspace/sourceImportsPreview` (`source-imports.preview`). */
export type SourceImportsPreviewInput = {
  projectId?: string;
  capabilityToken: string;
};

/** Answer of `workspace/sourceImportsPreview` (`source-imports.preview`). */
export type SourceImportsPreviewResult = {
  importId: string;
  preview: {
    fileName: string;
    sourceType: "txt" | "markdown" | "docx" | "epub" | "script-json" | "draft";
    contentKind: "novel" | "script" | "draft";
    title: string;
    charCount: number;
    chapters: {
      key: string;
      title: string;
      content: string;
      orderIndex: number;
      wordCount: number;
      warning?: string;
    }[];
    episodes: {
      key: string;
      episodeNumber: number;
      title: string;
      content: string;
      scenes: Record<string, JsonValue>[];
    }[];
    warnings: string[];
  };
  duplicates: {
    chapters: string[];
    episodes: number[];
  };
  expiresAt: string;
};
