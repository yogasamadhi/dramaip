/**
 * The shapes the episode development impact operation declares.
 *
 * @module @dramaip/production-production/wire/episode-development-ops/impact
 */
/** Query of `production/episodeDevelopmentsImpact` (`episodeDevelopments.impact`). */
export type EpisodeDevelopmentsImpactQuery = {
  attributionId?: string;
  attributionVersion?: string;
};

/** Answer of `production/episodeDevelopmentsImpact` (`episodeDevelopments.impact`). */
export type EpisodeDevelopmentsImpactResult = {
  result: {
    id: string;
    version: number;
  };
  projectId: string;
  episodeId: string;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  upstreamConstraints?: {
    format: "formal-constraint-observations-v1";
    items: {
      kind:
        | "season-plan"
        | "adaptation-diagnosis"
        | "adaptation-strategy"
        | "author-intent"
        | "story-bible"
        | "episode-outline"
        | "episode-script"
        | "direct-project"
        | "direct-episode"
        | "direct-source-script";
      frozen: {
        id: string;
        version: number;
        contentHash: string | null;
        position?: number;
        documentVersion?: number | null;
      } | null;
      current: {
        id: string;
        version: number;
        contentHash: string | null;
        position?: number;
        documentVersion?: number | null;
      } | null;
      readState: "available" | "unavailable";
      currentSourceState: "current" | "stale" | "unverified" | null;
      change:
        | "same-reference"
        | "changed"
        | "replaced"
        | "added"
        | "removed"
        | "unavailable"
        | "unverified";
    }[];
    approvedStoryBible: {
      frozenCount: number;
      currentCount: number | null;
      readState: "available" | "unavailable";
    };
  };
  recordBaselines?: {
    format: "production-record-baseline-observations-v1";
    records: {
      id: string;
      stableId: string;
      kind: "scenes" | "shots";
      frozenVersion: number;
      frozen: {
        parentId: string | null;
        orderIndex: number;
        contentHash: string;
        capturedResult: {
          id: string;
          version: number;
        };
      } | null;
      current: {
        parentId: string | null;
        orderIndex: number;
        version: number;
        contentHash: string;
      } | null;
      state:
        | "unchanged"
        | "changed"
        | "unrecorded"
        | "baseline-invalid"
        | "record-missing"
        | "record-invalid";
      changes: {
        field: "title" | "parentId" | "orderIndex" | "payload";
        beforeHash: string;
        afterHash: string;
      }[];
    }[];
  };
  attributionImpact?: {
    format: "exact-shot-attribution-impact-v1";
    projectId: string;
    episodeId: string;
    attribution: {
      id: string;
      version: number;
    };
    storyboard: {
      id: string;
      version: number;
    };
    isCurrent: boolean;
    sourceFingerprint: string;
    associationFingerprint: string;
    coverage: {
      totalShots: number;
      associatedShots: number;
      nodeAssociatedShots: number;
      associatedBlockCount: number;
      unassociatedShotIds: string[];
    };
    links: {
      index: number;
      original: {
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
      };
      quote: {
        frozenVerified: boolean;
        readState: "available" | "missing" | "unavailable" | "unverified";
        currentSourceVersion: number | null;
        expressionHash: string | null;
        currentSliceHash: string | null;
        comparison:
          | "same-position-match"
          | "position-changed"
          | "missing"
          | "unavailable"
          | "unverified";
        sourceBlock: {
          id: string;
          index: number;
          type: string;
        } | null;
        paragraph: {
          id: string;
          present: boolean;
          start: number | null;
          end: number | null;
        } | null;
      };
      blocks: {
        id: string;
        frozen: {
          id: string;
          index: number;
          type: string;
          contentHash: string;
        } | null;
        current: {
          id: string;
          index: number;
          type: string;
          contentHash: string;
        } | null;
        readState: "available" | "unavailable";
        change:
          | "same-reference"
          | "changed"
          | "reordered"
          | "missing"
          | "unavailable";
      }[];
      records: {
        scene: {
          frozen: {
            id: string;
            version: number;
            contentHash: string;
          };
          current: {
            id: string;
            version: number;
            contentHash: string;
            retired: boolean;
          } | null;
          readState: "available" | "unavailable";
          change:
            | "same-reference"
            | "changed"
            | "missing"
            | "retired"
            | "unavailable";
        };
        shot: {
          frozen: {
            id: string;
            version: number;
            contentHash: string;
          };
          current: {
            id: string;
            version: number;
            contentHash: string;
            retired: boolean;
          } | null;
          readState: "available" | "unavailable";
          change:
            | "same-reference"
            | "changed"
            | "missing"
            | "retired"
            | "unavailable";
        };
      };
      node: {
        readState: "available" | "unavailable";
        observation: {
          format: "exact-story-node-owner-observation-v1";
          projectId: string;
          requested: {
            declaration: {
              id: string;
              version: number;
            };
            node: {
              id: string;
              version: number;
            };
          };
          declaration: {
            id: string;
            version: number;
            status: "pending" | "adopted" | "discarded";
            adoptedNode: {
              id: string;
              version: number;
            } | null;
            sourceState: "current" | "stale" | "unavailable";
            contentHash: string;
          } | null;
          node: {
            id: string;
            version: number;
            retired: boolean;
            confirmed: boolean;
            contentHash: string;
          } | null;
          lifecycle: {
            state: "active" | "withdrawn" | "replaced";
            version: number;
            record: {
              kind: "node" | "edge" | "cognition";
              id: string;
              version: number;
            };
            replacementId?: string;
          } | null;
          referenceHash: string | null;
          reasonCodes: (
            | "declaration-missing"
            | "declaration-not-adopted"
            | "declaration-version-changed"
            | "declaration-node-binding-changed"
            | "node-missing"
            | "node-version-changed"
            | "node-fields-changed"
            | "node-unconfirmed"
            | "node-retired"
            | "node-lifecycle-withdrawn"
            | "node-lifecycle-replaced"
            | "declaration-source-stale"
            | "declaration-source-unavailable"
          )[];
          semanticVerification: "unverified";
        } | null;
        referenceComparison: "same-reference" | "changed" | "unavailable";
      } | null;
      reasonCodes: (
        | "original-source-unverified"
        | "source-read-unavailable"
        | "source-missing"
        | "source-expression-unverified"
        | "source-version-changed"
        | "quote-position-changed"
        | "source-block-missing"
        | "source-block-reordered"
        | "source-block-type-changed"
        | "source-paragraph-missing"
        | "source-paragraph-position-changed"
        | "script-block-unavailable"
        | "script-block-missing"
        | "script-block-changed"
        | "script-block-reordered"
        | "scene-record-unavailable"
        | "scene-record-missing"
        | "scene-record-changed"
        | "scene-record-retired"
        | "shot-record-unavailable"
        | "shot-record-missing"
        | "shot-record-changed"
        | "shot-record-retired"
        | "story-node-unavailable"
        | "story-node-reference-changed"
        | "declaration-missing"
        | "declaration-not-adopted"
        | "declaration-version-changed"
        | "declaration-node-binding-changed"
        | "node-missing"
        | "node-version-changed"
        | "node-fields-changed"
        | "node-unconfirmed"
        | "node-retired"
        | "node-lifecycle-withdrawn"
        | "node-lifecycle-replaced"
        | "declaration-source-stale"
        | "declaration-source-unavailable"
      )[];
      associationImpact: "affected" | "no-observed-change" | "unresolved";
    }[];
    textIncluded: false;
    semanticVerification: "unverified";
    automaticRedo: false;
  };
  confirmedSourceTransition?: {
    format: "verified-formal-source-transition-v1";
    originalOutline: {
      id: string;
      version: number;
    };
    originalScript: {
      id: string;
      version: number;
    };
    currentOutline: {
      id: string;
      version: number;
    };
    currentScript: {
      id: string;
      version: number;
    };
    document: {
      id: string;
      scriptId: string;
      version: number;
      contentHash: string;
    };
    confirmationPreviews: {
      id: string;
      version: number;
    }[];
    completeAuthorReviewRequired: true;
    semanticVerification: "unverified";
  };
  script: {
    id: string | null;
    result: {
      id: string;
      version: number;
    } | null;
    frozenDocumentVersion: number | null;
    currentDocumentVersion: number | null;
  };
  blockChanges: {
    blockId: string;
    kind: "added" | "removed" | "changed" | "reordered";
    fields: ("type" | "text" | "sceneNumber" | "order")[];
    beforeHash: string | null;
    afterHash: string | null;
  }[];
  shots: {
    sceneId: string;
    shotId: string;
    record: {
      id: string;
      frozenVersion: number;
      currentVersion: number | null;
    } | null;
    associationImpact: "affected" | "no-observed-change" | "unresolved";
    changedBlockIds: string[];
    reasonCodes: (
      | "source-block-changed"
      | "scene-structure-changed"
      | "scene-context-changed"
      | "scene-record-changed"
      | "shot-record-changed"
      | "record-unavailable"
      | "mapping-unresolved"
      | "upstream-not-localized"
    )[];
  }[];
  globalReviewReasons: string[];
  comparison: "frozen-script-to-actual-document-and-record-versions-v1";
  semanticVerification: "unverified";
  automaticRedo: false;
  snapshotHash: string;
};
