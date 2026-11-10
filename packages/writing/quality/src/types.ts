/**
 * Wire types of the `quality` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/writing-quality/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `quality/adaptationAnalysisGet` (`adaptation-analysis.get`). */
export type AdaptationAnalysisGetResult = JsonValue;

/** Answer of `quality/adaptationAnalysisRun` (`adaptation-analysis.run`). */
export type AdaptationAnalysisRunResult = JsonValue;

/** Input of `quality/analysisCreate` (`analysis.create`). */
export type AnalysisCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/analysisCreate` (`analysis.create`). */
export type AnalysisCreateResult = JsonValue;

/** Answer of `quality/analysisGet` (`analysis.get`). */
export type AnalysisGetResult = JsonValue;

/** Query of `quality/analysisList` (`analysis.list`). */
export type AnalysisListQuery = {
  projectId?: string;
};

/** Answer of `quality/analysisList` (`analysis.list`). */
export type AnalysisListResult = JsonValue;

/** Input of `quality/analysisUpdate` (`analysis.update`). */
export type AnalysisUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/analysisUpdate` (`analysis.update`). */
export type AnalysisUpdateResult = JsonValue;

/** Input of `quality/beatsCreate` (`beats.create`). */
export type BeatsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/beatsCreate` (`beats.create`). */
export type BeatsCreateResult = JsonValue;

/** Answer of `quality/beatsGet` (`beats.get`). */
export type BeatsGetResult = JsonValue;

/** Query of `quality/beatsList` (`beats.list`). */
export type BeatsListQuery = {
  projectId?: string;
};

/** Answer of `quality/beatsList` (`beats.list`). */
export type BeatsListResult = JsonValue;

/** Input of `quality/beatsUpdate` (`beats.update`). */
export type BeatsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/beatsUpdate` (`beats.update`). */
export type BeatsUpdateResult = JsonValue;

/** Input of `quality/creativeExperimentsCreate` (`creative-experiments.create`). */
export type CreativeExperimentsCreateInput = {
  originType: "inspiration" | "corpus" | "project";
  originId?: string;
  projectId?: string;
  prompt: string;
};

