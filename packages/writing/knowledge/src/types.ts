/**
 * Wire types of the `knowledge` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/writing-knowledge/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `knowledge/audienceCreate` (`audience-knowledge.create`). */
export type AudienceCreateInput = {
  subjectType: "audience" | "character";
  subjectId: string;
  knowledgeNodeId: string;
  storyOrder: number;
  state: "unknown" | "suspects" | "misbelieves" | "knows";
  evidence: string;
};

/** Answer of `knowledge/audienceCreate` (`audience-knowledge.create`). */
export type AudienceCreateResult = {
  id: string;
  projectId: string;
  subjectType: "audience" | "character";
  subjectId: string;
  knowledgeNodeId: string;
  storyOrder: number;
  state: "unknown" | "suspects" | "misbelieves" | "knows";
  evidence: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/chapterMemoriesCreate` (`chapter-memories.create`). */
export type ChapterMemoriesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/chapterMemoriesCreate` (`chapter-memories.create`). */
export type ChapterMemoriesCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/chapterMemoriesGet` (`chapter-memories.get`). */
export type ChapterMemoriesGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/chapterMemoriesList` (`chapter-memories.list`). */
export type ChapterMemoriesListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/chapterMemoriesList` (`chapter-memories.list`). */
export type ChapterMemoriesListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/chapterMemoriesUpdate` (`chapter-memories.update`). */
export type ChapterMemoriesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/chapterMemoriesUpdate` (`chapter-memories.update`). */
export type ChapterMemoriesUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/characterStatesCreate` (`character-states.create`). */
export type CharacterStatesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/characterStatesCreate` (`character-states.create`). */
export type CharacterStatesCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/characterStatesGet` (`character-states.get`). */
export type CharacterStatesGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/characterStatesList` (`character-states.list`). */
export type CharacterStatesListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/characterStatesList` (`character-states.list`). */
export type CharacterStatesListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/characterStatesUpdate` (`character-states.update`). */
export type CharacterStatesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/characterStatesUpdate` (`character-states.update`). */
export type CharacterStatesUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/creativeCollectionsCreate` (`creative-collections.create`). */
export type CreativeCollectionsCreateInput = {
  corpusItemId?: string;
  title: string;
  mechanism: string;
  notes?: string;
  tags?: string[];
};

/** Answer of `knowledge/creativeCollectionsCreate` (`creative-collections.create`). */
export type CreativeCollectionsCreateResult = {
  id: string;
  corpusItemId?: string;
  title: string;
  mechanism: string;
  notes?: string;
  tags?: string[];
  adopted: boolean;
  useCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/creativeCollectionsList` (`creative-collections.list`). */
export type CreativeCollectionsListResult = {
  items: {
    id: string;
    corpusItemId?: string;
    title: string;
    mechanism: string;
    notes?: string;
    tags?: string[];
    adopted: boolean;
    useCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Input of `knowledge/creativeCorpusCreate` (`creative-corpus.create`). */
export type CreativeCorpusCreateInput = {
  sourceId?: string;
  visibility: "public" | "private";
  kind:
    | "meme"
    | "comic_device"
    | "dialogue_pattern"
    | "character_hook"
    | "relationship_hook"
    | "conflict"
    | "reversal"
    | "scene"
    | "world_rule"
    | "style"
    | "social_observation";
  title: string;
  trigger?: string;
  mechanism: string;
  emotionalEffect?: string;
  contexts?: string[];
  riskTags?: string[];
  tags?: string[];
  freshness?: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
  rightsStatus?:
    "unknown" | "review_required" | "allowed" | "restricted" | "removed";
  locale?: string;
};

/** Answer of `knowledge/creativeCorpusCreate` (`creative-corpus.create`). */
export type CreativeCorpusCreateResult = {
  id: string;
  sourceId?: string;
  visibility: "public" | "private";
  kind:
    | "meme"
    | "comic_device"
    | "dialogue_pattern"
    | "character_hook"
    | "relationship_hook"
    | "conflict"
    | "reversal"
    | "scene"
    | "world_rule"
    | "style"
    | "social_observation";
  title: string;
  trigger?: string;
  mechanism: string;
  emotionalEffect?: string;
  contexts?: string[];
  riskTags?: string[];
  tags?: string[];
  freshness: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
  rightsStatus:
    "unknown" | "review_required" | "allowed" | "restricted" | "removed";
  locale: string;
  tombstonedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/creativeCorpusImportSnapshot` (`creative-corpus.importSnapshot`). */
export type CreativeCorpusImportSnapshotInput = {
  format: "dramaip-creative-corpus-snapshot";
  schemaVersion: 1;
  version: string;
  sources: {
    id: string;
    url?: string;
    domain?: string;
    title: string;
    excerpt?: string;
    contentHash?: string;
    status: "quarantined" | "allowed" | "blocked" | "takedown";
    rightsStatus:
      "unknown" | "review_required" | "allowed" | "restricted" | "removed";
    locale?: string;
    retrievedAt: string;
    createdAt: string;
    updatedAt: string;
  }[];
  items: {
    id: string;
    sourceId?: string;
    visibility: "public" | "private";
    kind:
      | "meme"
      | "comic_device"
      | "dialogue_pattern"
      | "character_hook"
      | "relationship_hook"
      | "conflict"
      | "reversal"
      | "scene"
      | "world_rule"
      | "style"
      | "social_observation";
    title: string;
    trigger?: string;
    mechanism: string;
    emotionalEffect?: string;
    contexts?: string[];
    riskTags?: string[];
    tags?: string[];
    freshness: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
    rightsStatus:
      "unknown" | "review_required" | "allowed" | "restricted" | "removed";
    locale: string;
    tombstonedAt?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  tombstones?: string[];
  signature: string;
};

/** Answer of `knowledge/creativeCorpusImportSnapshot` (`creative-corpus.importSnapshot`). */
export type CreativeCorpusImportSnapshotResult = {
  imported: number;
  tombstoned: number;
};

/** Query of `knowledge/creativeCorpusList` (`creative-corpus.list`). */
export type CreativeCorpusListQuery = {
  query?: string;
  visibility?: string;
  limit?: string;
};

/** Answer of `knowledge/creativeCorpusList` (`creative-corpus.list`). */
export type CreativeCorpusListResult = {
  items: {
    id: string;
    sourceId?: string;
    visibility: "public" | "private";
    kind:
      | "meme"
      | "comic_device"
      | "dialogue_pattern"
      | "character_hook"
      | "relationship_hook"
      | "conflict"
      | "reversal"
      | "scene"
      | "world_rule"
      | "style"
      | "social_observation";
    title: string;
    trigger?: string;
    mechanism: string;
    emotionalEffect?: string;
    contexts?: string[];
    riskTags?: string[];
    tags?: string[];
    freshness: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
    rightsStatus:
      "unknown" | "review_required" | "allowed" | "restricted" | "removed";
    locale: string;
    tombstonedAt?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Input of `knowledge/creativeCorpusUpdate` (`creative-corpus.update`). */
export type CreativeCorpusUpdateInput = {
  sourceId?: string;
  visibility?: "public" | "private";
  kind?:
    | "meme"
    | "comic_device"
    | "dialogue_pattern"
    | "character_hook"
    | "relationship_hook"
    | "conflict"
    | "reversal"
    | "scene"
    | "world_rule"
    | "style"
    | "social_observation";
  title?: string;
  trigger?: string;
  mechanism?: string;
  emotionalEffect?: string;
  contexts?: string[];
  riskTags?: string[];
  tags?: string[];
  freshness?: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
  rightsStatus?:
    "unknown" | "review_required" | "allowed" | "restricted" | "removed";
  locale?: string;
  version: number;
};

/** Answer of `knowledge/creativeCorpusUpdate` (`creative-corpus.update`). */
export type CreativeCorpusUpdateResult = {
  id: string;
  sourceId?: string;
  visibility: "public" | "private";
  kind:
    | "meme"
    | "comic_device"
    | "dialogue_pattern"
    | "character_hook"
    | "relationship_hook"
    | "conflict"
    | "reversal"
    | "scene"
    | "world_rule"
    | "style"
    | "social_observation";
  title: string;
  trigger?: string;
  mechanism: string;
  emotionalEffect?: string;
  contexts?: string[];
  riskTags?: string[];
  tags?: string[];
  freshness: "emerging" | "stable" | "cooling" | "expired" | "evergreen";
  rightsStatus:
    "unknown" | "review_required" | "allowed" | "restricted" | "removed";
  locale: string;
  tombstonedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/foreshadowingsCreate` (`foreshadowings.create`). */
export type ForeshadowingsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/foreshadowingsCreate` (`foreshadowings.create`). */
export type ForeshadowingsCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/foreshadowingsGet` (`foreshadowings.get`). */
export type ForeshadowingsGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/foreshadowingsList` (`foreshadowings.list`). */
export type ForeshadowingsListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/foreshadowingsList` (`foreshadowings.list`). */
export type ForeshadowingsListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/foreshadowingsUpdate` (`foreshadowings.update`). */
export type ForeshadowingsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/foreshadowingsUpdate` (`foreshadowings.update`). */
export type ForeshadowingsUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/ipTwinBuild` (`ip-twin.build`). */
export type IpTwinBuildResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  stale: boolean;
  nodes: {
    id: string;
    projectId: string;
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    summary: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  edges: {
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    relation:
      | "causes"
      | "enables"
      | "blocks"
      | "reveals"
      | "conflicts_with"
      | "depends_on";
    rationale: string;
    confidence: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  audienceStates: {
    id: string;
    projectId: string;
    subjectType: "audience" | "character";
    subjectId: string;
    knowledgeNodeId: string;
    storyOrder: number;
    state: "unknown" | "suspects" | "misbelieves" | "knows";
    evidence: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  conflicts: string[];
  ruleAnalysis?: {
    ruleSet: "story-structure-rules-v1";
    evidencePolicy: "frozen-author-declarations-not-semantic-proof";
    coverage: {
      nodeCount: number;
      edgeCount: number;
      cognitionCount: number;
    };
    findings: {
      id: string;
      code:
        | "self-causal-link"
        | "declared-conflict"
        | "causal-cycle"
        | "cognition-order-conflict"
        | "cognition-decrease"
        | "secret-without-incoming-reveal";
      severity: "review";
      summary: string;
      advice: string;
      records: {
        kind: "node" | "edge" | "cognition";
        id: string;
        version: number;
      }[];
    }[];
  };
  createdAt: string;
};

/** Answer of `knowledge/ipTwinGet` (`ip-twin.get`). */
export type IpTwinGetResult = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  stale: boolean;
  nodes: {
    id: string;
    projectId: string;
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    summary: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  edges: {
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    relation:
      | "causes"
      | "enables"
      | "blocks"
      | "reveals"
      | "conflicts_with"
      | "depends_on";
    rationale: string;
    confidence: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  audienceStates: {
    id: string;
    projectId: string;
    subjectType: "audience" | "character";
    subjectId: string;
    knowledgeNodeId: string;
    storyOrder: number;
    state: "unknown" | "suspects" | "misbelieves" | "knows";
    evidence: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  conflicts: string[];
  ruleAnalysis?: {
    ruleSet: "story-structure-rules-v1";
    evidencePolicy: "frozen-author-declarations-not-semantic-proof";
    coverage: {
      nodeCount: number;
      edgeCount: number;
      cognitionCount: number;
    };
    findings: {
      id: string;
      code:
        | "self-causal-link"
        | "declared-conflict"
        | "causal-cycle"
        | "cognition-order-conflict"
        | "cognition-decrease"
        | "secret-without-incoming-reveal";
      severity: "review";
      summary: string;
      advice: string;
      records: {
        kind: "node" | "edge" | "cognition";
        id: string;
        version: number;
      }[];
    }[];
  };
  createdAt: string;
};

/** Input of `knowledge/memoryCreate` (`memory.create`). */
export type MemoryCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/memoryCreate` (`memory.create`). */
export type MemoryCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/memoryGet` (`memory.get`). */
export type MemoryGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/memoryList` (`memory.list`). */
export type MemoryListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/memoryList` (`memory.list`). */
export type MemoryListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/memoryUpdate` (`memory.update`). */
export type MemoryUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/memoryUpdate` (`memory.update`). */
export type MemoryUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/narrativeIndexCatalog` (`narrativeIndex.catalog`). */
export type NarrativeIndexCatalogResult = {
  projectId: string;
  projectVersion: number;
  fingerprint: string;
  chapters: {
    id: string;
    version: number;
    title: string;
    orderIndex: number;
    contentHash: string;
    hasContent: boolean;
    paragraphCount: number;
    summaryState: "current" | "stale" | "missing" | "empty";
    summaryCount: number;
    factCount: number;
    excludedRecordCount: number;
    originalEstimatedTokens: number;
    summaryEstimatedTokens: number;
  }[];
  groups: {
    id: string;
    version: number;
    kind: "book" | "volume" | "story-arc";
    title: string;
    chapterIds: string[];
    state: "current" | "unbound" | "stale";
    reasons: string[];
    coverage: {
      chapterCount: number;
      nonEmptyChapterCount: number;
      currentSummaryChapterCount: number;
      missingSummaryChapterIds: string[];
    };
  }[];
  unavailable: string[];
  unassignedRecords: {
    id: string;
    version: number;
    reason: "chapter-missing" | "chapter-unbound";
  }[];
};

/** Answer of `knowledge/narrativeIndexChapter` (`narrativeIndex.chapter`). */
export type NarrativeIndexChapterResult = {
  projectId: string;
  fingerprint: string;
  chapter: {
    id: string;
    version: number;
    title: string;
    orderIndex: number;
    contentHash: string;
    hasContent: boolean;
    paragraphCount: number;
    summaryState: "current" | "stale" | "missing" | "empty";
    summaryCount: number;
    factCount: number;
    excludedRecordCount: number;
    originalEstimatedTokens: number;
    summaryEstimatedTokens: number;
  };
  paragraphs: {
    id: string;
    start: number;
    end: number;
    contentHash: string;
  }[];
  summaries: {
    id: string;
    version: number;
    sourceWorkflowId: string;
    text: string;
    evidence: {
      quote: string;
      matches: {
        start: number;
        end: number;
        paragraphIds: string[];
      }[];
    };
  }[];
  facts: {
    id: string;
    version: number;
    kind: "character-states" | "story-events" | "foreshadowings";
    sourceWorkflowId: string;
    title: string;
    text: string;
    evidence: {
      quote: string;
      matches: {
        start: number;
        end: number;
        paragraphIds: string[];
      }[];
    };
  }[];
  excluded: {
    id: string;
    version: number;
    reason:
      | "unverified-adoption"
      | "source-stale"
      | "invalid-evidence"
      | "modified-record"
      | "missing-summary";
  }[];
};

/** Answer of `knowledge/narrativeStoryIndexCatalog` (`narrativeStoryIndex.catalog`). */
export type NarrativeStoryIndexCatalogResult = {
  projectId: string;
  fingerprint: string;
  evidencePolicy: "source-anchored-human-interpretations-not-semantic-proof";
  entries: {
    selection: {
      id: string;
      version: number;
      kind: "declaration" | "assertion";
    };
    projectId: string;
    title: string;
    statement: string;
    classification:
      | (
          | "character"
          | "event"
          | "secret"
          | "rule"
          | "location"
          | "organization"
          | "resource"
          | "relationship"
          | "inspiration"
        )
      | ("relationship" | "cognition");
    status: "pending" | "adopted" | "discarded";
    sourceFingerprint: string;
    sourceState: "current" | "stale" | "unavailable";
    record?: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    retirement?: "active" | "withdrawn" | "replaced";
    interpretation: "author-declared" | "source-stated" | "author-inferred";
    eligibility: {
      state: "eligible" | "ineligible";
      reasons: string[];
    };
    sourceChapters: {
      id: string;
      version: number;
    }[];
    sourceScripts: {
      id: string;
      version: number;
    }[];
    endpoints: {
      id: string;
      version: number;
      title: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
    }[];
    storyOrder?: number;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    relation?:
      | "causes"
      | "enables"
      | "blocks"
      | "reveals"
      | "conflicts_with"
      | "depends_on";
    relationshipEndpoints?: {
      from: {
        id: string;
        version: number;
      };
      to: {
        id: string;
        version: number;
      };
    };
    knowledgeState?: "unknown" | "suspects" | "misbelieves" | "knows";
    cognitionTarget?: {
      id: string;
      version: number;
    };
    cognitionSubject?:
      | {
          kind: "audience";
          id: string;
        }
      | {
          kind: "character";
          node: {
            id: string;
            version: number;
          };
        };
  }[];
  hierarchy?:
    | {
        state: "available";
        projectId: string;
        projectVersion: number;
        fingerprint: string;
        membershipPolicy: "current-directory-not-frozen-membership-or-read-coverage";
        chapters: {
          id: string;
          version: number;
          title: string;
          orderIndex: number;
        }[];
        groups: {
          id: string;
          version: number;
          kind: "book" | "volume" | "story-arc";
          title: string;
          chapterIds: string[];
          state: "current" | "unbound" | "stale";
          reasons: string[];
        }[];
      }
    | {
        state: "unavailable";
        projectId: string;
        reason: "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。";
      };
};

/** Answer of `knowledge/narrativeSummariesGet` (`narrativeSummaries.get`). */
export type NarrativeSummariesGetResult = {
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
  content: {
    summary: string;
    coveredChapters: {
      id: string;
      version: number;
    }[];
    evidence: {
      chapter: {
        id: string;
        version: number;
      };
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
      quote: string;
    }[];
  };
  sourceSnapshotId: string;
  runIds: string[];
  engineKind: "pi";
  contextBudget: {
    source: "estimate";
    tokenBudget: number;
    estimatedTokens: number;
  };
  usage: {
    state: "unknown";
  };
  createdAt: string;
  updatedAt: string;
  adoptedAt?: string;
  isHead: boolean;
  isCurrent: boolean;
  sourceState: "current" | "stale";
  staleReasons: string[];
  contextEligibility: {
    state: "eligible" | "ineligible";
    reasons: string[];
  };
};

/** Query of `knowledge/narrativeSummariesList` (`narrativeSummaries.list`). */
export type NarrativeSummariesListQuery = {
  limit?: number;
  cursor?: string;
};

/** Answer of `knowledge/narrativeSummariesList` (`narrativeSummaries.list`). */
export type NarrativeSummariesListResult = {
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
    content: {
      summary: string;
      coveredChapters: {
        id: string;
        version: number;
      }[];
      evidence: {
        chapter: {
          id: string;
          version: number;
        };
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
        quote: string;
      }[];
    };
    sourceSnapshotId: string;
    runIds: string[];
    engineKind: "pi";
    contextBudget: {
      source: "estimate";
      tokenBudget: number;
      estimatedTokens: number;
    };
    usage: {
      state: "unknown";
    };
    createdAt: string;
    updatedAt: string;
    adoptedAt?: string;
    isHead: boolean;
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasons: string[];
    contextEligibility: {
      state: "eligible" | "ineligible";
      reasons: string[];
    };
  }[];
  nextCursor?: string;
};

/** Answer of `knowledge/narrativeSummariesScopes` (`narrativeSummaries.scopes`). */
export type NarrativeSummariesScopesResult = {
  projectId: string;
  scopes: {
    target: {
      id: string;
      version: number;
      kind: "book" | "volume" | "story-arc";
    };
    title: string;
    scopeFingerprint: string;
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentHash: string;
      hasContent: boolean;
      paragraphCount: number;
      summaryState: "current" | "stale" | "missing" | "empty";
      summaryCount: number;
      factCount: number;
      excludedRecordCount: number;
      originalEstimatedTokens: number;
      summaryEstimatedTokens: number;
    }[];
    head: {
      id: string;
      version: number;
    } | null;
    state: "current" | "unbound" | "stale";
    reasons: string[];
  }[];
  unavailable: string[];
};

/** Query of `knowledge/narrativeSummariesSummaries` (`narrativeSummaries.summaries`). */
export type NarrativeSummariesSummariesQuery = {
  limit?: number;
  cursor?: string;
};

/** Answer of `knowledge/narrativeSummariesSummaries` (`narrativeSummaries.summaries`). */
export type NarrativeSummariesSummariesResult = {
  items: {
    id: string;
    projectId: string;
    workflowId: string;
    version: number;
    status: "awaiting-review" | "adopted" | "discarded";
    target: {
      id: string;
      version: number;
      kind: "book" | "volume" | "story-arc";
    };
    isHead: boolean;
    isCurrent: boolean;
    sourceState: "current" | "stale";
    staleReasonCount: number;
    contextEligibility: {
      state: "eligible" | "ineligible";
      reasonCount: number;
    };
    coveredChapterCount: number;
    createdAt: string;
    updatedAt: string;
    adoptedAt?: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/provenanceCreate` (`provenance.create`). */
export type ProvenanceCreateInput = {
  projectId?: string;
  fromType: string;
  fromId: string;
  relation:
    | "collected_from"
    | "inspired_by"
    | "derived_from"
    | "generated_from"
    | "adopted_from"
    | "quoted_from";
  toType: string;
  toId: string;
  quoteExcerpt?: string;
};

/** Answer of `knowledge/provenanceCreate` (`provenance.create`). */
export type ProvenanceCreateResult = {
  id: string;
  projectId?: string;
  fromType: string;
  fromId: string;
  relation:
    | "collected_from"
    | "inspired_by"
    | "derived_from"
    | "generated_from"
    | "adopted_from"
    | "quoted_from";
  toType: string;
  toId: string;
  quoteExcerpt?: string;
  version: number;
  createdAt: string;
};

/** Query of `knowledge/provenanceList` (`provenance.list`). */
export type ProvenanceListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/provenanceList` (`provenance.list`). */
export type ProvenanceListResult = {
  items: {
    id: string;
    projectId?: string;
    fromType: string;
    fromId: string;
    relation:
      | "collected_from"
      | "inspired_by"
      | "derived_from"
      | "generated_from"
      | "adopted_from"
      | "quoted_from";
    toType: string;
    toId: string;
    quoteExcerpt?: string;
    version: number;
    createdAt: string;
  }[];
};

/** Input of `knowledge/researchFindingsCreate` (`research.findings.create`). */
export type ResearchFindingsCreateInput = {
  statement: string;
  kind: "fact" | "quote" | "inference" | "creator_opinion";
  sourceIds?: string[];
};

/** Answer of `knowledge/researchFindingsCreate` (`research.findings.create`). */
export type ResearchFindingsCreateResult = {
  id: string;
  topicId: string;
  statement: string;
  kind: "fact" | "quote" | "inference" | "creator_opinion";
  sourceIds: string[];
  status: "draft" | "supported" | "stale" | "blocked";
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/researchFindingsList` (`research.findings.list`). */
export type ResearchFindingsListResult = {
  items: {
    id: string;
    topicId: string;
    statement: string;
    kind: "fact" | "quote" | "inference" | "creator_opinion";
    sourceIds: string[];
    status: "draft" | "supported" | "stale" | "blocked";
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/researchSearch` (`research.search`). */
export type ResearchSearchInput = {
  query?: string;
};

/** Answer of `knowledge/researchSearch` (`research.search`). */
export type ResearchSearchResult = {
  topicId: string;
  results: {
    source: "manual_url";
    results: {
      title: string;
      url: string;
      excerpt?: string;
      publishedAt?: string;
    }[];
    coverage: string;
  }[];
  coverage: string[];
  fallbackUsed: boolean;
};

/** Input of `knowledge/researchSourcesCreate` (`research.sources.create`). */
export type ResearchSourcesCreateInput = {
  sourceType: "rss_atom" | "manual_url" | "local";
  title: string;
  url?: string;
  excerpt?: string;
  publishedAt?: string;
  dataDate?: string;
};

/** Answer of `knowledge/researchSourcesCreate` (`research.sources.create`). */
export type ResearchSourcesCreateResult = {
  id: string;
  topicId: string;
  sourceType:
    "duckduckgo" | "gdelt" | "wikimedia" | "rss_atom" | "manual_url" | "local";
  title: string;
  url?: string;
  excerpt?: string;
  publishedAt?: string;
  dataDate?: string;
  retrievedAt: string;
  status: "discovered" | "adopted" | "rejected";
  createdAt: string;
};

/** Query of `knowledge/researchSourcesList` (`research.sources.list`). */
export type ResearchSourcesListQuery = {
  limit?: string;
  cursor?: string;
};

/** Answer of `knowledge/researchSourcesList` (`research.sources.list`). */
export type ResearchSourcesListResult = {
  items: {
    id: string;
    topicId: string;
    sourceType:
      | "duckduckgo"
      | "gdelt"
      | "wikimedia"
      | "rss_atom"
      | "manual_url"
      | "local";
    title: string;
    url?: string;
    excerpt?: string;
    publishedAt?: string;
    dataDate?: string;
    retrievedAt: string;
    status: "discovered" | "adopted" | "rejected";
    createdAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/researchTopicsCreate` (`research.topics.create`). */
export type ResearchTopicsCreateInput = {
  title: string;
  query: string;
  riskDomain?: "general" | "finance" | "health" | "legal";
};

/** Answer of `knowledge/researchTopicsCreate` (`research.topics.create`). */
export type ResearchTopicsCreateResult = {
  id: string;
  projectId: string;
  title: string;
  query: string;
  riskDomain: "general" | "finance" | "health" | "legal";
  status: "draft" | "researching" | "ready" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/researchTopicsList` (`research.topics.list`). */
export type ResearchTopicsListQuery = {
  cursor?: string;
  limit?: string;
  status?: string;
};

/** Answer of `knowledge/researchTopicsList` (`research.topics.list`). */
export type ResearchTopicsListResult = {
  items: {
    id: string;
    projectId: string;
    title: string;
    query: string;
    riskDomain: "general" | "finance" | "health" | "legal";
    status: "draft" | "researching" | "ready" | "archived";
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/storyBibleSidecarPreferencesCreate` (`story-bible-sidecar-preferences.create`). */
export type StoryBibleSidecarPreferencesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/storyBibleSidecarPreferencesCreate` (`story-bible-sidecar-preferences.create`). */
export type StoryBibleSidecarPreferencesCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyBibleSidecarPreferencesGet` (`story-bible-sidecar-preferences.get`). */
export type StoryBibleSidecarPreferencesGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyBibleSidecarPreferencesList` (`story-bible-sidecar-preferences.list`). */
export type StoryBibleSidecarPreferencesListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/storyBibleSidecarPreferencesList` (`story-bible-sidecar-preferences.list`). */
export type StoryBibleSidecarPreferencesListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/storyBibleSidecarPreferencesUpdate` (`story-bible-sidecar-preferences.update`). */
export type StoryBibleSidecarPreferencesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/storyBibleSidecarPreferencesUpdate` (`story-bible-sidecar-preferences.update`). */
export type StoryBibleSidecarPreferencesUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyBibleApply` (`story-bible.apply`). */
export type StoryBibleApplyInput = {
  fields?: string[];
};

/** Answer of `knowledge/storyBibleApply` (`story-bible.apply`). */
export type StoryBibleApplyResult = {
  id: string;
  projectId: string;
  chapterId: string;
  sourceVersion: number;
  status:
    | "queued"
    | "draft"
    | "applied"
    | "paused"
    | "skipped"
    | "discarded"
    | "stale"
    | "failed";
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: string;
  conflictNotes: string[];
  preview: {
    title: string;
    fields: {
      key: string;
      value: string;
    }[];
  };
  appliedAt?: string;
  undoneAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyBibleList` (`story-bible.list`). */
export type StoryBibleListResult = {
  id: string;
  projectId: string;
  chapterId: string;
  sourceVersion: number;
  status:
    | "queued"
    | "draft"
    | "applied"
    | "paused"
    | "skipped"
    | "discarded"
    | "stale"
    | "failed";
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: string;
  conflictNotes: string[];
  preview: {
    title: string;
    fields: {
      key: string;
      value: string;
    }[];
  };
  appliedAt?: string;
  undoneAt?: string;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/storyBibleQueue` (`story-bible.queue`). */
export type StoryBibleQueueInput = {
  projectId: string;
  chapterId: string;
};

/** Answer of `knowledge/storyBibleQueue` (`story-bible.queue`). */
export type StoryBibleQueueResult = {
  id: string;
  projectId: string;
  chapterId: string;
  sourceVersion: number;
  status:
    | "queued"
    | "draft"
    | "applied"
    | "paused"
    | "skipped"
    | "discarded"
    | "stale"
    | "failed";
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: string;
  conflictNotes: string[];
  preview: {
    title: string;
    fields: {
      key: string;
      value: string;
    }[];
  };
  appliedAt?: string;
  undoneAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyBibleRecordsCreate` (`story-bible.records.create`). */
export type StoryBibleRecordsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/storyBibleRecordsCreate` (`story-bible.records.create`). */
export type StoryBibleRecordsCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyBibleRecordsGet` (`story-bible.records.get`). */
export type StoryBibleRecordsGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyBibleRecordsList` (`story-bible.records.list`). */
export type StoryBibleRecordsListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/storyBibleRecordsList` (`story-bible.records.list`). */
export type StoryBibleRecordsListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/storyBibleRecordsUpdate` (`story-bible.records.update`). */
export type StoryBibleRecordsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/storyBibleRecordsUpdate` (`story-bible.records.update`). */
export type StoryBibleRecordsUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyBibleSetStatus` (`story-bible.setStatus`). */
export type StoryBibleSetStatusInput = {
  status: "queued" | "paused" | "skipped" | "discarded";
};

/** Answer of `knowledge/storyBibleSetStatus` (`story-bible.setStatus`). */
export type StoryBibleSetStatusResult = {
  id: string;
  projectId: string;
  chapterId: string;
  sourceVersion: number;
  status:
    | "queued"
    | "draft"
    | "applied"
    | "paused"
    | "skipped"
    | "discarded"
    | "stale"
    | "failed";
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: string;
  conflictNotes: string[];
  preview: {
    title: string;
    fields: {
      key: string;
      value: string;
    }[];
  };
  appliedAt?: string;
  undoneAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyBibleSettings` (`story-bible.settings`). */
export type StoryBibleSettingsResult = {
  projectId: string;
  autoSuggest: boolean;
  updatedAt: string;
};

/** Answer of `knowledge/storyBibleStale` (`story-bible.stale`). */
export type StoryBibleStaleResult = {
  id: string;
  projectId: string;
  chapterId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `knowledge/storyBibleUndo` (`story-bible.undo`). */
export type StoryBibleUndoResult = {
  id: string;
  projectId: string;
  chapterId: string;
  sourceVersion: number;
  status:
    | "queued"
    | "draft"
    | "applied"
    | "paused"
    | "skipped"
    | "discarded"
    | "stale"
    | "failed";
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: string;
  conflictNotes: string[];
  preview: {
    title: string;
    fields: {
      key: string;
      value: string;
    }[];
  };
  appliedAt?: string;
  undoneAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyBibleUpdateSettings` (`story-bible.updateSettings`). */
export type StoryBibleUpdateSettingsInput = {
  autoSuggest: boolean;
};

/** Answer of `knowledge/storyBibleUpdateSettings` (`story-bible.updateSettings`). */
export type StoryBibleUpdateSettingsResult = {
  projectId: string;
  autoSuggest: boolean;
  updatedAt: string;
};

/** Input of `knowledge/storyEventsCreate` (`story-events.create`). */
export type StoryEventsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/storyEventsCreate` (`story-events.create`). */
export type StoryEventsCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyEventsGet` (`story-events.get`). */
export type StoryEventsGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyEventsList` (`story-events.list`). */
export type StoryEventsListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/storyEventsList` (`story-events.list`). */
export type StoryEventsListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/storyEventsUpdate` (`story-events.update`). */
export type StoryEventsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/storyEventsUpdate` (`story-events.update`). */
export type StoryEventsUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyGraphCreateEdge` (`story-graph.createEdge`). */
export type StoryGraphCreateEdgeInput = {
  fromNodeId: string;
  toNodeId: string;
  relation:
    | "causes"
    | "enables"
    | "blocks"
    | "reveals"
    | "conflicts_with"
    | "depends_on";
  rationale: string;
  confidence: number;
  confirmed: boolean;
};

/** Answer of `knowledge/storyGraphCreateEdge` (`story-graph.createEdge`). */
export type StoryGraphCreateEdgeResult = {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relation:
    | "causes"
    | "enables"
    | "blocks"
    | "reveals"
    | "conflicts_with"
    | "depends_on";
  rationale: string;
  confidence: number;
  confirmed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyGraphCreateNode` (`story-graph.createNode`). */
export type StoryGraphCreateNodeInput = {
  kind:
    | "character"
    | "event"
    | "secret"
    | "rule"
    | "location"
    | "organization"
    | "resource"
    | "relationship"
    | "inspiration";
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  confirmed: boolean;
};

/** Answer of `knowledge/storyGraphCreateNode` (`story-graph.createNode`). */
export type StoryGraphCreateNodeResult = {
  id: string;
  projectId: string;
  kind:
    | "character"
    | "event"
    | "secret"
    | "rule"
    | "location"
    | "organization"
    | "resource"
    | "relationship"
    | "inspiration";
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  confirmed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyGraphGet` (`story-graph.get`). */
export type StoryGraphGetResult = {
  nodes: {
    id: string;
    projectId: string;
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    summary: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  edges: {
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    relation:
      | "causes"
      | "enables"
      | "blocks"
      | "reveals"
      | "conflicts_with"
      | "depends_on";
    rationale: string;
    confidence: number;
    confirmed: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  audienceStates: {
    id: string;
    projectId: string;
    subjectType: "audience" | "character";
    subjectId: string;
    knowledgeNodeId: string;
    storyOrder: number;
    state: "unknown" | "suspects" | "misbelieves" | "knows";
    evidence: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Input of `knowledge/storySimulationsCreate` (`story-simulations.create`). */
export type StorySimulationsCreateInput = {
  snapshotId: string;
  hypothesis: string;
};

/** Answer of `knowledge/storySimulationsCreate` (`story-simulations.create`). */
export type StorySimulationsCreateResult = {
  id: string;
  projectId: string;
  snapshotId: string;
  hypothesis: string;
  status: "preview" | "committed" | "discarded";
  deterministicFindings: string[];
  modelInferences: string[];
  affectedNodeIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storySimulationsGet` (`story-simulations.get`). */
export type StorySimulationsGetResult = {
  id: string;
  projectId: string;
  snapshotId: string;
  hypothesis: string;
  status: "preview" | "committed" | "discarded";
  deterministicFindings: string[];
  modelInferences: string[];
  affectedNodeIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyCreate` (`story.create`). */
export type StoryCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/storyCreate` (`story.create`). */
export type StoryCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyGet` (`story.get`). */
export type StoryGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyList` (`story.list`). */
export type StoryListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/storyList` (`story.list`). */
export type StoryListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/storyUpdate` (`story.update`). */
export type StoryUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/storyUpdate` (`story.update`). */
export type StoryUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyAssertionsAdopt` (`storyAssertions.adopt`). */
export type StoryAssertionsAdoptInput = {
  sourceFingerprint: string;
  confirmedSourceReview: true;
  confirmedInterpretationReview: true;
};

/** Answer of `knowledge/storyAssertionsAdopt` (`storyAssertions.adopt`). */
export type StoryAssertionsAdoptResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyAssertionsCreate` (`storyAssertions.create`). */
export type StoryAssertionsCreateInput =
  | {
      title: string;
      statement: string;
      interpretation: "source-stated" | "author-inferred";
      sources: (
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          }
      )[];
      kind: "relationship";
      from: {
        id: string;
        version: number;
      };
      to: {
        id: string;
        version: number;
      };
      relation:
        | "causes"
        | "enables"
        | "blocks"
        | "reveals"
        | "conflicts_with"
        | "depends_on";
      confidence: number;
    }
  | {
      title: string;
      statement: string;
      interpretation: "source-stated" | "author-inferred";
      sources: (
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          }
      )[];
      kind: "cognition";
      subject:
        | {
            kind: "audience";
            id: string;
          }
        | {
            kind: "character";
            node: {
              id: string;
              version: number;
            };
          };
      target: {
        id: string;
        version: number;
      };
      storyOrder: number;
      state: "unknown" | "suspects" | "misbelieves" | "knows";
    };

/** Answer of `knowledge/storyAssertionsCreate` (`storyAssertions.create`). */
export type StoryAssertionsCreateResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyAssertionsDiscard` (`storyAssertions.discard`). */
export type StoryAssertionsDiscardInput = Record<string, JsonValue>;

/** Answer of `knowledge/storyAssertionsDiscard` (`storyAssertions.discard`). */
export type StoryAssertionsDiscardResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyAssertionsGet` (`storyAssertions.get`). */
export type StoryAssertionsGetResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyAssertionsList` (`storyAssertions.list`). */
export type StoryAssertionsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `knowledge/storyAssertionsList` (`storyAssertions.list`). */
export type StoryAssertionsListResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    version: number;
    status: "pending" | "adopted" | "discarded";
    sourceStatus: {
      state: "current" | "stale" | "unavailable";
      reasons: string[];
    };
    adoptedRecord?: {
      kind: "edge" | "cognition";
      id: string;
      version: number;
    };
    createdAt: string;
    updatedAt: string;
    lifecycle?: {
      state: "active" | "withdrawn" | "replaced";
      version: number;
      record: {
        kind: "node" | "edge" | "cognition";
        id: string;
        version: number;
      };
      replacementId?: string;
    };
    title: string;
    kind: "relationship" | "cognition";
    sourceFingerprint: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/storyAssertionsReplace` (`storyAssertions.replace`). */
export type StoryAssertionsReplaceInput = {
  lifecycleVersion: number;
  record: {
    kind: "node" | "edge" | "cognition";
    id: string;
    version: number;
  };
  reason: string;
  confirmedRetirementReview: true;
  replacement: {
    id: string;
    etag: string;
    sourceFingerprint: string;
    confirmedSourceReview: true;
    confirmedInterpretationReview: true;
  };
};

/** Answer of `knowledge/storyAssertionsReplace` (`storyAssertions.replace`). */
export type StoryAssertionsReplaceResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyAssertionsWithdraw` (`storyAssertions.withdraw`). */
export type StoryAssertionsWithdrawInput = {
  lifecycleVersion: number;
  record: {
    kind: "node" | "edge" | "cognition";
    id: string;
    version: number;
  };
  reason: string;
  confirmedRetirementReview: true;
};

/** Answer of `knowledge/storyAssertionsWithdraw` (`storyAssertions.withdraw`). */
export type StoryAssertionsWithdrawResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input:
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "relationship";
        from: {
          id: string;
          version: number;
        };
        to: {
          id: string;
          version: number;
        };
        relation:
          | "causes"
          | "enables"
          | "blocks"
          | "reveals"
          | "conflicts_with"
          | "depends_on";
        confidence: number;
      }
    | {
        title: string;
        statement: string;
        interpretation: "source-stated" | "author-inferred";
        sources: (
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            }
        )[];
        kind: "cognition";
        subject:
          | {
              kind: "audience";
              id: string;
            }
          | {
              kind: "character";
              node: {
                id: string;
                version: number;
              };
            };
        target: {
          id: string;
          version: number;
        };
        storyOrder: number;
        state: "unknown" | "suspects" | "misbelieves" | "knows";
      };
  basis: {
    format: "source-anchored-story-assertion-v1";
    projectId: string;
    fingerprint: string;
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof";
    sourceBasis: {
      format: "source-anchored-story-declaration-v1";
      projectId: string;
      fingerprint: string;
      evidencePolicy: "exact-source-identity-not-semantic-verification";
      sources: {
        selection:
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "paragraphs";
              paragraphIds: string[];
            }
          | {
              chapterId: string;
              chapterVersion: number;
              chapterContentHash: string;
              kind: "adopted-fact";
              recordId: string;
              recordVersion: number;
              workflowId: string;
            }
          | {
              kind: "screenplay-blocks";
              scriptId: string;
              scriptVersion: number;
              documentId: string;
              documentVersion: number;
              documentContentHash: string;
              blockIds: string[];
            };
        text: string;
        quote: string;
        quoteHash: string;
        anchors: (
          | {
              start: number;
              end: number;
              paragraphIds: string[];
            }
          | {
              blockId: string;
              blockIndex: number;
              blockType:
                | "scene_heading"
                | "action"
                | "character"
                | "dialogue"
                | "parenthetical"
                | "transition"
                | "note";
              sourceLocation?: {
                line: number;
                column?: number;
              };
            }
        )[];
      }[];
      policyDependencies: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }[];
    };
    nodes: {
      id: string;
      projectId: string;
      kind:
        | "character"
        | "event"
        | "secret"
        | "rule"
        | "location"
        | "organization"
        | "resource"
        | "relationship"
        | "inspiration";
      title: string;
      summary: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: number;
      confirmed: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedRecord?: {
    kind: "edge" | "cognition";
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyDeclarationsAdopt` (`storyDeclarations.adopt`). */
export type StoryDeclarationsAdoptInput = {
  sourceFingerprint: string;
  confirmedSourceReview: true;
  confirmedInterpretationReview: true;
};

/** Answer of `knowledge/storyDeclarationsAdopt` (`storyDeclarations.adopt`). */
export type StoryDeclarationsAdoptResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyDeclarationsCreate` (`storyDeclarations.create`). */
export type StoryDeclarationsCreateInput = {
  kind:
    | "character"
    | "event"
    | "secret"
    | "rule"
    | "location"
    | "organization"
    | "resource"
    | "relationship"
    | "inspiration";
  title: string;
  statement: string;
  eventTimeline?: {
    storyOrder: number;
    timeLabel: string;
    interpretation: "source-stated" | "author-inferred";
  };
  sources: (
    | {
        chapterId: string;
        chapterVersion: number;
        chapterContentHash: string;
        kind: "paragraphs";
        paragraphIds: string[];
      }
    | {
        chapterId: string;
        chapterVersion: number;
        chapterContentHash: string;
        kind: "adopted-fact";
        recordId: string;
        recordVersion: number;
        workflowId: string;
      }
    | {
        kind: "screenplay-blocks";
        scriptId: string;
        scriptVersion: number;
        documentId: string;
        documentVersion: number;
        documentContentHash: string;
        blockIds: string[];
      }
  )[];
};

/** Answer of `knowledge/storyDeclarationsCreate` (`storyDeclarations.create`). */
export type StoryDeclarationsCreateResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyDeclarationsDiscard` (`storyDeclarations.discard`). */
export type StoryDeclarationsDiscardInput = Record<string, JsonValue>;

/** Answer of `knowledge/storyDeclarationsDiscard` (`storyDeclarations.discard`). */
export type StoryDeclarationsDiscardResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/storyDeclarationsGet` (`storyDeclarations.get`). */
export type StoryDeclarationsGetResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/storyDeclarationsList` (`storyDeclarations.list`). */
export type StoryDeclarationsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `knowledge/storyDeclarationsList` (`storyDeclarations.list`). */
export type StoryDeclarationsListResult = {
  projectId: string;
  items: {
    id: string;
    projectId: string;
    version: number;
    status: "pending" | "adopted" | "discarded";
    sourceStatus: {
      state: "current" | "stale" | "unavailable";
      reasons: string[];
    };
    adoptedNode?: {
      id: string;
      version: number;
    };
    createdAt: string;
    updatedAt: string;
    lifecycle?: {
      state: "active" | "withdrawn" | "replaced";
      version: number;
      record: {
        kind: "node" | "edge" | "cognition";
        id: string;
        version: number;
      };
      replacementId?: string;
    };
    title: string;
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    sourceFingerprint: string;
  }[];
  nextCursor?: string;
};

/** Input of `knowledge/storyDeclarationsReplace` (`storyDeclarations.replace`). */
export type StoryDeclarationsReplaceInput = {
  lifecycleVersion: number;
  record: {
    kind: "node" | "edge" | "cognition";
    id: string;
    version: number;
  };
  reason: string;
  confirmedRetirementReview: true;
  replacement: {
    id: string;
    etag: string;
    sourceFingerprint: string;
    confirmedSourceReview: true;
    confirmedInterpretationReview: true;
  };
};

/** Answer of `knowledge/storyDeclarationsReplace` (`storyDeclarations.replace`). */
export type StoryDeclarationsReplaceResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/storyDeclarationsWithdraw` (`storyDeclarations.withdraw`). */
export type StoryDeclarationsWithdrawInput = {
  lifecycleVersion: number;
  record: {
    kind: "node" | "edge" | "cognition";
    id: string;
    version: number;
  };
  reason: string;
  confirmedRetirementReview: true;
};

/** Answer of `knowledge/storyDeclarationsWithdraw` (`storyDeclarations.withdraw`). */
export type StoryDeclarationsWithdrawResult = {
  id: string;
  projectId: string;
  version: number;
  status: "pending" | "adopted" | "discarded";
  input: {
    kind:
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    title: string;
    statement: string;
    eventTimeline?: {
      storyOrder: number;
      timeLabel: string;
      interpretation: "source-stated" | "author-inferred";
    };
    sources: (
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "paragraphs";
          paragraphIds: string[];
        }
      | {
          chapterId: string;
          chapterVersion: number;
          chapterContentHash: string;
          kind: "adopted-fact";
          recordId: string;
          recordVersion: number;
          workflowId: string;
        }
      | {
          kind: "screenplay-blocks";
          scriptId: string;
          scriptVersion: number;
          documentId: string;
          documentVersion: number;
          documentContentHash: string;
          blockIds: string[];
        }
    )[];
  };
  basis: {
    format: "source-anchored-story-declaration-v1";
    projectId: string;
    fingerprint: string;
    evidencePolicy: "exact-source-identity-not-semantic-verification";
    sources: {
      selection:
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "paragraphs";
            paragraphIds: string[];
          }
        | {
            chapterId: string;
            chapterVersion: number;
            chapterContentHash: string;
            kind: "adopted-fact";
            recordId: string;
            recordVersion: number;
            workflowId: string;
          }
        | {
            kind: "screenplay-blocks";
            scriptId: string;
            scriptVersion: number;
            documentId: string;
            documentVersion: number;
            documentContentHash: string;
            blockIds: string[];
          };
      text: string;
      quote: string;
      quoteHash: string;
      anchors: (
        | {
            start: number;
            end: number;
            paragraphIds: string[];
          }
        | {
            blockId: string;
            blockIndex: number;
            blockType:
              | "scene_heading"
              | "action"
              | "character"
              | "dialogue"
              | "parenthetical"
              | "transition"
              | "note";
            sourceLocation?: {
              line: number;
              column?: number;
            };
          }
      )[];
    }[];
    policyDependencies: {
      sourceId: string;
      sourceVersion: number;
      fieldPath: string;
    }[];
  };
  adoptedNode?: {
    id: string;
    version: number;
  };
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    version: number;
    record: {
      kind: "node" | "edge" | "cognition";
      id: string;
      version: number;
    };
    replacementId?: string;
    transitions: {
      version: number;
      action: "withdraw" | "replace";
      reason: string;
      replacementId?: string;
      createdAt: string;
    }[];
  };
  sourceStatus: {
    state: "current" | "stale" | "unavailable";
    reasons: string[];
  };
  etag: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/visualProfilesCreate` (`visual-profiles.create`). */
export type VisualProfilesCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/visualProfilesCreate` (`visual-profiles.create`). */
export type VisualProfilesCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/visualProfilesGet` (`visual-profiles.get`). */
export type VisualProfilesGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/visualProfilesList` (`visual-profiles.list`). */
export type VisualProfilesListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/visualProfilesList` (`visual-profiles.list`). */
export type VisualProfilesListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/visualProfilesUpdate` (`visual-profiles.update`). */
export type VisualProfilesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/visualProfilesUpdate` (`visual-profiles.update`). */
export type VisualProfilesUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `knowledge/visualSettingsCreate` (`visual-settings.create`). */
export type VisualSettingsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `knowledge/visualSettingsCreate` (`visual-settings.create`). */
export type VisualSettingsCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `knowledge/visualSettingsGet` (`visual-settings.get`). */
export type VisualSettingsGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `knowledge/visualSettingsList` (`visual-settings.list`). */
export type VisualSettingsListQuery = {
  projectId?: string;
};

/** Answer of `knowledge/visualSettingsList` (`visual-settings.list`). */
export type VisualSettingsListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `knowledge/visualSettingsUpdate` (`visual-settings.update`). */
export type VisualSettingsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `knowledge/visualSettingsUpdate` (`visual-settings.update`). */
export type VisualSettingsUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
};