/** Answer of `quality/creativeExperimentsCreate` (`creative-experiments.create`). */
export type CreativeExperimentsCreateResult = {
  id: string;
  originType: "inspiration" | "corpus" | "project";
  originId?: string;
  projectId?: string;
  prompt: string;
  strategyVersion: string;
  status: "draft" | "ready" | "completed" | "rejected";
  variants: {
    id: string;
    lane: "conservative" | "balanced" | "wild";
    title: string;
    content: string;
    scores: Record<string, number>;
    selected: boolean;
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `quality/creativeExperimentsList` (`creative-experiments.list`). */
export type CreativeExperimentsListQuery = {
  projectId?: string;
};

/** Answer of `quality/creativeExperimentsList` (`creative-experiments.list`). */
export type CreativeExperimentsListResult = {
  items: {
    id: string;
    originType: "inspiration" | "corpus" | "project";
    originId?: string;
    projectId?: string;
    prompt: string;
    strategyVersion: string;
    status: "draft" | "ready" | "completed" | "rejected";
    variants: {
      id: string;
      lane: "conservative" | "balanced" | "wild";
      title: string;
      content: string;
      scores: Record<string, number>;
      selected: boolean;
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Input of `quality/creativeExperimentsReview` (`creative-experiments.review`). */
export type CreativeExperimentsReviewInput = {
  version: number;
  selectedVariantId?: string;
  rejected?: boolean;
};

/** Answer of `quality/creativeExperimentsReview` (`creative-experiments.review`). */
export type CreativeExperimentsReviewResult = {
  id: string;
  originType: "inspiration" | "corpus" | "project";
  originId?: string;
  projectId?: string;
  prompt: string;
  strategyVersion: string;
  status: "draft" | "ready" | "completed" | "rejected";
  variants: {
    id: string;
    lane: "conservative" | "balanced" | "wild";
    title: string;
    content: string;
    scores: Record<string, number>;
    selected: boolean;
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `quality/creativeFingerprintGet` (`creative-fingerprint.get`). */
export type CreativeFingerprintGetResult = {
  enabled: boolean;
  consentedAt?: string;
  dimensions: {
    key:
      | "humor"
      | "genre"
      | "tone"
      | "pace"
      | "conflict"
      | "reversal"
      | "emotional_intensity"
      | "visuality"
      | "novelty"
      | "production_complexity";
    score: number;
    confidence: number;
    frozen: boolean;
    evidenceIds: string[];
  }[];
  avoidances: string[];
  goals: string[];
  version: number;
  updatedAt: string;
};

/** Input of `quality/creativeFingerprintUpdate` (`creative-fingerprint.update`). */
export type CreativeFingerprintUpdateInput = {
  version: number;
  dimensions?: {
    key:
      | "humor"
      | "genre"
      | "tone"
      | "pace"
      | "conflict"
      | "reversal"
      | "emotional_intensity"
      | "visuality"
      | "novelty"
      | "production_complexity";
    score?: number;
    frozen?: boolean;
  }[];
  avoidances?: string[];
  goals?: string[];
};

/** Answer of `quality/creativeFingerprintUpdate` (`creative-fingerprint.update`). */
export type CreativeFingerprintUpdateResult = {
  enabled: boolean;
  consentedAt?: string;
  dimensions: {
    key:
      | "humor"
      | "genre"
      | "tone"
      | "pace"
      | "conflict"
      | "reversal"
      | "emotional_intensity"
      | "visuality"
      | "novelty"
      | "production_complexity";
    score: number;
    confidence: number;
    frozen: boolean;
    evidenceIds: string[];
  }[];
  avoidances: string[];
  goals: string[];
  version: number;
  updatedAt: string;
};

/** Input of `quality/creativeFingerprintUpdateSettings` (`creative-fingerprint.updateSettings`). */
export type CreativeFingerprintUpdateSettingsInput = {
  enabled: boolean;
};

/** Answer of `quality/creativeFingerprintUpdateSettings` (`creative-fingerprint.updateSettings`). */
export type CreativeFingerprintUpdateSettingsResult = {
  enabled: boolean;
  consentedAt?: string;
  dimensions: {
    key:
      | "humor"
      | "genre"
      | "tone"
      | "pace"
      | "conflict"
      | "reversal"
      | "emotional_intensity"
      | "visuality"
      | "novelty"
      | "production_complexity";
    score: number;
    confidence: number;
    frozen: boolean;
    evidenceIds: string[];
  }[];
  avoidances: string[];
  goals: string[];
  version: number;
  updatedAt: string;
};

/** Input of `quality/creativeAcknowledgeIssue` (`creative.acknowledgeIssue`). */
export type CreativeAcknowledgeIssueInput = {
  projectId: string;
  diagnosticId: string;
  issueKey: string;
  disposition: "accepted" | "fixed" | "not_applicable";
  note?: string;
  actorLabel?: string;
};

/** Answer of `quality/creativeAcknowledgeIssue` (`creative.acknowledgeIssue`). */
export type CreativeAcknowledgeIssueResult = JsonValue;

/** Input of `quality/creativeCreateCaseStudy` (`creative.createCaseStudy`). */
export type CreativeCreateCaseStudyInput = {
  title: string;
  sourceType?: string;
  genre?: string;
  summary?: string;
  relationshipPatterns?: string[];
  openingHooks?: string[];
  highlightBeats?: string[];
  reversalMechanisms?: string[];
  cliffhangers?: string[];
  visualPatterns?: string[];
  rhythmCurve?: number[];
  riskTags?: string[];
  notes?: string;
};

/** Answer of `quality/creativeCreateCaseStudy` (`creative.createCaseStudy`). */
export type CreativeCreateCaseStudyResult = JsonValue;

/** Answer of `quality/creativeListCaseStudies` (`creative.listCaseStudies`). */
export type CreativeListCaseStudiesResult = JsonValue;

/** Answer of `quality/creativeListDiagnostics` (`creative.listDiagnostics`). */
export type CreativeListDiagnosticsResult = JsonValue;

/** Answer of `quality/creativeListIssueAcknowledgements` (`creative.listIssueAcknowledgements`). */
export type CreativeListIssueAcknowledgementsResult = JsonValue;

/** Input of `quality/creativeRunDiagnostics` (`creative.runDiagnostics`). */
export type CreativeRunDiagnosticsInput = {
  projectId: string;
  targetKind?:
    | "project"
    | "chapter"
    | "adaptation"
    | "episode"
    | "script"
    | "scene"
    | "shot";
  targetId?: string;
  kinds: (
    "freshness" | "anti_trope" | "quality_gate" | "audience" | "narrative_curve"
  )[];
  caseStudyIds?: string[];
};

/** Answer of `quality/creativeRunDiagnostics` (`creative.runDiagnostics`). */
export type CreativeRunDiagnosticsResult = JsonValue;

/** Input of `quality/creativeUpdateCaseStudy` (`creative.updateCaseStudy`). */
export type CreativeUpdateCaseStudyInput = {
  title?: string;
  sourceType?: string;
  genre?: string;
  summary?: string;
  relationshipPatterns?: string[];
  openingHooks?: string[];
  highlightBeats?: string[];
  reversalMechanisms?: string[];
  cliffhangers?: string[];
  visualPatterns?: string[];
  rhythmCurve?: number[];
  riskTags?: string[];
  notes?: string;
  version: number;
};

/** Answer of `quality/creativeUpdateCaseStudy` (`creative.updateCaseStudy`). */
export type CreativeUpdateCaseStudyResult = JsonValue;

/** Input of `quality/episodePacingMarksCreate` (`episode-pacing-marks.create`). */
export type EpisodePacingMarksCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/episodePacingMarksCreate` (`episode-pacing-marks.create`). */
export type EpisodePacingMarksCreateResult = JsonValue;

/** Answer of `quality/episodePacingMarksGet` (`episode-pacing-marks.get`). */
export type EpisodePacingMarksGetResult = JsonValue;

/** Query of `quality/episodePacingMarksList` (`episode-pacing-marks.list`). */
export type EpisodePacingMarksListQuery = {
  projectId?: string;
};

/** Answer of `quality/episodePacingMarksList` (`episode-pacing-marks.list`). */
export type EpisodePacingMarksListResult = JsonValue;

/** Input of `quality/episodePacingMarksUpdate` (`episode-pacing-marks.update`). */
export type EpisodePacingMarksUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/episodePacingMarksUpdate` (`episode-pacing-marks.update`). */
export type EpisodePacingMarksUpdateResult = JsonValue;

/** Input of `quality/evaluationsCreate` (`evaluations.create`). */
export type EvaluationsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/evaluationsCreate` (`evaluations.create`). */
export type EvaluationsCreateResult = JsonValue;

/** Answer of `quality/evaluationsGet` (`evaluations.get`). */
export type EvaluationsGetResult = JsonValue;

/** Query of `quality/evaluationsList` (`evaluations.list`). */
export type EvaluationsListQuery = {
  projectId?: string;
};

/** Answer of `quality/evaluationsList` (`evaluations.list`). */
export type EvaluationsListResult = JsonValue;

/** Input of `quality/evaluationsUpdate` (`evaluations.update`). */
export type EvaluationsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/evaluationsUpdate` (`evaluations.update`). */
export type EvaluationsUpdateResult = JsonValue;

/** Input of `quality/feasibilityCreate` (`feasibility.create`). */
export type FeasibilityCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/feasibilityCreate` (`feasibility.create`). */
export type FeasibilityCreateResult = JsonValue;

/** Answer of `quality/feasibilityGet` (`feasibility.get`). */
export type FeasibilityGetResult = JsonValue;

/** Query of `quality/feasibilityList` (`feasibility.list`). */
export type FeasibilityListQuery = {
  projectId?: string;
};

/** Answer of `quality/feasibilityList` (`feasibility.list`). */
export type FeasibilityListResult = JsonValue;

/** Input of `quality/feasibilityUpdate` (`feasibility.update`). */
export type FeasibilityUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/feasibilityUpdate` (`feasibility.update`). */
export type FeasibilityUpdateResult = JsonValue;

/** Input of `quality/highlightsCreate` (`highlights.create`). */
export type HighlightsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/highlightsCreate` (`highlights.create`). */
export type HighlightsCreateResult = JsonValue;

/** Answer of `quality/highlightsGet` (`highlights.get`). */
export type HighlightsGetResult = JsonValue;

/** Query of `quality/highlightsList` (`highlights.list`). */
export type HighlightsListQuery = {
  projectId?: string;
};

/** Answer of `quality/highlightsList` (`highlights.list`). */
export type HighlightsListResult = JsonValue;

/** Input of `quality/highlightsUpdate` (`highlights.update`). */
export type HighlightsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/highlightsUpdate` (`highlights.update`). */
export type HighlightsUpdateResult = JsonValue;

/** Input of `quality/narrativeLocalQualityCreate` (`narrativeLocalQuality.create`). */
export type NarrativeLocalQualityCreateInput =
  | {
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
      sourceFingerprint: string;
      confirmed: true;
      baseReviewId: string | null;
      origin: "human-declared";
      content: {
        summary: string;
        reviewedDimensions: (
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
        reviewedChapters?: {
          id: string;
          version: number;
        }[];
        reviewedSources?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        issues: {
          id: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
          severity: "error" | "warning" | "suggestion";
          message: string;
          suggestion: string;
          source: "rule" | "model" | "human";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
        }[];
      };
    }
  | {
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
      sourceFingerprint: string;
      confirmed: true;
      baseReviewId: string | null;
      origin: "rule";
      ruleId: "literal-repeated-passage-v1";
    };

/** Answer of `quality/narrativeLocalQualityCreate` (`narrativeLocalQuality.create`). */
export type NarrativeLocalQualityCreateResult =
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "human-declared";
      content: {
        summary: string;
        reviewedDimensions: (
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
        reviewedChapters?: {
          id: string;
          version: number;
        }[];
        reviewedSources?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        issues: {
          id: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
          severity: "error" | "warning" | "suggestion";
          message: string;
          suggestion: string;
          source: "rule" | "model" | "human";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
        }[];
      };
    }
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "rule";
      content: {
        summary: string;
        checkedRules: "literal-repeated-passage-v1"[];
        semanticCoverage: "not-assessed";
        findings: {
          id: string;
          category: "repetition";
          severity: "suggestion";
          message: string;
          suggestion: string;
          source: "rule";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
          ruleId: "literal-repeated-passage-v1";
        }[];
      };
    };

/** Input of `quality/narrativeLocalQualityDecide` (`narrativeLocalQuality.decide`). */
export type NarrativeLocalQualityDecideInput = {
  action: "adopt" | "discard";
  version: number;
  confirmed: true;
};

/** Answer of `quality/narrativeLocalQualityDecide` (`narrativeLocalQuality.decide`). */
export type NarrativeLocalQualityDecideResult =
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "human-declared";
      content: {
        summary: string;
        reviewedDimensions: (
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
        reviewedChapters?: {
          id: string;
          version: number;
        }[];
        reviewedSources?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        issues: {
          id: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
          severity: "error" | "warning" | "suggestion";
          message: string;
          suggestion: string;
          source: "rule" | "model" | "human";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
        }[];
      };
    }
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "rule";
      content: {
        summary: string;
        checkedRules: "literal-repeated-passage-v1"[];
        semanticCoverage: "not-assessed";
        findings: {
          id: string;
          category: "repetition";
          severity: "suggestion";
          message: string;
          suggestion: string;
          source: "rule";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
          ruleId: "literal-repeated-passage-v1";
        }[];
      };
    };

/** Input of `quality/narrativeLocalQualityDisposition` (`narrativeLocalQuality.disposition`). */
export type NarrativeLocalQualityDispositionInput = {
  issueId: string;
  state: "open" | "accepted-risk" | "resolved";
  note: string;
  confirmed: true;
  recheckReviewId?: string;
  version: number;
};

/** Answer of `quality/narrativeLocalQualityDisposition` (`narrativeLocalQuality.disposition`). */
export type NarrativeLocalQualityDispositionResult =
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "human-declared";
      content: {
        summary: string;
        reviewedDimensions: (
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
        reviewedChapters?: {
          id: string;
          version: number;
        }[];
        reviewedSources?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        issues: {
          id: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
          severity: "error" | "warning" | "suggestion";
          message: string;
          suggestion: string;
          source: "rule" | "model" | "human";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
        }[];
      };
    }
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "rule";
      content: {
        summary: string;
        checkedRules: "literal-repeated-passage-v1"[];
        semanticCoverage: "not-assessed";
        findings: {
          id: string;
          category: "repetition";
          severity: "suggestion";
          message: string;
          suggestion: string;
          source: "rule";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
          ruleId: "literal-repeated-passage-v1";
        }[];
      };
    };

/** Answer of `quality/narrativeLocalQualityGet` (`narrativeLocalQuality.get`). */
export type NarrativeLocalQualityGetResult =
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "human-declared";
      content: {
        summary: string;
        reviewedDimensions: (
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
        reviewedChapters?: {
          id: string;
          version: number;
        }[];
        reviewedSources?: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
        }[];
        issues: {
          id: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
          severity: "error" | "warning" | "suggestion";
          message: string;
          suggestion: string;
          source: "rule" | "model" | "human";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
        }[];
      };
    }
  | {
      id: string;
      projectId: string;
      version: number;
      status: "awaiting-review" | "adopted" | "discarded";
      source: {
        format: "narrative-local-review-source-v1";
        projectId: string;
        sourceFingerprint: string;
        baseReviewId: string | null;
        basis: {
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
          references: {
            sourceKind:
              "chapter" | "author_intent" | "production" | "knowledge";
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
          value?: JsonValue;
          sensitivity: "project" | "personal" | "public";
          policyDependencies?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
        }[];
      };
      dispositions: {
        issueId: string;
        state: "open" | "accepted-risk" | "resolved";
        source: "human-declared";
        note: string;
        recheckReviewId?: string;
        decidedAt: string;
      }[];
      qualityState: "unverified";
      isCurrent: boolean;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      blockers: string[];
      createdAt: string;
      updatedAt: string;
      adoptedAt?: string;
      origin: "rule";
      content: {
        summary: string;
        checkedRules: "literal-repeated-passage-v1"[];
        semanticCoverage: "not-assessed";
        findings: {
          id: string;
          category: "repetition";
          severity: "suggestion";
          message: string;
          suggestion: string;
          source: "rule";
          evidence: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
            valuePath: string;
            quote: string;
          }[];
          ruleId: "literal-repeated-passage-v1";
        }[];
      };
    };

/** Answer of `quality/narrativeLocalQualityList` (`narrativeLocalQuality.list`). */
export type NarrativeLocalQualityListResult = {
  items: (
    | {
        id: string;
        projectId: string;
        version: number;
        status: "awaiting-review" | "adopted" | "discarded";
        source: {
          format: "narrative-local-review-source-v1";
          projectId: string;
          sourceFingerprint: string;
          baseReviewId: string | null;
          basis: {
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
            references: {
              sourceKind:
                "chapter" | "author_intent" | "production" | "knowledge";
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
            value?: JsonValue;
            sensitivity: "project" | "personal" | "public";
            policyDependencies?: {
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
            }[];
          }[];
        };
        dispositions: {
          issueId: string;
          state: "open" | "accepted-risk" | "resolved";
          source: "human-declared";
          note: string;
          recheckReviewId?: string;
          decidedAt: string;
        }[];
        qualityState: "unverified";
        isCurrent: boolean;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        blockers: string[];
        createdAt: string;
        updatedAt: string;
        adoptedAt?: string;
        origin: "human-declared";
        content: {
          summary: string;
          reviewedDimensions: (
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
          reviewedChapters?: {
            id: string;
            version: number;
          }[];
          reviewedSources?: {
            sourceId: string;
            sourceVersion: number;
            fieldPath: string;
          }[];
          issues: {
            id: string;
            category:
              | "author-intent"
              | "character-knowledge"
              | "relationships"
              | "timeline"
              | "causality"
              | "foreshadowing"
              | "repetition"
              | "pacing"
              | "dialogue"
              | "production-risk";
            severity: "error" | "warning" | "suggestion";
            message: string;
            suggestion: string;
            source: "rule" | "model" | "human";
            evidence: {
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              valuePath: string;
              quote: string;
            }[];
          }[];
        };
      }
    | {
        id: string;
        projectId: string;
        version: number;
        status: "awaiting-review" | "adopted" | "discarded";
        source: {
          format: "narrative-local-review-source-v1";
          projectId: string;
          sourceFingerprint: string;
          baseReviewId: string | null;
          basis: {
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
            references: {
              sourceKind:
                "chapter" | "author_intent" | "production" | "knowledge";
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
            value?: JsonValue;
            sensitivity: "project" | "personal" | "public";
            policyDependencies?: {
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
            }[];
          }[];
        };
        dispositions: {
          issueId: string;
          state: "open" | "accepted-risk" | "resolved";
          source: "human-declared";
          note: string;
          recheckReviewId?: string;
          decidedAt: string;
        }[];
        qualityState: "unverified";
        isCurrent: boolean;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        blockers: string[];
        createdAt: string;
        updatedAt: string;
        adoptedAt?: string;
        origin: "rule";
        content: {
          summary: string;
          checkedRules: "literal-repeated-passage-v1"[];
          semanticCoverage: "not-assessed";
          findings: {
            id: string;
            category: "repetition";
            severity: "suggestion";
            message: string;
            suggestion: string;
            source: "rule";
            evidence: {
              sourceId: string;
              sourceVersion: number;
              fieldPath: string;
              valuePath: string;
              quote: string;
            }[];
            ruleId: "literal-repeated-passage-v1";
          }[];
        };
      }
  )[];
  nextCursor?: string;
};

/** Input of `quality/narrativeLocalQualityPreview` (`narrativeLocalQuality.preview`). */
export type NarrativeLocalQualityPreviewInput = {
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

/** Answer of `quality/narrativeLocalQualityPreview` (`narrativeLocalQuality.preview`). */
export type NarrativeLocalQualityPreviewResult = {
  format: "narrative-local-review-source-v1";
  projectId: string;
  sourceFingerprint: string;
  baseReviewId: string | null;
  basis: {
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
    value?: JsonValue;
    sensitivity: "project" | "personal" | "public";
    policyDependencies?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  }[];
};

/** Query of `quality/narrativeLocalQualitySummaries` (`narrativeLocalQuality.summaries`). */
export type NarrativeLocalQualitySummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `quality/narrativeLocalQualitySummaries` (`narrativeLocalQuality.summaries`). */
export type NarrativeLocalQualitySummariesResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    version: number;
    origin: "human-declared" | "rule";
    status: "awaiting-review" | "adopted" | "discarded";
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
    sourceFingerprint: string;
    qualityState: "unverified";
    isCurrent: boolean;
    sourceState: "current" | "stale" | "unverified";
    sourceReasonCount: number;
    issueCount: number;
    openIssueCount: number;
    blockerCount: number;
    acceptedRiskCount: number;
    resolvedIssueCount: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `quality/narrativeQualityDisposition` (`narrativeQuality.disposition`). */
export type NarrativeQualityDispositionInput = {
  issueId: string;
  state: "open" | "accepted-risk" | "resolved";
  note: string;
  confirmed: true;
  recheckReportId?: string;
  version: number;
};

/** Answer of `quality/narrativeQualityDisposition` (`narrativeQuality.disposition`). */
export type NarrativeQualityDispositionResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  status: "awaiting-review" | "adopted" | "discarded";
  basis: {
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
  content: {
    summary: string;
    reviewedDimensions: (
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
    reviewedChapters?: {
      id: string;
      version: number;
    }[];
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    issues: {
      id: string;
      category:
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk";
      severity: "error" | "warning" | "suggestion";
      message: string;
      suggestion: string;
      source: "rule" | "model" | "human";
      evidence: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        valuePath: string;
        quote: string;
      }[];
    }[];
  };
  dispositions: {
    issueId: string;
    state: "open" | "accepted-risk" | "resolved";
    source: "human";
    note: string;
    recheckReportId?: string;
    decidedAt: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  model?: Record<string, string>;
  usage: {
    state: "unknown";
  };
  contextBudget?: {
    source: "estimate";
    estimatedTokens: number;
    tokenBudget: number;
  };
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
};

/** Answer of `quality/narrativeQualityGet` (`narrativeQuality.get`). */
export type NarrativeQualityGetResult = {
  id: string;
  projectId: string;
  workflowId: string;
  version: number;
  status: "awaiting-review" | "adopted" | "discarded";
  basis: {
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
  content: {
    summary: string;
    reviewedDimensions: (
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
    reviewedChapters?: {
      id: string;
      version: number;
    }[];
    reviewedSources?: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
    issues: {
      id: string;
      category:
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk";
      severity: "error" | "warning" | "suggestion";
      message: string;
      suggestion: string;
      source: "rule" | "model" | "human";
      evidence: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        valuePath: string;
        quote: string;
      }[];
    }[];
  };
  dispositions: {
    issueId: string;
    state: "open" | "accepted-risk" | "resolved";
    source: "human";
    note: string;
    recheckReportId?: string;
    decidedAt: string;
  }[];
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  model?: Record<string, string>;
  usage: {
    state: "unknown";
  };
  contextBudget?: {
    source: "estimate";
    estimatedTokens: number;
    tokenBudget: number;
  };
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
};

/** Query of `quality/narrativeQualityList` (`narrativeQuality.list`). */
export type NarrativeQualityListQuery = {
  cursor?: string;
  limit?: string;
};

/** Answer of `quality/narrativeQualityList` (`narrativeQuality.list`). */
export type NarrativeQualityListResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    status: "awaiting-review" | "adopted" | "discarded";
    basis: {
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
    content: {
      summary: string;
      reviewedDimensions: (
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
      reviewedChapters?: {
        id: string;
        version: number;
      }[];
      reviewedSources?: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
      issues: {
        id: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
        severity: "error" | "warning" | "suggestion";
        message: string;
        suggestion: string;
        source: "rule" | "model" | "human";
        evidence: {
          sourceId: string;
          sourceVersion: number;
          fieldPath: string;
          valuePath: string;
          quote: string;
        }[];
      }[];
    };
    dispositions: {
      issueId: string;
      state: "open" | "accepted-risk" | "resolved";
      source: "human";
      note: string;
      recheckReportId?: string;
      decidedAt: string;
    }[];
    sourceSnapshotId: string;
    runIds: string[];
    engineKind: "pi";
    model?: Record<string, string>;
    usage: {
      state: "unknown";
    };
    contextBudget?: {
      source: "estimate";
      estimatedTokens: number;
      tokenBudget: number;
    };
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    blockers: string[];
    createdAt: string;
    updatedAt: string;
    adoptedAt?: string;
  }[];
  nextCursor?: string;
};

/** Answer of `quality/narrativeQualitySources` (`narrativeQuality.sources`). */
export type NarrativeQualitySourcesResult = {
  targets: {
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
    title: string;
  }[];
  unavailable: string[];
  chapterSet?: {
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
    chapters: {
      id: string;
      version: number;
      title: string;
      hasContent: boolean;
    }[];
    directoryFingerprint: string;
  };
};

/** Query of `quality/narrativeQualitySummaries` (`narrativeQuality.summaries`). */
export type NarrativeQualitySummariesQuery = {
  cursor?: string;
  limit?: string;
};

/** Answer of `quality/narrativeQualitySummaries` (`narrativeQuality.summaries`). */
export type NarrativeQualitySummariesResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    status: "awaiting-review" | "adopted" | "discarded";
    isCurrent: boolean;
    sourceState: "current" | "stale";
    createdAt: string;
    updatedAt: string;
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
    openIssueCount: number;
    blockerCount: number;
    acceptedRiskCount: number;
  }[];
  nextCursor?: string;
};

/** Answer of `quality/originalityRisksList` (`originality-risks.list`). */
export type OriginalityRisksListResult = {
  items: {
    id: string;
    projectId: string;
    targetType: string;
    targetId: string;
    severity: "info" | "review" | "high";
    reason: string;
    evidenceEdgeIds: string[];
    legalConclusion: false;
    createdAt: string;
  }[];
};

/** Input of `quality/create` (`quality.create`). */
export type CreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/create` (`quality.create`). */
export type CreateResult = JsonValue;

/** Answer of `quality/get` (`quality.get`). */
export type GetResult = JsonValue;

/** Query of `quality/list` (`quality.list`). */
export type ListQuery = {
  projectId?: string;
};

/** Answer of `quality/list` (`quality.list`). */
export type ListResult = JsonValue;

/** Input of `quality/update` (`quality.update`). */
export type UpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/update` (`quality.update`). */
export type UpdateResult = JsonValue;

/** Input of `quality/trendsCreate` (`trends.create`). */
export type TrendsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `quality/trendsCreate` (`trends.create`). */
export type TrendsCreateResult = JsonValue;

/** Answer of `quality/trendsGet` (`trends.get`). */
export type TrendsGetResult = JsonValue;

/** Query of `quality/trendsList` (`trends.list`). */
export type TrendsListQuery = {
  projectId?: string;
};

/** Answer of `quality/trendsList` (`trends.list`). */
export type TrendsListResult = JsonValue;

/** Input of `quality/trendsUpdate` (`trends.update`). */
export type TrendsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `quality/trendsUpdate` (`trends.update`). */
export type TrendsUpdateResult = JsonValue;
